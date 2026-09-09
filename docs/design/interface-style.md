# Spot interface style guide

This guide is the visual contract for Spot browser product surfaces. It puts
the existing design system into clear rules so new work stays formal, quiet,
and consistent. It applies to the signed-in app, auth, onboarding, and shared
browser components. Transactional email, generated images, PDFs, and marketing
pages have separate rendering needs.

The words **must**, **should**, and **may** are intentional:

- **Must** is a system requirement.
- **Should** is the default; depart from it only for a clear product reason.
- **May** describes an allowed option, not a new default.

## Character

Spot is a dense operational product, not a collection of promotional cards.
The interface should feel calm, precise, and trustworthy.

- Put the user's next decision or action first.
- Build hierarchy with layout, type, and whitespace before adding decoration.
- Keep persistent surfaces flat. Use subtle borders instead of shadows.
- Prefer sections, panes, rows, and tables to a grid of unrelated cards.
- Use color to communicate action, status, or brand identity, not to decorate.
- Remove labels, badges, icons, and helper text that repeat nearby information.

## Operator portal composition

The operator portal is a compact working surface. Its app-shell breadcrumb is
the page identity, so route content must not repeat that title or add a page
subtitle. Persistent status tags belong in the overview or active-tab body.

- Use `TabsList variant="pill"` for route-level operator tabs.
- Do not repeat the active tab name in a panel header or add a card subtitle
  that only explains the tab.
- Present record facts with `OperationalLabelValueList` and
  `OperationalLabelValueRow`. Avoid asymmetric multi-column or jigsaw detail
  layouts. When a record mixes short facts with long prose, group the compact
  value pairs in the first card and the long-form rows in a separate card
  below.
- Keep overview tables focused on the few fields needed to identify, compare,
  and prioritize records. When selecting a row can open a right-side preview,
  move summaries, identifiers, secondary counts, links, and other record
  details into that panel instead of packing them into table cells.
- Table rows display data and open a sidebar, with keyboard navigation. Never
  place action buttons, action menus, edit controls, or dropzones in rows.
  Editing and uploads live in the sidebar; record actions live in its footer.
- Omit sidebar headings when filenames or controls already identify the
  section. Separate groups with spacing and subtle dividers. Show upload and
  extraction progress in toasts, never as notes in or below a dropzone.
- Broker and client selectors show `OrgBrandIcon` beside each option and the
  selected company name. `SearchableSelect` supports an optional option icon;
  keep the company name as the searchable and accessible text.
- Give a request-specific forwarding address its own bounded value-pair card,
  separate from imported message rows.
- Name navigation actions for a specific destination. Omit vague labels such
  as “All client email.”

## System owners

Use the shared owner before writing a local version of the same pattern.

| Concern                                         | Owner                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| Theme and color tokens                          | `app/globals.css`                                                                    |
| Typography roles                                | `lib/typography.ts` and [typography.md](./typography.md)                             |
| Persistent grouped content                      | `components/ui/operational-panel.tsx`                                                |
| Clickable bounded rows or tiles                 | `components/ui/action-surface.tsx`                                                   |
| Generic self-contained content card (exception) | `components/ui/card.tsx`                                                             |
| Product action buttons                          | `components/ui/pill-button.tsx`                                                      |
| Inputs and selection controls                   | `components/ui/input.tsx`, `textarea.tsx`, `select.tsx`, and `searchable-select.tsx` |
| Tabs, tables, dialogs, and popovers             | Matching primitives under `components/ui/`; operator route tabs use the pill variant |
| Page and auxiliary-panel spacing                | `components/app-shell.tsx` and `components/app-shell-panel-layout.tsx`               |
| Continuous corner rendering                     | `components/ui/smooth-corners-provider.tsx` and `lib/smooth-corners/`                |

If a shared primitive and this guide disagree, update them together. Do not
patch a single screen into a third visual convention.

## Color and surfaces

All browser colors must come from semantic theme tokens or a shared domain
owner. Do not add neutral hex, RGB, or light-only colors in component classes.
Every surface must be checked in light and dark themes.

| Surface                                           | Default use                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `bg-background`                                   | Page canvas, app panes, drawers, and full-height sidebars; dark mode uses charcoal rather than black |
| `bg-card`                                         | A persistent bounded panel or grouped record surface                                                 |
| `bg-popover`                                      | Menus, popovers, and form controls through their shared primitives                                   |
| `bg-muted` or a foreground tint from 2% to 6%     | Selected, hovered, or deliberately quiet subregions                                                  |
| `bg-brand` / `text-brand-foreground`              | Primary action, normally through `PillButton`                                                        |
| Semantic success, warning, and destructive tokens | Status and risk only                                                                                 |

Rules:

1. A page or pane should normally have one base surface.
2. A nested surface must communicate a real grouping, selection, or action.
3. Do not alternate white, gray, and tinted containers just to create texture.
4. Broker or carrier branding may color its owned identity surface. It must not
   replace neutral application structure or status colors.
5. Muted text is for supporting information. Primary names, values, and actions
   remain `text-foreground`.
6. Dark mode must preserve visible layers: the canvas is non-black, bounded
   surfaces step lighter, and muted text remains readable without becoming
   primary text.

## Border hierarchy

Borders are one physical pixel and use semantic, theme-adaptive tokens. Dark
mode borders are intentionally brighter than their light-mode counterparts so
structure remains visible on low-luminance surfaces.

| Strength               | Class                                                         | Use                                                               |
| ---------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Subtle                 | `border-border-subtle`                                        | Skeletons and deliberately low-priority separators                |
| Structural             | `border-border`                                               | Shell edges, panel outlines, section dividers, and row separators |
| Interactive resting    | `border-input`                                                | Inputs, secondary buttons, and clickable bounded surfaces         |
| Emphasized or floating | `border-border-emphasized` or `ring-1 ring-border-emphasized` | Popovers, selected outlines, and surfaces above the page          |
| Interactive hover      | `border-border-hover`                                         | Hover feedback for an outlined control                            |
| Interactive focus      | `border-border-focus` with `ring-1 ring-input`                | Keyboard or editing focus                                         |
| Status                 | Semantic color at low opacity, usually `/20`                  | Warning, error, or success boundary                               |

Additional rules:

- Use one shared divider between adjacent items. Do not give every row a full
  outline; use `border-t`, `border-b`, or `divide-y` and remove the first or
  last redundant edge.
- A border communicates grouping. If whitespace already makes the grouping
  unambiguous, no border is needed.
- Brand color is not a neutral border color.
- Focus rings are interaction feedback. They must not be used as permanent
  decoration.
- Use the shared control or panel primitive whenever it already owns these
  states. Avoid restating its borders at the callsite.

## Spacing and padding

Spacing communicates relationship. Closely related items use a small gap;
separate ideas use a larger gap. Use the established 4 px scale for layout.
Two-pixel steps such as 6, 10, or 14 px are reserved for shared component
contracts, not ad hoc page rhythm.

| Space           | Tailwind           | Default use                                                          |
| --------------- | ------------------ | -------------------------------------------------------------------- |
| 4–6 px          | `gap-1`, `gap-1.5` | Icon internals and compact control content                           |
| 8 px            | `gap-2`            | Label/help pairs, compact menu content, and closely related controls |
| 12 px           | `gap-3`            | Content inside a row or compact group                                |
| 16 px           | `gap-4`, `p-4`     | Default panel body and ordinary section rhythm                       |
| 20–24 px        | `gap-5`, `gap-6`   | Separate form groups or major page sections                          |
| 32 px and above | `gap-8`, `p-8`     | Empty states and deliberate large-section separation                 |

Use these container contracts:

- The app shell owns page padding: `px-6 py-6`, increasing to `lg:px-8`.
  Pages inside `AppShell` must not add another full-page inset.
- An ordinary panel header or list row uses `px-4 py-3`.
- An ordinary panel body uses `p-4`.
- A longer settings or form panel may use a consistent `px-5` inset with
  `py-3.5` in its header and `py-5` in its body when extra reading room is
  useful.
- Inputs and textareas own their internal padding. Do not add padding to the
  input element at the callsite.
- Dialog and drawer bodies, headers, and footers own their own insets. Footer
  actions stack full-width on mobile and return to intrinsic width from `sm`.
- Empty states may use `p-8` or more because the whitespace communicates the
  absence of data. Do not apply empty-state spacing to routine populated views.

When a container needs a density change, change the complete region—header,
body, and rows together. Avoid a sequence of unrelated `px-3`, `px-4`, and
`px-5` overrides inside the same visual group.

## Cards, panels, rows, and tables

Choose a container based on the information relationship, not on a desire to
fill empty space.

| Need                                          | Pattern                                                    |
| --------------------------------------------- | ---------------------------------------------------------- |
| A page section with no extra boundary         | Semantic `section` plus spacing                            |
| Grouped details, settings, or a bounded list  | `OperationalPanel`                                         |
| A panel title, description, or action         | `OperationalPanelHeader`                                   |
| Standard record facts or value pairs          | `OperationalLabelValueList` and `OperationalLabelValueRow` |
| Repeated records in one group                 | `OperationalItem`, a divided list, or `Table`              |
| A whole bounded region that is clickable      | `ActionSurfaceButton` or `ActionSurfaceLink`               |
| A proper empty result with an optional action | `EmptyStateCard`                                           |
| A temporary choice or contextual control      | `Popover`, `DropdownMenu`, or `Dialog`                     |

The generic `Card` component is not the default application container. Use it
only when the content is genuinely a self-contained object with card-specific
header, content, and footer behavior. Most Spot data and settings should use
`OperationalPanel` instead.

Card rules:

- Do not put every field, metric, or row in its own card.
- Do not place a card inside a card. Use a divider, subsection heading, or flat
  row unless the inner surface is an independent interactive tool.
- Do not wrap a table or list in both a generic card and an operational panel.
- When an active tab already names the content, omit the panel header and its
  subtitle.
- A hover treatment means the whole surface is actionable. A static panel must
  not look clickable.
- Keep repeated records in one shared outline so they scan as a set.

## Corners and shape

| Shape          | Use                                                            |
| -------------- | -------------------------------------------------------------- |
| `rounded-md`   | Small structural controls, menu items, and compact nested rows |
| `rounded-lg`   | Default panels, fields, action surfaces, and standard controls |
| `rounded-xl`   | Dialogs, prominent composers, and temporary elevated surfaces  |
| `rounded-full` | Pill buttons, badges, avatars, and circular icon wells only    |

Spot applies continuous corners globally. Use the standard radius utilities
and let the smooth-corner owner render them. Do not add custom clip paths or
opt out with `data-smooth-corners="off"` unless a tested rendering limitation
requires it. Arbitrary radii should be limited to a shared specialized
component, never used to tune one screen by eye.

## Elevation

Persistent application surfaces are flat. Their hierarchy comes from borders,
surface color, and placement.

- Panels, rows, fields, and drawers should not have drop shadows.
- Menus, popovers, toasts, and other temporary layers may use the shadow owned
  by their primitive, normally with a subtle `ring-foreground/10`.
- Modals may use an overlay and a ring; they do not need a heavy shadow.
- Do not combine several outlines, rings, and shadows on the same resting
  surface.

## Typography and content hierarchy

Follow [the typography guide](./typography.md). Browser callsites choose a
semantic role with `typeStyle()` and keep only color, spacing, alignment,
wrapping, and truncation local.

- A page must have one clear accessible identity. Operator portal routes use
  the app-shell breadcrumb; other product surfaces normally use one primary
  heading.
- Primary values use foreground color; metadata and explanation use muted
  foreground.
- Do not make important metadata tiny. If it affects a decision, give it a
  regular body or metadata role.
- Use sentence case for headings, labels, tabs, and buttons. Eyebrow roles are
  the explicit exception.
- Buttons use short verbs. Descriptions explain consequences, not obvious UI.
- Status tags call attention to a meaningful state. They are not category
  decoration.

## Actions and controls

Sidebar edits use `useLocalFirstAutoSave` and `AutoSaveStatus`; omit manual Save and footer Close/Cancel buttons when the sidebar already has a close control. Creation and consequential workflow actions remain explicit. Record-keyed editors keep drafts scoped when switching rows. Client Files also uses sidebar editing and footer preview/download/archive/restore actions; sidebar settings tables may contain switches. Procurement file sharing uses a compact audience table with Client visibility and Broker visibility switches; broker visibility includes the attachment in the next shared packet snapshot, while outreach-bound files remain excluded. `components/ui/file-download-button.tsx` owns storage-file downloads that fetch a blob before saving, preserving the open app and sidebar across cross-origin storage URLs.

- Use `PillButton` for product actions, including primary, secondary,
  destructive, footer, link, download, and icon-only actions.
- Use `variant="destructive"` for every destructive action. An icon-only
  destructive action must also provide `iconOnly` and a nonempty `label`.
- Raw buttons are for structural controls such as row targets, tabs, menu
  triggers, and non-destructive navigation—not for a locally styled action.
- A region should have one visually primary action. Additional actions are
  secondary, ghost, or placed in an overflow menu.
- App top bars give every `PillButton` the compact size and use only primary or
  secondary treatments. Order secondary utility, view, recovery, and reversible
  archive actions before at most one create or generate primary action at the
  right edge. Primary actions keep both their icon and short label visible.
- Compact secondary app-top-bar actions use `PillButton` with
  `variant="secondary"`, `expandLabel`, a nonempty `label`, and an icon child. They
  reveal the label on keyboard focus and fine-pointer hover, remain compact on
  coarse pointers, and respect reduced-motion preferences. Do not use this
  expanding treatment for dense close, remove, or structural controls.
- Use `Input`, `Textarea`, `Select`, and the shared field primitives. The
  default field height is `h-9`; compact fields must come from a supported
  primitive size rather than a local height override.
- Keep placeholders generic and descriptive. Never use a real customer,
  company, or person as sample data; use reserved `example.com` addresses when
  an email or URL format is useful.
- Every interactive control needs visible hover, focus, disabled, and invalid
  states where applicable. Color alone must not carry essential meaning.

## Responsive layout

- Prefer pages, panes, tables, split views, drawers, and toolbars over card
  grids.
- Use the right-side panel for create or edit work that benefits from retaining
  page context.
- On narrow screens, replace a side-by-side arrangement with a clean stack.
  Do not preserve desktop density by shrinking text or tap targets.
- Footer actions stack, stretch, and remain reachable on mobile.
- Tables may scroll horizontally when the columns are genuinely comparative.
  Otherwise, turn the record into labeled stacked rows.
- Test long organization names, carrier names, policy numbers, translated copy,
  empty data, errors, and loading states—not only the shortest happy path.

## Reference patterns

A standard bounded section:

```tsx
<OperationalPanel>
  <OperationalPanelHeader
    title="Organization"
    description="Identity shown to your clients."
    action={
      <PillButton variant="secondary" size="compact">
        Edit
      </PillButton>
    }
  />
  <OperationalPanelBody>{children}</OperationalPanelBody>
</OperationalPanel>
```

A repeated list uses one outline and shared dividers:

```tsx
<OperationalPanel as="div">
  {rows.map((row) => (
    <OperationalItem key={row.id}>{/* row content */}</OperationalItem>
  ))}
</OperationalPanel>
```

Standard record facts use one value-pair outline:

```tsx
<OperationalLabelValueList>
  <OperationalLabelValueRow label="Status" value={status} />
  <OperationalLabelValueRow label="Updated" value={updatedAt} />
</OperationalLabelValueList>
```

A local hand-built equivalent should be rare. If it appears repeatedly, move
the behavior into the appropriate shared primitive instead of copying its
class list.

## Review checklist

Before merging a browser UI change, confirm:

- The screen answers one clear user question and emphasizes the next action.
- Theme tokens and shared components own colors and common states.
- Borders use the semantic subtle / structural / interactive / emphasized /
  hover / focus hierarchy.
- Page, panel, row, and form padding follow one consistent container contract.
- Cards are used only for real bounded objects; repeated data scans as a list or
  table.
- Corners use the standard shape vocabulary and persistent surfaces stay flat.
- Typography uses semantic roles from `lib/typography.ts`.
- Destructive actions, empty states, errors, loading, focus, disabled, desktop,
  mobile, light, and dark behavior have been checked when relevant.
- `git diff --check` and the focused frontend validation pass.
