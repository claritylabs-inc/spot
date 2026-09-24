# Sharing Spot's UI components with the admin portal — proposal

Status: discovery/proposal only. No behavior changes in this repo. This
document is the output of investigating both `claritylabs-inc/spot` (this
repo) and `claritylabs-inc/clarity-landing` (`apps/admin`, `apps/company`,
`apps/spot`, `packages/ui`).

## Recommendation up front

**Extract `packages/ui` inside this repo (Spot) as an npm workspace, and
publish it to the public npm registry as `@claritylabs/spot-ui`.** This is
option (a) from the brief, with one refinement: publish to `registry.npmjs.org`
under the existing `@claritylabs` scope rather than to GitHub Packages. Spot
is already a **public** GitHub repo (`gh repo view` confirms
`visibility: PUBLIC`), so publishing its component source to public npm adds
no new exposure — the source is already readable today. Clarity Labs already
publishes `@claritylabs/cl-sdk`, `@claritylabs/cl-pipelines`, and
`@claritylabs/cl-sync` to public npm this same way, so this follows existing
precedent instead of introducing a new distribution mechanism. `apps/admin`
(and any future internal tool) then installs `@claritylabs/spot-ui` like any
other dependency — no GitHub Packages `.npmrc`/`NPM_TOKEN` plumbing needed on
Vercel or CI.

Rationale in one paragraph: `components/ui/` is already cleanly decoupled
(zero Convex/router/auth imports found anywhere in it), Spot and
clarity-landing already run the same major versions of Next/React/Tailwind,
both already standardize on `@base-ui/react` as the headless primitive layer,
and Clarity Labs already has a working "publish an internal `@claritylabs/*`
package to public npm" pipeline. Copy-in (option d) is not new territory
either — it's already how Redaction fonts moved from clarity-landing into
Spot (see `docs/design/typography.md`'s provenance table) and how
clarity-landing's own `packages/ui` acquired hand-copied versions of
`SpotWordmark`, `PillButton`, `ThemeModeSelector`, and `PhoneInput` — and
those copies have already drifted from Spot's originals, which is the
argument *against* extending that pattern further.

## Current state: Spot's UI system

Spot is a single Next.js app (no existing monorepo/`packages/*` layout).
Key versions: Next 16.2.9, React 19.2.3, TypeScript ^5, Tailwind v4.

- **shadcn config** (`components.json`): style `base-nova`, `baseColor:
  neutral`, `iconLibrary: lucide`, CSS-variable theming, RSC+TSX on. The
  headless primitive library is **`@base-ui/react` (^1.4.1)**, not Radix —
  this codebase has fully migrated off `@radix-ui/*` (confirmed absent from
  `package.json`). `cmdk` (^1.1.1) is the one non-Base-UI headless dep still
  used directly, for the command palette.
- **`components/ui/`** has 49 files. Grepping the whole directory for
  `convex/react`, `useQuery`/`useMutation`, `next/navigation`/`useRouter`,
  and auth/i18n/feature-flag hooks returns **zero matches** — every file is
  props-in/callbacks-out. Breakdown:
  - **Pure primitive wrappers** (Base UI/cmdk + `cva` variants +
    `typeStyle()`): `button`, `badge`, `input`, `textarea`, `label`, `select`,
    `dialog`, `popover`, `tooltip`, `hover-card`, `dropdown-menu`, `tabs`,
    `command`, `table`, `skeleton`, `spinner`, `resizable`, `otp-field`,
    `toaster`, `input-group`.
  - **Composite/derived, still generic**: `status-tag`, `empty-state-card`,
    `operational-panel` (Spot's "Card" — there is no separate `card.tsx`),
    `operational-toast`, `pill-button` (318 lines, `framer-motion`-animated,
    used in place of `Button` in most of the app), `form-section`,
    `message-meta-tag`, `text-link`, `action-surface`, `tag-remove-button`,
    `fade-in`, `file-drop`, `searchable-select`, `theme-mode-selector`,
    `auto-save-status`.
  - **App-specific — do not extract**: `phone-input` (react-phone-number-input,
    Spot-styled), `address-autofill-input` (Mapbox), the markdown editor
    suite (`markdown-editor*`, Tiptap/CodeMirror — Spot's policy-document
    editor), `pdf-viewer`/`pdf-panel` (618 lines, `react-pdf`, tied to
    `components/pdf-context.tsx`), `file-download-button`, `brand-icon`/
    `org-brand-icon` (fetches a client org's branding), `logo-icon`/
    `spot-wordmark` (Spot's own brand marks), `smooth-corners-provider`
    (bespoke squircle CSS engine).
  - **Notable gaps** vs. a typical shadcn set: no `card.tsx` (filled by
    `operational-panel.tsx`), no `sheet`/`drawer` primitive (drawers are
    hand-rolled per feature, no `vaul` dependency), no `avatar.tsx`, no
    `switch.tsx` in `ui/` (one exists but is product-scoped under
    `components/settings/`).
  - `components/shared/` is nearly empty (one Spot-specific file).
    `components/ai-elements/prompt-input/` is a well-factored, genuinely
    reusable AI-chat-input subsystem built on `components/ui/` primitives —
    a good *future* extraction candidate, but not needed for admin's current
    scope (no chat surface requested), so it's left out of the v1 boundary.
- **Design tokens** (`app/globals.css`, 375 lines): Tailwind v4
  (`@import "tailwindcss"`), `tw-animate-css`, `@import "shadcn/tailwind.css"`
  (from the `shadcn` npm devDependency), `@tailwindcss/typography`. Class-based
  dark mode (`@custom-variant dark (&:is(.dark *))`, driven by
  `hooks/use-theme.tsx`'s localStorage/`matchMedia` logic — no Convex
  involved). Two token blocks (`:root`, `.dark`) feed a Tailwind v4
  `@theme inline` block mapping `--color-*` utilities to CSS custom
  properties (standard shadcn-v4 pattern) — components reference semantic
  classes (`bg-background`, `text-primary`, …), never literal colors.
  Notable: `--brand`/`--brand-foreground` is Spot's own concept (pure
  black/white, inverts in dark mode, used for primary CTAs) *separate* from
  `--primary` (blue, `#2a97ff`) — a shared package needs to treat `--brand`
  as Spot-specific, not assume every consumer wants a monochrome CTA. Radius
  is a proportional scale off one `--radius` base (generic). Motion tokens
  (`--motion-fast/medium/slow`, easing) are generic. `status-tag.tsx`
  hardcodes a sky-blue "info" color that bypasses the token system — worth
  fixing during extraction, not before.
- **Typography** is a closed semantic system: `lib/typography.ts` exports
  `typeStyle(role)` mapping role names (`heading.page`, `body.default`,
  `control.button`, …) to Tailwind class strings; nearly every file in
  `components/ui/` imports it. It has to move with `components/ui/` — it's a
  hard dependency, not a nice-to-have. `docs/design/typography.md` and
  `docs/design/interface-style.md` are the existing style-guide prose that
  should ship alongside the package (or be linked from its README).
- **Fonts**: Geist/Geist Mono via `next/font/google`. Redaction (Spot's
  brand display serif) is self-hosted via 5 `next/font/local` calls, and is
  explicitly a **licensed brand asset** — `docs/design/typography.md`
  documents its provenance as copied from a specific clarity-landing commit
  with SHA-256 hashes per file. This is the existing precedent for
  cross-repo asset copying, just running in the opposite direction from what
  this proposal does for components.
- **No existing `packages/*` or npm-workspace layout** in this repo, and no
  `.npmrc`/registry config anywhere. `@claritylabs/cl-sdk` (currently pinned
  to an exact `4.6.0`, enforced by `scripts/check-shared-package-versions.mjs`
  across root + `extraction-worker`) resolves from
  `registry.npmjs.org` per `package-lock.json`, confirming Clarity Labs
  already publishes `@claritylabs/*` packages to **public** npm, not GitHub
  Packages.

## Current state: clarity-landing / apps/admin

`clarity-landing` is a private, npm-workspaces + Turborepo monorepo
(`"workspaces": ["apps/*", "packages/*"]`, `turbo run <script>` scripts).
Apps: `admin`, `company`, `spot`. There is already a **`packages/ui`**
workspace package (`@repo/ui`, version `0.0.0`, private, consumed via the
`"*"` workspace protocol by `apps/company` and `apps/spot`, but **not** by
`apps/admin`).

- `packages/ui` depends on `@base-ui/react ^1.8.0` (newer minor than Spot's
  `^1.4.1` — see Risks), `cmdk ^1.1.1`, `react-phone-number-input`,
  `flags`/`@flags-sdk/vercel`. Its components skew marketing-site-flavored
  (`AnnouncementBanner`, `Footer`, `PageTree`, `ShowcaseRobot`, `Logo`) —
  not admin-portal primitives (no `Button`, `Dialog`, `Table`, `Tabs`, etc.
  exist there today).
- It already contains **manually copied, drifted** versions of some Spot
  components: `SpotWordmark.tsx`, `PillButton.tsx`, `ThemeModeSelector.tsx`,
  `PhoneInput.tsx`. Diffing `SpotWordmark.tsx` in both repos confirms real
  drift — different prop signatures, no `typeStyle()` usage, no `cn()`
  helper. This is concrete evidence that ad hoc copying has already produced
  divergence, which argues against formalizing copy-in as the long-term
  strategy.
- `apps/admin/package.json`: `next ^16.2.4`, `react`/`react-dom ^19.2.5`,
  plus `convex` and `jose` — essentially the same Next/React majors as Spot
  (patch-level skew only). Root devDependencies show `typescript ^6.0.3`
  and `tailwindcss ^4.2.4` (Tailwind major matches Spot; TypeScript major is
  one ahead — see Risks).
- `apps/admin` today is genuinely hand-rolled: `src/components/` has exactly
  four files (`Header.tsx`, `Nav.tsx`, `ConfirmSubmit.tsx`,
  `CopyButton.tsx`), all plain Tailwind utility classes, no headless lib, no
  design tokens beyond a minimal `globals.css`. Its `globals.css` contains an
  explicit, deliberate comment worth reproducing in full, since it directly
  conflicts with the new ask and needs to be reconciled, not silently
  overridden:

  > This is an internal tool, not a marketing surface — it deliberately does
  > not share apps/company/apps/spot's brand token system (Redaction, brand
  > blue, etc). Plain, dense, functional: Geist and a neutral gray scale
  > only.

  The token/theming strategy below is designed specifically to satisfy both
  the owner's new request (reuse Spot's components) and this prior,
  deliberate decision (don't force Spot's brand *values* onto an internal
  tool) — they aren't actually in conflict if components and tokens are
  separated.
- Admin's actual surface area today: a `(shell)` layout with `Nav`/`Header`,
  and one `content` module with three routes — `overview`, `files`
  (a `[...path]` file browser), `activity`, and `tokens` (an
  `IssueTokenForm`). This matches the brief's description: sidebar nav,
  header with user, a data table (files), a form (issue token), confirm
  dialogs (`ConfirmSubmit`), copy buttons (`CopyButton`). Small surface
  today, but the owner's ask is about the *next several* internal tools
  sharing one system, not just this one.

## Coupling analysis

- **Portable as-is (extract verbatim):** all of `components/ui/*`,
  `lib/utils.ts` (`cn()`), `lib/typography.ts` (`typeStyle`/role registry),
  `hooks/use-theme.tsx`, `hooks/use-page-context.tsx`,
  `hooks/use-entity-preview.tsx`, `components/pdf-context.tsx` (only if the
  PDF viewer moves too — not required for admin's current scope),
  `components/app-shell-sidebar-layout.tsx`, and the token contract in
  `app/globals.css` (the `:root`/`.dark`/`@theme inline` shape, not
  necessarily Spot's literal values — see Theming). Also relocate
  `useMediaQuery` out of `components/app-sidebar/utils.ts` into `hooks/` —
  it's fully generic and misplaced.
- **Needs light parameterization:**
  - `components/app-shell-panel-layout.tsx` — one hardcoded
    `"spot:app-shell-panels:${storageUserId}"` localStorage key prefix;
    make the prefix a prop.
  - `components/app-top-bar.tsx` — imports `usePathname()` (fine if the
    consumer is Next.js too) and a fully hardcoded `BREADCRUMB_MAP` of
    Spot's route tree; needs to accept a `breadcrumbMap`/resolved-crumb prop
    instead.
  - `components/auth-shell.tsx` — `AuthCard`/`AuthMinimalShell` are already
    generic (`logo`/`title`/`subtitle`/`children` props); only
    `BrandWordmark`/`PoweredBySpotWordmark` hardcode `SpotWordmark` and
    should either stay unexported or take a `wordmark: ReactNode` prop.
  - `components/app-shell.tsx` — already has a `customSidebar` escape
    hatch (the right pattern); needs the same treatment for
    `CommandPalette`, `OperatorAgentPanel`, and `OperatorImpersonationBanner`
    (make them optional injected slots instead of hardwired imports) before
    the shell itself is reusable.
- **Fundamentally Spot-specific — stay behind:**
  `components/command-palette.tsx` (Convex agent threads, "Ask Spot"),
  `components/notifications-panel.tsx` (Convex queries/mutations),
  `components/auth-guard.tsx` (Spot's full boot-state machine),
  `components/auth-entry-page.tsx` (Spot's login/OTP flow),
  `components/app-sidebar.tsx` + `components/app-sidebar/nav-config.tsx`
  (Spot's nav tree — `AppShell`'s `customSidebar` prop means admin doesn't
  need this at all), `hooks/use-current-org.tsx`, `hooks/use-presence.ts`,
  `hooks/use-start-agent-thread.ts`,
  `hooks/use-start-operator-impersonation.ts`/`use-stop-operator-impersonation.ts`,
  the markdown editor suite, `pdf-viewer`/`pdf-panel`,
  `address-autofill-input` (Mapbox), `brand-icon`/`org-brand-icon`,
  `smooth-corners-provider`, `components/shared/extraction-banner.tsx`, and
  every product-feature directory (`settings/`, `procurement/`,
  `broker-network/`, `certificates/`, `client-files/`, `policies/`,
  `operator*/`, etc).

The boundary is clean: **every** Convex/router/auth-coupled import in the
codebase lives *outside* `components/ui/` already. That's the main reason
this extraction is lower-risk than it might sound.

## Options considered

**(a) Extract `packages/ui` in the Spot repo, publish to npm.**
Pros: source stays alongside the app that originates it, so Spot's own
churn drives the package naturally; consuming from Vercel/CI is a plain
`npm install`, zero special auth if published publicly; matches the
existing `@claritylabs/cl-sdk` precedent exactly. Cons: requires setting up
a workspace + build/publish pipeline in a repo that doesn't have one today;
Spot's own imports need to be repointed at the new package (or kept on the
workspace protocol locally — see below) so there's some one-time churn.
Effort: medium.

**(b) Move the UI library into its own repo.**
Pros: cleanest ownership boundary; a third repo can be versioned/reviewed
independently of both Spot and clarity-landing. Cons: today's `components/ui/`
is not actually shared by anyone yet — creating a whole new repo, CI, and
release process for a package with exactly one real producer (Spot) and one
initial consumer (admin) is premature process overhead. Revisit this once
a second producer repo exists. Effort: medium-high, mostly process/plumbing,
not code.

**(c) Git submodule / subtree.**
Pros: no registry, no publish step, always-current source. Cons: submodules
are a well-known DX tax (detached-HEAD footguns, easy to forget to update,
opaque in `git status` for most engineers); subtree avoids the detached-HEAD
problem but makes history noisy and still requires a manual sync step with
no versioning signal (a consumer can't pin "the version of the UI I tested
against"). Neither gives clarity-landing's Vercel builds a clean, reviewable
dependency bump (it'd be a submodule-pointer or subtree-merge commit instead
of a `package.json` diff). Effort: low to set up, ongoing tax in practice.

**(d) Copy-in with a sync script (shadcn-style).**
Pros: matches how the Redaction font assets already moved between these two
repos, and how `packages/ui`'s existing Spot-derived components got there in
the first place; no registry/publish infrastructure at all. Cons: this
proposal's own investigation found the drift this pattern already produced
(`SpotWordmark`/`PillButton`/`ThemeModeSelector`/`PhoneInput` in
clarity-landing no longer match Spot's originals) — that's not hypothetical
risk, it's the observed current state. A sync script reduces but doesn't
eliminate drift (it still requires someone to remember to run it, and local
edits at the destination silently diverge again on the next sync unless the
script diffs and refuses to overwrite). Effort: low to start, but it's the
option most likely to recreate the exact problem this proposal exists to fix.

**Recommendation: (a).** It's the only option that gives clarity-landing a
reviewable, pinned, semver-versioned dependency (a `package.json` diff, not
a submodule pointer or a silent copy), reuses Clarity Labs' existing
publish-to-public-npm pattern instead of inventing a new one, and doesn't
require standing up a new repo for a library with one current producer.

## Package boundaries

**Moves into `packages/ui`** (new workspace member in this repo):
`components/ui/*` (all ~49 files, minus the ones flagged app-specific
above, which stay in `components/`), `lib/utils.ts`, `lib/typography.ts`,
`hooks/use-theme.tsx`, `hooks/use-page-context.tsx`,
`hooks/use-entity-preview.tsx`, `useMediaQuery` (relocated from
`components/app-sidebar/utils.ts`), `components/app-shell-sidebar-layout.tsx`,
`components/app-shell-panel-layout.tsx` (parameterized), `components/app-top-bar.tsx`
(parameterized), `components/auth-shell.tsx` (parameterized), and the design
token *contract* (CSS variable names + `@theme inline` mapping) extracted
from `app/globals.css`, shipped as a base/neutral theme with Spot's actual
brand values (Redaction font, `--brand` black/white, blue `--primary`) kept
as an optional, separately-imported theme layer rather than baked into the
package defaults.

**Stays in the Spot app:** everything else, notably `app-shell.tsx` (glues
Spot-specific pieces onto the shell primitives), `app-sidebar*`,
`command-palette.tsx`, `notifications-panel.tsx`, `auth-guard.tsx`,
`auth-entry-page.tsx`, the markdown editor suite, `pdf-viewer`/`pdf-panel`,
`address-autofill-input`, `brand-icon`/`org-brand-icon`,
`smooth-corners-provider`, and all product-feature directories.

## Token/theming strategy

The package should export the **token contract**, not just Spot's literal
values: a documented list of the CSS custom properties components read
(`--background`, `--foreground`, `--primary`, `--border`, `--radius`, the
motion tokens, etc.) plus the Tailwind v4 `@theme inline` block that maps
them to utility classes. Components only ever reference the semantic
Tailwind classes (`bg-background`, `text-primary`) — never a literal hex —
so this is already true of the code today; the work is packaging the
contract separately from Spot's specific `:root`/`.dark` value blocks.

Ship two things from the package: (1) the contract/mapping CSS (required),
and (2) Spot's actual theme values as an optional importable file
(`@claritylabs/spot-ui/theme/spot.css`, or similar). `apps/admin` then
authors its **own** `:root`/`.dark` block satisfying the same contract —
its own "TfE variant" — instead of importing Spot's. This directly
reconciles the new request with admin's existing "we deliberately don't
share the brand token system" decision: admin gets Spot's *components*
(buttons, dialogs, tables, tabs — the actual engineering value) without
being forced into Spot's *brand* (blue primary, monochrome brand CTA,
licensed Redaction font). `--brand`/Redaction specifically should be
optional inputs with the existing Georgia/system-font fallback chain, so
admin never needs to license or ship the Redaction font files at all.

## Versioning, release flow, and how Spot keeps consuming without churn

Add `"workspaces": ["packages/*"]` to this repo's root `package.json` and
move the extracted code into `packages/ui`. Inside this repo, Spot's own
app code keeps importing the workspace package by its published name
(`@claritylabs/spot-ui`) resolved via the npm workspace `"*"`/`workspace:*`
protocol — so **local Spot development always sees the current source
instantly, with no publish/install round-trip**, exactly like
clarity-landing's own `packages/ui` → `apps/company`/`apps/spot` today.

For the package internals, recommend shipping **source, not a compiled
build**: `main`/`exports` point at the TSX entry points directly, and
consumers (both `apps/admin` and, if ever needed, non-Spot repos) add
`transpilePackages: ["@claritylabs/spot-ui"]` to their `next.config.ts`.
Every current and prospective consumer is Next.js, so this avoids standing
up a `tsup`/build step entirely and keeps published-package churn to "bump
the version" rather than "bump the version and debug a build output diff."

External publish (for clarity-landing to consume) is a real semver release:
a GitHub Actions workflow (new — this repo has no publish workflow today,
only `ci.yml`/`deploy-convex.yml`/`agent-safeguards.yml`) triggered on
`packages/ui/**` changes landing on `main`, bumping per conventional-commit
or manual version bump, then `npm publish --access public`. No `NPM_TOKEN`
is needed for *installing* (public registry), only for the CI job that
publishes — a standard npm automation token as a GitHub Actions secret in
this repo only. `apps/admin`'s Vercel project and clarity-landing's CI need
zero new configuration to *consume* it — `npm install @claritylabs/spot-ui`
works the same as any other public dependency, same as `@claritylabs/cl-sdk`
today.

## Auth for installing on Vercel/CI

Because the recommendation is public npm (not GitHub Packages), there is
**no** registry auth to configure on the consuming side. If Clarity Labs
later decides the package should be private instead (e.g. if it grows to
include more proprietary product design than components), note one
concrete gotcha before choosing GitHub Packages: GitHub's npm registry
requires the package scope to match the **GitHub** org/user
(`@claritylabs-inc`, since the org is `claritylabs-inc`), not the npm-only
scope Clarity Labs already publishes under (`@claritylabs`, used by
`cl-sdk`/`cl-pipelines`/`cl-sync`). Going private would mean either a
scope inconsistent with existing published packages, or moving the existing
public packages too — worth deciding deliberately rather than defaulting
into it. The private path would also require an `.npmrc` with a
`//npm.pkg.github.com/:_authToken=${NPM_TOKEN}` line committed to both repos
and an `NPM_TOKEN`/`GITHUB_TOKEN` with `read:packages` set as a Vercel
project env var and a CI secret in clarity-landing — real, ongoing
infrastructure that the public-npm recommendation avoids entirely.

## Packet breakdown (rough sizing)

1. **Extraction in Spot** (this repo): create `packages/ui` workspace, move
   ~49 `components/ui/*` files + `lib/utils.ts` + `lib/typography.ts` +
   the generic hooks, parameterize `app-shell-panel-layout`/`app-top-bar`/
   `auth-shell`, split the token contract from Spot's theme values, repoint
   Spot's own imports, verify build/lint/E2E pass. **Medium, ~3–5 days.**
2. **Publishing pipeline**: registry decision (recommend public npm),
   package.json metadata, README documenting the token contract, new GitHub
   Actions publish workflow, first tagged release. **Small, ~1–2 days.**
3. **Adoption in `clarity-landing/apps/admin`**: add the dependency +
   `transpilePackages`, author a TfE theme file satisfying the token
   contract, replace `Header`/`Nav`/`ConfirmSubmit`/`CopyButton`/
   `IssueTokenForm` with shared primitives (button, dialog for confirm,
   table for the file browser, form-section/input for the token form),
   decide whether/how to reconcile `packages/ui`'s existing drifted
   Spot-derived components. **Medium, ~3–5 days.**

Total: roughly two to three weeks of focused work spread across both repos,
including review — not a single continuous block.

## Risks

- **`@base-ui/react` version skew**: Spot pins `^1.4.1`, clarity-landing's
  `packages/ui` already depends on `^1.8.0`. Base UI is a young library with
  API movement between minors; the shared package's peer dependency range
  needs explicit testing against both, not an assumption that "same major"
  is enough.
- **TypeScript major skew**: Spot is on `typescript ^5`, clarity-landing's
  root is on `^6.0.3`. Should be fine for consuming compiled `.d.ts`/source
  types in practice, but hasn't been verified here — check as part of the
  extraction packet, not after.
- **Server/client component boundaries**: every sampled `components/ui/*`
  primitive already has `"use client"` (confirmed for `button`, `dialog`,
  `tabs`, `select`) since Base UI primitives are inherently interactive.
  The package needs to preserve these directives so RSC boundaries resolve
  correctly in both consumers' App Router trees.
- **CSS layering conflicts**: both repos use the Tailwind v4 `@theme inline`
  pattern. If the shared package's token contract and a consumer's own
  `globals.css` both declare the same `--color-*` name with different
  values without a clear "package owns the seam, host app supplies values"
  contract, results will be non-deterministic based on import order. The
  theming strategy above is designed to avoid this, but it needs to be
  documented and enforced (e.g. a lint rule or at minimum a clear README),
  not just assumed.
- **Existing drift in `clarity-landing/packages/ui`**: `SpotWordmark`,
  `PillButton`, `ThemeModeSelector`, and `PhoneInput` already exist there as
  hand-copied, diverged versions. Adopting `@claritylabs/spot-ui` in
  `apps/admin` doesn't automatically fix that — `apps/company`/`apps/spot`
  would need a deliberate, separate follow-up to migrate off the drifted
  copies onto the new package, which is real but out-of-scope work for this
  proposal.
- **`framer-motion` + `motion` both installed** in Spot's `package.json` —
  not blocking, but worth resolving before or during extraction so the
  shared package doesn't ship a redundant animation dependency.

## Open questions

1. Does the owner want `apps/company`/`apps/spot` (clarity-landing's other
   two apps) migrated onto `@claritylabs/spot-ui` too, retiring the drifted
   components in `packages/ui`, or should that stay a separate, later
   decision?
2. Should the published package name be `@claritylabs/spot-ui` (matches
   existing npm scope precedent) or something else — the brief's working
   name "`@claritylabs-inc/spot`" doesn't match either existing convention
   (`@claritylabs/*` on npm, `claritylabs-inc` as the GitHub org)?
3. Is there any appetite for eventually merging Spot's `docs/design/*.md`
   style guide into the published package's docs, so admin-portal
   contributors have the same "must/should/may" rules Spot's does?
4. Who owns ongoing maintenance of the extracted package once it has two
   consumers — does it stay under Spot's existing CI/release cadence, or
   does it need its own on-call/ownership model?
