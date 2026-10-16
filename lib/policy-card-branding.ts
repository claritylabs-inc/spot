import type { CSSProperties } from "react";
import { readableTextFor } from "@/lib/branding";

const BRANDED_CARD_BASE_COLOR = "#1E293B";
const DEFAULT_CARD_COLOR = "#000000";
const DEFAULT_OVERVIEW_COLOR = "#FFFFFF";
const DEFAULT_CARD_SURFACE_CLASS_NAME =
  "border-border bg-background text-foreground";
const DEFAULT_OVERVIEW_SURFACE_CLASS_NAME = "bg-background text-foreground";
const BRAND_COLOR_WEIGHT = 0.52;
const OVERVIEW_COLOR_WEIGHT = 0.5;
const PATTERN_WIDTH = 720;
const PATTERN_HEIGHT = 405;
const ASCII_GLYPHS = " .:+?N9#";
const ASCII_COLUMNS = 60;
const ASCII_ROWS = 34;
const ASCII_PHASES = 3;
const patternDataUris = new Map<string, string>();

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function normalizedBrandColor(value?: string | null) {
  const color = value?.trim().toUpperCase();
  return color && /^#[0-9A-F]{6}$/.test(color) ? color : undefined;
}

function hexChannels(color: string) {
  return [1, 3, 5].map((start) =>
    Number.parseInt(color.slice(start, start + 2), 16),
  );
}

function channelHex(value: number) {
  return Math.round(value).toString(16).padStart(2, "0").toUpperCase();
}

function mixColors(baseColor: string, brandColor: string, brandWeight: number) {
  const brand = hexChannels(brandColor);
  const base = hexChannels(baseColor);
  return `#${base
    .map((channel, index) =>
      channelHex(
        channel * (1 - brandWeight) + brand[index] * brandWeight,
      ),
    )
    .join("")}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(edgeStart: number, edgeEnd: number, value: number) {
  const progress = clamp(
    (value - edgeStart) / (edgeEnd - edgeStart),
    0,
    1,
  );
  return progress * progress * (3 - 2 * progress);
}

function shaderHash(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function asciiShaderRows(variant: number) {
  const phase = (variant / ASCII_PHASES) * Math.PI * 2;

  return Array.from({ length: ASCII_ROWS }, (_, row) => {
    const fieldY = (row + 0.5) / ASCII_ROWS;
    return Array.from({ length: ASCII_COLUMNS }, (_, column) => {
      const center =
        0.46 +
        Math.sin(column * 0.075 - phase * 2) * 0.09 +
        Math.sin(column * 0.021 + phase) * 0.06;
      const bandOffset = (fieldY - center) / 0.3;
      const band = Math.exp(-(bandOffset * bandOffset));
      const waveA =
        0.5 +
        0.5 * Math.sin(column * 0.13 + row * 0.17 - phase * 10);
      const waveB =
        0.5 +
        0.5 * Math.sin(column * 0.047 - row * 0.12 + phase * 6);
      const randomValue = shaderHash(
        column + variant * 3.1,
        row + variant * 1.7,
      );
      const signal = band * (0.32 + waveA * 0.34 + waveB * 0.22);
      const lowerReach = clamp(
        center + 0.24 + Math.sin(column * 0.035 - phase * 4) * 0.08,
        0.56,
        0.96,
      );
      const lowerFade = 1 - smoothstep(lowerReach, 1, fieldY);
      const topFeather = smoothstep(0.02, 0.14, fieldY);
      const density = clamp(
        (signal + randomValue * 0.12) * lowerFade * topFeather,
        0,
        0.999,
      );
      return ASCII_GLYPHS[Math.floor(density * ASCII_GLYPHS.length)];
    }).join("");
  });
}

export function policyAsciiShaderDataUri(
  variant: number,
  requestedColor: string,
) {
  const color = /^#[0-9A-F]{6}$/i.test(requestedColor)
    ? requestedColor
    : "#000000";
  const phase = Math.abs(Math.trunc(variant)) % ASCII_PHASES;
  const cacheKey = `${phase}:${color}`;
  const cached = patternDataUris.get(cacheKey);
  if (cached) return cached;

  const rowHeight = PATTERN_HEIGHT / ASCII_ROWS;
  const rows = asciiShaderRows(phase)
    .map(
      (row, index) =>
        `<text x="0" y="${((index + 0.82) * rowHeight).toFixed(2)}" textLength="${PATTERN_WIDTH}" lengthAdjust="spacing" xml:space="preserve">${row}</text>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PATTERN_WIDTH} ${PATTERN_HEIGHT}" data-pattern="ascii-shader" data-phase="${phase}"><defs><linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="white" stop-opacity="0"/><stop offset="0.28" stop-color="white" stop-opacity="0.12"/><stop offset="0.56" stop-color="white" stop-opacity="0.62"/><stop offset="1" stop-color="white"/></linearGradient><mask id="soft-mask"><rect width="${PATTERN_WIDTH}" height="${PATTERN_HEIGHT}" fill="url(#fade)"/></mask></defs><g mask="url(#soft-mask)" fill="${color}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="9.5" font-weight="500">${rows}</g></svg>`;
  const dataUri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  patternDataUris.set(cacheKey, dataUri);
  return dataUri;
}

function policyPattern(carrierName: string) {
  const patternVariant = hashString(carrierName) % ASCII_PHASES;
  const maskImage = `url("${policyAsciiShaderDataUri(patternVariant, "#000000")}")`;
  const patternStyle: CSSProperties = {
    backgroundColor:
      "color-mix(in srgb, currentColor 14%, transparent)",
    maskImage,
    maskMode: "alpha",
    maskPosition: "right center",
    maskRepeat: "no-repeat",
    maskSize: "auto 25.3125rem",
    WebkitMaskImage: maskImage,
    WebkitMaskPosition: "right center",
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskSize: "auto 25.3125rem",
  };

  return { patternStyle, patternVariant };
}

function tonePolicyCardColor(value?: string | null) {
  const brandColor = normalizedBrandColor(value);
  return brandColor
    ? mixColors(BRANDED_CARD_BASE_COLOR, brandColor, BRAND_COLOR_WEIGHT)
    : DEFAULT_CARD_COLOR;
}

function tonePolicyOverviewColor(value?: string | null) {
  const brandColor = normalizedBrandColor(value);
  return brandColor
    ? mixColors("#FFFFFF", brandColor, OVERVIEW_COLOR_WEIGHT)
    : DEFAULT_OVERVIEW_COLOR;
}

export function policyOverviewBranding(
  carrierName: string,
  requestedColor?: string | null,
) {
  const brandColor = normalizedBrandColor(requestedColor);
  const { patternStyle, patternVariant } = policyPattern(carrierName);
  return {
    patternStyle,
    patternVariant,
    surfaceClassName: brandColor
      ? undefined
      : DEFAULT_OVERVIEW_SURFACE_CLASS_NAME,
    surfaceStyle: brandColor
      ? ({
          backgroundColor: tonePolicyOverviewColor(brandColor),
          color: "#0F172A",
        } satisfies CSSProperties)
      : undefined,
  };
}

export function policyCardBranding(
  carrierName: string,
  requestedColor?: string | null,
) {
  const brandColor = normalizedBrandColor(requestedColor);
  const cardColor = tonePolicyCardColor(brandColor);
  const textColor =
    readableTextFor(cardColor) === "light" ? "#FFFFFF" : "#0F172A";
  const { patternStyle, patternVariant } = policyPattern(carrierName);

  return {
    cardColor,
    textColor,
    patternVariant,
    surfaceClassName: brandColor ? undefined : DEFAULT_CARD_SURFACE_CLASS_NAME,
    surfaceStyle: brandColor
      ? ({
          backgroundColor: cardColor,
          color: textColor,
        } satisfies CSSProperties)
      : undefined,
    patternStyle,
  };
}
