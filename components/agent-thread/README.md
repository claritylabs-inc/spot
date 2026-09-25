# Agent Thread Components

The thread route is intentionally thin. Reusable message UI and artifact surfaces live here so new artifacts can be added without growing `app/agent/thread/[id]/page.tsx`.

## Structure

- `types.ts` defines the shared thread message, artifact data and side-panel reference shapes. Artifact modules must import types from here instead of from the route.
- `thread-content.tsx` adapts tenant thread data, mutations, artifact sidebars, and queued messages to the shared `components/chat/` list and composer. Route files pass thread identity, viewer metadata, and shell callbacks into this component.
- `thread-message.tsx` renders tenant-specific message details and artifacts through the shared chat message components. `thread-messages.ts` groups and stabilizes tenant records.
- `components/chat/attachment-chip.tsx` resolves tenant file URLs when given a thread ID and handles PDF preview.
- `artifacts/` contains one module per artifact family. Each module owns its summary card, right-panel detail view and normalization helpers for that artifact's data shape.

## Adding An Artifact

1. Add a module under `artifacts/` that exports a compact summary card and a right-panel component.
2. Put parsing/normalization beside the artifact module, not in the route page.
3. Add exports to `artifacts/index.ts`.
4. In the route integration, only wire message selection/open state and pass the selected artifact into the right panel. Keep data-shaping logic inside the artifact module.

## UX Contract

Web chat follows a messaging contract rather than an execution-console contract:

- Web replies stream when the viewer’s Stream responses preference is enabled (default on). Show thinking independently enables a collapsible tool-activity summary (default off). Use the thinking bubble before text arrives or when streaming is disabled. Keep raw model reasoning, tool inputs/outputs, and subagent logs private.
- Show `Delivered` on the viewer's latest web message after Convex acknowledges it, and `Read` only after the linked agent run has started. Older receipts stay hidden to keep the thread quiet.
- Reconcile streamed text with the final saved response. Keep source links, files, delivery status, and actionable artifacts because they change what the user can verify or do next.
- Detailed tool audit data remains in internal telemetry and channel adapters. The optional activity summary shows tool labels only; model reasoning and tool payloads stay private.

Artifact summary cards should be compact, truncate long labels and expose one clear action that opens the right panel. Right panels should use the same 12px header height, close button pattern and bottom action bar only when there are actionable controls.
