import type { CSSProperties } from "react";

import {
  typeStyle,
  typographyRoles,
  type TypographyRole,
} from "@claritylabs-inc/ui/lib/typography";

export { typeStyle, typographyRoles };
export type { TypographyRole };

export const redactionLevels = ["clean", "35", "50", "70", "100"] as const;
export type RedactionLevel = (typeof redactionLevels)[number];
export type BrandTypographyRole = Extract<TypographyRole, `brand.${string}`>;

const redactionFamilyClasses: Record<RedactionLevel, string> = {
  clean: "font-brand",
  "35": "font-redaction35",
  "50": "font-redaction50",
  "70": "font-redaction70",
  "100": "font-redaction100",
};

/** Selects a Redaction cut only through a brand role, never as a raw token. */
export function redactionTypeStyle(
  role: BrandTypographyRole,
  level: RedactionLevel = "clean",
): string {
  return typographyRoles[role].replace("font-brand", redactionFamilyClasses[level]);
}

/** Typography contract for the Spot social card rendered through next/og. */
export const spotSocialAsciiTypographyStyle = Object.freeze({
  fontFamily: "monospace",
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: "0.085em",
  lineHeight: 0.96,
} satisfies CSSProperties);

export const spotSocialUrlTypographyStyle = Object.freeze({
  fontFamily: "Geist",
  fontSize: 32,
  fontWeight: 400,
} satisfies CSSProperties);

/** Typography mirrored by the hidden sizer and editable control. */
export const editableMirrorTypographyStyle = Object.freeze({
  fontFamily: "inherit",
  fontSize: "inherit",
  fontWeight: "inherit",
  fontStyle: "inherit",
  lineHeight: "inherit",
  letterSpacing: "inherit",
  textTransform: "inherit",
  fontVariantNumeric: "inherit",
} satisfies CSSProperties);

/** External Mapbox controls cannot consume class names, so they mirror roles. */
export const mapboxTypographyAdapter = Object.freeze({
  variables: Object.freeze({
    fontFamily: "inherit",
    fontWeight: "400",
    fontWeightSemibold: "500",
    fontWeightBold: "500",
    lineHeight: "1.35",
  }),
  cssText: ".MapboxSearchListbox * { letter-spacing: 0; }",
});

/** Scaled text marks use inline sizing while retaining a fixed typed style. */
export function scaledSvgWordmarkTypography(size: number): Readonly<CSSProperties> {
  return Object.freeze({
    fontFamily: "var(--font-geist-sans), Geist, ui-sans-serif, system-ui, sans-serif",
    fontSize: Math.max(7, Math.round(size * 0.45)),
    fontWeight: 500,
    lineHeight: 1,
    letterSpacing: "normal",
    textTransform: "none",
    fontStyle: "normal",
    fontVariantNumeric: "normal",
  });
}

/** CodeMirror keeps source text at one size and only emphasizes Markdown syntax. */
export const markdownSyntaxTypographyStyles = Object.freeze({
  strong: Object.freeze({ fontWeight: "600" }),
  emphasis: Object.freeze({ fontStyle: "italic" }),
});
