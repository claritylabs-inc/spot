# Chat presentation acceptance

The implementation was delegated to three Conductor cloud workspaces for composition, backend integration, and rendering. The manager reviewed exact handoff commits, integrated corrections, and reran the combined checks. Both cl-deslop and cl-frontend-design passes were completed.

## Automated coverage

The 167 focused and regression tests cover:

- Strict catalog/tree/reference validation and bounded payloads.
- Real tool DTOs through capture, candidate conversion, and the installed native json-render composer.
- Proposal confirmation provenance, source spans, request completion fields, audience exclusions, and explicit truncation.
- Revision fencing, access revocation, connected requirements, request-specific file grants, and empty-evidence scheduling.
- Actual operator-loop capture and continuation, preserving completed text and preventing replay when composition fails.
- Required form fields, exact record selections, failed-send draft retention, double-send guards, and disabled controls during active tasks.
- Exact requirement/source/proposal navigation, historical read-only proposals, save-before-close behavior, and reopening the same citation.

Run these suites with:

```sh
npx vitest run lib/chat-presentation.test.ts convex/lib/chatPresentationCandidates.test.ts convex/lib/chatPresentationCandidates.integration.test.ts convex/lib/chatPresentationComposer.test.ts convex/chatPresentations.test.ts components/chat-presentation/chat-presentation-view.test.tsx components/chat-presentation/forms.test.tsx convex/lib/agentToolExecutors.test.ts convex/procurementDomain.test.ts tests/compliance-deep-links.test.tsx tests/procurement-broker-sidebar.test.tsx convex/operatorAgentRunner.test.ts convex/operatorAgentRerun.test.ts convex/operatorAgentConversations.test.ts convex/operatorAgentActions.test.ts
```

Root TypeScript, changed-file ESLint, native local Convex validation/code generation, the Next production build, and `git diff --check` passed.

## Browser and router acceptance

Headless cloud Chrome exercised all 15 primitives using synthetic fixtures, including light/dark themes, a 390px viewport, a narrow chat rail, a 30-row comparison, keyboard evidence inspection, filtering/sorting, failed-send retry, and active-task guards. This is not a visible-Chrome workflow-QA run.

A live authenticated `/v1/decide` request composed a requirements presentation from synthetic authorized evidence. Both local operator and client chats rendered saved presentations, retained them after reload, and passed mobile overflow/error checks. The clean production build opened the exact requirement from its chat citation, cleared the closed selection, and reopened the same citation. Screenshots and local reproduction artifacts remain in the workspace's gitignored `.context/` directory.

Temporary test endpoints and synthetic chat/requirement records were removed. These checks do not constitute a production deployment or a live end-to-end business-tool inference test; the actual tool-loop failure/replay boundary is covered by the integration test above.
