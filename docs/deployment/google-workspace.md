# Operator Google Workspace setup

Spot can give active operators read-only access to configured company Gmail
mailboxes through a Google Cloud service account with Google Workspace
domain-wide delegation. The connection is global: every active Spot operator
can use the same configured mailbox set through operator chat, Slack, iMessage,
and MCP.

This integration is read-only. It searches Gmail live and can read messages,
threads, and attachments. It does not send mail, change labels, schedule
ingestion, or create a semantic email index. It is not available to tenant
agents or tenant MCP clients.

The service-account JSON is a backend secret. Never paste it into the Spot web
app, commit it, attach it to an issue, or send it through chat. The browser sees
only the service-account email, OAuth client ID, required scopes, and redacted
diagnostics.

## V1 scope and data flow

An active operator starts a request in operator web chat, Slack, iMessage, or
MCP. The shared operator tool gate revalidates that operator, the enabled global
configuration, and the requested mailbox. Spot then impersonates only the
needed Workspace user and calls Gmail live. Directory mode obtains the company
roster from `customer=my_customer`, which covers every domain in the Workspace
customer; manual mode uses the saved mailbox list. Responses preserve mailbox,
message, thread, and attachment provenance, report partial mailbox failures,
and return an explicit continuation when bounded work remains.

V1 includes live mailbox listing, Gmail search, full thread reads, and original
attachment retrieval into the protected operator thread. It has one global
active-operator access gate, not per-operator or per-mailbox ACLs. It does not
send or modify Gmail, change labels, create drafts, watch mailboxes, run
scheduled ingestion, or build an automatic email index.

Acceptance criteria:

- An active operator can configure manual or Directory mode and run redacted
  verification from **Channels → Google Workspace** without reading code.
- Manual mode searches only explicitly configured company mailboxes. Directory
  mode enumerates all eligible users across the Workspace customer and clearly
  reports skipped or failed entries.
- Search and read results always retain their mailbox-scoped Gmail IDs and
  source provenance. Original attachments remain bound to the stated mailbox
  and parent message.
- Bounded listing, search, and thread reads expose continuation and
  completeness; a mailbox failure remains visible instead of being mistaken
  for a complete cross-company result.
- Disabled configuration, missing backend credentials, inactive operators,
  unconfigured mailboxes, and tenant callers fail closed.
- No service-account key or access token reaches browser state, model context,
  application logs, audit payloads, or committed test artifacts.
- No Gmail write, automatic index, or ingestion path is present in v1.

## Choose a mailbox mode

Choose the mode before granting scopes so the authorization stays as narrow as
possible.

| Mode | Use it when | Required scopes | Spot configuration |
| --- | --- | --- | --- |
| Manual | A small, stable set of mailboxes is enough | `https://www.googleapis.com/auth/gmail.readonly` | Enter each mailbox address explicitly |
| Directory | Every eligible mailbox in the Workspace account should be discoverable | `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/admin.directory.user.readonly` | Enter an active Workspace administrator as the directory subject |

Directory mode asks the Admin SDK Directory API for all users in the Workspace
customer (`customer=my_customer`) and follows every result page. Spot excludes
suspended, archived, and known non-mailbox accounts. Manual mode does not need
the Directory API grant or a directory administrator.

Use each user's primary Google Workspace address for a manual roster entry and
for the Directory administrator subject. Directory mode discovers each user's
`primaryEmail` across the customer's domains. Sender or recipient aliases—such
as branded `spot.insure` or legacy `glass.insure` identities—are Gmail query
terms, not separate mailbox accounts, and must not be added to the roster unless
they are actual primary mailboxes.

## Google Cloud setup

Use a Google Cloud project controlled by the company, then:

1. Open **Google Cloud console → APIs & Services → Library** and enable the
   **Gmail API**. For directory mode, also enable the **Admin SDK API**.
2. Open **IAM & Admin → Service Accounts → Create service account** and create
   a dedicated account for Spot. Do not grant it unrelated Google Cloud IAM
   roles.
3. Open the new service account's **Details**, expand its Google Workspace
   domain-wide delegation settings, and enable domain-wide delegation.
4. Record its service-account email and numeric OAuth client ID. In Google
   Cloud, open **IAM & Admin → Service Accounts → the service account → Advanced
   settings** to copy the client ID.
5. Open **Keys → Add key → Create new key → JSON**. Move the downloaded file
   immediately to the approved secret store. The downloaded file is the only
   copy of that private key.

Google recommends its client libraries for this server-to-server flow. Spot
uses the server-side Google libraries and specifies the mailbox being
impersonated for each Gmail request; domain-wide delegation does not make the
service account a Workspace user or give it unconstrained administrator access.
See Google's [service-account OAuth guide](https://developers.google.com/identity/protocols/oauth2/service-account).

An ordinary Google administrator OAuth connection cannot substitute for this
credential. A user OAuth token that can list Directory users still cannot let
Spot impersonate each mailbox through the service account, and it does not
satisfy the Gmail domain-wide delegation grant.

## Authorize domain-wide delegation

A Google Workspace super administrator must complete this step:

1. Open **Admin console → Security → Access and data control → API controls →
   Manage Domain Wide Delegation**.
2. Select **Add new**.
3. Paste the service account's numeric **Client ID**. Do not paste its email,
   key ID, or Google Cloud project ID.
4. Paste the comma-delimited scopes for the selected mailbox mode:

   Manual:

   ```text
   https://www.googleapis.com/auth/gmail.readonly
   ```

   Directory:

   ```text
   https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/admin.directory.user.readonly
   ```

5. Select **Authorize**, then open the client's details and confirm every scope
   is listed. Organizations with multi-party approval may need a second super
   administrator to approve the change.

Google says delegation changes usually apply within minutes but can take up to
24 hours. The current Admin console steps are maintained in Google's
[domain-wide delegation guide](https://knowledge.workspace.google.com/admin/apps/control-api-access-with-domain-wide-delegation).
The selected Gmail scope permits viewing messages and settings but not sending
or modifying mail; see the [Gmail scope reference](https://developers.google.com/workspace/gmail/api/auth/scopes).

## Store the backend credential

Set the complete JSON key as `GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON` on the
target Convex deployment. Select the target explicitly and pass the file on
standard input so the JSON never appears in the command line, shell history, or
Conductor command log.

For the current worktree-local deployment:

```bash
npx convex env set --deployment local GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON < /secure/path/spot-google-workspace.json
```

For shared dev or another named deployment:

```bash
npx convex env set --deployment <deployment-name> GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON < /secure/path/spot-google-workspace.json
```

The file path must point to an access-controlled temporary copy. The Convex CLI
reads its contents from standard input and does not print the value. Production
credential changes need separate production authorization; do not infer that
approval from this runbook.

After storing the credential, delete any unapproved local copy of the JSON key.
Do not use a public or `NEXT_PUBLIC_` environment variable, a Vercel browser
environment variable, or a Railway worker variable for this credential.

## Configure Spot

Sign in as an active operator and open **Channels → Google Workspace →
Configure**.

For manual mode:

1. Select **Manual mailboxes**.
2. Enter one primary Workspace mailbox address per line. Do not add aliases as
   separate mailboxes.
3. Enable the connection and save.

For directory mode:

1. Select **Workspace directory**.
2. Enter the primary Workspace email address of an active administrator who can
   list users in the Admin SDK. Spot uses this account only as the delegated
   Directory API subject.
3. Enable the connection and save.

The setup screen shows the client ID, service-account email, and exact scopes
read from the backend credential. Compare them with the Domain Wide Delegation
entry before verifying. Spot never accepts a private key in this screen.

Select **Verify connection** after saving. Verification reports directory and
per-mailbox results separately. A bounded verification may sample mailbox
access; it must not be read as proof that every mailbox in the organization was
checked. Review partial and failed rows before enabling operator use.

## Search behavior and provenance

Searches run against Gmail at request time. Results retain the mailbox,
message ID, thread ID, participants, date, and attachment provenance. Gmail
message and thread IDs are mailbox-scoped in Spot; always keep the mailbox with
an ID when troubleshooting or requesting an attachment.

The Gmail API accepts most Gmail search-box syntax, including `from:`, `to:`,
`subject:`, labels, and date filters. Two differences matter operationally:

- The API does not perform the Gmail web UI's alias expansion.
- The API does not perform thread-wide matching; it returns messages that match
  the query, after which Spot can read the associated thread.

Date-only filters are interpreted by Gmail at midnight Pacific time. Use Unix
seconds in `after:` and `before:` when an exact timezone boundary matters. See
Google's [Gmail search and filtering guide](https://developers.google.com/workspace/gmail/api/guides/filtering) and
[`users.messages.list` reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).

When searching correspondence sent through an alias, include that alias in the
query, for example `from:alias@example.com`; do not change the mailbox roster to
the alias.

Full thread reads use Gmail's full message payload, and attachments remain
bound to the mailbox and parent message that identified them. See the
[`users.threads.get` reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/get) and
[`users.messages.attachments.get` reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get).

## Troubleshooting

Start with **Channels → Google Workspace** and keep the directory diagnostic
separate from individual mailbox diagnostics.

| Symptom | Check |
| --- | --- |
| Credential missing | Set `GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON` on the exact Convex deployment serving the app, then reload status. |
| Client ID or service-account email differs | The backend credential and the Admin console authorization refer to different service accounts. Replace one side; do not add broader scopes to both. |
| Authorization or impersonation fails | Confirm the numeric client ID, exact scopes, domain-wide delegation setting, delegated subject, and propagation time. |
| Gmail API is unavailable | Confirm the Gmail API is enabled in the service account's Google Cloud project and Gmail is available for the impersonated account. |
| Directory lookup fails but manual mailboxes work | Confirm the Admin SDK API and `admin.directory.user.readonly` grant, then confirm the directory subject is an active Workspace administrator with permission to list users. |
| One mailbox fails | Confirm the address is a user mailbox in the same Workspace customer, is not suspended or archived, has Gmail available, and was not renamed. Other mailbox successes do not clear this failure. |
| Directory results appear incomplete | Continue through the returned pagination rather than treating one page as the full directory. Google's Directory page tokens are short-lived. |
| Search differs from Gmail web results | Check aliases, thread-wide expectations, spam/trash inclusion, and date timezone boundaries. |
| A recent delegation change still fails | Wait for Google's propagation window, which can be up to 24 hours, then verify again. Do not broaden scopes as a propagation workaround. |

Directory enumeration behavior and the `my_customer` alias are documented in
Google's [`users.list` reference](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users/list).
Provider errors shown by Spot are intentionally bounded and sanitized; inspect
configuration and Google audit surfaces instead of expecting raw SDK requests,
tokens, or credential material in Spot logs.

## Rotate or remove access

To rotate the key:

1. Create a replacement key for the same dedicated service account.
2. Replace `GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON` on the target Convex
   deployment by piping the replacement JSON to `convex env set` on standard
   input.
3. Verify the connection in Spot.
4. Delete the old key in Google Cloud and remove any local copy.

To retire the integration:

1. Disable Google Workspace in Spot.
2. Remove the client from **Manage Domain Wide Delegation** in the Google Admin
   console.
3. Delete or disable the service-account key in Google Cloud.
4. Remove the backend secret from the exact deployment:

   ```bash
   npx convex env remove --deployment <deployment-name> GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON
   ```

5. Verify that Channels reports the credential missing and the connection
   disabled.

Deleting the domain-wide delegation entry stops the delegated API access
immediately. Retain only the normal Spot operator audit and redacted
verification history; never retain the JSON key in tickets or test artifacts.
