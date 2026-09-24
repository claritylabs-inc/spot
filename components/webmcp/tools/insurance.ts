import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { webMcpError } from "@/lib/webmcp/runtime";
import {
  assertDate,
  bool,
  compact,
  id,
  isoTime,
  num,
  record,
  requiredText,
  stringList,
  text,
  uploadBase64File,
  type ClientToolContext,
  type ToolInput,
  type ToolMap,
} from "@/components/webmcp/tools/helpers";

type Policy = {
  _id: string;
  policyNumber?: string;
  carrier?: string;
  carrierIdentity?: { displayName: string } | null;
  insuredName?: string;
  linesOfBusiness?: string[];
  effectiveDate?: string;
  expirationDate?: string;
  extractionDataStage?: string;
  pipelineStatus?: string;
};

export function policyRow(policy: Policy) {
  return {
    policy_id: policy._id,
    policy_number: policy.policyNumber ?? null,
    carrier: policy.carrierIdentity?.displayName ?? policy.carrier ?? null,
    insured_name: policy.insuredName ?? null,
    lines_of_business: policy.linesOfBusiness ?? [],
    effective_date: policy.effectiveDate ?? null,
    expiration_date: policy.expirationDate ?? null,
    extraction_status: policy.extractionDataStage ?? policy.pipelineStatus ?? null,
    url: `/policies/${policy._id}`,
  };
}

function holderInput(holder: ToolInput | undefined) {
  if (!holder) return undefined;
  const address = compact({
    line1: text(holder, "address_line1"),
    line2: text(holder, "address_line2"),
    city: text(holder, "city"),
    state: text(holder, "state"),
    postalCode: text(holder, "postal_code"),
    country: text(holder, "country"),
  });
  return compact({
    displayName: requiredText(holder, "display_name"),
    contactName: text(holder, "contact_name"),
    email: text(holder, "email"),
    phone: text(holder, "phone"),
    address: Object.keys(address).length > 0 ? address : undefined,
  });
}

function holderFields(input: ToolInput) {
  return {
    holderContactName: text(input, "holder_contact_name"),
    holderEmail: text(input, "holder_email"),
    holderPhone: text(input, "holder_phone"),
    addressLine1: text(input, "address_line1"),
    addressLine2: text(input, "address_line2"),
    city: text(input, "city"),
    state: text(input, "state"),
    postalCode: text(input, "postal_code"),
    country: text(input, "country"),
  };
}

type BatchResult = {
  status: string;
  results?: Array<{
    policyId?: string;
    requirementIds?: string[];
    status: string;
    url?: string | null;
    fileName?: string;
    message?: string;
    reasonMessage?: string;
  }>;
  gaps?: unknown[];
};

function batchResult(result: BatchResult) {
  return {
    status: result.status,
    results: (result.results ?? []).map((item) => ({
      policy_id: item.policyId ?? null,
      requirement_ids: item.requirementIds ?? [],
      status: item.status,
      pdf_url: item.url ?? null,
      file_name: item.fileName ?? null,
      message: item.reasonMessage ?? item.message ?? null,
    })),
    gaps: result.gaps ?? [],
  };
}

function singleCertificateResult(result: {
  status: string;
  url?: string | null;
  versionNumber?: number;
  message?: string;
  reasonMessage?: string;
}) {
  return {
    status: result.status,
    pdf_url: result.url ?? null,
    version: result.versionNumber ?? null,
    message: result.reasonMessage ?? result.message ?? null,
  };
}

function requirementArgs(input: ToolInput) {
  const limits = Array.isArray(input.limits)
    ? (input.limits as ToolInput[]).map((limit) =>
        compact({
          kind: requiredText(limit, "kind"),
          amount: num(limit, "amount") ?? 0,
          label: text(limit, "label"),
        }),
      )
    : undefined;
  const maxDeductible = num(input, "max_deductible");
  return compact({
    kind: "coverage" as const,
    scope: requiredText(input, "scope") as "own_org" | "vendors",
    title: requiredText(input, "title"),
    requirementText: requiredText(input, "requirement_text"),
    lineOfBusiness: requiredText(input, "line_of_business"),
    limits,
    maxDeductible: maxDeductible === undefined ? undefined : { amount: maxDeductible },
    coverageForm: text(input, "coverage_form") as "occurrence" | "claims_made" | undefined,
    retroactiveDateOnOrBefore: assertDate(
      text(input, "retroactive_date_on_or_before"),
      "retroactive_date_on_or_before",
    ),
    provisions: stringList(input, "provisions") as
      | Array<"additional_insured" | "waiver_of_subrogation" | "primary_non_contributory">
      | undefined,
    requiredForms: stringList(input, "required_forms"),
  });
}

type RequestDto = {
  _id: string;
  title: string;
  status: string;
  completionOutcome?: unknown;
  packet?: { markdown?: string } | null;
  targetEffectiveDate?: string;
  resultingPolicy?: { _id: string; carrier?: string; policyNumber?: string } | null;
  files?: Array<{ name: string; contentType?: string; size?: number; url?: string | null }>;
};

function requestResult(request: RequestDto) {
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
      url: file.url ?? null,
    })),
    url: `/requests/${request._id}`,
  };
}

export function insuranceToolImplementations(ctx: ClientToolContext): ToolMap {
  const { convex, orgId } = ctx;

  async function findCertificate(certificateId: string) {
    const certificates = await convex.query(api.certificateLifecycle.listForOrg, { orgId });
    const certificate = certificates.find((row) => row._id === certificateId);
    if (!certificate) throw new Error("Certificate not found.");
    return certificate;
  }

  return {
    list_policies: async (input) => {
      const policies = await convex.query(api.policies.listForClient, {
        documentType: "policy",
        archived: bool(input, "archived"),
      });
      return { status: "ok", policies: policies.map(policyRow) };
    },
    get_policy: async (input) => {
      const policy = await convex.query(api.policies.getSummary, {
        id: id<"policies">(input, "policy_id"),
      });
      if (!policy) return webMcpError("Policy not found or not accessible.");
      return {
        status: "ok",
        policy: {
          ...policyRow(policy),
          premium: policy.premium ?? null,
          limits: policy.limits ?? null,
          deductibles: policy.deductibles ?? null,
          coverages: policy.coverages ?? [],
          summary: policy.summary ?? null,
          broker: policy.brokerAgency ?? policy.broker ?? null,
          archived: Boolean(policy.deletedAt),
        },
      };
    },
    search_policy_wording: async (input) => {
      const terms = requiredText(input, "query").toLowerCase().split(/\s+/).filter(Boolean);
      const limit = Math.min(25, Math.max(1, num(input, "limit") ?? 8));
      const nodes = await convex.query(api.sourceNodes.listByPolicy, {
        policyId: id<"policies">(input, "policy_id"),
      });
      const matches = nodes
        .map((node) => {
          const haystack = [node.title, node.description, node.excerpt]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return { node, score: terms.filter((term) => haystack.includes(term)).length };
        })
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);
      return {
        status: "ok",
        total_sections: nodes.length,
        matches: matches.map(({ node }) => ({
          node_id: node.nodeId,
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
    get_policy_source_evidence: async (input) => {
      const policyId = id<"policies">(input, "policy_id");
      const spanIds = (stringList(input, "span_ids") ?? []).slice(0, 256);
      const nodeIds = (stringList(input, "node_ids") ?? []).slice(0, 128);
      if (spanIds.length === 0 && nodeIds.length === 0) {
        return webMcpError("Provide span_ids or node_ids.");
      }
      const [spans, nodes] = await Promise.all([
        spanIds.length > 0
          ? convex.query(api.sourceSpans.listSpansByPolicyAndSpanIds, { policyId, spanIds })
          : [],
        nodeIds.length > 0
          ? convex.query(api.sourceNodes.listByPolicyAndNodeIds, { policyId, nodeIds })
          : [],
      ]);
      return {
        status: "ok",
        spans: spans.map((span) => ({
          span_id: span.spanId,
          text: span.text,
          page: span.location?.page ?? null,
        })),
        sections: nodes.map((node) => ({
          node_id: node.nodeId,
          title: node.title ?? null,
          excerpt: node.excerpt ?? null,
          page_start: node.pageStart ?? null,
          page_end: node.pageEnd ?? null,
        })),
      };
    },
    get_policy_document_url: async (input) => {
      const url = await convex.query(api.policies.getPolicyFileUrl, {
        policyId: id<"policies">(input, "policy_id"),
      });
      return url ? { status: "ok", pdf_url: url } : webMcpError("No document is available for this policy.");
    },
    list_policy_versions: async (input) => {
      const versions = await convex.query(api.policyVersions.listByPolicy, {
        policyId: id<"policies">(input, "policy_id"),
      });
      return {
        status: "ok",
        versions: versions.map((version) => ({
          version_id: version._id,
          version: version.versionNumber,
          kind: version.versionKind,
          policy_number: version.policyNumber ?? null,
          effective_date: version.effectiveDate ?? null,
          expiration_date: version.expirationDate ?? null,
          summary: version.summary ?? null,
          created_at: isoTime(version.createdAt),
        })),
      };
    },
    retry_policy_extraction: async (input) => {
      const result = await convex.action(api.actions.retryExtraction.retryExtraction, {
        policyId: id<"policies">(input, "policy_id"),
        mode: text(input, "mode") as "resume" | "restart" | undefined,
      });
      return "error" in result && result.error
        ? webMcpError(String(result.error))
        : { status: "extraction_started" };
    },

    list_certificates: async (input) => {
      const archived = bool(input, "archived") ?? false;
      const policyId = text(input, "policy_id");
      const certificates = await convex.query(api.certificateLifecycle.listForOrg, { orgId });
      return {
        status: "ok",
        certificates: certificates
          .filter((certificate) => Boolean(certificate.archivedAt) === archived)
          .filter((certificate) => !policyId || certificate.policyId === policyId)
          .map((certificate) => ({
            certificate_id: certificate._id,
            holder: certificate.holder?.displayName ?? null,
            policy_id: certificate.policyId,
            policy_number: certificate.policy?.policyNumber ?? null,
            status: certificate.status,
            current_version: certificate.currentVersion?.versionNumber ?? null,
            last_issued_at: isoTime(certificate.lastIssuedAt),
            pdf_url: certificate.url,
            versions: certificate.versions.map((version) => ({
              version: version.versionNumber,
              status: version.status,
              pdf_url: version.url,
            })),
          })),
      };
    },
    list_certificate_review_jobs: async (input) => {
      const jobs = await convex.query(api.certificateWorkflowJobs.listForOrg, {
        orgId,
        status: text(input, "status") as
          | "review_required"
          | "blocked_missing_contact"
          | "sending"
          | "sent"
          | "cancelled"
          | "failed"
          | undefined,
      });
      return {
        status: "ok",
        jobs: jobs.map((job) => ({
          job_id: job._id,
          kind: job.kind,
          status: job.status,
          holder: job.holder?.displayName ?? null,
          policy_id: job.policyId,
          policy_number: job.policy?.policyNumber ?? null,
          recipient_email: job.recipientEmail ?? null,
          review_notes: job.reviewNotes ?? null,
        })),
      };
    },
    generate_certificate: async (input) =>
      batchResult(
        await convex.action(
          api.certificates.generateBatchForPolicy,
          compact({
            orgId,
            primaryPolicyId: id<"policies">(input, "policy_id"),
            holderName: requiredText(input, "holder_name"),
            ...holderFields(input),
          }),
        ),
      ),
    generate_certificates_for_requirements: async (input) => {
      const sourceId = text(input, "requirement_source_id");
      const requirementId = text(input, "requirement_id");
      if (Boolean(sourceId) === Boolean(requirementId)) {
        return webMcpError("Provide exactly one of requirement_source_id or requirement_id.");
      }
      return batchResult(
        await convex.action(
          api.certificates.generateBatchForPolicy,
          compact({
            orgId,
            requirementSourceDocumentId: sourceId as Id<"requirementSourceDocuments"> | undefined,
            requirementId: requirementId as Id<"insuranceRequirements"> | undefined,
          }),
        ),
      );
    },
    reissue_certificate: async (input) => {
      const certificate = await findCertificate(requiredText(input, "certificate_id"));
      const version = certificate.currentVersion;
      const holder = certificate.holder;
      const isAdditionalInsured = version?.requestKind === "additional_insured";
      return singleCertificateResult(
        await convex.action(
          api.certificates.generateForPolicy,
          compact({
            policyId: certificate.policyId,
            certificateId: certificate._id,
            holderName: holder?.displayName ?? "",
            holderContactName: holder?.contactName,
            holderEmail: holder?.email,
            holderPhone: holder?.phone,
            addressLine1: holder?.address?.line1,
            addressLine2: holder?.address?.line2,
            city: holder?.address?.city,
            state: holder?.address?.state,
            postalCode: holder?.address?.postalCode,
            country: holder?.address?.country,
            additionalInsuredName: isAdditionalInsured ? version?.additionalInsuredName : undefined,
            requestedEndorsements: isAdditionalInsured ? ["additional_insured"] : undefined,
            descriptionOfOperations: version?.descriptionOfOperations,
            formCode: version?.formCode,
            forceReissue: true,
            updateHolderDetails: false,
          }),
        ),
      );
    },
    update_certificate_holder: async (input) => {
      const certificate = await findCertificate(requiredText(input, "certificate_id"));
      const version = certificate.currentVersion;
      const holder = certificate.holder;
      const isAdditionalInsured = version?.requestKind === "additional_insured";
      const pick = (key: string, current: string | undefined) =>
        key in input ? text(input, key) : current;
      return singleCertificateResult(
        await convex.action(
          api.certificates.generateForPolicy,
          compact({
            policyId: certificate.policyId,
            certificateId: certificate._id,
            holderName: text(input, "holder_name") ?? holder?.displayName ?? "",
            holderContactName: pick("holder_contact_name", holder?.contactName),
            holderEmail: pick("holder_email", holder?.email),
            holderPhone: pick("holder_phone", holder?.phone),
            addressLine1: pick("address_line1", holder?.address?.line1),
            addressLine2: pick("address_line2", holder?.address?.line2),
            city: pick("city", holder?.address?.city),
            state: pick("state", holder?.address?.state),
            postalCode: pick("postal_code", holder?.address?.postalCode),
            country: pick("country", holder?.address?.country),
            additionalInsuredName: isAdditionalInsured ? version?.additionalInsuredName : undefined,
            requestedEndorsements: isAdditionalInsured ? ["additional_insured"] : undefined,
            descriptionOfOperations: version?.descriptionOfOperations,
            formCode: version?.formCode,
            forceReissue: true,
            updateHolderDetails: true,
          }),
        ),
      );
    },
    archive_certificate: async (input) => {
      const result = await convex.mutation(api.certificateLifecycle.archive, {
        certificateId: id<"policyCertificates">(input, "certificate_id"),
      });
      return { status: result.status, cancelled_jobs: result.cancelledJobs };
    },
    restore_certificate: async (input) => {
      const result = await convex.mutation(api.certificateLifecycle.unarchive, {
        certificateId: id<"policyCertificates">(input, "certificate_id"),
      });
      return { status: result.status };
    },

    list_compliance_requirements: async (input) => {
      const status = text(input, "status");
      const scope = text(input, "scope");
      const requirements = await convex.query(api.compliance.listRequirements, { orgId });
      return {
        status: "ok",
        requirements: requirements
          .filter((row) => !status || row.complianceCheck?.status === status)
          .filter((row) => !scope || row.scope === scope)
          .map((row) => ({
            requirement_id: row._id,
            title: row.title,
            kind: row.kind,
            scope: row.scope,
            line_of_business: row.lineOfBusiness ?? null,
            requirement_text: row.requirementText,
            limits: row.limits ?? [],
            provisions: row.provisions ?? [],
            compliance_status: row.complianceCheck?.status ?? null,
            reasons: row.complianceCheck?.reasons ?? [],
            source_id: row.sourceDocumentId ?? null,
            source: row.requirementSource?.title ?? null,
          })),
      };
    },
    list_requirement_sources: async () => {
      const [sources, certificateSources] = await Promise.all([
        convex.query(api.compliance.listRequirementSources, { orgId }),
        convex.query(api.compliance.listCertificateRequirementSources, { orgId }),
      ]);
      const readiness = new Map(certificateSources.map((source) => [source._id, source.requirements]));
      return {
        status: "ok",
        sources: sources.map((source) => ({
          requirement_source_id: source._id,
          title: source.title,
          source_type: source.sourceType ?? null,
          holder: source.holder?.displayName ?? null,
          deal_name: source.dealName ?? null,
          requirement_count: source.requirementCount,
          notes_markdown: source.internalNotes ?? null,
          requirements: readiness.get(source._id) ?? [],
        })),
      };
    },
    list_source_certificates: async (input) => {
      const versions = await convex.query(api.certificates.listByRequirementSource, {
        orgId,
        requirementSourceDocumentId: id<"requirementSourceDocuments">(input, "requirement_source_id"),
      });
      return {
        status: "ok",
        certificates: versions.map((version) => ({
          version_id: version._id,
          holder: version.holder?.displayName ?? null,
          policy_number: version.policy?.policyNumber ?? null,
          pdf_url: version.url ?? null,
        })),
      };
    },
    create_compliance_requirement: async (input) => {
      const requirementId = await convex.mutation(api.compliance.upsertRequirement, {
        orgId,
        ...requirementArgs(input),
      });
      return { status: "created", requirement_id: requirementId };
    },
    update_compliance_requirement: async (input) => {
      const requirementId = await convex.mutation(api.compliance.upsertRequirement, {
        orgId,
        requirementId: id<"insuranceRequirements">(input, "requirement_id"),
        ...requirementArgs(input),
      });
      return { status: "updated", requirement_id: requirementId };
    },
    archive_compliance_requirement: async (input) => {
      await convex.mutation(api.compliance.archiveRequirement, {
        orgId,
        requirementId: id<"insuranceRequirements">(input, "requirement_id"),
      });
      return { status: "archived" };
    },
    update_requirement_source: async (input) => {
      await convex.mutation(
        api.compliance.updateRequirementSource,
        compact({
          orgId,
          sourceDocumentId: id<"requirementSourceDocuments">(input, "requirement_source_id"),
          title: text(input, "title"),
          sourceType: text(input, "source_type") as
            | "lease_agreement"
            | "client_contract"
            | "vendor_requirements"
            | "other"
            | undefined,
          holder: holderInput(record(input, "holder")),
          dealName: text(input, "deal_name"),
          dealType: text(input, "deal_type"),
          internalNotes: typeof input.notes_markdown === "string" ? input.notes_markdown : undefined,
        }),
      );
      return { status: "updated" };
    },
    archive_requirement_sources: async (input) => {
      const ids = stringList(input, "requirement_source_ids");
      if (!ids) return webMcpError("requirement_source_ids is required.");
      const result = await convex.mutation(api.compliance.archiveRequirementSources, {
        orgId,
        sourceDocumentIds: ids as Id<"requirementSourceDocuments">[],
      });
      return {
        status: "archived",
        archived_sources: result.archivedSourceCount,
        archived_requirements: result.archivedRequirementCount,
      };
    },
    import_compliance_requirements: async (input) => {
      const pastedText = text(input, "pasted_text");
      const hasFile = Boolean(text(input, "content_base64"));
      if (!pastedText && !hasFile) return webMcpError("Provide pasted_text or a file.");
      const scope = (text(input, "scope") ?? "vendors") as "vendors" | "own_org";
      const holder = holderInput(record(input, "holder"));
      if (scope === "own_org" && !holder) {
        return webMcpError("Own-org imports need holder.display_name.");
      }
      const file = hasFile
        ? await uploadBase64File(input, () =>
            convex.mutation(api.compliance.generateRequirementImportUploadUrl, { orgId }),
          )
        : undefined;
      const result = await convex.action(
        api.actions.complianceRequirements.importRequirements,
        compact({
          orgId,
          pastedText,
          fileId: file?.storageId,
          fileName: file?.fileName,
          contentType: file?.contentType,
          sourceType: text(input, "source_type") as
            | "lease_agreement"
            | "client_contract"
            | "vendor_requirements"
            | "other"
            | undefined,
          sourceName: text(input, "source_name"),
          scope,
          holder,
          dealName: text(input, "deal_name"),
          dealType: text(input, "deal_type"),
          internalNotes: text(input, "notes_markdown"),
        }),
      );
      return {
        status: "imported",
        created_count: result.createdCount,
        requirement_ids: result.requirementIds,
        requirement_source_id: result.sourceDocumentId ?? null,
      };
    },
    recheck_compliance_requirement: async (input) => {
      const result = await convex.action(api.actions.complianceReview.recheckOwnRequirement, {
        orgId,
        requirementId: id<"insuranceRequirements">(input, "requirement_id"),
      });
      return { status: "ok", result };
    },

    list_insurance_requests: async () => {
      const requests = await convex.query(api.clientProcurementRequests.list, {});
      return { status: "ok", requests: requests.map(requestResult) };
    },
    get_insurance_request: async (input) => {
      const request = await convex.query(api.clientProcurementRequests.get, {
        requestId: id<"procurementRequests">(input, "request_id"),
      });
      return { status: "ok", request: requestResult(request) };
    },
    create_insurance_request: async (input) => {
      const { requestId } = await convex.mutation(api.clientProcurementRequests.create, {
        title: requiredText(input, "title"),
        narrative: requiredText(input, "narrative"),
        targetEffectiveDate: assertDate(text(input, "target_effective_date"), "target_effective_date"),
      });
      return {
        status: "submitted",
        request_id: requestId,
        url: `/requests/${requestId}`,
        message: "Spot staff will review the request. Use get_insurance_request to check its status.",
      };
    },
    attach_request_document: async (input) => {
      const requestId = id<"procurementRequests">(input, "request_id");
      const file = await uploadBase64File(input, () =>
        convex.mutation(api.clientProcurementRequests.generateUploadUrl, { requestId }),
      );
      const attached = await convex.mutation(api.clientProcurementRequests.attachFile, {
        requestId,
        storageId: file.storageId,
        fileName: file.fileName,
        contentType: file.contentType,
        size: file.size,
      });
      return { status: "attached", request_id: requestId, client_file_id: attached.clientFileId };
    },

    list_client_files: async () => {
      const result = await convex.query(api.clientFiles.list, { clientOrgId: orgId });
      return {
        status: "ok",
        truncated: result.truncated,
        files: result.files.map((file) => ({
          file_id: file._id,
          name: file.name,
          content_type: file.contentType,
          size: file.size,
          policy_id: file.policyId ?? null,
          policy: file.policyLabel ?? null,
          uploaded_by: file.uploadedBySide,
          url: file.url ?? null,
        })),
      };
    },
  };
}
