export const CARRIER_IDENTITY_GUIDANCE = `Carrier identity rules:
- Distinguish a policy-facing carrier name from the legal entities behind it.
- When the source explicitly says one or more legal entities are "operating as", "doing business as", "d/b/a", or "DBA" another name, use the operating/trade name as the user-facing carrier identity.
- Do not classify an operating/trade name as an MGA, General Agent, program administrator, or administrator unless the source explicitly assigns that separate role.
- Preserve every named legal entity. If the source connects legal entities with "and", "or", or "and/or", do not collapse them into one invented company.
- When Lloyd's underwriters are "led by" a named organization or syndicate, preserve the lead name, every syndicate number, and the complete source designation. Never reduce that identity to generic "Lloyd's Underwriters".
- For an operational-profile schema, put the operating/trade name in a party with role "carrier", put each legal entity in its own party with role "insurer", and use the operating/trade name for the top-level insurer display value.
- For a carrier/security schema, put the operating/trade name in carrier and preserve the source-stated legal entity wording in security.`;
export function applyCarrierIdentityGuidance(prompt, taskKind, extractorName) {
    const applies = taskKind === "extraction_operational_profile" ||
        taskKind === "extraction_preview" ||
        (taskKind === "extraction_focused" &&
            extractorName === "carrier_info");
    return applies && !prompt.includes(CARRIER_IDENTITY_GUIDANCE)
        ? `${prompt}\n\n${CARRIER_IDENTITY_GUIDANCE}`
        : prompt;
}
//# sourceMappingURL=extractionPromptGuidance.js.map