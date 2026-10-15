"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Card } from "@claritylabs-inc/ui/components/card";
import { useTheme } from "@/hooks/use-theme";

/** Read-only Mapbox preview; the search SDK's minimap fixes its zoom at 16. */
export function MapboxAddressPreview({
  longitude,
  latitude,
  address,
  accessToken,
}: {
  longitude: number;
  latitude: number;
  address: string;
  accessToken: string;
}) {
  const { resolved } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(
        Math.max(1, Math.min(1280, Math.round(entry.contentRect.width))),
      ),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const style = resolved === "dark" ? "dark-v11" : "light-v11";
  const source = `https://api.mapbox.com/styles/v1/mapbox/${style}/static/${longitude},${Math.max(-85.0511, Math.min(85.0511, latitude))},14/${width}x160@2x?access_token=${encodeURIComponent(accessToken)}`;
  return (
    <Card ref={container} className="relative h-40 gap-0 rounded-lg py-0">
      <Image
        src={source}
        alt={`Map of ${address}`}
        fill
        unoptimized
        className="object-cover"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-emerald-500"
      />
    </Card>
  );
}
