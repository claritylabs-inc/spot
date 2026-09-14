import dayjs from "dayjs";
import { assertExternalBrokerIdentity } from "./lib/brokerProfileValidation";
import { v } from "convex/values";
import { createAccount } from "@convex-dev/auth/server";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { getAuthSiteUrl } from "./lib/domains";
import {
  assertCustomerUser,
  isBootstrapOperatorEmail,
} from "./lib/operatorIdentity";

const operatorAuthValidator = v.object({
  tokenId: v.optional(v.string()),
  timestamp: v.number(),
  nonce: v.string(),
  bodyHash: v.string(),
  signature: v.string(),
});

const AUTH_WINDOW_MS = 5 * 60 * 1000;
const NONCE_TTL_MS = 10 * 60 * 1000;

const operatorToken = () => process.env.OPERATOR_PROVISIONING_SECRET;

async function requireOperatorAuth(
  ctx: ActionCtx,
  auth: {
    tokenId?: string;
    timestamp: number;
    nonce: string;
    bodyHash: string;
    signature: string;
  },
  body: unknown,
) {
  const expected = operatorToken();
  if (!expected) {
    throw new Error(
      "OPERATOR_PROVISIONING_SECRET is not configured on this Convex deployment",
    );
  }
  if (
    auth.tokenId &&
    process.env.OPERATOR_PROVISIONING_TOKEN_ID &&
    auth.tokenId !== process.env.OPERATOR_PROVISIONING_TOKEN_ID
  ) {
    throw new Error("Invalid operator token id");
  }
  if (!auth.nonce || auth.nonce.length < 16)
    throw new Error("Invalid operator nonce");
  if (!/^[a-f0-9]{64}$/i.test(auth.bodyHash))
    throw new Error("Invalid operator body hash");
  if (!/^[a-f0-9]{64}$/i.test(auth.signature))
    throw new Error("Invalid operator signature");

  const expectedBodyHash = await sha256Hex(stableStringify(body));
  if (auth.bodyHash.toLowerCase() !== expectedBodyHash) {
    throw new Error("Operator request body hash mismatch");
  }

  const now = dayjs().valueOf();
  if (Math.abs(now - auth.timestamp) > AUTH_WINDOW_MS) {
    throw new Error("Operator request timestamp is outside the allowed window");
  }

  const usedNonce = await ctx.runQuery(internal.operatorProvisioning.getNonce, {
    nonce: auth.nonce,
  });
  if (usedNonce)
    throw new Error("Operator request nonce has already been used");

  const message = `${auth.tokenId ?? ""}.${auth.timestamp}.${auth.nonce}.${auth.bodyHash}`;
  const expectedSignature = await hmacSha256Hex(expected, message);
  if (!constantTimeEqual(auth.signature.toLowerCase(), expectedSignature)) {
    throw new Error("Invalid operator signature");
  }

  await ctx.runMutation(internal.operatorProvisioning.recordNonce, {
    nonce: auth.nonce,
    timestamp: auth.timestamp,
    expiresAt: now + NONCE_TTL_MS,
  });
}

function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error(`Invalid email: ${email}`);
  }
  return normalized;
}

function normalizeSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
}

function slugFromName(name: string) {
  return normalizeSlug(name.trim().replace(/\s+/g, "-"));
}

async function hmacSha256Hex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(message: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export const checkAuth = action({
  args: {
    operatorAuth: operatorAuthValidator,
  },
  handler: async (ctx, args) => {
    await requireOperatorAuth(ctx, args.operatorAuth, {});
    return {
      ok: true,
      tokenId: args.operatorAuth.tokenId ?? null,
      checkedAt: dayjs().valueOf(),
    };
  },
});

export const provisionBroker = action({
  args: {
    operatorAuth: operatorAuthValidator,
    broker: v.object({
      name: v.string(),
      slug: v.optional(v.string()),
      website: v.optional(v.string()),
    }),
    admin: v.object({
      email: v.string(),
      name: v.optional(v.string()),
      title: v.optional(v.string()),
    }),
    markOnboardingComplete: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    brokerOrgId: Id<"organizations">;
    adminUserId: Id<"users">;
    adminMembershipId: Id<"orgMemberships">;
    createdBroker: boolean;
    createdAdminMembership: boolean;
    signupUrl: string | null;
    loginUrl: string | null;
  }> => {
    const body = {
      admin: args.admin,
      broker: args.broker,
      markOnboardingComplete: args.markOnboardingComplete ?? true,
    };
    await requireOperatorAuth(ctx, args.operatorAuth, body);

    const email = normalizeEmail(args.admin.email);
    assertExternalBrokerIdentity({ ...args.broker, email });
    if (isBootstrapOperatorEmail(email)) {
      throw new Error(
        "Operator emails cannot be used as broker admin accounts",
      );
    }
    const now = dayjs().valueOf();
    const account = await createAccount(ctx, {
      provider: "resend-otp",
      account: { id: email },
      profile: {
        email,
        name: args.admin.name?.trim() || undefined,
        title: args.admin.title?.trim() || undefined,
        emailVerificationTime: now,
        accountKind: "customer",
        onboardingComplete: args.markOnboardingComplete ?? true,
      },
      shouldLinkViaEmail: true,
    });

    if (!account.user)
      throw new Error("Could not create or resolve admin user");

    const result = await ctx.runMutation(
      internal.operatorProvisioning.upsertProvisionedBroker,
      {
        broker: args.broker,
        adminUserId: account.user._id,
        adminEmail: email,
        adminName: args.admin.name,
        adminTitle: args.admin.title,
        markOnboardingComplete: args.markOnboardingComplete ?? true,
      },
    );

    const siteUrl = getAuthSiteUrl();
    return {
      ...result,
      signupUrl: `${siteUrl}/signup?email=${encodeURIComponent(email)}`,
      loginUrl: `${siteUrl}/login?email=${encodeURIComponent(email)}`,
    };
  },
});

export const getNonce = internalQuery({
  args: { nonce: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("operatorAuthNonces")
      .withIndex("nonce", (q) => q.eq("nonce", args.nonce))
      .first();
    if (!existing) return null;
    if (existing.expiresAt < dayjs().valueOf()) return null;
    return existing;
  },
});

export const recordNonce = internalMutation({
  args: {
    nonce: v.string(),
    timestamp: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("operatorAuthNonces")
      .withIndex("nonce", (q) => q.eq("nonce", args.nonce))
      .first();
    if (existing && existing.expiresAt >= now)
      throw new Error("Operator request nonce has already been used");

    const expired = await ctx.db
      .query("operatorAuthNonces")
      .withIndex("expiration", (q) => q.lt("expiresAt", now))
      .take(100);
    for (const row of expired) await ctx.db.delete(row._id);

    await ctx.db.insert("operatorAuthNonces", args);
  },
});

export const upsertProvisionedBroker = internalMutation({
  args: {
    broker: v.object({
      name: v.string(),
      slug: v.optional(v.string()),
      website: v.optional(v.string()),
    }),
    adminUserId: v.id("users"),
    adminEmail: v.string(),
    adminName: v.optional(v.string()),
    adminTitle: v.optional(v.string()),
    markOnboardingComplete: v.boolean(),
  },
  handler: async (ctx, args) => {
    const brokerName = args.broker.name.trim();
    if (!brokerName) throw new Error("Broker name is required");
    assertExternalBrokerIdentity({ ...args.broker, email: args.adminEmail });

    const slug = args.broker.slug
      ? normalizeSlug(args.broker.slug)
      : slugFromName(brokerName);
    if (slug.length < 3 || slug.length > 40)
      throw new Error("Slug must be 3-40 characters");

    const existingBySlug = await ctx.db
      .query("organizations")
      .withIndex("slug", (q) => q.eq("slug", slug))
      .first();
    if (existingBySlug && existingBySlug.type !== "broker") {
      throw new Error(`Slug ${slug} is already used by a non-broker org`);
    }

    const brokerPatch = {
      name: brokerName,
      type: "broker" as const,
      slug,
      website: args.broker.website?.trim() || undefined,
      primaryInsuranceContactId:
        existingBySlug?.primaryInsuranceContactId ?? args.adminUserId,
      onboardingComplete: args.markOnboardingComplete,
      operatorStatus: existingBySlug?.operatorStatus ?? ("onboarding" as const),
    };

    let brokerOrgId: Id<"organizations">;
    let createdBroker = false;
    if (existingBySlug) {
      brokerOrgId = existingBySlug._id;
      await ctx.db.patch(brokerOrgId, brokerPatch);
    } else {
      brokerOrgId = await ctx.db.insert("organizations", brokerPatch);
      createdBroker = true;
    }

    const existingMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", brokerOrgId).eq("userId", args.adminUserId),
      )
      .first();
    await assertCustomerUser(ctx, args.adminUserId);
    const adminMembershipId =
      existingMembership?._id ??
      (await ctx.db.insert("orgMemberships", {
        orgId: brokerOrgId,
        userId: args.adminUserId,
        role: "admin",
      }));

    const now = dayjs().valueOf();
    await ctx.db.patch(args.adminUserId, {
      accountKind: "customer",
      email: args.adminEmail,
      name: args.adminName?.trim() || undefined,
      title: args.adminTitle?.trim() || undefined,
      emailVerificationTime: now,
      onboardingComplete: args.markOnboardingComplete,
    });

    return {
      brokerOrgId,
      adminUserId: args.adminUserId,
      adminMembershipId,
      createdBroker,
      createdAdminMembership: !existingMembership,
      slug,
    };
  },
});
