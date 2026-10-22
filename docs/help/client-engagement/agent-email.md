# Agent email

Agent email lets approved people work with Spot from an ordinary email thread.
Use it for document intake, policy questions, certificate requests, compliance
follow-up, and conversations that already include outside participants.

## Find the correct address

Open **Settings → Agent → Channels** and copy the address under **Agent email
address**. It normally looks like `<workspace>@spot.insure`. Always use the
address displayed in Spot rather than guessing a handle or using an older
domain.

An administrator can turn **Available by email** on or off. For a managed
client, the provider administrator controls who Spot recognizes as belonging to
that client.

## Recognized senders

The **Inbound email access** setting has three modes:

| Mode                        | Who enters the client workspace                                            |
| --------------------------- | -------------------------------------------------------------------------- |
| **Approved addresses**      | Only addresses listed in the setting                                       |
| **Client team**             | Approved addresses and current client team members                         |
| **Client team and domains** | Approved addresses, current team members, and anyone at an approved domain |

Approved addresses are useful for aliases or trusted outside contacts. Use an
approved domain only when every appropriate sender at that domain should be
recognized as the client.

Knowing the agent address is not authorization. An unrecognized sender is not
given access to client policies or other private workspace data.

## Ways to include Spot

### Email Spot directly

Put the Spot address in **To**, describe the request, and attach any relevant
documents. Spot replies to the sender.

### Copy Spot on a conversation

Put the Spot address in **Cc** when you want it to help within an existing
conversation. Spot keeps the relevant participants on the reply, so review the
recipient list before copying it onto a sensitive thread.

Put Spot in **To** or **Cc**, not **Bcc**. Inbound routing uses the visible
recipient list to select the correct agent and workspace.

### Forward a request

An approved team member can forward a request to Spot. When the original
sender can be identified safely, Spot can prepare the response for the
original conversation while keeping the forwarding team member involved. Add a
short instruction above the forwarded content so Spot knows what outcome you
want.

### Continue the same request

Reply in the existing email chain. Spot uses email reply headers and the
conversation subject to preserve the thread. Starting a new message with a new
subject may create a separate Spot thread.

## Attachments

Agent email accepts these attachment types for direct analysis:

- PDF;
- plain text, CSV, and HTML;
- DOC and DOCX;
- JPG, PNG, WebP, and GIF.

Each attachment may be up to 10 MB. For reliable policy intake, use a clear PDF
with the full document; converting older Word files to PDF also gives more
reliable analysis. If several PDFs belong to the same policy, attach them to the
same message and explain how they relate.

Spot may use an attachment to answer the email and, when requested or clearly
appropriate, begin policy-document extraction. If you only want a question
answered and do not want the document imported, say so.

## What Spot can do by email

Spot can look up policies and source evidence, compare coverage, check
requirements, inspect connected-vendor compliance, save approved notes, create
COIs, and process attached policy documents. It may draft or send a related
email when the workspace configuration and your confirmation allow it.

For a faster, safer result, include:

- the client and policy to use;
- the exact question or desired action;
- any effective date or deadline;
- the certificate holder's legal name and address for a COI; and
- which recipients should receive a draft or final document.

## Privacy and human support

Email is an AI-only Spot surface. A human operator does not silently join the
email thread. For a human handoff, use the dedicated Slack support channel or
contact the provider or service contact directly.

Email recipients can see the reply and any attachment. Remove unrelated
recipients before sharing private information. Spot avoids exposing internal
workspace links in a client-facing reply, but the sender remains responsible
for choosing the correct audience.

## Troubleshooting

### Spot did not reply

1. Confirm that the address exactly matches **Settings → Agent → Channels**.
2. Confirm that **Available by email** is on.
3. Check that your sender address is a team-member address, an approved address,
   or part of an approved domain under the selected mode.
4. Check spam and quarantine rules for the reply.
5. Reply once in the same chain instead of sending several duplicate messages.

### Spot cannot identify the client

Ask the provider administrator to review **Inbound email access**. Do not broaden
an approved domain merely to solve a one-person issue; adding that person's
exact address is safer.

### An attachment was ignored

Check the file type and the 10 MB per-file limit. For unsupported office or
archive formats, export the relevant content to PDF, DOCX, CSV, or plain text.

### The reply went to the wrong audience

Stop replying in that chain, review **To** and **Cc**, and start a clean message
to the Spot address with only the intended participants. Contact your service
team promptly if confidential information was sent to an unintended recipient.

### Spot asked for missing information

Reply in the same chain with the requested details. A certificate, endorsement,
or policy change may be held until the policy is fully processed and the
required facts are unambiguous.
