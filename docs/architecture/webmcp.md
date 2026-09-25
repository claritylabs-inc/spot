# WebMCP tools

Spot registers browser-agent tools from `lib/webmcp/catalog.ts` and `lib/webmcp/definitions/`. The catalog supplies names, descriptions, schemas, effects, page scope, and role scope to the runtime and `/llms.txt`; `AGENT_TOOLS.md` summarizes the inventory.

WebMCP is off by default. `lib/flags.ts` defines Vercel flag `webmcp-enabled`; set `WEBMCP_ENABLED=true` for its default decision and `FLAGS_SECRET` for Vercel Toolbar overrides. Vercel exposes the flag discovery endpoint at `/.well-known/vercel/flags`. `app/layout.tsx` evaluates the flag before mounting registration. An ordinary browser without `document.modelContext` performs no registration.

`lib/webmcp/runtime.tsx` registers imperative tools with cleanup and handles declarative form submission. `components/webmcp/client-webmcp-tools.tsx` filters tools by page and role for onboarded clients. Public token pages use their own scoped registration. Every call uses the same Convex action and server authorization as the equivalent UI action; page registration is only discovery, not an access grant. The backend still checks the session or page token. Tool annotations describe read-only and consequential effects but do not introduce an extra approval flow. Operators and impersonation sessions receive no client tools.

Use the current catalog and generated `/llms.txt` for exact tool names. Removed public routes, rating controls, certificate renewal settings, and iMessage app cards have no WebMCP entries. The client UI remains the source for user-facing behavior.
