import { buildEmailChangeOtpEmail } from "./emailTemplate";
import { getAuthSiteUrl } from "./domains";
import { getAuthFromAddress, sendAuthCodeEmail } from "./resend";

export const EMAIL_CHANGE_PROVIDER = "resend-otp";
export const EMAIL_CHANGE_TTL_MS = 15 * 60 * 1000;

export function generateEmailChangeCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendEmailChangeVerificationEmail({
  to,
  code,
}: {
  to: string;
  code: string;
}) {
  const { html, text } = buildEmailChangeOtpEmail(code, getAuthSiteUrl());
  return sendAuthCodeEmail(
    {
      from: getAuthFromAddress(),
      to,
      subject: "Confirm your Spot email change",
      html,
      text,
    },
    { retries: 2 },
  );
}
