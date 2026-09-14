import { Id } from "../_generated/dataModel";

export type Scope = "read" | "write";

export interface AuthenticatedRequest {
  userId: Id<"users">;
  orgId: Id<"organizations">;
  scopes: Scope[];
  tokenId: Id<"oauthTokens">;
  requestId: string;
}

export function parseScopesFromToken(scopes: readonly string[]): Scope[] {
  const parsed = scopes.filter((s): s is Scope => isScope(s));
  return parsed.length > 0 ? parsed : ["read"];
}

export function assertScope(scopes: Scope[], required: Scope): void {
  if (!scopes.includes(required)) {
    throw new Error(`insufficient_scope: need ${required}`);
  }
}

export function normalizeRequestedScopes(
  scope: string | null | undefined,
): Scope[] {
  const requested = splitScopeString(scope);
  if (requested.length === 0) return ["read"];

  const scopes: Scope[] = [];
  for (const value of requested) {
    if (!isScope(value)) {
      throw new Error(`invalid_scope: unsupported scope ${value}`);
    }
    if (!scopes.includes(value)) scopes.push(value);
  }
  return scopes;
}

export function stringifyScopes(scopes: Scope[]): string {
  return scopes.join(" ");
}

function splitScopeString(scope: string | null | undefined): string[] {
  return (scope ?? "").trim().split(/\s+/).filter(Boolean);
}

function isScope(value: string): value is Scope {
  return value === "read" || value === "write";
}
