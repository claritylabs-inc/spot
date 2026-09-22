import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";
import { buildOtpEmail } from "./lib/emailTemplate";
import { getBrandingContext } from "./lib/branding";
import { sendResendEmail, getAuthFromAddress } from "./lib/resend";
import { getAuthSiteUrl } from "./lib/domains";
import { createOrUpdateEmailUser } from "./lib/authEmailIdentity";
import { generateOtpCode } from "./lib/otp";

const sendVerificationRequest = async function (this: unknown, ...args: any[]) {
  const [{ identifier: email, token }] = args as [
    { identifier: string; token: string },
  ];
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
