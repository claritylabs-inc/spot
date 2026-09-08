import { describe, expect, test, vi } from "vitest";

import {
  normalizeInboundTurn,
  isInboundTransportMessage,
  type InboundRecoveryClient,
} from "./inboundNormalization.js";
import type { InboundAttachmentContent } from "./attachmentPolicy.js";

const readAttachment = async (content: InboundAttachmentContent) => ({
  data: Buffer.from(await content.read()).toString("base64"),
  mimeType: content.mimeType,
  name: content.name ?? "attachment",
});

function stream(bytes: string) {
  return (async function* () {
    yield { type: "header" as const };
    yield {
      type: "primaryChunk" as const,
      data: Buffer.from(bytes),
    };
  })();
}

describe("normalizeInboundTurn", () => {
  test("recovers text and every attachment from the original Photon message", async () => {
    const client: InboundRecoveryClient = {
      messages: {
        get: vi.fn().mockResolvedValue({
          guid: "message-1",
          content: {
            text: "Please review these forms",
            attachments: [
              {
                guid: "file-1",
                fileName: "first.pdf",
                mimeType: "application/pdf",
              },
              {
                guid: "file-2",
                fileName: "second.pdf",
                mimeType: "application/pdf",
              },
            ],
          },
        }),
      },
      attachments: {
        downloadStream: (guid) => stream(guid),
      },
    };
    const turn = await normalizeInboundTurn({
      message: {
        id: "message-1",
        content: {
          type: "attachment",
          id: "file-1",
          name: "first.pdf",
          mimeType: "application/pdf",
        },
      },
      recoverFromPhoton: true,
      client,
      readAttachment,
    });

    expect(turn.messageText).toBe("Please review these forms");
    expect(turn.attachments.map((attachment) => attachment.name)).toEqual([
      "first.pdf",
      "second.pdf",
    ]);
    expect(turn.recoveryFailure).toBeUndefined();
  });

  test("falls back to the Spectrum attachment when Photon download fails", async () => {
    const turn = await normalizeInboundTurn({
      message: {
        id: "message-5",
        content: {
          type: "attachment",
          id: "file-5",
          name: "fallback.pdf",
          mimeType: "application/pdf",
          read: async () => Buffer.from("fallback"),
        },
      },
      recoverFromPhoton: true,
      client: {
        messages: {
          get: vi.fn().mockResolvedValue({
            guid: "message-5",
            content: {
              text: "Keep this caption",
              attachments: [
                {
                  guid: "file-5",
                  fileName: "fallback.pdf",
                  mimeType: "application/pdf",
                },
              ],
            },
          }),
        },
        attachments: {
          downloadStream: () =>
            (async function* () {
              throw new Error("download unavailable");
            })(),
        },
      },
      readAttachment,
    });
    expect(turn.messageText).toBe("Keep this caption");
    expect(turn.attachments).toHaveLength(1);
    expect(Buffer.from(turn.attachments[0].data, "base64").toString()).toBe(
      "fallback",
    );
    expect(turn.recoveryFailure).toMatchObject({
      stage: "attachment_download",
      sourceMessageId: "message-5",
      error: "download unavailable",
    });
  });
});

test("transport admission accepts Spectrum Terminal identity and keeps terminal and iMessage isolated", () => {
  expect(isInboundTransportMessage("terminal", { platform: "Terminal" })).toBe(
    true,
  );
  expect(isInboundTransportMessage("imessage", { platform: "iMessage" })).toBe(
    true,
  );
  expect(isInboundTransportMessage("terminal", { platform: "iMessage" })).toBe(
    false,
  );
  expect(isInboundTransportMessage("imessage", { platform: "Terminal" })).toBe(
    false,
  );
  expect(isInboundTransportMessage("terminal", { platform: "unknown" })).toBe(
    false,
  );
});
