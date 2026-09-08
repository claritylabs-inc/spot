---
name: cl-workflow-qa
description: Run scripted product workflows in visible cloud Chrome, record behavioral and UX defects, iteratively fix and retest them, and commit reviewed batches. Use for hands-on workflow improvement or a platform-wide browser QA loop.
---

# Workflow QA

Turn user feedback into observable acceptance criteria, then improve the actual
rendered product by following the same workflow before and after each fix.

## Establish the run

- Read the user's supplied session transcripts and current repository instructions.
  Preserve explicit feedback in the test guide; older example steps are not
  current requirements when later feedback changes them.
- Inventory routes, roles, settings tabs, drawers, and channel entrypoints from
  the repository and rendered navigation. Group them by user outcome, not file.
- Before executing each workflow, write its actor, local fixture, numbered
  actions, desired behavior, important failure/access cases, and cleanup.
  Start with [the run template](references/run-template.md).
- Keep a tracked workflow guide and coverage ledger in `docs/testing/`; put
  screenshots, traces, synthetic PDFs, and temporary browser scripts in
  gitignored `.context/qa/`. Never commit cookies, OTPs, tokens, or credentials.
- Use an explicit goal loop when the user requests one. Completion means every
  inventoried workflow has a recorded outcome, observed actionable defects are
  resolved and retested, and required checks and requested commits are done.
  Distinguish passed, failed, blocked, and not-run; route loads alone do not
  establish workflow coverage. Do not claim blocked external flows passed.

## Browser → fix → repeat

1. Use the visible cloud desktop Chrome. Attach Playwright over CDP when
   available; reuse the desktop page and bring the current workflow forward.
   Headless tests supplement, rather than replace, this browser run.
2. Confirm the app targets the worktree's local backend and synthetic fixture.
   Sign in normally using local email-capture OTPs. Test each role with an
   isolated browser context; never bypass auth to mark a browser case passed.
3. Follow the written use case. Inspect screenshots as well as accessible UI,
   downloads, persistence after reload, errors, and live updates. Record the
   observed behavior and evidence before editing.
4. Evaluate effort: redundant screens, clicks, cursor travel, repeated data
   entry, ambiguous labels, lost context, and unnecessary save/close steps.
   Apply repository design conventions and explicit user preferences. For Spot,
   read [the feedback checklist](references/spot-feedback.md).
5. Fix the smallest existing owner. Reuse existing primitives. Test consequential
   state/access regressions at their meaningful boundary; do not add brittle
   CSS, copy, navigation-list, or source-text assertions.
6. Rerun the original case and adjacent affected cases in visible Chrome. Check
   keyboard operation, narrow width, light/dark themes, and relevant loading,
   empty, failed, stale, and disabled states. Preserve drafts on failed saves.
7. Update the ledger with evidence and remaining uncertainty. Work through all
   untested groups, then return to unresolved findings. Keep useful progress
   updates flowing during a long run.

## Boundaries and delivery

Local synthetic writes are part of a requested testing/fixing run. Inspect
integration prerequisites before testing provider paths. Capture local email
and use mock channels; a request to test the platform does not authorize live
outreach, production writes, insurance binding, or external account changes.
When an external dependency prevents a workflow, record the exact missing
prerequisite and continue independent local cases. Restore temporary fixture
edits where possible; retain clearly named synthetic records only when useful.

Before each requested commit, perform a frontend-design pass on rendered
changes and a deslop pass on the diff against the user's target branch. Run
focused tests, relevant type/lint/build checks, and `git diff --check`. Review
only the intended files into the commit and report its hash, verification,
coverage, and blockers. A commit is a checkpoint, not the end of an unfinished
goal. Do not push or deploy unless the session authorizes it.
