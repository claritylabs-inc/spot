import type { DeclarativeToolDefinition } from "@/lib/webmcp/types";

/** Declarative tools on the signup, login, and onboarding forms. */
export const authTools = {
  request_signup_code: {
    surface: "declarative",
    title: "Request signup code",
    description:
      "Start self-serve Spot signup for a business: emails a 6-digit verification code to the given work email. Use this first when creating a new client account; then call verify_signup_code with the code the account owner receives.",
    registeredOn: "/signup/client and /signup (email step)",
    readOnly: false,
    params: {
      email:
        "Work email address of the person who will own the Spot account. The code is sent to this inbox.",
    },
  },
  verify_signup_code: {
    surface: "declarative",
    title: "Verify signup code",
    description:
      "Complete Spot signup by submitting the 6-digit code emailed by request_signup_code. Only use a code supplied by the account owner or read from a mailbox you are authorized to access; never guess. On success Spot opens account setup.",
    registeredOn: "/signup/client and /signup (code step, after request_signup_code)",
    readOnly: false,
    params: {
      code: "The 6-digit verification code from the Spot sign-in email.",
    },
  },
  request_login_code: {
    surface: "declarative",
    title: "Request login code",
    description:
      "Sign in to an existing Spot account: emails a 6-digit verification code to the account's email. Then call verify_login_code.",
    registeredOn: "/login (email step)",
    readOnly: false,
    params: {
      email: "Email address of the existing Spot account.",
    },
  },
  verify_login_code: {
    surface: "declarative",
    title: "Verify login code",
    description:
      "Finish signing in by submitting the 6-digit code emailed by request_login_code. Only use a code supplied by the account owner or read from a mailbox you are authorized to access.",
    registeredOn: "/login (code step, after request_login_code)",
    readOnly: false,
    params: {
      code: "The 6-digit verification code from the Spot sign-in email.",
    },
  },
  submit_user_profile: {
    surface: "declarative",
    title: "Submit your profile",
    description:
      "Onboarding step 1 of 3 for a new client account: saves the signed-in person's name, job title, and optional mobile number. Then call submit_company_profile.",
    registeredOn: "/onboarding/setup (step 1)",
    readOnly: false,
    params: {
      name: "Full name of the signed-in person.",
      title: "Their job title or role at the business, for example Head of Operations.",
      phone:
        "Optional mobile number in international format, for example +14155550123. Enables texting Spot via iMessage. Leave empty if unknown.",
    },
  },
  submit_company_profile: {
    surface: "declarative",
    title: "Submit company profile",
    description:
      "Onboarding step 2 of 3: creates (or updates) the client organization with its legal or trading name and optional website, which Spot uses to research the company. Then call finish_onboarding.",
    registeredOn: "/onboarding/setup (step 2)",
    readOnly: false,
    params: {
      organization_name: "Name of the business Spot will manage insurance for.",
      website: "Optional company website, for example https://example.com.",
    },
  },
  finish_onboarding: {
    surface: "declarative",
    title: "Finish onboarding",
    description:
      "Onboarding step 3 of 3: completes setup and opens the Spot client workspace, where the signed-in insurance tools (list_policies and others) become available.",
    registeredOn: "/onboarding/setup (step 3)",
    readOnly: false,
  },
} satisfies Record<string, DeclarativeToolDefinition>;
