const COLUMN_ALIGNMENT_TOLERANCE = 42;
const MIN_STABLE_BODY_ROWS = 2;
function nearestColumnIndex(anchors, cell) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [index, anchor] of anchors.entries()) {
        const distance = Math.abs(anchor - cell.x);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    }
    return bestDistance <= COLUMN_ALIGNMENT_TOLERANCE ? bestIndex : -1;
}
function rowMatchesHeaderGrid(row, anchors) {
    if (row.cells.length < 2)
        return false;
    if (nearestColumnIndex(anchors, row.cells[0]) !== 0)
        return false;
    const matchedColumns = new Set();
    for (const cell of row.cells) {
        const columnIndex = nearestColumnIndex(anchors, cell);
        if (columnIndex >= 0)
            matchedColumns.add(columnIndex);
    }
    return matchedColumns.size >= Math.min(2, anchors.length);
}
export function shouldEmitStructuredLiteParseTable(rows) {
    const headerIndex = rows.findIndex((row) => row.isHeader && row.cells.length >= 2);
    if (headerIndex < 0)
        return false;
    const header = rows[headerIndex];
    const anchors = header.cells.map((cell) => cell.x);
    if (anchors.length < 2 || anchors.length > 8)
        return false;
    const bodyRows = rows.slice(headerIndex + 1).filter((row) => !row.isHeader);
    if (bodyRows.length < MIN_STABLE_BODY_ROWS)
        return false;
    const stableRows = bodyRows.filter((row) => rowMatchesHeaderGrid(row, anchors));
    return stableRows.length >= MIN_STABLE_BODY_ROWS && stableRows.length / bodyRows.length >= 0.75;
}
//# sourceMappingURL=liteparseTableConfidence.js.map