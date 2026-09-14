/// <reference types="vite/client" />
import dayjs from "dayjs";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { resolveEmailAgentIdentity } from "./lib/emailIdentity";
import { getAgentRecipientAddresses } from "./lib/resend";
import { getPublicAgentDomain } from "../lib/domains";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

test("stale frontend and backend configuration uses the receiving subdomain while old replies remain recognizable", () => {
  vi.stubEnv("AGENT_EMAIL_DOMAIN", "spot.insure");
  vi.stubEnv("NEXT_PUBLIC_AGENT_DOMAIN", "spot.insure");
  vi.stubEnv("LEGACY_AGENT_DOMAINS", "dev.claritylabs.inc");
  expect(resolveEmailAgentIdentity({ agentHandle: "acme" })).toMatchObject({
    agentAddress: "acme@agent.spot.insure",
    fromHeader: "Spot <acme@agent.spot.insure>",
  });
  expect(getPublicAgentDomain()).toBe("agent.spot.insure");
  expect(getAgentRecipientAddresses("acme", "renewal")).toEqual(
    expect.arrayContaining([
      "acme+renewal@spot.insure",
      "acme+renewal@agent.spot.insure",
    ]),
  );
});

test("existing threads display the new reply address and accept either domain without replacing their identity", async () => {
  const t = convexTest(schema, modules);
  const { userId, threadId } = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme",
      type: "client",
      agentHandle: "acme",
    });
    const userId = await ctx.db.insert("users", { email: "owner@acme.example" });
    await ctx.db.insert("orgMemberships", { orgId, userId, role: "admin" });
    const threadId = await ctx.db.insert("threads", {
      orgId,
      createdBy: userId,
      title: "Renewal",
      threadEmail: "acme+renewal@spot.insure",
      lastMessageAt: dayjs().valueOf(),
    });
    return { userId, threadId };
  });
  const user = t.withIdentity({ subject: userId });
  expect(await user.query(api.threads.get, { id: threadId })).toMatchObject({
    threadEmail: "acme+renewal@agent.spot.insure",
  });
  for (const threadEmail of [
    "acme+renewal@agent.spot.insure",
    "acme+renewal@spot.insure",
  ]) {
    expect(await t.query(internal.threads.findByEmail, { threadEmail })).toMatchObject({
      _id: threadId,
    });
  }
  const newThreadId = await user.mutation(api.threads.create, { agentDomain: "spot.insure" });
  expect((await user.query(api.threads.get, { id: newThreadId }))?.threadEmail).toMatch(
    /^acme\+[a-z0-9]+@agent\.spot\.insure$/,
  );
});


test.each(["spot.insure", "agent.spot.insure"])(
  "rejects duplicate thread replies across aliases or the same %s domain",
  async (secondDomain) => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", { name: "Acme", type: "client" });
      const userId = await ctx.db.insert("users", { email: "owner@acme.example" });
      for (const domain of ["spot.insure", secondDomain]) {
        await ctx.db.insert("threads", {
          orgId,
          createdBy: userId,
          title: "Renewal",
          threadEmail: `acme+renewal@${domain}`,
          lastMessageAt: dayjs().valueOf(),
        });
      }
    });
    for (const threadEmail of [
      "acme+renewal@spot.insure",
      "acme+renewal@agent.spot.insure",
    ]) {
      await expect(t.query(internal.threads.findByEmail, { threadEmail })).rejects.toThrow(
        "Thread reply address is ambiguous.",
      );
    }
  },
);
