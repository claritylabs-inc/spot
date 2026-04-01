import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const webhook = httpAction(async (ctx, request) => {
  const body = await request.json();

  if (body.type !== "message.received") {
    return new Response("ignored", { status: 200 });
  }

  const message = body.data?.object;
  if (!message || message.direction !== "incoming") {
    return new Response("ignored", { status: 200 });
  }

  const from: string = message.from;
  const text: string = (message.text || "").trim();
  const media: Array<{ url: string; type: string }> = message.media || [];
  const messageId: string = message.id;

  // Phase 1: Claim this webhook — if someone else already claimed it, bail
  const { claimed } = await ctx.runMutation(internal.ingest.claimWebhook, {
    openPhoneId: messageId,
  });
  if (!claimed) {
    return new Response("duplicate", { status: 200 });
  }

  // Phase 2: Now we're guaranteed to be the only handler — process the message
  const result = await ctx.runMutation(internal.ingest.ingestMessage, {
    openPhoneId: messageId,
    from,
    text,
    hasAttachment: media.length > 0,
  });

  if (!result) {
    return new Response("ok", { status: 200 });
  }

  const { userId, state, uploadToken, linqChatId, isNewUser } = result;

  // Route — all async via scheduler
  // Pass linqChatId so process actions can route replies through Linq if available
  if (isNewUser) {
    await ctx.scheduler.runAfter(0, internal.process.sendWelcome, {
      userId,
      phone: from,
      uploadToken,
      linqChatId,
    });
  } else if (state === "awaiting_category") {
    await ctx.scheduler.runAfter(0, internal.process.handleCategorySelection, {
      userId,
      phone: from,
      input: text,
      uploadToken,
      hasAttachment: media.length > 0,
      mediaUrl: media.length > 0 ? media[0].url : undefined,
      mediaType: media.length > 0 ? media[0].type : undefined,
      linqChatId,
    });
  } else if (state === "awaiting_policy") {
    if (media.length > 0) {
      for (const attachment of media) {
        await ctx.scheduler.runAfter(0, internal.process.processPolicy, {
          userId,
          mediaUrl: attachment.url,
          mediaType: attachment.type || "application/pdf",
          phone: from,
          linqChatId,
        });
      }
    } else {
      await ctx.scheduler.runAfter(0, internal.process.nudgeForPolicy, {
        userId,
        phone: from,
        input: text,
        uploadToken,
        linqChatId,
      });
    }
  } else {
    if (media.length > 0) {
      for (const attachment of media) {
        await ctx.scheduler.runAfter(0, internal.process.processPolicy, {
          userId,
          mediaUrl: attachment.url,
          mediaType: attachment.type || "application/pdf",
          phone: from,
          linqChatId,
        });
      }
    } else {
      await ctx.scheduler.runAfter(0, internal.process.handleQuestion, {
        userId,
        question: text,
        phone: from,
        uploadToken,
        linqChatId,
      });
    }
  }

  return new Response("ok", { status: 200 });
});
