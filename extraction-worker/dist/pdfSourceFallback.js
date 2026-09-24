/**
 * Fall back only when LiteParse conversion itself fails. Work performed after
 * a successful conversion (supplementation, model extraction, validation)
 * stays outside this error boundary and must fail the job truthfully.
 */
export async function preparePdfSourceWithLiteParseFallback(options) {
    let converted;
    try {
        converted = await options.convertWithLiteParse();
    }
    catch (error) {
        await options.onLiteParseFailure?.(error);
        return {
            parser: "pdfjs",
            prepared: await options.preparePdfJsSource(error),
        };
    }
    return {
        parser: "liteparse",
        prepared: await options.prepareLiteParseSource(converted),
        converted,
    };
}
//# sourceMappingURL=pdfSourceFallback.js.map