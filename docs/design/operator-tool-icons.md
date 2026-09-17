# Operator tool activity icons

The current operator registry has 75 tools. `lib/tool-activity-icons.ts` maps every
registry tool to a Lucide icon category; TypeScript requires complete coverage.
Icons describe the tool’s subject or action, not success, authorization, or approval.
Unknown, historical, and tenant-only names retain the generic `Wrench` fallback.
Collapsed activity shows each represented category icon once, in first-use order.

| Category | Lucide icon | Tools |
| --- | --- | --- |
| Public research | `Globe` | `web_search`, `research_client` |
| Organizations | `Building2` | `search_organizations`, `get_organization`, `create_client_organization`, `update_organization_profile`, `set_organization_status` |
| Broker network | `Users` | `get_broker_network_profile`, `list_broker_network_profiles`, `create_broker_network_profile`, `update_broker_network_profile`, `create_procurement_broker_outreach`, `update_procurement_broker_outreach` |
| Email | `Mail` | `list_company_mailboxes`, `search_company_email`, `read_company_email_thread`, `get_procurement_forwarding_address`, `list_procurement_email_threads`, `get_procurement_email_thread`, `preview_procurement_email_reconciliation`, `update_procurement_email_thread`, `file_procurement_email_quote` |
| Files and attachments | `Paperclip` | `get_company_email_attachment`, `read_thread_attachment`, `list_client_files`, `read_client_file`, `attach_client_file`, `add_client_file`, `update_client_file`, `create_procurement_file_item`, `update_procurement_file_item` |
| Policies and coverage | `Shield` | `list_policies`, `lookup_policy`, `compare_coverages`, `lookup_policy_section`, `attach_policy_document`, `confirm_policy_fact`, `get_policy_status`, `import_policy_files` |
| Compliance and certificates | `ClipboardCheck` | `lookup_compliance_requirements`, `generate_coi` |
| Conversations | `MessagesSquare` | `search_thread_history`, `list_operator_conversations`, `read_operator_conversation` |
| Company notes | `NotebookPen` | `lookup_client_wiki`, `update_client_wiki` |
| Procurement packets | `FileText` | `lookup_procurement_packet`, `preview_broker_packet`, `update_procurement_packet` |
| Procurement requests | `ClipboardList` | `list_procurement_requests`, `get_procurement_request`, `create_procurement_request`, `update_procurement_request` |
| Proposals and reviews | `FileCheck2` | `list_procurement_proposals`, `get_procurement_proposal`, `file_procurement_proposal`, `generate_procurement_proposal_review`, `confirm_procurement_proposal_review`, `select_procurement_proposal` |
| Sharing and access | `Link2` | `list_broker_packet_links`, `create_broker_packet_link`, `rotate_broker_packet_link`, `revoke_broker_packet_link` |
| Extraction | `ScanText` | `list_extraction_issues`, `retry_failed_policy_extraction`, `retry_procurement_proposal_extraction`, `cancel_procurement_proposal_extraction` |
| Addresses | `MapPin` | `lookup_address` |
| Platform health | `Activity` | `get_operator_overview`, `get_routing_status`, `get_channel_health` |
| Outbound messages | `Send` | `send_operator_slack_message` |
| Configuration | `Settings2` | `set_client_feature_flag` |
| Archive | `Archive` | `archive_procurement_proposal` |
| Deletion | `Trash2` | `clear_all_agent_memory` |

Configured MCP calls use `McpToolActivityIcon` and the server's `OrgBrandIcon`
(logo URL, then website favicon/initial fallback). Collapsed summaries deduplicate
these logos by server; expanded rows show the remote tool name. `list_mcp_tools`
and historical calls without usable server metadata use the Configuration icon.
