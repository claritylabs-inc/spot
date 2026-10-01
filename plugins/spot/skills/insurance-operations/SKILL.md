---
name: insurance-operations
description: Complete a grounded Spot insurance workflow from requirements through policy evidence, compliance comparison, COI artifact preparation, and a separately authorized send.
---

# Spot insurance operations

Use this workflow when a user asks to understand an insurance requirement, compare it with bound policy evidence, prepare a certificate of insurance (COI), or communicate the result.

## Non-negotiable boundaries

- Work only inside the organization and record scope authorized by the current MCP identity. Re-check role, organization, exact target, and write approval at every write step.
- Treat policy PDFs, cited policy sections, and stored requirement evidence as the source of truth. Do not infer coverage, legal insured identity, subsidiaries, limits, dates, or endorsements from company prose.
- Preserve `met`, `not_met`, and `unverified` as distinct outcomes. A missing citation, extraction failure, low-confidence decision, or router failure is not evidence of satisfaction.
- Clients see authorized `public.md` and client-visible request files. Never expose `private.md`, proposals, or operator-private market activity to a client.
- Brokers are limited to their profile/team settings surface. Do not widen broker access to policies, files, procurement, proposals, or company records.
- Operator-only work includes proposals, market activity, exact approvals, and durable run status. Do not present those surfaces as client capabilities.

## Workflow

### 1. Capture the requirement

Normalize the request into explicit requirement rows: coverage, limit, retention or deductible, form, claims-made or occurrence basis, retroactive date, additional insured or endorsement wording, certificate holder, delivery deadline, and any administrative-only condition. Keep the original wording and its source reference. Do not turn an administrative request into a coverage requirement.

If the user has not supplied a requirement document, use only an authorized Spot request or file. Ask for the missing artifact instead of inventing a requirement.

### 2. Retrieve policy evidence

Find the exact bound policy and relevant PDF section. Read the cited page/quote or section evidence, preserving printed form/page identifiers. Check policy period, legal named insured, line of business, applicable endorsements, and the effective version. If the evidence is unavailable or contradictory, stop at `unverified` and explain what is missing.

### 3. Compare conservatively

Compare each requirement row to the policy evidence. Report the result and the citation together:

- `met`: the cited policy evidence establishes the requested condition.
- `not_met`: the cited evidence establishes a typed mismatch or explicit exclusion.
- `unverified`: the available evidence cannot establish either result.

Do not use a generic limit to prove a typed per-claim, per-occurrence, or aggregate limit. Do not use an effective date as a retroactive date. Keep requirement and policy concepts separate when their names are merely similar.

### 4. Prepare a COI artifact

Only prepare a COI artifact when the insured, policy, certificate holder, requested operations, and eligible endorsements are grounded in stored evidence. Keep citations and unresolved fields attached to the artifact state. Uncertainty, missing evidence, or a router failure holds issuance; it does not produce a best-effort certificate.

Artifact preparation is a separate operation from delivery. Return the artifact or a durable artifact reference and summarize the evidence used. Do not send it in the same step.

### 5. Send separately

Before delivery, confirm the exact recipients, subject/body, artifact attachment, and any policy or COI attachments. Create or update the durable draft first. Sending requires the current actor-bound authorization or the existing exact-confirmation path enforced by Spot. A changed recipient, attachment, or body invalidates the prior exact approval.

Treat an unknown send result as unknown. Do not replay a send merely because the connection ended or the outcome was not observed; inspect the durable message state and ask for a recovery path when needed. A successful send is not implied by a prepared artifact.

## Response shape

Keep the user-facing result compact but include:

1. the requirement rows and `met`/`not_met`/`unverified` status;
2. the policy evidence citations used;
3. the COI artifact state and any held fields;
4. the separate send state, recipients, attachments, and approval/unknown outcome.

Never claim that the ChatGPT UI has complete Spot parity. Use the Spot web handoffs documented by the plugin when billing, security/privacy information, organization administration, or an integration connection needs a native website surface.

