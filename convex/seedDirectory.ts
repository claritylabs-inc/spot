import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { upsertOrgWikiDocumentByOperator, readOrgWiki } from "./orgWiki";
import {
  createProcurementOutreachByOperator,
  createProcurementRequestByOperator,
} from "./procurementRequests";

const BROKERS = [
  {
    slug: "northgate-specialty",
    name: "Northgate Specialty",
    website: "https://northgate-specialty.example",
    admin: {
      email: "submissions@northgate-specialty.example",
      name: "Priya Nair",
    },
    states: ["ON", "NY", "TX", "CA"],
    lines: ["CYBER", "EO", "GL"],
  },
  {
    slug: "pinecrest-insurance",
    name: "Pinecrest Insurance Brokers",
    website: "https://pinecrest-insurance.example",
    admin: { email: "quotes@pinecrest-insurance.example", name: "Marcus Hale" },
    states: ["IL", "OH", "MI", "TX"],
    lines: ["AUTO", "GL", "WC", "PROPERTY"],
  },
  {
    slug: "atlas-surplus",
    name: "Atlas Surplus Lines",
    website: "https://atlas-surplus.example",
    admin: { email: "desk@atlas-surplus.example", name: "Elena Ruiz" },
    states: ["FL", "NY", "CA", "WA"],
    lines: ["PROPERTY", "GL", "UMBRELLA", "PRODUCTS"],
  },
] as const;

const CLIENTS = [
  {
    handle: "maple-logistics",
    name: "Maple Logistics",
    website: "https://maple-logistics.example",
    admin: { email: "ops@maple-logistics.example", name: "Dana Whitfield" },
    wiki: "Regional freight carrier with 42 tractors and 60 drivers across Ontario, Michigan, and Ohio. About USD 18 million in annual revenue.",
    requests: [
      {
        title: "Fleet auto and cargo renewal (local fixture)",
        narrative:
          "Renew commercial auto for 42 power units and add motor truck cargo at USD 250,000. Current loss runs show two at-fault claims in the last three years.",
        status: "marketing",
        effective: "2027-01-01",
        outreaches: [
          ["pinecrest-insurance", "can_handle"],
          ["northgate-specialty", "request_sent"],
          ["atlas-surplus", "cannot_handle"],
        ],
      },
      {
        title: "Warehouse property and GL (local fixture)",
        narrative:
          "New 60,000 sq ft warehouse in Windsor. Need property (replacement cost USD 6 million) and general liability.",
        status: "gathering_information",
        effective: "2027-02-01",
        outreaches: [],
      },
    ],
  },
  {
    handle: "brightside-dental",
    name: "Brightside Dental Group",
    website: "https://brightside-dental.example",
    admin: {
      email: "office@brightside-dental.example",
      name: "Dr. Ana Okafor",
    },
    wiki: "Group of five dental clinics in Illinois with 28 clinicians and 70 staff. Roughly USD 14 million in annual revenue.",
    requests: [
      {
        title: "Professional liability and GL package (local fixture)",
        narrative:
          "Package renewal covering professional liability for 28 clinicians, general liability, and a cyber add-on for patient records.",
        status: "proposal_review",
        effective: "2026-12-01",
        outreaches: [
          ["pinecrest-insurance", "quote_received"],
          ["northgate-specialty", "quote_rejected"],
        ],
      },
      {
        title: "Cyber liability add-on (local fixture)",
        narrative:
          "Standalone cyber quote, USD 2 million limit. Draft not yet submitted.",
        status: "draft",
        effective: undefined,
        outreaches: [],
      },
    ],
  },
  {
    handle: "foundry-robotics",
    name: "Foundry Robotics",
    website: "https://foundry-robotics.example",
    admin: { email: "finance@foundry-robotics.example", name: "Sam Lindgren" },
    wiki: "Industrial robotics manufacturer in Austin with 55 employees and USD 22 million in revenue. Sells to US and EU customers.",
    requests: [
      {
        title: "Products liability and umbrella (local fixture)",
        narrative:
          "Products liability at USD 5 million plus USD 10 million umbrella. EU sales are about 30% of revenue.",
        status: "binding",
        effective: "2026-11-15",
        outreaches: [
          ["atlas-surplus", "quote_accepted"],
          ["northgate-specialty", "quote_received"],
        ],
      },
      {
        title: "Prior-year cargo cover (local fixture)",
        narrative: "Superseded request retained to exercise cancelled state.",
        status: "cancelled",
        effective: "2026-03-01",
        outreaches: [["pinecrest-insurance", "cannot_handle"]],
      },
    ],
  },
] as const;

async function upsertUser(
  ctx: MutationCtx,
  email: string,
  name: string,
  now: number,
) {
  const existing = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .first();
  if (existing) return existing._id;
  return await ctx.db.insert("users", {
    email,
    name,
    accountKind: "customer",
    onboardingComplete: true,
    emailVerificationTime: now,
  });
}

async function ensureMembership(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
) {
  const existing = await ctx.db
    .query("orgMemberships")
    .withIndex("organization_user", (q) =>
      q.eq("orgId", orgId).eq("userId", userId),
    )
    .first();
  if (!existing)
    await ctx.db.insert("orgMemberships", { orgId, userId, role: "admin" });
}

export const insert = internalMutation({
  args: { operatorUserId: v.id("users") },
  handler: async (ctx, args) => {
    if (process.env.SPOT_ENV !== "local")
      throw new Error("Seed directory is restricted to SPOT_ENV=local");
    const now = dayjs().valueOf();
    const brokers = new Map<
      string,
      {
        orgId: Id<"organizations">;
        userId: Id<"users">;
        admin: { email: string; name: string };
      }
    >();
    for (const broker of BROKERS) {
      const userId = await upsertUser(
        ctx,
        broker.admin.email,
        broker.admin.name,
        now,
      );
      let org = await ctx.db
        .query("organizations")
        .withIndex("slug", (q) => q.eq("slug", broker.slug))
        .first();
      if (!org) {
        const orgId = await ctx.db.insert("organizations", {
          name: broker.name,
          type: "broker",
          slug: broker.slug,
          website: broker.website,
          onboardingComplete: true,
        });
        org = (await ctx.db.get(orgId))!;
        await ctx.db.insert("brokerProfiles", {
          brokerOrgId: orgId,
          networkStatus: "active",
          writingStates: [...broker.states],
          lineOfBusinessCodes: [...broker.lines],
          createdByUserId: args.operatorUserId,
          updatedByUserId: args.operatorUserId,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("brokerContacts", {
          brokerOrgId: orgId,
          name: broker.admin.name,
          title: "Submissions lead",
          role: "submissions",
          email: broker.admin.email,
          lineOfBusinessCodes: [...broker.lines],
          sources: [],
          sourceKind: "manual",
          revision: 1,
          createdAt: now,
          updatedAt: now,
          updatedByUserId: args.operatorUserId,
        });
      }
      await ensureMembership(ctx, org._id, userId);
      brokers.set(broker.slug, { orgId: org._id, userId, admin: broker.admin });
    }

    let requests = 0;
    for (const client of CLIENTS) {
      const userId = await upsertUser(
        ctx,
        client.admin.email,
        client.admin.name,
        now,
      );
      let org = await ctx.db
        .query("organizations")
        .withIndex("handle", (q) => q.eq("agentHandle", client.handle))
        .first();
      if (!org) {
        const orgId = await ctx.db.insert("organizations", {
          name: client.name,
          type: "client",
          website: client.website,
          agentHandle: client.handle,
          primaryContactName: client.admin.name,
          primaryContactEmail: client.admin.email,
          allowedDomains: [],
          emailVerification: "strict",
          onboardingComplete: true,
          clientAccessStatus: "active",
        });
        org = (await ctx.db.get(orgId))!;
      }
      await ensureMembership(ctx, org._id, userId);
      const wiki = await readOrgWiki(ctx, org._id);
      if (!wiki.body.trim())
        await upsertOrgWikiDocumentByOperator(ctx, {
          operatorUserId: args.operatorUserId,
          orgId: org._id,
          expectedRevision: wiki.revision,
          markdown: `## Company profile\n\n${client.wiki}\n\nSynthetic QA facts, not verified.`,
        });

      for (const request of client.requests) {
        const existing = await ctx.db
          .query("procurementRequests")
          .withIndex("title", (q) =>
            q.eq("clientOrgId", org._id).eq("title", request.title),
          )
          .first();
        if (existing) continue;
        const { requestId } = await createProcurementRequestByOperator(ctx, {
          operatorUserId: args.operatorUserId,
          clientOrgId: org._id,
          source: "operator",
          title: request.title,
          narrative: request.narrative,
          targetEffectiveDate: request.effective,
          status: request.status,
          clientVisible: request.status !== "draft",
        });
        requests += 1;
        for (const [slug, status] of request.outreaches) {
          const broker = brokers.get(slug)!;
          await createProcurementOutreachByOperator(ctx, {
            operatorUserId: args.operatorUserId,
            requestId,
            brokerOrgId: broker.orgId,
            contactUserId: broker.userId,
            contactName: broker.admin.name,
            contactEmail: broker.admin.email,
            status,
            source: "operator",
          });
        }
      }
    }
    return { brokers: brokers.size, clients: CLIENTS.length, requests };
  },
});
