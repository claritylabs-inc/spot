"use client";

import dayjs from "dayjs";
import { useMemo } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getPublicAgentDomain } from "@/lib/domains";
import { createClientMutationId } from "@/lib/sync/client-mutation-id";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { WEBMCP_CLIENT_PAGES } from "@/lib/webmcp/catalog";
import {
  useWebMcpTools,
  webMcpError,
  type WebMcpToolImplementation,
} from "@/lib/webmcp/runtime";

const AGENT_DOMAIN = getPublicAgentDomain();
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

type Input = Record<string, unknown>;

function text(input: Input, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredText(input: Input, key: string): string {
  const value = text(input, key);
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function onPath(pathname: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/^data:[^,]*,/, "").replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Imperative WebMCP tools for a signed-in client workspace. Reads register on
 * every client page; writes register only on the pages that own them. Every
 * call goes through the same public Convex functions and authorization the
 * visible UI uses.
 */
export function ClientWebMcpTools() {
  const { isAuthenticated } = useConvexAuth();
  const convex = useConvex();
  const router = useRouter();
  const pathname = usePathname();
  const viewer = useCachedQuery(
    "authGuard.viewer",
    api.users.viewer,
    isAuthenticated ? {} : "skip",
  );
  const viewerOrg = useCachedQuery(
    "authGuard.viewerOrg",
    api.orgs.viewerOrg,
    isAuthenticated ? {} : "skip",
  );
  const org = viewerOrg?.org;
  const orgId = org?._id;
  const enabled = Boolean(
    isAuthenticated &&
      viewer &&
      viewer.accountKind !== "operator" &&
      viewer.onboardingComplete &&
      org?.type === "client" &&
      (org.operatorStatus ?? "live") !== "onboarding" &&
      !onPath(pathname, ["/onboarding", "/login", "/signup", "/operator"]),
  );

  const tools = useMemo(() => {
    const reads: WebMcpToolImplementation[] = [
      {
        name: "list_policies",
        execute: async () => {
          const policies = await convex.query(api.policies.listForClient, {
            documentType: "policy",
          });
          return {
            status: "ok",
            policies: policies.map((policy) => ({
              policy_id: policy._id,
              policy_number: policy.policyNumber ?? null,
              carrier: policy.carrierIdentity?.displayName ?? policy.carrier ?? null,
              insured_name: policy.insuredName ?? null,
              lines_of_business: policy.linesOfBusiness ?? [],
              effective_date: policy.effectiveDate ?? null,
              expiration_date: policy.expirationDate ?? null,
              extraction_status:
                policy.extractionDataStage ?? policy.pipelineStatus ?? null,
              url: `/policies/${policy._id}`,
            })),
          };
        },
      },
      {
        name: "get_policy",
        execute: async (input) => {
          const policyId = requiredText(input, "policy_id") as Id<"policies">;
          const policy = await convex.query(api.policies.getSummary, {
            id: policyId,
          });
          if (!policy || policy.deletedAt) {
            return webMcpError("Policy not found or not accessible.");
          }
          return {
            status: "ok",
            policy: {
              policy_id: policy._id,
              policy_number: policy.policyNumber ?? null,
              carrier: policy.carrierIdentity?.displayName ?? policy.carrier ?? null,
              insured_name: policy.insuredName ?? null,
              lines_of_business: policy.linesOfBusiness ?? [],
              effective_date: policy.effectiveDate ?? null,
              expiration_date: policy.expirationDate ?? null,
              premium: policy.premium ?? null,
              limits: policy.limits ?? null,
              deductibles: policy.deductibles ?? null,
              coverages: policy.coverages ?? [],
              summary: policy.summary ?? null,
              broker: policy.brokerAgency ?? policy.broker ?? null,
              extraction_status:
                policy.extractionDataStage ?? policy.pipelineStatus ?? null,
              url: `/policies/${policy._id}`,
            },
          };
        },
      },
      {
        name: "search_policy_wording",
        execute: async (input) => {
          const policyId = requiredText(input, "policy_id") as Id<"policies">;
          const terms = requiredText(input, "query")
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean);
          const limit = Math.min(
            25,
            Math.max(1, Number(input.limit) || 8),
          );
          const nodes = await convex.query(api.sourceNodes.listByPolicy, {
            policyId,
          });
          const matches = nodes
            .map((node) => {
              const haystack = [node.title, node.description, node.excerpt]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
              const score = terms.filter((term) => haystack.includes(term)).length;
              return { node, score };
            })
            .filter(({ score }) => score > 0)
            .sort((left, right) => right.score - left.score)
            .slice(0, limit);
          return {
            status: "ok",
            total_sections: nodes.length,
            matches: matches.map(({ node }) => ({
              title: node.title ?? null,
              type: node.type,
              form_number: node.formNumber ?? null,
              page_start: node.pageStart ?? null,
              page_end: node.pageEnd ?? null,
              excerpt: node.excerpt ?? node.description ?? null,
            })),
            ...(nodes.length === 0
              ? { note: "No extracted wording is available for this policy yet." }
              : {}),
          };
        },
      },
      {
        name: "list_certificates",
        execute: async () => {
          if (!orgId) return webMcpError("No client organization.");
          const certificates = await convex.query(
            api.certificateLifecycle.listForOrg,
            { orgId },
          );
          return {
            status: "ok",
            certificates: certificates
              .filter((certificate) => !certificate.archivedAt)
              .map((certificate) => ({
                certificate_id: certificate._id,
                holder: certificate.holder?.displayName ?? null,
                policy_id: certificate.policyId,
                policy_number: certificate.policy?.policyNumber ?? null,
                version: certificate.currentVersion?.versionNumber ?? null,
                status: certificate.status,
                last_issued_at: certificate.lastIssuedAt
                  ? dayjs(certificate.lastIssuedAt).toISOString()
                  : null,
                pdf_url: certificate.url,
              })),
          };
        },
      },
      {
        name: "list_insurance_requests",
        execute: async () => {
          const requests = await convex.query(
            api.clientProcurementRequests.list,
            {},
          );
          return { status: "ok", requests: requests.map(requestResult) };
        },
      },
      {
        name: "get_insurance_request",
        execute: async (input) => {
          const request = await convex.query(api.clientProcurementRequests.get, {
            requestId: requiredText(input, "request_id") as Id<"procurementRequests">,
          });
          return { status: "ok", request: requestResult(request) };
        },
      },
      {
        name: "list_compliance_requirements",
        execute: async (input) => {
          const status = text(input, "status");
          const requirements = await convex.query(
            api.compliance.listRequirements,
            orgId ? { orgId } : {},
          );
          return {
            status: "ok",
            requirements: requirements
              .filter(
                (requirement) =>
                  !status || requirement.complianceCheck?.status === status,
              )
              .map((requirement) => ({
                requirement_id: requirement._id,
                title: requirement.title,
                scope: requirement.scope,
                line_of_business: requirement.lineOfBusiness ?? null,
                requirement_text: requirement.requirementText,
                compliance_status: requirement.complianceCheck?.status ?? null,
                reasons: requirement.complianceCheck?.reasons ?? [],
                source: requirement.requirementSource?.title ?? null,
              })),
          };
        },
      },
      {
        name: "open_spot_page",
        execute: async (input) => {
          const page = requiredText(input, "page");
          if (!(WEBMCP_CLIENT_PAGES as readonly string[]).includes(page)) {
            return webMcpError(`Unknown page. Use one of: ${WEBMCP_CLIENT_PAGES.join(", ")}.`);
          }
          const recordId = text(input, "record_id");
          const base = page === "agent" ? "/agent/threads" : `/${page}`;
          const href =
            recordId && (page === "policies" || page === "requests")
              ? `${base}/${encodeURIComponent(recordId)}`
              : base;
          router.push(href);
          return { status: "navigating", url: href };
        },
      },
      {
        name: "start_spot_agent_thread",
        execute: async (input) => {
          const content = requiredText(input, "message");
          const threadId = await convex.mutation(api.threads.create, {
            agentDomain: AGENT_DOMAIN,
            clientMutationId: createClientMutationId("thread"),
          });
          await convex.mutation(api.threads.sendMessage, {
            threadId,
            content,
            clientMutationId: createClientMutationId("message"),
          });
          const url = `/agent/thread/${threadId}`;
          router.push(url);
          return {
            status: "started",
            thread_id: threadId,
            url,
            message: "The Spot agent is answering in this thread. Read the page for its reply.",
          };
        },
      },
    ];

    const writes: WebMcpToolImplementation[] = [];
    if (onPath(pathname, ["/certificates", "/compliance", "/policies"])) {
      writes.push({
        name: "generate_certificate",
        execute: async (input) => {
          if (!orgId) return webMcpError("No client organization.");
          const result = await convex.action(
            api.certificates.generateBatchForPolicy,
            {
              orgId,
              primaryPolicyId: requiredText(input, "policy_id") as Id<"policies">,
              holderName: requiredText(input, "holder_name"),
              holderContactName: text(input, "holder_contact_name"),
              holderEmail: text(input, "holder_email"),
              holderPhone: text(input, "holder_phone"),
              addressLine1: text(input, "address_line1"),
              addressLine2: text(input, "address_line2"),
              city: text(input, "city"),
              state: text(input, "state"),
              postalCode: text(input, "postal_code"),
              country: text(input, "country"),
            },
          );
          return {
            status: result.status,
            results: (result.results ?? []).map(
              (item: {
                policyId?: string;
                status: string;
                url?: string | null;
                message?: string;
                reasonMessage?: string;
              }) => ({
                policy_id: item.policyId ?? null,
                status: item.status,
                pdf_url: item.url ?? null,
                message: item.reasonMessage ?? item.message ?? null,
              }),
            ),
            gaps: result.gaps ?? [],
          };
        },
      });
    }
    if (onPath(pathname, ["/requests"])) {
      writes.push(
        {
          name: "create_insurance_request",
          execute: async (input) => {
            const targetEffectiveDate = text(input, "target_effective_date");
            if (targetEffectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetEffectiveDate)) {
              return webMcpError("target_effective_date must be YYYY-MM-DD.");
            }
            const { requestId } = await convex.mutation(
              api.clientProcurementRequests.create,
              {
                title: requiredText(input, "title"),
                narrative: requiredText(input, "narrative"),
                targetEffectiveDate,
              },
            );
            return {
              status: "submitted",
              request_id: requestId,
              url: `/requests/${requestId}`,
              message: "Spot staff will review the request. Use get_insurance_request to check its status.",
            };
          },
        },
        {
          name: "attach_request_document",
          execute: async (input) => {
            const requestId = requiredText(input, "request_id") as Id<"procurementRequests">;
            const fileName = requiredText(input, "file_name");
            const contentType = text(input, "content_type") ?? "application/octet-stream";
            let bytes: Uint8Array<ArrayBuffer>;
            try {
              bytes = decodeBase64(requiredText(input, "content_base64"));
            } catch {
              return webMcpError("content_base64 is not valid base64.");
            }
            if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
              return webMcpError("The file must be between 1 byte and 20 MB.");
            }
            const uploadUrl = await convex.mutation(
              api.clientProcurementRequests.generateUploadUrl,
              { requestId },
            );
            const response = await fetch(uploadUrl, {
              method: "POST",
              headers: { "Content-Type": contentType },
              body: new Blob([bytes], { type: contentType }),
            });
            if (!response.ok) return webMcpError("Upload failed.");
            const { storageId } = (await response.json()) as {
              storageId: Id<"_storage">;
            };
            const attached = await convex.mutation(
              api.clientProcurementRequests.attachFile,
              { requestId, storageId, fileName, contentType, size: bytes.byteLength },
            );
            return {
              status: "attached",
              request_id: requestId,
              client_file_id: attached.clientFileId,
            };
          },
        },
      );
    }
    if (onPath(pathname, ["/compliance"])) {
      writes.push({
        name: "recheck_compliance_requirement",
        execute: async (input) => {
          if (!orgId) return webMcpError("No client organization.");
          const result = await convex.action(
            api.actions.complianceReview.recheckOwnRequirement,
            {
              orgId,
              requirementId: requiredText(input, "requirement_id") as Id<"insuranceRequirements">,
            },
          );
          return { status: "ok", result };
        },
      });
    }
    return [...reads, ...writes];
  }, [convex, orgId, pathname, router]);

  useWebMcpTools(tools, enabled);
  return null;
}

function requestResult(request: {
  _id: string;
  title: string;
  status: string;
  completionOutcome?: unknown;
  packet?: { markdown?: string } | null;
  targetEffectiveDate?: string;
  createdAt?: number;
  resultingPolicy?: { _id: string; carrier?: string; policyNumber?: string } | null;
  files?: Array<{ name: string; contentType?: string; size?: number }>;
}) {
  return {
    request_id: request._id,
    title: request.title,
    status: request.status,
    completion_outcome: request.completionOutcome ?? null,
    target_effective_date: request.targetEffectiveDate ?? null,
    shared_details: request.packet?.markdown ?? null,
    resulting_policy: request.resultingPolicy
      ? {
          policy_id: request.resultingPolicy._id,
          carrier: request.resultingPolicy.carrier ?? null,
          policy_number: request.resultingPolicy.policyNumber ?? null,
        }
      : null,
    files: (request.files ?? []).map((file) => ({
      name: file.name,
      content_type: file.contentType ?? null,
      size: file.size ?? null,
    })),
    url: `/requests/${request._id}`,
  };
}
