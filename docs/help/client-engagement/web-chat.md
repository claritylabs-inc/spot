# Web chat

Web chat is the fullest Spot experience. Use it when you want to inspect
sources, attach several documents, compare records, or complete a multi-step
service request.

## Start a conversation

1. Sign in at [app.spot.insure](https://app.spot.insure) and select the
   correct organization.
2. Start a new agent conversation from the app navigation.
3. Ask a specific question or describe the outcome you need.
4. Add a policy, requirement, or mailbox reference when the prompt offers one.
5. Attach supporting files before sending, if needed.

Useful prompts include:

- `Summarize our active cyber coverage and cite the policy wording.`
- `Compare the auto liability requirement with our current policy.`
- `Create a COI for this holder and show me the draft before any email is sent.`
- `Find the latest renewal email in my connected mailbox.`
- `What is still missing for this vendor to become compliant?`

## Attachments

Use the attachment control or drag files into the composer. Spot can read these
common formats as chat context:

- PDF;
- JPG, PNG, GIF, and WebP images;
- DOCX and PPTX;
- XLSX spreadsheets;
- CSV, TSV, TXT, Markdown, and JSON text files.

Legacy `.xls` and `.xlsm` spreadsheets are not read as chat context; save them
as `.xlsx`, `.csv`, or `.tsv` first. Large documents or several long
attachments may be truncated to the content most relevant to the current
conversation.

An attachment in a chat is context for that thread. If you want Spot to create
or update a durable policy or requirement record, say so explicitly.

## Answers, sources, and actions

The web thread can show more than plain text:

- source citations and policy evidence;
- attached original or generated PDFs;
- compliance and vendor-compliance results;
- mailbox search results;
- certificate and policy-change status;
- email drafts and send controls; and
- action progress, recoverable errors, or review holds.

For important coverage questions, open the cited source and confirm the wording.
If a policy is still processing, wait for final enrichment before requesting a
COI, endorsement, or exact source-backed confirmation.

## Conversation history

Use **All threads** to reopen active conversations and **Archive** for threads
you deliberately set aside. A new message arriving from an external channel can
restore its archived thread so current activity is not hidden.

Spot also mirrors supported external conversations:

- Email threads retain the email participants and message history.
- Direct iMessage threads are marked **Private**; replies sent from the web are
  delivered back to iMessage.
- Slack threads show **Open in Slack** and cannot be replied to from Spot.

Generated PDFs can be previewed or downloaded. When an answer contains several
files, Spot can download them together as a ZIP.

## Good practices

- Name the client, policy, location, certificate holder, or vendor when the
  request could refer to more than one record.
- Ask for source wording when the answer affects a decision.
- Review recipients and document details before confirming a send or change.
- Start a new thread when the subject and intended audience are unrelated to
  the current conversation.
- Avoid putting another organization's confidential information into the
  thread.

## Troubleshooting

### The answer says the policy is still processing

Spot has enough preliminary information for a summary but not enough finalized
evidence for the requested action. Wait for processing to complete, or open the
policy to see whether extraction needs review.

### Spot did not read a spreadsheet

Convert `.xls` or `.xlsm` files to `.xlsx`, `.csv`, or `.tsv`, then attach the
new file. If the workbook is very large, include the sheet name and rows that
matter in your prompt.

### An action is waiting for confirmation

Check the proposed policy, recipient, holder, and requested change, then use the
confirmation control in the thread. A team member without the required role may
need an administrator or provider to complete it.

### I cannot find an external conversation

Open **All threads**, confirm that you are in the correct organization, and
check **Archive**. Private Slack and iMessage mirrors appear only for their
mapped owner. A Slack conversation that cannot be mapped safely may remain
Slack-only.

### A response failed or stopped

Retry the message after checking the displayed error. If the agent is still
working, you can cancel the current run before retrying. Preserve the thread so
support can see the action history.
