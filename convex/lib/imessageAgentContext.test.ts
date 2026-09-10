import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  tryBuildParsedPdfTextMock,
  transcribeAudioForOperatorTaskMock,
  transcribeAudioForOrgMock,
  transcribeAudioForPublicTaskMock,
} = vi.hoisted(() => ({
  tryBuildParsedPdfTextMock: vi.fn(),
  transcribeAudioForOperatorTaskMock: vi.fn(),
  transcribeAudioForOrgMock: vi.fn(),
  transcribeAudioForPublicTaskMock: vi.fn(),
}));

vi.mock("./liteparsePreprocessor", () => ({
  tryBuildParsedPdfText: tryBuildParsedPdfTextMock,
}));

vi.mock("./models", () => ({
  transcribeAudioForOperatorTask: transcribeAudioForOperatorTaskMock,
  transcribeAudioForOrg: transcribeAudioForOrgMock,
  transcribeAudioForPublicTask: transcribeAudioForPublicTaskMock,
}));

import type { Id } from "../_generated/dataModel";
import {
  buildImessageModelMessages,
  prepareInboundImessageTurn,
} from "./imessageAgentContext";
import { MAX_ROUTER_ATTACHMENT_BYTES } from "./agentAttachmentLimits";

describe("iMessage agent context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tryBuildParsedPdfTextMock.mockResolvedValue(null);
  });

  test("transcribes operator voice notes without dropping other attachments", async () => {
    transcribeAudioForOperatorTaskMock.mockResolvedValueOnce({
      text: "Record that we provided the requested information.",
      route: { provider: "openai", model: "gpt-4o-transcribe" },
      routeSource: "global",
    });
    const document = {
      name: "follow-up.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("pdf").toString("base64"),
    };

    const input = await prepareInboundImessageTurn({} as never, {
      scope: { kind: "operator" },
      messageText: "(attachment)",
      attachments: [
        {
          name: "voice-memo.m4a",
          mimeType: "audio/mp4",
          data: Buffer.from("audio").toString("base64"),
        },
        document,
      ],
    });

    expect(input).toMatchObject({
      messageText:
        "[Voice memo transcript: voice-memo.m4a]\nRecord that we provided the requested information.",
      failures: [],
      nonAudioAttachments: [document],
    });
    expect(transcribeAudioForOperatorTaskMock).toHaveBeenCalledOnce();
    expect(transcribeAudioForOrgMock).not.toHaveBeenCalled();
    expect(transcribeAudioForPublicTaskMock).not.toHaveBeenCalled();
  });

  test("rejects 12–20 MiB voice notes with the accurate limit before transcription", async () => {
    const input = await prepareInboundImessageTurn({} as never, {
      scope: { kind: "organization", orgId: "org" as Id<"organizations"> },
      messageText: "(attachment)",
      attachments: [
        {
          name: "oversized.m4a",
          mimeType: "audio/mp4",
          data: Buffer.alloc(MAX_ROUTER_ATTACHMENT_BYTES + 1).toString(
            "base64",
          ),
        },
      ],
    });

    expect(input.failures).toEqual([
      {
        filename: "oversized.m4a",
        error: "The voice memo exceeded the 12 MiB attachment limit.",
      },
    ]);
    expect(input.failureResponse).toBeTruthy();
    expect(transcribeAudioForOrgMock).not.toHaveBeenCalled();
  });

  test("passes rich iMessage bytes to the central router adapter", async () => {
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 1);
    const messages = await buildImessageModelMessages({
      history: [],
      messageText: "Please inspect this image",
      currentSpeakerLabel: "Client",
      attachmentRecords: [
        {
          filename: "loss.png",
          contentType: "image/png",
          size: bytes.byteLength,
          buffer: bytes,
        },
      ],
      currentMessageId: "message" as Id<"threadMessages">,
    });

    const message = messages.at(-1);
    expect(message?.role).toBe("user");
    const content =
      message && Array.isArray(message.content) ? message.content : [];
    const images = content.filter((part) => part.type === "image");
    expect(typeof images[0]?.image).toBe("string");
    expect((images[0]?.image as string).length).toBeGreaterThan(
      bytes.byteLength,
    );
  });

  test("rejects rich iMessage asset size, count, and aggregate bounds before inference", async () => {
    const record = (index: number, size: number) => ({
      filename: `image-${index}.png`,
      contentType: "image/png",
      size,
      buffer: Buffer.alloc(size),
    });
    const base = {
      history: [],
      messageText: "Review",
      currentSpeakerLabel: "Client",
      currentMessageId: "message" as Id<"threadMessages">,
    };

    await expect(
      buildImessageModelMessages({
        ...base,
        attachmentRecords: [record(0, MAX_ROUTER_ATTACHMENT_BYTES + 1)],
      }),
    ).rejects.toThrow("12 MiB router asset limit");

    await expect(
      buildImessageModelMessages({
        ...base,
        attachmentRecords: Array.from({ length: 9 }, (_, index) =>
          record(index, 1),
        ),
      }),
    ).rejects.toThrow("more than 8 rich binary assets");

    const first = 8 * 1024 * 1024 + 1;
    await expect(
      buildImessageModelMessages({
        ...base,
        attachmentRecords: [record(0, first), record(1, 8 * 1024 * 1024)],
      }),
    ).rejects.toThrow("16 MiB aggregate limit");
  });
});
