# Agent Thread Components

The thread route is intentionally thin. Tenant message UI and artifact surfaces live here on top of the shared chat system in `components/chat/`, so new artifacts can be added without growing `app/agent/thread/[id]/page.tsx`.

## Structure

- `components/chat/` owns everything both chat surfaces share: the message list and scroll anchoring, the composer, assistant and user turns, thinking summaries, attachment lists and expandable downloads, approval cards, disclosures, channel icons and the one-at-a-time action hook. The operator panel in `components/operator-agent/` is the other adapter.
- `types.ts` defines the shared thread message, artifact data and `ThreadArtifactRef` side-panel shapes. Artifact modules must import types from here instead of from the route.
- `thread-content.tsx` adapts tenant thread data, mutations, the open artifact panel, and queued messages to the shared list and composer. Route files pass thread identity, viewer metadata, and shell callbacks into this component.
- `thread-message.tsx` renders tenant-specific message details (references, sources, receipts, pending email countdown) and artifacts through the shared chat turns. `thread-messages.ts` groups and stabilizes tenant records.
- `artifacts/` contains one module per artifact family. Each module owns its summary card, right-panel detail view and normalization helpers for that artifact's data shape. `artifacts/shell.tsx` owns the shared right-panel shell and busy action pill; `artifacts/normalize.ts` owns loose payload readers.

## Adding An Artifact

1. Add a module under `artifacts/` that exports a compact summary card and a right-panel component built on `ArtifactSidebar`.
2. Put parsing/normalization beside the artifact module, not in the route page.
3. Add exports to `artifacts/index.ts` and a `ThreadArtifactRef` kind in `types.ts`.
4. In `thread-content.tsx`, only map the open ref to the right panel. Keep data-shaping logic inside the artifact module.

## UX Contract

Web chat follows a messaging contract rather than an execution-console contract:

- Web replies stream when the viewer’s Stream responses preference is enabled (default on). Show thinking independently enables a tool-activity summary (default off). Activity stays fully expanded while the turn is working, including while response text streams, then animates closed when the turn finishes. Completed activity can be reopened; reduced motion disables the collapse animation. Use the thinking bubble before text arrives or when streaming is disabled. Keep raw model reasoning, tool inputs/outputs, and subagent logs private.
- Show `Delivered` on the viewer's latest web message after Convex acknowledges it, and `Read` only after the linked agent run has started. Older receipts stay hidden to keep the thread quiet.
- Reconcile streamed text with the final saved response. Keep source links, files, delivery status, and actionable artifacts because they change what the user can verify or do next.
- Detailed tool audit data remains in internal telemetry and channel adapters. The optional activity summary shows tool labels only; model reasoning and tool payloads stay private.

Artifact summary cards should be compact, truncate long labels and expose one clear action that opens the right panel. Right panels share the 48px header height, close button pattern and bottom action bar through `ArtifactSidebar`; pass a footer only when there are actionable controls.
