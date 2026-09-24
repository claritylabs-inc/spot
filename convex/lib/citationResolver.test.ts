import { describe, expect, test } from "vitest";

import {
  buildCitationIndex,
  resolveCitation,
  resolveCitationWithIndex,
  resolveCitations,
  type SectionCitation,
} from "./citationResolver";
import type { SourceSpanLike } from "./sourceTree";

describe("resolveCitation", () => {
  test("exact substring match within a single span", () => {
    const spans: SourceSpanLike[] = [
      { id: "span-1", pageStart: 1, pageEnd: 1, text: "The insured shall maintain coverage at all times." },
    ];
    const result = resolveCitation({ page: 1, quote: "maintain coverage" }, spans);

    expect(result.match).toBe("exact");
    expect(result.sourceSpanIds).toEqual(["span-1"]);
  });

  test("finds the smallest consecutive window across multiple line spans", () => {
    const spans: SourceSpanLike[] = [
      { id: "line-1", pageStart: 2, pageEnd: 2, text: "General liability" },
      { id: "line-2", pageStart: 2, pageEnd: 2, text: "coverage applies to" },
      { id: "line-3", pageStart: 2, pageEnd: 2, text: "bodily injury claims" },
      { id: "line-4", pageStart: 2, pageEnd: 2, text: "and property damage." },
    ];
    const result = resolveCitation(
      { page: 2, quote: "coverage applies to bodily injury claims" },
      spans,
    );

    expect(result.match).toBe("exact");
    expect(result.sourceSpanIds).toEqual(["line-2", "line-3"]);
  });

  test("normalized match handles case, whitespace, punctuation and curly quotes", () => {
    const spans: SourceSpanLike[] = [
      {
        id: "span-1",
        pageStart: 3,
        pageEnd: 3,
        text: "The Carrier’s   obligation is,   absolute.",
      },
    ];
    const result = resolveCitation(
      { page: 3, quote: "the carriers obligation is absolute" },
      spans,
    );

    expect(result.match).toBe("normalized");
    expect(result.sourceSpanIds).toEqual(["span-1"]);
  });

  test("normalized match joins hyphenated words split across line spans", () => {
    const spans: SourceSpanLike[] = [
      { id: "line-1", pageStart: 4, pageEnd: 4, text: "This policy covers the auto-" },
      { id: "line-2", pageStart: 4, pageEnd: 4, text: "mobile in question." },
    ];
    const result = resolveCitation(
      { page: 4, quote: "covers the automobile in question" },
      spans,
    );

    expect(result.match).toBe("normalized");
    expect(result.sourceSpanIds).toEqual(["line-1", "line-2"]);
  });

  test("falls back to page_only with a unioned full-page bbox when the quote cannot be located", () => {
    const spans: SourceSpanLike[] = [
      {
        id: "line-1",
        pageStart: 5,
        pageEnd: 5,
        text: "Unrelated text",
        bbox: [{ page: 5, x: 10, y: 10, width: 50, height: 20 }],
      },
      {
        id: "line-2",
        pageStart: 5,
        pageEnd: 5,
        text: "More unrelated text",
        bbox: [{ page: 5, x: 100, y: 200, width: 30, height: 15 }],
      },
    ];
    const result = resolveCitation({ page: 5, quote: "nowhere to be found" }, spans);

    expect(result.match).toBe("page_only");
    expect(result.sourceSpanIds).toEqual([]);
    expect(result.bbox).toEqual([{ page: 5, x: 10, y: 10, width: 120, height: 205 }]);
  });

  test("page_only with an empty bbox when spans on the page carry no bbox info", () => {
    const spans: SourceSpanLike[] = [
      { id: "line-1", pageStart: 6, pageEnd: 6, text: "Some text with no bbox" },
    ];
    const result = resolveCitation({ page: 6, quote: "missing quote" }, spans);

    expect(result.match).toBe("page_only");
    expect(result.sourceSpanIds).toEqual([]);
    expect(result.bbox).toEqual([]);
  });

  test("unresolved when the cited page does not exist in the spans", () => {
    const spans: SourceSpanLike[] = [
      { id: "line-1", pageStart: 1, pageEnd: 1, text: "Only page one has content" },
    ];
    const result = resolveCitation({ page: 99, quote: "anything" }, spans);

    expect(result.match).toBe("unresolved");
    expect(result.sourceSpanIds).toEqual([]);
    expect(result.bbox).toEqual([]);
  });

  test("supports span ids from either id or spanId", () => {
    const spans: SourceSpanLike[] = [
      { spanId: "legacy-span-id", pageStart: 1, pageEnd: 1, text: "Legacy span identifier text" },
    ];
    const result = resolveCitation({ page: 1, quote: "identifier text" }, spans);

    expect(result.match).toBe("exact");
    expect(result.sourceSpanIds).toEqual(["legacy-span-id"]);
  });

  test("buildCitationIndex + resolveCitationWithIndex matches resolveCitation for repeated lookups", () => {
    const spans: SourceSpanLike[] = [
      { id: "span-1", pageStart: 1, pageEnd: 1, text: "First page content" },
      { id: "span-2", pageStart: 2, pageEnd: 2, text: "Second page content" },
    ];
    const index = buildCitationIndex(spans);
    const citations: SectionCitation[] = [
      { page: 1, quote: "First page" },
      { page: 2, quote: "Second page" },
    ];

    const viaIndex = citations.map((citation) => resolveCitationWithIndex(citation, index));
    const viaHelper = resolveCitations(citations, spans);

    expect(viaIndex).toEqual(viaHelper);
    expect(viaIndex[0].sourceSpanIds).toEqual(["span-1"]);
    expect(viaIndex[1].sourceSpanIds).toEqual(["span-2"]);
  });
});
