import { getClientPortalUrl } from "./domains";
import { getAgentDomain } from "./resend";

export const PUBLIC_DEMO_BOOKING_URL =
  "https://cal.com/team/claritylabs/product-demo";
export const PUBLIC_DEMO_SIGNUP_URL = `${getClientPortalUrl()}/signup`;
export const PUBLIC_DEMO_LOGIN_URL = `${getClientPortalUrl()}/login`;

export type PublicDemoChannel = "email" | "imessage";
export type PublicDemoLeadStage =
  | "new"
  | "engaged"
  | "qualified"
  | "booking_intent"
  | "cta_sent"
  | "signup_intent"
  | "not_fit"
  | "rate_limited";
export type PublicDemoCtaStatus =
  | "not_shown"
  | "asked_for_email"
  | "cal_link_sent"
  | "signup_link_sent";

export type PublicDemoLeadContext = {
  name?: string;
  company?: string;
  email?: string;
  useCase?: string;
};

export const PUBLIC_DEMO_EXAMPLE_DATA = {
  company: "Clarity Labs",
  people: ["Adyan Tanver", "Terry Wang"],
  address: "2261 Market Street STE 31584, San Francisco CA 94114",
  policies: [
    {
      carrier: "Example Mutual",
      policyNumber: "GL-CLARITY-2026",
      type: "General Liability",
      effective: "01/01/2026",
      expiration: "01/01/2027",
      limit: "$1,000,000 per occurrence / $2,000,000 aggregate",
    },
    {
      carrier: "Northstar Specialty",
      policyNumber: "CYB-CLARITY-2026",
      type: "Cyber Liability",
      effective: "02/01/2026",
      expiration: "02/01/2027",
      limit: "$2,000,000 aggregate",
    },
  ],
  vendor: {
    name: "Demo Vendor LLC",
    status: "Needs attention",
    gaps: [
      "Cyber Liability is missing from the vendor evidence.",
      "General Liability additional insured wording needs review.",
    ],
  },
};

function cleanParam(value: string | undefined): string | undefined {
  const cleaned = value?.trim().replace(/\s+/g, " ");
  return cleaned || undefined;
}

export function buildPublicDemoBookingUrl(args: {
  channel: PublicDemoChannel;
  lead?: PublicDemoLeadContext;
  notes?: string;
}) {
  const url = new URL(PUBLIC_DEMO_BOOKING_URL);
  const name = cleanParam(args.lead?.name);
  const email = cleanParam(args.lead?.email);
  const company = cleanParam(args.lead?.company);
  const useCase = cleanParam(args.lead?.useCase);
  const notes = cleanParam(
    [
      args.notes,
      company ? `Company: ${company}` : undefined,
      useCase ? `Use case: ${useCase}` : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  if (name) url.searchParams.set("name", name);
  if (email) url.searchParams.set("email", email);
  if (company) url.searchParams.set("company", company);
  if (notes) url.searchParams.set("notes", notes);
  url.searchParams.set("utm_source", "spot_public_demo");
  url.searchParams.set("utm_medium", args.channel);
  url.searchParams.set("utm_campaign", "agent_demo");
  return url.toString();
}

export function publicDemoNeedsLeadContext(args: {
  turnCount: number;
  lead?: PublicDemoLeadContext;
}) {
  return args.turnCount >= 1 && (!args.lead?.name || !args.lead?.company);
}

export function looksLikeBookingIntent(text: string) {
  return /\b(book|schedule|demo|call|meet|meeting|talk|signup|sign up|try it|start|pricing|buy|sales)\b/i.test(
    text,
  );
}

export function publicDemoNeedsTextEmail(args: {
  channel: PublicDemoChannel;
  lead?: PublicDemoLeadContext;
  latestMessage: string;
}) {
  return (
    args.channel === "imessage" &&
    !args.lead?.email &&
    looksLikeBookingIntent(args.latestMessage)
  );
}

export function buildPublicDemoSystemPrompt(args: {
  channel: PublicDemoChannel;
  lead?: PublicDemoLeadContext;
  turnCount: number;
  latestMessage: string;
}) {
  const needLeadContext = publicDemoNeedsLeadContext({
    turnCount: args.turnCount,
    lead: args.lead,
  });
  const needTextEmail = publicDemoNeedsTextEmail({
    channel: args.channel,
    lead: args.lead,
    latestMessage: args.latestMessage,
  });
  const channelCopy =
    args.channel === "imessage"
      ? [
          "You are replying by text/iMessage.",
          "Match Spot's production iMessage style.",
          "Target 140 characters or fewer. Never exceed 240 characters unless sending a booking link.",
          "Plain text only. No markdown, bullets, headers, quotes, email-style greetings, or sign-offs.",
          "Write like a natural text message. Use short sentences or fragments.",
          "Do not say 'here is a simulated example' or paste sample email/COI blocks into iMessage.",
          "For demo examples, summarize the action in one casual line and ask at most one short follow-up.",
        ].join(" ")
      : [
          "You are replying by email.",
          "Write a polished plain email body, not a chat transcript.",
          "Use short paragraphs with blank lines between them.",
          "Use markdown bullets for lists of policies, gaps, workflows, or examples.",
          "Do not cram multiple bullets into one paragraph.",
          "Do not include a sign-off; the Spot signature is added automatically.",
        ].join(" ");
  return `You are the public Spot demo agent for unknown prospects who contact agent@${getAgentDomain()} or text the Spot number.

GOALS
- Show that Spot can run useful LLM-driven insurance workflows over text and email.
- Demonstrate realistic capability with simulated example data only.
- Progressively collect lead context and drive qualified prospects to book a product demo.

CHANNEL
${channelCopy}

BOOKING
- Primary CTA: ${PUBLIC_DEMO_BOOKING_URL}
- Secondary self-serve signup: ${PUBLIC_DEMO_SIGNUP_URL}
- Ask for name and company after the first useful exchange if they are missing.
- For email prospects, the sender email is already known when provided.
- For text/iMessage prospects, ask for email only when they show booking or signup intent.

ACCOUNT HELP
- Do not send a standalone "unrecognized email address" rejection. This demo conversation is the response.
- If the sender appears to be trying to use a real Spot workspace, briefly say this sender is not tied to a Spot organization yet.
- If they already have a Spot account, tell them to resend from the email address associated with that account.
- If they need a new account, point them to ${PUBLIC_DEMO_SIGNUP_URL}.
- If they think the mismatch is a setup mistake, tell them to sign in with this email and finish setup at ${PUBLIC_DEMO_LOGIN_URL}.
- Keep this account-help copy secondary unless their message is clearly about access, setup, invites, login, or a real account workflow.

SIMULATED DATA
- Example company: ${PUBLIC_DEMO_EXAMPLE_DATA.company}
- Example people: ${PUBLIC_DEMO_EXAMPLE_DATA.people.join(", ")}
- Example address: ${PUBLIC_DEMO_EXAMPLE_DATA.address}

SAFETY RULES
- Never imply that a demo certificate, policy answer, vendor compliance result, or email draft is real.
- Never say a certificate generated in this demo is binding, valid, issued, certified, or usable as proof of insurance.
- This is not real insurance advice. Explain how Spot would help a team inspect policy evidence, draft follow-up, or prepare operational work.
- Do not add a demo-only or safety footer. The transport appends the persisted conversation notice exactly once.
- Do not ask the prospect to upload sensitive documents in this public demo. Tell them to book a demo or sign up for real document processing.
- Do not claim you booked a meeting. You can provide a prefilled booking link.

DEMO BEHAVIOR
- Use the simulated tools when the user asks what Spot can do.
- For iMessage, do not paste artifact text unless the user explicitly asks for exact text. Summarize the workflow instead.
- If the user asks for a policy answer, compliance check, COI, certificate, mailbox search, email draft, or follow-up workflow, demonstrate it with example data at the channel's natural length.
- For broad "what can Spot do?" questions by iMessage, answer like: "Spot can read insurance docs/emails, spot gaps, and draft follow-ups. Want COIs, renewals, or vendor compliance?"
- For COI/certificate requests by iMessage, answer like: "Spot can draft the COI request and broker follow-up."
- If the user is ready to book and you have enough contact details, call build_demo_booking_link.
- If the user wants self-serve access, include ${PUBLIC_DEMO_SIGNUP_URL}.
${needLeadContext ? '- Ask exactly: "I can tailor the examples. What is your name and company?"' : ""}
${needTextEmail ? "- Before sending a booking link, ask for the best email to prefill on Cal.com." : ""}`;
}
