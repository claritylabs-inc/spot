import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";
import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation, type ActionCtx } from "./_generated/server";
import { buildOtpEmail } from "./lib/emailTemplate";
import { getBrandingContext } from "./lib/branding";
import { sendResendEmail, getAuthFromAddress } from "./lib/resend";
import { getAuthSiteUrl } from "./lib/domains";
import { createOrUpdateEmailUser } from "./lib/authEmailIdentity";
import { generateOtpCode } from "./lib/otp";

const rateLimiter = new RateLimiter(components.rateLimiter, {
  codeEmailPerMinute: { kind: "token bucket", rate: 1, period: MINUTE },
  codeEmailPerHour: { kind: "token bucket", rate: 5, period: HOUR },
  codeEmailGlobal: { kind: "token bucket", rate: 500, period: 24 * HOUR },
});

// Throwing rolls back every limit consumed here, so a blocked request costs nothing.
export const consumeCodeEmailRateLimit = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<null> => {
    const key = email.trim().toLowerCase();
    const statuses = [
      await rateLimiter.limit(ctx, "codeEmailPerMinute", { key }),
      await rateLimiter.limit(ctx, "codeEmailPerHour", { key }),
      await rateLimiter.limit(ctx, "codeEmailGlobal"),
    ];
    const retryAfter = Math.max(0, ...statuses.map((s) => s.retryAfter ?? 0));
    if (statuses.some((s) => !s.ok)) {
      throw new ConvexError(
        `Too many code requests. Try again in ${Math.ceil(retryAfter / 1000)} seconds.`,
      );
    }
    return null;
  },
});

const sendVerificationRequest = async function (this: unknown, ...args: any[]) {
  const [{ identifier: email, token }, ctx] = args as [
    { identifier: string; token: string },
    ActionCtx,
  ];
  await ctx.runMutation(internal.auth.consumeCodeEmailRateLimit, { email });
  const branding = getBrandingContext();

  const { html, text } = buildOtpEmail(token, getAuthSiteUrl(), branding);
  const subject = "Your Spot sign-in code";
  const result = await sendResendEmail({
    from: getAuthFromAddress(),
    to: email,
    subject,
    html,
    text,
  });
  if (!result.ok) {
    throw new Error("Failed to send verification email: " + result.error);
  }
};

const ResendOTP = Email({
  id: "resend-otp",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    return generateOtpCode();
  },

  sendVerificationRequest: sendVerificationRequest as any,
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [ResendOTP],
  callbacks: { createOrUpdateUser: createOrUpdateEmailUser },
});
