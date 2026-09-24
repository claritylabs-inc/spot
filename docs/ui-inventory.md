# Spot UI / design-system inventory

Prepared as input to the `claritylabs-inc/clarity-ui` extraction (a shared
`@claritylabs-inc/ui` package built on shadcn + Base UI + Tailwind v4,
published to GitHub Packages, consumed via Next `transpilePackages`). This
is investigation only — no behavior changes were made.

Classification legend used throughout:

- **generic** — no app/domain coupling; moves to `clarity-ui` largely as-is.
- **brand/marketing** — Spot-branded but a genuine design-system asset
  (logo, wordmark, brand color); moves to `clarity-ui` under a brand entry.
- **app-specific** — coupled to Convex, auth, routing, feature flags, or
  Spot's insurance/procurement/broker domain model; stays in `spot`.

## 1. Versions and toolchain

| Package | Version |
| --- | --- |
| `react` / `react-dom` | `19.2.3` |
| `next` | `16.2.9` |
| `tailwindcss` / `@tailwindcss/postcss` | `^4` |
| `tw-animate-css` | `^1.4.0` |
| `@base-ui/react` | `^1.4.1` (note: package name is `@base-ui/react`, not `@base-ui-components/react`) |
| `shadcn` (CLI) | `^4.11.0` |
| `framer-motion` | `^12.35.0` |
| `motion` | `^12.38.0` (both present simultaneously — dedup candidate) |
| `class-variance-authority` | `^0.7.1` |
| `clsx` | `^2.1.1` |
| `tailwind-merge` | `^3.5.0` |
| `cmdk` | `^1.1.1` |
| `lucide-react` | `^0.577.0` |
| `react-icons` | `^5.6.0` (6 call sites, mostly provider/channel logos) |
| `simple-icons` | `^16.17.0` |
| `@lisse/core` | `0.6.2` (squircle-corner geometry primitives; see §5) |
| `typescript` | `^5` |

`components.json` (shadcn config):

```json
{
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": { "config": "", "css": "app/globals.css", "baseColor": "neutral", "cssVariables": true, "prefix": "" },
  "iconLibrary": "lucide",
  "rtl": false,
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks" },
  "menuColor": "default",
  "menuAccent": "subtle",
  "registries": {}
}
```

- `style: "base-nova"` and empty `tailwind.config` confirm shadcn is generating **Base UI**-flavored primitives against Tailwind v4's CSS-first `@theme` config — there is no `tailwind.config.js/ts` anywhere in the repo.
- `menuColor`/`menuAccent` are non-stock shadcn fields (local convention).
- Two non-standard fields beyond stock shadcn schema.

**PostCSS** (`postcss.config.mjs`): single `@tailwindcss/postcss` plugin, nothing else.

**tsconfig.json** notables: `target: ES2017`, `strict: true`, `jsx: "react-jsx"`, `moduleResolution: "bundler"`, single path alias `"@/*": ["./*"]` (repo-root-relative — a published package will need its own root-relative alias or none at all), `exclude` list carves out the worker subprojects (`cli`, `operator-cli`, `imessage-worker`, `extraction-worker`, `slack-worker`) from the main program.

No Storybook, no `*.stories.tsx`, no `/playground` or component-showcase route exist anywhere in the repo — the new package will need to stand up its own preview/showcase harness from scratch.

## 2. Design tokens (`app/globals.css`, 375 lines)

Tailwind v4 CSS-first setup:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@plugin "@tailwindcss/typography";
@custom-variant dark (&:is(.dark *));
```

`@import "shadcn/tailwind.css"` pulls in the shadcn package's own `@theme inline` block (accordion keyframes, and the `data-open`/`data-closed`/`data-checked`/`data-selected`/etc. `@custom-variant`s that Base UI components rely on) — this is vendored, not authored locally, but is part of the effective token surface a migration must account for.

Dark mode is a `.dark` class toggle (not a media query) driven by an inline boot script in `app/layout.tsx` that reads `localStorage.getItem("theme")`, falling back to `matchMedia("(prefers-color-scheme: dark)")`.

### Color tokens (`:root` / `.dark`)

| Token | Light | Dark |
| --- | --- | --- |
| `--background` | `#ffffff` | `#111315` |
| `--foreground` | `#000000` | `#f7f7f8` |
| `--foreground-highlight` | `#000000` | `#ffffff` |
| `--card` / `--card-foreground` | `#ffffff` / `#000000` | `#181a1d` / `#f7f7f8` |
| `--popover` / `--popover-foreground` | `#ffffff` / `#000000` | `#1f2125` / `#f7f7f8` |
| `--primary` / `--primary-foreground` | `#2a97ff` / `#ffffff` | `#3da1ff` / `#ffffff` |
| `--primary-light` | `#a0d2fa` | `#5bb3ff` |
| `--primary-muted` | `#5ba3d9` | `#2a7acc` |
| `--brand` / `--brand-foreground` | `#000000` / `#ffffff` | `#ffffff` / `#000000` (inverted — "the Spot accent used by primary CTAs", drives `PillButton` primary) |
| `--secondary` / `--secondary-foreground` | `#f5f5f5` / `#000000` | `#25282d` / `#f7f7f8` |
| `--muted` / `--muted-foreground` | `#f5f5f5` / `#525252` | `#25282d` / `#b8bbc2` |
| `--accent` / `--accent-foreground` | `#f5f5f5` / `#000000` | `#25282d` / `#f7f7f8` |
| `--destructive` | `#ef4444` | `#f87171` |
| `--success` / `--success-muted` | `#059669` / `#10b981` | `#34d399` / `#10b981` |
| `--warning` | `#b45309` | `#fbbf24` |
| `--border-subtle` | `rgba(0,0,0,.04)` | `rgba(255,255,255,.12)` |
| `--border` | `rgba(0,0,0,.06)` | `rgba(255,255,255,.16)` |
| `--input` | `rgba(0,0,0,.08)` | `rgba(255,255,255,.2)` |
| `--border-emphasized` | `rgba(0,0,0,.1)` | `rgba(255,255,255,.24)` |
| `--border-hover` | `rgba(0,0,0,.14)` | `rgba(255,255,255,.32)` |
| `--border-focus` | `rgba(0,0,0,.2)` | `rgba(255,255,255,.4)` |
| `--ring` | `#2a97ff` | `#3da1ff` |
| `--text-muted` / `--text-accent` / `--footer-muted` | `#525252` / `#737373` / `#737373` | `#b8bbc2` / `#969aa2` / `#969aa2` |
| `--divider` | `var(--border)` | `var(--border)` |
| `--chart-1..5` | `#2a97ff #a0d2fa #059669 #b45309 #737373` | `#3da1ff #5bb3ff #34d399 #fbbf24 #969aa2` |
| `--sidebar*` (6 vars) | mirrors background/primary/accent family | own darker set (`#0d0f11` base) |

Dark-mode borders are intentionally *brighter* than light-mode (documented rule in `docs/design/interface-style.md`, "Border hierarchy" section) so structure stays visible on low-luminance surfaces — this is a deliberate rule, not an oversight, and should be preserved as a design-system invariant.

### Non-color tokens

```css
--radius: 0.625rem;                 /* shared across light + dark, not redefined in .dark */
--radius-sm:  calc(var(--radius) * 0.6);
--radius-md:  calc(var(--radius) * 0.8);
--radius-lg:  var(--radius);
--radius-xl:  calc(var(--radius) * 1.4);
--radius-2xl: calc(var(--radius) * 1.8);
--radius-3xl: calc(var(--radius) * 2.2);
--radius-4xl: calc(var(--radius) * 2.6);

--motion-fast: 80ms;
--motion-medium: 120ms;
--motion-slow: 160ms;
--motion-ease: cubic-bezier(0.2, 0, 0, 1);   /* shared across light + dark */

--text-tag: 0.7rem;   --text-tag--line-height: 0.875rem;
--text-label: 0.7rem;
--text-base: 0.85rem;
```

No custom shadow scale or z-index scale is defined — Tailwind v4 defaults apply. The interface-style guide explicitly forbids drop shadows on persistent surfaces ("Elevation" section): panels/rows/fields/drawers are flat; only menus/popovers/toasts get a shadow, "normally with a subtle `ring-foreground/10`".

### `@layer base` / loose utilities

- `* { @apply border-border outline-ring/50; }`, `body { @apply bg-background text-foreground; }`, custom `::selection` colors (light + dark), native form-control appearance reset.
- `.sidebar-transition`, `.scrollbar-hide`, `.table-scrollbar` (+ `color-mix()`-based thin scrollbar for WebKit), `[data-sonner-toast]` positioning/hover/focus overrides, and a global `@media (prefers-reduced-motion: reduce)` block that zeroes all animation/transition durations.
- No `@layer components` block exists — "smooth corners" is implemented in JS/TS, not CSS (see §5).
- Two classes are referenced by components but not defined anywhere in CSS: `no-scrollbar` (`command.tsx`) and `spot-operational-toast` (`operational-toast.tsx`, an unstyled hook/marker class) — likely dead or reserved for external styling; worth a quick grep before porting.

### Typography (`lib/typography.ts`, separate owner from `globals.css`)

A **closed, typed semantic-role registry** — the single most valuable generic asset in the design system. Components must call `typeStyle(role)`; raw Tailwind typography utilities and inline font styles are banned by the custom ESLint rule `no-untyped-typography` (see §6) and by written policy in `AGENTS.md` and `docs/design/typography.md`.

Roles (28 total, full Tailwind-class value per role): `heading.display/page/section/item/micro`, `body.root/default/medium/strong/large`, `caption.default/medium`, `label.field/table/eyebrow/metadata/tag`, `control.button/buttonCompact/input/tab/menu`, `data.numeric`, `technical.code/codeCompact/numeric/shortcut/otp`, `brand.display/wordmark`, `prose.default/compact`, `inherit`. Also exports non-role typography contracts used by non-CSS-class renderers: `spotSocialAsciiTypographyStyle`/`spotSocialUrlTypographyStyle` (OG image), `editableMirrorTypographyStyle` (hidden sizer/editable mirror), `mapboxTypographyAdapter` (Mapbox controls can't consume class names), `scaledSvgWordmarkTypography(size)`, `markdownSyntaxTypographyStyles` (CodeMirror).

`redactionTypeStyle(brandRole, level)` swaps in a Redaction cut (`clean`/`35`/`50`/`70`/`100`) only through a brand role — raw `--font-redaction-*` selection at a callsite is prohibited.

**Migration note:** the role *system* (the `typeStyle`/registry pattern) is generic and exactly what a shared design system wants, but the current file's content mixes it with Spot-specific brand values (`spotSocialAsciiTypographyStyle` etc.) — these will need splitting: generic role engine → `clarity-ui`, Spot's specific role *values* and brand contracts → either ship as the package's default theme or stay as an app-level override layer.

### Full style guide

`docs/design/interface-style.md` is a complete, already-written visual-contract doc (character/voice, color and surfaces, border hierarchy, spacing scale with a 4px rhythm table, cards/panels/rows/tables decision table, corner radii by use, elevation rules, actions/controls incl. `PillButton` sizing contract, status indicators, responsive layout, and a "system owners" table mapping each concern to its file). This document itself is a strong candidate to migrate (in adapted form) alongside the components it governs — it already encodes most of the "why" a new shared package's README/guidelines would need.

## 3. Fonts

| Font | Files | Loader |
| --- | --- | --- |
| Geist Sans | loaded from Google, not the local `.ttf` | `next/font/google` (`Geist({ variable: "--font-geist-sans" })`) |
| Geist Mono | loaded from Google | `next/font/google` (`Geist_Mono({ variable: "--font-geist-mono" })`) |
| Redaction Clean (regular/italic/bold) | `app/fonts/redaction/Redaction-{Regular,Italic,Bold}.woff2` | `next/font/local`, preloaded, variable `--font-redaction` |
| Redaction 35/50/70/100 | `app/fonts/redaction/Redaction{35,50,70,100}-Regular.woff2` | `next/font/local`, **`preload: false`** each, variables `--font-redaction-{35,50,70,100}` |

`app/fonts/geist/Geist-Regular.ttf` and `app/fonts/redaction/Redaction-Regular.ttf` exist on disk but are **unused** by the loader (Geist comes from Google Fonts; Redaction only loads the `.woff2` cuts) — likely leftover/vendoring artifacts, worth confirming before porting the fonts directory wholesale.

**Licensing — flag for the manager.** `docs/design/typography.md` documents exact provenance:

> "Assets were copied from `claritylabs-inc/clarity-landing` commit `9e5184f5fa78da52c99be7fc62a8b33fdfece429`."

with a SHA-256 hash per file for all 7 Redaction `.woff2` assets, mapping the upstream `clarity-landing` path to the Spot path. **No explicit license terms are stated anywhere in this repo** — no `LICENSE`/README inside `app/fonts/redaction/`, no "personal use only" language in `AGENTS.md`, `docs/**`, or `.agents/skills/**` (grepped for "license", "personal use", "copyright", "redistribut"). If Redaction is in fact personal-use-licensed (as the task brief suggests), that constraint is **not currently documented in spot** — the manager should check `clarity-landing`'s own history/vendor docs, since this repo only has the copy provenance, not the rights. This is a genuine risk for republishing font binaries inside a shared package (even a private one) if the license doesn't permit redistribution.

## 4. Icons and logo assets

- **lucide-react** (`^0.577.0`) is the shadcn `iconLibrary` and the dominant icon set (~130 files reference it).
- **react-icons** (`^5.6.0`) used in 6 files, mostly for third-party provider/channel logos (`components/model-provider-logo.tsx`, thread/channel renderers, `connections-section.tsx`).
- **simple-icons** (`^16.17.0`) also present, likely paired with `model-provider-logo.tsx` for brand marks.
- Custom icon/logo components (detailed in §5's `components/ui` table): `brand-icon.tsx` (generic dominant-color avatar/logo tile), `logo-icon.tsx` and `spot-wordmark.tsx` (hardcoded Spot brand SVGs — brand/marketing), `org-brand-icon.tsx` (app-specific: calls internal `/api/favicon` route).
- `public/brand/`: `mark.svg`, `spot-lockup.svg`, `spot-lockup-light.svg`, plus `@1x`/`@2x` PNG raster fallbacks for both lockups.
- `public/spot/`: `logo-icon.png`, `hero-clouds-v1.jpg` (marketing hero image, not an icon).
- `scripts/export-spot-brand-assets.mjs` (npm script `brand:export`) suggests brand assets are generated/exported programmatically — worth a look if the migration touches brand asset provenance/pipeline.
- `docs/design/operator-tool-icons.md` documents a closed mapping (`lib/tool-activity-icons.ts`) from the 75 operator MCP tools to Lucide icon categories — this is entirely app-specific (operator/agent domain), not a design-system asset, but is a good example of "icon registry" pattern that could inform a generic icon-mapping utility in the shared package.

## 5. `components/ui/` inventory (49 files)

Primitives are built on **`@base-ui/react`** (not Radix). No `@layer components` CSS backs these — styling is Tailwind utility classes + CVA variants + `typeStyle()`.

| File | What it is | shadcn vs custom | Base UI | Key deps | Coupling | Classification |
| --- | --- | --- | --- | --- | --- | --- |
| `action-surface.tsx` | Clickable bounded row/tile (button or link) | Custom | — | `next/link`, `cn` | `next/link` in the link variant | App-specific (routing) — otherwise generic |
| `address-autofill-input.tsx` | Mapbox-backed US address autofill input | Custom | — | `@mapbox/search-js-react`, env token | Vendor key + US-address-specific logic | App-specific |
| `auto-save-status.tsx` | Floating save-status pill + provider | Custom | — | type import from `@/lib/sync/...` | App's local-first sync layer types; CSS var `--spot-app-bottom-inset` | App-specific |
| `badge.tsx` | Badge | shadcn (base-nova) | `mergeProps`/`useRender` | CVA | — | Generic |
| `brand-icon.tsx` | Dominant-color-sampled avatar/logo tile w/ initials fallback | Custom | — | canvas/Image APIs | none (naming suggests org use, logic is generic) | Generic |
| `button.tsx` | Button | shadcn (base-nova) | `Button` | CVA | — | Generic |
| `command.tsx` | Command palette primitives | shadcn, modified | — (uses `cmdk`) | `cmdk`, `Dialog`, `InputGroup` | — | Generic |
| `dialog.tsx` | Dialog | shadcn (base-nova) | `Dialog` | `Button` | — | Generic |
| `dropdown-menu.tsx` | Dropdown/menu incl. submenu, checkbox/radio items | shadcn (base-nova) | `Menu` | — | — | Generic |
| `empty-state-card.tsx` | Empty-state card w/ icon/CTA | Custom | — | `OperationalPanel`, `PillButton` | Composes two other local components | Generic (bundle dependency) |
| `fade-in.tsx` | Fade/slide-in wrapper, stagger + reduced-motion aware | Custom | — | `framer-motion` | — | Generic |
| `file-download-button.tsx` | Blob-fetch download button w/ toast | Custom | — | `PillButton`, `sonner` | — | Generic |
| `file-drop.tsx` | Drag/drop file picker + `useFileDrop` | Custom | — | — | — | Generic |
| `form-section.tsx` | Section header wrapper | Custom | — | — | — | Generic |
| `hover-card.tsx` | Hover/preview card | shadcn (base-nova) | `PreviewCard` | — | — | Generic |
| `input-group.tsx` | Input group + addon/button/text wrappers | shadcn (base-nova) | — | CVA, `Button`/`Input`/`Textarea` | — | Generic |
| `input.tsx` | Text input | shadcn (base-nova) | `Input` | — | — | Generic |
| `label.tsx` | Form label | shadcn (base-nova) | plain `<label>` | — | — | Generic |
| `logo-icon.tsx` | Spot globe SVG | Custom | — | `lib/spot-mark` (brand constants) | Hardcoded Spot mark | Brand/marketing |
| `markdown-document-editor.tsx` | Tiptap WYSIWYG editor w/ bubble toolbar | Custom | — | `@tiptap/react`, `@/lib/markdown-editor`, `@/components/prose-markdown` | App markdown util + renderer | App-specific |
| `markdown-editor-extensions.ts` | Tiptap extension factory | Custom | — | `@tiptap/*` | — | Generic |
| `markdown-editor.tsx` | Composite editor: doc/source toggle, YAML frontmatter panel | Custom | — | `yaml`, `@/lib/markdown-editor` | App frontmatter model | App-specific |
| `markdown-source-editor.tsx` | CodeMirror raw source + frontmatter decorations | Custom | — | `@uiw/react-codemirror`, `@codemirror/*`, `@/lib/markdown-editor` | App frontmatter model | App-specific |
| `message-meta-tag.tsx` | Expandable icon+count pill (chat metadata) | Custom | — | — | Naming suggests chat feature; logic domain-agnostic | Generic (verify call sites) |
| `operational-panel.tsx` | Panel/header/body/item/label-value family | Custom | — | `Skeleton` | — | Generic ("operational" is house style naming only) |
| `operational-toast.tsx` | Sonner status toast (loading/success/error) | Custom | — | `sonner`, `PillButton`, `Spinner` | Unstyled marker class | Generic |
| `org-brand-icon.tsx` | `BrandIcon` + internal favicon-lookup fallback | Custom | — | `BrandIcon` | Calls app's `/api/favicon` route | App-specific |
| `otp-field.tsx` | OTP/verification code input | Custom wrapper | `OTPFieldPreview` (Base UI **preview** API) | — | — | Generic (flag: unstable upstream API) |
| `pdf-panel.tsx` | Slide-in PDF panel | Custom | — | `framer-motion`, `@/components/pdf-context` | App-level PDF context | App-specific |
| `pdf-viewer.tsx` | Full PDF render/scroll/zoom/nav (618 lines) | Custom | — | `react-pdf`, type import from `pdf-context` | Only a type import ties it to app context | App-specific-leaning-generic |
| `phone-input.tsx` | International phone input w/ country selector | Custom | — (via `Command`/`Popover`) | `react-phone-number-input` | — | Generic |
| `pill-button.tsx` | Product action button — see detailed writeup below | Custom | — | `framer-motion`, `next/link` | `next/link` fast path for internal hrefs | App-specific due to routing; otherwise near-generic — **top parity candidate** |
| `popover.tsx` | Popover | shadcn (base-nova) | `Popover` | — | — | Generic |
| `resizable.tsx` | Resizable panel group | shadcn-style wrapper | — (`react-resizable-panels`, not Base UI) | `react-resizable-panels` | — | Generic |
| `searchable-select.tsx` | Combobox-style searchable select | Custom | `Combobox` | — | — | Generic |
| `select.tsx` | Select | shadcn (base-nova) | `Select` | — | — | Generic |
| `skeleton.tsx` | Loading skeleton | shadcn, trivial | — | — | — | Generic |
| `smooth-corners-provider.tsx` | Mounts the squircle-corner engine | Custom | — | `@/lib/smooth-corners/engine` | Must migrate with the engine module (see below) | Generic (move as a pair) |
| `spinner.tsx` | Spinner icon | Custom, trivial | — | lucide `Loader2Icon` | — | Generic |
| `spot-wordmark.tsx` | Spot wordmark (SVG + text) | Custom | — | `LogoIcon`, `lib/spot-wordmark` | Hardcoded Spot brand asset | Brand/marketing |
| `status-tag.tsx` | Status/progress badge w/ SVG ring; also exports `StatusLabel` | Custom (on `Badge`) | — | CVA, `Badge` | — | Generic |
| `table.tsx` | Table primitives + `TableNameLink` | shadcn (base-nova) + custom addition | plain HTML table | `next/link` (in `TableNameLink` only) | `TableNameLink` is routing-coupled | Mixed: core table generic; `TableNameLink` app-specific |
| `tabs.tsx` | Tabs w/ default/line/pill variants | shadcn (base-nova) | `Tabs` | CVA | — | Generic |
| `tag-remove-button.tsx` | "×" remove button for chips | Custom | — | lucide `X` | — | Generic |
| `text-link.tsx` | Internal/external link w/ arrow, auto-detects target | Custom | — | `next/link`, lucide `ArrowUpRight` | `next/link` for internal hrefs | App-specific (same pattern as PillButton) |
| `textarea.tsx` | Textarea | shadcn (base-nova) | plain `<textarea>` | — | — | Generic |
| `theme-mode-selector.tsx` | Light/Dark/System segmented control | Custom | — | `@/hooks/use-theme` | Depends on app-local hook (hook itself is generic) | App-specific by location only |
| `toaster.tsx` | Configured `sonner` `<Toaster>` | Custom, thin | — | `sonner` | Hardcoded app-layout CSS vars (`--spot-app-bottom-inset` etc.) | App-specific |
| `tooltip.tsx` | Tooltip + provider | shadcn (base-nova) | `Tooltip` | — | — | Generic |

### PillButton — parity deep-dive

`components/ui/pill-button.tsx` is explicitly flagged by the task brief as a likely twin of a `clarity-landing` component. Full detail for cross-repo diffing:

- **Props**: discriminated union — button mode (`type`, no `href`) vs. anchor mode (`href: string` required, `disabled?`). Shared: `variant?: "primary" | "secondary" | "destructive" | "ghost" | "icon" | "iconLabel"` (default `primary`), `size?: "small" | "default" | "compact" | "large"` (default `default`, or inherited from a `PillButtonSizeContext`/`PillButtonSizeProvider`), `roomyOnMobile?: boolean`. A second discriminated union governs content: `{ iconOnly: true; label: string }` (label becomes `aria-label` only) | `{ expandLabel: true; label: string }` (label animates in on hover/focus) | `{ label?: string }`. All standard `HTMLMotionProps` pass through.
- **Not shadcn-derived, not Base UI** — built directly on `framer-motion`'s `motion.button` / `motion.a` / a memoized `motion.create(Link)`.
- **Rendering decision**: `href` + `isInternalAppHref(href)` (starts with `/`, not `//`) + no `download` → renders via Next `<Link prefetch>`; otherwise plain `motion.a` (external/download) or `motion.button`. Disabled anchors get `aria-disabled`/`tabIndex=-1`/`preventDefault` since native `disabled` doesn't exist on `<a>`.
- **Primary variant color** is CSS-var driven (`--pill-primary-bg`/`--pill-primary-fg`, sourced from the `--brand`/`--brand-foreground` tokens, inverted light/dark) with `color-mix()`-based hover/active states — tied to Spot's `--brand` token rather than shadcn's stock `--primary`. This is the detail most likely to differ from a `clarity-landing` twin and worth a byte-level diff.
- **Sizing**: `small`/`default`/`compact`/`large` map through `sizeClasses`/`iconSizeClasses`/`expandableIconSizeClasses`, driven by `typeStyle("control.buttonCompact"|"control.button")`. The "expand label on hover" mechanic uses a CSS grid-template-columns `0fr → 1fr` transition gated by `[@media(hover:hover)_and_(pointer:fine)]` so touch devices never get stuck in a hover state — a distinctive, deliberate interaction worth preserving exactly.
- **House rule**: sizing/typography must never be overridden at the callsite — enforced by the custom ESLint rule `spot/no-pill-button-size-overrides` (see §6). `docs/design/interface-style.md` documents the full sizing contract (28px compact / 32px default / 48px large, 16px horizontal padding, 40px icon-only width, etc.).
- **Fan-out**: imported by ~10+ other files in this inventory (`empty-state-card`, `file-download-button`, both markdown editors, `operational-toast`, `pdf-viewer`, plus most of `components/settings`) — the single most load-bearing component to get right in the shared package.
- **Migration blocker**: the `next/link` fast path. The same problem recurs in `action-surface.tsx`, `table.tsx` (`TableNameLink`), and `text-link.tsx` — recommend solving once (e.g., a router-agnostic `Link`-injection prop or context, mirroring the `render` prop pattern Base UI itself uses) and reusing across all four rather than patching each independently.

### Smooth corners (continuous/squircle corners)

`lib/smooth-corners/engine.ts` (790 lines) + `lib/smooth-corners/plan.ts` (346 lines) form a framework-agnostic DOM engine: it watches the document via `MutationObserver` + resize/transition/animation/pointer listeners, and for every element with a CSS `border-radius` computes and applies a squircle-style `clip-path` (Figma/iOS-style continuous corners), preserving borders/shadows/outlines/transitions, with an opt-out via `data-smooth-corners="off"`. Core geometry math (`generatePath`, `parseBoxShadow`, `parseColor`, `observeResize`) is imported from the already-external **`@lisse/core`** package — this repo's `lib/smooth-corners/` is Spot's DOM-orchestration layer on top of that. `components/ui/smooth-corners-provider.tsx` is a one-effect wrapper that boots/destroys the engine; it's the sole consumer. Zero Convex/auth/domain coupling anywhere in this stack — **strong generic candidate**, but must migrate as a set (`engine.ts` + `plan.ts` + the provider) since the provider has no meaning without the engine module.

The house style guide governs corner-radius usage as vocabulary (`rounded-md`/`lg`/`xl`/`full` for specific surface types) and explicitly says not to add custom clip-paths or opt out of smooth corners without a tested rendering-limitation reason.

## 6. Custom ESLint rules governing UI (`eslint-rules/`)

| Rule | Enforces |
| --- | --- |
| `no-pill-button-size-overrides.mjs` | Bans `className`/style overrides that set size/spacing/typography on `<PillButton>` — it owns its own height/padding/gap/type via `size`/`roomyOnMobile`. |
| `no-untyped-typography.mjs` | Forbids raw Tailwind typography utilities (`text-lg`, `font-bold`, `tracking-*`, `uppercase`, …) and inline typography style props anywhere in JSX/style objects; requires `typeStyle(role)` from `lib/typography.ts`. |
| `require-select-value-label.mjs` | Requires `<SelectValue />` to resolve a real label (`items`, `render`, or explicit children) rather than falling back to a raw option value (a Convex id or snake_case enum) before the popup opens. |

These are component-API-specific guardrails, not generic hygiene rules. For the migration, each needs either an equivalent inside `clarity-ui` (bundled with the component it polices — especially `no-untyped-typography`, coupled 1:1 to `lib/typography.ts`, and `no-pill-button-size-overrides`, coupled to whichever `PillButton` ships) or a documented contract the consuming app must re-register.

## 7. Generic hooks and lib utilities

| File | Purpose | Classification |
| --- | --- | --- |
| `hooks/use-theme.tsx` | Light/dark/system context, localStorage + `prefers-color-scheme`, toggles `.dark` on `<html>` | **Generic** — pairs with `theme-mode-selector.tsx` |
| `hooks/use-tab-param.ts` | Syncs tab selection to `?tab=` via `next/navigation` | Generic-shaped pattern, but hard-wired to Next's router API — needs a navigation adapter to be portable |
| `lib/utils.ts` | shadcn `cn()` (`clsx` + `tailwind-merge`), with a local `extendTailwindMerge` for the custom `tag`/`label` text-size utilities | Generic core helper; the `tag`/`label` extension is Spot-specific and should be parameterized or dropped in the shared version |
| `lib/branding.ts` | `hexToRgb`, `readableTextFor` — color/contrast helpers for brand identity colors | Generic |
| `lib/date-format.ts` | dayjs setup + `DISPLAY_DATE_FORMAT` constants | Generic, no domain leakage |
| `lib/smooth-corners/*` | See §5 | Generic (migrate as a set with the provider) |

Everything else in `hooks/` and `lib/` (org context, presence, operator/impersonation, policy/procurement helpers, Slack integration, thread/prompt helpers, `lib/sync/*` local-first Convex sync layer, chat-presentation `@json-render` catalog) is Convex-, auth-, or domain-coupled and stays in Spot. Notably **`lib/sync/*` is real-time sync infrastructure, not UI** — it should not move to `@claritylabs-inc/ui` even though `components/ui/auto-save-status.tsx` references its types; if anything it's a sibling of the already-referenced `@claritylabs/cl-sync` package.

## 8. Other `components/` directories

Everything outside `components/ui/` is overwhelmingly **app-specific** (Convex queries/mutations, insurance/procurement/broker domain models, operator/agent chat surfaces, Next routing). Full per-directory detail:

- **`components/agent-thread/`** (9 files + `artifacts/`) — thread rendering, message bubbles, tool-activity summaries, per-artifact cards (certificate hold, email, mailbox review/task, vendor compliance). App-specific except two generic-leaning pieces: `agent-thinking-bubble.tsx` (generic loading indicator) and `message-bubble.tsx` (generic bubble shell with one small `channel` enum to strip).
- **`components/ai-elements/prompt-input/`** (13 files) — a **self-contained, fully generic PromptInput kit** (attachments, command menu, submit button, tabs), no Convex imports, mirrors the shape of Vercel's public `ai-elements` package. **Strongest parity candidate in the whole non-`ui/` tree.**
- **`components/app-sidebar/`** (8 files) — mostly app-specific nav wiring; `nav-item.tsx` and `utils.ts` are generic link/menu-item renderer + small hooks.
- **`components/broker-network/`** (2 files) — `broker-activity.tsx` is app-specific (Convex); `token-list-field.tsx` is a fully generic tag/chip input with zero domain coupling.
- **`components/certificates/`**, **`components/policies/`**, **`components/preview/`**, **`components/procurement/`**, **`components/client-files/`** — all deep insurance/procurement/broker/COI domain workspaces (Convex actions/mutations throughout). No parity candidates; stay in Spot entirely.
- **`components/chat-presentation/`** — `@json-render`-driven dynamic UI renderer for agent output; the underlying rendering *technique* is generic but the schema/catalog is Spot's chat/agent domain. `results.tsx` (generic-shell results table) is a weak parity candidate.
- **`components/operator-agent/`**, **`components/operator/`** (+ `workspace-scan/`) — internal operator chat and Google Workspace scan review UI, entirely app-specific. `workspace-scan/scan-query-boundary.tsx` (a retry error boundary) is a weak parity candidate if its copy were genericized.
- **`components/settings/`** (25 files) — a clean split: business/org sections (Convex-coupled, ~17 files) stay; a complete **generic "settings panel" primitive set** is present and a solid parity candidate: `settings-drawer.tsx` (animated slide-in shell), `settings-switch.tsx`, `settings-toggle-row.tsx`, `settings-actions-context.tsx`, `handle-availability.tsx`.
- **`components/shared/`** — `extraction-banner.tsx`, app-specific (business pipeline status), though the underlying toast/progress-banner shell is reusable if abstracted.
- **Top-level loose files in `components/`** (~29 files) — mostly app-specific (auth shell, app-shell, policy/broker workspaces). Generic-leaning standouts worth a second look: `prose-markdown.tsx`, `editable-breadcrumb-title.tsx`, `model-provider-logo.tsx` (brand-agnostic provider-logo mapper), `pdf-context.tsx`, and the `command-palette.tsx` shell (list content is app-specific, shell may not be).

## 9. Parity candidates (likely twins in `clarity-landing`)

Ranked by confidence/impact for the cross-repo diff:

1. **`components/ui/pill-button.tsx` (PillButton)** — explicitly named in the task brief; see detailed writeup in §5. Highest-value diff: primary-variant `--brand`-token color logic, the expand-on-hover grid animation, and the `next/link` internal-routing fast path.
2. **`lib/typography.ts` (`typeStyle` role registry)** — the semantic-typography pattern itself, plus the closed role list, is exactly shared-design-system material; `docs/design/typography.md` already documents a provenance link to `clarity-landing` (Redaction fonts copied from there at a specific commit), strongly suggesting `clarity-landing` has its own related typography system to diff against.
3. **Redaction font family** — see §3 licensing flag; `clarity-landing` is the canonical source (commit `9e5184f5fa78da52c99be7fc62a8b33fdfece429`), so the twin comparison here is really "what does the source repo say about license/usage" rather than a design diff.
4. **`components/ai-elements/prompt-input/*`** (13 files) — a complete generic AI prompt-input kit; check whether `clarity-landing` (or another Clarity Labs product) has the same or a differently-shaped version.
5. **shadcn base primitives** (`button`, `dialog`, `dropdown-menu`, `select`, `popover`, `tabs`, `tooltip`, `hover-card`, `badge`, `input`, `textarea`, `label`, `input-group`, `command`) — since both repos are said to already be on shadcn + Base UI + Tailwind v4, these are near-certain to have twins generated from the same `base-nova` style; diffing should focus on **local modifications** layered on top of the shadcn baseline (Spot's `select.tsx` adds a `size` prop, `table.tsx` adds `TableNameLink`, `dialog.tsx` adds `showCloseButton`, etc.) rather than the primitives themselves.
6. **`TextLink`, `TableNameLink`, `ActionSurfaceLink`** (`text-link.tsx`, `table.tsx`, `action-surface.tsx`) — all three share the same `next/link`-coupling pattern as PillButton; worth checking if `clarity-landing` solved link-abstraction differently.
7. **Logos/wordmarks** (`logo-icon.tsx`, `spot-wordmark.tsx`, `public/brand/*`) — brand/marketing category; `clarity-landing` almost certainly has its own Clarity Labs wordmark/logo componentry to compare structurally (SVG-path-as-constant pattern, `LogoIcon` composition) even though the actual marks differ.
8. **Generic settings-panel kit** (`settings-drawer.tsx`, `settings-switch.tsx`, `settings-toggle-row.tsx`, `settings-actions-context.tsx`, `handle-availability.tsx`) — a complete, self-contained primitive family; worth checking for an equivalent in the other repo's settings/account UI.
9. **`token-list-field.tsx`** (tag/chip input), **`brand-icon.tsx`** (dominant-color avatar tile), **`operational-panel.tsx`** family, **`empty-state-card.tsx`**, **`status-tag.tsx`** — smaller but zero-domain-coupling generic primitives worth a quick cross-check.
10. **Smooth-corners engine** (`lib/smooth-corners/*` + `smooth-corners-provider.tsx`, built on `@lisse/core`) — check whether `clarity-landing` uses the same `@lisse/core` dependency or a different squircle-corner approach; if both repos already depend on `@lisse/core`, this is an easy, low-risk first extraction.

## 10. Migration notes / things that will break if moved naively

- **Routing coupling.** `PillButton`, `TextLink`, `TableNameLink`, and `ActionSurfaceLink` all branch on `next/link` internally. A shared package used by both Next apps needs one consistent abstraction (injectable `Link` component/context, or drop the internal-link fast path entirely and let each app wrap it) — solve once, apply to all four.
- **`smooth-corners-provider.tsx` has no meaning without `lib/smooth-corners/engine.ts` + `plan.ts`.** These three files must move together (or the provider needs to accept the engine as a dependency).
- **Typography split.** `lib/typography.ts` mixes a generic role-engine pattern with Spot-specific values and non-role brand contracts (OG image, Mapbox adapter). The migration should separate "the `typeStyle` mechanism" (generic) from "Spot's specific 28-role palette" (app theme layer) — otherwise every consumer of `clarity-ui` inherits Spot's exact type scale.
- **CSS variable contract, not literal values.** Nearly every `components/ui/*` file is token-driven (`bg-background`, `border-input`, etc.) rather than hardcoded, which is good — but `pill-button.tsx`'s primary variant explicitly reads `--brand`/`--brand-foreground` (Spot-specific naming) rather than shadcn's stock `--primary`/`--primary-foreground`. Any shared package needs to standardize which token names are "the contract" vs. which are app-supplied.
- **Base UI, not Radix.** All shadcn-style primitives in this repo use `@base-ui/react` imports (`@base-ui/react/button`, `/dialog`, `/menu`, `/select`, `/tabs`, `/tooltip`, `/popover`, `/preview-card`, `/combobox`, and the **preview** `otp-field`). If `clarity-landing` generated its shadcn components against Radix instead (older shadcn default) or a different Base UI version, the "near-identical, diverges" components (like PillButton) may sit on structurally different foundations even where they look the same — verify `clarity-landing`'s `components.json` `style` field before assuming a straight merge.
- **`@base-ui/react/otp-field` is a "preview" API** (`OTPFieldPreview`) per its own export name — flag as an upstream-stability risk before shipping it in a public-facing shared package.
- **Server/client boundaries.** None of the `components/ui/*` files were seen with explicit `"use client"` directives during this pass (they're consumed from client-rendered app trees); shadcn's `rsc: true` in `components.json` implies RSC-awareness is expected. The migration should audit which primitives need `"use client"` once extracted into a package boundary (Next's `transpilePackages` does not itself add the directive — it must be authored in the package source).
- **CSS layering.** `app/globals.css` imports `shadcn/tailwind.css` and `tw-animate-css` and defines `@theme inline` locally; a consuming app importing `clarity-ui`'s CSS will need equivalent `@import`/`@theme` layering order preserved (Tailwind v4 cascade layers are order-sensitive), plus the two Spot-only unused-looking classes (`no-scrollbar`, `spot-operational-toast`) resolved one way or another.
- **`framer-motion` + `motion` both present.** Worth consolidating before/during extraction so the shared package doesn't ship two animation runtimes.
- **Import-path rewrites.** Every `@/lib/typography`, `@/lib/utils`, `@/components/ui/*` import becomes a package import (`@claritylabs-inc/ui/typography`, etc.) — the `components.json` `aliases` block and `tsconfig.json`'s single `@/*` root alias are Spot-repo-local conventions that won't survive publication as-is.
- **No existing showcase/tests to carry over.** No Storybook, no `*.stories.tsx`, no visual regression harness exists for any of this — the new package starts from zero on that front; `docs/design/interface-style.md` and `docs/design/typography.md` are the closest things to living documentation and are strong candidates to adapt into the new package's README/guidelines rather than write from scratch.
