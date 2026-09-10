import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { generateAgentTextForOrgMock, generatedTextFromResultMock } = vi.hoisted(
  () => ({
    generateAgentTextForOrgMock: vi.fn(),
    generatedTextFromResultMock: vi.fn(),
  }),
);

vi.mock("./models", () => ({
  generateAgentTextForOrg: generateAgentTextForOrgMock,
  generatedTextFromResult: generatedTextFromResultMock,
}));

import type { Id } from "../_generated/dataModel";
import { MAX_ROUTER_ATTACHMENT_BYTES } from "./agentAttachmentLimits";
import { readStoredThreadAttachment } from "./agentThreadAttachment";

const base = {
  orgId: "org" as Id<"organizations">,
  surface: "web" as const,
  threadId: "thread" as Id<"threads">,
  messageId: "message" as Id<"threadMessages">,
  filename: "evidence.png",
  contentType: "image/png",
  url: "https://merry-platypus-82.convex.cloud/api/storage/evidence",
};

describe("stored thread attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateAgentTextForOrgMock.mockResolvedValue({ text: "Visible evidence" });
    generatedTextFromResultMock.mockReturnValue("Visible evidence");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("sends a <=12 MiB stored image as a known-size Spot reference", async () => {
    vi.stubEnv("SPOT_ENV", "production");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const size = 4 * 1024 * 1024 + 1;
    const result = await readStoredThreadAttachment({} as never, {
      ...base,
      size,
    });

    expect(result.status).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
    const messages = generateAgentTextForOrgMock.mock.calls[0]?.[3]?.messages;
    expect(messages?.[0]?.content?.[0]).toEqual({
      type: "image",
      image: new URL(base.url),
      mediaType: "image/png",
      providerOptions: { spot: { routerAssetSizeBytes: size } },
    });
    fetchMock.mockRestore();
  });

  test("keeps local stored images as bytes for the central adapter", async () => {
    vi.stubEnv("SPOT_ENV", "local");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(Buffer.from("local-image")));
    const result = await readStoredThreadAttachment({} as never, {
      ...base,
      url: "http://127.0.0.1:3211/api/storage/evidence",
      size: 11,
    });

    expect(result.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledOnce();
    const messages = generateAgentTextForOrgMock.mock.calls[0]?.[3]?.messages;
    expect(typeof messages?.[0]?.content?.[0]?.image).toBe("string");
    fetchMock.mockRestore();
  });

  test("returns an unavailable result for a >12 MiB history image without fetching or inferring", async () => {
    vi.stubEnv("SPOT_ENV", "production");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await readStoredThreadAttachment({} as never, {
      ...base,
      size: MAX_ROUTER_ATTACHMENT_BYTES + 1,
    });

    expect(result).toMatchObject({
      status: "unavailable",
      message: expect.stringContaining("too large"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(generateAgentTextForOrgMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
