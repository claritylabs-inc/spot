import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { preparePdfTextWithPdfJsMock, tryBuildParsedPdfTextMock } = vi.hoisted(
  () => ({
    preparePdfTextWithPdfJsMock: vi.fn(),
    tryBuildParsedPdfTextMock: vi.fn(),
  }),
);

vi.mock("./liteparsePreprocessor", () => ({
  preparePdfTextWithPdfJs: preparePdfTextWithPdfJsMock,
  tryBuildParsedPdfText: tryBuildParsedPdfTextMock,
}));

import type { Id } from "../_generated/dataModel";
import { buildAgentAttachmentParts } from "./agentAttachmentContext";
import {
  MAX_AGENT_ATTACHMENT_BYTES,
  MAX_AGENT_ATTACHMENT_FILES,
  MAX_ROUTER_ATTACHMENT_BYTES,
} from "./agentAttachmentLimits";

describe("shared agent attachment context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tryBuildParsedPdfTextMock.mockResolvedValue(null);
    preparePdfTextWithPdfJsMock.mockRejectedValue(
      new Error("No readable PDF text"),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
  test("marks empty and budget-omitted files instead of claiming they were read", async () => {
    const emptyId = "empty-file" as Id<"_storage">;
    const omittedId = "omitted-file" as Id<"_storage">;
    const blobs = new Map<string, Blob>([
      [String(emptyId), new Blob([""])],
      [String(omittedId), new Blob(["important evidence"])],
    ]);
    const context = await buildAgentAttachmentParts(
      {
        storage: {
          get: async (fileId: Id<"_storage">) =>
            blobs.get(String(fileId)) ?? null,
        },
      } as never,
      [
        {
          fileId: emptyId,
          filename: "empty.txt",
          contentType: "text/plain",
          size: 0,
        },
        {
          fileId: omittedId,
          filename: "later.txt",
          contentType: "text/plain",
          size: 18,
        },
      ],
      { includeRichParts: true, remainingTextChars: { value: 0 } },
    );

    const text = context.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    expect(text).toContain("No readable text was extracted");
    expect(text).toContain("text budget was exhausted");
  });

  test("fails closed on corrupt and expansion-heavy Office archives", async () => {
    const corruptId = "corrupt-office" as Id<"_storage">;
    const expandedId = "expanded-office" as Id<"_storage">;
    const archive = new JSZip();
    archive.file("xl/worksheets/sheet1.xml", new Uint8Array(33 * 1024 * 1024));
    const compressed = await archive.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
    });
    const blobs = new Map<string, Blob>([
      [String(corruptId), new Blob(["not a zip archive"])],
      [String(expandedId), new Blob([new Uint8Array(compressed).buffer])],
    ]);
    const context = await buildAgentAttachmentParts(
      {
        storage: {
          get: async (fileId: Id<"_storage">) =>
            blobs.get(String(fileId)) ?? null,
        },
      } as never,
      [
        {
          fileId: corruptId,
          filename: "corrupt.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: 17,
        },
        {
          fileId: expandedId,
          filename: "expanded.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: compressed.byteLength,
        },
      ],
      { includeRichParts: true, remainingTextChars: { value: 80_000 } },
    );

    const text = context.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    expect(text).toContain("corrupt.xlsx");
    expect(text).toContain("expanded.xlsx");
    expect(text.match(/could not be read/g)).toHaveLength(2);
  });

  test("uses a known-size Spot reference for a stored 4–10 MiB image", async () => {
    vi.stubEnv("SPOT_ENV", "dev");
    const fileId = "large-image" as Id<"_storage">;
    const bytes = new Uint8Array(4 * 1024 * 1024 + 1);
    const getUrl = vi.fn(
      async () =>
        `https://acoustic-caiman-755.convex.cloud/api/storage/${String(fileId)}`,
    );

    const context = await buildAgentAttachmentParts(
      {
        storage: {
          get: vi.fn(async () => new Blob([bytes], { type: "image/png" })),
          getUrl,
        },
      } as never,
      [
        {
          fileId,
          filename: "diagram.png",
          contentType: "image/png",
          size: bytes.byteLength,
        },
      ],
      { includeRichParts: true, remainingTextChars: { value: 80_000 } },
    );

    expect(getUrl).toHaveBeenCalledWith(fileId);
    expect(context.parts).toContainEqual({
      type: "image",
      image: new URL(
        `https://acoustic-caiman-755.convex.cloud/api/storage/${String(fileId)}`,
      ),
      mediaType: "image/png",
      providerOptions: {
        spot: { routerAssetSizeBytes: bytes.byteLength },
      },
    });
  });

  test("keeps local rich bytes inline for central cumulative envelope staging", async () => {
    vi.stubEnv("SPOT_ENV", "local");
    const bytes = new Uint8Array(1_200_000);
    const fileIds = ["image-one", "image-two"] as Id<"_storage">[];
    const getUrl = vi.fn(
      async (fileId: Id<"_storage">) =>
        `http://127.0.0.1:3211/api/storage/${String(fileId)}`,
    );
    const context = await buildAgentAttachmentParts(
      {
        storage: {
          get: vi.fn(async () => new Blob([bytes], { type: "image/png" })),
          getUrl,
        },
      } as never,
      fileIds.map((fileId, index) => ({
        fileId,
        filename: `image-${index}.png`,
        contentType: "image/png",
        size: bytes.byteLength,
      })),
      { includeRichParts: true, remainingTextChars: { value: 80_000 } },
    );

    const images = context.parts.filter((part) => part.type === "image");
    expect(typeof images[0]?.image).toBe("string");
    expect(typeof images[1]?.image).toBe("string");
    expect(getUrl).not.toHaveBeenCalled();
  });

  test("keeps intake limits distinct from emitted router assets", async () => {
    const textAttachments = Array.from({ length: 9 }, (_, index) => ({
      fileId: `text-${index}` as Id<"_storage">,
      filename: `text-${index}.txt`,
      contentType: "text/plain",
      size: 1,
    }));
    const context = await buildAgentAttachmentParts(
      {
        storage: {
          get: vi.fn(async () => new Blob(["x"], { type: "text/plain" })),
          getUrl: vi.fn(),
        },
      } as never,
      textAttachments,
      { includeRichParts: true, remainingTextChars: { value: 80_000 } },
    );

    expect(context.names).toHaveLength(9);
    expect(MAX_AGENT_ATTACHMENT_FILES).toBe(10);

    const pdfBytes = new Uint8Array(20 * 1024 * 1024);
    tryBuildParsedPdfTextMock.mockResolvedValueOnce("Parsed policy evidence");
    const getUrl = vi.fn();
    const parsed = await buildAgentAttachmentParts(
      {
        storage: {
          get: vi.fn(
            async () => new Blob([pdfBytes], { type: "application/pdf" }),
          ),
          getUrl,
        },
      } as never,
      [
        {
          fileId: "parsed-large-pdf" as Id<"_storage">,
          filename: "parsed.pdf",
          contentType: "application/pdf",
          size: pdfBytes.byteLength,
        },
      ],
      { includeRichParts: true, remainingTextChars: { value: 80_000 } },
    );
    expect(parsed.parts).toContainEqual(
      expect.objectContaining({ type: "text" }),
    );
    expect(parsed.parts.some((part) => part.type === "file")).toBe(false);
    expect(getUrl).not.toHaveBeenCalled();
  });

  test("rejects only rich binary assets above router count, size, and aggregate limits", async () => {
    const get = vi.fn();
    const attachment = (index: number, size: number) => ({
      fileId: `file-${index}` as Id<"_storage">,
      filename: `file-${index}.png`,
      contentType: "image/png",
      size,
    });

    await expect(
      buildAgentAttachmentParts(
        { storage: { get, getUrl: vi.fn() } as never },
        [attachment(0, MAX_AGENT_ATTACHMENT_BYTES + 1)],
        { includeRichParts: true, remainingTextChars: { value: 80_000 } },
      ),
    ).rejects.toThrow("25 MiB attachment intake limit");
    expect(get).not.toHaveBeenCalled();

    get.mockImplementation(async () => new Blob([new Uint8Array(1)]));
    await expect(
      buildAgentAttachmentParts(
        { storage: { get, getUrl: vi.fn() } as never },
        Array.from({ length: 9 }, (_, index) => attachment(index, 1)),
        { includeRichParts: true, remainingTextChars: { value: 80_000 } },
      ),
    ).rejects.toThrow("more than 8 rich binary assets");

    const oversizedRichBytes = new Uint8Array(MAX_ROUTER_ATTACHMENT_BYTES + 1);
    await expect(
      buildAgentAttachmentParts(
        {
          storage: {
            get: vi.fn(async () => new Blob([oversizedRichBytes])),
            getUrl: vi.fn(),
          },
        } as never,
        [attachment(0, oversizedRichBytes.byteLength)],
        { includeRichParts: true, remainingTextChars: { value: 80_000 } },
      ),
    ).rejects.toThrow("12 MiB router asset limit");

    const first = new Uint8Array(8 * 1024 * 1024 + 1);
    const second = new Uint8Array(8 * 1024 * 1024);
    const blobs = [new Blob([first]), new Blob([second])];
    await expect(
      buildAgentAttachmentParts(
        {
          storage: {
            get: vi.fn(async () => blobs.shift() ?? null),
            getUrl: vi.fn(
              async (fileId) =>
                `http://127.0.0.1:3211/api/storage/${String(fileId)}`,
            ),
          },
        } as never,
        [attachment(0, first.byteLength), attachment(1, second.byteLength)],
        { includeRichParts: true, remainingTextChars: { value: 80_000 } },
      ),
    ).rejects.toThrow("16 MiB aggregate limit");
  });
});
