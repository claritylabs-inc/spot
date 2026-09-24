import dayjs from "dayjs";
import { buildSourceSpan, chunkSourceSpans, } from "@claritylabs/cl-sdk";
import { shouldEmitStructuredLiteParseTable } from "./liteparseTableConfidence.js";
import { classifyLiteParseTextElement } from "./liteparseTextClassification.js";
import { INITIAL_LITEPARSE_QUEUE_FAIRNESS_STATE, selectNextLiteParseQueueIndex, } from "./liteparseQueue.js";
const LITEPARSE_VERSION = "2.0.3";
export const LITEPARSE_NATIVE_CONCURRENCY = 1;
export const LITEPARSE_MAX_QUEUED_DOCUMENTS = readBoundedIntEnv("LITEPARSE_MAX_QUEUED_DOCUMENTS", 12, 1, 64);
const LITEPARSE_PRIORITY_RANK = {
    http: 0,
    preview: 1,
    full: 2,
};
const TABLE_HEADER_PATTERN = /\b(coverage|limit|limits?|basis|retroactive|deductible|premium|tax|fee|sub-?limit|aggregate|claim)\b/i;
const TABLE_VALUE_PATTERN = /\b(CAD|USD|\$|limit|aggregate|claim|shared|claims?-made|prior acts?|full prior|deductible|premium|tax|fee)\b/i;
let liteParseRunning = false;
const liteParseWaitQueue = [];
let liteParseQueueFairnessState = {
    ...INITIAL_LITEPARSE_QUEUE_FAIRNESS_STATE,
};
function abortError(message = "LiteParse conversion aborted") {
    if (typeof DOMException === "function") {
        return new DOMException(message, "AbortError");
    }
    const error = new Error(message);
    error.name = "AbortError";
    return error;
}
function sortLiteParseWaitQueue() {
    liteParseWaitQueue.sort((left, right) => {
        const rank = LITEPARSE_PRIORITY_RANK[left.priority] -
            LITEPARSE_PRIORITY_RANK[right.priority];
        if (rank !== 0)
            return rank;
        return left.enqueuedAt - right.enqueuedAt;
    });
}
function pumpLiteParseQueue() {
    if (liteParseRunning)
        return;
    for (let index = liteParseWaitQueue.length - 1; index >= 0; index -= 1) {
        const queued = liteParseWaitQueue[index];
        if (!queued.cancelled && !queued.signal?.aborted)
            continue;
        liteParseWaitQueue.splice(index, 1);
        queued.reject(abortError());
    }
    const selection = selectNextLiteParseQueueIndex(liteParseWaitQueue.map((queued) => queued.priority), liteParseQueueFairnessState);
    liteParseQueueFairnessState = selection.state;
    if (selection.index < 0)
        return;
    const [entry] = liteParseWaitQueue.splice(selection.index, 1);
    if (!entry)
        return;
    liteParseRunning = true;
    entry.start();
}
async function withSerializedLiteParse(operation, options) {
    const priority = options?.priority ?? "full";
    const signal = options?.signal;
    if (signal?.aborted) {
        throw abortError();
    }
    if (liteParseWaitQueue.length >= LITEPARSE_MAX_QUEUED_DOCUMENTS) {
        throw new Error(`LiteParse wait queue is full (${LITEPARSE_MAX_QUEUED_DOCUMENTS} documents)`);
    }
    return new Promise((resolve, reject) => {
        const entry = {
            priority,
            enqueuedAt: dayjs().valueOf(),
            signal,
            cancelled: false,
            reject,
            start: () => {
                if (entry.cancelled || signal?.aborted) {
                    liteParseRunning = false;
                    reject(abortError());
                    pumpLiteParseQueue();
                    return;
                }
                Promise.resolve()
                    .then(operation)
                    .then(resolve, reject)
                    .finally(() => {
                    liteParseRunning = false;
                    pumpLiteParseQueue();
                });
            },
        };
        if (signal) {
            signal.addEventListener("abort", () => {
                if (entry.cancelled)
                    return;
                entry.cancelled = true;
                const index = liteParseWaitQueue.indexOf(entry);
                if (index >= 0) {
                    liteParseWaitQueue.splice(index, 1);
                    reject(abortError());
                }
            }, { once: true });
        }
        liteParseWaitQueue.push(entry);
        sortLiteParseWaitQueue();
        pumpLiteParseQueue();
    });
}
function readBoundedIntEnv(name, fallback, min, max) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value))
        return fallback;
    return Math.max(min, Math.min(max, value));
}
function readBooleanEnv(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}
function normalizeWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
}
function formatNumber(value) {
    return Number.isFinite(value) ? value.toFixed(2) : "";
}
function spanWithBbox(span, bbox, pageDims) {
    return {
        ...span,
        bbox: [bbox],
        metadata: {
            ...(span.metadata ?? {}),
            bbox: `${formatNumber(bbox.x)},${formatNumber(bbox.y)},${formatNumber(bbox.width)},${formatNumber(bbox.height)}`,
            bboxCoordinateWidth: formatNumber(pageDims.width),
            bboxCoordinateHeight: formatNumber(pageDims.height),
        },
    };
}
function textItemCenterY(item) {
    return item.y + item.height / 2;
}
function rowTolerance(items) {
    const fontSizes = items
        .map((item) => item.fontSize ?? item.height)
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b);
    const median = fontSizes.length > 0 ? fontSizes[Math.floor(fontSizes.length / 2)] : 10;
    return Math.max(2, median * 0.65);
}
function groupRows(page) {
    const items = page.textItems
        .map((item) => ({ ...item, text: normalizeWhitespace(item.text) }))
        .filter((item) => item.text.length > 0)
        .sort((a, b) => textItemCenterY(a) - textItemCenterY(b) || a.x - b.x);
    const tolerance = rowTolerance(items);
    const rowItems = [];
    for (const item of items) {
        const current = rowItems[rowItems.length - 1];
        if (!current || Math.abs(textItemCenterY(current[0]) - textItemCenterY(item)) > tolerance) {
            rowItems.push([item]);
        }
        else {
            current.push(item);
        }
    }
    return rowItems
        .map((cells) => {
        const ordered = cells.sort((a, b) => a.x - b.x);
        const minX = Math.min(...ordered.map((item) => item.x));
        const minY = Math.min(...ordered.map((item) => item.y));
        const maxX = Math.max(...ordered.map((item) => item.x + item.width));
        const maxY = Math.max(...ordered.map((item) => item.y + item.height));
        return {
            cells: ordered.map((item) => ({ item, text: normalizeWhitespace(item.text) })),
            pageNum: page.pageNum,
            bbox: {
                page: page.pageNum,
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
            },
            text: ordered.map((item) => item.text).join(" "),
        };
    })
        .filter((row) => row.text.trim().length > 0);
}
function isTableLikeRow(row) {
    if (row.cells.length < 2)
        return false;
    const rowText = row.text;
    if (TABLE_HEADER_PATTERN.test(rowText) || TABLE_VALUE_PATTERN.test(rowText))
        return true;
    return row.cells.some((cell, index) => {
        const next = row.cells[index + 1];
        return next ? next.item.x - (cell.item.x + cell.item.width) > 18 : false;
    });
}
function isHeaderRow(row) {
    return row.cells.length >= 2 && TABLE_HEADER_PATTERN.test(row.text) && !/\$|\bCAD\b|\bUSD\b|\d{2,}/i.test(row.text);
}
function unionBbox(left, right) {
    const minX = Math.min(left.x, right.x);
    const minY = Math.min(left.y, right.y);
    const maxX = Math.max(left.x + left.width, right.x + right.width);
    const maxY = Math.max(left.y + left.height, right.y + right.height);
    return {
        page: left.page,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    };
}
function cellBbox(cell) {
    return {
        page: 0,
        x: cell.item.x,
        y: cell.item.y,
        width: cell.item.width,
        height: cell.item.height,
    };
}
function mergeCell(left, right) {
    const bbox = unionBbox(cellBbox(left), cellBbox(right));
    const text = normalizeWhitespace(`${left.text} ${right.text}`);
    return {
        text,
        item: {
            ...left.item,
            text,
            x: bbox.x,
            y: bbox.y,
            width: bbox.width,
            height: bbox.height,
        },
    };
}
function mergeRows(left, right) {
    const cells = [...left.cells];
    for (const incoming of right.cells) {
        const targetIndex = nearestCellIndex(cells, incoming);
        if (targetIndex === undefined) {
            cells.push(incoming);
        }
        else {
            cells[targetIndex] = mergeCell(cells[targetIndex], incoming);
        }
    }
    cells.sort((a, b) => a.item.x - b.item.x);
    return {
        cells,
        pageNum: left.pageNum,
        bbox: unionBbox(left.bbox, right.bbox),
        text: cells.map((cell) => cell.text).join(" "),
    };
}
function nearestCellIndex(cells, incoming) {
    let bestIndex;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [index, cell] of cells.entries()) {
        const distance = Math.abs(cell.item.x - incoming.item.x);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    }
    return bestDistance <= 48 ? bestIndex : undefined;
}
function startsNewLogicalTableRow(row) {
    const first = row.cells[0]?.text ?? row.text;
    if (row.cells.some((cell) => /^item\s+\d+\./i.test(cell.text)))
        return true;
    return /^(item\s+\d+\.|[A-Z]\.\s+|coverage\b|limit\b|basis\b|retroactive\b|deductible\b|premium\b|tax\b|fee\b)/i.test(first);
}
function endsWithContinuationMarker(value) {
    return /(?:\b(and|of|the|for|under|within|with|from|to|or|plus)|[&,:;(-])$/i.test(value.trim());
}
function isPageFooterRow(row, pageHeight) {
    const text = normalizeWhitespace(row.text);
    const nearBottom = row.bbox.y >= pageHeight - Math.max(72, pageHeight * 0.08);
    if (!nearBottom)
        return false;
    if (/\bpage\s+\d+\s+of\s+\d+\b/i.test(text))
        return true;
    return /^[A-Z]{2,}(?:-[A-Z0-9]+)+\s+\d{2}\s+\d{2}$/i.test(text);
}
function isContinuationTableRow(previous, row) {
    if (!isTableLikeRow(previous))
        return false;
    const previousHasContinuationMarker = endsWithContinuationMarker(previous.cells[0]?.text ?? "") ||
        previous.cells.some((cell) => endsWithContinuationMarker(cell.text));
    if (!previousHasContinuationMarker && isHeaderRow(row))
        return false;
    if (startsNewLogicalTableRow(row))
        return false;
    const previousFirst = previous.cells[0]?.text ?? "";
    const rowFirst = row.cells[0]?.text ?? "";
    if (previous.cells.length >= 2 && row.cells.length === 1) {
        const nearestIndex = nearestCellIndex(previous.cells, row.cells[0]);
        return nearestIndex !== undefined && (nearestIndex > 0 || previousHasContinuationMarker);
    }
    if (/^item\s+\d+\./i.test(previousFirst) && !/^item\s+\d+\./i.test(rowFirst))
        return true;
    return previousHasContinuationMarker;
}
function sharesColumnGrid(left, right) {
    if (left.cells.length < 2 || right.cells.length < 2)
        return false;
    const comparable = Math.min(left.cells.length, right.cells.length);
    let matches = 0;
    for (let index = 0; index < comparable; index += 1) {
        if (Math.abs(left.cells[index].item.x - right.cells[index].item.x) <= 36) {
            matches += 1;
        }
    }
    return matches >= Math.min(2, comparable);
}
function isSingleCellTableBridgeRow(previous, row, next) {
    if (row.cells.length !== 1 || !next)
        return false;
    if (!isTableLikeRow(previous) || !isTableLikeRow(next))
        return false;
    if (!sharesColumnGrid(previous, next))
        return false;
    if (startsNewLogicalTableRow(row) && !TABLE_VALUE_PATTERN.test(row.text))
        return false;
    const nearestIndex = nearestCellIndex(previous.cells, row.cells[0]);
    return nearestIndex !== undefined || TABLE_HEADER_PATTERN.test(row.text) || TABLE_VALUE_PATTERN.test(row.text);
}
function normalizeLiteParseRows(rows, pageHeight) {
    const normalized = [];
    for (const [index, row] of rows.entries()) {
        if (isPageFooterRow(row, pageHeight))
            continue;
        const previous = normalized[normalized.length - 1];
        const next = rows[index + 1];
        if (previous && (isContinuationTableRow(previous, row) || isSingleCellTableBridgeRow(previous, row, next))) {
            normalized[normalized.length - 1] = mergeRows(previous, row);
            continue;
        }
        normalized.push(row);
    }
    return normalized;
}
function continuesCurrentTable(row, next) {
    if (row.cells.length !== 1)
        return false;
    if (isHeaderRow(row))
        return false;
    if (startsNewLogicalTableRow(row))
        return true;
    if (TABLE_HEADER_PATTERN.test(row.text) || TABLE_VALUE_PATTERN.test(row.text))
        return true;
    return Boolean(next && isTableLikeRow(next) && /\b(coverage|endorsement|aggregate|claim|loss|sublimit|sub-limit|defense)\b/i.test(row.text));
}
function normalizeHeader(value, index) {
    const normalized = normalizeWhitespace(value).replace(/[:*]+$/g, "");
    return normalized || `Column ${index + 1}`;
}
function alignHeaders(headers, cells) {
    if (headers.length === cells.length)
        return headers;
    if (headers.length > 0 && headers.length < cells.length) {
        return [
            ...headers,
            ...Array.from({ length: cells.length - headers.length }, (_, index) => `Column ${headers.length + index + 1}`),
        ];
    }
    return cells.map((_, index) => `Column ${index + 1}`);
}
function rowTextWithHeaders(row, headers) {
    const alignedHeaders = alignHeaders(headers, row.cells);
    if (alignedHeaders.length === 0) {
        return row.cells.map((cell) => cell.text).join(" | ");
    }
    return row.cells
        .map((cell, index) => `${alignedHeaders[index]}: ${cell.text}`)
        .join(" | ");
}
function shouldEmitStructuredTableGroup(rows) {
    return shouldEmitStructuredLiteParseTable(rows.map((row) => ({
        text: row.text,
        isHeader: isHeaderRow(row),
        cells: row.cells.map((cell) => ({
            text: cell.text,
            x: cell.item.x,
            width: cell.item.width,
        })),
    })));
}
function buildLiteParseSourceSpans(params) {
    const sourceSpans = [];
    for (const page of params.pages) {
        const pageText = normalizeWhitespace(page.text);
        if (pageText) {
            const pageSpan = {
                ...buildSourceSpan({
                    documentId: params.documentId,
                    sourceKind: params.sourceKind,
                    text: pageText,
                    pageStart: page.pageNum,
                    pageEnd: page.pageNum,
                    sourceUnit: "page",
                    metadata: {
                        sourceSystem: "liteparse",
                        sourceUnit: "page",
                        pageWidth: formatNumber(page.width),
                        pageHeight: formatNumber(page.height),
                    },
                }, sourceSpans.length),
                bbox: [{ page: page.pageNum, x: 0, y: 0, width: page.width, height: page.height }],
            };
            sourceSpans.push(pageSpan);
        }
        const rows = normalizeLiteParseRows(groupRows(page), page.height);
        let tableIndex = 0;
        let pendingTableRows = [];
        const emitTextRow = (row, minLength = 4) => {
            if (row.text.length < minLength)
                return;
            const elementType = classifyLiteParseTextElement(row, rows);
            const textSpan = spanWithBbox(buildSourceSpan({
                documentId: params.documentId,
                sourceKind: params.sourceKind,
                text: row.text,
                pageStart: page.pageNum,
                pageEnd: page.pageNum,
                sourceUnit: "text",
                metadata: {
                    sourceSystem: "liteparse",
                    sourceUnit: elementType,
                    elementType,
                    pageWidth: formatNumber(page.width),
                    pageHeight: formatNumber(page.height),
                },
            }, sourceSpans.length), row.bbox, { width: page.width, height: page.height });
            sourceSpans.push(textSpan);
        };
        const emitTableRows = (tableRows) => {
            if (tableRows.length === 0)
                return;
            if (!shouldEmitStructuredTableGroup(tableRows)) {
                for (const row of tableRows)
                    emitTextRow(row);
                return;
            }
            tableIndex += 1;
            const tableId = `${params.documentId}:liteparse:p${page.pageNum}:table${tableIndex}`;
            let currentHeaders = [];
            let rowIndex = 0;
            for (const row of tableRows) {
                const headerRow = isHeaderRow(row);
                const rowText = headerRow ? row.cells.map((cell) => cell.text).join(" | ") : rowTextWithHeaders(row, currentHeaders);
                const rowSpan = spanWithBbox(buildSourceSpan({
                    documentId: params.documentId,
                    sourceKind: params.sourceKind,
                    text: rowText,
                    pageStart: page.pageNum,
                    pageEnd: page.pageNum,
                    sourceUnit: "table_row",
                    table: {
                        tableId,
                        rowIndex,
                        isHeader: headerRow,
                    },
                    metadata: {
                        sourceSystem: "liteparse",
                        sourceUnit: "table_row",
                        elementType: headerRow ? "table_header" : "table_row",
                        tableId,
                        isHeader: String(headerRow),
                        pageWidth: formatNumber(page.width),
                        pageHeight: formatNumber(page.height),
                    },
                }, sourceSpans.length), row.bbox, { width: page.width, height: page.height });
                sourceSpans.push(rowSpan);
                const alignedHeaders = alignHeaders(currentHeaders, row.cells);
                for (const [columnIndex, cell] of row.cells.entries()) {
                    const cellBbox = {
                        page: page.pageNum,
                        x: cell.item.x,
                        y: cell.item.y,
                        width: cell.item.width,
                        height: cell.item.height,
                    };
                    const columnName = alignedHeaders[columnIndex];
                    const cellSpan = spanWithBbox(buildSourceSpan({
                        documentId: params.documentId,
                        sourceKind: params.sourceKind,
                        text: cell.text,
                        pageStart: page.pageNum,
                        pageEnd: page.pageNum,
                        sourceUnit: "table_cell",
                        parentSpanId: rowSpan.id,
                        table: {
                            tableId,
                            rowIndex,
                            columnIndex,
                            columnName,
                            rowSpanId: rowSpan.id,
                            isHeader: headerRow,
                        },
                        metadata: {
                            sourceSystem: "liteparse",
                            sourceUnit: "table_cell",
                            elementType: "table_cell",
                            tableId,
                            parentSpanId: rowSpan.id,
                            columnName: columnName ?? "",
                            isHeader: String(headerRow),
                            pageWidth: formatNumber(page.width),
                            pageHeight: formatNumber(page.height),
                        },
                    }, sourceSpans.length), cellBbox, { width: page.width, height: page.height });
                    sourceSpans.push(cellSpan);
                }
                if (headerRow) {
                    currentHeaders = row.cells.map((cell, index) => normalizeHeader(cell.text, index));
                }
                rowIndex += 1;
            }
        };
        for (const [index, row] of rows.entries()) {
            const tableLike = isTableLikeRow(row) ||
                (pendingTableRows.length > 0 && continuesCurrentTable(row, rows[index + 1]));
            if (tableLike) {
                pendingTableRows.push(row);
                continue;
            }
            emitTableRows(pendingTableRows);
            pendingTableRows = [];
            emitTextRow(row, 12);
        }
        emitTableRows(pendingTableRows);
    }
    return sourceSpans;
}
export async function parsePdfWithOcrRetry(params) {
    let parser = params.createParser(params.ocrEnabled);
    let parsed = await parser.parse(Buffer.from(params.pdfBytes));
    let sourceSpans = buildLiteParseSourceSpans({
        pages: parsed.pages,
        text: parsed.text,
        documentId: params.documentId,
        sourceKind: params.sourceKind,
    });
    if (sourceSpans.length > 0 || params.ocrEnabled) {
        return { parser, parsed, sourceSpans, ocrRetried: false };
    }
    parser = params.createParser(true);
    parsed = await parser.parse(Buffer.from(params.pdfBytes));
    sourceSpans = buildLiteParseSourceSpans({
        pages: parsed.pages,
        text: parsed.text,
        documentId: params.documentId,
        sourceKind: params.sourceKind,
    });
    return { parser, parsed, sourceSpans, ocrRetried: true };
}
async function buildPageScreenshots(params) {
    const maxPages = readBoundedIntEnv("LITEPARSE_SCREENSHOT_MAX_PAGES", 12, 0, 100);
    if (maxPages <= 0)
        return [];
    const pageNumbers = params.pages
        .map((page) => page.pageNum)
        .slice(0, maxPages);
    if (pageNumbers.length === 0)
        return [];
    try {
        const screenshots = await params.parser.screenshot(Buffer.from(params.pdfBytes), pageNumbers);
        return screenshots.map((shot) => ({
            page: shot.pageNum,
            imageBase64: shot.imageBuffer.toString("base64"),
            mimeType: "image/png",
            width: shot.width,
            height: shot.height,
        }));
    }
    catch (error) {
        console.warn(`LiteParse screenshots unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}
export async function convertPdfWithLiteParse(params) {
    if (params.maxFileSize && params.pdfBytes.byteLength > params.maxFileSize) {
        throw new Error(`PDF exceeds LiteParse maximum size (${params.pdfBytes.byteLength} > ${params.maxFileSize})`);
    }
    return withSerializedLiteParse(async () => {
        const startedAt = dayjs().valueOf();
        const { LiteParse } = await import("@llamaindex/liteparse");
        const configuredOcrEnabled = readBooleanEnv("LITEPARSE_OCR_ENABLED", false);
        const tessdataPath = process.env.LITEPARSE_TESSDATA_PATH?.trim();
        const parsedSource = await parsePdfWithOcrRetry({
            pdfBytes: params.pdfBytes,
            documentId: params.documentId,
            sourceKind: params.sourceKind ?? "policy_pdf",
            ocrEnabled: configuredOcrEnabled,
            createParser: (ocrEnabled) => new LiteParse({
                ocrEnabled,
                ocrLanguage: process.env.LITEPARSE_OCR_LANGUAGE ?? "eng",
                ...(tessdataPath ? { tessdataPath } : {}),
                maxPages: params.maxPages ?? readBoundedIntEnv("LITEPARSE_MAX_PAGES", 1000, 1, 5000),
                dpi: readBoundedIntEnv("LITEPARSE_DPI", 150, 72, 600),
                quiet: true,
                numWorkers: readBoundedIntEnv("LITEPARSE_NUM_WORKERS", 4, 1, 32),
            }),
        });
        const pageScreenshots = await buildPageScreenshots({
            parser: parsedSource.parser,
            pdfBytes: params.pdfBytes,
            pages: parsedSource.parsed.pages,
        });
        return {
            text: parsedSource.parsed.text,
            sourceSpans: parsedSource.sourceSpans,
            sourceChunks: chunkSourceSpans(parsedSource.sourceSpans),
            pageScreenshots,
            metadata: {
                parserBackend: "liteparse",
                parserVersion: LITEPARSE_VERSION,
                parsedAt: dayjs().valueOf(),
                parsingMs: dayjs().valueOf() - startedAt,
                pageCount: parsedSource.parsed.pages.length,
                ocrRetried: parsedSource.ocrRetried,
            },
        };
    }, {
        priority: params.priority,
        signal: params.signal,
    });
}
//# sourceMappingURL=liteparse.js.map