# Operator tool activity icons

`lib/tool-activity-icons.ts` maps every
registry tool to a Lucide icon category; TypeScript requires complete coverage.
Icons describe the tool’s subject or action, not success, authorization, or approval.
Unknown, historical, and tenant-only names retain the generic `Wrench` fallback.
Collapsed activity shows each represented category icon once, in first-use order.

| Category | Lucide icon | Tools |
| --- | --- | --- |
| Public research | `Globe` | `web_search`, `fetch_url`, `research_client`, `manage_client_web_monitor`, `get_research_status`, `research_broker`, `research_brokers` |
| Organizations | `Building2` | `search_organizations`, `get_organization`, `get_organizations`, `create_client_organization`, `update_organization_profile`, `set_client_access_status`, `set_client_access_statuses`, `get_client_assignees`, `set_client_assignee`, `set_client_assignees`, `acknowledge_client_web_monitor_events`, `create_client_organizations`, `update_organization_profiles`, `update_client_business_profile`, `describe_record_fields` |
| Provider network | `Users` | `get_broker_network_profile`, `list_broker_network_profiles`, `create_broker_network_profile`, `ensure_broker_network_profiles`, `update_broker_network_profile`, `update_broker_network_profiles`, `create_procurement_broker_outreach`, `update_procurement_broker_outreach`, `update_procurement_broker_outreaches` |
| Email | `Mail` | `save_email_draft`, `draft_email`, `update_email_draft`, `list_email_drafts`, `list_company_mailboxes`, `search_company_email`, `read_company_email_thread`, `read_company_email_threads`, `get_procurement_forwarding_address`, `list_procurement_email_threads`, `get_procurement_email_thread`, `preview_procurement_email_reconciliation`, `update_procurement_email_thread`, `file_procurement_email_quote`, `update_procurement_email_threads`, `link_team_inbox_thread`, `link_team_inbox_threads` |
| Files and attachments | `Paperclip` | `attach_to_conversation`, `get_company_email_attachment`, `read_thread_attachment`, `attach_policy_pdf_to_draft`, `attach_client_file_to_draft`, `list_client_files`, `read_client_file`, `attach_client_file`, `fill_pdf_form`, `edit_pdf_form`, `add_client_file`, `update_client_file`, `create_procurement_file_item`, `update_procurement_file_item`, `add_client_files`, `update_client_files`, `create_procurement_file_items`, `update_procurement_file_items` |
| Policies and coverage | `Shield` | `list_policies`, `lookup_policy`, `compare_coverages`, `lookup_policy_section`, `attach_policy_document`, `confirm_policy_fact`, `get_policy_status`, `import_policy_files` |
| Compliance and certificates | `ClipboardCheck` | `lookup_compliance_requirements`, `generate_coi` |
| Conversations | `MessagesSquare` | `compact_context`, `search_thread_history`, `list_operator_conversations`, `read_operator_conversation` |
| Company notes | `NotebookPen` | `lookup_client_wiki`, `update_client_wiki` |
| Procurement packets | `FileText` | `get_procurement_packet`, `lookup_procurement_packet`, `preview_broker_packet`, `update_procurement_packet` |
| Procurement requests | `ClipboardList` | `list_procurement_requests`, `get_procurement_information`, `get_client_attention`, `get_procurement_request`, `create_procurement_request`, `update_procurement_request`, `update_procurement_requests`, `update_procurement_application`, `add_procurement_information_questions` |
| Proposals and reviews | `FileCheck2` | `list_procurement_proposals`, `get_procurement_proposal`, `file_procurement_proposal`, `generate_procurement_proposal_review`, `confirm_procurement_proposal_review`, `select_procurement_proposal` |
| Sharing and access | `Link2` | `manage_broker_packet_link`, `list_broker_packet_links`, `create_broker_packet_link`, `rotate_broker_packet_link`, `revoke_broker_packet_link` |
| Extraction | `ScanText` | `control_proposal_extraction`, `list_extraction_issues`, `retry_failed_policy_extraction`, `retry_procurement_proposal_extraction`, `cancel_procurement_proposal_extraction` |
| Addresses | `MapPin` | `lookup_address` |
| Platform health | `Activity` | `get_platform_status`, `get_operator_overview`, `get_routing_status`, `get_channel_health` |
| Outbound messages | `Send` | `send_operator_slack_message`, `send_email_draft`, `send_procurement_provider_emails` |
| Configuration | `Settings2` | `set_client_feature_flag`, `set_client_feature_flags`, `invite_operator`, `list_operators` |
| Archive | `Archive` | `archive_procurement_proposal`, `archive_procurement_proposals` |
| Deletion | `Trash2` | `clear_all_agent_memory`, `cancel_email_draft`, `cancel_email_drafts` |
| Skills | `BookOpenText` | `load_skill`, `read_skill_file` |

Configured MCP calls use `McpToolActivityIcon` and the server's `OrgBrandIcon`
(logo URL, then website favicon/initial fallback). Collapsed summaries deduplicate
these logos by server; expanded rows show the remote tool name. `list_mcp_tools`
and historical calls without usable server metadata use the Configuration icon.

Compatibility aliases retain their historical icon mappings, though they are absent from tool discovery.
