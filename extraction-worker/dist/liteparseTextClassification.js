function normalizeWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
}
function median(values, fallback) {
    const sorted = values
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b);
    return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : fallback;
}
function isUppercaseDisplayLine(value) {
    const text = normalizeWhitespace(value);
    const letters = text.match(/[A-Za-z]/g) ?? [];
    if (letters.length < 6)
        return false;
    return !letters.some((letter) => letter >= "a" && letter <= "z") &&
        /^[A-Z0-9][A-Z0-9\s,.'&/():;-]+$/.test(text);
}
function isExplicitHeading(value) {
    return /^(section|coverage|endorsement|declarations?|schedule|exclusions?|conditions?)\b/i.test(value);
}
function endsWithContinuationWord(value) {
    return /\b(and|or|of|for|the|to|with|within|under|during|any|applicable|provided|against)$/i.test(value);
}
function hasSentenceSignal(value) {
    return /[.!?]/.test(value) || endsWithContinuationWord(value);
}
function rowIndex(row, pageRows) {
    const directIndex = pageRows.indexOf(row);
    if (directIndex >= 0)
        return directIndex;
    return pageRows.findIndex((candidate) => candidate.text === row.text &&
        Math.abs(candidate.bbox.y - row.bbox.y) <= 0.5 &&
        Math.abs(candidate.bbox.x - row.bbox.x) <= 0.5);
}
function isBodyWidthLine(row, pageRows) {
    const maxWidth = Math.max(row.bbox.width, ...pageRows.map((candidate) => candidate.bbox.width));
    return row.bbox.width >= maxWidth * 0.72;
}
function isWrappedNeighbor(left, right, pageRows, medianHeight) {
    const sameColumn = Math.abs(left.bbox.x - right.bbox.x) <= 12;
    const tightLineGap = Math.abs(right.bbox.y - left.bbox.y) <= medianHeight * 1.75;
    return sameColumn &&
        tightLineGap &&
        isBodyWidthLine(left, pageRows) &&
        isBodyWidthLine(right, pageRows) &&
        isUppercaseDisplayLine(left.text) &&
        isUppercaseDisplayLine(right.text);
}
function contiguousUppercaseBlock(row, pageRows, medianHeight) {
    const index = rowIndex(row, pageRows);
    if (index < 0)
        return [row];
    let first = index;
    while (first > 0 && isWrappedNeighbor(pageRows[first - 1], pageRows[first], pageRows, medianHeight)) {
        first -= 1;
    }
    let last = index;
    while (last < pageRows.length - 1 && isWrappedNeighbor(pageRows[last], pageRows[last + 1], pageRows, medianHeight)) {
        last += 1;
    }
    return pageRows.slice(first, last + 1);
}
function isWrappedBodyParagraphLine(row, pageRows, medianHeight) {
    const text = normalizeWhitespace(row.text);
    if (text.length < 40 || isExplicitHeading(text))
        return false;
    if (!isUppercaseDisplayLine(text) || !isBodyWidthLine(row, pageRows))
        return false;
    const block = contiguousUppercaseBlock(row, pageRows, medianHeight);
    if (block.length < 2)
        return false;
    return block.length >= 3 || block.some((candidate) => hasSentenceSignal(candidate.text));
}
export function classifyLiteParseTextElement(row, pageRows) {
    const text = normalizeWhitespace(row.text);
    const medianHeight = median(pageRows.map((item) => item.bbox.height), row.bbox.height);
    if (isWrappedBodyParagraphLine(row, pageRows, medianHeight))
        return "paragraph";
    const looksLikeHeading = row.bbox.height >= medianHeight * 1.2 ||
        (isUppercaseDisplayLine(text) && text.length <= 120) ||
        isExplicitHeading(text);
    return looksLikeHeading ? "title" : "paragraph";
}
//# sourceMappingURL=liteparseTextClassification.js.map