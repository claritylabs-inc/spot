import dayjs from "dayjs";
import { v } from "convex/values";
import {
  httpAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getAuthSiteUrl } from "./lib/domains";
import {
  normalizeOperatorEmail,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import {
  EMPLOYEE_OTP_PROVIDER,
  inspectEmployeeIdentity,
} from "./lib/employeeProvisioning";

const EMAIL_DOMAIN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const identityArgs = {
  personId: v.string(),
  email: v.string(),
  role: v.union(v.literal("operator"), v.literal("owner")),
  deployment: v.string(),
  appUrl: v.string(),
};
type Identity = {
  personId: string;
  email: string;
  role: "operator" | "owner";
  deployment: string;
  appUrl: string;
};
type Provision = Identity & { requestId: string; approvalDigest: string };
type Result = {
  version: 1;
  status: "member" | "absent" | "blocked";
  personId: string;
  email: string;
  deployment: string;
  environment: string;
  appUrl: string;
  role?: "operator";
  remoteId?: Id<"users">;
  message: string;
  details: { reason: string };
};

function configuration() {
  const secret = process.env.EMPLOYEE_PROVISIONING_SECRET;
  const deployment = process.env.EMPLOYEE_PROVISIONING_DEPLOYMENT;
  const environment = process.env.SPOT_ENV;
  const appUrl = getAuthSiteUrl();
  const domains = (process.env.EMPLOYEE_PROVISIONING_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (
    !secret ||
    secret.length < 32 ||
    !deployment ||
    !/^[a-z0-9-]+$/.test(deployment) ||
    !["production", "dev", "local"].includes(environment ?? "") ||
    !isOrigin(appUrl) ||
    !domains.length ||
    domains.some((domain) => !EMAIL_DOMAIN.test(domain))
  )
    return null;
  return { secret, deployment, environment: environment!, appUrl, domains };
}

function isOrigin(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
}

function result(
  args: Identity,
  status: Result["status"],
  reason: string,
  remoteId?: Id<"users">,
): Result {
  return {
    version: 1,
    status,
    personId: args.personId,
    email: args.email,
    deployment: args.deployment,
    environment: configuration()!.environment,
    appUrl: args.appUrl,
    ...(status === "member" ? { role: "operator" as const, remoteId } : {}),
    message:
      status === "member"
        ? "Active operator access is configured; email OTP is required to sign in."
        : status === "absent"
          ? "No identity or operator access exists for this email."
          : "Operator provisioning is blocked; review the reason before proceeding.",
    details: { reason },
  };
}

async function observeIdentity(
  ctx: QueryCtx | MutationCtx,
  args: Identity,
): Promise<Result> {
  const config = configuration();
  if (
    !config ||
    args.deployment !== config.deployment ||
    args.appUrl !== config.appUrl
  )
    throw new Error("Provisioning configuration changed");
  if (args.role !== "operator")
    return result(args, "blocked", "unsupported_role");
  if (!config.domains.includes(args.email.split("@")[1]))
    return result(args, "blocked", "email_domain_not_allowed");
  const [personBinding, emailBinding] = await Promise.all([
    ctx.db
      .query("employeeProvisioningRequests")
      .withIndex("person", (q) => q.eq("personId", args.personId))
      .first(),
    ctx.db
      .query("employeeProvisioningRequests")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first(),
  ]);
  if (
    (personBinding && personBinding.email !== args.email) ||
    (emailBinding && emailBinding.personId !== args.personId)
  ) {
    return result(args, "blocked", "person_identity_conflict");
  }
  const identity = await inspectEmployeeIdentity(ctx, args.email);
  if (identity.status === "blocked")
    return result(args, "blocked", identity.reason);
  if (identity.status === "absent")
    return result(
      args,
      personBinding ? "blocked" : "absent",
      personBinding ? "previous_identity_missing" : identity.reason,
    );
  if (identity.profile.role !== args.role)
    return result(args, "blocked", "role_conflict");
  if (emailBinding && emailBinding.userId !== identity.user._id)
    return result(args, "blocked", "person_identity_conflict");
  return result(args, "member", identity.reason, identity.user._id);
}

export const observe = internalQuery({
  args: identityArgs,
  handler: observeIdentity,
});

export const provision = internalMutation({
  args: { ...identityArgs, requestId: v.string(), approvalDigest: v.string() },
  handler: async (ctx, args): Promise<Result> => {
    const prior = await ctx.db
      .query("employeeProvisioningRequests")
      .withIndex("request", (q) => q.eq("requestId", args.requestId))
      .unique();
    if (
      prior &&
      (prior.personId !== args.personId ||
        prior.email !== args.email ||
        prior.role !== args.role ||
        prior.deployment !== args.deployment ||
        prior.appUrl !== args.appUrl ||
        prior.approvalDigest !== args.approvalDigest)
    ) {
      return result(args, "blocked", "request_identity_conflict");
    }
    const observed = await observeIdentity(ctx, args);
    if (observed.status === "blocked" || prior) return observed;
    const now = dayjs().valueOf();
    let userId: Id<"users">;
    if (observed.status === "absent") {
      userId = await ctx.db.insert("users", {
        email: args.email,
        accountKind: "operator",
        onboardingComplete: true,
      });
      // Reserve the provider's identity without a secret, verification claim,
      // verification code or session. Convex Auth will verify it through OTP.
      await ctx.db.insert("authAccounts", {
        userId,
        provider: EMPLOYEE_OTP_PROVIDER,
        providerAccountId: args.email,
      });
      await ctx.db.insert("operatorProfiles", {
        userId,
        email: args.email,
        role: "operator",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    } else {
      userId = observed.remoteId!;
    }
    const auditId = await writeOperatorAudit(ctx, {
      serviceActor: "central_employee_provisioning",
      type: "employee_provisioned",
      targetUserId: userId,
      summary:
        observed.status === "absent"
          ? "Central provisioning created operator access"
          : "Central provisioning adopted matching operator access",
      metadata: {
        personId: args.personId,
        email: args.email,
        deployment: args.deployment,
        appUrl: args.appUrl,
        environment: configuration()!.environment,
        role: args.role,
        provisioningRequestId: args.requestId,
        approvalDigest: args.approvalDigest,
        outcome: observed.status === "absent" ? "created" : "adopted",
      },
    });
    await ctx.db.insert("employeeProvisioningRequests", {
      ...args,
      role: "operator",
      userId,
      auditId,
      createdAt: now,
    });
    return result(args, "member", "active_operator", userId);
  },
});

function parseBody(
  value: unknown,
  write: boolean,
): Identity | Provision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const keys = [
    ...Object.keys(identityArgs),
    ...(write ? ["requestId", "approvalDigest"] : []),
  ];
  if (
    Object.keys(body).length !== keys.length ||
    keys.some((key) => typeof body[key] !== "string")
  )
    return null;
  const {
    personId,
    email,
    role,
    deployment,
    appUrl,
    requestId,
    approvalDigest,
  } = body as Record<string, string>;
  const normalizedEmail = normalizeOperatorEmail(email);
  const localPart = normalizedEmail.split("@")[0];
  if (
    !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(personId) ||
    normalizedEmail.length > 254 ||
    localPart.length > 64 ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !EMAIL_DOMAIN.test(normalizedEmail.split("@")[1] ?? "") ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(
      normalizedEmail,
    ) ||
    !["operator", "owner"].includes(role) ||
    !/^[a-z0-9-]{1,128}$/.test(deployment) ||
    !isOrigin(appUrl) ||
    (write &&
      (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId) ||
        !/^[a-f0-9]{64}$/.test(approvalDigest)))
  )
    return null;
  return {
    personId,
    email: normalizedEmail,
    role: role as Identity["role"],
    deployment,
    appUrl,
    ...(write ? { requestId, approvalDigest } : {}),
  };
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

function handler(write: boolean): ReturnType<typeof httpAction> {
  return httpAction(async (ctx, request): Promise<Response> => {
    const config = configuration();
    if (!config)
      return json({ error: "Employee provisioning is unavailable" }, 503);
    const supplied = request.headers.get("Authorization") ?? "";
    const expected = `Bearer ${config.secret}`;
    let different = supplied.length ^ expected.length;
    for (let i = 0; i < expected.length; i++)
      different |= expected.charCodeAt(i) ^ (supplied.charCodeAt(i) || 0);
    if (different) return json({ error: "Unauthorized" }, 401);
    if (
      new URL(request.url).origin !== `https://${config.deployment}.convex.site`
    ) {
      return json({ error: "Provisioning target mismatch" }, 409);
    }
    if (
      request.headers.get("Content-Type")?.split(";", 1)[0].trim() !==
      "application/json"
    )
      return json({ error: "Expected JSON" }, 400);
    // Bound memory before parsing, including chunked bodies without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Invalid request" }, 400);
    let raw = "";
    let bytes = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let parsed: Identity | Provision | null;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 4096) {
          await reader.cancel();
          return json({ error: "Request too large" }, 413);
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
      parsed = parseBody(JSON.parse(raw), write);
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    if (!parsed) return json({ error: "Invalid request" }, 400);
    if (
      parsed.deployment !== config.deployment ||
      parsed.appUrl !== config.appUrl
    )
      return json({ error: "Provisioning target mismatch" }, 409);
    try {
      return json(
        write
          ? await ctx.runMutation(
              internal.employeeProvisioning.provision,
              parsed as Provision,
            )
          : await ctx.runQuery(internal.employeeProvisioning.observe, parsed),
      );
    } catch {
      return json(
        {
          error:
            "Employee provisioning could not be confirmed; observe before retrying",
        },
        503,
      );
    }
  });
}

export const observeHttp = handler(false);
export const provisionHttp = handler(true);
