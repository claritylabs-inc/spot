import {
  operatorNotificationCategoryValidator,
  operatorNotificationTargetValidator,
  operatorNotificationStatusValidator,
} from "./lib/operatorNotificationTypes";
import { clientAccessStatusValidator } from "./lib/clientAccess";
import {
  informationScopeValidator,
  informationRequirementStatus,
  informationResponseValidator,
  informationFormQuestionValidator,
  informationExtractionQuestionValidator,
  informationEmailAnswerValidator,
} from "./lib/procurementInformationSchema";
import { followupQuestionValidator } from "./lib/intakeFollowupSchema";
import { brokerContactFields } from "./lib/brokerContactFields";
import {
  operatorPlanningAssessmentValidator,
  operatorExecutionPlanValidator,
} from "./lib/operatorRunPlan";
import {
  intakeBusinessProfileValidator,
  requestIntakeFields,
} from "./lib/insuranceIntakeSchema";
import { chatPresentationValidator } from "./lib/chatPresentationValidators";
import { routingSelectionValidator } from "./lib/extractionTraceRouterFields";
import { markdownDocumentTables } from "./lib/markdownDocumentSchema";
import { companyResearchValidator } from "./lib/companyResearch";
import { routerJobFailureValidator } from "./lib/routerJobFailure";
import { messageActivityValidator } from "./lib/messageActivity";
import { slackStoredAttachmentValidator } from "./lib/slackAttachments";
import {
  activeNotificationTypeValidator,
  notificationActionTypeValidator,
  notificationActionPayloadValidator,
  notificationSourceRefValidator,
} from "./lib/notificationTypes";
import { proposalReviewFindingValidator } from "./lib/proposalReview";
import { completionOutcomeValidator } from "./lib/procurementCompletionOutcome";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { pipelineFields } from "@claritylabs/cl-pipelines/convex";
import { acordTaxonomyBackfillReportValidator } from "./lib/acordTaxonomyBackfillReport";
import { agentStepsValidator } from "./lib/agentSteps";
import { toolPreviewItemValidator } from "./lib/toolResultPreview";
import { policyProductIdentityValidator } from "./lib/policyProductIdentity";
import { certificateRequirementSnapshotValidator } from "./lib/certificateRequirementPlan";
import {
  websiteTechDisclosureValidator,
  websiteTechBrowseValidator,
  websiteTechInferenceValidator,
  websiteTechSignalValidator,
} from "./lib/websiteTech";
import {
  companyInformationProfileValidator,
  companyInformationOrganizationFactValidator,
} from "./lib/companyInformationExtraction";
import {
  emailContentValidator,
  operatorEmailContentValidator,
  pendingEmailAttachmentKindValidator,
  pendingEmailAttachmentValidator,
  threadMessageKindValidator,
} from "./lib/threadMessageValidators";
import {
  operatorToolActionConfirmationPayloadValidator,
  threadActionActorValidator,
  threadActionConfirmationPayloadValidator,
  threadActionConfirmationStatusValidator,
} from "./lib/threadActionConfirmationValidators";
import {
  operatorGoogleWorkspaceMailboxModeValidator,
  storedOperatorGoogleWorkspaceVerificationValidator,
} from "./lib/googleWorkspaceValidators";

// Provider ids are cl-router data (GET /v1/capabilities), not a Spot enum.
const modelProviderValidator = v.string();

const modelRouteValidator = v.object({
  provider: modelProviderValidator,
  model: v.string(),
});

const extractionTraceRoutingValidator = v.object({
  decision: v.string(),
  attemptCount: v.optional(v.number()),
  primitive: v.optional(v.string()),
  difficulty: v.optional(
    v.union(
      v.literal("simple"),
      v.literal("standard"),
      v.literal("complex"),
      v.null(),
    ),
  ),
  requiredTier: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3))),
  selectedTier: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3))),
  route: v.optional(modelRouteValidator),
  source: v.optional(v.string()),
  // Legacy router-owned selection fields remain readable for stored traces.
  candidatesConsidered: v.optional(v.array(modelRouteValidator)),
  policyVersion: v.optional(v.union(v.string(), v.null())),
  cacheStickinessApplied: v.optional(v.boolean()),
  routeSource: v.optional(v.string()),
  shadowMode: v.optional(v.boolean()),
  wouldHaveChosen: v.optional(
    v.object({
      provider: modelProviderValidator,
      model: v.string(),
      decision: v.string(),
    }),
  ),
  wouldHaveMatched: v.optional(v.boolean()),
  selection: v.optional(routingSelectionValidator),
});

// Stored modes may name a native provider from older settings;
// modelSettings.normalizeWebRetrieval maps those to model_default.
const webRetrievalProviderValidator = v.string();

const webRetrievalValidator = v.object({
  primary: webRetrievalProviderValidator,
  route: v.optional(modelRouteValidator),
});

const orgRoleValidator = v.union(v.literal("admin"), v.literal("member"));

const operatorInitiatedMessageValidator = v.object({
  operatorUserId: v.id("users"),
  operatorEmail: v.optional(v.string()),
  operatorName: v.optional(v.string()),
  impersonationSessionId: v.id("operatorImpersonationSessions"),
  targetOrgId: v.id("organizations"),
  targetOrgName: v.string(),
  targetRole: orgRoleValidator,
  displayLabel: v.string(),
  initiatedAt: v.number(),
});

const pipelineStatusValidator = v.union(
  v.literal("idle"),
  v.literal("running"),
  v.literal("paused"),
  v.literal("complete"),
  v.literal("error"),
);

const extractionDataStageValidator = v.union(
  v.literal("placeholder"),
  v.literal("preview"),
  v.literal("final"),
);

const notificationChannelValidator = v.union(
  // Legacy preference rows can contain in_app. In-app notifications are now
  // always created for supported events and are not a user-configurable channel.
  v.literal("in_app"),
  v.literal("email"),
  v.literal("imessage"),
);

const connectedEmailAutomationValidator = v.object({
  policyImports: v.boolean(),
  requirementImports: v.boolean(),
  companyMemory: v.boolean(),
});

const certificateSourceValidator = v.union(
  v.literal("policy_page"),
  v.literal("chat"),
  v.literal("email"),
  v.literal("imessage"),
  v.literal("slack"),
  v.literal("sms"),
  v.literal("api"),
  v.literal("mcp"),
  v.literal("agent"),
  v.literal("unknown"),
);

const certificateHolderAddressValidator = v.object({
  line1: v.optional(v.string()),
  line2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  country: v.optional(v.string()),
  formatted: v.optional(v.string()),
});

const orgMailingAddressValidator = v.object({
  street1: v.optional(v.string()),
  street2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  zip: v.optional(v.string()),
  country: v.optional(v.string()),
  formatted: v.optional(v.string()),
});

const policyDetailPartyValidator = v.object({
  name: v.string(),
  address: orgMailingAddressValidator,
});

const carrierIdentityValidator = v.object({
  displayName: v.string(),
  sourceName: v.optional(v.string()),
  operatingName: v.optional(v.string()),
  publicNameRelationship: v.optional(
    v.union(
      v.literal("same_legal_entity"),
      v.literal("trading_name"),
      v.literal("parent_brand"),
      v.literal("group_brand"),
    ),
  ),
  legalEntities: v.array(
    v.object({
      name: v.string(),
      sourceNodeIds: v.array(v.string()),
      sourceSpanIds: v.array(v.string()),
    }),
  ),
  legalEntityRelationship: v.union(
    v.literal("single"),
    v.literal("and"),
    v.literal("or"),
    v.literal("and_or"),
    v.literal("unspecified"),
  ),
  sourceNodeIds: v.array(v.string()),
  sourceSpanIds: v.array(v.string()),
  branding: v.optional(
    v.object({
      website: v.string(),
      websiteTitle: v.optional(v.string()),
      iconStorageId: v.optional(v.id("_storage")),
      accentColor: v.optional(v.string()),
      accentColorSource: v.optional(
        v.union(
          v.literal("favicon"),
          v.literal("theme_meta"),
          v.literal("stylesheet"),
          v.literal("html"),
        ),
      ),
      confidence: v.union(
        v.literal("high"),
        v.literal("medium"),
        v.literal("low"),
      ),
      sourceUrls: v.array(v.string()),
      enrichmentVersion: v.number(),
      updatedAt: v.number(),
    }),
  ),
});

const policyDetailOverridesValidator = v.object({
  operationsDescription: v.optional(v.string()),
  insured: v.optional(
    v.object({
      name: v.string(),
      address: orgMailingAddressValidator,
      additionalNamedInsureds: v.array(v.string()),
    }),
  ),
  producer: v.optional(
    v.object({
      name: v.string(),
      address: orgMailingAddressValidator,
      contactName: v.string(),
      licenseNumber: v.string(),
      phone: v.string(),
      email: v.string(),
    }),
  ),
  insurer: v.optional(
    v.object({
      name: v.string(),
      address: orgMailingAddressValidator,
      naicNumber: v.string(),
    }),
  ),
  generalAgent: v.optional(
    v.object({
      name: v.string(),
      address: orgMailingAddressValidator,
      licenseNumber: v.string(),
    }),
  ),
  // Read compatibility for overrides saved before General Agent nomenclature.
  // Deprecated (legacy policies): remove after reextractLegacyPolicies has run.
  mga: v.optional(policyDetailPartyValidator),
});

const organizationProfileOverridesValidator = v.object({
  namedInsured: v.optional(v.string()),
  mailingAddress: v.optional(orgMailingAddressValidator),
  dba: v.optional(v.string()),
  entityType: v.optional(
    v.union(
      v.literal(""),
      v.literal("sole_proprietorship"),
      v.literal("partnership"),
      v.literal("corporation"),
      v.literal("s_corporation"),
      v.literal("limited_liability_company"),
      v.literal("trust_estate"),
      v.literal("tax_exempt_organization"),
      v.literal("government_entity"),
      v.literal("other"),
    ),
  ),
  taxId: v.optional(v.string()),
  fein: v.optional(v.string()),
  businessNumber: v.optional(v.string()),
  operationsDescription: v.optional(v.string()),
  additionalNamedInsureds: v.optional(v.array(v.string())),
});

const policyOrgProfileFactSourceValidator = v.object({
  policyId: v.id("policies"),
  fieldPath: v.string(),
  fieldGroup: v.string(),
  displayValue: v.string(),
  normalizedValue: v.string(),
  valueKind: v.union(
    v.literal("string"),
    v.literal("number"),
    v.literal("date"),
    v.literal("money"),
    v.literal("address"),
    v.literal("list"),
    v.literal("unknown"),
  ),
  sourceNodeIds: v.optional(v.array(v.string())),
  sourceSpanIds: v.optional(v.array(v.string())),
  effectiveDate: v.optional(v.string()),
  expirationDate: v.optional(v.string()),
  policyYear: v.optional(v.number()),
  observedAt: v.number(),
});

const companyInformationProfileFactSourceValidator = v.object({
  sourceKind: v.union(
    v.literal("client_file"),
    v.literal("procurement_email_thread"),
  ),
  sourceRef: v.string(),
  clientFileId: v.optional(v.id("clientFiles")),
  teamEmailThreadId: v.optional(v.id("teamEmailThreads")),
  fieldPath: v.string(),
  fieldGroup: v.string(),
  displayValue: v.string(),
  normalizedValue: v.string(),
  valueKind: v.union(
    v.literal("string"),
    v.literal("address"),
    v.literal("list"),
  ),
  evidence: v.string(),
  confidence: v.number(),
  observedAt: v.number(),
});

const orgProfileFactSourceValidator = v.union(
  policyOrgProfileFactSourceValidator,
  companyInformationProfileFactSourceValidator,
);

const orgProfileScalarFactValidator = v.object({
  value: v.string(),
  source: orgProfileFactSourceValidator,
});

const orgProfileAddressFactValidator = v.object({
  value: orgMailingAddressValidator,
  source: orgProfileFactSourceValidator,
});

const policyVersionKindValidator = v.union(
  v.literal("new_policy"),
  v.literal("policy_change"),
  v.literal("re_extraction"),
  v.literal("renewal"),
);

const certificateParentStatusValidator = v.union(
  v.literal("active"),
  v.literal("inactive"),
  v.literal("archived"),
);

const certificateVersionStatusValidator = v.union(
  v.literal("draft"),
  v.literal("issued"),
  v.literal("superseded"),
  v.literal("void"),
);

const certificateRequestKindValidator = v.union(
  v.literal("holder"),
  v.literal("additional_insured"),
);

const certificateFormCodeValidator = v.union(
  v.literal("acord25"),
  v.literal("acord24"),
  v.literal("acord27"),
  v.literal("acord28"),
  v.literal("acord29"),
  v.literal("acord30"),
  v.literal("acord31"),
);

const certificateEmailDraftValidator = v.object({
  subject: v.string(),
  body: v.string(),
  recipientEmail: v.optional(v.string()),
  recipientName: v.optional(v.string()),
});

const certificateHolderRelationshipKindValidator = v.union(
  v.literal("additional_insured"),
  v.literal("loss_payee"),
  v.literal("mortgagee"),
  v.literal("allowed_holder"),
);

export default defineSchema({
  ...authTables,
  ...markdownDocumentTables,

  // Override default users table with custom profile fields
  users: defineTable({
    // Auth-managed fields
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    accountKind: v.optional(
      v.union(v.literal("customer"), v.literal("operator")),
    ),
    serviceAccountKind: v.optional(v.literal("slack")),
    streamResponses: v.optional(v.boolean()),
    showThinking: v.optional(v.boolean()),
    agentDockPlacement: v.optional(v.union(v.literal("bottom"), v.literal("right"))),
    intakeRestricted: v.optional(v.boolean()),
    // Personal profile fields
    title: v.optional(v.string()),
    // Onboarding & admin
    onboardingComplete: v.optional(v.boolean()),
    isAdmin: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  userEmailChangeRequests: defineTable({
    targetUserId: v.id("users"),
    requestedByUserId: v.id("users"),
    oldEmail: v.optional(v.string()),
    newEmail: v.string(),
    codeHash: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("cancelled"),
      v.literal("expired"),
    ),
    requestedAt: v.number(),
    expiresAt: v.number(),
    confirmedAt: v.optional(v.number()),
    confirmedByUserId: v.optional(v.id("users")),
    cancelledAt: v.optional(v.number()),
    cancelledByUserId: v.optional(v.id("users")),
  })
    .index("target_status", ["targetUserId", "status"])
    .index("email_status", ["newEmail", "status"])
    .index("requester", ["requestedByUserId"]),

  // Organizations — owns company data, agent, broker info
  organizations: defineTable({
    intakeBusinessProfile: v.optional(intakeBusinessProfileValidator),
    // One representation grant per client; requests only reference its shared file.
    intakeAuthorizationId: v.optional(v.id("requestIntakeAuthorizations")),
    clientAccessStatus: v.optional(clientAccessStatusValidator),
    // Operator responsible for this client.
    assignedOperatorUserId: v.optional(v.id("users")),
    // Unsubmitted intake draft that created this client; its identity follows the draft until submission.
    intakeDraftRequestId: v.optional(v.id("procurementRequests")),
    name: v.string(),
    deletedAt: v.optional(v.number()),
    deletedByUserId: v.optional(v.id("users")),
    website: v.optional(v.string()),
    companyResearch: v.optional(companyResearchValidator),
    smokeMarker: v.optional(v.string()),
    // Deprecated: cleared by the removed removeCompanyDetails migration; no active writers.
    industry: v.optional(v.string()),
    industryVertical: v.optional(v.string()),
    mailingAddress: v.optional(orgMailingAddressValidator),
    profileFacts: v.optional(
      v.object({
        namedInsured: v.optional(orgProfileScalarFactValidator),
        mailingAddress: v.optional(orgProfileAddressFactValidator),
        dba: v.optional(orgProfileScalarFactValidator),
        entityType: v.optional(orgProfileScalarFactValidator),
        taxId: v.optional(orgProfileScalarFactValidator),
        fein: v.optional(orgProfileScalarFactValidator),
        businessNumber: v.optional(orgProfileScalarFactValidator),
        operationsDescription: v.optional(orgProfileScalarFactValidator),
        additionalNamedInsureds: v.optional(
          v.array(orgProfileScalarFactValidator),
        ),
      }),
    ),
    profileFactsUpdatedAt: v.optional(v.number()),
    profileOverrides: v.optional(organizationProfileOverridesValidator),
    profileOverridesUpdatedAt: v.optional(v.number()),
    profileOverridesUpdatedByUserId: v.optional(v.id("users")),
    relatedLegalEntities: v.optional(
      v.array(
        v.object({
          legalName: v.string(),
          source: v.optional(v.literal("extraction")),
          relationship: v.optional(
            v.union(
              v.literal("current"),
              v.literal("fka"),
              v.literal("dba"),
              v.literal("subsidiary"),
              v.literal("parent"),
              v.literal("affiliate"),
              v.literal("other"),
            ),
          ),
          incorporationNumber: v.optional(v.string()),
          taxId: v.optional(v.string()),
          jurisdiction: v.optional(v.string()),
        }),
      ),
    ),
    // Client-org verification: which sender emails/domains count as "this client"
    // when routing inbound email sent to the broker's agent handle.
    allowedEmails: v.optional(v.array(v.string())),
    allowedDomains: v.optional(v.array(v.string())),
    emailVerification: v.optional(
      v.union(v.literal("strict"), v.literal("domain"), v.literal("open")),
    ),
    // Agent
    agentHandle: v.optional(v.string()),
    // Primary insurance contact for the org
    primaryInsuranceContactId: v.optional(v.id("users")),
    // Agent settings
    chatEmailNotifications: v.optional(v.boolean()), // send email notifications for chat responses in email threads
    bccRequesterOnAgentEmails: v.optional(v.boolean()), // default true: BCC requesting team member on outbound agent emails
    emailSendDelay: v.optional(v.number()), // seconds before sending emails (default 5, 0 = instant)
    featureFlags: v.optional(v.record(v.string(), v.boolean())),
    // Onboarding
    onboardingComplete: v.optional(v.boolean()),
    // Branding
    iconStorageId: v.optional(v.id("_storage")),
    // Dual-org: org type discriminator
    type: v.optional(v.union(v.literal("broker"), v.literal("client"))),
    // Set on client orgs only — ID of the managing broker org
    brokerOrgId: v.optional(v.id("organizations")),
    // Legacy organization invitation metadata; not the client lifecycle.
    // Current invitation and activation state belongs to team members.
    inviteStatus: v.optional(v.union(v.literal("draft"), v.literal("invited"))),
    // Draft/invite contact details captured by broker before the client accepts.
    primaryContactName: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    primaryContactPhone: v.optional(v.string()),
    inviteCustomMessage: v.optional(v.string()),
    // Broker user who created the draft.
    draftCreatedByUserId: v.optional(v.id("users")),
    // Broker slug for URLs, [a-z0-9-]{3,40}, unique
    slug: v.optional(v.string()),
    // Broker branding
    whiteLabelingEnabled: v.optional(v.boolean()),
    brandingColor: v.optional(v.string()), // hex e.g. "#4F46E5"
    brandingMode: v.optional(v.union(v.literal("light"), v.literal("dark"))),
    brandingTextOnAccent: v.optional(
      v.union(v.literal("light"), v.literal("dark"), v.literal("auto")),
    ),
    agentDisplayName: v.optional(v.string()),
  })
    // Deprecated: workspace scan removed; drop after data cleanup.
    .index("scan_contact", ["primaryContactEmail"])
    .index("name", ["name"])
    .index("handle", ["agentHandle"])
    .index("type", ["type"])
    .index("deletion_type", ["deletedAt", "type"])
    .index("broker", ["brokerOrgId"])
    .index("slug", ["slug"]),

  // Org memberships — links users to orgs
  orgMemberships: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
  })
    .index("user", ["userId"])
    .index("organization", ["orgId"])
    .index("organization_user", ["orgId", "userId"]),

  // Best-effort public tech-stack scan keyed by website hostname; shared by
  // intake drafts and organizations and never gates any workflow.
  websiteTechProfiles: defineTable({
    domain: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    runId: v.optional(v.string()),
    signals: v.array(websiteTechSignalValidator),
    disclosures: v.array(websiteTechDisclosureValidator),
    inferences: v.optional(v.array(websiteTechInferenceValidator)),
    browse: v.optional(websiteTechBrowseValidator),
    error: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("domain", ["domain"]),

  // Supply-side broker directory data. A profile may exist without portal
  // users; portal access remains represented exclusively by orgMemberships.
  // Per-run research inbox addresses on the research email domain, with a hashed capability token
  // the browser agent uses to read verification emails. Expired rows are inert.
  researchInboxes: defineTable({
    address: v.string(),
    tokenHash: v.string(),
    expiresAt: v.number(),
  })
    .index("address", ["address"])
    .index("token", ["tokenHash"]),
  researchInboxEmails: defineTable({
    address: v.string(),
    resendEmailId: v.string(),
    from: v.string(),
    subject: v.string(),
    receivedAt: v.number(),
  })
    .index("address", ["address", "receivedAt"])
    .index("resend_email", ["resendEmailId"]),

  companyResearchEvents: defineTable({
    orgId: v.id("organizations"),
    fingerprint: v.string(),
    status: v.union(
      v.literal("completed"),
      v.literal("partial"),
      v.literal("failed"),
    ),
    sourceCount: v.number(),
    unresolvedFields: v.array(v.string()),
    createdAt: v.number(),
  }).index("organization", ["orgId", "createdAt"]),

  brokerContacts: defineTable({
    brokerOrgId: v.id("organizations"),
    ...brokerContactFields,
    // At most one live contact per provider; outreach addresses it first.
    primary: v.optional(v.boolean()),
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    updatedByUserId: v.id("users"),
    researchedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_brokerOrgId_and_deletedAt", ["brokerOrgId", "deletedAt"])
    .index("by_email_and_deletedAt", ["email", "deletedAt"]),

  brokerProfiles: defineTable({
    manualFields: v.optional(
      v.array(
        v.union(
          v.literal("writingStates"),
          v.literal("lineOfBusinessCodes"),
          v.literal("officeAddress"),
        ),
      ),
    ),
    brokerOrgId: v.id("organizations"),
    // Marks a provider as a test one: the only kind a client in test mode can reach.
    isTest: v.optional(v.boolean()),
    networkStatus: v.union(
      v.literal("prospect"),
      v.literal("active"),
      v.literal("inactive"),
      v.literal("blacklisted"),
    ),
    officeAddress: v.optional(
      v.object({
        street1: v.optional(v.string()),
        street2: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        postalCode: v.optional(v.string()),
        country: v.optional(v.string()),
      }),
    ),
    writingCountries: v.optional(v.array(v.string())),
    nationwideCountries: v.optional(v.array(v.string())),
    excludedStates: v.optional(v.array(v.string())),
    writingStates: v.array(v.string()),
    lineOfBusinessCodes: v.array(v.string()),
    createdByUserId: v.optional(v.id("users")),
    updatedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("broker", ["brokerOrgId"])
    .index("status", ["networkStatus", "updatedAt"]),

  // Internal official-site lookup cache. Consumer-facing identity and
  // branding are persisted together on policies.carrierIdentity.
  carrierBrands: defineTable({
    normalizedName: v.string(),
    carrierName: v.string(),
    publicName: v.optional(v.string()),
    nameRelationship: v.optional(
      v.union(
        v.literal("same_legal_entity"),
        v.literal("trading_name"),
        v.literal("parent_brand"),
        v.literal("group_brand"),
      ),
    ),
    website: v.string(),
    websiteTitle: v.optional(v.string()),
    iconStorageId: v.optional(v.id("_storage")),
    accentColor: v.optional(v.string()),
    accentColorSource: v.optional(
      v.union(
        v.literal("favicon"),
        v.literal("theme_meta"),
        v.literal("stylesheet"),
        v.literal("html"),
      ),
    ),
    confidence: v.union(
      v.literal("high"),
      v.literal("medium"),
      v.literal("low"),
    ),
    sourceUrls: v.array(v.string()),
    enrichmentVersion: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("name", ["normalizedName"]),

  // Deprecated (legacy policies): remove after reextractLegacyPolicies has run.
  carrierIdentityBackfillResults: defineTable({
    policyId: v.id("policies"),
    outcome: v.union(
      v.literal("pending"),
      v.literal("rebuilt"),
      v.literal("unchanged"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
    reason: v.optional(v.string()),
    shouldEnrich: v.boolean(),
    updatedAt: v.number(),
  })
    .index("policy", ["policyId"])
    .index("outcome", ["outcome"]),

  // Deprecated (legacy policies): remove after reextractLegacyPolicies has run.
  acordTaxonomyDryRunPages: defineTable({
    runId: v.string(),
    cursorKey: v.string(),
    orgId: v.optional(v.id("organizations")),
    limit: v.number(),
    report: acordTaxonomyBackfillReportValidator,
    nextCursor: v.optional(v.string()),
    isDone: v.boolean(),
    createdAt: v.number(),
  })
    .index("run", ["runId"])
    .index("run_cursor", ["runId", "cursorKey"]),

  // Deprecated (legacy policies): remove after reextractLegacyPolicies has run.
  acordTaxonomyWriteRuns: defineTable({
    runId: v.string(),
    orgId: v.optional(v.id("organizations")),
    limit: v.number(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    nextCursor: v.optional(v.string()),
    retryCount: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("run", ["runId"]),

  // Deprecated (legacy policies): remove after reextractLegacyPolicies has run.
  acordTaxonomyWritePages: defineTable({
    runId: v.string(),
    cursorKey: v.string(),
    report: acordTaxonomyBackfillReportValidator,
    policyResultsRecorded: v.optional(v.boolean()),
    nextCursor: v.optional(v.string()),
    isDone: v.boolean(),
    createdAt: v.number(),
  })
    .index("run", ["runId"])
    .index("run_cursor", ["runId", "cursorKey"]),

  // Deprecated (legacy policies): remove after reextractLegacyPolicies has run.
  acordTaxonomyWritePolicyResults: defineTable({
    runId: v.string(),
    cursorKey: v.string(),
    policyId: v.id("policies"),
    report: acordTaxonomyBackfillReportValidator,
    createdAt: v.number(),
  })
    .index("run", ["runId"])
    .index("run_cursor", ["runId", "cursorKey"])
    .index("run_policy", ["runId", "policyId"]),

  operatorAuthNonces: defineTable({
    nonce: v.string(),
    timestamp: v.number(),
    expiresAt: v.number(),
  })
    .index("nonce", ["nonce"])
    .index("expiration", ["expiresAt"]),

  operatorEmailIdentities: defineTable({
    email: v.string(),
    userId: v.id("users"),
  })
    .index("email", ["email"])
    .index("email_user", ["email", "userId"]),

  operatorEmailIdentityBackfill: defineTable({
    key: v.literal("legacy"),
    completedAt: v.number(),
  }).index("key", ["key"]),

  // One TOTP authenticator per operator. A pending row is replaced until the
  // first valid code activates it; the secret is encrypted at rest.
  operatorTotpCredentials: defineTable({
    userId: v.id("users"),
    encryptedSecret: v.string(),
    status: v.union(v.literal("pending"), v.literal("active")),
    // Highest accepted 30-second step; codes at or below it are replays.
    lastUsedCounter: v.optional(v.number()),
    recoveryCodeHashes: v.array(v.string()),
    createdAt: v.number(),
    activatedAt: v.optional(v.number()),
  }).index("user", ["userId"]),

  // Auth sessions that passed the operator second factor.
  operatorSecondFactorSessions: defineTable({
    sessionId: v.id("authSessions"),
    userId: v.id("users"),
    method: v.union(
      v.literal("totp"),
      v.literal("recovery_code"),
      v.literal("local_dev"),
    ),
    verifiedAt: v.number(),
  })
    .index("session", ["sessionId"])
    .index("user", ["userId"]),

  operatorProfiles: defineTable({
    userId: v.id("users"),
    teamEmailLocalpart: v.optional(v.string()),
    alwaysCcEmail: v.optional(v.string()),
    email: v.string(),
    role: v.union(v.literal("operator"), v.literal("owner")),
    status: v.union(v.literal("active"), v.literal("disabled")),
    slackTeamId: v.optional(v.string()),
    slackUserId: v.optional(v.string()),
    avatarStorageId: v.optional(v.id("_storage")),
    // Test mode, for testing in production: while set, every email this
    // operator causes goes to `email` instead (or is blocked where it cannot be
    // rerouted), and only test providers are eligible for their outreach.
    // Client and system email is never affected.
    testModeEnabledAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("user", ["userId"])
    .index("by_teamEmailLocalpart", ["teamEmailLocalpart"])
    .index("email", ["email"])
    .index("slack_user", ["slackTeamId", "slackUserId"])
    .index("status", ["status"]),

  operatorMcpOAuthSessions: defineTable({
    stateHash: v.string(),
    serverId: v.id("operatorMcpServers"),
    serverRevision: v.number(),
    operatorUserId: v.id("users"),
    encryptedData: v.string(),
    expiresAt: v.number(),
    exchanging: v.boolean(),
  }).index("state", ["stateHash"]),

  operatorMcpServers: defineTable({
    authType: v.optional(v.union(v.literal("bearer"), v.literal("oauth"))),
    encryptedOAuth: v.optional(v.string()),
    oauthClientId: v.optional(v.string()),
    encryptedOAuthClientSecret: v.optional(v.string()),
    oauthRefreshLease: v.optional(v.string()),
    oauthRefreshExpiresAt: v.optional(v.number()),
    name: v.string(),
    url: v.string(),
    logoUrl: v.optional(v.string()),
    enabled: v.boolean(),
    encryptedToken: v.optional(v.string()),
    toolsJson: v.string(),
    revision: v.number(),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }),

  operatorAgentSettings: defineTable({
    key: v.literal("default"),
    approveAll: v.boolean(),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("key", ["key"]),

  operatorGoogleWorkspaceConfig: defineTable({
    key: v.literal("default"),
    enabled: v.boolean(),
    mailboxMode: operatorGoogleWorkspaceMailboxModeValidator,
    mailboxes: v.array(v.string()),
    directoryAdminEmail: v.optional(v.string()),
    lastVerification: v.optional(
      storedOperatorGoogleWorkspaceVerificationValidator,
    ),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("key", ["key"]),

  operatorImpersonationSessions: defineTable({
    operatorUserId: v.id("users"),
    targetOrgId: v.id("organizations"),
    targetRole: v.union(v.literal("admin"), v.literal("member")),
    status: v.union(v.literal("active"), v.literal("ended")),
    createdAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index("operator_status", ["operatorUserId", "status"])
    .index("target", ["targetOrgId"]),

  employeeProvisioningRequests: defineTable({
    requestId: v.string(),
    approvalDigest: v.string(),
    personId: v.string(),
    email: v.string(),
    role: v.literal("operator"),
    deployment: v.string(),
    appUrl: v.string(),
    userId: v.id("users"),
    auditId: v.id("operatorAuditEvents"),
    createdAt: v.number(),
  })
    .index("request", ["requestId"])
    .index("person", ["personId"])
    .index("email", ["email"]),

  operatorAuditEvents: defineTable({
    operatorUserId: v.optional(v.id("users")),
    serviceActor: v.optional(v.literal("central_employee_provisioning")),
    type: v.union(
      v.literal("operator_bootstrap"),
      v.literal("operator_invited"),
      v.literal("employee_provisioned"),
      v.literal("broker_created"),
      v.literal("broker_status_changed"),
      v.literal("broker_launch_email_sent"),
      v.literal("client_created"),
      v.literal("client_status_changed"),
      v.literal("client_operator_assigned"),
      v.literal("client_launch_email_sent"),
      v.literal("impersonation_started"),
      v.literal("impersonation_stopped"),
      v.literal("impersonation_chat_message"),
      v.literal("demo_lead_deleted"),
      v.literal("memory_cleared"),
      v.literal("setup_write"),
      v.literal("impersonated_write"),
      v.literal("second_factor_enrolled"),
      v.literal("second_factor_recovery_used"),
      v.literal("second_factor_reset"),
      v.literal("console_write"),
    ),
    targetOrgId: v.optional(v.id("organizations")),
    targetUserId: v.optional(v.id("users")),
    requestId: v.optional(v.id("procurementRequests")),
    summary: v.string(),
    metadata: v.optional(v.any()),
    // Public mutation that wrote the event, and the documents it changed.
    functionName: v.optional(v.string()),
    writes: v.optional(
      v.array(
        v.object({
          op: v.union(
            v.literal("insert"),
            v.literal("patch"),
            v.literal("replace"),
            v.literal("delete"),
          ),
          table: v.optional(v.string()),
          id: v.string(),
        }),
      ),
    ),
    createdAt: v.number(),
  })
    .index("operator_created", ["operatorUserId", "createdAt"])
    .index("target_created", ["targetOrgId", "createdAt"])
    .index("request_created", ["requestId", "createdAt"]),

  modelRoutingEvents: defineTable({
    kind: v.union(
      v.literal("model_step"),
      v.literal("call"),
      v.literal("direct_fallback"),
      v.literal("run"),
    ),
    routingSummary: v.optional(v.string()),
    callKey: v.optional(v.string()),
    operation: v.optional(v.string()),
    callProvider: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    runId: v.string(),
    sessionKey: v.string(),
    orgId: v.optional(v.id("organizations")),
    task: v.string(),
    taskKind: v.string(),
    channel: v.string(),
    label: v.string(),
    phase: v.string(),
    step: v.optional(v.number()),
    hasTools: v.optional(v.boolean()),
    hasToolResults: v.optional(v.boolean()),
    requestId: v.optional(v.string()),
    parentRequestId: v.optional(v.string()),
    provider: v.optional(modelProviderValidator),
    model: v.optional(v.string()),
    routeSource: v.optional(v.string()),
    transport: v.optional(v.union(v.literal("direct"), v.literal("cl-router"))),
    fallbackProvider: v.optional(modelProviderValidator),
    fallbackModel: v.optional(v.string()),
    fallbackReason: v.optional(v.string()),
    routerCode: v.optional(v.string()),
    routerStatus: v.optional(v.number()),
    routerRetryable: v.optional(v.boolean()),
    routerExecutionStarted: v.optional(v.boolean()),
    failureAttempts: v.optional(
      v.array(
        v.object({
          attempt: v.number(),
          provider: modelProviderValidator,
          model: v.string(),
          outcome: v.union(v.literal("error"), v.literal("timeout")),
          errorCode: v.optional(v.string()),
        }),
      ),
    ),
    routing: v.optional(extractionTraceRoutingValidator),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    reasoningTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
    maxOutputTokens: v.optional(v.number()),
    finishReason: v.optional(v.string()),
    hitOutputLimit: v.optional(v.boolean()),
    visibleTextLength: v.optional(v.number()),
    costUsd: v.optional(v.union(v.number(), v.null())),
    costStatus: v.optional(v.union(v.literal("priced"), v.literal("unpriced"))),
    status: v.optional(
      v.union(
        v.literal("complete"),
        v.literal("incomplete"),
        v.literal("error"),
        v.literal("fallback"),
        v.literal("running"),
        v.literal("cancelled"),
        v.literal("unknown"),
      ),
    ),
    toolCallCount: v.optional(v.number()),
    completedToolCount: v.optional(v.number()),
    toolNames: v.optional(v.array(v.string())),
    workflowOutcomeCount: v.optional(v.number()),
    workflowFailureCount: v.optional(v.number()),
    completionIssue: v.optional(
      v.union(
        v.literal("empty_response"),
        v.literal("output_limit"),
        v.literal("workflow_failure"),
      ),
    ),
    error: v.optional(v.string()),
    timestamp: v.number(),
    expiresAt: v.number(),
  })
    .index("time", ["timestamp"])
    .index("call", ["callKey"])
    .index("kind_time", ["kind", "timestamp"])
    .index("task_calls", ["kind", "task", "timestamp"])
    .index("task_time", ["task", "timestamp"])
    .index("run_time", ["runId", "timestamp"])
    .index("expiration", ["expiresAt"]),

  // Deprecated: the write path (modelSettings.updateGlobalRoutes and the
  // operator model-overrides UI) is removed. Stored routes are frozen until
  // modelSettings.clearOperatorModelOverridesInternal clears them.
  brokerModelSettings: defineTable({
    brokerOrgId: v.id("organizations"),
    routes: v.optional(
      v.object({
        chat: v.optional(modelRouteValidator),
        chat_vision: v.optional(modelRouteValidator),
        voice_transcription: v.optional(modelRouteValidator),
        email_draft: v.optional(modelRouteValidator),
        email_reply: v.optional(modelRouteValidator),
        extraction: v.optional(modelRouteValidator),
        extraction_preview: v.optional(modelRouteValidator),
        // Deprecated: remove after stripRetiredRoutesInternal has run.
        extraction_coverage_recovery: v.optional(modelRouteValidator),
        // Deprecated: remove after stripRetiredRoutesInternal has run.
        classification: v.optional(modelRouteValidator),
        requirement_extraction: v.optional(modelRouteValidator),
        org_memory_extraction: v.optional(modelRouteValidator),
        analysis: v.optional(modelRouteValidator),
        summary: v.optional(modelRouteValidator),
        triage: v.optional(modelRouteValidator),
        email_extraction: v.optional(modelRouteValidator),
        document_extraction: v.optional(modelRouteValidator),
        // Deprecated: remove after stripRetiredRoutesInternal has run.
        security: v.optional(modelRouteValidator),
        mailbox_coordinator: v.optional(modelRouteValidator),
        embeddings: v.optional(modelRouteValidator),
      }),
    ),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("broker", ["brokerOrgId"]),

  globalModelSettings: defineTable({
    key: v.literal("default"),
    // Optional explicit pins; unpinned generation delegates to cl-router.
    // clearOperatorModelOverridesInternal removes legacy global/broker pins.
    explicitRouteOverrides: v.optional(v.array(v.string())),
    routes: v.optional(
      v.object({
        operator_agent: v.optional(modelRouteValidator),
        chat: v.optional(modelRouteValidator),
        chat_vision: v.optional(modelRouteValidator),
        voice_transcription: v.optional(modelRouteValidator),
        email_draft: v.optional(modelRouteValidator),
        email_reply: v.optional(modelRouteValidator),
        extraction: v.optional(modelRouteValidator),
        extraction_preview: v.optional(modelRouteValidator),
        // Deprecated: remove after stripRetiredRoutesInternal has run.
        extraction_coverage_recovery: v.optional(modelRouteValidator),
        // Deprecated: remove after stripRetiredRoutesInternal has run.
        classification: v.optional(modelRouteValidator),
        requirement_extraction: v.optional(modelRouteValidator),
        org_memory_extraction: v.optional(modelRouteValidator),
        analysis: v.optional(modelRouteValidator),
        summary: v.optional(modelRouteValidator),
        triage: v.optional(modelRouteValidator),
        email_extraction: v.optional(modelRouteValidator),
        document_extraction: v.optional(modelRouteValidator),
        // Deprecated: remove after stripRetiredRoutesInternal has run.
        security: v.optional(modelRouteValidator),
        mailbox_coordinator: v.optional(modelRouteValidator),
        embeddings: v.optional(modelRouteValidator),
        // Deprecated: remove after stripRetiredRoutesInternal has run.
        extraction_quality: v.optional(modelRouteValidator),
        extraction_form_inventory: v.optional(modelRouteValidator),
        // Deprecated: remove after stripRetiredRoutesInternal has run.
        extraction_coverage_cleanup: v.optional(modelRouteValidator),
        // Deprecated: remove after stripRetiredRoutesInternal has run.
        fallback: v.optional(modelRouteValidator),
      }),
    ),
    webRetrieval: v.optional(webRetrievalValidator),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("key", ["key"]),

  connectedEmailAccounts: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    scope: v.union(v.literal("user"), v.literal("org")),
    label: v.optional(v.string()),
    emailAddress: v.string(),
    host: v.string(),
    port: v.number(),
    secure: v.boolean(),
    username: v.string(),
    encryptedPassword: v.string(),
    encryptionKeyVersion: v.optional(v.string()),
    automation: v.optional(connectedEmailAutomationValidator),
    status: v.union(
      v.literal("active"),
      v.literal("error"),
      v.literal("revoked"),
    ),
    lastError: v.optional(v.string()),
    lastTestedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("organization", ["orgId"])
    .index("user", ["userId"])
    .index("organization_status", ["orgId", "status"])
    .index("status", ["status"]),

  connectedEmailScanStates: defineTable({
    accountId: v.id("connectedEmailAccounts"),
    orgId: v.id("organizations"),
    mailbox: v.string(),
    uidValidity: v.optional(v.string()),
    lastUid: v.optional(v.number()),
    lastAttemptedAt: v.number(),
    lastSuccessfulAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("account_mailbox", ["accountId", "mailbox"])
    .index("organization", ["orgId"]),

  connectedEmailAutomationItems: defineTable({
    accountId: v.id("connectedEmailAccounts"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    mailbox: v.string(),
    uid: v.number(),
    messageKey: v.string(),
    emailRef: v.string(),
    sourceMessageId: v.optional(v.string()),
    subject: v.string(),
    from: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
    classification: v.union(
      v.literal("ignore"),
      v.literal("policy_document"),
      v.literal("insurance_requirements"),
      v.literal("company_context"),
      v.literal("multiple"),
      v.literal("review_needed"),
    ),
    confidence: v.number(),
    reason: v.string(),
    status: v.union(
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    attempts: v.number(),
    actionSummary: v.optional(v.string()),
    needsReview: v.optional(v.boolean()),
    reviewReason: v.optional(v.string()),
    policyIds: v.optional(v.array(v.id("policies"))),
    requirementIds: v.optional(v.array(v.id("insuranceRequirements"))),
    wikiSectionKeys: v.optional(v.array(v.string())),
    threadId: v.optional(v.id("threads")),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("account_message", ["accountId", "messageKey"])
    .index("thread", ["threadId"])
    .index("thread_email", ["threadId", "emailRef"])
    .index("organization_updated", ["orgId", "updatedAt"])
    .index("status_updated", ["status", "updatedAt"]),
  // Passport, integrations, email-inbox, and org-documents tables
  // were removed as part of the v0.2.0 scope simplification. See git history.

  // Org invitations — pending invites
  orgInvitations: defineTable({
    orgId: v.id("organizations"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    invitedBy: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired"),
    ),
    expiresAt: v.number(),
  })
    .index("email", ["email"])
    .index("organization", ["orgId"]),

  agentChannelSettings: defineTable({
    clientOrgId: v.id("organizations"),
    emailEnabled: v.boolean(),
    imessageEnabled: v.boolean(),
    slackEnabled: v.boolean(),
    slackSafeAlertsEnabled: v.boolean(),
    slackVendorAlertsEnabled: v.boolean(),
    updatedByUserId: v.optional(v.id("users")),
    updatedByOperatorUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("client", ["clientOrgId"]),

  slackSetupStates: defineTable({
    clientOrgId: v.id("organizations"),
    version: v.literal(1),
    mode: v.union(v.literal("initial"), v.literal("reinstall")),
    status: v.union(
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    currentStep: v.union(
      v.literal("install"),
      v.literal("support"),
      v.literal("channels"),
      v.literal("automations"),
    ),
    deferredSteps: v.array(
      v.union(
        v.literal("install"),
        v.literal("support"),
        v.literal("channels"),
      ),
    ),
    inviteRecipientEmail: v.optional(v.string()),
    inviteSentAt: v.optional(v.number()),
    inviteExpiresAt: v.optional(v.number()),
    installationCompletedAt: v.optional(v.number()),
    supportOmittedOperators: v.optional(
      v.array(
        v.object({
          displayName: v.string(),
          email: v.string(),
          reason: v.string(),
        }),
      ),
    ),
    supportOperatorInvitesSucceeded: v.optional(v.boolean()),
    supportOperatorInviteError: v.optional(v.string()),
    supportInviteSentAt: v.optional(v.number()),
    supportInviteError: v.optional(v.string()),
    startedByOperatorUserId: v.id("users"),
    completedByOperatorUserId: v.optional(v.id("users")),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("client", ["clientOrgId"]),

  slackInstallations: defineTable({
    teamId: v.string(),
    teamName: v.string(),
    kind: v.union(v.literal("customer"), v.literal("host")),
    appId: v.optional(v.string()),
    botUserId: v.optional(v.string()),
    encryptedBotToken: v.optional(v.string()),
    encryptedRefreshToken: v.optional(v.string()),
    botTokenExpiresAt: v.optional(v.number()),
    refreshLeaseExpiresAt: v.optional(v.number()),
    grantedScopes: v.array(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("revoked"),
      v.literal("disconnected"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("team_status", ["teamId", "status"]),

  slackWorkspaceConnections: defineTable({
    clientOrgId: v.id("organizations"),
    teamId: v.string(),
    teamName: v.string(),
    appId: v.optional(v.string()),
    nativeInstallationId: v.optional(v.id("slackInstallations")),
    installationId: v.optional(v.string()),
    botUserId: v.optional(v.string()),
    grantedScopes: v.array(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("revoked"),
      v.literal("disconnected"),
    ),
    healthStatus: v.optional(
      v.union(v.literal("healthy"), v.literal("degraded")),
    ),
    healthReason: v.optional(v.string()),
    healthSource: v.optional(
      v.union(
        v.literal("slack"),
        v.literal("reconciliation"),
        v.literal("provider"),
      ),
    ),
    healthSourceEventKey: v.optional(v.string()),
    providerErrorCode: v.optional(v.string()),
    providerErrorSummary: v.optional(v.string()),
    authorizationUpdatedAt: v.optional(v.number()),
    lastLifecycleEventAt: v.optional(v.number()),
    lastVerifiedAt: v.optional(v.number()),
    lastHealthyAt: v.optional(v.number()),
    reconciliationFailureCount: v.optional(v.number()),
    nextReconciliationAt: v.optional(v.number()),
    serviceUserId: v.id("users"),
    installedByUserId: v.optional(v.id("users")),
    installedByOperatorUserId: v.optional(v.id("users")),
    thirdPartyVisibilityAcknowledged: v.boolean(),
    automaticChannelId: v.optional(v.string()),
    automaticChannelName: v.optional(v.string()),
    automaticChannelRoutingConfiguredAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    disconnectedAt: v.optional(v.number()),
  })
    .index("client_status", ["clientOrgId", "status"])
    .index("team_status", ["teamId", "status"])
    .index("reconcile_schedule", ["status", "nextReconciliationAt"]),

  slackChannelBindings: defineTable({
    connectionId: v.optional(v.id("slackWorkspaceConnections")),
    clientOrgId: v.id("organizations"),
    kind: v.literal("primary"),
    hostTeamId: v.string(),
    hostChannelId: v.string(),
    customerChannelId: v.optional(v.string()),
    channelName: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("unavailable"),
      v.literal("archived"),
    ),
    healthStatus: v.optional(
      v.union(v.literal("healthy"), v.literal("degraded")),
    ),
    unavailableReason: v.optional(v.string()),
    healthSource: v.optional(
      v.union(
        v.literal("slack"),
        v.literal("reconciliation"),
        v.literal("provider"),
      ),
    ),
    healthSourceEventKey: v.optional(v.string()),
    providerErrorCode: v.optional(v.string()),
    providerErrorSummary: v.optional(v.string()),
    previousHostChannelId: v.optional(v.string()),
    previousCustomerChannelId: v.optional(v.string()),
    boundAt: v.optional(v.number()),
    lastLifecycleEventAt: v.optional(v.number()),
    lastVerifiedAt: v.optional(v.number()),
    lastHealthyAt: v.optional(v.number()),
    reconciliationFailureCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("connection_status", ["connectionId", "status"])
    .index("client_status", ["clientOrgId", "status"])
    .index("host_channel", ["hostTeamId", "hostChannelId"])
    .index("connection_customer", ["connectionId", "customerChannelId"]),

  slackChannelMemberships: defineTable({
    connectionId: v.id("slackWorkspaceConnections"),
    clientOrgId: v.id("organizations"),
    channelId: v.string(),
    channelName: v.string(),
    isPrivate: v.boolean(),
    isShared: v.boolean(),
    status: v.union(v.literal("active"), v.literal("removed")),
    lastSyncedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("connection_status", ["connectionId", "status"])
    .index("connection_channel", ["connectionId", "channelId"]),

  slackLifecycleEvents: defineTable({
    source: v.union(
      v.literal("slack"),
      v.literal("reconciliation"),
      v.literal("provider"),
    ),
    eventKey: v.string(),
    providerEventId: v.optional(v.string()),
    eventType: v.string(),
    teamId: v.optional(v.string()),
    authorizationTeamId: v.optional(v.string()),
    apiAppId: v.optional(v.string()),
    botUserIds: v.optional(v.array(v.string())),
    channelId: v.optional(v.string()),
    oldChannelId: v.optional(v.string()),
    newChannelId: v.optional(v.string()),
    channelName: v.optional(v.string()),
    connectedTeamId: v.optional(v.string()),
    previouslyConnectedTeamId: v.optional(v.string()),
    isExtShared: v.optional(v.boolean()),
    payloadHash: v.optional(v.string()),
    connectionId: v.optional(v.id("slackWorkspaceConnections")),
    bindingId: v.optional(v.id("slackChannelBindings")),
    clientOrgId: v.optional(v.id("organizations")),
    status: v.union(
      v.literal("claimed"),
      v.literal("processing"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("ignored"),
    ),
    attempts: v.number(),
    resultSummary: v.optional(v.string()),
    lastError: v.optional(v.string()),
    eventAt: v.number(),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
  })
    .index("event", ["eventKey"])
    .index("connection_received", ["connectionId", "receivedAt"])
    .index("client_received", ["clientOrgId", "receivedAt"])
    .index("status_received", ["status", "receivedAt"]),

  slackActors: defineTable({
    connectionId: v.id("slackWorkspaceConnections"),
    clientOrgId: v.id("organizations"),
    teamId: v.string(),
    slackUserId: v.string(),
    classification: v.union(
      v.literal("customer_member"),
      v.literal("spot_operator"),
      v.literal("external"),
      v.literal("bot"),
    ),
    operatorUserId: v.optional(v.id("users")),
    spotUserId: v.optional(v.id("users")),
    displayName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("slack_identity", ["connectionId", "teamId", "slackUserId"])
    .index("operator", ["operatorUserId"]),

  slackOAuthStates: defineTable({
    stateHash: v.string(),
    purpose: v.optional(
      v.union(
        v.literal("customer"),
        v.literal("customer_install_invite"),
        v.literal("host"),
      ),
    ),
    clientOrgId: v.optional(v.id("organizations")),
    setupStateId: v.optional(v.id("slackSetupStates")),
    recipientEmail: v.optional(v.string()),
    initiatedByUserId: v.optional(v.id("users")),
    initiatedByOperatorUserId: v.optional(v.id("users")),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
    invalidatedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("state", ["stateHash"])
    .index("client_purpose", ["clientOrgId", "purpose"])
    .index("expiration", ["expiresAt"]),

  connectedOrgRelationships: defineTable({
    // A client/customer org can view selected insurance system-of-record data
    // from a vendor org after the vendor approves the relationship. This is
    // intentionally one directional and read-only; no org inherits onward
    // access from either side.
    clientOrgId: v.id("organizations"),
    vendorOrgId: v.id("organizations"),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("revoked"),
    ),
    requestedByUserId: v.id("users"),
    approvedByUserId: v.optional(v.id("users")),
    revokedByUserId: v.optional(v.id("users")),
    relationshipLabel: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("client", ["clientOrgId"])
    .index("vendor", ["vendorOrgId"])
    .index("client_vendor", ["clientOrgId", "vendorOrgId"])
    .index("vendor_status", ["vendorOrgId", "status"])
    .index("client_status", ["clientOrgId", "status"]),

  connectedOrgInvitations: defineTable({
    clientOrgId: v.id("organizations"),
    vendorOrgId: v.optional(v.id("organizations")),
    relationshipId: v.optional(v.id("connectedOrgRelationships")),
    vendorEmail: v.string(),
    requestedByUserId: v.id("users"),
    inviteTokenHash: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired"),
      v.literal("revoked"),
    ),
    relationshipLabel: v.optional(v.string()),
    note: v.optional(v.string()),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    otpCode: v.optional(v.string()),
    otpCodeExpiresAt: v.optional(v.number()),
  })
    .index("token", ["inviteTokenHash"])
    .index("client", ["clientOrgId"])
    .index("email", ["vendorEmail"])
    .index("vendor", ["vendorOrgId"]),

  requirementSourceDocuments: defineTable({
    orgId: v.id("organizations"),
    extractionRunId: v.optional(v.string()),
    certificateHolderIds: v.optional(v.array(v.id("certificateHolders"))),
    dealName: v.optional(v.string()),
    dealType: v.optional(v.string()),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    sourceType: v.union(
      v.literal("lease_agreement"),
      v.literal("client_contract"),
      v.literal("vendor_requirements"),
      v.literal("other"),
    ),
    title: v.string(),
    sourceTextExcerpt: v.optional(v.string()),
    parserBackend: v.optional(
      v.union(
        v.literal("liteparse"),
        v.literal("pdfjs"),
        v.literal("mammoth"),
        v.literal("plain_text"),
      ),
    ),
    parsedAt: v.optional(v.number()),
    status: pipelineStatusValidator,
    pipelineError: v.optional(v.string()),
    createdByUserId: v.id("users"),
    archivedAt: v.optional(v.number()),
    archivedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("organization", ["orgId"])
    .index("organization_status", ["orgId", "status"])
    .index("file", ["fileId"]),

  requirementExtractionRuns: defineTable({
    runId: v.string(),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    trigger: v.union(v.literal("web_import"), v.literal("mailbox_import")),
    sourceName: v.string(),
    sourceType: v.union(
      v.literal("lease_agreement"),
      v.literal("client_contract"),
      v.literal("vendor_requirements"),
      v.literal("other"),
    ),
    scope: v.union(v.literal("vendors"), v.literal("own_org")),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    status: v.union(
      v.literal("running"),
      v.literal("complete"),
      v.literal("error"),
    ),
    phase: v.optional(v.string()),
    parserBackend: v.optional(
      v.union(
        v.literal("liteparse"),
        v.literal("pdfjs"),
        v.literal("mammoth"),
        v.literal("plain_text"),
      ),
    ),
    sourceCharacterCount: v.optional(v.number()),
    requestId: v.optional(v.string()),
    provider: v.optional(modelProviderValidator),
    model: v.optional(v.string()),
    routeSource: v.optional(v.string()),
    transport: v.optional(v.union(v.literal("direct"), v.literal("cl-router"))),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    costUsd: v.optional(v.union(v.number(), v.null())),
    extractedRequirementCount: v.optional(v.number()),
    checkableRequirementCount: v.optional(v.number()),
    droppedClassificationRequirementCount: v.optional(v.number()),
    extractedHolderCount: v.optional(v.number()),
    createdRequirementCount: v.optional(v.number()),
    duplicateRequirementCount: v.optional(v.number()),
    sourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    totalDurationMs: v.optional(v.number()),
    expiresAt: v.number(),
    updatedAt: v.number(),
  })
    .index("run", ["runId"])
    .index("organization_started", ["orgId", "startedAt"])
    .index("started", ["startedAt"])
    .index("expiration", ["expiresAt"]),

  insuranceRequirements: defineTable({
    orgId: v.id("organizations"),
    kind: v.union(
      v.literal("coverage"),
      v.literal("insurer"),
      v.literal("condition"),
    ),
    scope: v.union(v.literal("own_org"), v.literal("vendors")),
    title: v.string(),
    requirementText: v.string(),
    lineOfBusiness: v.optional(v.string()),
    limits: v.optional(
      v.array(
        v.object({
          kind: v.string(),
          amount: v.number(),
          label: v.optional(v.string()),
        }),
      ),
    ),
    maxDeductible: v.optional(
      v.object({
        amount: v.number(),
        label: v.optional(v.string()),
      }),
    ),
    coverageForm: v.optional(
      v.union(v.literal("occurrence"), v.literal("claims_made")),
    ),
    retroactiveDateOnOrBefore: v.optional(v.string()),
    provisions: v.optional(v.array(v.string())),
    requiredForms: v.optional(v.array(v.string())),
    minAmBestRating: v.optional(v.string()),
    minAmBestFinancialSize: v.optional(v.string()),
    admittedRequired: v.optional(v.boolean()),
    conditionType: v.optional(
      v.union(
        v.literal("cancellation_notice"),
        v.literal("certificate_delivery"),
        v.literal("claims_reporting"),
        v.literal("subcontractor_insurance"),
        v.literal("other"),
      ),
    ),
    noticeDays: v.optional(v.number()),
    sourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    sourceDocumentName: v.optional(v.string()),
    sourceType: v.optional(
      v.union(
        v.literal("manual"),
        v.literal("bulk_import"),
        v.literal("lease_agreement"),
        v.literal("client_contract"),
        v.literal("vendor_requirements"),
        v.literal("other"),
      ),
    ),
    sourceExcerpt: v.optional(v.string()),
    sourcePageStart: v.optional(v.number()),
    sourcePageEnd: v.optional(v.number()),
    classificationReview: v.optional(v.literal(true)),
    // Excerpt read from a page image that Jev could not find on the page.
    sourceVerification: v.optional(v.literal("unverified")),
    // Where the excerpt sits on its PDF page: PDF points at scale 1, top-left
    // origin, with the page size those points are measured against.
    sourceBbox: v.optional(
      v.object({
        page: v.number(),
        x: v.number(),
        y: v.number(),
        width: v.number(),
        height: v.number(),
        pageWidth: v.number(),
        pageHeight: v.number(),
      }),
    ),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdByUserId: v.id("users"),
    updatedByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("organization", ["orgId"])
    .index("organization_status", ["orgId", "status"])
    .index("status_scope", ["status", "scope"]),

  complianceJudgments: defineTable({
    requirementId: v.id("insuranceRequirements"),
    subjectOrgId: v.id("organizations"),
    policyId: v.id("policies"),
    inputHash: v.string(),
    answers: v.record(v.string(), v.union(v.string(), v.boolean())),
    judgedAt: v.number(),
    error: v.optional(v.string()),
    errorAt: v.optional(v.number()),
  }).index("requirement_subject_policy", [
    "requirementId",
    "subjectOrgId",
    "policyId",
  ]),

  complianceChecks: defineTable({
    orgId: v.id("organizations"),
    requirementId: v.id("insuranceRequirements"),
    subjectOrgId: v.id("organizations"),
    relationshipId: v.optional(v.id("connectedOrgRelationships")),
    status: v.union(
      v.literal("met"),
      v.literal("not_met"),
      v.literal("expiring_soon"),
      v.literal("expired"),
      v.literal("unverified"),
    ),
    reasons: v.optional(v.array(v.string())),
    matchedPolicyIds: v.array(v.id("policies")),
    matchedSummary: v.optional(v.string()),
    expiresAt: v.optional(v.string()),
    evidence: v.optional(
      v.object({
        note: v.optional(v.string()),
        fileId: v.optional(v.id("_storage")),
        fileName: v.optional(v.string()),
        validUntil: v.optional(v.string()),
      }),
    ),
    checkedAt: v.number(),
    // Carried across monitor snapshots to gate seven-day reminders.
    alertedAt: v.optional(v.number()),
    checkedBy: v.union(
      v.literal("system"),
      v.literal("user"),
      v.literal("agent"),
    ),
    checkedByUserId: v.optional(v.id("users")),
  })
    .index("requirement_subject", ["requirementId", "subjectOrgId"])
    .index("organization_subject", ["orgId", "subjectOrgId"])
    .index("relationship", ["relationshipId"])
    .index("review_history", [
      "requirementId",
      "subjectOrgId",
      "checkedBy",
      "checkedAt",
    ]),
  policyUploadFingerprints: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    sha256: v.string(),
  })
    .index("organization_hash", ["orgId", "sha256"])
    .index("policy", ["policyId"]),
  policyUploadFingerprintInventories: defineTable({
    orgId: v.id("organizations"),
    cursor: v.union(v.string(), v.null()),
    complete: v.boolean(),
  }).index("organization", ["orgId"]),
  policies: defineTable({
    ...pipelineFields(),
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.id("organizations")),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    uploadFileSha256s: v.optional(v.array(v.string())),
    extractionDataStage: v.optional(extractionDataStageValidator),
    extractionDataStageUpdatedAt: v.optional(v.number()),
    extractionPreviewVersion: v.optional(v.string()),
    extractionPreviewModel: v.optional(v.string()),
    extractionPreviewError: v.optional(v.string()),
    // Immutable promotion decision recorded by the guarded finalization owner.
    extractionPromotion: v.optional(v.any()),
    // Provenance — who uploaded and from which side
    uploadedBySide: v.optional(
      v.union(
        v.literal("broker"),
        v.literal("client"),
        v.literal("operator"),
        v.literal("agent_email"),
      ),
    ),
    uploadedByUserId: v.optional(v.id("users")),
    // Broker-authored corrections remain separate from source-backed extraction.
    policyDetailOverrides: v.optional(policyDetailOverridesValidator),
    policyDetailOverridesUpdatedAt: v.optional(v.number()),
    policyDetailOverridesUpdatedByUserId: v.optional(v.id("users")),
    // Entity fields
    carrier: v.string(), // backward compat — prefer security for new extractions
    security: v.optional(v.string()), // insurer/underwriter company (e.g. "Lloyd's Underwriters")
    underwriter: v.optional(v.string()), // named individual underwriter (e.g. "Libby Rudd")
    // Deprecated (legacy policies): remove after reextractLegacyPolicies has run.
    carrierBrandId: v.optional(v.id("carrierBrands")),
    // Deprecated (legacy policies): remove after reextractLegacyPolicies has run.
    carrierBrandStatus: v.optional(
      v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    ),
    // Deprecated (legacy policies): remove after reextractLegacyPolicies has run.
    carrierBrandAttempts: v.optional(v.number()),
    // Deprecated (legacy policies): remove after reextractLegacyPolicies has run.
    carrierBrandAttemptedAt: v.optional(v.number()),
    carrierIdentityEnrichmentStatus: v.optional(
      v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    ),
    carrierIdentityEnrichmentAttempts: v.optional(v.number()),
    carrierIdentityEnrichmentAttemptedAt: v.optional(v.number()),
    // Read compatibility for policies extracted before generalAgent.
    // Deprecated (legacy policies): remove after reextractLegacyPolicies has run.
    mga: v.optional(v.string()),
    broker: v.optional(v.string()),
    // Enriched entity fields (cl-sdk 1.2+)
    carrierIdentity: v.optional(carrierIdentityValidator),
    carrierLegalName: v.optional(v.string()),
    carrierNaicNumber: v.optional(v.string()),
    carrierAmBestRating: v.optional(v.string()),
    carrierAdmittedStatus: v.optional(v.string()), // admitted, non_admitted, surplus_lines
    brokerAgency: v.optional(v.string()),
    brokerContactName: v.optional(v.string()),
    brokerLicenseNumber: v.optional(v.string()),
    // Structured entity objects (cl-sdk 0.11+)
    insurer: v.optional(
      v.object({
        legalName: v.string(),
        naicNumber: v.optional(v.string()),
        amBestRating: v.optional(v.string()),
        amBestNumber: v.optional(v.string()),
        admittedStatus: v.optional(v.string()),
        stateOfDomicile: v.optional(v.string()),
        address: v.optional(
          v.object({
            street1: v.optional(v.string()),
            street2: v.optional(v.string()),
            city: v.optional(v.string()),
            state: v.optional(v.string()),
            zip: v.optional(v.string()),
            country: v.optional(v.string()),
            formatted: v.optional(v.string()),
          }),
        ),
        documentNodeId: v.optional(v.string()),
        sourceSpanIds: v.optional(v.array(v.string())),
        sourceTextHash: v.optional(v.string()),
        pageStart: v.optional(v.number()),
        pageEnd: v.optional(v.number()),
      }),
    ),
    producer: v.optional(
      v.object({
        agencyName: v.string(),
        contactName: v.optional(v.string()),
        licenseNumber: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        documentNodeId: v.optional(v.string()),
        sourceSpanIds: v.optional(v.array(v.string())),
        sourceTextHash: v.optional(v.string()),
        pageStart: v.optional(v.number()),
        pageEnd: v.optional(v.number()),
        address: v.optional(
          v.object({
            street1: v.string(),
            street2: v.optional(v.string()),
            city: v.optional(v.string()),
            state: v.optional(v.string()),
            zip: v.optional(v.string()),
            country: v.optional(v.string()),
            formatted: v.optional(v.string()),
          }),
        ),
      }),
    ),
    generalAgent: v.optional(
      v.object({
        agencyName: v.string(),
        licenseNumber: v.optional(v.string()),
        documentNodeId: v.optional(v.string()),
        sourceSpanIds: v.optional(v.array(v.string())),
        sourceTextHash: v.optional(v.string()),
        pageStart: v.optional(v.number()),
        pageEnd: v.optional(v.number()),
        address: v.optional(
          v.object({
            street1: v.string(),
            street2: v.optional(v.string()),
            city: v.optional(v.string()),
            state: v.optional(v.string()),
            zip: v.optional(v.string()),
            country: v.optional(v.string()),
            formatted: v.optional(v.string()),
          }),
        ),
      }),
    ),
    lossPayees: v.optional(
      v.array(
        v.object({
          name: v.string(),
          role: v.string(),
          address: v.optional(
            v.object({
              street1: v.string(),
              street2: v.optional(v.string()),
              city: v.optional(v.string()),
              state: v.optional(v.string()),
              zip: v.optional(v.string()),
              country: v.optional(v.string()),
              formatted: v.optional(v.string()),
            }),
          ),
          relationship: v.optional(v.string()),
          scope: v.optional(v.string()),
          documentNodeId: v.optional(v.string()),
          sourceSpanIds: v.optional(v.array(v.string())),
          sourceTextHash: v.optional(v.string()),
          pageStart: v.optional(v.number()),
          pageEnd: v.optional(v.number()),
        }),
      ),
    ),
    mortgageHolders: v.optional(
      v.array(
        v.object({
          name: v.string(),
          role: v.string(),
          address: v.optional(
            v.object({
              street1: v.string(),
              street2: v.optional(v.string()),
              city: v.optional(v.string()),
              state: v.optional(v.string()),
              zip: v.optional(v.string()),
              country: v.optional(v.string()),
              formatted: v.optional(v.string()),
            }),
          ),
          relationship: v.optional(v.string()),
          scope: v.optional(v.string()),
          documentNodeId: v.optional(v.string()),
          sourceSpanIds: v.optional(v.array(v.string())),
          sourceTextHash: v.optional(v.string()),
          pageStart: v.optional(v.number()),
          pageEnd: v.optional(v.number()),
        }),
      ),
    ),
    priorPolicyNumber: v.optional(v.string()),
    programName: v.optional(v.string()),
    productIdentity: v.optional(policyProductIdentityValidator),
    isPackage: v.optional(v.boolean()),
    // Insured details (cl-sdk 1.2+)
    insuredDba: v.optional(v.string()),
    insuredAddress: v.optional(
      v.object({
        street1: v.string(),
        street2: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        zip: v.optional(v.string()),
        country: v.optional(v.string()),
        formatted: v.optional(v.string()),
        documentNodeId: v.optional(v.string()),
        sourceSpanIds: v.optional(v.array(v.string())),
        sourceTextHash: v.optional(v.string()),
        pageStart: v.optional(v.number()),
        pageEnd: v.optional(v.number()),
      }),
    ),
    insuredEntityType: v.optional(v.string()), // corporation, llc, partnership, etc.
    insuredFein: v.optional(v.string()),
    additionalNamedInsureds: v.optional(
      v.array(
        v.object({
          name: v.string(),
          relationship: v.optional(v.string()),
          address: v.optional(
            v.object({
              street1: v.string(),
              street2: v.optional(v.string()),
              city: v.optional(v.string()),
              state: v.optional(v.string()),
              zip: v.optional(v.string()),
              country: v.optional(v.string()),
              formatted: v.optional(v.string()),
            }),
          ),
          documentNodeId: v.optional(v.string()),
          sourceSpanIds: v.optional(v.array(v.string())),
          sourceTextHash: v.optional(v.string()),
          pageStart: v.optional(v.number()),
          pageEnd: v.optional(v.number()),
        }),
      ),
    ),
    // Coverage structure (cl-sdk 1.2+)
    coverageForm: v.optional(v.string()), // occurrence, claims_made, accident
    retroactiveDate: v.optional(v.string()),
    effectiveTime: v.optional(v.string()),
    limits: v.optional(
      v.object({
        perOccurrence: v.optional(v.string()),
        generalAggregate: v.optional(v.string()),
        productsCompletedOpsAggregate: v.optional(v.string()),
        personalAdvertisingInjury: v.optional(v.string()),
        eachEmployee: v.optional(v.string()),
        fireDamage: v.optional(v.string()),
        medicalExpense: v.optional(v.string()),
        combinedSingleLimit: v.optional(v.string()),
        bodilyInjuryPerPerson: v.optional(v.string()),
        bodilyInjuryPerAccident: v.optional(v.string()),
        propertyDamage: v.optional(v.string()),
        eachOccurrenceUmbrella: v.optional(v.string()),
        umbrellaAggregate: v.optional(v.string()),
        umbrellaRetention: v.optional(v.string()),
        statutory: v.optional(v.boolean()),
        employersLiability: v.optional(
          v.object({
            eachAccident: v.string(),
            diseasePolicyLimit: v.string(),
            diseaseEachEmployee: v.string(),
          }),
        ),
        sublimits: v.optional(
          v.array(
            v.object({
              name: v.string(),
              limit: v.string(),
              appliesTo: v.optional(v.string()),
              deductible: v.optional(v.string()),
            }),
          ),
        ),
        sharedLimits: v.optional(
          v.array(
            v.object({
              description: v.string(),
              limit: v.string(),
              coverageParts: v.array(v.string()),
            }),
          ),
        ),
        defenseCostTreatment: v.optional(v.string()), // inside_limits, outside_limits, supplementary
      }),
    ),
    deductibles: v.optional(
      v.object({
        perClaim: v.optional(v.string()),
        perOccurrence: v.optional(v.string()),
        aggregateDeductible: v.optional(v.string()),
        selfInsuredRetention: v.optional(v.string()),
        corridorDeductible: v.optional(v.string()),
        waitingPeriod: v.optional(v.string()),
        appliesTo: v.optional(v.string()),
      }),
    ),
    // Locations, vehicles, classifications (cl-sdk 1.2+)
    locations: v.optional(
      v.array(
        v.object({
          number: v.number(),
          address: v.object({
            street1: v.string(),
            street2: v.optional(v.string()),
            city: v.optional(v.string()),
            state: v.optional(v.string()),
            zip: v.optional(v.string()),
            country: v.optional(v.string()),
          }),
          description: v.optional(v.string()),
          buildingValue: v.optional(v.string()),
          contentsValue: v.optional(v.string()),
          businessIncomeValue: v.optional(v.string()),
          constructionType: v.optional(v.string()),
          yearBuilt: v.optional(v.number()),
          squareFootage: v.optional(v.number()),
          protectionClass: v.optional(v.string()),
          sprinklered: v.optional(v.boolean()),
          alarmType: v.optional(v.string()),
          occupancy: v.optional(v.string()),
        }),
      ),
    ),
    vehicles: v.optional(
      v.array(
        v.object({
          number: v.number(),
          year: v.number(),
          make: v.string(),
          model: v.string(),
          vin: v.string(),
          costNew: v.optional(v.string()),
          statedValue: v.optional(v.string()),
          garageLocation: v.optional(v.number()),
          coverages: v.optional(
            v.array(
              v.object({
                type: v.string(),
                limit: v.optional(v.string()),
                deductible: v.optional(v.string()),
                included: v.boolean(),
              }),
            ),
          ),
          radius: v.optional(v.string()),
          vehicleType: v.optional(v.string()),
        }),
      ),
    ),
    classifications: v.optional(
      v.array(
        v.object({
          code: v.string(),
          description: v.string(),
          premiumBasis: v.string(),
          basisAmount: v.optional(v.string()),
          rate: v.optional(v.string()),
          premium: v.optional(v.string()),
          locationNumber: v.optional(v.number()),
        }),
      ),
    ),
    coverageSchedules: v.optional(
      v.array(
        v.object({
          name: v.string(),
          kind: v.union(
            v.literal("vehicle"),
            v.literal("property"),
            v.literal("location"),
            v.literal("other"),
          ),
          description: v.optional(v.string()),
          items: v.array(
            v.object({
              label: v.string(),
              description: v.optional(v.string()),
              values: v.array(
                v.object({
                  label: v.string(),
                  value: v.string(),
                }),
              ),
              sourceSpanIds: v.array(v.string()),
            }),
          ),
          sourceSpanIds: v.array(v.string()),
          pageStart: v.optional(v.number()),
          pageEnd: v.optional(v.number()),
        }),
      ),
    ),
    formInventory: v.optional(
      v.array(
        v.object({
          formNumber: v.string(),
          editionDate: v.optional(v.string()),
          title: v.optional(v.string()),
          formType: v.string(), // coverage, endorsement, declarations, application, notice, other
          pageStart: v.optional(v.number()),
          pageEnd: v.optional(v.number()),
          documentNodeId: v.optional(v.string()),
          sourceSpanIds: v.optional(v.array(v.string())),
          sourceTextHash: v.optional(v.string()),
        }),
      ),
    ),
    taxesAndFees: v.optional(
      v.array(
        v.object({
          name: v.string(),
          amount: v.string(),
          amountValue: v.optional(v.number()),
          type: v.optional(v.string()), // tax, fee, surcharge, assessment
          description: v.optional(v.string()),
          documentNodeId: v.optional(v.string()),
          sourceSpanIds: v.optional(v.array(v.string())),
          sourceTextHash: v.optional(v.string()),
        }),
      ),
    ),
    premiumBreakdown: v.optional(
      v.array(
        v.object({
          line: v.string(),
          amount: v.string(),
          amountValue: v.optional(v.number()),
          documentNodeId: v.optional(v.string()),
          sourceSpanIds: v.optional(v.array(v.string())),
          sourceTextHash: v.optional(v.string()),
        }),
      ),
    ),
    // Policy metadata
    policyNumber: v.string(),
    linesOfBusiness: v.array(v.string()),
    documentType: v.optional(v.literal("policy")),
    policyYear: v.number(),
    effectiveDate: v.string(),
    expirationDate: v.string(),
    isRenewal: v.boolean(),
    coverages: v.array(
      v.object({
        name: v.string(),
        lineOfBusiness: v.optional(v.string()),
        endorsementNumber: v.optional(v.string()),
        coverageCode: v.optional(v.string()),
        formEditionDate: v.optional(v.string()),
        limit: v.optional(v.string()),
        limitAmount: v.optional(v.number()),
        limitType: v.optional(v.string()),
        limitValueType: v.optional(v.string()),
        limits: v.optional(
          v.array(
            v.object({
              label: v.string(),
              value: v.string(),
              amount: v.optional(v.number()),
              appliesTo: v.optional(v.string()),
              kind: v.optional(v.string()),
              sourceNodeIds: v.optional(v.array(v.string())),
              sourceSpanIds: v.optional(v.array(v.string())),
            }),
          ),
        ),
        deductible: v.optional(v.string()),
        deductibleAmount: v.optional(v.number()),
        deductibleType: v.optional(v.string()),
        deductibleValueType: v.optional(v.string()),
        formNumber: v.optional(v.string()),
        sir: v.optional(v.string()),
        sublimit: v.optional(v.string()),
        coinsurance: v.optional(v.string()),
        valuation: v.optional(v.string()),
        territory: v.optional(v.string()),
        trigger: v.optional(v.string()),
        retroactiveDate: v.optional(v.string()),
        included: v.optional(v.boolean()),
        coveragePremium: v.optional(v.string()),
        premium: v.optional(v.string()),
        pageNumber: v.optional(v.number()),
        resolvedFromPage: v.optional(v.number()),
        sectionRef: v.optional(v.string()),
        originalContent: v.optional(v.string()),
        resolvedOriginalContent: v.optional(v.string()),
        recordId: v.optional(v.string()),
        documentNodeId: v.optional(v.string()),
        sourceSpanIds: v.optional(v.array(v.string())),
        sourceTextHash: v.optional(v.string()),
        extractionReviewStatus: v.optional(v.string()),
        extractionReviewReason: v.optional(v.string()),
        reviewSourceSpanIds: v.optional(v.array(v.string())),
      }),
    ),
    premium: v.optional(v.string()),
    premiumAmount: v.optional(v.number()),
    totalCost: v.optional(v.string()),
    totalCostAmount: v.optional(v.number()),
    insuredName: v.string(),
    summary: v.optional(v.string()),
    // Provenance — page references for key metadata
    metadataSource: v.optional(
      v.object({
        carrierPage: v.optional(v.number()),
        policyNumberPage: v.optional(v.number()),
        premiumPage: v.optional(v.number()),
        effectiveDatePage: v.optional(v.number()),
      }),
    ),
    // Source-tree projection retained for current agent and certificate context.
    documentMetadata: v.optional(v.any()),
    documentOutline: v.optional(v.any()),
    sourceTreeVersion: v.optional(v.string()),
    sourceTreeStatus: v.optional(
      v.union(
        v.literal("missing"),
        v.literal("queued"),
        v.literal("running"),
        v.literal("ready"),
        v.literal("failed"),
      ),
    ),
    sourceTreeUpdatedAt: v.optional(v.number()),
    sourceTreeError: v.optional(v.string()),
    operationalProfile: v.optional(v.any()),
    // Current extraction still stores the SDK document structure.
    document: v.optional(v.any()),
    // Dismissal flag — set when a policy row is dismissed/marked not-insurance.
    // Replaces the old extractionStatus: "not_insurance" value.
    dismissed: v.optional(v.boolean()),
    // Typed declarations (cl-sdk 1.4+) — line-specific structured data
    declarations: v.optional(v.any()),
    // cl-sdk 3.0+ fields
    policyTermType: v.optional(v.string()),
    nextReviewDate: v.optional(v.string()),
    minPremium: v.optional(v.string()),
    minPremiumAmount: v.optional(v.number()),
    depositPremium: v.optional(v.string()),
    depositPremiumAmount: v.optional(v.number()),
    auditProvision: v.optional(v.boolean()),
    cancellationProvisions: v.optional(v.string()),
    nonRenewalProvisions: v.optional(v.string()),
    assignmentClause: v.optional(v.string()),
    subrogationClause: v.optional(v.string()),
    otherInsuranceClause: v.optional(v.string()),
    // Supplementary extraction (cl-sdk 0.13+) — extra facts not captured by structured extractors
    supplementaryFacts: v.optional(
      v.array(
        v.object({
          key: v.string(),
          value: v.string(),
          subject: v.optional(v.string()),
          context: v.optional(v.string()),
          documentNodeId: v.optional(v.string()),
          sourceSpanIds: v.optional(v.array(v.string())),
          sourceTextHash: v.optional(v.string()),
        }),
      ),
    ),
    extractionReview: v.optional(v.any()),
    deletedAt: v.optional(v.number()),
    isDemo: v.optional(v.boolean()),
    // When true, this policy's chunks are excluded from vector search results
    excludeFromSearch: v.optional(v.boolean()),
    // ── Multi-file support ──
    // Denormalized lightweight file list for fast UI rendering (source of truth is policyFiles table)
    files: v.optional(
      v.array(
        v.object({
          fileId: v.id("_storage"),
          fileName: v.string(),
          fileType: v.string(), // declaration, wording, endorsement, schedule, renewal, certificate, unknown
          status: v.string(), // pending, extracting, complete, error, not_insurance
        }),
      ),
    ),
    currentPolicyVersionId: v.optional(v.id("policyVersions")),
  })
    .index("file", ["fileId"])
    .index("carrier", ["carrier"])
    .index("year", ["policyYear"])
    .index("user", ["userId"])
    .index("organization", ["orgId"]),

  // Runtime state for policy extraction. Keep high-churn logs, leases, and
  // large resumable checkpoints off the policy document itself.
  policyExtractionRuns: defineTable({
    policyId: v.id("policies"),
    pipelineStatus: pipelineStatusValidator,
    pipelineError: v.optional(v.string()),
    // Compact checkpoint only. Large payloads are stored as files referenced by
    // policyExtractionArtifacts so heartbeats and logs rewrite small documents.
    pipelineCheckpoint: v.optional(v.any()),
    sourceFingerprint: v.optional(v.string()),
    extractorVersion: v.optional(v.string()),
    evidenceLedgerHash: v.optional(v.string()),
    completionManifest: v.optional(v.any()),
    promotionGateDecision: v.optional(v.any()),
    promotedAt: v.optional(v.number()),
    pipelineLog: v.optional(
      v.array(
        v.object({
          timestamp: v.number(),
          message: v.string(),
          phase: v.optional(v.string()),
          level: v.optional(v.string()),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("policy", ["policyId"])
    .index("status_updated", ["pipelineStatus", "updatedAt"]),
  // blobs in Convex file storage for pre-embedding chunk/source-span payloads,
  // section extraction results, and legacy cl-sdk checkpoint cleanup.
  policyExtractionArtifacts: defineTable({
    policyId: v.id("policies"),
    kind: v.union(
      v.literal("cl_sdk_checkpoint"),
      v.literal("embedding_payload"),
      v.literal("source_bundle"),
      v.literal("section_result"),
      v.literal("parsed_source"),
      v.literal("section_plan"),
      v.literal("declarations_fast_pass"),
    ),
    storageId: v.id("_storage"),
    runId: v.optional(v.id("policyExtractionRuns")),
    sourceFingerprint: v.optional(v.string()),
    extractorVersion: v.optional(v.string()),
    sectionId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("policy", ["policyId"])
    .index("policy_kind", ["policyId", "kind"]),

  // Short-lived model-input assets staged by trusted Convex actions. Public
  // URLs are signed and never persisted. `ownerKind: "worker"` and the
  // `jobKind`/`jobId`/`leaseId` fields are deprecated: extraction worker
  // removed, no new "worker" rows are created; kept for any lingering rows
  // and dropped after data cleanup.
  routerAssets: defineTable({
    ownerKind: v.union(v.literal("worker"), v.literal("action")),
    jobKind: v.optional(
      v.union(v.literal("policy"), v.literal("preview"), v.literal("proposal")),
    ),
    jobId: v.optional(v.string()),
    leaseId: v.optional(v.string()),
    orgId: v.optional(v.id("organizations")),
    surface: v.optional(v.string()),
    sessionKey: v.optional(v.string()),
    storageId: v.id("_storage"),
    mediaType: v.string(),
    filename: v.optional(v.string()),
    sizeBytes: v.number(),
    sha256: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    cleanupAttempts: v.optional(v.number()),
  })
    .index("job", ["jobKind", "jobId"])
    .index("session", ["ownerKind", "surface", "sessionKey"])
    .index("organization", ["orgId"])
    .index("expiry", ["expiresAt"]),

  // Short-lived, server-owned fixtures for the internal router acceptance
  // harness. The marker row is the only authority for cleanup targets.
  operationalRouterSmokeRuns: defineTable({
    marker: v.string(),
    orgId: v.id("organizations"),
    createdAt: v.number(),
    expiresAt: v.number(),
  }).index("expiration", ["expiresAt"]),

  // Deprecated: extraction worker removed; drop after data cleanup. Was a
  // short-lived, never-queued policy lease used to smoke-test the deployed
  // extraction worker's authenticated asset and cl-router transports.
  workerRouterTransportSmokeRuns: defineTable({
    singleton: v.literal("active"),
    requestId: v.string(),
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    runId: v.id("policyExtractionRuns"),
    leaseId: v.string(),
    status: v.union(v.literal("ready"), v.literal("running")),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    expiresAt: v.number(),
  })
    .index("singleton", ["singleton"])
    .index("request", ["requestId"]),

  policyExtractionTraceSessions: defineTable({
    traceId: v.string(),
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    sourceKind: v.optional(v.string()),
    trigger: v.optional(v.string()),
    fileName: v.optional(v.string()),
    status: v.union(
      v.literal("running"),
      v.literal("complete"),
      v.literal("error"),
      v.literal("cancelled"),
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    lastEventAt: v.optional(v.number()),
    totalDurationMs: v.optional(v.number()),
    modelCallCount: v.optional(v.number()),
    modelDurationMs: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    slowestLabel: v.optional(v.string()),
    slowestKind: v.optional(v.string()),
    slowestDurationMs: v.optional(v.number()),
    error: v.optional(v.string()),
    expiresAt: v.number(),
    updatedAt: v.number(),
  })
    .index("trace", ["traceId"])
    .index("started", ["startedAt"])
    .index("status_started", ["status", "startedAt"])
    .index("organization_started", ["orgId", "startedAt"])
    .index("policy_started", ["policyId", "startedAt"])
    .index("expiration", ["expiresAt"]),

  policyExtractionTraceEvents: defineTable({
    traceId: v.string(),
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
    kind: v.union(
      v.literal("session"),
      v.literal("phase"),
      v.literal("log"),
      v.literal("model_call"),
      v.literal("embedding_batch"),
      v.literal("worker"),
      v.literal("artifact"),
    ),
    timestamp: v.number(),
    phase: v.optional(v.string()),
    level: v.optional(v.string()),
    message: v.optional(v.string()),
    label: v.optional(v.string()),
    task: v.optional(v.string()),
    taskKind: v.optional(v.string()),
    provider: v.optional(modelProviderValidator),
    model: v.optional(v.string()),
    routeSource: v.optional(v.string()),
    transport: v.optional(v.string()),
    attempt: v.optional(v.number()),
    status: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()),
    routerRequestId: v.optional(v.string()),
    costUsd: v.optional(v.union(v.number(), v.null())),
    costStatus: v.optional(v.union(v.literal("priced"), v.literal("unpriced"))),
    routingDecision: v.optional(v.string()),
    routing: v.optional(extractionTraceRoutingValidator),
    error: v.optional(v.string()),
    details: v.optional(v.any()),
    expiresAt: v.number(),
  })
    .index("trace_time", ["traceId", "timestamp"])
    .index("policy_time", ["policyId", "timestamp"])
    .index("expiration", ["expiresAt"]),

  // ── Policy Files (multi-file support) ──

  // Each policy can have multiple source files (declaration, wording, endorsements, etc.)
  policyFiles: defineTable({
    ...pipelineFields(),
    policyId: v.id("policies"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    fileType: v.union(
      v.literal("declaration"),
      v.literal("wording"),
      v.literal("endorsement"),
      v.literal("schedule"),
      v.literal("renewal"),
      v.literal("certificate"),
      v.literal("unknown"),
    ),
    pageCount: v.optional(v.number()),
    createdAt: v.number(),
    orgId: v.id("organizations"),
  })
    .index("policy", ["policyId"])
    .index("organization", ["orgId"])
    .index("file", ["fileId"]),

  // Operator-managed client dropbox. These records are separate from policy
  // source files because they may be unrelated to a policy and have their own
  // client-visibility contract.
  clientFiles: defineTable({
    orgId: v.id("organizations"),
    fileId: v.id("_storage"),
    name: v.string(),
    originalName: v.string(),
    contentType: v.string(),
    size: v.number(),
    sha256: v.optional(v.string()),
    clientVisible: v.boolean(),
    policyId: v.optional(v.id("policies")),
    uploadedByUserId: v.optional(v.id("users")),
    uploadedBySide: v.union(
      v.literal("operator"),
      v.literal("procurement_email"),
      v.literal("client"),
    ),
    nameSource: v.union(
      v.literal("original"),
      v.literal("ai"),
      v.literal("operator"),
      v.literal("agent"),
    ),
    nameStatus: v.union(
      v.literal("pending"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    nameInferenceError: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
    archivedByUserId: v.optional(v.id("users")),
    deletedAt: v.optional(v.number()),
    deletedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("organization", ["orgId", "createdAt"])
    .index("organization_archived", ["orgId", "archivedAt", "createdAt"])
    .index("visibility", ["orgId", "clientVisible", "createdAt"])
    .index("storage", ["fileId"])
    .index("content", ["orgId", "sha256"])
    .index("policy", ["policyId", "createdAt"]),

  clientFileUploadIntents: defineTable({
    operatorUserId: v.id("users"),
    clientOrgId: v.id("organizations"),
    fileId: v.optional(v.id("_storage")),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("operator_expiration", ["operatorUserId", "expiresAt"])
    .index("storage", ["fileId"]),

  procurementInformationExtractions: defineTable({
    requestId: v.id("procurementRequests"),
    messageId: v.id("teamEmailMessages"),
    operatorUserId: v.id("users"),
    automatic: v.optional(v.boolean()),
    audience: v.optional(v.union(v.literal("provider"), v.literal("client"))),
    outreachId: v.optional(v.id("procurementBrokerOutreaches")),
    answerTargets: v.optional(
      v.array(
        v.object({
          questionId: v.id("procurementInformationQuestions"),
          answerId: v.optional(v.id("procurementInformationAnswers")),
        }),
      ),
    ),
    emailAnswers: v.optional(v.array(informationEmailAnswerValidator)),
    unappliedCount: v.optional(v.number()),
    reviewReasons: v.optional(v.array(v.string())),
    startedAt: v.number(),
    // 0 means queued; absent means a legacy action may already own inference.
    processingStartedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    status: v.union(
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    questions: v.array(informationExtractionQuestionValidator),
  })
    .index("by_requestId_and_messageId", ["requestId", "messageId"])
    .index("by_requestId_and_status", ["requestId", "status"])
    .index("by_requestId", ["requestId"]),
  procurementInformationQuestions: defineTable({
    requestId: v.id("procurementRequests"),
    question: followupQuestionValidator,
    archivedAt: v.optional(v.number()),
    scope: informationScopeValidator,
    // Deprecated: inert compatibility storage; future-intake reuse has been removed.
    libraryId: v.optional(v.id("procurementQuestionLibrary")),
    answerId: v.optional(v.id("procurementInformationAnswers")),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
  }).index("by_requestId", ["requestId"]),
  procurementInformationRequirements: defineTable({
    requestId: v.id("procurementRequests"),
    questionId: v.id("procurementInformationQuestions"),
    outreachId: v.id("procurementBrokerOutreaches"),
    carrier: v.optional(v.string()),
    sourceMessageId: v.optional(v.id("teamEmailMessages")),
    sourceQuote: v.optional(v.string()),
    status: informationRequirementStatus,
    revision: v.number(),
    resolutionNote: v.optional(v.string()),
    acceptedAnswerId: v.optional(v.id("procurementInformationAnswers")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_requestId", ["requestId"])
    .index("by_questionId", ["questionId"]),
  procurementInformationForms: defineTable({
    requestId: v.id("procurementRequests"),
    title: v.string(),
    outreachSequenceId: v.optional(v.id("procurementOutreachSequences")),
    questions: v.array(informationFormQuestionValidator),
    prerequisites: v.optional(
      v.array(
        v.object({
          questionId: v.id("procurementInformationQuestions"),
          answerId: v.id("procurementInformationAnswers"),
        }),
      ),
    ),
    responses: v.array(informationResponseValidator),
    editDraft: v.optional(v.object({
      responses: v.array(informationResponseValidator),
      answerVersions: v.array(v.object({
        questionId: v.id("procurementInformationQuestions"),
        answerId: v.optional(v.id("procurementInformationAnswers")),
      })),
    })),
    revision: v.number(),
    status: v.union(
      v.literal("open"),
      v.literal("submitted"),
      v.literal("cancelled"),
    ),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    submittedAt: v.optional(v.number()),
    submittedByUserId: v.optional(v.id("users")),
  }).index("by_requestId", ["requestId"]),
  procurementInformationAnswers: defineTable({
    requestId: v.id("procurementRequests"),
    questionId: v.id("procurementInformationQuestions"),
    formId: v.optional(v.id("procurementInformationForms")),
    answer: v.string(),
    unsure: v.boolean(),
    fileItemIds: v.array(v.id("procurementFileItems")),
    suppliedByUserId: v.optional(v.id("users")),
    provenance: v.string(),
    sourceMessageId: v.optional(v.id("teamEmailMessages")),
    sourceQuote: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_questionId", ["questionId"]),
  procurementInformationDeliveries: defineTable({
    requestId: v.id("procurementRequests"),
    requirementId: v.id("procurementInformationRequirements"),
    answerId: v.id("procurementInformationAnswers"),
    messageId: v.id("teamEmailMessages"),
    recordedByUserId: v.id("users"),
    createdAt: v.number(),
  }).index("by_requestId", ["requestId"]),
  // Deprecated: retained for existing records, without readers or writers.
  procurementQuestionLibrary: defineTable({
    question: followupQuestionValidator,
    scope: informationScopeValidator,
    state: v.union(
      v.literal("observed"),
      v.literal("active"),
      v.literal("retired"),
    ),
    coverage: v.string(),
    industry: v.string(),
    jurisdiction: v.string(),
    applicability: v.string(),
    sourceRequirementId: v.id("procurementInformationRequirements"),
    reviewedByUserId: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_state_and_coverage", ["state", "coverage"]),

  procurementRequests: defineTable({
    deletedAt: v.optional(v.number()),
    deletedByUserId: v.optional(v.id("users")),
    ...requestIntakeFields,
    clientOrgId: v.optional(v.id("organizations")),
    title: v.string(),
    normalizedTitle: v.optional(v.string()),
    targetEffectiveDate: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("submitted"),
      v.literal("gathering_information"),
      v.literal("marketing"),
      v.literal("proposal_review"),
      v.literal("binding"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    clientVisible: v.optional(v.boolean()),
    // Monotonic revision of all client/broker-visible packet content.
    packetRevision: v.optional(v.number()),
    replacingPolicyId: v.optional(v.id("policies")),
    resultingPolicyId: v.optional(v.id("policies")),
    completionOutcome: v.optional(completionOutcomeValidator),
    inboxToken: v.string(),
    createdByUserId: v.id("users"),
    updatedByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("title", ["clientOrgId", "title"])
    .index("normalized_title", ["clientOrgId", "normalizedTitle"])
    .index("organization", ["clientOrgId", "updatedAt"])
    .index("organization_visibility", [
      "clientOrgId",
      "clientVisible",
      "updatedAt",
    ])
    .index("status", ["clientOrgId", "status", "updatedAt"])
    .index("inbox", ["inboxToken"])
    .index("owner_updated", ["ownerUserId", "updatedAt"])
    .index("by_deletedAt_and_updatedAt", ["deletedAt", "updatedAt"])
    .index("by_deletedAt_and_createdAt", ["deletedAt", "createdAt"])
    .index("intake_submitted_status", [
      "intakeSubmittedAt",
      "status",
      "updatedAt",
    ]),

  requestHandoffs: defineTable({
    intakeGoal: v.optional(v.union(v.literal("quote"), v.literal("savings"))),
    tokenHash: v.string(),
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    requestId: v.optional(v.id("procurementRequests")),
    expiresAt: v.number(),
    claimedAt: v.optional(v.number()),
  }).index("token_hash", ["tokenHash"]),

  intakeSlackEvents: defineTable({
    requestId: v.id("procurementRequests"),
    eventKey: v.string(),
    teamId: v.string(),
    channelId: v.string(),
    content: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    error: v.optional(v.string()),
  })
    .index("request_event", ["requestId", "eventKey"])
    .index("request_status", ["requestId", "status"]),
  requestIntakeUploadIntents: defineTable({
    requestId: v.id("procurementRequests"),
    ownerUserId: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(),
    fileId: v.optional(v.id("_storage")),
  }).index("request", ["requestId"]),

  requestIntakeFiles: defineTable({
    prefillStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("complete"),
        v.literal("failed"),
      ),
    ),
    policyId: v.optional(v.id("policies")),
    prefillStartedAt: v.optional(v.number()),
    prefillCoveragesJson: v.optional(v.string()),
    requestId: v.id("procurementRequests"),
    ownerUserId: v.id("users"),
    fileId: v.id("_storage"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
    category: v.union(
      v.literal("requirements"),
      v.literal("policy"),
      v.literal("loss_runs"),
      v.literal("supporting"),
    ),
    clientFileId: v.optional(v.id("clientFiles")),
    createdAt: v.number(),
  })
    .index("request", ["requestId"])
    .index("storage", ["fileId"]),

  operatorOutreachInboxes: defineTable({
    userId: v.optional(v.id("users")),
    kind: v.optional(v.union(v.literal("operator"), v.literal("agent"))),
    // Missing status is an active pre-cutover inbox until backfilled.
    status: v.optional(v.union(v.literal("active"), v.literal("retired"))),
    retiredAt: v.optional(v.number()),
    inboxId: v.string(),
    emailAddress: v.string(),
    fromName: v.string(),
    labelIds: v.object({ automated: v.string(), needsReply: v.string() }),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_inboxId", ["inboxId"])
    .index("by_emailAddress", ["emailAddress"])
    .index("by_userId_and_status", ["userId", "status"])
    .index("by_kind", ["kind"]),

  // Durable outreach sequences. `audience` absent means provider outreach
  // (outreach, provider and packet link set); `client` sequences ask the
  // client for information and carry the operator's own first message.
  procurementOutreachSequences: defineTable({
    requestId: v.id("procurementRequests"),
    informationFormId: v.optional(v.id("procurementInformationForms")),
    clientOrgId: v.id("organizations"),
    audience: v.optional(v.union(v.literal("provider"), v.literal("client"))),
    outreachId: v.optional(v.id("procurementBrokerOutreaches")),
    brokerOrgId: v.optional(v.id("organizations")),
    recipient: v.object({
      contactId: v.optional(v.id("brokerContacts")),
      userId: v.optional(v.id("users")),
      email: v.string(),
      name: v.optional(v.string()),
    }),
    message: v.optional(v.object({ subject: v.string(), text: v.string() })),
    senderUserId: v.id("users"),
    identityFingerprint: v.optional(v.string()),
    inboxId: v.optional(v.string()),
    packetLinkId: v.optional(v.id("procurementPacketLinks")),
    resendThreadId: v.optional(v.string()),
    lastOutboundEmailId: v.optional(v.string()),
    teamEmailThreadId: v.optional(v.id("teamEmailThreads")),
    cadence: v.object({
      followUpCount: v.number(),
      intervalBusinessDays: v.number(),
      style: v.union(
        v.literal("brief_nudge"),
        v.literal("concise_recap"),
        v.literal("detailed_recap"),
      ),
    }),
    cadenceSource: v.object({
      followUpCount: v.union(
        v.literal("jev"),
        v.literal("default"),
        v.literal("operator"),
      ),
      intervalBusinessDays: v.union(
        v.literal("jev"),
        v.literal("default"),
        v.literal("operator"),
      ),
      style: v.union(
        v.literal("jev"),
        v.literal("default"),
        v.literal("operator"),
      ),
    }),
    status: v.union(
      v.literal("active"),
      v.literal("reply_check"),
      v.literal("responded"),
      v.literal("completed"),
      v.literal("stopped"),
      v.literal("failed"),
    ),
    stopReason: v.optional(v.string()),
    pendingReplyEmailId: v.optional(v.string()),
    respondedAt: v.optional(v.number()),
    replyCheckStartedAt: v.optional(v.number()),
    replyClassificationEmailId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_outreachId", ["outreachId"])
    .index("by_teamEmailThreadId", ["teamEmailThreadId"])
    .index("by_requestId_and_status", ["requestId", "status"])
    .index("by_resendThreadId", ["resendThreadId"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"]),

  procurementOutreachSteps: defineTable({
    sequenceId: v.id("procurementOutreachSequences"),
    index: v.number(),
    kind: v.union(v.literal("initial"), v.literal("follow_up")),
    isFinal: v.boolean(),
    dueAt: v.number(),
    status: v.union(
      v.literal("scheduled"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("captured"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    attempts: v.number(),
    leaseToken: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    firstAttemptAt: v.optional(v.number()),
    impersonationDeferredAt: v.optional(v.number()),
    identityDeferredAt: v.optional(v.number()),
    identity: v.optional(v.object({ fingerprint: v.string(), inboxId: v.string() })),
    generationStartedAt: v.optional(v.number()),
    draft: v.optional(
      v.object({
        cc: v.optional(v.array(v.string())),
        subject: v.string(),
        text: v.string(),
        html: v.string(),
        source: v.union(v.literal("llm"), v.literal("template"), v.literal("operator")),
      }),
    ),
    resendDraftId: v.optional(v.string()),
    resendEmailId: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sequenceId_and_index", ["sequenceId", "index"])
    .index("by_status_and_dueAt", ["status", "dueAt"])
    .index("by_status_and_leaseUntil", ["status", "leaseUntil"])
    .index("by_resendEmailId", ["resendEmailId"]),

  procurementOutreachCadences: defineTable({
    requestId: v.id("procurementRequests"),
    fingerprint: v.string(),
    // Operator choices saved on change; they win over picks and survive re-suggestion.
    overrides: v.optional(
      v.object({
        followUpCount: v.optional(v.number()),
        intervalBusinessDays: v.optional(v.number()),
        style: v.optional(
          v.union(
            v.literal("brief_nudge"),
            v.literal("concise_recap"),
            v.literal("detailed_recap"),
          ),
        ),
      }),
    ),
    generationStartedAt: v.optional(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    picks: v.optional(
      v.object({
        followUpCount: v.object({
          value: v.number(),
          confidence: v.number(),
          source: v.union(v.literal("jev"), v.literal("default")),
        }),
        intervalBusinessDays: v.object({
          value: v.number(),
          confidence: v.number(),
          source: v.union(v.literal("jev"), v.literal("default")),
        }),
        style: v.object({
          value: v.union(
            v.literal("brief_nudge"),
            v.literal("concise_recap"),
            v.literal("detailed_recap"),
          ),
          confidence: v.number(),
          source: v.union(v.literal("jev"), v.literal("default")),
        }),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_requestId", ["requestId"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"]),

  providerOutreachWebhookEvents: defineTable({
    emailId: v.string(),
    eventType: v.string(),
    inboxId: v.string(),
    threadId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    leaseUntil: v.optional(v.number()),
    leaseToken: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_emailId_and_eventType", ["emailId", "eventType"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"]),

  procurementBrokerOutreaches: defineTable({
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    brokerOrgId: v.optional(v.id("organizations")),
    brokerName: v.string(),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    status: v.union(
      v.literal("observed"),
      v.literal("request_sent"),
      v.literal("can_handle"),
      v.literal("cannot_handle"),
      v.literal("quote_received"),
      v.literal("quote_accepted"),
      v.literal("quote_rejected"),
    ),
    contactUserId: v.optional(v.id("users")),
    sentAt: v.optional(v.number()),
    packetRevisionAtIssue: v.optional(v.number()),
    createdByUserId: v.id("users"),
    updatedByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("request_broker", ["requestId", "brokerOrgId"])
    .index("request", ["requestId", "updatedAt"])
    .index("organization", ["clientOrgId", "updatedAt"])
    .index("broker", ["brokerOrgId", "updatedAt"])
    .index("broker_sent", ["brokerOrgId", "sentAt"]),

  // Provider events for the operator's Quo broker-outreach number. These stay
  // outside customer channels and never enter the customer agent pipeline.
  procurementSmsEvents: defineTable({
    providerEventId: v.string(),
    providerMessageId: v.string(),
    eventType: v.union(
      v.literal("message.received"),
      v.literal("message.delivered"),
    ),
    phoneNumberId: v.string(),
    conversationId: v.optional(v.string()),
    counterpartyPhone: v.string(),
    direction: v.union(v.literal("incoming"), v.literal("outgoing")),
    from: v.string(),
    to: v.array(v.string()),
    body: v.string(),
    status: v.optional(v.string()),
    contactIds: v.optional(v.array(v.string())),
    media: v.optional(
      v.array(
        v.object({
          url: v.string(),
          type: v.optional(v.string()),
        }),
      ),
    ),
    providerCreatedAt: v.string(),
    messageCreatedAt: v.optional(v.string()),
    receivedAt: v.number(),
  })
    .index("provider_event", ["providerEventId"])
    .index("provider_message", ["providerMessageId", "receivedAt"])
    .index("counterparty", ["counterpartyPhone", "receivedAt"]),

  procurementPacketLinks: defineTable({
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    // New links are request-wide: every broker receives the same packet.
    // The optional outreach remains only for legacy recipient-scoped links.
    outreachId: v.optional(v.id("procurementBrokerOutreaches")),
    tokenHash: v.string(),
    token: v.optional(v.string()),
    recipientLabel: v.string(),
    recipientEmail: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    revokedByUserId: v.optional(v.id("users")),
    packetRevisionAtIssue: v.number(),
    // New links are immutable snapshots of the broker projection. Legacy links
    // without snapshots continue to resolve against the current packet until
    // they are rotated or revoked. Current release state may only narrow a
    // snapshot's artifact access.
    sectionSnapshot: v.optional(
      v.array(
        v.object({
          key: v.string(),
          heading: v.string(),
          body: v.string(),
          order: v.number(),
        }),
      ),
    ),
    artifactSnapshot: v.optional(
      v.array(
        v.object({
          fileItemId: v.id("procurementFileItems"),
          clientFileId: v.id("clientFiles"),
          name: v.string(),
          release: v.union(v.literal("listed"), v.literal("attached")),
        }),
      ),
    ),
    includedFileItemIds: v.optional(v.array(v.id("procurementFileItems"))),
    lastViewedAt: v.optional(v.number()),
    viewCount: v.number(),
    // Email delivery of this exact link. Absent when the link was only minted
    // for copying or preview.
    deliveryStatus: v.optional(
      v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    ),
    deliveryError: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("token", ["tokenHash"])
    .index("request", ["requestId", "updatedAt"])
    .index("outreach", ["outreachId", "updatedAt"])
    .index("expiration", ["expiresAt"]),

  procurementPacketViews: defineTable({
    linkId: v.id("procurementPacketLinks"),
    requestId: v.id("procurementRequests"),
    at: v.number(),
    path: v.string(),
    userAgent: v.optional(v.string()),
  }).index("link", ["linkId", "at"]),

  procurementProposals: defineTable({
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    brokerOrgId: v.id("organizations"),
    outreachId: v.id("procurementBrokerOutreaches"),
    supersedesProposalId: v.optional(v.id("procurementProposals")),
    status: v.union(
      v.literal("draft"),
      v.literal("extracting"),
      v.literal("review_ready"),
      v.literal("reviewed"),
      v.literal("selected"),
      v.literal("withdrawn"),
      v.literal("archived"),
    ),
    extractionFingerprint: v.optional(v.string()),
    extractedOffer: v.optional(v.any()),
    selectedAt: v.optional(v.number()),
    selectedByUserId: v.optional(v.id("users")),
    archivedAt: v.optional(v.number()),
    archivedByUserId: v.optional(v.id("users")),
    archiveReason: v.optional(v.string()),
    createdByUserId: v.id("users"),
    updatedByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("request", ["requestId", "updatedAt"])
    .index("broker", ["brokerOrgId", "updatedAt"])
    .index("broker_created", ["brokerOrgId", "createdAt"])
    .index("outreach", ["outreachId", "updatedAt"])
    .index("request_status", ["requestId", "status", "updatedAt"]),

  procurementProposalDocuments: defineTable({
    proposalId: v.id("procurementProposals"),
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    sha256: v.string(),
    // Canonical artifact this document was filed from. The blob is shared, not
    // copied; the client file carries provenance and visibility.
    clientFileId: v.optional(v.id("clientFiles")),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
  })
    .index("proposal", ["proposalId", "createdAt"])
    .index("storage", ["fileId"]),

  procurementProposalReviews: defineTable({
    proposalId: v.id("procurementProposals"),
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    extractionFingerprint: v.string(),
    // Reviews bind to the broker-visible packet the proposal answered, so a
    // packet edit invalidates them.
    packetRevision: v.number(),
    modelConclusion: v.union(
      v.literal("meets_requirements"),
      v.literal("has_gaps"),
      v.literal("insufficient_evidence"),
    ),
    staffConclusion: v.optional(
      v.union(
        v.literal("meets_requirements"),
        v.literal("has_gaps"),
        v.literal("insufficient_evidence"),
      ),
    ),
    findings: v.array(proposalReviewFindingValidator),
    confirmedByUserId: v.optional(v.id("users")),
    confirmedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("proposal", ["proposalId", "createdAt"])
    .index("request", ["requestId", "createdAt"]),

  procurementProposalExtractionJobs: defineTable({
    proposalId: v.id("procurementProposals"),
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    extractionFingerprint: v.string(),
    requestedByUserId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    leaseId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    // Deprecated: extraction worker removed; the pipeline runs entirely in
    // Convex, so no lease is ever attributed to an external worker id.
    workerId: v.optional(v.string()),
    // Deprecated: extraction worker removed; completion payloads are built
    // and consumed inline by the Convex pipeline, never staged in storage.
    completionPayloadStorageId: v.optional(v.id("_storage")),
    // Compact per-document/per-section pipeline progress. Large payloads
    // (parsed source spans, section outputs) live in
    // procurementProposalExtractionArtifacts so checkpoint saves stay small.
    checkpoint: v.optional(v.any()),
    lastError: v.optional(v.string()),
    // Set when an operator stopped the job (cancel or archive). The row is
    // still `failed`, but it is a deliberate stop, not an extraction issue.
    cancelledAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("status", ["status", "updatedAt"])
    .index("proposal", ["proposalId", "createdAt"])
    .index("fingerprint", ["proposalId", "extractionFingerprint"]),

  procurementProposalExtractionArtifacts: defineTable({
    proposalId: v.id("procurementProposals"),
    jobId: v.id("procurementProposalExtractionJobs"),
    // Scopes an artifact to one proposal document when a job spans several
    // documents (parsed source, section plan, section results, quote terms).
    proposalDocumentId: v.optional(v.id("procurementProposalDocuments")),
    kind: v.string(),
    value: v.optional(v.any()),
    // Large payloads (parsed source spans, section outputs) are stored as
    // files instead of inline `value` so checkpoint-adjacent writes stay
    // small; small artifacts (logs) keep using `value`.
    storageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
  })
    .index("proposal", ["proposalId", "createdAt"])
    .index("job", ["jobId", "createdAt"])
    .index("job_document_kind", ["jobId", "proposalDocumentId", "kind"]),

  proposalSourceSpans: defineTable({
    orgId: v.id("organizations"),
    proposalId: v.id("procurementProposals"),
    proposalDocumentId: v.id("procurementProposalDocuments"),
    extractionFingerprint: v.string(),
    documentId: v.string(),
    spanId: v.string(),
    pageStart: v.optional(v.number()),
    pageEnd: v.optional(v.number()),
    text: v.string(),
    textHash: v.string(),
    bbox: v.optional(v.any()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("proposal", ["proposalId", "createdAt"])
    .index("proposal_span", ["proposalId", "spanId"])
    .index("proposal_fingerprint", [
      "proposalId",
      "extractionFingerprint",
      "createdAt",
    ])
    .index("fingerprint_span", [
      "proposalId",
      "extractionFingerprint",
      "spanId",
    ])
    .index("document", ["proposalDocumentId", "createdAt"])
    .index("document_span", ["proposalDocumentId", "spanId"]),

  proposalSourceNodes: defineTable({
    orgId: v.id("organizations"),
    proposalId: v.id("procurementProposals"),
    proposalDocumentId: v.id("procurementProposalDocuments"),
    extractionFingerprint: v.string(),
    documentId: v.string(),
    nodeId: v.string(),
    parentNodeId: v.optional(v.string()),
    kind: v.string(),
    title: v.string(),
    textExcerpt: v.optional(v.string()),
    sourceSpanIds: v.array(v.string()),
    pageStart: v.optional(v.number()),
    pageEnd: v.optional(v.number()),
    order: v.number(),
    path: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("proposal", ["proposalId", "createdAt"])
    .index("proposal_node", ["proposalId", "nodeId"])
    .index("proposal_fingerprint", [
      "proposalId",
      "extractionFingerprint",
      "createdAt",
    ])
    .index("fingerprint_node", [
      "proposalId",
      "extractionFingerprint",
      "nodeId",
    ])
    .index("proposal_parent", ["proposalId", "parentNodeId"])
    .index("document", ["proposalDocumentId", "createdAt"])
    .index("document_parent", ["proposalDocumentId", "parentNodeId"]),

  operatorEmailPlacementChecks: defineTable({
    sender: v.string(),
    destination: v.union(v.literal("Gmail"),v.literal("Microsoft"),v.literal("Other")),
    placement: v.union(v.literal("Inbox"),v.literal("Spam"),v.literal("Missing")),
    note: v.string(),
    checkedAt: v.number(),
    recordedBy: v.id("users"),
  }),
  operatorSendingMailboxes: defineTable({
    address: v.string(),
    isDefault: v.optional(v.boolean()),
    ownerUserId: v.id("users"),
    encryptedPassword: v.string(),
    enabled: v.boolean(),
    dailyLimit: v.number(),
    gapMinutes: v.number(),
    verifiedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_address", ["address"]).index("by_ownerUserId", ["ownerUserId"]),
  operatorMailboxHealth: defineTable({
    mailboxId: v.id("operatorSendingMailboxes"),
    day: v.string(),
    acceptedToday: v.number(),
    lastAttemptAt: v.optional(v.number()),
    lastAcceptedAt: v.optional(v.number()),
    sendError: v.optional(v.string()),
    syncError: v.optional(v.string()),
    lastSyncAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    nextSendAt: v.number(),
    inboxUid: v.optional(v.number()),
    inboxUidValidity: v.optional(v.string()),
    spamUid: v.optional(v.number()),
    spamUidValidity: v.optional(v.string()),
  }).index("by_mailboxId", ["mailboxId"]),
  operatorMailboxDrafts: defineTable({
    mailboxId: v.id("operatorSendingMailboxes"),
    key: v.string(),
    fingerprint: v.string(),
    payloadId: v.id("_storage"),
    messageId: v.string(),
    status: v.union(v.literal("draft"), v.literal("sending"), v.literal("sent"), v.literal("unknown"), v.literal("failed")),
    recipients: v.array(v.string()),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
    error: v.optional(v.string()),
  }).index("by_key", ["key"]).index("by_messageId", ["messageId"]).index("by_mailboxId_and_createdAt", ["mailboxId", "createdAt"]),

  // One suggested reply per conversation, to its latest inbound message.
  teamEmailReplySuggestions: defineTable({
    threadId: v.id("teamEmailThreads"),
    messageId: v.id("teamEmailMessages"),
    status: v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    reply: v.optional(v.string()),
    missing: v.optional(v.array(v.string())),
    updatedAt: v.number(),
  }).index("by_threadId", ["threadId"]),
  teamEmailThreads: defineTable({
    ownerUserId: v.optional(v.id("users")),
    source: v.union(v.literal("forward"), v.literal("outreach"), v.literal("team")),
    linkedAt: v.optional(v.number()),
    linkedByUserId: v.optional(v.id("users")),
    linkSuggestion: v.optional(v.object({
      requestId: v.id("procurementRequests"),
      clientOrgId: v.id("organizations"),
      confidence: v.number(),
      reason: v.string(),
    })),
    forwardLinkAttempt: v.optional(v.object({
      messageId: v.id("teamEmailMessages"),
      status: v.union(v.literal("claimed"), v.literal("completed"), v.literal("failed")),
      startedAt: v.number(),
      finishedAt: v.optional(v.number()),
      reason: v.optional(v.string()),
    })),
    outreachId: v.optional(v.id("procurementBrokerOutreaches")),
    resendThreadId: v.optional(v.string()),
    clientOrgId: v.optional(v.id("organizations")),
    addressedRequestId: v.optional(v.id("procurementRequests")),
    requestId: v.optional(v.id("procurementRequests")),
    normalizedSubject: v.string(),
    subject: v.string(),
    category: v.union(
      v.literal("broker"),
      v.literal("client"),
      v.literal("internal"),
      v.literal("mixed"),
      v.literal("other"),
    ),
    categorySource: v.union(v.literal("auto"), v.literal("operator")),
    categoryReason: v.optional(v.string()),
    participantEmails: v.array(v.string()),
    latestDirection: v.optional(v.union(v.literal("inbound"), v.literal("outbound"))),
    latestInboundAt: v.optional(v.number()),
    preview: v.optional(v.string()),
    latestFromName: v.optional(v.string()),
    latestFromEmail: v.optional(v.string()),
    latestSentByUserId: v.optional(v.id("users")),
    latestMessageAt: v.number(),
    messageCount: v.number(),
    archivedAt: v.optional(v.number()),
    archivedByUserId: v.optional(v.id("users")),
    deletedAt: v.optional(v.number()),
    deletedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_archivedAt_and_latestMessageAt", ["archivedAt", "latestMessageAt"])
    .index("by_ownerUserId_and_archivedAt_and_latestMessageAt", ["ownerUserId", "archivedAt", "latestMessageAt"])
    .index("by_clientOrgId_and_archivedAt_and_latestMessageAt", ["clientOrgId", "archivedAt", "latestMessageAt"])
    .index("by_requestId_and_archivedAt_and_latestMessageAt", ["requestId", "archivedAt", "latestMessageAt"])
    .index("by_category_and_archivedAt_and_latestMessageAt", ["category", "archivedAt", "latestMessageAt"])
    .index("by_archivedAt_and_latestInboundAt", ["archivedAt", "latestInboundAt"])
    .index("by_latestDirection_archivedAt_latestMessageAt", ["latestDirection", "archivedAt", "latestMessageAt"])
    .index("by_ownerUserId_latestDirection_archivedAt_latestMessageAt", ["ownerUserId", "latestDirection", "archivedAt", "latestMessageAt"])
    .index("by_clientOrgId_latestDirection_archivedAt_latestMessageAt", ["clientOrgId", "latestDirection", "archivedAt", "latestMessageAt"])
    .index("by_requestId_latestDirection_archivedAt_latestMessageAt", ["requestId", "latestDirection", "archivedAt", "latestMessageAt"])
    .index("by_category_latestDirection_archivedAt_latestMessageAt", ["category", "latestDirection", "archivedAt", "latestMessageAt"])
    .index("by_suggestedRequestId_and_latestMessageAt", ["linkSuggestion.requestId", "latestMessageAt"])
    .index("by_latestMessageAt", ["latestMessageAt"])
    .index("by_ownerUserId_and_latestMessageAt", ["ownerUserId", "latestMessageAt"])
    .index("by_clientOrgId_and_latestMessageAt", ["clientOrgId", "latestMessageAt"])
    .index("by_requestId_and_latestMessageAt", ["requestId", "latestMessageAt"])
    .index("by_addressedRequestId_and_latestMessageAt", ["addressedRequestId", "latestMessageAt"])
    .index("subject", ["clientOrgId", "normalizedSubject", "latestMessageAt"])
    .index("by_resendThreadId", ["resendThreadId"])
    .searchIndex("search_subject", { searchField: "subject", filterFields: ["clientOrgId"] }),

  teamEmailMessages: defineTable({
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    sentByUserId: v.optional(v.id("users")),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    resendThreadId: v.optional(v.string()),
    unfiledAttachments: v.optional(v.array(v.object({
      storageId: v.id("_storage"),
      name: v.string(),
      contentType: v.string(),
      size: v.number(),
      contentId: v.optional(v.string()),
    }))),
    /** Jev's first line of quoted history when no known marker finds it; null when it has none. */
    quotedHistoryStart: v.optional(v.union(v.string(), v.null())),
    /** Image attachments (clientFileId or storageId) Jev judged to be signature or decoration, not shared files. */
    decorativeAttachmentIds: v.optional(v.array(v.string())),
    /** Filed attachments that are inline `cid:` parts of `bodyHtml`. */
    inlineFiles: v.optional(v.array(v.object({
      contentId: v.string(),
      clientFileId: v.id("clientFiles"),
    }))),
    resendInboxEmailId: v.optional(v.string()),
    threadId: v.id("teamEmailThreads"),
    clientOrgId: v.optional(v.id("organizations")),
    addressedRequestId: v.optional(v.id("procurementRequests")),
    resendEmailId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.array(v.string()),
    subject: v.string(),
    fromName: v.optional(v.string()),
    fromEmail: v.string(),
    toAddresses: v.array(v.string()),
    ccAddresses: v.array(v.string()),
    bccAddresses: v.array(v.string()),
    currentText: v.string(),
    bodyHtml: v.optional(v.string()),
    forwarded: v.optional(v.any()),
    clientFileIds: v.array(v.id("clientFiles")),
    receivedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_threadId_and_receivedAt", ["threadId", "receivedAt"])
    .index("by_resendEmailId", ["resendEmailId"])
    .searchIndex("search_text", { searchField: "currentText", filterFields: ["clientOrgId"] })
    .index("by_messageId", ["messageId"])
    .index("by_resendInboxEmailId", ["resendInboxEmailId"])
    .index("request", ["addressedRequestId", "receivedAt"]),

  teamEmailThreadLinks: defineTable({
    threadId: v.id("teamEmailThreads"),
    inboxId: v.string(),
    resendThreadId: v.string(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_inboxId_and_resendThreadId", ["inboxId", "resendThreadId"])
    .index("by_resendThreadId", ["resendThreadId"]),

  teamInboxReads: defineTable({
    userId: v.id("users"),
    threadId: v.id("teamEmailThreads"),
    readAt: v.number(),
  })
    .index("by_userId_and_threadId", ["userId", "threadId"])
    .index("by_threadId", ["threadId"]),

  // Client-owned grants. The legacy table name and source request preserve evidence.
  // Signed facts are immutable; only PDF generation/publication state changes.
  requestIntakeAuthorizations: defineTable({
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    userId: v.id("users"),
    signerName: v.string(),
    signerEmail: v.string(),
    legalName: v.string(),
    dba: v.optional(v.string()),
    acceptedAt: v.number(),
    submittedAt: v.number(),
    contentHash: v.string(),
    termsVersion: v.string(),
    termsUrl: v.string(),
    statement: v.string(),
    representationTerms: v.string(),
    authorityStatement: v.string(),
    status: v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    attempts: v.number(),
    fileId: v.optional(v.id("_storage")),
    clientFileId: v.optional(v.id("clientFiles")),
    fileItemId: v.optional(v.id("procurementFileItems")),
    createdAt: v.number(),
  }).index("by_requestId", ["requestId"])
    .index("by_clientOrgId", ["clientOrgId"]),

  procurementFileItems: defineTable({
    removedAt: v.optional(v.number()),
    documentCategory: v.optional(
      v.union(
        v.literal("requirements"),
        v.literal("policy"),
        v.literal("loss_runs"),
        v.literal("supporting"),
      ),
    ),
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    outreachId: v.optional(v.id("procurementBrokerOutreaches")),
    clientFileId: v.optional(v.id("clientFiles")),
    sourceEmailMessageId: v.optional(v.id("teamEmailMessages")),
    // Deprecated: cleared by the removed simplifyProcurementFiles migration; no active writers.
    purpose: v.optional(
      v.union(
        v.literal("requirements"),
        v.literal("application"),
        v.literal("requested_document"),
        v.literal("quote"),
        v.literal("correspondence"),
        v.literal("other"),
      ),
    ),
    label: v.string(),
    // Deprecated: cleared by the removed simplifyProcurementFiles migration; no active writers.
    status: v.optional(
      v.union(
        v.literal("requested"),
        v.literal("available"),
        v.literal("sent"),
        v.literal("received"),
      ),
    ),
    brokerRelease: v.optional(
      v.union(v.literal("hidden"), v.literal("listed"), v.literal("attached")),
    ),
    // Deprecated: cleared by the removed simplifyProcurementFiles migration; no active writers.
    brokerReleaseProposed: v.optional(
      v.union(v.literal("listed"), v.literal("attached")),
    ),
    clientVisible: v.optional(v.boolean()),
    createdByUserId: v.optional(v.id("users")),
    updatedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("request", ["requestId", "updatedAt"])
    .index("file", ["clientFileId", "updatedAt"])
    .index("by_requestId_and_clientFileId", ["requestId", "clientFileId"])
    .index("email", ["sourceEmailMessageId"])
    .index("release", ["requestId", "brokerRelease", "updatedAt"]),

  companyInformationExtractions: defineTable({
    orgId: v.id("organizations"),
    sourceKind: v.union(
      v.literal("client_file"),
      v.literal("procurement_email_thread"),
    ),
    sourceRef: v.string(),
    clientFileId: v.optional(v.id("clientFiles")),
    teamEmailThreadId: v.optional(v.id("teamEmailThreads")),
    requestId: v.optional(v.id("procurementRequests")),
    actorUserId: v.id("users"),
    sourceFingerprint: v.string(),
    appliedFingerprint: v.optional(v.string()),
    extractionVersion: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    leaseExpiresAt: v.optional(v.number()),
    // Deprecated: cleared by the removed removeCompanyExtractionProfiles migration; no active writers.
    profile: v.optional(companyInformationProfileValidator),
    organizationFacts: v.optional(
      v.array(companyInformationOrganizationFactValidator),
    ),
    observedAt: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("source", ["sourceRef"])
    .index("organization", ["orgId", "updatedAt"])
    .index("file", ["clientFileId"])
    .index("team_email", ["teamEmailThreadId"]),

  policyVersions: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    versionNumber: v.number(),
    versionKind: policyVersionKindValidator,
    effectiveDate: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    policyNumber: v.optional(v.string()),
    sourcePolicyFileIds: v.optional(v.array(v.id("policyFiles"))),
    sourceFileIds: v.optional(v.array(v.id("_storage"))),
    extractionRunId: v.optional(v.id("policyExtractionRuns")),
    snapshot: v.optional(v.any()),
    fieldDiffs: v.optional(v.array(v.any())),
    summary: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("organization", ["orgId"])
    .index("policy", ["policyId"])
    .index("policy_version", ["policyId", "versionNumber"])
    .index("policy_created", ["policyId", "createdAt"]),

  certificateHolders: defineTable({
    orgId: v.id("organizations"),
    displayName: v.string(),
    normalizedName: v.string(),
    contactName: v.optional(v.string()),
    email: v.optional(v.string()),
    normalizedEmail: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(certificateHolderAddressValidator),
    normalizedAddressKey: v.optional(v.string()),
    mapboxFeatureId: v.optional(v.string()),
    mapboxMetadata: v.optional(v.any()),
    source: v.optional(
      v.union(
        v.literal("manual"),
        v.literal("extraction"),
        v.literal("certificate_generation"),
        v.literal("migration"),
        v.literal("api"),
        v.literal("mcp"),
        v.literal("agent"),
      ),
    ),
    sourceRef: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    updatedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("organization", ["orgId"])
    .index("organization_name", ["orgId", "normalizedName"])
    .index("organization_email", ["orgId", "normalizedEmail"])
    .index("organization_address", ["orgId", "normalizedAddressKey"]),

  certificateHolderPolicyLinks: defineTable({
    orgId: v.id("organizations"),
    holderId: v.id("certificateHolders"),
    policyId: v.id("policies"),
    policyVersionId: v.optional(v.id("policyVersions")),
    relationshipKind: certificateHolderRelationshipKindValidator,
    status: v.union(
      v.literal("current"),
      v.literal("historical"),
      v.literal("review_required"),
      v.literal("dismissed"),
    ),
    sourceNodeIds: v.optional(v.array(v.string())),
    sourceSpanIds: v.optional(v.array(v.string())),
    sourceSummary: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    updatedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("organization", ["orgId"])
    .index("holder", ["holderId"])
    .index("policy", ["policyId"])
    .index("policy_status", ["policyId", "status"])
    .index("policy_version", ["policyVersionId"]),

  policyCertificates: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    holderId: v.id("certificateHolders"),
    requirementSourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    status: certificateParentStatusValidator,
    dedupeKey: v.string(),
    currentVersionId: v.optional(v.id("certificateVersions")),
    latestIssuedVersionId: v.optional(v.id("certificateVersions")),
    formCode: v.optional(certificateFormCodeValidator),
    lastIssuedAt: v.optional(v.number()),
    source: v.optional(certificateSourceValidator),
    archivedAt: v.optional(v.number()),
    archivedByUserId: v.optional(v.id("users")),
    createdByUserId: v.optional(v.id("users")),
    updatedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("organization", ["orgId"])
    .index("policy", ["policyId"])
    .index("holder", ["holderId"])
    .index("source", ["requirementSourceDocumentId"])
    .index("organization_status", ["orgId", "status"])
    .index("policy_status", ["policyId", "status"])
    .index("dedupe", ["dedupeKey"]),

  certificateVersions: defineTable({
    orgId: v.id("organizations"),
    certificateId: v.id("policyCertificates"),
    holderId: v.id("certificateHolders"),
    policyId: v.id("policies"),
    policyVersionId: v.optional(v.id("policyVersions")),
    versionNumber: v.number(),
    status: certificateVersionStatusValidator,
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    certificateHolder: v.optional(v.string()),
    certificateHolderName: v.optional(v.string()),
    holderSnapshot: v.optional(v.any()),
    policySnapshot: v.optional(v.any()),
    policySnapshotHash: v.optional(v.string()),
    source: v.optional(certificateSourceValidator),
    requestKind: v.optional(certificateRequestKindValidator),
    additionalInsuredName: v.optional(v.string()),
    descriptionOfOperations: v.optional(v.string()),
    requirementIds: v.optional(v.array(v.id("insuranceRequirements"))),
    requirementSourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    requirementSnapshots: v.optional(
      v.array(certificateRequirementSnapshotValidator),
    ),
    generationBatchId: v.optional(v.string()),
    formCode: v.optional(certificateFormCodeValidator),
    requestSignature: v.optional(v.string()),
    // Widening bridge for certificate versions created before holder-backed
    // policy certificates became canonical. Runtime writers leave this unset.
    legacyCertificateId: v.optional(v.id("certificates")),
    issuedAt: v.optional(v.number()),
    supersededAt: v.optional(v.number()),
    voidedAt: v.optional(v.number()),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("organization", ["orgId"])
    .index("certificate", ["certificateId"])
    .index("certificate_version", ["certificateId", "versionNumber"])
    .index("policy", ["policyId"])
    .index("policy_version", ["policyVersionId"])
    .index("holder", ["holderId"])
    .index("source", ["requirementSourceDocumentId"])
    .index("file", ["fileId"]),

  certificates: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    certificateHolder: v.optional(v.string()),
    certificateHolderName: v.optional(v.string()),
    source: v.optional(
      v.union(
        v.literal("policy_page"),
        v.literal("chat"),
        v.literal("email"),
        v.literal("imessage"),
        v.literal("slack"),
        v.literal("sms"),
        v.literal("api"),
        v.literal("mcp"),
        v.literal("agent"),
        v.literal("unknown"),
      ),
    ),
    createdByUserId: v.optional(v.id("users")),
    requestKind: v.optional(certificateRequestKindValidator),
    additionalInsuredName: v.optional(v.string()),
    descriptionOfOperations: v.optional(v.string()),
    requirementIds: v.optional(v.array(v.id("insuranceRequirements"))),
    requirementSourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    requirementSnapshots: v.optional(
      v.array(certificateRequirementSnapshotValidator),
    ),
    generationBatchId: v.optional(v.string()),
    formCode: v.optional(certificateFormCodeValidator),
    requestSignature: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("policy", ["policyId"])
    .index("organization", ["orgId"])
    .index("source", ["requirementSourceDocumentId"])
    .index("file", ["fileId"]),

  certificateRequestHolds: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    holderName: v.string(),
    certificateHolder: v.optional(v.string()),
    requestText: v.optional(v.string()),
    requestedEndorsements: v.optional(v.array(v.string())),
    requirementIds: v.optional(v.array(v.id("insuranceRequirements"))),
    requirementSourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    requirementSnapshots: v.optional(
      v.array(certificateRequirementSnapshotValidator),
    ),
    generationBatchId: v.optional(v.string()),
    source: v.optional(
      v.union(
        v.literal("policy_page"),
        v.literal("chat"),
        v.literal("email"),
        v.literal("imessage"),
        v.literal("slack"),
        v.literal("sms"),
        v.literal("api"),
        v.literal("mcp"),
        v.literal("agent"),
        v.literal("unknown"),
      ),
    ),
    status: v.union(
      v.literal("held"),
      v.literal("broker_handoff_offered"),
      v.literal("resolved"),
      v.literal("cancelled"),
    ),
    reasonCode: v.union(
      v.literal("policy_change_required"),
      v.literal("missing_policy_evidence"),
      v.literal("ambiguous_policy_evidence"),
      v.literal("conflicting_policy_evidence"),
    ),
    reasonMessage: v.string(),
    requiredChanges: v.array(v.string()),
    evidence: v.optional(v.any()),
    emailDraft: v.optional(certificateEmailDraftValidator),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("organization", ["orgId"])
    .index("policy", ["policyId"])
    .index("source", ["requirementSourceDocumentId"])
    .index("status", ["status"]),

  // ── Operator notifications (separate from tenant notifications) ──

  operatorNotificationRoutes: defineTable({
    category: operatorNotificationCategoryValidator,
    enabled: v.boolean(),
    teamId: v.optional(v.string()),
    channelId: v.optional(v.string()),
    channelName: v.optional(v.string()),
    revision: v.number(),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_category", ["category"]),

  operatorNotificationEvents: defineTable({
    eventKey: v.string(),
    category: operatorNotificationCategoryValidator,
    target: operatorNotificationTargetValidator,
    status: operatorNotificationStatusValidator,
    teamId: v.optional(v.string()),
    channelId: v.optional(v.string()),
    routeRevision: v.optional(v.number()),
    attempts: v.number(),
    nextAttemptAt: v.optional(v.number()),
    leaseToken: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    providerMessageId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    sentAt: v.optional(v.number()),
  })
    .index("by_eventKey", ["eventKey"])
    .index("by_status_and_nextAttemptAt", ["status", "nextAttemptAt"])
    .index("by_status_and_leaseUntil", ["status", "leaseUntil"])
    .index("by_category_and_createdAt", ["category", "createdAt"])
    .index("by_category_and_status", ["category", "status"]),

  // ── Notifications ──

  notifications: defineTable({
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")), // null = org-wide
    type: activeNotificationTypeValidator,
    title: v.string(),
    body: v.string(),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical"),
    ),
    status: v.union(
      v.literal("unread"),
      v.literal("read"),
      v.literal("actioned"),
      v.literal("dismissed"),
    ),
    actionType: v.optional(notificationActionTypeValidator),
    actionPayload: v.optional(notificationActionPayloadValidator),
    sourceRef: v.optional(notificationSourceRefValidator),
    createdAt: v.number(),
    // Cross-org context
    relatedOrgId: v.optional(v.id("organizations")),
    // Coalesce fields
    coalesceKey: v.optional(v.string()),
    coalescedCount: v.optional(v.number()),
    lastEventAt: v.optional(v.number()),
    // Email delivery
    emailStatus: v.optional(
      v.union(
        v.literal("not_scheduled"),
        v.literal("scheduled"),
        v.literal("sent"),
        v.literal("suppressed_by_preference"),
        v.literal("failed"),
      ),
    ),
    emailSentAt: v.optional(v.number()),
    imessageStatus: v.optional(
      v.union(
        v.literal("not_scheduled"),
        v.literal("scheduled"),
        v.literal("sent"),
        v.literal("suppressed_by_preference"),
        v.literal("failed"),
      ),
    ),
    imessageSentAt: v.optional(v.number()),
    slackStatus: v.optional(
      v.union(
        v.literal("not_scheduled"),
        v.literal("scheduled"),
        v.literal("sent"),
        v.literal("suppressed_by_preference"),
        v.literal("failed"),
      ),
    ),
    slackSentAt: v.optional(v.number()),
  })
    .index("organization", ["orgId"])
    .index("organization_status", ["orgId", "status"])
    .index("organization_type", ["orgId", "type"])
    .index("user", ["userId"])
    .index("coalesce_status", ["orgId", "coalesceKey", "status"]),

  notificationPreferences: defineTable({
    userId: v.id("users"),
    orgId: v.id("organizations"),
    type: v.string(), // matches notifications.type or "__all__"
    channel: notificationChannelValidator,
    enabled: v.boolean(),
    updatedAt: v.number(),
  })
    .index("user_organization", ["userId", "orgId"])
    .index("preference_scope", ["userId", "orgId", "type", "channel"]),

  // Raw source spans from PDFs, emails, attachments, and manual notes.
  // These are stable evidence units used to ground exact policy values.
  sourceSpans: defineTable({
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    spanId: v.string(),
    documentId: v.string(),
    sourceKind: v.union(
      v.literal("policy_pdf"),
      v.literal("email"),
      v.literal("attachment"),
      v.literal("manual_note"),
    ),
    pageStart: v.optional(v.number()),
    pageEnd: v.optional(v.number()),
    sectionId: v.optional(v.string()),
    formNumber: v.optional(v.string()),
    sourceUnit: v.optional(v.string()),
    parentSpanId: v.optional(v.string()),
    table: v.optional(v.any()),
    location: v.optional(v.any()),
    text: v.string(),
    textHash: v.string(),
    bbox: v.optional(v.any()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("policy", ["policyId"])
    .index("organization", ["orgId"])
    .index("span", ["spanId"])
    .index("policy_span", ["policyId", "spanId"])
    .index("policy_parent", ["policyId", "parentSpanId"])
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["policyId", "sourceUnit"],
    }),

  // Source-tree hierarchy over raw source spans. This is the canonical
  // retrieval/index layer for policy wording and source-backed facts.
  sourceNodes: defineTable({
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    nodeId: v.string(),
    documentId: v.string(),
    parentNodeId: v.optional(v.string()),
    kind: v.string(),
    title: v.string(),
    description: v.string(),
    textExcerpt: v.optional(v.string()),
    sourceSpanIds: v.array(v.string()),
    pageStart: v.optional(v.number()),
    pageEnd: v.optional(v.number()),
    bbox: v.optional(v.any()),
    order: v.number(),
    path: v.string(),
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
  })
    .index("policy", ["policyId"])
    .index("organization", ["orgId"])
    .index("node", ["nodeId"])
    .index("policy_node", ["policyId", "nodeId"])
    .index("policy_parent", ["policyId", "parentNodeId"])
    .searchIndex("search_description", {
      searchField: "description",
      filterFields: ["policyId"],
    }),

  policyDeclarationFacts: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    policyFileId: v.optional(v.id("policyFiles")),
    fieldPath: v.string(),
    fieldGroup: v.string(),
    displayValue: v.string(),
    normalizedValue: v.string(),
    structuredValue: v.optional(v.any()),
    valueKind: v.union(
      v.literal("string"),
      v.literal("number"),
      v.literal("date"),
      v.literal("money"),
      v.literal("address"),
      v.literal("list"),
      v.literal("unknown"),
    ),
    sourceNodeIds: v.optional(v.array(v.string())),
    sourceSpanIds: v.optional(v.array(v.string())),
    effectiveDate: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    policyYear: v.optional(v.number()),
    observedAt: v.number(),
    active: v.boolean(),
    recordHash: v.string(),
  })
    .index("organization", ["orgId"])
    .index("policy", ["policyId"])
    .index("organization_group", ["orgId", "fieldGroup"])
    .index("policy_active", ["policyId", "active"])
    .index("record", ["recordHash"]),

  policyAuditLog: defineTable({
    policyId: v.optional(v.id("policies")),
    userId: v.id("users"),
    orgId: v.optional(v.id("organizations")),
    action: v.string(),
    detail: v.optional(v.string()),
    metadata: v.optional(v.any()),
  })
    .index("policy", ["policyId"])
    .index("organization", ["orgId"]),

  // ── Unified Threads ──

  threads: defineTable({
    orgId: v.id("organizations"),
    title: v.string(),
    threadEmail: v.optional(v.string()),
    createdBy: v.id("users"),
    clientMutationId: v.optional(v.string()),
    lastMessageAt: v.number(),
    archivedAt: v.optional(v.number()),
    originChannel: v.optional(
      v.union(
        v.literal("chat"),
        v.literal("email"),
        v.literal("imessage"),
        v.literal("slack"),
      ),
    ),
    emailMode: v.optional(
      v.union(
        v.literal("direct"),
        v.literal("cc"),
        v.literal("forward"),
        v.literal("unknown"),
      ),
    ),
    initialContext: v.optional(
      v.object({
        pageType: v.string(),
        entityId: v.optional(v.string()),
        summary: v.optional(v.string()),
      }),
    ),
    pageContext: v.optional(
      v.union(
        v.object({
          pageType: v.string(),
          entityId: v.optional(v.string()),
          summary: v.optional(v.string()),
        }),
        v.null(),
      ),
    ),
    visibility: v.optional(
      v.union(
        v.literal("broker_visible"),
        v.literal("client_internal"),
        v.literal("user_private"),
      ),
    ),
    threadPhone: v.optional(v.string()),
    imessageChatGuid: v.optional(v.string()),
    imessageIsGroup: v.optional(v.boolean()),
    imessageScope: v.optional(
      v.union(v.literal("single_org"), v.literal("multi_org")),
    ),
    // Direct iMessage threads are isolated by the owner's privacy generation.
    // Legacy rows without this field belong to generation 0.
    imessageHistoryGeneration: v.optional(v.number()),
    slackConnectionId: v.optional(v.id("slackWorkspaceConnections")),
    slackChannelId: v.optional(v.string()),
    slackThreadTs: v.optional(v.string()),
    slackConversationKind: v.optional(
      v.union(v.literal("channel"), v.literal("direct_message")),
    ),
    slackState: v.optional(
      v.union(
        v.literal("active"),
        v.literal("human_paused"),
        v.literal("resolved"),
      ),
    ),
  })
    .index("organization", ["orgId"])
    .index("organization_activity", ["orgId", "lastMessageAt"])
    .index("organization_mutation", ["orgId", "clientMutationId"])
    .index("email", ["threadEmail"])
    .index("phone", ["threadPhone"])
    .index("organization_phone", ["orgId", "threadPhone"])
    .index("chat", ["imessageChatGuid"])
    .index("organization_chat", ["orgId", "imessageChatGuid"])
    .index("private_history", [
      "createdBy",
      "originChannel",
      "visibility",
      "imessageHistoryGeneration",
    ])
    .index("slack_thread", [
      "slackConnectionId",
      "slackChannelId",
      "slackThreadTs",
    ]),

  threadMessages: defineTable({
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    clientMutationId: v.optional(v.string()),
    channel: v.union(
      v.literal("chat"),
      v.literal("email"),
      v.literal("imessage"),
      v.literal("slack"),
    ),
    role: v.union(v.literal("user"), v.literal("agent"), v.literal("system")),
    messageKind: v.optional(threadMessageKindValidator),
    sourceThreadMessageId: v.optional(v.id("threadMessages")),
    dedupeKey: v.optional(v.string()),
    // User messages
    userId: v.optional(v.id("users")),
    userName: v.optional(v.string()),
    operatorInitiated: v.optional(operatorInitiatedMessageValidator),
    imessageSenderAddress: v.optional(v.string()),
    imessageParticipantLabel: v.optional(v.string()),
    slackActorId: v.optional(v.id("slackActors")),
    slackTeamId: v.optional(v.string()),
    slackUserId: v.optional(v.string()),
    slackMessageTs: v.optional(v.string()),
    slackEditedAt: v.optional(v.number()),
    slackDeletedAt: v.optional(v.number()),
    slackDeliveryStatus: v.optional(
      v.union(v.literal("sending"), v.literal("sent"), v.literal("failed")),
    ),
    slackDeliveryError: v.optional(v.string()),
    // Email messages
    fromEmail: v.optional(v.string()),
    fromName: v.optional(v.string()),
    toAddresses: v.optional(v.array(v.string())),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    messageId: v.optional(v.string()),
    responseMessageId: v.optional(v.string()),
    resendEmailId: v.optional(v.string()),
    // Content
    content: v.string(),
    presentation: v.optional(chatPresentationValidator),
    presentationRevision: v.optional(v.number()),
    contentHtml: v.optional(v.string()),
    emailContent: v.optional(emailContentValidator),
    // Reasoning / thinking content (for models that support it)
    reasoning: v.optional(v.string()),
    // Ordered activity timeline: reasoning segments interleaved with tool calls
    agentSteps: v.optional(agentStepsValidator),
    // Attachments
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          contentType: v.string(),
          size: v.number(),
          fileId: v.optional(v.id("_storage")),
          kind: v.optional(pendingEmailAttachmentKindValidator),
        }),
      ),
    ),
    // Agent response metadata
    routerRequestId: v.optional(v.string()),
    // Deprecated: rating removed; drop after data cleanup.
    feedbackPromptedAt: v.optional(v.number()),
    replyToMessageId: v.optional(v.id("threadMessages")),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedRequirementIds: v.optional(
      v.array(v.id("insuranceRequirements")),
    ),
    referencedMailboxIds: v.optional(v.array(v.id("connectedEmailAccounts"))),
    /** Thread page context in effect when a user message was sent. */
    pageContext: v.optional(
      v.object({
        pageType: v.string(),
        entityId: v.optional(v.string()),
        summary: v.optional(v.string()),
      }),
    ),
    // Sections cited by the agent (titles captured from lookup_policy_section tool results)
    citedSections: v.optional(v.array(v.string())),
    // Structured coverage names cited by the agent when tool results match policy coverages
    citedCoverageNames: v.optional(v.array(v.string())),
    // Stable raw source spans cited by lookup_policy_section tool results
    citedSourceSpanIds: v.optional(v.array(v.string())),
    // Tool names used while producing the response, in call order
    usedTools: v.optional(v.array(v.string())),
    // Exact tool calls made while producing the response
    toolCalls: v.optional(
      v.array(
        v.object({
          name: v.string(),
          toolCallId: v.optional(v.string()),
          input: v.optional(v.string()),
          output: v.optional(v.string()),
        }),
      ),
    ),
    activity: v.optional(messageActivityValidator),
    failure: v.optional(routerJobFailureValidator),
    toolArtifacts: v.optional(
      v.array(
        v.object({
          type: v.string(),
          data: v.any(),
        }),
      ),
    ),
    // Status
    status: v.optional(
      v.union(
        v.literal("processing"),
        v.literal("error"),
        v.literal("pending_send"),
        v.literal("draft_email"),
        v.literal("cancelled"),
      ),
    ),
    agentRunStartedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    // Jev decision on whether this user message explicitly authorizes sending
    // the pending/draft email now (convex/lib/emailSendAuthorization.ts).
    emailSendAuthorization: v.optional(
      v.object({
        sendProbability: v.number(),
        negatedProbability: v.number(),
        model: v.string(),
        decidedAt: v.number(),
      }),
    ),
  })
    .index("thread", ["threadId"])
    .index("organization_mutation", ["orgId", "clientMutationId"])
    .index("message", ["messageId"])
    .index("response", ["responseMessageId"])
    .index("resend", ["resendEmailId"])
    .index("reply", ["replyToMessageId"])
    .index("thread_message", ["threadId", "slackMessageTs"])
    .index("team_message", ["slackTeamId", "slackMessageTs"])
    .index("thread_dedupe", ["threadId", "dedupeKey"])
    .searchIndex("content", {
      searchField: "content",
      filterFields: ["threadId"],
    }),

  threadContextStates: defineTable({
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    continuityMode: v.union(v.literal("thread_long"), v.literal("task_scoped")),
    taskEpoch: v.number(),
    taskStartedAt: v.number(),
    lastUserMessageAt: v.optional(v.number()),
    summary: v.optional(v.string()),
    summarizedThroughMessageId: v.optional(v.id("threadMessages")),
    summarizedThroughCreatedAt: v.optional(v.number()),
    summaryVersion: v.number(),
    status: v.union(
      v.literal("idle"),
      v.literal("scheduled"),
      v.literal("ready"),
      v.literal("error"),
    ),
    attemptCount: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("thread", ["threadId"]),

  threadActionConfirmations: defineTable({
    orgId: v.id("organizations"),
    threadId: v.id("threads"),
    actor: threadActionActorValidator,
    promptMessageId: v.id("threadMessages"),
    payload: threadActionConfirmationPayloadValidator,
    taskEpoch: v.number(),
    status: threadActionConfirmationStatusValidator,
    expiresAt: v.optional(v.number()), // Legacy expiry; validity follows current state.
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    invalidatedAt: v.optional(v.number()),
    invalidationReason: v.optional(v.string()),
  }).index("thread_status", ["threadId", "status"]),

  imessagePrivacyStates: defineTable({
    userId: v.id("users"),
    historyGeneration: v.number(),
    activeDeletionJobId: v.optional(v.id("imessageHistoryDeletionJobs")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("user", ["userId"]),

  imessageAgentRunLeases: defineTable({
    userId: v.id("users"),
    threadId: v.optional(v.id("threads")),
    generation: v.number(),
    leaseKey: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("lease", ["leaseKey"])
    .index("thread", ["threadId"])
    .index("user_expiration", ["userId", "expiresAt"]),

  imessageHistoryDeletionJobs: defineTable({
    userId: v.id("users"),
    kind: v.union(v.literal("preview"), v.literal("deletion")),
    status: v.union(
      v.literal("preparing"),
      v.literal("ready"),
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    generationCutoff: v.number(),
    threadCount: v.number(),
    messageCount: v.number(),
    fileCount: v.number(),
    processedThreadCount: v.number(),
    deletedMessageCount: v.number(),
    deletedFileCount: v.number(),
    preservedFileCount: v.number(),
    requestedAt: v.number(),
    readyAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
    lastError: v.optional(v.string()),
  }).index("user_requested", ["userId", "requestedAt"]),

  imessageHistoryDeletionTargets: defineTable({
    jobId: v.id("imessageHistoryDeletionJobs"),
    threadId: v.id("threads"),
    chatGuid: v.optional(v.string()),
    status: v.union(
      v.literal("pending_inventory"),
      v.literal("inventoried"),
      v.literal("deleting"),
      v.literal("completed"),
    ),
    stage: v.optional(
      v.union(
        v.literal("connected_email"),
        v.literal("certificate_workflow"),
        v.literal("audit"),
        v.literal("outbound"),
        v.literal("app_cards"),
        v.literal("email_draft_links"),
        v.literal("pending_email"),
        v.literal("delivery_attempt"),
        v.literal("inbound_event"),
        v.literal("legacy_inbound_event"),
        v.literal("leases"),
        v.literal("messages"),
        v.literal("summary"),
        v.literal("files"),
        v.literal("thread"),
      ),
    ),
    inventoryCursor: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("job_thread", ["jobId", "threadId"])
    .index("job_status", ["jobId", "status"]),

  imessageHistoryDeletionFiles: defineTable({
    jobId: v.id("imessageHistoryDeletionJobs"),
    targetId: v.id("imessageHistoryDeletionTargets"),
    fileId: v.id("_storage"),
    status: v.union(
      v.literal("pending"),
      v.literal("preserved"),
      v.literal("deleted"),
    ),
    reason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("job_file", ["jobId", "fileId"])
    .index("target_status", ["targetId", "status"]),

  slackInboundEvents: defineTable({
    eventKey: v.string(),
    canonicalEventKey: v.optional(v.string()),
    providerEventId: v.optional(v.string()),
    connectionId: v.optional(v.id("slackWorkspaceConnections")),
    teamId: v.string(),
    channelId: v.string(),
    threadTs: v.string(),
    replyThreadTs: v.optional(v.string()),
    messageTs: v.string(),
    senderTeamId: v.optional(v.string()),
    senderUserId: v.string(),
    senderDisplayName: v.optional(v.string()),
    senderEmail: v.optional(v.string()),
    senderIsBot: v.optional(v.boolean()),
    content: v.string(),
    attachments: v.optional(v.array(slackStoredAttachmentValidator)),
    eventType: v.union(
      v.literal("message"),
      v.literal("edit"),
      v.literal("delete"),
    ),
    isDirectMessage: v.optional(v.boolean()),
    isPrivateChannel: v.optional(v.boolean()),
    isPrimaryChannel: v.boolean(),
    mentionsSpot: v.boolean(),
    mentionedBotUserId: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("ignored"),
      v.literal("error"),
    ),
    attemptCount: v.number(),
    error: v.optional(v.string()),
    receivedAt: v.number(),
    scheduledFor: v.number(),
    updatedAt: v.number(),
  })
    .index("event", ["eventKey"])
    .index("canonical", ["canonicalEventKey"])
    .index("slack_thread", ["connectionId", "channelId", "threadTs"])
    .index("thread_message", [
      "connectionId",
      "channelId",
      "threadTs",
      "messageTs",
    ])
    .index("thread_schedule", [
      "connectionId",
      "channelId",
      "threadTs",
      "status",
      "scheduledFor",
    ])
    .index("status_received", ["status", "receivedAt"]),

  slackMessageRevisions: defineTable({
    threadMessageId: v.id("threadMessages"),
    slackTeamId: v.string(),
    slackMessageTs: v.string(),
    previousContent: v.string(),
    revisedContent: v.string(),
    editedAt: v.number(),
  })
    .index("message_edited", ["threadMessageId", "editedAt"])
    .index("team_message", ["slackTeamId", "slackMessageTs"]),

  slackOutboundSends: defineTable({
    idempotencyKey: v.string(),
    orgId: v.id("organizations"),
    threadId: v.optional(v.id("threads")),
    threadMessageId: v.optional(v.id("threadMessages")),
    connectionId: v.id("slackWorkspaceConnections"),
    channelId: v.string(),
    threadTs: v.optional(v.string()),
    keepAttachmentsTopLevel: v.optional(v.boolean()),
    content: v.string(),
    blocks: v.optional(v.array(v.any())),
    attachments: v.optional(
      v.array(
        v.object({
          fileId: v.id("_storage"),
          filename: v.string(),
          contentType: v.string(),
        }),
      ),
    ),
    status: v.union(
      v.literal("sending"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("blocked"),
    ),
    providerMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
    providerErrorCode: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
    attemptCount: v.number(),
    nextAttemptAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("idempotency", ["idempotencyKey"])
    .index("message", ["threadMessageId"])
    .index("connection_status", ["connectionId", "status"])
    .index("retry_schedule", ["connectionId", "status", "nextAttemptAt"]),

  // Short-lived Web API send claims keyed by caller clientMessageId.
  slackSendReceipts: defineTable({
    clientMessageId: v.string(),
    status: v.union(v.literal("sending"), v.literal("sent")),
    messageId: v.optional(v.string()),
    expiresAt: v.number(),
  }).index("by_clientMessageId", ["clientMessageId"]),

  operatorSlackOutboundSends: defineTable({
    idempotencyKey: v.string(),
    senderOperatorUserId: v.id("users"),
    recipientOperatorUserId: v.id("users"),
    teamId: v.string(),
    recipientSlackUserId: v.string(),
    recipientEmail: v.string(),
    content: v.string(),
    status: v.union(
      v.literal("sending"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    providerMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
    providerErrorCode: v.optional(v.string()),
    attemptCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("operator_idempotency", ["senderOperatorUserId", "idempotencyKey"])
    .index("recipient_status", ["recipientOperatorUserId", "status"]),

  slackMessagePresentations: defineTable({
    orgId: v.id("organizations"),
    threadId: v.id("threads"),
    threadMessageId: v.id("threadMessages"),
    connectionId: v.id("slackWorkspaceConnections"),
    teamId: v.string(),
    channelId: v.string(),
    threadTs: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    mode: v.union(v.literal("message"), v.literal("stream")),
    phase: v.union(
      v.literal("starting"),
      v.literal("active"),
      v.literal("final"),
      v.literal("failed"),
    ),
    revision: v.number(),
    renderVersion: v.number(),
    lastPayloadHash: v.optional(v.string()),
    processingReaction: v.optional(v.string()),
    actionTokenHash: v.string(),
    actionTokenExpiresAt: v.optional(v.number()), // Legacy expiry.
    actionTokenRevokedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    providerErrorCode: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("message", ["threadMessageId"])
    .index("action", ["actionTokenHash"])
    .index("channel_message", [
      "connectionId",
      "channelId",
      "providerMessageId",
    ]),

  slackInteractionEvents: defineTable({
    interactionKey: v.string(),
    presentationId: v.id("slackMessagePresentations"),
    connectionId: v.id("slackWorkspaceConnections"),
    actorId: v.id("slackActors"),
    actionId: v.string(),
    value: v.optional(v.string()),
    status: v.union(
      v.literal("processing"),
      v.literal("completed"),
      v.literal("ignored"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("interaction", ["interactionKey"])
    .index("presentation_created", ["presentationId", "createdAt"]),

  // Deprecated: rating removed; drop after data cleanup.
  agentResponseFeedback: defineTable({
    orgId: v.id("organizations"),
    threadId: v.id("threads"),
    threadMessageId: v.id("threadMessages"),
    routerRequestId: v.optional(v.string()),
    source: v.union(
      v.literal("web"),
      v.literal("slack"),
      v.literal("imessage"),
    ),
    userId: v.optional(v.id("users")),
    slackActorId: v.optional(v.id("slackActors")),
    imessageSenderAddress: v.optional(v.string()),
    rating: v.union(v.literal("positive"), v.literal("negative")),
    comment: v.optional(v.string()),
    routerSignalStatus: v.optional(
      v.union(
        v.literal("not_applicable"),
        v.literal("pending"),
        v.literal("submitted"),
        v.literal("error"),
      ),
    ),
    routerSignalAttempts: v.optional(v.number()),
    routerSignalError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("message_actor", ["threadMessageId", "slackActorId"])
    .index("message_user", ["threadMessageId", "userId"])
    .index("message_sender", ["threadMessageId", "imessageSenderAddress"])
    .index("router_signal", ["routerSignalStatus", "createdAt"])
    .index("organization_created", ["orgId", "createdAt"]),

  slackHandoffs: defineTable({
    clientOrgId: v.id("organizations"),
    connectionId: v.id("slackWorkspaceConnections"),
    sourceChannelId: v.string(),
    sourceThreadTs: v.string(),
    primaryChannelId: v.string(),
    primaryThreadTs: v.optional(v.string()),
    sourceThreadId: v.optional(v.id("threads")),
    primaryThreadId: v.optional(v.id("threads")),
    createdByActorId: v.id("slackActors"),
    status: v.union(v.literal("open"), v.literal("resolved")),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("source_thread", [
      "connectionId",
      "sourceChannelId",
      "sourceThreadTs",
    ])
    .index("client_status", ["clientOrgId", "status"]),

  operatorEmailReceipts: defineTable({
    providerId: v.string(),
    inboxId: v.optional(v.string()),
    resendThreadId: v.optional(v.string()),
    resendInboxEmailId: v.optional(v.string()),
    emailReadOnly: v.optional(v.boolean()),
    messageId: v.string(),
    operatorUserId: v.id("users"),
    sender: v.string(),
    subject: v.string(),
    threadId: v.id("operatorAgentThreads"),
    runId: v.id("operatorAgentRuns"),
    createdAt: v.number(),
  })
    .index("provider", ["providerId"])
    .index("sender_message", ["operatorUserId", "messageId"]),

  operatorEmailDeliveries: defineTable({
    receiptId: v.id("operatorEmailReceipts"),
    phase: v.string(),
    text: v.string(),
    attempts: v.number(),
    leaseUntil: v.number(),
    messageId: v.string(),
    status: v.union(
      v.literal("sending"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
  }).index("receipt_phase", ["receiptId", "phase"]),

  operatorThreadContextStates: defineTable({
    cutoffCreatedAt: v.optional(v.number()),
    threadId: v.id("operatorAgentThreads"),
    summary: v.optional(v.string()),
    summaryVersion: v.number(),
    summarizedThroughMessageId: v.optional(v.id("operatorAgentMessages")),
    summarizedThroughCreatedAt: v.optional(v.number()),
    generation: v.number(),
    status: v.union(v.literal("scheduled"), v.literal("ready"), v.literal("error")),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_threadId", ["threadId"]),

  operatorAgentThreads: defineTable({
    resendThreadId: v.optional(v.string()),
    ownerUserId: v.id("users"),
    visibility: v.union(v.literal("private"), v.literal("shared")),
    channel: v.union(
      v.literal("chat"),
      v.literal("slack"),
      v.literal("imessage"),
      v.literal("email"),
      v.literal("mcp"),
    ),
    conversationKey: v.optional(v.string()),
    title: v.string(),
    initialContext: v.optional(
      v.object({
        pageType: v.string(),
        entityId: v.optional(v.string()),
        summary: v.optional(v.string()),
        href: v.optional(v.string()),
      }),
    ),
    pageContext: v.optional(
      v.union(
        v.object({
          pageType: v.string(),
          entityId: v.optional(v.string()),
          summary: v.optional(v.string()),
          href: v.optional(v.string()),
        }),
        v.null(),
      ),
    ),
    lastMessageAt: v.number(),
    archivedAt: v.optional(v.number()),
    archiveState: v.optional(v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_resendThreadId", ["resendThreadId"])
    .index("owner_archive", ["ownerUserId", "archiveState", "lastMessageAt"])
    .index("visibility_archive", [
      "visibility",
      "archiveState",
      "lastMessageAt",
    ])
    .index("archive_last_message", ["archiveState", "lastMessageAt"])
    .index("archive_channel_last_message", [
      "archiveState",
      "channel",
      "lastMessageAt",
    ])
    .index("owner_conversation", ["ownerUserId", "channel", "conversationKey"])
    .index("channel_conversation", ["channel", "conversationKey"]),

  // Cached Jev ranking of live operator suggestions, per operator and page.
  operatorSuggestionRankings: defineTable({
    operatorUserId: v.id("users"),
    contextKey: v.string(),
    scores: v.array(v.object({ key: v.string(), score: v.number() })),
    // Live candidate keys at rankedAt; a different live set marks the ranking stale.
    candidateKeys: v.optional(v.array(v.string())),
    rankedAt: v.optional(v.number()),
    refreshRequestedAt: v.optional(v.number()),
  }).index("operator_context", ["operatorUserId", "contextKey"]),

  // What an operator agent tool call returned, reduced to a bounded typed
  // preview for its activity row (convex/lib/toolResultPreview.ts).
  operatorAgentToolPreviews: defineTable({
    messageId: v.id("operatorAgentMessages"),
    toolCallId: v.string(),
    items: v.array(toolPreviewItemValidator),
  }).index("by_messageId_and_toolCallId", ["messageId", "toolCallId"]),
  operatorAgentMessages: defineTable({
    threadId: v.id("operatorAgentThreads"),
    ownerUserId: v.id("users"),
    channel: v.union(
      v.literal("chat"),
      v.literal("slack"),
      v.literal("imessage"),
      v.literal("email"),
      v.literal("mcp"),
    ),
    role: v.union(v.literal("user"), v.literal("agent"), v.literal("system")),
    userId: v.optional(v.id("users")),
    userName: v.optional(v.string()),
    replyToMessageId: v.optional(v.id("operatorAgentMessages")),
    dedupeKey: v.optional(v.string()),
    content: v.string(),
    /** Thread page context in effect when a user message was sent. */
    pageContext: v.optional(
      v.object({
        pageType: v.string(),
        entityId: v.optional(v.string()),
        summary: v.optional(v.string()),
        href: v.optional(v.string()),
      }),
    ),
    presentation: v.optional(chatPresentationValidator),
    presentationRevision: v.optional(v.number()),
    emailContent: v.optional(operatorEmailContentValidator),
    /** Outbound email drafts the operator agent shows under this turn. */
    pendingEmailIds: v.optional(v.array(v.id("pendingEmails"))),
    attachments: v.optional(
      v.array(
        v.object({
          fileId: v.id("_storage"),
          filename: v.string(),
          contentType: v.string(),
          size: v.number(),
        }),
      ),
    ),
    status: v.optional(
      v.union(
        v.literal("processing"),
        v.literal("error"),
        v.literal("cancelled"),
      ),
    ),
    reasoning: v.optional(v.string()),
    routerRequestId: v.optional(v.string()),
    usedTools: v.optional(v.array(v.string())),
    toolCalls: v.optional(
      v.array(
        v.object({
          name: v.string(),
          toolCallId: v.optional(v.string()),
          input: v.optional(v.string()),
          output: v.optional(v.string()),
        }),
      ),
    ),
    activity: v.optional(messageActivityValidator),
    executionPlan: v.optional(operatorExecutionPlanValidator),
    failure: v.optional(routerJobFailureValidator),
    toolArtifacts: v.optional(
      v.array(
        v.object({
          type: v.string(),
          data: v.any(),
        }),
      ),
    ),
    agentRunStartedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("thread", ["threadId"])
    .index("thread_dedupe", ["threadId", "dedupeKey"])
    .index("reply", ["replyToMessageId"])
    .searchIndex("content", {
      searchField: "content",
      filterFields: ["threadId"],
    }),

  chatPresentationEvidence: defineTable({
    messageId: v.union(v.id("operatorAgentMessages"), v.id("threadMessages")),
    operatorRunId: v.optional(v.id("operatorAgentRuns")),
    userId: v.id("users"),
    tools: v.array(v.object({ name: v.string(), outputJson: v.string() })),
    expiresAt: v.number(),
  }).index("message", ["messageId"]),

  operatorAgentAttachments: defineTable({
    fileId: v.id("_storage"),
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    messageId: v.id("operatorAgentMessages"),
    filename: v.string(),
    contentType: v.string(),
    size: v.number(),
    createdAt: v.number(),
  })
    .index("file", ["fileId"])
    .index("thread_file", ["threadId", "fileId"]),

  operatorAgentUploadIntents: defineTable({
    operatorUserId: v.id("users"),
    fileId: v.optional(v.id("_storage")),
    consumedAt: v.optional(v.number()),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("operator_expiration", ["operatorUserId", "expiresAt"])
    .index("file", ["fileId"]),

  operatorAgentConfirmations: defineTable({
    threadId: v.id("operatorAgentThreads"),
    operatorUserId: v.id("users"),
    promptMessageId: v.id("operatorAgentMessages"),
    payload: operatorToolActionConfirmationPayloadValidator,
    status: threadActionConfirmationStatusValidator,
    approvalMode: v.optional(v.literal("automatic")),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    invalidatedAt: v.optional(v.number()),
    invalidationReason: v.optional(v.string()),
  })
    .index("thread", ["threadId"])
    .index("thread_status", ["threadId", "status"]),

  agentActionAuditEvents: defineTable({
    orgId: v.optional(v.id("organizations")),
    threadId: v.optional(v.id("threads")),
    threadMessageId: v.optional(v.id("threadMessages")),
    operatorThreadId: v.optional(v.id("operatorAgentThreads")),
    operatorMessageId: v.optional(v.id("operatorAgentMessages")),
    runId: v.optional(v.id("operatorAgentRuns")),
    confirmationId: v.optional(v.id("threadActionConfirmations")),
    operatorConfirmationId: v.optional(v.id("operatorAgentConfirmations")),
    actorKind: v.union(
      v.literal("user"),
      v.literal("slack"),
      v.literal("operator"),
      v.literal("system"),
    ),
    userId: v.optional(v.id("users")),
    slackActorId: v.optional(v.id("slackActors")),
    operatorUserId: v.optional(v.id("users")),
    authorizationKind: v.union(
      v.literal("user_membership"),
      v.literal("slack_workspace"),
      v.literal("operator"),
      v.literal("system"),
    ),
    action: v.string(),
    toolVersion: v.optional(v.number()),
    capability: v.optional(v.string()),
    effect: v.optional(
      v.union(
        v.literal("read"),
        v.literal("reversible_write"),
        v.literal("external_send"),
        v.literal("access_change"),
        v.literal("global_change"),
        v.literal("destructive"),
      ),
    ),
    idempotencyKey: v.optional(v.string()),
    inputHash: v.optional(v.string()),
    targetKind: v.optional(v.string()),
    targetId: v.optional(v.string()),
    channel: v.optional(
      v.union(
        v.literal("chat"),
        v.literal("slack"),
        v.literal("imessage"),
        v.literal("email"),
        v.literal("mcp"),
      ),
    ),
    input: v.optional(v.string()),
    output: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("awaiting_confirmation"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("denied"),
      v.literal("cancelled"),
    ),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("organization_created", ["orgId", "createdAt"])
    .index("thread_created", ["threadId", "createdAt"])
    .index("operator_created", ["operatorThreadId", "createdAt"])
    .index("actor_created", ["slackActorId", "createdAt"])
    .index("run_created", ["runId", "createdAt"])
    .index("actor_kind_created", ["actorKind", "createdAt"])
    .index("operator_user_created", ["operatorUserId", "createdAt"])
    .index("idempotency", ["operatorUserId", "idempotencyKey"]),

  routerJobs: defineTable({
    streamTarget: v.optional(
      v.union(v.id("threadMessages"), v.id("operatorAgentMessages")),
    ),
    progressSequence: v.optional(v.number()),
    invocationKey: v.string(),
    operation: v.union(
      v.literal("generate"),
      v.literal("manual"),
      v.literal("embed"),
      v.literal("retrieve"),
      v.literal("transcribe"),
      v.literal("browse"),
    ),
    fingerprint: v.string(),
    status: v.union(
      v.literal("prepared"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    requestToken: v.string(),
    requestTokenHash: v.string(),
    resultToken: v.string(),
    resultTokenHash: v.string(),
    requestStorageId: v.optional(v.id("_storage")),
    resultStorageId: v.optional(v.id("_storage")),
    assetStorageIds: v.optional(v.array(v.id("_storage"))),
    routerJobId: v.optional(v.string()),
    error: v.optional(v.string()),
    failure: v.optional(routerJobFailureValidator),
    createdAt: v.number(),
    updatedAt: v.number(),
    terminalAt: v.optional(v.number()),
  })
    .index("invocation", ["invocationKey"])
    .index("request_token", ["requestTokenHash"])
    .index("result_token", ["resultTokenHash"]),

  operatorAgentRuns: defineTable({
    threadId: v.id("operatorAgentThreads"),
    emailReadOnly: v.optional(v.boolean()),
    operatorUserId: v.id("users"),
    userMessageId: v.id("operatorAgentMessages"),
    agentMessageId: v.id("operatorAgentMessages"),
    executionKind: v.optional(
      v.union(v.literal("goal"), v.literal("direct_tool")),
    ),
    objective: v.string(),
    // OAuth client that started the run over MCP.
    mcpClientId: v.optional(v.string()),
    planRequested: v.optional(v.boolean()),
    planningAssessment: v.optional(operatorPlanningAssessmentValidator),
    executionPlan: v.optional(operatorExecutionPlanValidator),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("waiting_confirmation"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    checkpoint: v.optional(
      v.object({
        iteration: v.number(),
        executionCount: v.number(),
        summary: v.optional(v.string()),
        lastToolName: v.optional(v.string()),
        pendingConfirmationId: v.optional(v.id("operatorAgentConfirmations")),
        routerRetryCount: v.optional(v.number()),
        compaction: v.optional(v.object({
          mode: v.optional(v.union(v.literal("model"), v.literal("deterministic"))),
          skipped: v.optional(v.boolean()),
          count: v.number(),
          iteration: v.number(),
          tokensBefore: v.number(),
          tokensAfter: v.number(),
        })),
        // Tool families chosen once per run and reused on later iterations.
        families: v.optional(v.array(v.string())),
      }),
    ),
    cancellationRequestedAt: v.optional(v.number()),
    modelContinuationStorageId: v.optional(v.id("_storage")),
    runnerAttempt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("thread_status", ["threadId", "status"])
    .index("operator_created", ["operatorUserId", "createdAt"])
    .index("message", ["userMessageId"]),

  imessageInboundEvents: defineTable({
    eventKey: v.string(),
    fromPhone: v.optional(v.string()),
    chatGuid: v.optional(v.string()),
    isGroup: v.optional(v.boolean()),
    messageText: v.optional(v.string()),
    sourceMessageId: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
    recoveryFailure: v.optional(
      v.object({
        stage: v.union(
          v.literal("raw_message"),
          v.literal("attachment_download"),
        ),
        error: v.string(),
      }),
    ),
    threadId: v.optional(v.id("threads")),
    historyGeneration: v.optional(v.number()),
    privacyContextPending: v.optional(v.boolean()),
    status: v.union(
      v.literal("processing"),
      v.literal("completed"),
      v.literal("error"),
    ),
    response: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("event", ["eventKey"])
    .index("phone", ["fromPhone"])
    .index("chat", ["chatGuid"])
    .index("thread", ["threadId"]),

  imessageOutboundSends: defineTable({
    idempotencyKey: v.string(),
    orgId: v.optional(v.id("organizations")),
    threadId: v.optional(v.id("threads")),
    threadMessageId: v.optional(v.id("threadMessages")),
    status: v.union(
      v.literal("sending"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("idempotency", ["idempotencyKey"])
    .index("thread", ["threadId"])
    .index("message", ["threadMessageId"]),

  // Spectrum webhook transport: inbound `message.id` dedupe and outbound
  // `clientMessageId` claims that replaced the Railway worker's in-memory cache.
  imessageTransportClaims: defineTable({
    role: v.union(v.literal("customer"), v.literal("operator")),
    kind: v.union(v.literal("webhook_message"), v.literal("send")),
    key: v.string(),
    status: v.union(
      v.literal("accepted"),
      v.literal("sending"),
      v.literal("sent"),
    ),
    expiresAt: v.number(),
  })
    .index("role_kind_key", ["role", "kind", "key"])
    .index("expiration", ["expiresAt"]),

  appCardAccessLinks: defineTable({
    orgId: v.id("organizations"),
    tokenHash: v.string(),
    kind: v.union(v.literal("policy"), v.literal("certificate")),
    policyId: v.optional(v.id("policies")),
    certificateId: v.optional(v.id("certificates")),
    policyCertificateId: v.optional(v.id("policyCertificates")),
    certificateVersionId: v.optional(v.id("certificateVersions")),
    label: v.optional(v.string()),
    sourceThreadId: v.optional(v.id("threads")),
    sourceThreadMessageId: v.optional(v.id("threadMessages")),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("token", ["tokenHash"])
    .index("organization", ["orgId"])
    .index("policy", ["policyId"])
    .index("certificate", ["certificateId"])
    .index("policy_certificate", ["policyCertificateId"])
    .index("thread", ["sourceThreadId"])
    .index("source_message", ["sourceThreadMessageId"]),

  emailDraftReviewLinks: defineTable({
    orgId: v.id("organizations"),
    pendingEmailId: v.id("pendingEmails"),
    tokenHash: v.string(),
    channel: v.union(
      v.literal("imessage"),
      v.literal("slack"),
      v.literal("email"),
      v.literal("other"),
    ),
    draftFingerprint: v.string(),
    confirmationId: v.optional(v.id("threadActionConfirmations")),
    actor: threadActionActorValidator,
    sourceThreadId: v.id("threads"),
    sourceThreadMessageId: v.optional(v.id("threadMessages")),
    expiresAt: v.optional(v.number()), // Legacy expiry; validity follows current state.
    revokedAt: v.optional(v.number()),
    sendStartedAt: v.optional(v.number()),
    sendCompletedAt: v.optional(v.number()),
    sendAttempts: v.number(),
    sendLastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("token", ["tokenHash"])
    .index("draft_channel", ["pendingEmailId", "channel"])
    .index("thread", ["sourceThreadId"])
    .index("expiration", ["expiresAt"]),

  imessageChats: defineTable({
    chatGuid: v.string(),
    isGroup: v.boolean(),
    status: v.union(v.literal("active"), v.literal("left")),
    primaryOrgId: v.optional(v.id("organizations")),
    title: v.optional(v.string()),
    participantCount: v.number(),
    contactCardSentAt: v.optional(v.number()),
    lastParticipantSyncAt: v.number(),
    lastMessageAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("chat", ["chatGuid"])
    .index("organization", ["primaryOrgId"]),

  imessageParticipants: defineTable({
    chatGuid: v.string(),
    address: v.string(),
    displayName: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.id("organizations")),
    role: v.union(v.literal("linked"), v.literal("anonymous")),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("chat", ["chatGuid"])
    .index("address", ["address"])
    .index("chat_address", ["chatGuid", "address"])
    .index("user", ["userId"]),

  // ── Pending Emails (send delay queue) ──

  pendingEmails: defineTable({
    senderUserId: v.optional(v.id("users")),
    operatorAlwaysCcEmail: v.optional(v.string()),
    directReplyKey: v.optional(v.string()),
    directReplyMessage: v.optional(v.string()),
    directReplyContext: v.optional(v.object({
      latestMessageId: v.id("teamEmailMessages"),
      mode: v.union(v.literal("thread"), v.literal("standalone")),
      inboxId: v.optional(v.string()),
      resendThreadId: v.optional(v.string()),
      replyToEmailId: v.optional(v.string()),
    })),
    directApproval: v.optional(v.object({
      actorUserId: v.id("users"),
      fingerprint: v.string(),
      approvedAt: v.number(),
    })),
    transport: v.optional(v.literal("operator_inbox")),
    procurementRequestId: v.optional(v.id("procurementRequests")),
    teamEmailThreadId: v.optional(v.id("teamEmailThreads")),
    resendInboxEmailId: v.optional(v.string()),
    orgId: v.optional(v.id("organizations")),
    threadId: v.optional(v.id("threads")),
    // Drafts written by the operator agent belong to an operator thread, not a
    // client thread, and are only reachable from that operator thread.
    operatorThreadId: v.optional(v.id("operatorAgentThreads")),
    // The operator agent message currently displaying this draft.
    operatorMessageId: v.optional(v.id("operatorAgentMessages")),
    status: v.union(
      v.literal("draft"),
      v.literal("pending"),
      v.literal("sent"),
      v.literal("cancelled"),
    ),
    fromHeader: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.string()),
    renderedText: v.optional(v.string()),
    renderedHtml: v.optional(v.string()),
    scheduledSendTime: v.number(), // timestamp when it should actually send
    sentMessageId: v.optional(v.string()), // Resend message ID after send
    sendBlockedReason: v.optional(v.string()),
    explicitSendAuthorization: v.optional(
      v.object({
        actorUserId: v.id("users"),
        sourceMessageId: v.id("threadMessages"),
      }),
    ),
    // For updating the chat message after send
    chatMessageId: v.optional(v.id("threadMessages")),
    threadMessageId: v.optional(v.id("threadMessages")),
    // Metadata for the sent email record
    recipientEmail: v.string(),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.string(),
    emailBody: v.string(), // plain content (for thread record)
    attachments: v.optional(v.array(pendingEmailAttachmentValidator)),
    coiBatchAuthorization: v.optional(
      v.object({
        recipientEmail: v.string(),
        fileIds: v.array(v.id("_storage")),
        draftFingerprint: v.string(),
        confirmedBy: threadActionActorValidator,
        confirmationId: v.id("threadActionConfirmations"),
        confirmedAt: v.number(),
      }),
    ),
    // For unified thread dual-write
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
  })
    .index("thread", ["threadId"])
    .index("operator_thread", ["operatorThreadId"])
    .index("by_teamEmailThreadId", ["teamEmailThreadId"])
    .index("by_teamEmailThreadId_and_status", ["teamEmailThreadId", "status"])
    .index("by_senderUserId_and_directReplyKey", ["senderUserId", "directReplyKey"])
    .index("status", ["status"]),

  emailDeliveryAttempts: defineTable({
    orgId: v.optional(v.id("organizations")),
    senderUserId: v.optional(v.id("users")),
    draftFingerprint: v.optional(v.string()),
    operatorConfirmationId: v.optional(v.id("operatorAgentConfirmations")),
    inboxId: v.optional(v.string()),
    draftId: v.optional(v.string()),
    operatorStage: v.optional(v.union(
      v.literal("claimed"),
      v.literal("draft_created"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("unknown"),
      v.literal("failed"),
    )),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    threadId: v.optional(v.id("threads")),
    threadMessageId: v.optional(v.id("threadMessages")),
    source: v.union(
      v.literal("pending_email"),
      v.literal("email_subagent"),
      v.literal("policy_delivery"),
      v.literal("inbound_email"),
      v.literal("procurement_packet"),
      v.literal("procurement_outreach"),
      v.literal("operator_inbox"),
    ),
    provider: v.union(v.literal("resend"), v.literal("google_smtp")),
    deliveryMode: v.optional(v.string()),
    status: v.union(
      v.literal("attempting"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("blocked"),
    ),
    recipientEmail: v.optional(v.string()),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    messageId: v.optional(v.string()),
    resendEmailId: v.optional(v.string()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("pending", ["pendingEmailId"])
    .index("by_pendingEmailId_and_draftFingerprint", ["pendingEmailId", "draftFingerprint"])
    .index("organization", ["orgId"])
    .index("thread", ["threadId"])
    .index("message", ["threadMessageId"])
    .index("status", ["status"]),

  // ── Presence ──

  // ── OAuth (MCP remote clients) ──

  mcpEventSubscriptions: defineTable({
    id: v.string(),
    principalKind: v.union(v.literal("organization"), v.literal("operator")),
    userId: v.id("users"),
    orgId: v.optional(v.id("organizations")),
    clientId: v.string(),
    resource: v.string(),
    name: v.string(),
    filters: v.record(v.string(), v.string()),
    callbackUrl: v.string(),
    encryptedSecret: v.string(),
    secretFingerprint: v.optional(v.string()),
    callbackVerifiedAt: v.optional(v.number()),
    previousEncryptedSecret: v.optional(v.string()),
    previousSecretUntil: v.optional(v.number()),
    generation: v.number(),
    active: v.boolean(),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("identity", ["id"])
    .index("user", ["userId"])
    .index("callback", [
      "userId",
      "principalKind",
      "orgId",
      "clientId",
      "resource",
      "callbackUrl",
      "secretFingerprint",
      "active",
    ])
    .index("audience", ["principalKind", "orgId", "name", "active"])
    .index("expiry", ["active", "expiresAt"]),

  mcpEventDeliveries: defineTable({
    subscriptionId: v.id("mcpEventSubscriptions"),
    eventId: v.string(),
    name: v.string(),
    orgId: v.id("organizations"),
    targetUserId: v.optional(v.id("users")),
    data: v.record(v.string(), v.string()),
    timestamp: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("sending"),
      v.literal("accepted"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    lease: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    statusCode: v.optional(v.number()),
    expiresAt: v.number(),
  })
    .index("event_subscription", ["eventId", "subscriptionId"])
    .index("due", ["status", "nextAttemptAt"])
    .index("lease", ["status", "leaseUntil"])
    .index("expiry", ["expiresAt"]),

  oauthClients: defineTable({
    clientId: v.string(),
    clientName: v.string(),
    redirectUris: v.array(v.string()),
    tokenEndpointAuthMethod: v.string(), // "none" for public clients
    createdAt: v.number(),
    allowedScopes: v.optional(
      v.array(v.union(v.literal("read"), v.literal("write"))),
    ),
    description: v.optional(v.string()),
  }).index("client", ["clientId"]),

  oauthAuthCodes: defineTable({
    codeHash: v.string(),
    clientId: v.string(),
    userId: v.id("users"),
    principalKind: v.optional(
      v.union(v.literal("organization"), v.literal("operator")),
    ),
    orgId: v.optional(v.id("organizations")),
    resource: v.optional(v.string()),
    redirectUri: v.string(),
    codeChallenge: v.string(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
    scopes: v.array(v.union(v.literal("read"), v.literal("write"))),
  }).index("code", ["codeHash"]),

  oauthTokens: defineTable({
    tokenHash: v.string(),
    refreshTokenHash: v.optional(v.string()),
    clientId: v.string(),
    userId: v.id("users"),
    principalKind: v.optional(
      v.union(v.literal("organization"), v.literal("operator")),
    ),
    orgId: v.optional(v.id("organizations")),
    resource: v.optional(v.string()),
    expiresAt: v.number(),
    refreshExpiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
    scopes: v.array(v.union(v.literal("read"), v.literal("write"))),
  })
    .index("token", ["tokenHash"])
    .index("refresh_token", ["refreshTokenHash"])
    .index("user", ["userId"])
    .index("user_client", ["userId", "clientId"]),

  // ── Rate Limit Counters ──

  rateLimitCounters: defineTable({
    tokenId: v.id("oauthTokens"),
    windowStart: v.number(),
    count: v.number(),
    lastRequestMs: v.number(),
  }).index("token", ["tokenId"]),

  // ── Presence ──

  presence: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    pageKey: v.string(),
    userName: v.optional(v.string()),
    lastSeen: v.number(),
  })
    .index("page", ["pageKey"])
    .index("user", ["userId"]),

  // One row per operator; heartbeats keep it fresh while the portal is open.
  // One row per operator per open tab, so closing one tab leaves the others.
  operatorPresence: defineTable({
    /** The browser tab; absent on rows from clients before per-tab presence. */
    tabId: v.optional(v.string()),
    emailThreadId: v.optional(v.id("teamEmailThreads")),
    activity: v.optional(v.union(v.literal("viewing"), v.literal("replying"))),
    userId: v.id("users"),
    pathname: v.string(),
    threadId: v.optional(v.id("operatorAgentThreads")),
    /** The operator whose cursor this one is following, if any. */
    followingUserId: v.optional(v.id("users")),
    lastSeen: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_tabId", ["userId", "tabId"])
    .index("by_lastSeen", ["lastSeen"]),

  // Live cursor of an operator who shares a page with a teammate or is
  // followed. Kept apart from operatorPresence because it changes many times a
  // second; the row exists only while someone can see it.
  operatorCursors: defineTable({
    userId: v.id("users"),
    /** Leader's in-app URL: pathname plus search. */
    href: v.string(),
    /** CSS path to the element under the pointer; x and y are fractions of its box. */
    anchor: v.optional(v.string()),
    x: v.number(),
    y: v.number(),
    /** Pointer position as fractions of the leader's viewport; fallback and scroll target. */
    viewportX: v.number(),
    viewportY: v.number(),
    visible: v.boolean(),
    /** Retired: older clients may still send it; shared fields now sync through collabRooms. */
    field: v.optional(
      v.object({
        anchor: v.string(),
        text: v.string(),
        selectionStart: v.number(),
        selectionEnd: v.number(),
      }),
    ),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // The leader's followed UI state (open panels, tabs, filters) as a JSON map
  // of non-default values. Apart from operatorCursors so pointer moves never
  // resend it; written only when it changes, and only while followed.
  operatorUiStates: defineTable({
    userId: v.id("users"),
    ui: v.string(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // Shared form state for operators on the same page. Members rejoin every
  // 15s; the first to arrive after nobody has for two minutes starts a fresh
  // room, so stale edits never merge into a later visit.
  collabRooms: defineTable({
    pathname: v.string(),
    /** Updates since the room was last compacted. */
    pendingUpdates: v.number(),
    updatedAt: v.number(),
  })
    .index("by_pathname", ["pathname"])
    .index("by_updatedAt", ["updatedAt"]),

  // Yjs document updates for a room, compacted into one row as they pile up.
  collabUpdates: defineTable({
    roomId: v.id("collabRooms"),
    update: v.bytes(),
  }).index("by_roomId", ["roomId"]),

  // Where each room member's caret sits, keyed like the shared fields.
  collabCarets: defineTable({
    roomId: v.id("collabRooms"),
    userId: v.id("users"),
    key: v.string(),
    selectionStart: v.number(),
    selectionEnd: v.number(),
    updatedAt: v.number(),
  })
    .index("by_roomId", ["roomId"])
    .index("by_roomId_and_userId", ["roomId", "userId"]),
});
