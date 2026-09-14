// @vitest-environment node

import { generateKeyPairSync } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { dkimSign } from "mailauth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateOperatorEmail } from "../convex/lib/operatorEmailAuthentication";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const dnsKey = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const signingKey = privateKey.export({ type: "pkcs8", format: "pem" });
const headers = [
  "From: Terry <terry@spot.insure>",
  "To: operator@agent.spot.insure",
  "Subject: Review this renewal",
  "Message-ID: <operator-test@spot.insure>",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
];

function message(extraHeaders: string[] = [], body = "Please review this renewal.") {
  return [...headers, ...extraHeaders, "", body, ""].join("\r\n");
}

async function sign(raw: string, signingDomain = "spot.insure", maxBodyLength?: number) {
  const signature = {
    signingDomain,
    selector: "operator-test",
    privateKey: signingKey,
    ...(maxBodyLength === undefined ? {} : { maxBodyLength }),
  };
  const { signatures } = await dkimSign(raw, {
    ...signature,
    signatureData: [signature],
  });
  return Buffer.from(signatures + raw);
}

beforeEach(() => {
  vi.spyOn(Resolver.prototype, "resolveTxt").mockResolvedValue([[`v=DKIM1; k=rsa; p=${dnsKey}`]]);
});
afterEach(() => vi.restoreAllMocks());

describe("operator email authentication", () => {
  it.each(["spot.insure", "claritylabs.inc", "toolsforenlightenment.org"])(
    "accepts independently verified email from %s with a signed reply route",
    async (domain) => {
      const raw = message([
        "In-Reply-To: <previous@spot.insure>",
        "References: <previous@spot.insure>",
      ]).replace("terry@spot.insure", `terry@${domain}`)
        .replace("To: operator@agent.spot.insure", "To: operator+thread123@agent.spot.insure");
      const parsed = await authenticateOperatorEmail(await sign(raw, domain));
      expect(parsed.from?.value[0].address).toBe(`terry@${domain}`);
      expect(parsed.inReplyTo).toBe("<previous@spot.insure>");
      expect(parsed.text).toContain("Please review this renewal.");
    },
  );

  it("does not accept a forged Authentication-Results header or an unrelated signing domain", async () => {
    const raw = message(["Authentication-Results: mx.spot.insure; dkim=pass header.d=spot.insure"]);
    await expect(authenticateOperatorEmail(Buffer.from(raw))).rejects.toThrow("aligned DKIM");
    await expect(authenticateOperatorEmail(await sign(raw, "attacker.example"))).rejects.toThrow("aligned DKIM");
  });

  it.each([
    ["the body", "Please review this renewal.", "Transfer funds immediately."],
    ["the recipient", "To: operator@agent.spot.insure", "To: operator+victim@agent.spot.insure"],
    ["the replay identity", "<operator-test@spot.insure>", "<fresh-id@spot.insure>"],
    ["the sender", "terry@spot.insure", "adyan@spot.insure"],
  ])("rejects tampering with %s after signing", async (_name, original, replacement) => {
    const signed = await sign(message());
    const tampered = Buffer.from(signed.toString().replace(original, replacement));
    await expect(authenticateOperatorEmail(tampered)).rejects.toThrow("aligned DKIM");
  });

  it.each([
    "Reply-To: attacker@example.com",
    "In-Reply-To: <victim-thread@spot.insure>",
    "References: <victim-thread@spot.insure>",
    "Cc: operator+victim@agent.spot.insure",
  ])("rejects an unsigned interpretation or routing header: %s", async (injected) => {
    const signed = await sign(message());
    await expect(authenticateOperatorEmail(Buffer.concat([
      Buffer.from(`${injected}\r\n`), signed,
    ]))).rejects.toThrow("aligned DKIM");
  });

  it("rejects duplicate sender headers even when DKIM still passes", async () => {
    const signed = await sign(message());
    await expect(authenticateOperatorEmail(Buffer.concat([
      Buffer.from("From: Adyan <adyan@spot.insure>\r\n"), signed,
    ]))).rejects.toThrow("ambiguous");
  });

  it("accepts Gmail's unsigned outer MIME wrapper without letting changed type, boundary or encoding alter signed parts", async () => {
    const boundary = "000000000000ebae1e0636f182b2";
    const raw = message([], [
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Review the attached renewal.",
      `--${boundary}`,
      'Content-Type: application/pdf; name="renewal.pdf"',
      'Content-Disposition: attachment; filename="renewal.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("%PDF-signed-attachment").toString("base64"),
      `--${boundary}--`,
    ].join("\r\n")).replace("Content-Type: text/plain; charset=utf-8\r\n", "");
    const signed = await sign(raw);
    for (const outerHeaders of [
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      'Content-Type: multipart/alternative; boundary="attacker"',
      "Content-Type: text/html; charset=utf-7\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=attacker.html",
    ]) {
      const parsed = await authenticateOperatorEmail(Buffer.concat([
        Buffer.from(`${outerHeaders}\r\n`), signed,
      ]));
      expect(parsed.text?.trim()).toBe("Review the attached renewal.");
      expect(parsed.attachments).toHaveLength(1);
      expect(parsed.attachments[0].filename).toBe("renewal.pdf");
      expect(parsed.attachments[0].content.toString()).toBe("%PDF-signed-attachment");
    }
  });

  it("preserves single-part Gmail body bytes when outer type or transfer encoding is unsigned", async () => {
    const body = "Summarize Cove's renewal =E2=80=94 keep these source bytes.";
    const signed = await sign(message([], body).replace(
      "Content-Type: text/plain; charset=utf-8\r\n", "",
    ));
    for (const outerHeaders of [
      "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable",
      "Content-Type: text/html; charset=utf-7\r\nContent-Transfer-Encoding: base64",
    ]) {
      const parsed = await authenticateOperatorEmail(Buffer.concat([
        Buffer.from(`${outerHeaders}\r\n`), signed,
      ]));
      expect(parsed.text?.trim()).toBe(body);
      expect(parsed.html).toBe(false);
      expect(parsed.attachments).toHaveLength(0);
    }
  });

  it("still decodes authenticated outer MIME headers and rejects duplicate interpretation headers", async () => {
    const raw = message(["Content-Transfer-Encoding: base64"], Buffer.from("Review this renewal.").toString("base64"));
    const signed = await sign(raw);
    expect((await authenticateOperatorEmail(signed)).text?.trim()).toBe("Review this renewal.");
    await expect(authenticateOperatorEmail(Buffer.concat([
      Buffer.from("Content-Type: text/html\r\n"), signed,
    ]))).rejects.toThrow("ambiguous");
  });

  it.each(["operator@spot.insure", "operator@agents.spot.insure"])(
    "rejects signed mail addressed to %s instead of the operator inbox",
    async (recipient) => {
      const raw = message().replace("operator@agent.spot.insure", recipient);
      await expect(authenticateOperatorEmail(await sign(raw)))
        .rejects.toThrow("address the operator inbox");
    },
  );

  it("rejects partial-body signatures and messages addressed elsewhere", async () => {
    await expect(authenticateOperatorEmail(await sign(message(), "spot.insure", 5)))
      .rejects.toThrow("aligned DKIM");
    await expect(authenticateOperatorEmail(await sign(message().replace(
      "To: operator@agent.spot.insure", "To: attacker@example.com",
    )))).rejects.toThrow("address the operator inbox");
  });
});
