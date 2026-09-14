"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

const DEFAULT_IMAGE_BACKGROUND = "#FFFFFF";
const SAMPLE_SIZE = 48;
const CORNER_SIZE = 10;
const MIN_OPAQUE_CORNER_RATIO = 0.9;
const backgroundColorCache = new Map<string, Promise<string>>();

const sizeClasses = {
  xs: "h-3.5 w-3.5",
  sm: "h-6 w-6",
  md: "h-7 w-7",
  lg: "h-8 w-8",
} as const;

function toHex(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

function sampleImageElementBackground(img: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return DEFAULT_IMAGE_BACKGROUND;

  const width = img.naturalWidth || SAMPLE_SIZE;
  const height = img.naturalHeight || SAMPLE_SIZE;
  const scale = Math.min(SAMPLE_SIZE / width, SAMPLE_SIZE / height);
  const drawWidth = Math.max(1, Math.round(width * scale));
  const drawHeight = Math.max(1, Math.round(height * scale));
  const xOffset = Math.round((SAMPLE_SIZE - drawWidth) / 2);
  const yOffset = Math.round((SAMPLE_SIZE - drawHeight) / 2);

  ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  ctx.drawImage(img, xOffset, yOffset, drawWidth, drawHeight);

  const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const buckets = new Map<
    string,
    { r: number; g: number; b: number; count: number }
  >();
  let cornerPixels = 0;
  let opaqueCornerPixels = 0;

  for (let y = 0; y < SAMPLE_SIZE; y += 1) {
    for (let x = 0; x < SAMPLE_SIZE; x += 1) {
      const isCorner =
        (x < CORNER_SIZE && y < CORNER_SIZE) ||
        (x >= SAMPLE_SIZE - CORNER_SIZE && y < CORNER_SIZE) ||
        (x < CORNER_SIZE && y >= SAMPLE_SIZE - CORNER_SIZE) ||
        (x >= SAMPLE_SIZE - CORNER_SIZE &&
          y >= SAMPLE_SIZE - CORNER_SIZE);
      if (!isCorner) continue;

      cornerPixels += 1;
      const index = (y * SAMPLE_SIZE + x) * 4;
      const alpha = data[index + 3];
      if (alpha < 220) continue;

      opaqueCornerPixels += 1;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const key = `${Math.round(r / 24)}-${Math.round(g / 24)}-${Math.round(
        b / 24,
      )}`;
      const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count += 1;
      buckets.set(key, bucket);
    }
  }

  if (
    cornerPixels === 0 ||
    opaqueCornerPixels / cornerPixels < MIN_OPAQUE_CORNER_RATIO ||
    buckets.size === 0
  ) {
    return DEFAULT_IMAGE_BACKGROUND;
  }

  const dominant = Array.from(buckets.values()).sort(
    (a, b) => b.count - a.count,
  )[0];
  return `#${toHex(dominant.r / dominant.count)}${toHex(
    dominant.g / dominant.count,
  )}${toHex(dominant.b / dominant.count)}`;
}

function sampleImageBackground(src: string) {
  const cached = backgroundColorCache.get(src);
  if (cached) return cached;

  const promise = new Promise<string>((resolve) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        resolve(sampleImageElementBackground(img));
      } catch {
        resolve(DEFAULT_IMAGE_BACKGROUND);
      }
    };
    img.onerror = () => resolve(DEFAULT_IMAGE_BACKGROUND);
    img.src = src;
  });

  backgroundColorCache.set(src, promise);
  return promise;
}

type BrandIconProps = {
  src?: string | null;
  name?: string | null;
  alt?: string;
  size?: keyof typeof sizeClasses;
  className?: string;
  imageClassName?: string;
};

export function BrandIcon({
  src,
  alt = "",
  size = "md",
  className,
  imageClassName,
}: BrandIconProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [sampledBackground, setSampledBackground] = useState<{
    src: string;
    color: string;
  } | null>(null);
  const imageSrc = src && failedSrc !== src ? src : null;
  const showImage = imageSrc !== null;
  const imageBackgroundColor =
    sampledBackground !== null && sampledBackground.src === imageSrc
      ? sampledBackground.color
      : DEFAULT_IMAGE_BACKGROUND;

  useEffect(() => {
    if (!src) return;

    let cancelled = false;
    void sampleImageBackground(src).then((color) => {
      if (!cancelled) setSampledBackground({ src, color });
    });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md",
        sizeClasses[size],
        showImage
          ? "overflow-hidden"
          : "bg-muted text-muted-foreground ring-1 ring-inset ring-border-subtle",
        className,
      )}
      style={showImage ? { backgroundColor: imageBackgroundColor } : undefined}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageSrc}
          alt={alt}
          className={cn(
            "h-full w-full rounded-[inherit] object-contain",
            imageClassName,
          )}
          onError={() => {
            if (src) setFailedSrc(src);
          }}
        />
      ) : (
        <Building2
          className="h-2/3 w-2/3"
          strokeWidth={1.75}
          role={alt ? "img" : undefined}
          aria-label={alt || undefined}
          aria-hidden={!alt}
        />
      )}
    </span>
  );
}
