# Workspace mailbox scan: retired scheduled coverage

The scheduled Google Workspace reconciliation flow and its worker are removed. The previous acceptance ledger in this file is historical and no longer describes a runnable test. The current read-only operator tool is `scan_workspace_mailbox`, defined in `convex/lib/operatorAgentToolRegistry.ts` and executed through the operator Google Workspace path. It requires an authorized operator and scans only on an explicit tool invocation. It cannot create requests, import policies, or send mail.

Agent-scheduled workflows are tracked in Linear CLA-171. Add new browser workflow coverage to [workflow-qa.md](workflow-qa.md) when that feature is implemented. Do not run the former scheduled-scan fixtures as current acceptance.
