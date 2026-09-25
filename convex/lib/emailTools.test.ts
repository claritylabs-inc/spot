import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { buildEmailToolExecutors, type EmailToolContext } from "./emailTools";

// Failure modes: forged current-message authority; cross-tenant/thread drafts;
// omitted replacement fields retaining recipients/files; unavailable or repeated
// attachments; COI gate failures and batches escaping exact approval; retries
// resending a delivered draft. All model-backed attachment work is mocked.
const attachmentExecutor = vi.hoisted(() => ({
  policy: vi.fn(),
  coi: vi.fn(),
}));
vi.mock("./agentToolExecutors", () => ({
  buildAgentToolExecutors: (_ctx: unknown, options: unknown) => ({
    attach_policy_document: {
      execute: (input: unknown) => attachmentExecutor.policy(input, options),
    },
    generate_coi: {
      execute: (input: unknown) => attachmentExecutor.coi(input, options),
    },
  }),
}));

const orgId = "org-1" as Id<"organizations">;
const threadId = "thread-1" as Id<"threads">;
const userId = "user-1" as Id<"users">;
const messageId = "message-1" as Id<"threadMessages">;
const baseContext: EmailToolContext = {
  orgId,
  threadId,
  userId,
  sourceUserMessageId: messageId,
  routingParentId: "turn-1",
  channel: "web",
  fromHeader: "Spot <agent@spot.insure>",
  agentAddress: "agent@spot.insure",
  senderEmail: "requester@example.com",
  defaultTo: "requester@example.com",
  emailSendDelay: 0,
};
const authorizedMessage = {
  _id: messageId,
  orgId,
  threadId,
  userId,
  role: "user",
  content: "Send this to recipient@example.com now",
  emailSendAuthorization: {
    sendProbability: 0.95,
    negatedProbability: 0.02,
    model: "jev",
    decidedAt: 1,
  },
};
const file = {
  fileId: "file-1" as Id<"_storage">,
  filename: "evidence.pdf",
  contentType: "application/pdf",
  size: 4,
};

type AttachmentOptions = {
  onResponseAttachment: (attachment: typeof file) => void;
  onPolicyReferenced: (id: Id<"policies">) => void;
};

function harness(context: Partial<EmailToolContext> = {}) {
  const drafts = new Map<string, Doc<"pendingEmails">>();
  let source: object | null = authorizedMessage;
  let sequence = 0;
  const ctx = {
    runQuery: vi.fn(async (ref, args) => {
      switch (getFunctionName(ref)) {
        case "pendingEmails:getInternal":
          return structuredClone(drafts.get(args.id) ?? null);
        case "pendingEmails:listDraftsInternal":
          return [...drafts.values()].filter(
            (d) => d.orgId === args.orgId && d.status === "draft",
          );
        case "pendingEmails:findDraftByThreadAndRecipient":
          return (
            [...drafts.values()].find(
              (d) =>
                d.threadId === args.threadId &&
                d.recipientEmail === args.recipientEmail &&
                d.status === "draft",
            ) ?? null
          );
        case "threads:getMessageInternal":
          return source;
        case "threads:getInternal":
          return {
            _id: args.id,
            orgId: args.id === "foreign-thread" ? "other-org" : orgId,
          };
        case "threads:listThreadAttachmentsInternal":
          return [file];
        default:
          throw new Error(`Unexpected query: ${getFunctionName(ref)}`);
      }
    }),
    runMutation: vi.fn(async (ref, args) => {
      switch (getFunctionName(ref)) {
        case "pendingEmails:create": {
          const id = `draft-${++sequence}` as Id<"pendingEmails">;
          drafts.set(id, {
            ...args,
            _id: id,
            _creationTime: sequence,
          } as Doc<"pendingEmails">);
          return id;
        }
        case "pendingEmails:updateDraftInternal": {
          const old = drafts.get(args.id)!;
          drafts.set(args.id, {
            ...old,
            ...args,
            attachments: args.attachments,
            ccAddresses: args.ccAddresses,
            bccAddresses: args.bccAddresses,
            sendBlockedReason: args.sendBlockedReason,
            coiBatchAuthorization: undefined,
          });
          return null;
        }
        case "pendingEmails:cancelInternal":
          drafts.get(args.id)!.status = "cancelled";
          return true;
        case "pendingEmails:scheduleDraftInternal":
          Object.assign(drafts.get(args.id)!, { ...args, status: "pending" });
          return null;
        case "pendingEmails:setThreadMessage":
          drafts.get(args.id)!.threadMessageId = args.threadMessageId;
          return null;
        case "threads:insertEmailMessage":
          return "email-artifact";
        case "threads:updateEmailMessage":
        case "threads:attachPendingEmailToAgentMessage":
          return null;
        case "threads:createInternal":
          return threadId;
        default:
          throw new Error(`Unexpected mutation: ${getFunctionName(ref)}`);
      }
    }),
    runAction: vi.fn(async (_ref, args) => {
      Object.assign(drafts.get(args.id)!, {
        status: "sent",
        sentMessageId: "sent-1",
      });
    }),
    scheduler: { runAfter: vi.fn() },
  };
  const executors = buildEmailToolExecutors(ctx as unknown as ActionCtx, {
    ...baseContext,
    ...context,
  });
  async function draft(
    extra: Parameters<typeof executors.draft_email.execute>[0] = {},
  ) {
    const result = await executors.draft_email.execute({
      to: "recipient@example.com",
      subject: "Renewal",
      body: "Attached is the requested evidence.",
      ...extra,
    });
    return result.pendingEmailId!;
  }
  return {
    ctx,
    executors,
    drafts,
    draft,
    setSource: (value: object | null) => {
      source = value;
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  attachmentExecutor.policy.mockImplementation(
    async (_input, options: AttachmentOptions) => {
      options.onPolicyReferenced("policy-1" as Id<"policies">);
      options.onResponseAttachment({ ...file, filename: "policy.pdf" });
      return "Attached policy.";
    },
  );
  attachmentExecutor.coi.mockImplementation(
    async (_input, options: AttachmentOptions) => {
      options.onPolicyReferenced("policy-1" as Id<"policies">);
      options.onResponseAttachment({
        ...file,
        fileId: "coi-1" as Id<"_storage">,
        filename: "coi.pdf",
      });
      return "Generated COI.";
    },
  );
});

describe("discrete email tools", () => {
  it("drafts without sending and uses the requester for requester direction", async () => {
    const h = harness();
    const id = await h.draft({
      to: "wrong@example.com",
      recipientDirection: "requester",
    });
    expect(h.drafts.get(id)?.recipientEmail).toBe("requester@example.com");
    expect(h.ctx.runAction).not.toHaveBeenCalled();
  });

  it("clears omitted replacement copies and attachments on the exact draft", async () => {
    const h = harness();
    const id = await h.draft({
      cc: ["copy@example.com"],
      bcc: ["hidden@example.com"],
    });
    await h.executors.attach_file_to_draft.execute({
      draftId: id,
      fileId: file.fileId,
    });
    await h.executors.update_email_draft.execute({
      draftId: id,
      to: "updated@example.com",
      subject: "Changed",
      body: "New body",
    });
    expect(h.drafts.get(id)).toMatchObject({
      recipientEmail: "updated@example.com",
      ccAddresses: undefined,
      bccAddresses: undefined,
      attachments: undefined,
    });
    expect(h.drafts.size).toBe(1);
  });

  it("lists and cancels scoped drafts", async () => {
    const h = harness();
    const id = await h.draft();
    expect(
      (await h.executors.list_email_drafts.execute({})).drafts,
    ).toMatchObject([{ id }]);
    await h.executors.cancel_email_draft.execute({ draftId: id });
    expect(h.drafts.get(id)?.status).toBe("cancelled");
  });

  it.each(["org", "thread"])(
    "rejects a draft outside its %s scope",
    async (boundary) => {
      const h = harness();
      const id = await h.draft();
      Object.assign(
        h.drafts.get(id)!,
        boundary === "org"
          ? { orgId: "other-org" }
          : { threadId: "other-thread" },
      );
      for (const execute of [
        h.executors.send_email_draft.execute,
        h.executors.cancel_email_draft.execute,
      ]) {
        await expect(execute({ draftId: id })).rejects.toThrow(/not found/i);
      }
      await expect(
        h.executors.update_email_draft.execute({
          draftId: id,
          body: "tampered",
        }),
      ).rejects.toThrow(/not found/i);
      await expect(
        h.executors.attach_file_to_draft.execute({
          draftId: id,
          fileId: file.fileId,
        }),
      ).rejects.toThrow(/not found/i);
      expect(h.ctx.runAction).not.toHaveBeenCalled();
    },
  );

  it("rejects a supplied foreign thread before listing", async () => {
    const h = harness({ threadId: undefined });
    await expect(
      h.executors.list_email_drafts.execute({ threadId: "foreign-thread" }),
    ).rejects.toThrow(/not found/i);
  });

  it.each([
    [
      "missing decision after router failure",
      { ...authorizedMessage, emailSendAuthorization: undefined },
    ],
    [
      "low confidence",
      {
        ...authorizedMessage,
        emailSendAuthorization: {
          ...authorizedMessage.emailSendAuthorization,
          sendProbability: 0.69,
        },
      },
    ],
    [
      "negated send",
      {
        ...authorizedMessage,
        emailSendAuthorization: {
          ...authorizedMessage.emailSendAuthorization,
          negatedProbability: 0.9,
        },
      },
    ],
    ["another actor", { ...authorizedMessage, userId: "other-user" }],
    ["another thread", { ...authorizedMessage, threadId: "other-thread" }],
    ["another organization", { ...authorizedMessage, orgId: "other-org" }],
  ])("keeps an unauthorized send as a draft: %s", async (_reason, message) => {
    const h = harness();
    h.setSource(message);
    const id = await h.draft();
    const result = await h.executors.send_email_draft.execute({ draftId: id });
    expect(result.status).toBe("draft");
    expect(result.confirmationReason).toBe("Ready to send?");
    expect(h.drafts.get(id)?.status).toBe("draft");
    expect(h.ctx.runAction).not.toHaveBeenCalled();
    expect(h.ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("sends from a stored actor-bound decision and does not resend on retry", async () => {
    const h = harness();
    const id = await h.draft();
    expect(
      (await h.executors.send_email_draft.execute({ draftId: id })).status,
    ).toBe("sent");
    expect(h.ctx.runAction.mock.calls[0]?.[1]).toMatchObject({
      authorization: {
        kind: "channel_explicit_action",
        actorUserId: userId,
        sourceMessageId: messageId,
      },
    });
    await h.executors.send_email_draft.execute({ draftId: id });
    expect(h.ctx.runAction).toHaveBeenCalledTimes(1);
  });

  it("passes server-owned exact confirmation to the existing final validator", async () => {
    const confirmationId = "confirmation-1" as Id<"threadActionConfirmations">;
    const h = harness({
      sendAuthorization: { kind: "confirmation", confirmationId },
    });
    h.setSource(null);
    const id = await h.draft();
    await h.executors.send_email_draft.execute({ draftId: id });
    expect(h.ctx.runAction.mock.calls[0]?.[1]).toMatchObject({
      authorization: { kind: "confirmation", confirmationId },
    });
  });

  it("keeps unknown recipients for confirmation unless the authorized source names them", async () => {
    const h = harness({ allowedRecipients: ["known@example.com"] });
    const id = await h.draft({ to: "unknown@example.com" });
    expect(
      (await h.executors.send_email_draft.execute({ draftId: id })).status,
    ).toBe("needs_confirmation");
    expect(h.ctx.runAction).not.toHaveBeenCalled();
    const namedId = await h.draft();
    expect(
      (await h.executors.send_email_draft.execute({ draftId: namedId })).status,
    ).toBe("sent");
  });

  it("keeps malformed or missing recipients unsent", async () => {
    const h = harness();
    const id = await h.draft({
      to: "not an address",
      recipientDirection: "explicit",
    });
    expect(
      (await h.executors.send_email_draft.execute({ draftId: id })).status,
    ).toBe("needs_confirmation");
    expect(h.ctx.runAction).not.toHaveBeenCalled();
  });

  it("requires explicit original-policy evidence and authenticated generation", async () => {
    const h = harness();
    const id = await h.draft();
    await h.executors.attach_policy_pdf_to_draft.execute({
      draftId: id,
      policyId: "policy-1",
      explicitArtifactRequest: "original_policy_document",
      intentEvidence: "",
    });
    expect(attachmentExecutor.policy).not.toHaveBeenCalled();
    const noUser = harness({ userId: undefined });
    const noUserId = await noUser.draft();
    await noUser.executors.attach_coi_to_draft.execute({
      draftId: noUserId,
      policyId: "policy-1",
    });
    expect(attachmentExecutor.coi).not.toHaveBeenCalled();
  });

  it("uses the policy executor for availability and deduplicates the exact file", async () => {
    const h = harness();
    const id = await h.draft();
    const input = {
      draftId: id,
      policyId: "policy-1",
      explicitArtifactRequest: "original_policy_document" as const,
      intentEvidence: "Attach the original policy PDF",
    };
    await h.executors.attach_policy_pdf_to_draft.execute(input);
    await h.executors.attach_policy_pdf_to_draft.execute(input);
    expect(h.drafts.get(id)?.attachments).toHaveLength(1);
    expect(attachmentExecutor.policy).toHaveBeenCalledTimes(1);
    attachmentExecutor.policy.mockImplementationOnce(
      async () => "That policy does not have an original file available.",
    );
    await h.executors.attach_policy_pdf_to_draft.execute({
      ...input,
      policyId: "unavailable",
    });
    expect(h.drafts.get(id)?.attachments).toHaveLength(1);
  });

  it("rejects unavailable uploads and deduplicates saved files", async () => {
    const h = harness();
    const id = await h.draft();
    await h.executors.attach_file_to_draft.execute({
      draftId: id,
      fileId: "foreign-file",
    });
    expect(h.drafts.get(id)?.attachments).toBeUndefined();
    await h.executors.attach_file_to_draft.execute({
      draftId: id,
      fileId: file.fileId,
    });
    await h.executors.attach_file_to_draft.execute({
      draftId: id,
      fileId: file.fileId,
    });
    expect(h.drafts.get(id)?.attachments).toHaveLength(1);
  });

  it("preserves COI endorsement arguments, gate failures, and duplicate protection", async () => {
    const h = harness();
    const id = await h.draft();
    attachmentExecutor.coi.mockImplementationOnce(
      async () => "Additional insured endorsement is not verified.",
    );
    const input = {
      draftId: id,
      policyId: "policy-1",
      certificateHolder: "Acme",
      requestedEndorsements: ["additional_insured"],
    };
    const blocked = await h.executors.attach_coi_to_draft.execute(input);
    expect(blocked.responseBody).toContain("not verified");
    expect(h.drafts.get(id)?.attachments).toBeUndefined();
    await h.executors.attach_coi_to_draft.execute(input);
    await h.executors.attach_coi_to_draft.execute(input);
    expect(attachmentExecutor.coi).toHaveBeenCalledTimes(2);
    expect(attachmentExecutor.coi.mock.calls[0]?.[0]).toMatchObject({
      requestedEndorsements: ["additional_insured"],
    });
    expect(h.drafts.get(id)?.attachments).toHaveLength(1);
  });

  it("requires exact batch approval when generation returns multiple COIs", async () => {
    attachmentExecutor.coi.mockImplementationOnce(
      async (_input, options: AttachmentOptions) => {
        options.onResponseAttachment({
          ...file,
          fileId: "coi-1" as Id<"_storage">,
          filename: "coi-1.pdf",
        });
        options.onResponseAttachment({
          ...file,
          fileId: "coi-2" as Id<"_storage">,
          filename: "coi-2.pdf",
        });
      },
    );
    const h = harness();
    const id = await h.draft();
    await h.executors.attach_coi_to_draft.execute({
      draftId: id,
      requirementSourceDocumentId: "requirements",
    });
    const result = await h.executors.send_email_draft.execute({ draftId: id });
    expect(result.status).toBe("needs_confirmation");
    expect(result.confirmationReason).toContain("multiple COIs");
    expect(h.ctx.runAction).not.toHaveBeenCalled();
  });
});

describe("attachment failure recovery", () => {
  it("does not expose MCP original-policy convenience to model arguments", () => {
    const h = harness();
    expect(
      "originalPolicyIds" in h.executors.draft_email.inputSchema.shape,
    ).toBe(false);
    expect(
      "originalPolicyIds" in h.executors.update_email_draft.inputSchema.shape,
    ).toBe(false);
  });

  it.each(["policy", "coi", "file"])(
    "persists a failed %s attachment blocker through send",
    async (kind) => {
      const h = harness();
      const id = await h.draft();
      attachmentExecutor.policy.mockImplementationOnce(
        async () => "Original PDF not available.",
      );
      attachmentExecutor.coi.mockImplementationOnce(
        async () => "Additional insured endorsement is not verified.",
      );
      if (kind === "policy")
        await h.executors.attach_policy_pdf_to_draft.execute({
          draftId: id,
          policyId: "unavailable",
          explicitArtifactRequest: "original_policy_document",
          intentEvidence: "Attach original PDF",
        });
      if (kind === "coi")
        await h.executors.attach_coi_to_draft.execute({
          draftId: id,
          policyId: "policy-1",
        });
      if (kind === "file")
        await h.executors.attach_file_to_draft.execute({
          draftId: id,
          fileId: "missing",
        });
      expect(h.drafts.get(id)?.sendBlockedReason).toMatch(/attachment/i);
      expect(
        (await h.executors.send_email_draft.execute({ draftId: id })).status,
      ).toBe("needs_confirmation");
      expect(h.ctx.runAction).not.toHaveBeenCalled();
    },
  );

  it("does not bypass a required attachment failure with trusted MCP authority", async () => {
    const h = harness({
      channel: "mcp",
      sendAuthorization: { kind: "mcp_explicit_action" },
    });
    const id = await h.draft();
    await h.executors.attach_file_to_draft.execute({
      draftId: id,
      fileId: "missing",
    });
    expect(
      (await h.executors.send_email_draft.execute({ draftId: id })).status,
    ).toBe("needs_confirmation");
    expect(h.ctx.runAction).not.toHaveBeenCalled();
  });

  it("preserves failed required attachments when another attachment succeeds, then clears on replacement", async () => {
    const h = harness();
    const id = await h.draft();
    await h.executors.attach_file_to_draft.execute({
      draftId: id,
      fileId: "missing",
    });
    await h.executors.attach_file_to_draft.execute({
      draftId: id,
      fileId: file.fileId,
    });
    expect(
      (await h.executors.send_email_draft.execute({ draftId: id })).status,
    ).toBe("needs_confirmation");
    await h.executors.update_email_draft.execute({
      draftId: id,
      body: "No attachment is needed.",
    });
    expect(
      (await h.executors.send_email_draft.execute({ draftId: id })).status,
    ).toBe("sent");
  });

  it("clears a matching failure when the requested attachment succeeds on retry", async () => {
    const h = harness();
    const id = await h.draft();
    attachmentExecutor.coi.mockImplementationOnce(
      async () => "Endorsement is not verified.",
    );
    await h.executors.attach_coi_to_draft.execute({
      draftId: id,
      policyId: "policy-1",
    });
    await h.executors.attach_coi_to_draft.execute({
      draftId: id,
      policyId: "policy-1",
    });
    expect(
      (await h.executors.send_email_draft.execute({ draftId: id })).status,
    ).toBe("sent");
  });

  it.each(["policy", "coi"])(
    "reattaches %s after replacement clears the attachment",
    async (kind) => {
      const h = harness();
      const id = await h.draft();
      const attach = () =>
        kind === "policy"
          ? h.executors.attach_policy_pdf_to_draft.execute({
              draftId: id,
              policyId: "policy-1",
              explicitArtifactRequest: "original_policy_document",
              intentEvidence: "Attach full policy",
            })
          : h.executors.attach_coi_to_draft.execute({
              draftId: id,
              policyId: "policy-1",
            });
      await attach();
      await h.executors.update_email_draft.execute({
        draftId: id,
        body: "Replacement draft",
      });
      await attach();
      expect(h.drafts.get(id)?.attachments).toHaveLength(1);
    },
  );

  it("does not send an unrelated upload added before COI generation", async () => {
    const h = harness();
    const id = await h.draft();
    await h.executors.attach_file_to_draft.execute({
      draftId: id,
      fileId: file.fileId,
    });
    await h.executors.attach_coi_to_draft.execute({
      draftId: id,
      policyId: "policy-1",
    });
    expect(
      (await h.executors.send_email_draft.execute({ draftId: id })).status,
    ).toBe("needs_confirmation");
    expect(h.ctx.runAction).not.toHaveBeenCalled();
  });

  it("does not describe cancellation as a new draft awaiting send", async () => {
    const h = harness();
    const id = await h.draft();
    const result = await h.executors.cancel_email_draft.execute({
      draftId: id,
    });
    expect(result.status).toBe("cancelled");
    expect(result.workflowOutcome?.requiredSlots).toEqual([]);
    expect(result.workflowOutcome?.sideEffects).not.toContainEqual(
      expect.objectContaining({ kind: "draft_created" }),
    );
  });
});

describe("email tool fail-closed recovery", () => {
  it.each(["policy", "coi"])(
    "keeps a durable attachment blocker after a %s executor exception",
    async (kind) => {
      const h = harness();
      const id = await h.draft();
      if (kind === "policy") {
        attachmentExecutor.policy.mockRejectedValueOnce(
          new Error("Policy retrieval failed"),
        );
        await h.executors.attach_policy_pdf_to_draft.execute({
          draftId: id,
          policyId: "policy-1",
          explicitArtifactRequest: "original_policy_document",
          intentEvidence: "Attach the original",
        });
      } else {
        attachmentExecutor.coi.mockRejectedValueOnce(
          new Error("Router unavailable"),
        );
        await h.executors.attach_coi_to_draft.execute({
          draftId: id,
          policyId: "policy-1",
        });
      }
      const nextTurn = buildEmailToolExecutors(
        h.ctx as unknown as ActionCtx,
        baseContext,
      );
      const result = await nextTurn.send_email_draft.execute({ draftId: id });
      expect(result.status).toBe("needs_confirmation");
      expect(h.ctx.runAction).not.toHaveBeenCalled();
    },
  );

  it("reports cancellation through the callback without a send prompt", async () => {
    const onResult = vi.fn();
    const h = harness({ onResult });
    const id = await h.draft();
    await h.executors.cancel_email_draft.execute({ draftId: id });
    expect(onResult).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "cancelled",
        workflowOutcome: expect.objectContaining({ requiredSlots: [] }),
      }),
    );
  });

  it("never claims success when final exact-confirmation validation rejects", async () => {
    const h = harness({
      sendAuthorization: {
        kind: "confirmation",
        confirmationId: "stale-confirmation" as Id<"threadActionConfirmations">,
      },
    });
    const id = await h.draft();
    h.ctx.runAction.mockRejectedValueOnce(
      new Error("The confirmed draft changed and must be reviewed again."),
    );
    await expect(
      h.executors.send_email_draft.execute({ draftId: id }),
    ).rejects.toThrow("confirmed draft changed");
    expect(h.drafts.get(id)?.status).toBe("draft");
  });
});

describe("email attachment tenant boundary", () => {
  it("limits attachment executors to the draft organization even with broader agent reads", async () => {
    const h = harness({
      scope: {
        mode: "client",
        surface: "web",
        primaryOrgId: orgId,
        readOrgIds: [orgId, "other-org" as Id<"organizations">],
        writableOrgIds: [orgId],
        orgs: [],
        brokerInternal: false,
      },
    });
    const id = await h.draft();
    await h.executors.attach_policy_pdf_to_draft.execute({
      draftId: id,
      policyId: "policy-1",
      explicitArtifactRequest: "original_policy_document",
      intentEvidence: "Attach full policy",
    });
    expect(attachmentExecutor.policy.mock.calls[0]?.[1]).toMatchObject({
      scope: {
        primaryOrgId: orgId,
        readOrgIds: [orgId],
        writableOrgIds: [orgId],
      },
    });
  });
});

describe("same-step email tool serialization", () => {
  it("retains both concurrent attachment edits", async () => {
    const secondFile = {
      ...file,
      fileId: "file-2" as Id<"_storage">,
      filename: "other.pdf",
    };
    const h = harness({ availableAttachments: [secondFile] });
    const id = await h.draft();
    await Promise.all([
      h.executors.attach_file_to_draft.execute({
        draftId: id,
        fileId: file.fileId,
      }),
      h.executors.attach_file_to_draft.execute({
        draftId: id,
        fileId: secondFile.fileId,
      }),
    ]);
    expect(
      h.drafts.get(id)?.attachments?.map((attachment) => attachment.fileId),
    ).toEqual([file.fileId, secondFile.fileId]);
  });

  it("sends only after a preceding attachment call has finished", async () => {
    const h = harness();
    const id = await h.draft();
    let observedAttachmentCount = 0;
    h.ctx.runAction.mockImplementationOnce(async (_ref, args) => {
      const draft = h.drafts.get(args.id)!;
      observedAttachmentCount = draft.attachments?.length ?? 0;
      Object.assign(draft, { status: "sent", sentMessageId: "sent-1" });
    });
    await Promise.all([
      h.executors.attach_file_to_draft.execute({
        draftId: id,
        fileId: file.fileId,
      }),
      h.executors.send_email_draft.execute({ draftId: id }),
    ]);
    expect(observedAttachmentCount).toBe(1);
  });
});
