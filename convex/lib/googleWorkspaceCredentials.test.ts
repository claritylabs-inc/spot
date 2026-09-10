// @vitest-environment node

import { describe, expect, it } from "vitest";
import { googleWorkspaceCredentialEnvelope } from "./googleWorkspaceCredentials";

function credential(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "service_account",
    client_email: "spot-reader@example.iam.gserviceaccount.com",
    client_id: "1234567890",
    private_key_id: "key-1",
    private_key:
      "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----\n",
    ...overrides,
  });
}

describe("Google Workspace credential isolation", () => {
  it("handles missing, null, array, and malformed credential JSON without throwing", async () => {
    await expect(googleWorkspaceCredentialEnvelope("")).resolves.toMatchObject({
      status: { present: false, serviceAccountEmail: null, clientId: null },
      credentials: null,
    });
    for (const value of ["null", "[]", "not-json"]) {
      await expect(googleWorkspaceCredentialEnvelope(value)).resolves.toMatchObject({
        status: { present: true, serviceAccountEmail: null, clientId: null },
        credentials: null,
        error: "Google Workspace service-account credentials are invalid.",
      });
    }
  });

  it("exposes only validated service-account metadata", async () => {
    const wrongType = await googleWorkspaceCredentialEnvelope(
      credential({ type: "authorized_user" }),
    );
    expect(wrongType.status).toEqual({
      present: true,
      serviceAccountEmail: null,
      clientId: null,
    });
    expect(wrongType.credentials).toBeNull();

    const invalidMetadata = await googleWorkspaceCredentialEnvelope(
      credential({ client_email: "operator@example.com", client_id: "client-id" }),
    );
    expect(invalidMetadata.status).toEqual({
      present: true,
      serviceAccountEmail: null,
      clientId: null,
    });
    expect(invalidMetadata.error).toBe(
      "Google Workspace service-account credentials are incomplete.",
    );

    const valid = await googleWorkspaceCredentialEnvelope(credential());
    expect(valid.status).toEqual({
      present: true,
      serviceAccountEmail: "spot-reader@example.iam.gserviceaccount.com",
      clientId: "1234567890",
    });
    expect(valid.credentials).toMatchObject({
      clientEmail: "spot-reader@example.iam.gserviceaccount.com",
      clientId: "1234567890",
      privateKeyId: "key-1",
    });
    expect(valid.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(valid.status)).not.toContain("private-material");
  });

  it("changes the backend-only revision when credentials rotate", async () => {
    const first = await googleWorkspaceCredentialEnvelope(credential());
    const second = await googleWorkspaceCredentialEnvelope(
      credential({
        private_key_id: "key-2",
        private_key:
          "-----BEGIN PRIVATE KEY-----\nrotated-material\n-----END PRIVATE KEY-----\n",
      }),
    );
    expect(first.revision).not.toBe(second.revision);
    expect(first.status).toEqual(second.status);
  });
});
