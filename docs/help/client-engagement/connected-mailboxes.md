# Connected mailboxes

A connected mailbox lets Spot search recent mail on demand and proactively
identify selected insurance work. It is a source for the agent, not the address
people use to email the Spot agent.

## Supported connections

Open **Settings → Mailboxes**, choose **Add mailbox**, and select:

| Provider                | Default connection                     | Important setup note                                                               |
| ----------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| Google Workspace        | `imap.gmail.com`, port 993, TLS        | Use a Google app password when two-step verification is enabled                    |
| Outlook / Microsoft 365 | `outlook.office365.com`, port 993, TLS | IMAP must be enabled; some tenants require OAuth and will not allow password login |
| Other IMAP              | Provider host and port                 | Get the IMAP server, port, and security requirement from the mail provider         |

Spot tests the connection before saving it. If a Microsoft tenant requires
OAuth-only access, the password-based IMAP connection cannot bypass that policy;
ask the tenant administrator or Spot support about the available integration.

## Connect a mailbox

1. Open **Settings → Mailboxes** and select **Add mailbox**.
2. Choose the provider.
3. Enter the mailbox address and password or app password.
4. For **Other IMAP**, enter the exact host, port, and TLS setting.
5. Choose who can use the live connection:
   - **Just me**; or
   - **Everyone in the organization**.
6. Review the two proactive-monitoring choices.
7. Save and wait for the connection test to succeed.

Only an administrator can make a mailbox available to the whole organization.
The owner manages a personal mailbox; administrators manage organization-wide
mailboxes.

## Understand mailbox scope

Mailbox scope and imported workspace data are intentionally different:

- **Just me** means only the owner can ask Spot to search or read that live
  mailbox.
- **Everyone in the organization** lets organization members use the live
  mailbox through Spot, subject to their normal workspace permissions.
- A policy, requirement, or attachment imported from either kind
  of mailbox becomes workspace data visible to the organization.

Do not import an item if it should remain only in the personal mailbox.

## Proactive monitoring

New connections offer two monitoring categories and enable them by default:

| Category                   | What Spot looks for                                            |
| -------------------------- | --------------------------------------------------------------- |
| **Policy documents**       | Insurance policies and supporting documents suitable for import |
| **Insurance requirements** | Requests from clients, lenders, landlords, and investors        |

The scanner keeps cursor and outcome metadata and saves only selected first-class
artifacts. Raw mailbox bodies remain in the mailbox unless a user asks Spot to
read them live or an attachment is deliberately imported.

Mailbox monitoring does not add company facts to the profile or wiki. Ask Spot
explicitly to add or remember a specific detail when you want it saved.

Older connections may show **Alerts only** or **Monitoring off** until an owner
reviews and saves their automation settings.

## Search and import with the agent

From web chat or another supported agent channel, ask Spot to search a mailbox
you can access. Good requests include:

- `Find the most recent renewal email from our broker.`
- `Show messages from the landlord about insurance requirements.`
- `Read the April 12 email and summarize its attachments.`
- `Import the policy PDF from that message.`
- `Save the attachments from that email to this thread.`

Search returns matching message metadata first. Spot reads a specific message
or downloads attachments only when the workflow needs them. Be explicit about
which result to use when several emails look similar.

## Run a manual scan

Open the mailbox's settings and select **Scan mailbox**. Choose a start and end
date. Spot applies the saved monitoring categories and skips mail already
processed. If the mailbox contains more mail than the scan can inspect at once,
the result identifies the bounded set it reviewed.

When Spot finds something that needs review, it can create a Spot thread and
a **Mailbox items need attention** notification.

## Security and disconnecting

Mailbox credentials are encrypted before storage and used for the configured
IMAP connection. Prefer an app password that can be revoked without changing
the user's primary password.

Disconnecting a mailbox stops future searches and monitoring. It does not
delete policies, requirements, saved attachments, or company facts that were
already imported into the workspace.

## Troubleshooting

### Google rejects the password

Confirm IMAP access is permitted and create an app password for the Google
account when two-step verification is enabled. Enter the app password, not the
normal account password.

### Outlook rejects the connection

Ask the Microsoft 365 administrator whether IMAP is enabled and whether the
tenant allows password or app-password authentication. A tenant that requires
OAuth cannot be connected through the password form.

### A custom provider does not connect

Verify the IMAP host, port, username format, and TLS requirement with the mail
provider. Port 993 normally uses TLS. Do not substitute an SMTP server; SMTP is
for sending and cannot be used here.

### A teammate cannot search my mailbox

Open the mailbox settings and check **Available to**. Only an administrator can
change it to **Everyone in the organization**. Remember that changing the scope
grants live mailbox access, not merely access to already imported records.

### Spot is not finding new work

Check the mailbox status, **Last checked**, and any displayed error. Confirm the
relevant monitoring categories are on, then run a bounded manual scan for the
date range. Reconnect if the provider revoked the password.

### I disconnected the mailbox but still see imported data

That is expected. Disconnecting revokes the live source; it does not erase
workspace records created from earlier imports. Manage those records in their
normal policy, requirement, thread, or memory location.
