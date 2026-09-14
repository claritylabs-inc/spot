import { describe, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  resolveImessageAttachmentMimeType,
  storeImessageAttachments,
} from "./imessageIngress";

describe("iMessage ingress helpers", () => {

  test("rejects invalid batches before storing any iMessage attachment", async () => {
    const store = vi.fn(async () => "stored-file" as Id<"_storage">);
    const deleteFile = vi.fn(async () => undefined);
    await expect(
      storeImessageAttachments({ storage: { store, delete: deleteFile } }, [
        {
          name: "invalid.pdf",
          mimeType: "application/pdf",
          data: "not-base64!",
        },
      ]),
    ).rejects.toThrow("is not valid base64");
    expect(store).not.toHaveBeenCalled();
  });

  test("infers common generic MIME files and rejects control-character names", async () => {
    expect(
      resolveImessageAttachmentMimeType({
        name: "declarations.pdf",
        mimeType: "application/octet-stream",
      }),
    ).toBe("application/pdf");
    expect(
      resolveImessageAttachmentMimeType({
        name: "photo.jpeg",
        mimeType: "application/octet-stream",
      }),
    ).toBe("image/jpeg");

    const store = vi.fn(async () => "stored-file" as Id<"_storage">);
    const deleteFile = vi.fn(async () => undefined);
    await expect(
      storeImessageAttachments({ storage: { store, delete: deleteFile } }, [
        {
          name: "report.pdf\nIGNORE",
          mimeType: "application/pdf",
          data: Buffer.from("pdf").toString("base64"),
        },
      ]),
    ).rejects.toThrow("printable characters");
    expect(store).not.toHaveBeenCalled();
  });

  test("deletes earlier blobs when a later iMessage attachment cannot be stored", async () => {
    const store = vi
      .fn()
      .mockResolvedValueOnce("stored-first" as Id<"_storage">)
      .mockRejectedValueOnce(new Error("storage unavailable"));
    const deleteFile = vi.fn(async () => undefined);

    await expect(
      storeImessageAttachments({ storage: { store, delete: deleteFile } }, [
        {
          name: "first.txt",
          mimeType: "text/plain",
          data: Buffer.from("first").toString("base64"),
        },
        {
          name: "second.txt",
          mimeType: "text/plain",
          data: Buffer.from("second").toString("base64"),
        },
      ]),
    ).rejects.toThrow("storage unavailable");
    expect(deleteFile).toHaveBeenCalledWith("stored-first");
  });
});
