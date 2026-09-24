/**
 * Model-independent cl-sdk output budgets. cl-sdk prefers these over its
 * built-in hint tokens; cl-router clamps each request to the selected model's
 * output limit. Keep in sync with `EXTRACTION_MODEL_CAPABILITIES` in
 * `convex/lib/modelCatalog.ts`.
 */
export const EXTRACTION_MODEL_CAPABILITIES = {
    defaultOutputTokens: 8_192,
    longListOutputTokens: 24_576,
    taskOutputTokens: {
        extraction_classify: 2_048,
        extraction_source_tree: 4_096,
        extraction_page_map: 8_192,
        extraction_focused: 16_384,
        extraction_long_list: 24_576,
        extraction_operational_profile: 32_768,
        extraction_coverage_recovery: 16_384,
        extraction_coverage_cleanup: 4_096,
        extraction_review: 12_288,
        extraction_referential_lookup: 12_288,
        query_classify: 2_048,
        query_reason: 8_192,
        query_verify: 4_096,
        query_respond: 8_192,
        pce_impact_analysis: 8_192,
        pce_packet_generation: 8_192,
    },
};
//# sourceMappingURL=modelCapabilities.js.map