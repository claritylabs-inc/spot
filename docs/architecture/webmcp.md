# WebMCP tools

Spot registers [WebMCP](https://developer.chrome.com/docs/ai/webmcp) tools so
browser agents can sign a business up and do anything a client can do in the
app. `lib/webmcp/catalog.ts` merges the definition modules in
`lib/webmcp/definitions/`, which are the source of truth for tool names,
descriptions, JSON Schemas, annotations, page scope, and role scope. Forms,
imperative registration, `/llms.txt`, and this page read the catalog. Tool
names are a contract with the spot.insure agent docs; renaming one breaks them.

## Policy

- Every tool executes its action directly. There is no confirmation step,
  including for sending email, inviting people, or deleting history.
- Each tool calls the same public Convex function the UI calls, with the same
  session authorization, so it can do nothing the signed-in person cannot do
  by clicking. The backend remains the authority; page and role scoping only
  keep the registered set relevant.
- `readOnlyHint` is true exactly for `list_*`, `get_*`, and `search_*` tools.
  `consequentialHint` marks tools that email someone, spend AI extraction
  time, or cannot be undone. It is informational and never blocks.
- Operators, including during impersonation, get no client tools.

## Runtime

- `lib/webmcp/runtime.ts` feature-detects `document.modelContext`. Without it
  (normal browsers, SSR) registration is a no-op. Imperative tools register
  with an `AbortSignal`; cleanup aborts it and calls `unregisterTool` for older
  previews. Results are JSON strings with `status`; errors are
  `{ status: "error", error }`, often with `next_tool`.
- Declarative forms get `toolname`, `tooldescription`, `toolautosubmit`, and
  per-field `name`/`toolparamdescription`. Agent submits
  (`SubmitEvent.agentInvoked`) read `FormData`, answer through `respondWith`,
  and `toolactivated` copies agent-filled values into React state.
- `components/webmcp/client-webmcp-tools.tsx` registers client tools from the
  catalog: every tool whose `pages` prefix matches the route (or has no
  `pages`), whose `adminOnly` flag matches the viewer's role, for an onboarded
  customer in a live client organization. Implementations live in
  `components/webmcp/tools/{workspace,insurance,agent,connect,settings}.ts`.
  `PublicWebMcpTools` registers token-page tools (`tools/public.ts`) on
  `/share/*`, `/connect/request/*`, and `/weather` without a session.
- File parameters are base64 (`file_name`, `content_type`, `content_base64`,
  max 20 MB) and upload through the same storage upload URL the UI uses.
  `upload_policy` hashes each PDF for the same duplicate check as the drawer
  and returns `status: "duplicate"` without uploading unless
  `allow_duplicates` is true.

## Tools by page

The full, generated list with descriptions is `/llms.txt`.

| Where | Tools |
| --- | --- |
| `/signup/client`, `/signup` (forms) | `request_signup_code`, `verify_signup_code` |
| `/login` (forms) | `request_login_code`, `verify_login_code` |
| `/onboarding/setup` (forms) | `submit_user_profile`, `submit_company_profile`, `finish_onboarding` |
| Every client page | `open_spot_page`, `start_spot_agent_thread`, `list_agent_threads`, `list_notifications`, `mark_notifications_read`, `mark_all_notifications_read`, `set_theme`, `sign_out`, `list_policies`, `get_policy`, `search_policy_wording`, `get_policy_source_evidence`, `get_policy_document_url`, `list_policy_versions`, `list_certificates`, `list_certificate_review_jobs`, `list_compliance_requirements`, `list_requirement_sources`, `list_source_certificates`, `list_insurance_requests`, `get_insurance_request`, `list_client_files` |
| `/policies` | `upload_policy`, `archive_policy`, `restore_policy`, `cancel_policy_extraction`, `retry_policy_extraction`, `generate_certificate` |
| `/certificates` | `generate_certificate`, `generate_certificates_for_requirements`, `reissue_certificate`, `update_certificate_holder`, `archive_certificate`, `restore_certificate` |
| `/compliance` | `generate_certificate`, `generate_certificates_for_requirements`, `list_vendor_compliance`; admins: `create_compliance_requirement`, `update_compliance_requirement`, `archive_compliance_requirement`, `update_requirement_source`, `archive_requirement_sources`, `import_compliance_requirements`, `recheck_compliance_requirement` |
| `/requests` | `create_insurance_request`, `attach_request_document` |
| `/agent` | `get_agent_thread`, `send_thread_message`, `list_agent_reference_targets`, `rename_thread`, `archive_thread`, `unarchive_thread`, `stop_agent_response`, `retry_agent_response`, `rate_agent_response`, `get_thread_attachment_urls`, `get_email_draft`, `send_email_draft`, `send_email_drafts`, `cancel_email_draft`, `restore_email_draft`, `get_mailbox_email`, `get_mailbox_attachment_url`, `import_mailbox_policy_attachments`, `import_mailbox_requirement_attachments`, `save_mailbox_attachments_to_thread`, `resolve_mailbox_review` |
| `/connect` | `list_vendors`, `list_connected_clients`, `list_vendor_compliance`, `list_vendor_policies`; admins: `request_vendor_access`, `resend_vendor_invitation`, `cancel_vendor_invitation`, `approve_connection`, `revoke_connection` |
| `/settings` | `get_organization`, `list_team_members`, `list_team_invitations`, `get_agent_channels`, `get_company_wiki`, `get_certificate_workflow_settings`, `get_notification_preferences`, `set_notification_channels`, `reset_notification_channels`, `set_all_notification_channel`, `list_connected_apps`, `revoke_connected_app`, `list_mailboxes`, `connect_mailbox`, `update_mailbox_settings`, `scan_mailbox`, `disconnect_mailbox`, `restart_onboarding`; admins: `update_organization`, `upload_organization_logo`, `import_logo_from_website`, `update_agent_email_settings`, `invite_team_member`, `cancel_team_invitation`, `change_member_role`, `remove_team_member`, `update_team_member_profile`, `set_primary_insurance_contact`, `request_member_email_change`, `cancel_member_email_change`, `update_agent_channels`, `list_slack_channels`, `select_slack_channel`, `join_slack_channel`, `leave_slack_channel`, `start_slack_reinstall`, `disconnect_slack`, `save_company_wiki`, `resolve_wiki_suggestion`, `set_certificate_renewal_reissue`, `set_beta_feature` |
| `/profile` | `get_profile`, `update_profile`, `set_proactive_contact_channels`, `request_email_change`, `confirm_email_change`, `cancel_email_change`, `get_imessage_history_deletion_state`, `prepare_imessage_history_deletion`, `delete_imessage_history` |
| `/connect/request/:token` (public) | `get_vendor_invitation`, `accept_vendor_invitation` |
| `/share/packet/:token` (public) | `get_shared_packet` |
| `/share/email/:token` (public) | `get_shared_email_draft`, `send_shared_email_draft` |
| `/share/imessage/:token` (public) | `get_shared_card` |
| `/weather` (public) | `get_model_routing_report` |

## UI parity

Every client UI action and the tool that performs it. "Not exposed" rows are
actions a client cannot perform in the UI today.

| Surface | UI action | Tool |
| --- | --- | --- |
| Signup/login | Email → code → verify | `request_signup_code`, `verify_signup_code`, `request_login_code`, `verify_login_code` |
| Onboarding | Profile, organization, finish | `submit_user_profile`, `submit_company_profile`, `finish_onboarding` |
| Onboarding | Log out | Not exposed during onboarding; `sign_out` on every client page |
| Navigation | Sidebar pages, settings sections | `open_spot_page` |
| Notifications | List, open (marks read), mark all read | `list_notifications`, `mark_notifications_read`, `mark_all_notifications_read` |
| Policies | List active/archived, detail, coverages, source evidence, PDF, history, certificates tab | `list_policies`, `get_policy`, `get_policy_source_evidence`, `get_policy_document_url`, `list_policy_versions`, `list_certificates` (`policy_id`) |
| Policies | Upload PDFs from the header drawer or empty state, combined or separate, with duplicate warning | `upload_policy` (`mode`, `allow_duplicates`) |
| Policies | Archive, restore, or cancel extraction of a policy the client uploaded | `archive_policy`, `restore_policy`, `cancel_policy_extraction` |
| Policies | Resume/restart failed extraction | `retry_policy_extraction` |
| Policies | Edit fields, answer extraction review questions, archive policies Spot staff added | Not exposed: operator-only (`assertCanEditPolicyExtractedFields`, `assertCanReviewPolicyExtraction`, `assertCanManageUploadedPolicy`) |
| Certificates | List active/archived, versions, downloads | `list_certificates` |
| Certificates | Review jobs tab | `list_certificate_review_jobs` |
| Certificates | Generate (policy mode / requirements mode) | `generate_certificate`, `generate_certificates_for_requirements` |
| Certificates | Reissue, edit holder, archive, restore | `reissue_certificate`, `update_certificate_holder`, `archive_certificate`, `restore_certificate` |
| Certificates | Send a workflow job to the holder | Not exposed: `sendCertificateWorkflowJob.send` has no client UI entry point |
| Compliance | Requirements, sources, source certificates, vendor summary | `list_compliance_requirements`, `list_requirement_sources`, `list_source_certificates`, `list_vendor_compliance` |
| Compliance (admin) | Add, edit, archive requirement; edit source and notes; archive sources; import from file or text; deeper check | `create_compliance_requirement`, `update_compliance_requirement`, `archive_compliance_requirement`, `update_requirement_source`, `archive_requirement_sources`, `import_compliance_requirements`, `recheck_compliance_requirement` |
| Requests | List, open, create, attach file, download files | `list_insurance_requests`, `get_insurance_request`, `create_insurance_request`, `attach_request_document` |
| Requests | Edit, cancel, comment, remove files, view/select proposals, manage share links | Not exposed: no client function exists; procurement is operator-run |
| Files | List, preview, download | `list_client_files` |
| Files | Upload, rename, share, archive | Not exposed: operator-only |
| Agent | New thread, send message with attachments/references | `start_spot_agent_thread`, `send_thread_message`, `list_agent_reference_targets` |
| Agent | Threads list/archive, read, rename, archive, unarchive | `list_agent_threads`, `get_agent_thread`, `rename_thread`, `archive_thread`, `unarchive_thread` |
| Agent | Stop, try again, thumbs up/down, attachment downloads | `stop_agent_response`, `retry_agent_response`, `rate_agent_response`, `get_thread_attachment_urls` |
| Agent | Email draft: view, send, send all, cancel (incl. scheduled countdown), restore | `get_email_draft`, `send_email_draft`, `send_email_drafts`, `cancel_email_draft`, `restore_email_draft` |
| Agent | Edit a draft | Through the agent: `send_thread_message` (no direct edit function exists) |
| Agent | Mailbox review: read, preview attachment, import policies/requirements, save to thread, resolve | `get_mailbox_email`, `get_mailbox_attachment_url`, `import_mailbox_policy_attachments`, `import_mailbox_requirement_attachments`, `save_mailbox_attachments_to_thread`, `resolve_mailbox_review` |
| Agent | Copy message/thread | Not exposed: clipboard only; `get_agent_thread` returns the text |
| Connect | Vendors, clients, vendor policies | `list_vendors`, `list_connected_clients`, `list_vendor_policies`, then `get_policy` |
| Connect (admin) | Add vendor, resend, cancel invite, approve, revoke | `request_vendor_access`, `resend_vendor_invitation`, `cancel_vendor_invitation`, `approve_connection`, `revoke_connection` |
| Connect invite page | View and accept a sharing request | `get_vendor_invitation`, `accept_vendor_invitation` |
| Settings › Organization | Name, website, logo upload, logo from website | `get_organization`, `update_organization`, `upload_organization_logo`, `import_logo_from_website` |
| Settings › Team | Members, invitations, invite/resend, cancel, role, remove, profile, primary contact, email change and cancel | `list_team_members`, `list_team_invitations`, `invite_team_member`, `cancel_team_invitation`, `change_member_role`, `remove_team_member`, `update_team_member_profile`, `set_primary_insurance_contact`, `request_member_email_change`, `cancel_member_email_change` |
| Settings › Agent | Channel toggles, Slack channels, reinstall, disconnect, email behavior | `get_agent_channels`, `update_agent_channels`, `list_slack_channels`, `select_slack_channel`, `join_slack_channel`, `leave_slack_channel`, `start_slack_reinstall`, `disconnect_slack`, `update_agent_email_settings` |
| Settings › Agent | Edit agent email address, create Slack channel, Slack setup steps | Not exposed: operator-only |
| Settings › Wiki | Read, save, apply/dismiss suggestion | `get_company_wiki`, `save_company_wiki`, `resolve_wiki_suggestion` |
| Settings › Workflows | Certificate renewal reissue; notification preferences | `get_certificate_workflow_settings`, `set_certificate_renewal_reissue`, `get_notification_preferences`, `set_notification_channels`, `reset_notification_channels`, `set_all_notification_channel` |
| Settings › Integrations | Connected apps list and revoke; MCP/CLI setup text | `list_connected_apps`, `revoke_connected_app`; setup text is static (see `/llms.txt`) |
| Settings › Mailboxes | List, connect (IMAP password), settings, scan range, disconnect | `list_mailboxes`, `connect_mailbox`, `update_mailbox_settings`, `scan_mailbox`, `disconnect_mailbox` |
| Settings › Beta | Feature flags, re-run setup | `set_beta_feature`, `restart_onboarding` |
| Settings › Beta | Reset organization | Not exposed: requires the platform `users.isAdmin` flag, not a client role |
| Profile | Name/title/phone, chat preferences, proactive channels | `get_profile`, `update_profile`, `set_proactive_contact_channels` |
| Profile | Email change: request, confirm with code, cancel | `request_email_change`, `confirm_email_change`, `cancel_email_change` |
| Profile | iMessage history deletion | `get_imessage_history_deletion_state`, `prepare_imessage_history_deletion`, `delete_imessage_history` |
| Profile | Theme | `set_theme` |
| Share pages | Packet view, email draft review and send, policy card | `get_shared_packet`, `get_shared_email_draft`, `send_shared_email_draft`, `get_shared_card` |
| Weather | Model routing report | `get_model_routing_report` |

## Discovery

- `app/llms.txt/route.ts` serves `/llms.txt` as static plain text generated
  from the catalog, grouped by registration scope. `proxy.ts` skips paths with
  a file extension, and the route is outside `AuthGuard`.
- The root layout adds `<link rel="llms-txt" href="/llms.txt">`.
- `/signup/client` is the canonical signup URL and supports `?email=`.

## Verification

Run `node scripts/webmcp-e2e.mjs [--seeded-client adyan@cove.dev]` against the
local app and native local Convex, which must have `SPOT_ENV=local` and
`EMAIL_DELIVERY_MODE=capture`. Capture mode logs every email and never calls
Resend. Test recipients are `@example.com`. For the seeded flag, run
`npx convex run seed:seed` first.

The run uses headless Chrome with a stub `document.modelContext` injected
before app scripts. It checks:

- declarative attributes, and the no-op path without `modelContext`
- agent-style signup and onboarding for a new business with no invite
- that read tools, and only read tools, carry `readOnlyHint`, and that input
  schemas are valid on each page
- that a member gets no admin tools
- write tools across compliance, connect, settings, team, profile, agent
  threads, and email drafts
- certificate and policy tools against seeded data
- public token pages
- unregistration on `sign_out`

When the local model router rejects jobs, model-backed steps are reported as
blocked rather than passed. The draft-send tools then run on synthetic drafts
created in the local deployment. Results and screenshots go to
`.context/qa/webmcp/`.
