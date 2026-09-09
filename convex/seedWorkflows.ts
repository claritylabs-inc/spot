import dayjs from "dayjs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { LOCAL_FIXTURE } from "./lib/localSeedData";
import { upsertOrgWikiSectionByOperator } from "./orgWiki";
import { upsertPacketSectionByOperator } from "./procurementPacket";
import {
  createProcurementRequestByOperator,
  createProcurementOutreachByOperator,
  createProcurementFileItemByOperator,
} from "./procurementRequests";

const REQUEST_TITLE = "Cove technology E&O and cyber renewal (local fixture)";
const THREAD_KEY = "conductor:cove-renewal";
const INBOX_TOKEN = "conductor-cove-renewal-fixture";
const policy = LOCAL_FIXTURE.policy;
const POLICY_EVIDENCE = [
  [
    "fixture-insured",
    `Named insured: ${policy.insuredName}. 111 Richmond Street West, Suite 700, Toronto, ON M5H 2G4, Canada.`,
  ],
  [
    "fixture-insurer",
    `Insurer: ${policy.insurer.legalName}. 200 Front Street West, Toronto, ON M5V 3J1, Canada.`,
  ],
  [
    "fixture-producer",
    `Producer: ${policy.producer.agencyName}. 161 Bay Street, Suite 2700, Toronto, ON M5J 2S1, Canada.`,
  ],
  [
    "fixture-general-agent",
    `General agent: ${policy.generalAgent.agencyName}. 100 King Street West, Toronto, ON M5X 1A9, Canada.`,
  ],
  ["fixture-operations", policy.operationsDescription],
  [
    "fixture-coverages",
    policy.coverages
      .map((coverage) => `${coverage.name}: ${coverage.limit}.`)
      .join(" "),
  ],
] as const;

const DOCUMENTS = [
  {
    key: "policy",
    name: "Cove current policy - local fixture.pdf",
    clientVisible: true,
    paragraphs: [
      "SYNTHETIC LOCAL FIXTURE - NOT AN INSURANCE CONTRACT",
      `Policy ${policy.policyNumber}. Term ${policy.effectiveDate} to ${policy.expirationDate}. Annual premium CAD ${policy.premium}.`,
      ...POLICY_EVIDENCE.map(([, text]) => text),
    ],
  },
  {
    key: "profile",
    name: "Cove company profile - local fixture.pdf",
    clientVisible: true,
    paragraphs: [
      "SYNTHETIC LOCAL FIXTURE - COMPANY PROFILE",
      LOCAL_FIXTURE.client.context,
      "The company provides hosted underwriting and workflow software. Customers include property managers, mortgage professionals, and real estate brokers.",
      "Fixture operating assumptions: 25 employees, CAD 4 million annual revenue, operations in Canada and the United States. These are invented QA facts, not verified company information.",
    ],
  },
  {
    key: "quote",
    name: "Montgomery renewal quote - local fixture.pdf",
    clientVisible: false,
    paragraphs: [
      "SYNTHETIC LOCAL FIXTURE - NOT A BINDABLE QUOTE",
      `Insured: ${policy.insuredName}. Broker: Montgomery Risk. Insurer: ${policy.carrier}.`,
      "Proposed term: March 15, 2027 to March 15, 2028. Annual premium: CAD 51,000.",
      "Technology E&O: CAD 5,000,000 limit; CAD 25,000 deductible. Cyber liability: CAD 2,000,000 limit; CAD 25,000 deductible. Media liability: CAD 1,000,000 limit.",
      "Subject to a signed application and current loss runs. The cyber limit is CAD 1,000,000 below the requested CAD 3,000,000. No coverage is bound.",
    ],
  },
  {
    key: "archived",
    name: "Cove superseded profile - local fixture.pdf",
    clientVisible: true,
    paragraphs: [
      "SYNTHETIC LOCAL FIXTURE - SUPERSEDED",
      "Old company profile retained to exercise file archive and restore. Use the current company profile for underwriting.",
    ],
  },
] as const;

type FixtureIds = {
  operatorUserId: Id<"users">;
  brokerUserId: Id<"users">;
  brokerOrgId: Id<"organizations">;
  clientOrgId: Id<"organizations">;
  policyId: Id<"policies">;
};
const fixtureIds = {
  operatorUserId: v.id("users"),
  brokerUserId: v.id("users"),
  brokerOrgId: v.id("organizations"),
  clientOrgId: v.id("organizations"),
  policyId: v.id("policies"),
};
const storedDocument = v.object({
  key: v.string(),
  fileId: v.id("_storage"),
  sha256: v.string(),
  size: v.number(),
});

function assertLocal() {
  if (process.env.SPOT_ENV !== "local")
    throw new Error("Seed workflows are restricted to SPOT_ENV=local");
}

export const existingDocuments = internalQuery({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    assertLocal();
    const files = await ctx.db
      .query("clientFiles")
      .withIndex("organization", (q) => q.eq("orgId", args.clientOrgId))
      .collect();
    return DOCUMENTS.flatMap((document) => {
      const file = files.find((row) => row.originalName === document.name);
      return file?.sha256
        ? [
            {
              key: document.key,
              fileId: file.fileId,
              sha256: file.sha256,
              size: file.size,
            },
          ]
        : [];
    });
  },
});

async function fixturePdf(paragraphs: readonly string[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage();
  let y = page.getHeight() - 50;
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/);
    let line = "";
    const draw = () => {
      if (y < 50) {
        page = pdf.addPage();
        y = page.getHeight() - 50;
      }
      page.drawText(line, { x: 50, y, size: 11, font });
      y -= 16;
    };
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, 11) > page.getWidth() - 100) {
        draw();
        line = word;
      } else line = candidate;
    }
    if (line) draw();
    y -= 12;
  }
  return await pdf.save();
}

async function sha256(text: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", text)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function seedWorkflowFixtures(
  ctx: ActionCtx,
  fixture: FixtureIds,
) {
  assertLocal();
  const { operatorUserId, brokerUserId, brokerOrgId, clientOrgId, policyId } =
    fixture;
  const ids = {
    operatorUserId,
    brokerUserId,
    brokerOrgId,
    clientOrgId,
    policyId,
  };
  const documents = await ctx.runQuery(
    internal.seedWorkflows.existingDocuments,
    { clientOrgId: ids.clientOrgId },
  );
  const createdFiles: Id<"_storage">[] = [];
  try {
    for (const document of DOCUMENTS) {
      if (documents.some((stored) => stored.key === document.key)) continue;
      const bytes = new Uint8Array(await fixturePdf(document.paragraphs));
      const fileId = await ctx.storage.store(
        new Blob([bytes], { type: "application/pdf" }),
      );
      createdFiles.push(fileId);
      documents.push({
        key: document.key,
        fileId,
        sha256: await sha256(bytes),
        size: bytes.byteLength,
      });
    }
    const result = await ctx.runMutation(internal.seedWorkflows.insert, {
      ...ids,
      documents,
    });
    for (const fileId of result.unusedFileIds) await ctx.storage.delete(fileId);
    return {
      requestId: result.requestId,
      proposalId: result.proposalId,
      operatorThreadId: result.operatorThreadId,
    };
  } catch (error) {
    // Only delete unreferenced blobs: the mutation may have committed before
    // an action retry or a later storage operation failed.
    const referenced = await ctx.runQuery(
      internal.seedWorkflows.existingDocuments,
      { clientOrgId: ids.clientOrgId },
    );
    for (const fileId of createdFiles) {
      if (!referenced.some((file) => file.fileId === fileId))
        await ctx.storage.delete(fileId);
    }
    throw error;
  }
}

async function seedPolicyEvidence(
  ctx: MutationCtx,
  ids: FixtureIds,
  now: number,
) {
  const spans = await ctx.db
    .query("sourceSpans")
    .withIndex("policy", (q) => q.eq("policyId", ids.policyId))
    .collect();
  for (const [spanId, text] of POLICY_EVIDENCE) {
    if (spans.some((span) => span.spanId === spanId)) continue;
    await ctx.db.insert("sourceSpans", {
      orgId: ids.clientOrgId,
      policyId: ids.policyId,
      spanId,
      documentId: String(ids.policyId),
      sourceKind: "policy_pdf",
      text,
      textHash: await sha256(new TextEncoder().encode(text)),
      pageStart: 1,
      pageEnd: 1,
      createdAt: now,
    });
  }
  const nodes = await ctx.db
    .query("sourceNodes")
    .withIndex("policy", (q) => q.eq("policyId", ids.policyId))
    .collect();
  for (const [order, nodeId] of [
    "fixture-declarations",
    "fixture-operations",
  ].entries()) {
    if (nodes.some((node) => node.nodeId === nodeId)) continue;
    const evidence = POLICY_EVIDENCE.filter(([spanId]) =>
      nodeId === "fixture-operations"
        ? spanId === "fixture-operations"
        : spanId !== "fixture-operations",
    );
    await ctx.db.insert("sourceNodes", {
      orgId: ids.clientOrgId,
      policyId: ids.policyId,
      nodeId,
      documentId: String(ids.policyId),
      kind: "section",
      title: order === 0 ? "Declarations" : "Operations",
      description: "Synthetic local policy evidence",
      textExcerpt: evidence.map(([, text]) => text).join("\n"),
      sourceSpanIds: evidence.map(([spanId]) => spanId),
      pageStart: 1,
      pageEnd: 1,
      order,
      path: nodeId,
      createdAt: now,
    });
  }
}

export const insert = internalMutation({
  args: { ...fixtureIds, documents: v.array(storedDocument) },
  handler: async (ctx, args) => {
    assertLocal();
    const now = dayjs().valueOf();
    const unusedFileIds: Id<"_storage">[] = [];
    const clientFiles = await ctx.db
      .query("clientFiles")
      .withIndex("organization", (q) => q.eq("orgId", args.clientOrgId))
      .collect();
    const files = new Map<string, Id<"clientFiles">>();
    for (const document of DOCUMENTS) {
      const stored = args.documents.find((file) => file.key === document.key);
      if (!stored) throw new Error(`Missing fixture document ${document.key}`);
      const existing = clientFiles.find(
        (file) => file.originalName === document.name,
      );
      if (existing) {
        files.set(document.key, existing._id);
        if (existing.fileId !== stored.fileId)
          unusedFileIds.push(stored.fileId);
        continue;
      }
      files.set(
        document.key,
        await ctx.db.insert("clientFiles", {
          orgId: args.clientOrgId,
          fileId: stored.fileId,
          sha256: stored.sha256,
          size: stored.size,
          name: document.name,
          originalName: document.name,
          contentType: "application/pdf",
          clientVisible: document.clientVisible,
          uploadedByUserId: args.operatorUserId,
          uploadedBySide: "operator",
          nameSource: "original",
          nameStatus: "ready",
          createdAt: now,
          updatedAt: now,
          ...(document.key === "policy" ? { policyId: args.policyId } : {}),
          ...(document.key === "archived"
            ? { archivedAt: now, archivedByUserId: args.operatorUserId }
            : {}),
        }),
      );
    }
    const policyFile = await ctx.db.get(files.get("policy")!);
    const existingPolicy = await ctx.db.get(args.policyId);
    if (!existingPolicy?.fileId && policyFile) {
      await ctx.db.patch(args.policyId, {
        fileId: policyFile.fileId,
        fileName: policyFile.name,
        sourceTreeStatus: "ready",
        sourceTreeVersion: "v3",
        sourceTreeUpdatedAt: now,
      });
    }
    await seedPolicyEvidence(ctx, args, now);

    const wiki = await ctx.db
      .query("orgWikiSections")
      .withIndex("organization", (q) => q.eq("orgId", args.clientOrgId))
      .collect();
    for (const [key, body] of [
      ["profile", `- ${LOCAL_FIXTURE.client.context}`],
      [
        "operations",
        "- Hosted underwriting and workflow software for property managers, mortgage professionals, and real estate brokers.",
      ],
      [
        "scale",
        "- Synthetic QA assumptions: 25 employees and CAD 4 million annual revenue, serving Canada and the United States. These are not verified company facts.",
      ],
      [
        "preferences",
        "- Use email for document follow-ups and Slack for quick service questions.",
      ],
    ] as const) {
      if (!wiki.some((section) => section.key === key)) {
        await upsertOrgWikiSectionByOperator(ctx, {
          operatorUserId: args.operatorUserId,
          orgId: args.clientOrgId,
          key,
          body,
        });
      }
    }

    for (const [status, name] of [
      ["prospect", "Lakeview Risk (local fixture)"],
      ["inactive", "Harbour Risk (local fixture)"],
      ["blacklisted", "Restricted Market (local fixture)"],
    ] as const) {
      const slug = `conductor-${status}-supplier`;
      const existing = await ctx.db
        .query("organizations")
        .withIndex("slug", (q) => q.eq("slug", slug))
        .first();
      if (existing) continue;
      const brokerOrgId = await ctx.db.insert("organizations", {
        name,
        slug,
        type: "broker",
        onboardingComplete: true,
      });
      await ctx.db.insert("brokerProfiles", {
        brokerOrgId,
        networkStatus: status,
        writingStates: ["CA", "NY", "TX"],
        lineOfBusinessCodes: ["CYBER", "EO"],
        createdByUserId: args.operatorUserId,
        updatedByUserId: args.operatorUserId,
        createdAt: now,
        updatedAt: now,
      });
    }

    const existingRequest = await ctx.db
      .query("procurementRequests")
      .withIndex("inbox", (q) => q.eq("inboxToken", INBOX_TOKEN))
      .unique();
    if (existingRequest) {
      const existingThread = await ctx.db
        .query("operatorAgentThreads")
        .withIndex("owner_conversation", (q) =>
          q
            .eq("ownerUserId", args.operatorUserId)
            .eq("channel", "chat")
            .eq("conversationKey", THREAD_KEY),
        )
        .first();
      const proposal = await ctx.db
        .query("procurementProposals")
        .withIndex("request", (q) => q.eq("requestId", existingRequest._id))
        .first();
      return {
        requestId: existingRequest._id,
        proposalId: proposal?._id,
        operatorThreadId: existingThread?._id,
        unusedFileIds,
      };
    }
    const { requestId } = await createProcurementRequestByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      clientOrgId: args.clientOrgId,
      source: "operator",
      title: REQUEST_TITLE,
      narrative:
        "Renew our technology E&O and cyber cover for March 15, 2027. Maintain CAD 5 million E&O and CAD 3 million cyber limits. Please flag any reduction in coverage before we decide.",
      targetEffectiveDate: "2027-03-15",
      status: "proposal_review",
      clientVisible: true,
      replacingPolicyId: args.policyId,
    });
    await ctx.db.patch(requestId, { inboxToken: INBOX_TOKEN });
    for (const [key, body, audience] of [
      [
        "summary",
        "Synthetic renewal exercise for a technology company operating in Canada and the United States. No coverage has been bound.",
        "broker",
      ],
      ["applicant_profile", LOCAL_FIXTURE.client.context, "broker"],
      [
        "coverage_requested",
        "Technology E&O: CAD 5,000,000. Cyber liability: CAD 3,000,000. Media liability: CAD 1,000,000. Target inception March 15, 2027.",
        "broker",
      ],
      [
        "loss_history",
        "Current loss runs have been requested. Claims history remains unverified; do not assume no losses.",
        "broker",
      ],
      [
        "ask",
        "Provide terms meeting the requested limits and identify deductibles, exclusions, and outstanding subjectivities.",
        "broker",
      ],
      [
        "market_strategy",
        "Internal QA note: Montgomery's cyber offer is CAD 1 million below target. Ask for a revised limit before staff confirmation or selection.",
        "operator",
      ],
      [
        "client_contacts",
        "Adyan Tanver, adyan@cove.dev. Operator-only contact details for this exercise.",
        "operator",
      ],
    ] as const) {
      await upsertPacketSectionByOperator(ctx, {
        operatorUserId: args.operatorUserId,
        requestId,
        key,
        body,
        audience,
      });
    }
    const { outreachId } = await createProcurementOutreachByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId,
      brokerOrgId: args.brokerOrgId,
      contactUserId: args.brokerUserId,
      contactName: LOCAL_FIXTURE.broker.admin.name,
      contactEmail: LOCAL_FIXTURE.broker.admin.email,
      status: "quote_received",
      source: "operator",
      log: "## Local fixture market log\n\n- Illustrative terms received: CAD 51,000 premium, CAD 5 million E&O and CAD 2 million cyber.\n- Signed application and loss runs remain outstanding.\n- Follow up on the cyber limit shortfall. No live outreach was sent.",
    });
    for (const [key, purpose, brokerRelease, clientVisible] of [
      ["profile", "application", "attached", true],
      ["policy", "other", "hidden", true],
      ["quote", "quote", "hidden", false],
    ] as const) {
      await createProcurementFileItemByOperator(ctx, {
        operatorUserId: args.operatorUserId,
        requestId,
        clientFileId: files.get(key)!,
        ...(key === "quote" ? { outreachId } : {}),
        purpose,
        brokerRelease,
        clientVisible,
        label: DOCUMENTS.find((document) => document.key === key)!.name,
        status: "available",
        source: "operator",
      });
    }
    await createProcurementFileItemByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId,
      outreachId,
      purpose: "requested_document",
      label: "Current loss runs",
      status: "requested",
      brokerRelease: "hidden",
      clientVisible: false,
      source: "operator",
    });
    const quote = await ctx.db.get(files.get("quote")!);
    if (!quote?.sha256) throw new Error("Missing stored quote");
    const proposalId = await ctx.db.insert("procurementProposals", {
      requestId,
      clientOrgId: args.clientOrgId,
      brokerOrgId: args.brokerOrgId,
      outreachId,
      status: "review_ready",
      createdByUserId: args.operatorUserId,
      updatedByUserId: args.operatorUserId,
      createdAt: now,
      updatedAt: now,
    });
    const proposalDocumentId = await ctx.db.insert(
      "procurementProposalDocuments",
      {
        proposalId,
        requestId,
        clientOrgId: args.clientOrgId,
        fileId: quote.fileId,
        clientFileId: quote._id,
        fileName: quote.name,
        contentType: quote.contentType,
        size: quote.size,
        sha256: quote.sha256,
        createdByUserId: args.operatorUserId,
        createdAt: now,
      },
    );
    const extractionFingerprint = `${proposalDocumentId}:${quote.sha256}`;
    const quoteText = DOCUMENTS.find(
      (document) => document.key === "quote",
    )!.paragraphs.join("\n\n");
    const evidence = [
      {
        proposalDocumentId: String(proposalDocumentId),
        sourceNodeIds: ["fixture-quote"],
        sourceSpanIds: ["fixture-quote"],
        pageStart: 1,
        pageEnd: 1,
      },
    ];
    await ctx.db.insert("proposalSourceSpans", {
      orgId: args.clientOrgId,
      proposalId,
      proposalDocumentId,
      extractionFingerprint,
      documentId: String(proposalDocumentId),
      spanId: "fixture-quote",
      text: quoteText,
      textHash: await sha256(new TextEncoder().encode(quoteText)),
      pageStart: 1,
      pageEnd: 1,
      createdAt: now,
    });
    await ctx.db.insert("proposalSourceNodes", {
      orgId: args.clientOrgId,
      proposalId,
      proposalDocumentId,
      extractionFingerprint,
      documentId: String(proposalDocumentId),
      nodeId: "fixture-quote",
      kind: "section",
      title: "Renewal terms",
      textExcerpt: quoteText,
      sourceSpanIds: ["fixture-quote"],
      pageStart: 1,
      pageEnd: 1,
      order: 0,
      path: "renewal-terms",
      createdAt: now,
    });
    await ctx.db.patch(proposalId, {
      extractionFingerprint,
      extractedOffer: {
        insuredName: policy.insuredName,
        carrier: policy.carrier,
        premium: "CAD 51,000",
        proposedEffectiveDate: "2027-03-15",
        proposedExpirationDate: "2028-03-15",
        evidence: {
          insuredName: evidence,
          carrier: evidence,
          premium: evidence,
          proposedEffectiveDate: evidence,
          proposedExpirationDate: evidence,
        },
        coverages: [
          {
            name: "Technology E&O",
            limit: "CAD 5,000,000",
            deductible: "CAD 25,000",
            evidence,
          },
          {
            name: "Cyber liability",
            limit: "CAD 2,000,000",
            deductible: "CAD 25,000",
            evidence,
          },
          { name: "Media liability", limit: "CAD 1,000,000", evidence },
        ],
        subjectivities: [
          {
            description: "Signed application and current loss runs",
            category: "underwriting",
            evidence,
          },
        ],
      },
    });
    const request = await ctx.db.get(requestId);
    const sections = await ctx.db
      .query("procurementPacketSections")
      .withIndex("request", (q) => q.eq("requestId", requestId))
      .collect();
    await ctx.db.insert("procurementProposalReviews", {
      proposalId,
      requestId,
      clientOrgId: args.clientOrgId,
      extractionFingerprint,
      packetRevision: request?.packetRevision ?? 0,
      modelConclusion: "has_gaps",
      findings: sections
        .filter((section) => section.audience === "broker")
        .map((section) => ({
          sectionKey: section.key,
          conclusion:
            section.key === "coverage_requested"
              ? "has_gap"
              : "insufficient_evidence",
          summary:
            section.key === "coverage_requested"
              ? "Synthetic review: cyber limit is CAD 2 million against CAD 3 million requested. Obtain revised terms."
              : "Synthetic review: staff must verify this section against the returned terms.",
          evidence: section.key === "coverage_requested" ? evidence : [],
        })),
      createdAt: now,
      updatedAt: now,
    });
    const operatorThreadId = await ctx.db.insert("operatorAgentThreads", {
      ownerUserId: args.operatorUserId,
      visibility: "private",
      channel: "chat",
      conversationKey: THREAD_KEY,
      title: "Review Cove renewal terms",
      initialContext: {
        pageType: "procurement_request",
        entityId: String(requestId),
        summary: "Local renewal fixture with an unconfirmed cyber limit gap",
      },
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("operatorAgentMessages", {
      threadId: operatorThreadId,
      ownerUserId: args.operatorUserId,
      channel: "chat",
      role: "system",
      content: `Local QA scenario: [Cove renewal](/operator/clients/${args.clientOrgId}/procurement/${requestId}) has a broker-private quote and an unconfirmed review. Check the cyber shortfall, collect loss runs, and draft a follow-up. No messages have been sent and no binding or selection has occurred.`,
      createdAt: now,
      updatedAt: now,
    });
    return { requestId, proposalId, operatorThreadId, unusedFileIds };
  },
});
