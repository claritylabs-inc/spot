/**
 * Procurement-family guidance moved out of individual tool descriptions so it is
 * paid for once per turn that selects the family instead of once per tool in
 * every turn's catalog. Not yet wired: `OPERATOR_TOOL_FAMILY_CATALOG` sets
 * `guidance` only for `outbound_email`; wiring `PROCUREMENT_FAMILY_GUIDANCE`
 * into the `procurement` family is a shared change (see the W10 handoff).
 * Each tool description still states on its own that sends are externally
 * visible and need exact approval.
 */

/** Shared by launch_procurement_provider_outreach and send_procurement_client_email. */
export const PROCUREMENT_OUTREACH_SEND_GUIDANCE = `PROCUREMENT EMAIL SENDS (launch_procurement_provider_outreach, send_procurement_client_email):
These send from your own team address, signed with your full name and Spot, and copy your saved Always CC. The exact approval binds the current sender identity: if your name, address or Always CC changes before approval, unsent mail is held and a fresh approval is needed. Preflight rejects unavailable providers, recipients, forms and request states before the approval is shown, so report a rejection instead of retrying blindly. Report mail as sent only when the tool returns a launched or sequence result.`;

/** Moved from update_procurement_packet. */
export const PROCUREMENT_PACKET_MARKDOWN_GUIDANCE = `PROCUREMENT PACKET MARKDOWN (update_procurement_packet):
Put intake, notes, provider outreach history and follow-ups in private.md or public.md. Prose in public.md outside the generated application block is the request's Submission notes: it is shown to providers ahead of the application and is visible to the client, so keep added context, provider questions and request details there. Use descriptive headings with a logical hierarchy and avoid adjacent headings that repeat a topic. Use GFM tables for comparable coverage terms, locations, quotes or status items, lists for independent facts or next steps, and short paragraphs for context. Choose structure to fit the content, preserve sourced facts and manual prose, and do not impose fixed sections.`;

export const PROCUREMENT_FAMILY_GUIDANCE = [
  PROCUREMENT_OUTREACH_SEND_GUIDANCE,
  PROCUREMENT_PACKET_MARKDOWN_GUIDANCE,
].join("\n\n");
