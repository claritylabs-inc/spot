"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { SpotWordmark } from "@claritylabs-inc/ui/components/brand/spot-wordmark";
import type { PacketView } from "./view";
import { PacketDocument } from "./packet-document";
import { typeStyle } from "@/lib/typography";

const getPacket = makeFunctionReference<"query", { token: string }, PacketView>(
  "procurementPacket:getByToken",
);
const recordView = makeFunctionReference<
  "mutation",
  { token: string; userAgent?: string },
  { ok: boolean }
>("procurementPacket:recordView");

export function Packet({
  token,
  initialView,
}: {
  token: string;
  initialView: PacketView;
}) {
  const live = useQuery(getPacket, { token });
  const view = live === undefined ? initialView : live;
  const record = useMutation(recordView);
  const recorded = useRef(false);
  useEffect(() => {
    if (recorded.current || view?.state !== "ready") return;
    recorded.current = true;
    void record({
      token,
      userAgent: navigator.userAgent,
    });
  }, [record, token, view]);
  if (!view)
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <SpotWordmark />
        <h1 className={`mt-12 ${typeStyle("heading.page")}`}>
          Packet unavailable
        </h1>
      </main>
    );
  return <PacketDocument view={view} />;
}
