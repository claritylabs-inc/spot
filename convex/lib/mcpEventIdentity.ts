import { v } from "convex/values";

export type McpEventIdentity =
  | { principalKind: "organization"; userId: string; orgId: string; scopes?: ("read" | "write")[]; tokenId?: string }
  | { principalKind: "operator"; userId: string; operatorRole: "operator" | "owner"; scopes?: ("read" | "write")[]; tokenId?: string };

const scopes = v.optional(v.array(v.union(v.literal("read"), v.literal("write"))));
export const mcpEventIdentityValidator = v.union(
  v.object({ principalKind: v.literal("organization"), userId: v.string(), orgId: v.string(), scopes, tokenId: v.optional(v.string()) }),
  v.object({ principalKind: v.literal("operator"), userId: v.string(), operatorRole: v.union(v.literal("operator"), v.literal("owner")), scopes, tokenId: v.optional(v.string()) }),
);
