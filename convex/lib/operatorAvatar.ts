import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type OperatorPerson = {
  userId: Id<"users">;
  name: string;
  /** Uploaded photo, else Gravatar (404s when the email has none). */
  avatarUrl: string | null;
};

async function gravatarUrl(email: string | undefined) {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `https://gravatar.com/avatar/${hash}?s=96&d=404`;
}

export async function operatorPerson(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<OperatorPerson> {
  const [user, profile] = await Promise.all([
    ctx.db.get(userId),
    ctx.db
      .query("operatorProfiles")
      .withIndex("user", (q) => q.eq("userId", userId))
      .first(),
  ]);
  const email = user?.email ?? profile?.email;
  const uploaded = profile?.avatarStorageId
    ? await ctx.storage.getUrl(profile.avatarStorageId)
    : null;
  return {
    userId,
    name: user?.name?.trim() || email || "Operator",
    avatarUrl: uploaded ?? (await gravatarUrl(email)),
  };
}

export async function operatorPeople(
  ctx: QueryCtx,
  userIds: Iterable<Id<"users">>,
) {
  const unique = [...new Set(userIds)];
  const people = await Promise.all(
    unique.map((userId) => operatorPerson(ctx, userId)),
  );
  return new Map(people.map((person) => [person.userId, person]));
}
