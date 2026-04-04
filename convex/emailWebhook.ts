import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const webhook = httpAction(async (ctx, request) => {
  const body = await request.json();

  // Only handle inbound emails
  if (body.type !== "email.received") {
    return new Response("ignored", { status: 200 });
  }

  const data = body.data;
  if (!data) {
    return new Response("bad request", { status: 400 });
  }

  const emailId: string = data.email_id || data.id || "";
  const from: string = data.from || "";
  const to: string[] = data.to || [];
  const subject: string = data.subject || "";

  if (!emailId || !from || to.length === 0) {
    console.error("Inbound email missing required fields:", { emailId, from, to });
    return new Response("bad request", { status: 400 });
  }

  // Dedup using webhookLocks (same pattern as messaging webhooks)
  const dedupeId = `email_${emailId}`;
  const { claimed } = await ctx.runMutation(internal.ingest.claimWebhook, {
    openPhoneId: dedupeId,
  });
  if (!claimed) {
    return new Response("duplicate", { status: 200 });
  }

  // Schedule async processing
  await ctx.scheduler.runAfter(0, internal.emailActions.handleInboundEmail, {
    resendEmailId: emailId,
    from,
    to,
    subject,
  });

  return new Response("ok", { status: 200 });
});
