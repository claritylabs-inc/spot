"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import type { AgentScope } from "../lib/agentScope";
import { buildAgentToolExecutors } from "../lib/agentToolExecutors";
import { readStoredAgentFile } from "../lib/storedAgentFile";
import { runOperatorWebRetrieval } from "../lib/webRetrieval";
import { parseOperatorAgentToolInput } from "../lib/operatorAgentToolRegistry";
import { mergePdfsFromUrls, mergedFileName } from "../lib/mergePdfs";

const operatorChannelValidator = v.union(
  v.literal("chat"),
  v.literal("slack"),
  v.literal("imessage"),
  v.literal("mcp"),
);

type Attachment = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
};

const RICH_POLICY_TOOLS = new Set([
  "lookup_policy",
  "compare_coverages",
  "lookup_policy_section",
  "attach_policy_document",
  "confirm_policy_fact",
  "lookup_compliance_requirements",
]);

export const runInternal = internalAction({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    toolName: v.string(),
    input: v.any(),
    channel: operatorChannelValidator,
    confirmationId: v.optional(v.id("operatorAgentConfirmations")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    result: unknown;
    attachments?: Attachment[];
  }> => {
    await ctx.runQuery(internal.operator.requireOperatorForUserInternal, {
      userId: args.operatorUserId,
    });

    if (args.toolName === "web_search") {
      const input = parseOperatorAgentToolInput("web_search", args.input);
      return { result: await runOperatorWebRetrieval(ctx, input) };
    }

    if (args.toolName === "import_policy_files") {
      if (!args.confirmationId)
        throw new Error("Policy import confirmation is required");
      const input = parseOperatorAgentToolInput(
        "import_policy_files",
        args.input,
      );
      const sourceArgs = {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        orgId: input.orgId as Id<"organizations">,
        attachmentFileIds: input.attachmentFileIds as string[] | undefined,
        clientFileIds: input.clientFileIds as string[] | undefined,
      };
      const files = await ctx.runQuery(
        internal.operatorPolicyImports.getSourcesInternal,
        sourceArgs,
      );
      for (const file of files) {
        const blob = await ctx.storage.get(file.fileId);
        if (!blob || !(await blob.slice(0, 1024).text()).includes("%PDF-"))
          throw new Error(`${file.fileName} is not a PDF`);
      }
      let mergedFileId: Id<"_storage"> | undefined;
      let mergedName: string | undefined;
      if (input.mode === "combined" && files.length > 1) {
        const urls = await Promise.all(
          files.map(async (file) => {
            const url = await ctx.storage.getUrl(file.fileId);
            if (!url) throw new Error("Policy PDF is unavailable");
            return url;
          }),
        );
        const bytes = await mergePdfsFromUrls(urls);
        mergedFileId = await ctx.storage.store(
          new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        );
        mergedName = mergedFileName(files[0].fileName, files.length);
      }
      let committed = false;
      try {
        const policies = await ctx.runMutation(
          internal.operatorPolicyImports.commitInternal,
          {
            ...sourceArgs,
            confirmationId: args.confirmationId,
            mode: input.mode as "combined" | "separate",
            mergedFileId,
            mergedFileName: mergedName,
          },
        );
        committed = true;
        if (
          mergedFileId &&
          policies.every((policy) => policy.status === "duplicate")
        )
          await ctx.storage.delete(mergedFileId);
        return {
          result: {
            status: "imported",
            policies,
            message:
              "New policies are queued for extraction; existing policies were reused.",
          },
        };
      } finally {
        if (mergedFileId && !committed) await ctx.storage.delete(mergedFileId);
      }
    }

    if (RICH_POLICY_TOOLS.has(args.toolName)) {
      const input = args.input as Record<string, unknown>;
      const orgId = input.orgId as Id<"organizations">;
      const organization = await ctx.runQuery(internal.orgs.getInternal, {
        id: orgId,
      });
      if (!organization || organization.type !== "client") {
        throw new Error("Client organization not found");
      }
      if (args.toolName === "confirm_policy_fact") {
        const policyId = input.policyId as Id<"policies">;
        const policyAccess = await ctx.runQuery(
          internal.operator.requireOperatorPolicyWriteForUserInternal,
          { userId: args.operatorUserId, policyId },
        );
        if (policyAccess.orgId !== orgId) throw new Error("Policy not found");
      }
      const surface = args.channel === "mcp" ? "mcp" : "web";
      const scope: AgentScope = {
        mode: "client",
        surface,
        primaryOrgId: orgId,
        readOrgIds: [orgId],
        writableOrgIds: [orgId],
        orgs: [
          {
            orgId,
            name: organization.name,
            type: "client",
            isPrimary: true,
            canWrite: true,
          },
        ],
        brokerInternal: false,
      };
      const attachments: Attachment[] = [];
      const executors = buildAgentToolExecutors(ctx, {
        surface,
        orgId,
        userId: args.operatorUserId,
        scope,
        readOrgIds: [orgId],
        writableOrgIds: [orgId],
        canWrite: true,
        onResponseAttachment: (attachment) => {
          if (!attachment.fileId) return;
          attachments.push({
            fileId: attachment.fileId,
            filename: attachment.filename,
            contentType: attachment.contentType,
            size: attachment.size,
          });
        },
      });
      const executor = executors[args.toolName as keyof typeof executors];
      if (!executor || typeof executor.execute !== "function") {
        throw new Error(`Unsupported operator action tool: ${args.toolName}`);
      }
      const { orgId: _orgId, ...toolInput } = input;
      const result = await executor.execute(toolInput as never, {
        toolCallId: `operator:${args.toolName}`,
        messages: [],
      });
      return { result, attachments };
    }

    if (
      args.toolName === "read_client_file" ||
      args.toolName === "attach_client_file"
    ) {
      const input = args.input as Record<string, unknown>;
      const file = await ctx.runQuery(
        internal.clientFiles.getForOperatorInternal,
        {
          operatorUserId: args.operatorUserId,
          clientFileId: input.clientFileId as Id<"clientFiles">,
        },
      );
      if (!file) throw new Error("Client file not found");
      if (args.toolName === "attach_client_file") {
        return {
          result: {
            status: "attached",
            clientFileId: file.clientFileId,
            name: file.name,
          },
          attachments: [
            {
              fileId: file.fileId,
              filename: file.name,
              contentType: file.contentType,
              size: file.size,
            },
          ],
        };
      }
      return {
        result: await readStoredAgentFile(ctx, {
          fileId: file.fileId,
          filename: file.name,
          contentType: file.contentType,
          size: file.size,
        }),
      };
    }

    if (args.toolName === "search_thread_history") {
      const input = args.input as Record<string, unknown>;
      return {
        result: await ctx.runQuery(
          internal.operatorAgent.searchThreadHistoryInternal,
          {
            operatorUserId: args.operatorUserId,
            threadId: args.threadId,
            query: String(input.query),
            limit: typeof input.limit === "number" ? input.limit : undefined,
          },
        ),
      };
    }

    if (args.toolName === "read_thread_attachment") {
      const input = args.input as Record<string, unknown>;
      const attachment = await ctx.runQuery(
        internal.operatorAgent.getThreadAttachmentInternal,
        {
          operatorUserId: args.operatorUserId,
          threadId: args.threadId,
          messageId: input.messageId as Id<"operatorAgentMessages">,
          filename: String(input.filename),
        },
      );
      if (!attachment) throw new Error("Operator thread attachment not found");
      return { result: await readStoredAgentFile(ctx, attachment) };
    }

    throw new Error(`Unsupported operator rich action tool: ${args.toolName}`);
  },
});
