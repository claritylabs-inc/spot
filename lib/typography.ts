import type { CSSProperties } from "react";

/**
 * Browser typography is owned here. Callers choose meaning; this registry
 * owns every font, size, weight, line-height, tracking, casing, style, and
 * numeric-variant decision for that meaning.
 */
export const typographyRoles = {
  "heading.display":
    "font-sans text-3xl font-medium leading-[1.1] tracking-tight normal-case not-italic normal-nums sm:text-4xl",
  "heading.page":
    "font-sans text-2xl font-semibold leading-[1.35] tracking-tight normal-case not-italic normal-nums",
  "heading.section":
    "font-sans text-lg font-medium leading-[1.35] tracking-[-0.025em] normal-case not-italic normal-nums",
  "heading.item":
    "font-sans text-[1.05rem] font-medium leading-[1.35] tracking-[-0.025em] normal-case not-italic normal-nums md:text-[1.1rem]",
  "heading.micro":
    "font-sans text-base font-medium leading-5 tracking-[-0.025em] normal-case not-italic normal-nums",

  "body.root":
    "font-sans text-[1rem] font-normal leading-[1.5rem] tracking-normal normal-case not-italic normal-nums antialiased",
  "body.default":
    "font-sans text-base font-normal leading-normal tracking-normal normal-case not-italic normal-nums",
  "body.medium":
    "font-sans text-base font-medium leading-normal tracking-normal normal-case not-italic normal-nums",
  "body.strong":
    "font-sans text-base font-semibold leading-normal tracking-normal normal-case not-italic normal-nums",
  "body.large":
    "font-sans text-sm font-normal leading-5 tracking-normal normal-case not-italic normal-nums",

  "caption.default":
    "font-sans text-label font-normal leading-normal tracking-normal normal-case not-italic normal-nums",
  "caption.medium":
    "font-sans text-label font-medium leading-normal tracking-normal normal-case not-italic normal-nums",

  "label.field":
    "font-sans text-label font-medium leading-none tracking-normal normal-case not-italic normal-nums",
  "label.table":
    "font-sans text-label font-medium leading-normal tracking-normal normal-case not-italic normal-nums",
  "label.eyebrow":
    "font-sans text-label font-medium leading-normal tracking-[0.08em] uppercase not-italic normal-nums",
  "label.metadata":
    "font-sans text-label font-normal leading-[1.5rem] tracking-normal normal-case not-italic normal-nums sm:text-base sm:leading-normal",
  "label.tag":
    "font-sans text-tag font-medium leading-none tracking-normal normal-case not-italic normal-nums",

  "control.button":
    "font-sans text-base font-medium leading-normal tracking-normal normal-case not-italic normal-nums",
  "control.buttonCompact":
    "font-sans text-label font-medium leading-none tracking-normal normal-case not-italic normal-nums",
  "control.input":
    "font-sans text-base font-normal leading-normal tracking-normal normal-case not-italic normal-nums file:font-sans file:text-base file:font-medium file:leading-normal file:tracking-normal file:normal-case file:not-italic file:normal-nums max-md:text-[16px]",
  "control.tab":
    "font-sans text-label font-normal leading-normal tracking-normal normal-case not-italic normal-nums data-active:font-medium",
  "control.menu":
    "font-sans text-base font-normal leading-normal tracking-normal normal-case not-italic normal-nums",

  "data.numeric":
    "font-sans text-base font-normal leading-normal tracking-normal normal-case not-italic tabular-nums",
  "technical.code":
    "font-mono text-base font-normal leading-normal tracking-normal normal-case not-italic tabular-nums",
  "technical.codeCompact":
    "font-mono text-label font-normal leading-4 tracking-normal normal-case not-italic tabular-nums",
  "technical.numeric":
    "font-mono text-base font-normal leading-normal tracking-normal normal-case not-italic tabular-nums",
  "technical.shortcut":
    "font-mono text-label font-normal leading-none tracking-normal normal-case not-italic tabular-nums",
  "technical.otp":
    "font-mono text-xl font-medium leading-none tracking-normal normal-case not-italic tabular-nums",

  "brand.display":
    "font-brand text-3xl font-normal leading-[1.1] tracking-tight normal-case not-italic normal-nums sm:text-4xl",
  "brand.wordmark":
    "font-brand text-xl font-normal leading-none tracking-tight normal-case not-italic normal-nums",

  "prose.default":
    "font-sans text-base font-normal leading-relaxed tracking-normal normal-case not-italic normal-nums [&_strong]:font-semibold [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_h4]:text-base [&_h4]:font-semibold [&_h5]:text-base [&_h5]:font-semibold [&_h6]:text-base [&_h6]:font-semibold [&_code]:font-mono [&_code]:text-label [&_table]:text-label [&_th]:text-label [&_th]:font-semibold",
  "prose.compact":
    "font-sans text-base font-normal leading-relaxed tracking-normal normal-case not-italic normal-nums [&_strong]:font-semibold [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_h4]:text-base [&_h4]:font-semibold [&_h5]:text-base [&_h5]:font-semibold [&_h6]:text-base [&_h6]:font-semibold [&_em]:text-base",

  inherit:
    "[font-family:inherit] [font-size:inherit] [font-weight:inherit] [line-height:inherit] [letter-spacing:inherit] [text-transform:inherit] [font-style:inherit] [font-variant-numeric:inherit]",
} as const;

export type TypographyRole = keyof typeof typographyRoles;

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

export function typeStyle(role: TypographyRole): string {
  return typographyRoles[role];
}

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
