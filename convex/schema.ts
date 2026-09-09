import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { pipelineFields } from "@claritylabs/cl-pipelines/convex";
import { acordTaxonomyBackfillReportValidator } from "./lib/acordTaxonomyBackfillReport";
import { agentStepsValidator } from "./lib/agentSteps";
import { policyProductIdentityValidator } from "./lib/policyProductIdentity";
import { certificateRequirementSnapshotValidator } from "./lib/certificateRequirementPlan";
import {
  companyInformationProfileValidator,
  companyInformationStoredOrganizationFactValidator,
} from "./lib/companyInformationExtraction";
import {
  emailContentValidator,
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

const modelProviderValidator = v.union(
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("google"),
  v.literal("xai"),
  v.literal("mistral"),
  v.literal("cohere"),
  v.literal("fireworks"),
  v.literal("moonshot"),
  v.literal("deepseek"),
);

const modelRouteValidator = v.object({
  provider: modelProviderValidator,
  model: v.string(),
});

const extractionTraceRoutingValidator = v.object({
  decision: v.string(),
  candidatesConsidered: v.array(modelRouteValidator),
  policyVersion: v.union(v.string(), v.null()),
  cacheStickinessApplied: v.boolean(),
  routeSource: v.optional(v.string()),
  attemptCount: v.optional(v.number()),
  shadowMode: v.optional(v.boolean()),
  wouldHaveChosen: v.optional(
    v.object({
      provider: modelProviderValidator,
      model: v.string(),
      decision: v.string(),
    }),
  ),
  wouldHaveMatched: v.optional(v.boolean()),
});

const webRetrievalProviderValidator = v.union(
  v.literal("parallel"),
  v.literal("exa"),
  v.literal("model_default"),
  v.literal("openai"),
  v.literal("google"),
  v.literal("anthropic"),
  v.literal("xai"),
);

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

const publicDemoChannelValidator = v.union(
  v.literal("email"),
  v.literal("imessage"),
);

const publicDemoLeadStageValidator = v.union(
  v.literal("new"),
  v.literal("engaged"),
  v.literal("qualified"),
  v.literal("booking_intent"),
  v.literal("cta_sent"),
  v.literal("signup_intent"),
  v.literal("not_fit"),
  v.literal("rate_limited"),
);

const publicDemoCtaStatusValidator = v.union(
  v.literal("not_shown"),
  v.literal("asked_for_email"),
  v.literal("cal_link_sent"),
  v.literal("signup_link_sent"),
);

const policyDeliveryChannelValidator = v.union(
  v.literal("email"),
  v.literal("imessage"),
  v.literal("slack"),
);

const policyDeliveryActionValidator = v.union(
  v.literal("auto_send"),
  v.literal("broker_review"),
  v.literal("service_review"),
  v.literal("do_not_send"),
);

const policyDeliveryStatusValidator = v.union(
  v.literal("queued"),
  v.literal("review_required"),
  v.literal("sending"),
  v.literal("sent"),
  v.literal("partially_sent"),
  v.literal("blocked"),
  v.literal("failed"),
  v.literal("suppressed"),
  v.literal("cancelled"),
);

const policyDeliverySourceKindValidator = v.union(
  v.literal("policy"),
  v.literal("endorsement"),
);

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
  mga: v.optional(policyDetailPartyValidator),
});

const organizationProfileOverridesValidator = v.object({
  namedInsured: v.optional(v.string()),
  mailingAddress: orgMailingAddressValidator,
  dba: v.optional(v.string()),
  entityType: v.optional(
    v.union(
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
  operationsDescription: v.string(),
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
  procurementEmailThreadId: v.optional(v.id("procurementEmailThreads")),
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

const certificateWorkflowJobStatusValidator = v.union(
  v.literal("review_required"),
  v.literal("blocked_missing_contact"),
  v.literal("sending"),
  v.literal("sent"),
  v.literal("cancelled"),
  v.literal("failed"),
);

const certificateWorkflowJobKindValidator = v.union(
  v.literal("renewal_reissue"),
  v.literal("manual_review"),
);

const certificateHolderRelationshipKindValidator = v.union(
  v.literal("additional_insured"),
  v.literal("loss_payee"),
  v.literal("mortgagee"),
  v.literal("allowed_holder"),
);

const policyDeliveryRuleFiltersValidator = v.object({
  carriers: v.optional(v.array(v.string())),
  securities: v.optional(v.array(v.string())),
  underwriters: v.optional(v.array(v.string())),
  linesOfBusiness: v.optional(v.array(v.string())),
});

export default defineSchema({
  ...authTables,

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
    name: v.string(),
    website: v.optional(v.string()),
    context: v.optional(v.string()),
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
    // Relationship context — helps categorize intelligence entries
    clientsContext: v.optional(v.string()), // who the org's clients/customers are
    vendorsContext: v.optional(v.string()), // key vendors and service providers
    insuranceContext: v.optional(v.string()), // brokers, carriers, insurance relationships
    investorsContext: v.optional(v.string()), // investors, shareholders, funding
    partnersContext: v.optional(v.string()), // joint ventures, affiliates, partners
    relatedLegalEntities: v.optional(
      v.array(
        v.object({
          legalName: v.string(),
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
          notes: v.optional(v.string()),
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
    // Internal operator lifecycle for operator-provisioned tenants. Missing legacy value means live.
    operatorStatus: v.optional(
      v.union(v.literal("onboarding"), v.literal("live")),
    ),
    // Branding
    iconStorageId: v.optional(v.id("_storage")),
    // Dual-org: org type discriminator
    type: v.optional(v.union(v.literal("broker"), v.literal("client"))),
    // Set on client orgs only — ID of the managing broker org
    brokerOrgId: v.optional(v.id("organizations")),
    // Client-org lifecycle: "draft" = broker is preparing, "invited" = invite sent and pending,
    // undefined = legacy/active (accepted or pre-dates this field).
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
    .index("handle", ["agentHandle"])
    .index("type", ["type"])
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

  // Supply-side broker directory data. A profile may exist without portal
  // users; portal access remains represented exclusively by orgMemberships.
  brokerProfiles: defineTable({
    brokerOrgId: v.id("organizations"),
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
    writingStates: v.array(v.string()),
    lineOfBusinessCodes: v.array(v.string()),
    createdByUserId: v.id("users"),
    updatedByUserId: v.id("users"),
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

  operatorProfiles: defineTable({
    userId: v.id("users"),
    email: v.string(),
    role: v.union(v.literal("operator"), v.literal("owner")),
    status: v.union(v.literal("active"), v.literal("disabled")),
    slackTeamId: v.optional(v.string()),
    slackUserId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("user", ["userId"])
    .index("email", ["email"])
    .index("slack_user", ["slackTeamId", "slackUserId"])
    .index("status", ["status"]),

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

  operatorAuditEvents: defineTable({
    operatorUserId: v.id("users"),
    type: v.union(
      v.literal("operator_bootstrap"),
      v.literal("broker_created"),
      v.literal("broker_status_changed"),
      v.literal("broker_launch_email_sent"),
      v.literal("client_created"),
      v.literal("client_status_changed"),
      v.literal("client_launch_email_sent"),
      v.literal("impersonation_started"),
      v.literal("impersonation_stopped"),
      v.literal("impersonation_chat_message"),
      v.literal("demo_lead_deleted"),
      v.literal("memory_cleared"),
      v.literal("setup_write"),
    ),
    targetOrgId: v.optional(v.id("organizations")),
    targetUserId: v.optional(v.id("users")),
    requestId: v.optional(v.id("procurementRequests")),
    summary: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("operator_created", ["operatorUserId", "createdAt"])
    .index("target_created", ["targetOrgId", "createdAt"])
    .index("request_created", ["requestId", "createdAt"]),

  modelRoutingEvents: defineTable({
    kind: v.union(
      v.literal("model_step"),
      v.literal("direct_fallback"),
      v.literal("run"),
    ),
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
    .index("task_time", ["task", "timestamp"])
    .index("run_time", ["runId", "timestamp"])
    .index("expiration", ["expiresAt"]),

  brokerModelSettings: defineTable({
    brokerOrgId: v.id("organizations"),
    providerKeys: v.optional(
      v.object({
        openai: v.optional(v.string()),
        anthropic: v.optional(v.string()),
        google: v.optional(v.string()),
        xai: v.optional(v.string()),
        mistral: v.optional(v.string()),
        cohere: v.optional(v.string()),
        fireworks: v.optional(v.string()),
        moonshot: v.optional(v.string()),
        deepseek: v.optional(v.string()),
      }),
    ),
    routes: v.optional(
      v.object({
        chat: v.optional(modelRouteValidator),
        chat_vision: v.optional(modelRouteValidator),
        voice_transcription: v.optional(modelRouteValidator),
        email_draft: v.optional(modelRouteValidator),
        email_reply: v.optional(modelRouteValidator),
        extraction: v.optional(modelRouteValidator),
        extraction_preview: v.optional(modelRouteValidator),
        extraction_coverage_recovery: v.optional(modelRouteValidator),
        classification: v.optional(modelRouteValidator),
        requirement_extraction: v.optional(modelRouteValidator),
        org_memory_extraction: v.optional(modelRouteValidator),
        analysis: v.optional(modelRouteValidator),
        summary: v.optional(modelRouteValidator),
        triage: v.optional(modelRouteValidator),
        email_extraction: v.optional(modelRouteValidator),
        document_extraction: v.optional(modelRouteValidator),
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
        extraction_coverage_recovery: v.optional(modelRouteValidator),
        classification: v.optional(modelRouteValidator),
        requirement_extraction: v.optional(modelRouteValidator),
        org_memory_extraction: v.optional(modelRouteValidator),
        analysis: v.optional(modelRouteValidator),
        summary: v.optional(modelRouteValidator),
        triage: v.optional(modelRouteValidator),
        email_extraction: v.optional(modelRouteValidator),
        document_extraction: v.optional(modelRouteValidator),
        security: v.optional(modelRouteValidator),
        mailbox_coordinator: v.optional(modelRouteValidator),
        embeddings: v.optional(modelRouteValidator),
        extraction_quality: v.optional(modelRouteValidator),
        extraction_form_inventory: v.optional(modelRouteValidator),
        extraction_coverage_cleanup: v.optional(modelRouteValidator),
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
    // Legacy; cleared by migrations:runCompanyWikiLegacyPurge.
    memoryIds: v.optional(v.array(v.id("orgMemory"))),
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

  // The company wiki: one markdown document per organization, held as ordered
  // sections so concurrent writers merge instead of clobbering a single blob.
  // Agents read the assembled document whole rather than retrieving fragments.
  orgWikiSections: defineTable({
    orgId: v.id("organizations"),
    key: v.string(),
    heading: v.string(),
    body: v.string(),
    order: v.number(),
    source: v.union(
      v.literal("extraction"),
      v.literal("analysis"),
      v.literal("chat"),
      v.literal("email"),
      v.literal("imessage"),
      v.literal("slack"),
      v.literal("manual"),
      v.literal("operator"),
      v.literal("mcp"),
    ),
    sourceRefs: v.optional(v.array(v.string())),
    // The bullets in `body` that the company-information reconciler owns. Every
    // other line was contributed by a conversational or append-only writer, so
    // reconcile rewrites only these and leaves the rest alone.
    extractedLines: v.optional(v.array(v.string())),
    proposedBody: v.optional(v.string()),
    proposedRationale: v.optional(v.string()),
    manuallyEditedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("organization", ["orgId", "order"])
    .index("organization_key", ["orgId", "key"]),

  // Legacy, retained only for the gated company-wiki purge migration. The
  // curated store is `orgWikiSections`; nothing reads or writes these rows.
  // Remove both tables in the schema-narrowing release after
  // `migrations:runCompanyWikiLegacyPurge` reports complete.
  orgMemory: defineTable({
    orgId: v.id("organizations"),
    type: v.union(
      v.literal("fact"),
      v.literal("preference"),
      v.literal("risk_note"),
      v.literal("observation"),
    ),
    content: v.string(),
    source: v.union(
      v.literal("extraction"),
      v.literal("analysis"),
      v.literal("chat"),
      v.literal("email"),
      v.literal("imessage"),
      v.literal("slack"),
      v.literal("manual"),
      v.literal("operator"),
      v.literal("mcp"),
    ),
    policyId: v.optional(v.id("policies")),
    sourceRef: v.optional(v.string()),
    sourceRefs: v.optional(v.array(v.string())),
    confidence: v.optional(v.number()),
    observedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    provenance: v.optional(
      v.object({
        kind: v.literal("organization_fact"),
        derivation: v.union(
          v.literal("company_profile_extraction"),
          v.literal("conversation_extraction"),
          v.literal("agent_tool"),
        ),
        schemaVersion: v.literal("organization-fact-v1"),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("organization", ["orgId"])
    .index("organization_type", ["orgId", "type"])
    .index("organization_source", ["orgId", "sourceRef"]),
  procurementMemory: defineTable({
    clientOrgId: v.id("organizations"),
    kind: v.union(
      v.literal("placement_preference"),
      v.literal("broker_appetite"),
      v.literal("submission_requirement"),
      v.literal("market_observation"),
    ),
    content: v.string(),
    source: v.union(
      v.literal("manual"),
      v.literal("operator_agent"),
      v.literal("mcp"),
      v.literal("email"),
      v.literal("document"),
      v.literal("procurement_outcome"),
    ),
    requestId: v.optional(v.id("procurementRequests")),
    outreachId: v.optional(v.id("procurementBrokerOutreaches")),
    brokerOrgId: v.optional(v.id("organizations")),
    sourceRef: v.optional(v.string()),
    sourceRefs: v.optional(v.array(v.string())),
    confidence: v.optional(v.number()),
    observedAt: v.optional(v.number()),
    createdByUserId: v.id("users"),
    updatedByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("client", ["clientOrgId", "updatedAt"])
    .index("request", ["requestId", "updatedAt"])
    .index("broker", ["brokerOrgId", "updatedAt"])
    .index("source", ["clientOrgId", "sourceRef"]),
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

  brokerClientAssignments: defineTable({
    orgId: v.optional(v.id("organizations")), // connected broker org; omitted for standalone external contacts
    clientOrgId: v.id("organizations"), // client org
    brokerCompanyName: v.optional(v.string()),
    producerId: v.optional(v.id("users")), // optional broker user
    role: v.union(v.literal("primary"), v.literal("secondary")),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("organization_client", ["orgId", "clientOrgId"])
    .index("organization_producer", ["orgId", "producerId"])
    .index("client", ["clientOrgId"]),

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
      v.literal("glass_operator"),
      v.literal("external"),
      v.literal("bot"),
    ),
    operatorUserId: v.optional(v.id("users")),
    spotUserId: v.optional(v.id("users")),
    glassUserId: v.optional(v.id("users")),
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

  policyDeliverySettings: defineTable({
    brokerOrgId: v.optional(v.id("organizations")),
    deliveryOwnerOrgId: v.optional(v.id("organizations")),
    clientOrgId: v.optional(v.id("organizations")),
    enabled: v.boolean(),
    channels: v.array(policyDeliveryChannelValidator),
    defaultAction: policyDeliveryActionValidator,
    deliverBeforeClientAcceptance: v.boolean(),
    copyInstructions: v.optional(v.string()),
    updatedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("broker", ["brokerOrgId"])
    .index("owner_client", ["deliveryOwnerOrgId", "clientOrgId"])
    .index("broker_client", ["brokerOrgId", "clientOrgId"]),

  policyDeliveryRules: defineTable({
    brokerOrgId: v.optional(v.id("organizations")),
    deliveryOwnerOrgId: v.optional(v.id("organizations")),
    clientOrgId: v.optional(v.id("organizations")),
    name: v.string(),
    enabled: v.boolean(),
    priority: v.number(),
    filters: policyDeliveryRuleFiltersValidator,
    llmRuleText: v.optional(v.string()),
    action: policyDeliveryActionValidator,
    channels: v.optional(v.array(policyDeliveryChannelValidator)),
    copyInstructions: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    updatedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("broker", ["brokerOrgId"])
    .index("owner_client", ["deliveryOwnerOrgId", "clientOrgId"])
    .index("broker_client", ["brokerOrgId", "clientOrgId"])
    .index("broker_priority", ["brokerOrgId", "priority"]),

  policyDeliveryJobs: defineTable({
    brokerOrgId: v.optional(v.id("organizations")),
    deliveryOwnerOrgId: v.optional(v.id("organizations")),
    clientOrgId: v.id("organizations"),
    policyId: v.id("policies"),
    policyFileId: v.optional(v.id("policyFiles")),
    sourceKind: policyDeliverySourceKindValidator,
    idempotencyKey: v.string(),
    status: policyDeliveryStatusValidator,
    action: policyDeliveryActionValidator,
    channels: v.array(policyDeliveryChannelValidator),
    ruleId: v.optional(v.id("policyDeliveryRules")),
    ruleName: v.optional(v.string()),
    decisionSummary: v.optional(v.string()),
    decisionDetails: v.optional(v.any()),
    recipientName: v.optional(v.string()),
    recipientEmail: v.optional(v.string()),
    recipientPhone: v.optional(v.string()),
    threadId: v.optional(v.id("threads")),
    emailSentAt: v.optional(v.number()),
    imessageSentAt: v.optional(v.number()),
    slackSentAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("broker_status", ["brokerOrgId", "status", "updatedAt"])
    .index("owner_status", ["deliveryOwnerOrgId", "status", "updatedAt"])
    .index("client_updated", ["clientOrgId", "updatedAt"])
    .index("client_status", ["clientOrgId", "status", "updatedAt"])
    .index("policy", ["policyId"])
    .index("thread", ["threadId"])
    .index("idempotency", ["idempotencyKey"]),

  policyDeliveryAttempts: defineTable({
    jobId: v.id("policyDeliveryJobs"),
    brokerOrgId: v.optional(v.id("organizations")),
    deliveryOwnerOrgId: v.optional(v.id("organizations")),
    clientOrgId: v.id("organizations"),
    policyId: v.id("policies"),
    channel: policyDeliveryChannelValidator,
    status: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("job", ["jobId"])
    .index("broker_created", ["brokerOrgId", "createdAt"])
    .index("owner_created", ["deliveryOwnerOrgId", "createdAt"])
    .index("client_created", ["clientOrgId", "createdAt"]),

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
    certificateHolderId: v.optional(v.id("certificateHolders")),
    certificateHolderIds: v.optional(v.array(v.id("certificateHolders"))),
    dealName: v.optional(v.string()),
    dealType: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
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
    .index("holder", ["certificateHolderId"])
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

  extractionReviews: defineTable({
    targetKind: v.union(
      v.literal("policy_extraction"),
      v.literal("requirement_extraction"),
    ),
    targetId: v.string(),
    targetKey: v.string(),
    orgId: v.id("organizations"),
    operatorUserId: v.id("users"),
    policyId: v.optional(v.id("policies")),
    rating: v.union(v.literal("positive"), v.literal("negative")),
    category: v.optional(
      v.union(
        v.literal("incorrect"),
        v.literal("missing"),
        v.literal("ungrounded"),
        v.literal("unsafe"),
        v.literal("other"),
      ),
    ),
    fieldPath: v.optional(v.string()),
    expectedValue: v.optional(v.string()),
    comment: v.optional(v.string()),
    routerRequestId: v.optional(v.string()),
    taskKind: v.optional(v.string()),
    provider: v.optional(modelProviderValidator),
    model: v.optional(v.string()),
    routerSignalStatus: v.union(
      v.literal("not_applicable"),
      v.literal("pending"),
      v.literal("submitted"),
      v.literal("error"),
    ),
    routerSignalError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("target_operator", ["targetKey", "operatorUserId"])
    .index("organization_created", ["orgId", "createdAt"])
    .index("operator_created", ["operatorUserId", "createdAt"]),

  insuranceRequirements: defineTable({
    orgId: v.id("organizations"),
    // Legacy deployed rows from the pre-redesign requirement model do not
    // have kind/scope yet. Keep these optional until all environments have run
    // the compliance requirement shape backfill.
    kind: v.optional(
      v.union(
        v.literal("coverage"),
        v.literal("insurer"),
        v.literal("condition"),
      ),
    ),
    scope: v.optional(v.union(v.literal("own_org"), v.literal("vendors"))),
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
    status: v.union(v.literal("active"), v.literal("archived")),
    createdByUserId: v.id("users"),
    updatedByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Deprecated legacy requirement fields. Do not write these in new code.
    category: v.optional(v.string()),
    name: v.optional(v.string()),
    coverageCode: v.optional(v.string()),
    limit: v.optional(v.string()),
    limitAmount: v.optional(v.number()),
    limitType: v.optional(v.string()),
    limitValueType: v.optional(v.string()),
    deductible: v.optional(v.string()),
    deductibleAmount: v.optional(v.number()),
    deductibleType: v.optional(v.string()),
    deductibleValueType: v.optional(v.string()),
    originalContent: v.optional(v.string()),
    appliesTo: v.optional(
      v.union(v.literal("vendors"), v.literal("own_org"), v.literal("both")),
    ),
    evaluationTarget: v.optional(
      v.union(
        v.literal("own_policy"),
        v.literal("connected_vendor_policy"),
        v.literal("subcontractor_policy"),
        v.literal("manual_control"),
        v.literal("not_policy_checkable"),
      ),
    ),
    evaluationReason: v.optional(v.string()),
    semanticReviewStatus: v.optional(
      v.union(
        v.literal("system_classified"),
        v.literal("needs_review"),
        v.literal("user_confirmed"),
      ),
    ),
    manualComplianceReview: v.optional(
      v.object({
        status: v.union(
          v.literal("met"),
          v.literal("missing"),
          v.literal("expiring_soon"),
          v.literal("expired"),
          v.literal("needs_review"),
        ),
        matchedPolicyIds: v.array(v.id("policies")),
        expiresAt: v.optional(v.string()),
        daysUntilExpiration: v.optional(v.number()),
        notes: v.optional(v.string()),
        checkedAt: v.number(),
        checkedByUserId: v.id("users"),
      }),
    ),
    minimumRequired: v.optional(v.boolean()),
  })
    .index("organization", ["orgId"])
    .index("organization_status", ["orgId", "status"])
    .index("status_scope", ["status", "scope"]),

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
  clientInvitations: defineTable({
    brokerOrgId: v.id("organizations"),
    clientOrgName: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    primaryContactName: v.optional(v.string()),
    prefillPassport: v.optional(v.any()),
    invitedBy: v.id("users"),
    inviteTokenHash: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired"),
      v.literal("revoked"),
    ),
    clientOrgId: v.optional(v.id("organizations")),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    otpCode: v.optional(v.string()),
    otpCodeExpiresAt: v.optional(v.number()),
  })
    .index("token", ["inviteTokenHash"])
    .index("broker", ["brokerOrgId"])
    .index("status", ["status"]),

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
    uploadedByBrokerOrgId: v.optional(v.id("organizations")),
    // Broker-authored corrections remain separate from source-backed extraction.
    policyDetailOverrides: v.optional(policyDetailOverridesValidator),
    policyDetailOverridesUpdatedAt: v.optional(v.number()),
    policyDetailOverridesUpdatedByUserId: v.optional(v.id("users")),
    // Entity fields
    carrier: v.string(), // backward compat — prefer security for new extractions
    security: v.optional(v.string()), // insurer/underwriter company (e.g. "Lloyd's Underwriters")
    underwriter: v.optional(v.string()), // named individual underwriter (e.g. "Libby Rudd")
    carrierBrandId: v.optional(v.id("carrierBrands")),
    carrierBrandStatus: v.optional(
      v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    ),
    carrierBrandAttempts: v.optional(v.number()),
    carrierBrandAttemptedAt: v.optional(v.number()),
    carrierIdentityEnrichmentStatus: v.optional(
      v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    ),
    carrierIdentityEnrichmentAttempts: v.optional(v.number()),
    carrierIdentityEnrichmentAttemptedAt: v.optional(v.number()),
    // Read compatibility for policies extracted before generalAgent.
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
    // Full document structure with provenance
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
    // Extracted document structure (sections, endorsements, conditions, etc.)
    // Uses v.any() because the cl-sdk document schema evolves frequently
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
    // Whether the reconciled view is up to date across all files
    reconciliationStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("reconciled"),
        v.literal("error"),
      ),
    ),
    reconciliationLog: v.optional(
      v.array(
        v.object({
          timestamp: v.number(),
          message: v.string(),
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

  // Narrow queue for external Railway extraction workers. Claim polling reads
  // this table instead of scanning all running pipeline records.
  policyExtractionQueue: defineTable({
    policyId: v.id("policies"),
    runId: v.id("policyExtractionRuns"),
    status: v.union(v.literal("queued"), v.literal("leased")),
    leaseId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    heartbeatAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("policy", ["policyId"])
    .index("status_updated", ["status", "updatedAt"]),

  // Lightweight first-read queue. Preview workers populate bounded canonical
  // fields before the full source-backed extraction pipeline completes.
  policyExtractionPreviewQueue: defineTable({
    policyId: v.id("policies"),
    runId: v.id("policyExtractionRuns"),
    status: v.union(v.literal("queued"), v.literal("leased")),
    leaseId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    heartbeatAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("policy", ["policyId"])
    .index("status_updated", ["status", "updatedAt"]),

  // Storage-backed transient extraction artifacts. These records point at JSON
  // blobs in Convex file storage for pre-embedding chunk/source-span payloads,
  // external worker completion payloads, and legacy cl-sdk checkpoint cleanup.
  policyExtractionArtifacts: defineTable({
    policyId: v.id("policies"),
    kind: v.union(
      v.literal("cl_sdk_checkpoint"),
      v.literal("embedding_payload"),
      v.literal("external_completion_payload"),
      v.literal("source_bundle"),
      v.literal("section_result"),
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
    extractedData: v.optional(v.any()), // Raw per-file extraction result (InsuranceDocument)
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

  procurementRequests: defineTable({
    clientOrgId: v.id("organizations"),
    title: v.string(),
    // The single intake narrative. Widening phase: optional until
    // `migrations:runProcurementNarrativeBackfill` completes, then required.
    narrative: v.optional(v.string()),
    // Legacy intake prose superseded by `narrative`. `requirements` never fed
    // the packet and duplicated `requestSummary` on every client-created row.
    requestSummary: v.optional(v.string()),
    requirements: v.optional(v.string()),
    originalNarrative: v.optional(v.string()),
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
      // Retired by `migrations:migrateProcurementRequestStatuses`, which maps
      // quote_review/client_decision to proposal_review, accepted to binding,
      // and closed to completed. Readable only until that migration is
      // confirmed on every deployment; never writable.
      v.literal("quote_review"),
      v.literal("client_decision"),
      v.literal("accepted"),
      v.literal("closed"),
    ),
    clientVisible: v.optional(v.boolean()),
    // Write-only legacy fields: nothing has ever read either one. Purged by
    // `migrations:runProcurementNarrativeBackfill`, dropped in the narrowing
    // release.
    createdBySide: v.optional(
      v.union(v.literal("operator"), v.literal("client")),
    ),
    sharedAt: v.optional(v.number()),
    requirementRevision: v.optional(v.number()),
    specificationRevision: v.optional(v.number()),
    // Monotonic revision of all client/broker-visible packet content.
    packetRevision: v.optional(v.number()),
    replacingPolicyId: v.optional(v.id("policies")),
    resultingPolicyId: v.optional(v.id("policies")),
    inboxToken: v.string(),
    createdByUserId: v.id("users"),
    updatedByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("organization", ["clientOrgId", "updatedAt"])
    .index("status", ["clientOrgId", "status", "updatedAt"])
    .index("inbox", ["inboxToken"]),

  procurementBrokerOutreaches: defineTable({
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    brokerOrgId: v.optional(v.id("organizations")),
    brokerName: v.string(),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    status: v.union(
      v.literal("request_sent"),
      v.literal("can_handle"),
      v.literal("cannot_handle"),
      v.literal("quote_received"),
      v.literal("quote_accepted"),
      v.literal("quote_rejected"),
    ),
    // Legacy structured workflow/quote fields. Runtime reads fold them into the
    // Markdown log, and the next log write clears them for later narrowing.
    applicationUrl: v.optional(v.string()),
    applicationQuestions: v.array(v.string()),
    notes: v.optional(v.string()),
    quoteSummary: v.optional(v.string()),
    quoteAmount: v.optional(v.number()),
    quoteCurrency: v.optional(v.string()),
    quoteUrl: v.optional(v.string()),
    contactUserId: v.optional(v.id("users")),
    contactSnapshot: v.optional(
      v.object({
        name: v.optional(v.string()),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
      }),
    ),
    sentAt: v.optional(v.number()),
    packetSnapshot: v.optional(
      v.object({
        requirementRevision: v.number(),
        specificationRevision: v.number(),
        requirementIds: v.array(v.id("insuranceRequirements")),
        specifications: v.array(v.any()),
        fileItemIds: v.array(v.id("procurementFileItems")),
        capturedAt: v.number(),
      }),
    ),
    packetRevisionAtIssue: v.optional(v.number()),
    createdByUserId: v.id("users"),
    updatedByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("request", ["requestId", "updatedAt"])
    .index("organization", ["clientOrgId", "updatedAt"])
    .index("broker", ["brokerOrgId", "updatedAt"]),

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

  procurementRequirementDrafts: defineTable({
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    proposedRequirement: v.any(),
    matchingRequirementId: v.optional(v.id("insuranceRequirements")),
    status: v.union(
      v.literal("draft"),
      v.literal("confirmed"),
      v.literal("discarded"),
    ),
    confirmedRequirementId: v.optional(v.id("insuranceRequirements")),
    sourceExcerpt: v.optional(v.string()),
    sourcePageStart: v.optional(v.number()),
    sourcePageEnd: v.optional(v.number()),
    createdByUserId: v.id("users"),
    confirmedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("request", ["requestId", "createdAt"])
    .index("status", ["requestId", "status"]),

  procurementRequestRequirements: defineTable({
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    requirementId: v.id("insuranceRequirements"),
    addedByUserId: v.id("users"),
    createdAt: v.number(),
  })
    .index("request", ["requestId", "createdAt"])
    .index("requirement", ["requirementId", "requestId"])
    .index("request_requirement", ["requestId", "requirementId"]),

  procurementSpecifications: defineTable({
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    key: v.string(),
    label: v.string(),
    value: v.string(),
    sourceExcerpt: v.optional(v.string()),
    sourcePageStart: v.optional(v.number()),
    sourcePageEnd: v.optional(v.number()),
    createdByUserId: v.id("users"),
    updatedByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("request", ["requestId", "updatedAt"])
    .index("request_key", ["requestId", "key"]),

  procurementRequestActivities: defineTable({
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    authorUserId: v.id("users"),
    authorSide: v.union(v.literal("operator"), v.literal("client")),
    kind: v.union(
      v.literal("message"),
      v.literal("document"),
      v.literal("status"),
    ),
    body: v.optional(v.string()),
    documentId: v.optional(v.id("procurementRequestDocuments")),
    clientVisible: v.boolean(),
    createdAt: v.number(),
  })
    .index("request", ["requestId", "createdAt"])
    .index("client_visible", ["requestId", "clientVisible", "createdAt"]),

  procurementRequestDocuments: defineTable({
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    fileId: v.id("_storage"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
    clientVisible: v.boolean(),
    uploadedByUserId: v.id("users"),
    uploadedBySide: v.union(v.literal("operator"), v.literal("client")),
    createdAt: v.number(),
  })
    .index("request", ["requestId", "createdAt"])
    .index("client_visible", ["requestId", "clientVisible", "createdAt"])
    .index("storage", ["fileId"]),

  // The procurement packet is an ordered set of markdown sections. Visibility
  // is a single widening ladder so a broker can never see content the client
  // cannot also see.
  procurementPacketSections: defineTable({
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    key: v.string(),
    heading: v.string(),
    body: v.string(),
    order: v.number(),
    audience: v.union(
      v.literal("operator"),
      v.literal("client"),
      v.literal("broker"),
    ),
    audienceProposed: v.optional(
      v.union(v.literal("client"), v.literal("broker")),
    ),
    source: v.union(
      v.literal("manual"),
      v.literal("client"),
      v.literal("operator_agent"),
      v.literal("email"),
      v.literal("document"),
    ),
    sourceRefs: v.optional(v.array(v.string())),
    proposedBody: v.optional(v.string()),
    proposedRationale: v.optional(v.string()),
    manuallyEditedAt: v.optional(v.number()),
    createdByUserId: v.id("users"),
    updatedByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("request", ["requestId", "order"])
    .index("request_key", ["requestId", "key"])
    .index("audience", ["requestId", "audience", "order"]),

  procurementPacketLinks: defineTable({
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    // New links are request-wide: every broker receives the same packet.
    // The optional outreach remains only for legacy recipient-scoped links.
    outreachId: v.optional(v.id("procurementBrokerOutreaches")),
    tokenHash: v.string(),
    recipientLabel: v.string(),
    recipientEmail: v.optional(v.string()),
    expiresAt: v.number(),
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

  procurementPacketUpdateRuns: defineTable({
    requestId: v.id("procurementRequests"),
    sourceFingerprint: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    leaseExpiresAt: v.optional(v.number()),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("request", ["requestId", "updatedAt"]),

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
    // packet edit invalidates them. Widening phase: optional until
    // `migrations:runProposalReviewPacketBackfill` completes.
    packetRevision: v.optional(v.number()),
    // Legacy staleness counters from the structured requirement/specification
    // era. Dropped in the narrowing release.
    requirementRevision: v.optional(v.number()),
    specificationRevision: v.optional(v.number()),
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
    findings: v.array(v.any()),
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
    workerId: v.optional(v.string()),
    completionPayloadStorageId: v.optional(v.id("_storage")),
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
    kind: v.string(),
    value: v.any(),
    createdAt: v.number(),
  })
    .index("proposal", ["proposalId", "createdAt"])
    .index("job", ["jobId", "createdAt"]),

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

  procurementEmailThreads: defineTable({
    clientOrgId: v.id("organizations"),
    addressedRequestId: v.id("procurementRequests"),
    requestId: v.id("procurementRequests"),
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
    latestMessageAt: v.number(),
    messageCount: v.number(),
    archivedAt: v.optional(v.number()),
    archivedByUserId: v.optional(v.id("users")),
    deletedAt: v.optional(v.number()),
    deletedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("organization", ["clientOrgId", "latestMessageAt"])
    .index("request", ["requestId", "latestMessageAt"])
    .index("addressed", ["addressedRequestId", "latestMessageAt"])
    .index("subject", ["clientOrgId", "normalizedSubject", "latestMessageAt"]),

  procurementEmailMessages: defineTable({
    threadId: v.id("procurementEmailThreads"),
    clientOrgId: v.id("organizations"),
    addressedRequestId: v.id("procurementRequests"),
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
    .index("thread", ["threadId", "receivedAt"])
    .index("resend", ["resendEmailId"])
    .index("message", ["messageId"])
    .index("request", ["addressedRequestId", "receivedAt"]),

  procurementFileItems: defineTable({
    requestId: v.id("procurementRequests"),
    clientOrgId: v.id("organizations"),
    outreachId: v.optional(v.id("procurementBrokerOutreaches")),
    clientFileId: v.optional(v.id("clientFiles")),
    sourceEmailMessageId: v.optional(v.id("procurementEmailMessages")),
    purpose: v.union(
      v.literal("requirements"),
      v.literal("application"),
      v.literal("requested_document"),
      v.literal("quote"),
      v.literal("correspondence"),
      v.literal("other"),
    ),
    label: v.string(),
    status: v.union(
      v.literal("requested"),
      v.literal("available"),
      v.literal("sent"),
      v.literal("received"),
    ),
    brokerRelease: v.optional(
      v.union(v.literal("hidden"), v.literal("listed"), v.literal("attached")),
    ),
    brokerReleaseProposed: v.optional(
      v.union(v.literal("listed"), v.literal("attached")),
    ),
    clientVisible: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    updatedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("request", ["requestId", "updatedAt"])
    .index("outreach", ["outreachId", "updatedAt"])
    .index("file", ["clientFileId", "updatedAt"])
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
    procurementEmailThreadId: v.optional(v.id("procurementEmailThreads")),
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
    profile: v.optional(companyInformationProfileValidator),
    organizationFacts: v.optional(
      v.array(companyInformationStoredOrganizationFactValidator),
    ),
    // Legacy; cleared by migrations:runCompanyWikiLegacyPurge.
    procurementFacts: v.optional(v.array(v.any())),
    observedAt: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("source", ["sourceRef"])
    .index("organization", ["orgId", "updatedAt"])
    .index("file", ["clientFileId"])
    .index("email", ["procurementEmailThreadId"]),

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
    notes: v.optional(v.string()),
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

  certificateWorkflowSettings: defineTable({
    brokerOrgId: v.optional(v.id("organizations")),
    clientOrgId: v.optional(v.id("organizations")),
    populateHoldersFromEndorsements: v.boolean(),
    renewalReissueEnabled: v.boolean(),
    renewalReissueMode: v.literal("review_queue"),
    renewalReviewLeadDays: v.optional(v.number()),
    policyChangeRequestsForHeldCertificatesEnabled: v.optional(v.boolean()),
    channels: v.optional(v.array(policyDeliveryChannelValidator)),
    copyInstructions: v.optional(v.string()),
    updatedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("broker", ["brokerOrgId"])
    .index("broker_client", ["brokerOrgId", "clientOrgId"])
    .index("client", ["clientOrgId"]),

  certificateWorkflowJobs: defineTable({
    orgId: v.id("organizations"),
    brokerOrgId: v.optional(v.id("organizations")),
    certificateId: v.id("policyCertificates"),
    certificateVersionId: v.optional(v.id("certificateVersions")),
    holderId: v.id("certificateHolders"),
    policyId: v.id("policies"),
    policyVersionId: v.optional(v.id("policyVersions")),
    kind: certificateWorkflowJobKindValidator,
    status: certificateWorkflowJobStatusValidator,
    idempotencyKey: v.string(),
    reason: v.optional(v.string()),
    recipientName: v.optional(v.string()),
    recipientEmail: v.optional(v.string()),
    recipientPhone: v.optional(v.string()),
    threadId: v.optional(v.id("threads")),
    reviewNotes: v.optional(v.string()),
    sendNotes: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    sentByUserId: v.optional(v.id("users")),
    cancelledAt: v.optional(v.number()),
    cancelledByUserId: v.optional(v.id("users")),
    cancelReason: v.optional(v.string()),
    lastError: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    reviewedByUserId: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("organization", ["orgId"])
    .index("organization_status", ["orgId", "status"])
    .index("policy", ["policyId"])
    .index("certificate", ["certificateId"])
    .index("holder", ["holderId"])
    .index("thread", ["threadId"])
    .index("idempotency", ["idempotencyKey"]),

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

  // ── Notifications ──

  notifications: defineTable({
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")), // null = org-wide
    type: v.union(
      v.literal("coverage_gap"),
      v.literal("renewal_reminder"),
      v.literal("policy_lapsed"),
      v.literal("coverage_limit_concern"),
      v.literal("missing_coverage"),
      v.literal("carrier_rating_change"),
      v.literal("broker_action"),
      v.literal("extraction_complete"),
      v.literal("extraction_error"),
      v.literal("incomplete_extraction"),
      v.literal("stale_data"),
      v.literal("premium_anomaly"),
      // Broker/client lifecycle
      v.literal("client_invitation_accepted"),
      v.literal("client_onboarding_completed"),
      v.literal("client_document_uploaded"),
      v.literal("policy_delivered_by_broker"),
      v.literal("vendor_compliance_met"),
      v.literal("vendor_compliance_gap"),
      v.literal("vendor_policy_expiring"),
      v.literal("vendor_policy_expired"),
      v.literal("mailbox_attention"),
      v.literal("own_compliance_gap"),
      v.literal("own_compliance_resolved"),
    ),
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
    actionType: v.optional(v.string()),
    actionPayload: v.optional(v.any()),
    sourceRef: v.optional(v.any()), // what generated this: policyId, emailId, etc.
    createdAt: v.number(),
    expiresAt: v.optional(v.number()), // auto-dismiss after this date
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

  // ── Broker Activity ──

  brokerActivity: defineTable({
    brokerOrgId: v.id("organizations"),
    clientOrgId: v.id("organizations"),
    type: v.union(
      v.literal("invitation_accepted"),
      v.literal("onboarding_completed"),
      v.literal("document_uploaded"),
      v.literal("policy_uploaded"),
      v.literal("policy_extraction_completed"),
      v.literal("notification_fired"),
    ),
    actorUserId: v.optional(v.id("users")),
    actorSide: v.union(
      v.literal("broker"),
      v.literal("client"),
      v.literal("system"),
    ),
    payload: v.optional(v.any()),
    summary: v.string(),
    createdAt: v.number(),
  })
    .index("broker_created", ["brokerOrgId", "createdAt"])
    .index("broker_client", ["brokerOrgId", "clientOrgId", "createdAt"])
    .index("client_created", ["clientOrgId", "createdAt"]),

  // ── Vector Search (cl-sdk 0.5.0+) ──

  // Document chunks for semantic search over extracted bound policy content
  documentChunks: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    chunkId: v.string(), // SDK-assigned: "${docId}:${type}:${index}"
    chunkType: v.string(), // carrier_info, named_insured, coverage, endorsement, etc.
    text: v.string(), // chunk content for embedding + display
    metadata: v.optional(v.any()), // SDK metadata for filtering
    embedding: v.array(v.float64()), // 1536-dim vector (text-embedding-3-small)
    createdAt: v.number(),
  })
    .index("policy", ["policyId"])
    .index("organization", ["orgId"])
    .index("chunk", ["chunkId"])
    .vectorIndex("embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["orgId"],
    }),

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
    .index("policy_parent", ["policyId", "parentSpanId"]),

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
    .index("policy_parent", ["policyId", "parentNodeId"]),

  // Compatibility chunks over source spans. Source tree nodes are the primary
  // retrieval layer; these preserve span IDs for legacy lookup surfaces.
  sourceChunks: defineTable({
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    chunkId: v.string(),
    documentId: v.string(),
    sourceSpanIds: v.array(v.string()),
    text: v.string(),
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
  })
    .index("policy", ["policyId"])
    .index("organization", ["orgId"])
    .index("chunk", ["chunkId"]),

  policyUpdateRuns: defineTable({
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    sourcePolicyFileIds: v.optional(v.array(v.id("policyFiles"))),
    sourceFileIds: v.optional(v.array(v.id("_storage"))),
    updateMode: v.union(v.literal("append_to_existing")),
    status: v.union(
      v.literal("pending"),
      v.literal("complete"),
      v.literal("needs_review"),
      v.literal("error"),
    ),
    beforeSnapshot: v.optional(v.any()),
    afterSnapshot: v.optional(v.any()),
    fieldDiffs: v.optional(v.array(v.any())),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("organization", ["orgId"])
    .index("policy", ["policyId"])
    .index("status", ["status"]),

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

  // Conversation turns for cross-thread memory search
  conversationTurns: defineTable({
    orgId: v.id("organizations"),
    conversationId: v.string(), // thread ID or conversation ID
    role: v.string(), // user, assistant, tool
    content: v.string(),
    embedding: v.array(v.float64()), // 1536-dim vector
    createdAt: v.number(),
  })
    .index("conversation", ["conversationId"])
    .index("organization", ["orgId"])
    .vectorIndex("embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["orgId"],
    }),

  publicDemoConversations: defineTable({
    channel: publicDemoChannelValidator,
    senderHash: v.string(),
    senderContact: v.optional(v.string()),
    agentAddress: v.optional(v.string()),
    leadName: v.optional(v.string()),
    leadCompany: v.optional(v.string()),
    leadEmail: v.optional(v.string()),
    leadUseCase: v.optional(v.string()),
    stage: publicDemoLeadStageValidator,
    ctaStatus: publicDemoCtaStatusValidator,
    safetyNoticeSent: v.optional(v.boolean()),
    turnCount: v.number(),
    lastMessageAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("channel_sender", ["channel", "senderHash"])
    .index("activity", ["lastMessageAt"])
    .index("stage_activity", ["stage", "lastMessageAt"])
    .index("cta_activity", ["ctaStatus", "lastMessageAt"])
    .index("email", ["leadEmail"]),

  publicDemoChatLogs: defineTable({
    conversationId: v.id("publicDemoConversations"),
    channel: publicDemoChannelValidator,
    direction: v.union(
      v.literal("inbound"),
      v.literal("outbound"),
      v.literal("system"),
    ),
    subject: v.optional(v.string()),
    content: v.string(),
    contentHtml: v.optional(v.string()),
    modelProvider: v.optional(v.string()),
    model: v.optional(v.string()),
    routeSource: v.optional(v.string()),
    transport: v.optional(v.string()),
    toolCalls: v.optional(
      v.array(
        v.object({
          name: v.string(),
          input: v.optional(v.string()),
          output: v.optional(v.string()),
        }),
      ),
    ),
    ctaUrl: v.optional(v.string()),
    deliveryStatus: v.optional(v.string()),
    deliveryId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("conversation_created", ["conversationId", "createdAt"])
    .index("channel_created", ["channel", "createdAt"])
    .index("created", ["createdAt"]),

  publicDemoSalesTranscripts: defineTable({
    conversationId: v.id("publicDemoConversations"),
    channel: publicDemoChannelValidator,
    senderContact: v.optional(v.string()),
    leadName: v.optional(v.string()),
    leadCompany: v.optional(v.string()),
    leadEmail: v.optional(v.string()),
    leadUseCase: v.optional(v.string()),
    stage: publicDemoLeadStageValidator,
    ctaStatus: publicDemoCtaStatusValidator,
    summary: v.string(),
    objections: v.array(v.string()),
    nextStep: v.string(),
    curatedTurns: v.array(
      v.object({
        speaker: v.string(),
        content: v.string(),
        at: v.number(),
      }),
    ),
    createdAt: v.number(),
    lastUpdatedAt: v.number(),
  })
    .index("conversation", ["conversationId"])
    .index("updated", ["lastUpdatedAt"])
    .index("channel_updated", ["channel", "lastUpdatedAt"])
    .index("stage_updated", ["stage", "lastUpdatedAt"]),

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
    feedbackPromptedAt: v.optional(v.number()),
    replyToMessageId: v.optional(v.id("threadMessages")),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedRequirementIds: v.optional(
      v.array(v.id("insuranceRequirements")),
    ),
    referencedMailboxIds: v.optional(v.array(v.id("connectedEmailAccounts"))),
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
          input: v.optional(v.string()),
          output: v.optional(v.string()),
        }),
      ),
    ),
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
    expiresAt: v.number(),
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
    spectrumMessageId: v.optional(v.string()),
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
    attachment: v.optional(
      v.object({
        providerFileId: v.string(),
        filename: v.string(),
        contentType: v.string(),
        size: v.optional(v.number()),
        fileId: v.optional(v.id("_storage")),
      }),
    ),
    attachments: v.optional(
      v.array(
        v.object({
          providerFileId: v.string(),
          filename: v.string(),
          contentType: v.string(),
          size: v.optional(v.number()),
          fileId: v.optional(v.id("_storage")),
        }),
      ),
    ),
    eventType: v.union(
      v.literal("message"),
      v.literal("edit"),
      v.literal("delete"),
    ),
    isDirectMessage: v.optional(v.boolean()),
    isPrivateChannel: v.optional(v.boolean()),
    isPrimaryChannel: v.boolean(),
    // Both fields stay optional for the widening release so existing inbound
    // events remain valid until the production backfill has completed.
    mentionsSpot: v.optional(v.boolean()),
    mentionsGlass: v.optional(v.boolean()),
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
    actionTokenExpiresAt: v.number(),
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

  operatorAgentThreads: defineTable({
    ownerUserId: v.id("users"),
    visibility: v.union(v.literal("private"), v.literal("shared")),
    channel: v.union(
      v.literal("chat"),
      v.literal("slack"),
      v.literal("imessage"),
      v.literal("mcp"),
    ),
    conversationKey: v.optional(v.string()),
    title: v.string(),
    initialContext: v.optional(
      v.object({
        pageType: v.string(),
        entityId: v.optional(v.string()),
        summary: v.optional(v.string()),
      }),
    ),
    lastMessageAt: v.number(),
    archivedAt: v.optional(v.number()),
    archiveState: v.optional(v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("owner_archive", ["ownerUserId", "archiveState", "lastMessageAt"])
    .index("visibility_archive", [
      "visibility",
      "archiveState",
      "lastMessageAt",
    ])
    .index("owner_conversation", ["ownerUserId", "channel", "conversationKey"])
    .index("channel_conversation", ["channel", "conversationKey"]),

  operatorAgentMessages: defineTable({
    threadId: v.id("operatorAgentThreads"),
    ownerUserId: v.id("users"),
    channel: v.union(
      v.literal("chat"),
      v.literal("slack"),
      v.literal("imessage"),
      v.literal("mcp"),
    ),
    role: v.union(v.literal("user"), v.literal("agent"), v.literal("system")),
    userId: v.optional(v.id("users")),
    userName: v.optional(v.string()),
    replyToMessageId: v.optional(v.id("operatorAgentMessages")),
    dedupeKey: v.optional(v.string()),
    content: v.string(),
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
          input: v.optional(v.string()),
          output: v.optional(v.string()),
        }),
      ),
    ),
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
    expiresAt: v.number(),
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
    .index("idempotency", ["operatorUserId", "idempotencyKey"]),

  operatorAgentRuns: defineTable({
    threadId: v.id("operatorAgentThreads"),
    operatorUserId: v.id("users"),
    userMessageId: v.id("operatorAgentMessages"),
    agentMessageId: v.id("operatorAgentMessages"),
    executionKind: v.optional(
      v.union(v.literal("goal"), v.literal("direct_tool")),
    ),
    objective: v.string(),
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
      }),
    ),
    cancellationRequestedAt: v.optional(v.number()),
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
    expiresAt: v.number(),
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
    orgId: v.id("organizations"),
    threadId: v.optional(v.id("threads")),
    status: v.union(
      v.literal("draft"),
      v.literal("pending"),
      v.literal("sent"),
      v.literal("cancelled"),
    ),
    emailPayload: v.string(), // JSON-serialized Resend payload
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
    allowMultipleCoiAttachments: v.optional(v.boolean()),
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
    .index("status", ["status"]),

  emailDeliveryAttempts: defineTable({
    orgId: v.id("organizations"),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    threadId: v.optional(v.id("threads")),
    threadMessageId: v.optional(v.id("threadMessages")),
    source: v.union(
      v.literal("pending_email"),
      v.literal("email_subagent"),
      v.literal("policy_delivery"),
      v.literal("inbound_email"),
      v.literal("procurement_packet"),
    ),
    provider: v.literal("resend"),
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
    .index("organization", ["orgId"])
    .index("thread", ["threadId"])
    .index("message", ["threadMessageId"])
    .index("status", ["status"]),

  // ── Presence ──

  // ── OAuth (MCP remote clients) ──

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
    scope: v.optional(v.string()),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
    scopes: v.optional(v.array(v.union(v.literal("read"), v.literal("write")))),
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
    scope: v.optional(v.string()),
    expiresAt: v.number(),
    refreshExpiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
    scopes: v.optional(v.array(v.union(v.literal("read"), v.literal("write")))),
  })
    .index("token", ["tokenHash"])
    .index("refresh_token", ["refreshTokenHash"])
    .index("user", ["userId"]),

  // ── Rate Limit Counters ──

  rateLimitCounters: defineTable({
    tokenId: v.id("oauthTokens"),
    windowStart: v.number(),
    count: v.number(),
    lastRequestMs: v.number(),
  }).index("token", ["tokenId"]),

  publicDemoRateCounters: defineTable({
    rateKey: v.string(),
    windowStart: v.number(),
    count: v.number(),
    lastRequestAt: v.number(),
  }).index("key", ["rateKey"]),

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
});
