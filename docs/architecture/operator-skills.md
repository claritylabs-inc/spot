# Operator skills

Operators bring their own Claude Code / Codex skills into Spot's operator
agent: a folder with `SKILL.md` (front matter `name` and `description`) plus
optional references, scripts and assets. Skills are operator-agent only; the
client agent, tenant MCP and operator MCP never see them.

## Import

Settings → Skills (`/operator/settings?section=skills`) imports a zip, a folder
or pasted SKILL.md into Personal or Shared. The browser
(`lib/operator-skill-import.ts`) reads and previews; it uploads each file and
`operatorSkills.importSkill` re-reads every byte and re-runs every check
(`convex/lib/operatorSkills.ts`): at most 200 files and 5 MiB, a SKILL.md body
of at most 64 KiB, name `^[a-z0-9][a-z0-9-]{0,63}$` normalized from front
matter, description up to 1,024 characters, relative paths only, and `.git`,
`node_modules`, `__pycache__`, `__MACOSX` and `.DS_Store` skipped. Files are
classified as instructions, reference, script (under `scripts/`, a script
extension or a shebang) or asset.

`operatorSkills` holds one row per skill, `operatorSkillFiles` one row per
file with its storage ID and SHA-256. Re-importing a name replaces every file
in one transaction and bumps the revision; old bytes are deleted after commit.

## Access

- Personal skills are visible to, run by and edited by their owner only.
- Shared skills are visible to every active operator. The owner edits,
  replaces, removes and sets allowed domains; any operator can turn one off
  for the team.
- Every write requires an active operator, refuses impersonation and records a
  `setup_write` audit.

## Agent tools

`load_skill`, `read_skill_file` and `run_skill_script` are family-less core
tools appended last in the registry, so existing tool order and cached
prompt prefixes stay the same. `getRunContextInternal` offers the first two
only when the operator has an enabled skill, and `run_skill_script` only when
one of those skills has scripts. The `OPERATOR SKILLS` system prompt block lists
enabled skills (personal first, then shared, by name; 160-character
descriptions; at most 50 skills or 8 KB). It states that skills are guidance
only and cannot grant tools, skip approvals or change authorization.

## Script execution

`run_skill_script` runs one script in a fresh, non-persistent cl-router `exec`
sandbox (Ubuntu, Python 3, Node 24, bash; unprivileged user; working directory
`/router-exec-work`).

1. **Enabled check.** `/v1/capabilities` (cached 60 s) must list `exec`, and
   Convex env `SKILL_SCRIPT_EXECUTION` must not be `off` (Spot's kill switch).
   Otherwise the tool fails before any approval with "Script execution isn't
   enabled yet", and the prompt and `load_skill` say scripts cannot run.
2. **Resolution** (`convex/lib/operatorSkillScripts.ts`, run at preflight, for
   the approval card, on approval and right before execution):
   - The skill must be enabled and visible to the run's operator.
   - argv names one of its script files, optionally after `python3`,
     `python`, `node`, `bash` or `sh`. A bare script path uses the
     interpreter its extension implies, because the sandbox keeps no
     executable bits.
   - All paths must match the sandbox's `[a-zA-Z0-9_./-]` rule.
   - Input client files must be active files of a client organization. They
     are copied to `input/<name>`.
   - The skill and its inputs must stay within 200 files and 5 MiB.
   - stdin can be at most 256 KiB and the timeout at most 300 s (default
     120 s).
   - `network` must be a subset of the skill's `allowedDomains`.
3. **Shared skill review.** A shared skill's scripts run only after another
   operator (not the importer of that revision) marks the current revision
   "Scripts reviewed" in the drawer. Spot stores the reviewer, revision and
   time, and a re-import clears the review. Unreviewed runs fail with
   `scripts_not_reviewed`, which names the fix. Personal skills need no review.
4. **Approval.** The run needs exact approval, the same class as sends. Approve
   all applies to it like any other exact approval. The card reads:

   ```
   Run <script> from skill <name>
   - Arguments: <shell-quoted args>
   - Working files: <input file names or none>
   - Network: none | <domains>
   ```

   The input hash binds the input itself. The `sourceFingerprint` binds the
   skill id and revision, argv, the stdin hash, input file IDs, network and
   timeout, and a mismatch at approval or execution needs a fresh approval.
5. **Execution** (`convex/lib/operatorSkillScriptRunner.ts`):
   - It reads the bytes from storage and submits `operation: "exec"` through
     the durable router job path. Requests can be up to 12 MiB, and the
     invocation key is `operator-skill-exec:<confirmationId>`.
   - A retried or resumed execution reconnects to the same job, so it never
     starts a second run.
   - A router refusal with `executionStarted: false` is reported as nothing
     ran. Anything else that fails after submission is reported as an
     unknown outcome and never replayed.
   - The model sees the exit code, `timedOut`, the first 8 KB of stdout, the
     last 4 KB of stderr, truncation flags and the output files.
   - Files under `out/` are saved as attachments on the operator
     conversation. They go into client records only through `add_client_files`
     when the operator asks.

The approval, the `agentActionAuditEvents` ledger (target `operator_skill`) and
the router job row record each run. Spot sends no secrets: the sandbox
receives only skill files, chosen client files, argv and stdin.

## Smoke test

The hosted router cannot call back to a local deployment, so run this on a
deployed lane whose router advertises `exec`.

1. In Settings → Skills → Personal, import this skill. Paste is enough for
   SKILL.md; use a zip or folder so the script comes along:

   `result-writer/SKILL.md`

   ```markdown
   ---
   name: result-writer
   description: Use when asked to test skill script execution. Runs scripts/make_result.py, which writes out/result.txt.
   ---

   Run `scripts/make_result.py` with a label argument. It writes `out/result.txt`.
   ```

   `result-writer/scripts/make_result.py`

   ```python
   import pathlib, sys
   label = sys.argv[1] if len(sys.argv) > 1 else "no label"
   pathlib.Path("out").mkdir(exist_ok=True)
   pathlib.Path("out/result.txt").write_text(f"label: {label}\n")
   print(f"wrote out/result.txt for {label}")
   ```

2. In operator chat: "Run the result-writer skill's script with the label
   smoke test." The agent loads the skill and calls `run_skill_script`.
3. Confirm the card `Run scripts/make_result.py from skill result-writer`
   (Arguments: `'smoke test'`, Working files: none, Network: none).
4. Expect exit code 0, stdout `wrote out/result.txt for smoke test`, and
   `result.txt` attached to the conversation.

A personal skill needs no script review; for a shared skill, a second operator
marks Scripts reviewed first. To turn execution off without a deploy, set
Convex env `SKILL_SCRIPT_EXECUTION=off`.
