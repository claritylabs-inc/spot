# Spot typography

Spot browser typography is a typed semantic system. The owner is
[`lib/typography.ts`](../../lib/typography.ts); React callsites select a role
with `typeStyle(role)` and keep color, spacing, alignment, truncation, and
layout local. Generated social images, transactional email HTML, and PDF
rendering have separate renderer contracts.

## Font palette

- **Geist Sans** is the product default for headings, body copy, labels, and
  controls. It remains the visual default until a separately reviewed mono
  rollout changes role definitions.
- **Geist Mono** is reserved for code, identifiers, shortcuts, OTPs, and other
  technical or fixed-width values.
- **Redaction Clean** (`clean`) is the readable brand face. Its regular, italic, and bold
  files form the `--font-redaction` family and the `--font-brand` token.
- **Redaction 35, 50, 70, and 100** are progressively degraded cuts. `35` has
  the lightest disruption; `100` is the most redacted. They are registered on
  the document without eager preload and must be selected through
  `redactionTypeStyle(brandRole, level)`.

Redaction is for deliberate brand/display work, never routine product copy,
tables, controls, or long-form reading. The degraded cuts should communicate
resolution or redaction, not decorate arbitrary headings.

## Role matrix

| Role | Meaning and example | Casing |
| --- | --- | --- |
| `heading.display` | Large campaign or hero display | Sentence case |
| `heading.page` | Primary page title | Sentence case |
| `heading.section` | Major section title | Sentence case |
| `heading.item` | Card, drawer, or grouped-item title | Sentence case |
| `heading.micro` | Small structural heading | Sentence case |
| `body.root` | Document baseline; use once on `<body>` | As authored |
| `body.default` | Ordinary product copy and values | As authored |
| `body.medium` | Medium-emphasis body copy | As authored |
| `body.strong` | Strong-emphasis body copy | As authored |
| `body.large` | Larger reading copy or channel-specific body | As authored |
| `caption.default` | Quiet supporting text | As authored |
| `caption.medium` | Emphasized supporting text | As authored |
| `label.field` | Form-field label | As authored |
| `label.table` | Table or column label | As authored |
| `label.eyebrow` | Small section eyebrow | Uppercase |
| `label.metadata` | Metadata name or quiet key | As authored |
| `label.tag` | Compact badge or tag label | As authored |
| `control.button` | Standard button or action label | As authored |
| `control.buttonCompact` | Compact/pill action label | As authored |
| `control.input` | Input, textarea, or editable value | As authored |
| `control.tab` | Tab or tab-like structural control | As authored |
| `control.menu` | Menu, select, or command item | As authored |
| `data.numeric` | Human-facing numeric data | As authored; tabular figures |
| `technical.code` | Code or technical identifier | As authored |
| `technical.codeCompact` | Compact code or identifier | As authored |
| `technical.numeric` | Fixed-width technical number | As authored; tabular figures |
| `technical.shortcut` | Keyboard shortcut | As authored |
| `technical.otp` | One-time-passcode digit | As authored; tabular figures |
| `brand.display` | Redaction brand display | Sentence case |
| `brand.wordmark` | Redaction text wordmark | Brand casing |
| `prose.default` | User/agent-authored rich content | Preserve authored content |
| `prose.compact` | Compact quoted or reply content | Preserve authored content |
| `inherit` | Mirrored external/editable text only | Inherit exactly |

The semantic heading element and visual role are independent. Keep the HTML
outline correct for assistive technology, then select the visual role:

```tsx
<h2 className={typeStyle("heading.page")}>Policy details</h2>
```

Do not choose `<h1>` merely to obtain a larger visual style, and do not change
the role merely to repair document hierarchy.

## Usage

Use the typed owner:

```tsx
import { typeStyle } from "@/lib/typography";

<p className={cn("text-muted-foreground", typeStyle("body.default"))}>
  Renewal information
</p>
```

Do not declare typography with raw utilities or inline properties:

```tsx
// Prohibited
<p className="text-base font-medium leading-5 tracking-tight">...</p>
<p style={{ fontSize: 14, fontWeight: 500 }}>...</p>
```

For Redaction, select both a brand role and a typed level:

```tsx
redactionTypeStyle("brand.display", "50");
```

Never select `--font-redaction-*`, `font-redaction*`, or a Redaction family
directly at a callsite.

## Responsive and accessible text

- Let roles own responsive size changes. Do not add responsive font utilities
  beside a role.
- `control.input` maintains a 16px mobile input size to prevent iOS focus zoom.
- Keep wrapping, line clamping, width, and overflow local. Test long names,
  unbroken identifiers, translated copy, and narrow mobile widths.
- Preserve semantic elements, accessible names, and a logical heading outline.
  Visual roles do not replace HTML semantics.
- Use `prose.default` or `prose.compact` for user- or agent-authored rich text.
  Do not force casing onto authored content. Default prose distinguishes h1, h2, and h3
  at 24, 20, and 18 px, with deeper headings at body size; compact quoted
  text retains body-sized headings. `ProseMarkdown` owns section spacing and
  wrapping table cells, with horizontal scrolling for wide comparisons.
- Mapbox, editable mirrored text, and scaled text marks use the named adapters
  exported by the owner because their renderers cannot consume ordinary role
  classes. Do not recreate those inline objects.

## Contributing

1. Reuse the closest semantic role. A one-off raw override is not allowed.
2. If no role expresses a durable product meaning, add a role to the closed
   registry, document it in the matrix, and add runtime and compile-time tests.
3. If brand work needs a new Redaction cut, extend `RedactionLevel`, the typed
   resolver, font registration, traceability hashes, guide, and tests together.
4. Run the typography tests, `npm run lint`, `npx tsc --noEmit`, and the build.
   Visually compare affected desktop/mobile and light/dark surfaces.

## Redaction asset provenance

Assets were copied from `claritylabs-inc/clarity-landing` commit
`9e5184f5fa78da52c99be7fc62a8b33fdfece429`.

| Upstream path | Spot path | SHA-256 |
| --- | --- | --- |
| `src/app/fonts/redaction/Redaction-Regular.woff2` | `app/fonts/redaction/Redaction-Regular.woff2` | `01a800a24bda48886fd1893f2aa20cab80db05ef2cdbb4025048438429ad5779` |
| `src/app/fonts/redaction/Redaction-Italic.woff2` | `app/fonts/redaction/Redaction-Italic.woff2` | `7a4422a14b1defb5a4027e8bfd9b8d70098bfda9eea4437721d2878215954ece` |
| `src/app/fonts/redaction/Redaction-Bold.woff2` | `app/fonts/redaction/Redaction-Bold.woff2` | `882f894183ab93f6781af59fc5f0f4619870c189e69411235507095c0f05886a` |
| `src/app/fonts/redaction/Redaction35-Regular.woff2` | `app/fonts/redaction/Redaction35-Regular.woff2` | `eea39b70eabf1539754e025abfc8382f14f034a9fca1557c8516acaa04d43f3e` |
| `src/app/fonts/redaction/Redaction50-Regular.woff2` | `app/fonts/redaction/Redaction50-Regular.woff2` | `f7cac2422e6decc16b6233243dd315d826ee983b3651689df6097b31cbcbcec5` |
| `src/app/fonts/redaction/Redaction70-Regular.woff2` | `app/fonts/redaction/Redaction70-Regular.woff2` | `1e922afe6452f402fc532fc3b9a9b75ac4a07571135919083fefc951689810c0` |
| `src/app/fonts/redaction/Redaction100-Regular.woff2` | `app/fonts/redaction/Redaction100-Regular.woff2` | `6811129cb3cee1125bbc81fa357b17193dea5e27c14ed25cca22d5cf745ed6b1` |
