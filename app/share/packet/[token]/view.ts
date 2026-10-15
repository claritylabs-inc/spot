import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
export type PacketView = {
  state: "ready";
  title: string;
  recipientLabel: string;
  contactEmail?: string | null;
  expiresAt?: number;
  markdown: string;
  files: Array<{
    _id: string;
    name: string;
    documentCategory?: "requirements" | "policy" | "loss_runs" | "supporting";
    brokerRelease: "listed" | "attached";
    downloadUrl: string | null;
  }>;
} | null;

const getPacket = makeFunctionReference<"query", { token: string }, PacketView>(
  "procurementPacket:getByToken",
);

export function loadPacket(token: string) {
  return fetchQuery(getPacket, { token });
}
