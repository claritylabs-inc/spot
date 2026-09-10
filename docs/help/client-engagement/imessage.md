# iMessage

iMessage is the fastest mobile way to ask Spot a question, send a document or
voice note, and coordinate in a group. It uses the same client workspace as web
chat while keeping the conversation in Messages.

This surface uses Apple iMessage. Do not assume a generic SMS conversation has
the same identity, attachment, or delivery behavior.

## Before you start

- Your phone number must be saved on your Spot profile and linked to the
  client organization.
- Save the Spot phone number shown by your workspace or in the Spot contact
  card. Do not rely on a number copied from another environment.
- **Available by iMessage** must be on under **Settings → Agent → Channels**.

Use the full phone number, including its country code, on your Spot profile.
A phone number can identify only the member and workspace to which it is
currently linked.

## Direct conversations

Send a normal text to Spot; no special prefix is required. A direct iMessage
conversation is mirrored into Spot as a **Private** thread for the mapped user.
You can continue that thread from the web app, and Spot sends the response back
to iMessage.

An unlinked number does not receive access to client information. It may receive
a constrained Spot demonstration instead.

## Group conversations

Spot supports iMessage groups. It uses the linked participants to determine
which organization context is available and shows speaker names in the web
thread.

- Every group participant can see messages and attachments sent to the group.
- If the group includes people from more than one organization, name the client
  or policy explicitly before asking Spot to act.
- An unlinked participant may contribute context but does not gain authority to
  change workspace data.
- Spot asks for confirmation before it creates a new group or performs a
  consequential action.
- Send `/leave` when you want Spot to leave the group.

For sensitive one-person questions, use a direct message instead of a group.

## Attachments and voice notes

iMessage accepts:

- PDF, TXT, and CSV files;
- JPEG, PNG, WebP, GIF, HEIC, and HEIF images; and
- common voice-note and audio formats, including M4A, AAC, MP3, WAV, and WebM.

Audio files may be up to 12 MiB. Spot transcribes a supported voice note before
responding. If the audio cannot be transcribed, resend it or send the key detail
as text.

Spot can return an original policy PDF or a generated document such as a COI.
If an expected file does not arrive, reply `resend` in the same conversation.

## Commands

Commands must be sent as their own message.

| Command                        | Purpose                                            |
| ------------------------------ | -------------------------------------------------- |
| `/help` or `/commands`         | Show the command list                              |
| `/status`                      | Show the current conversation or action status     |
| `/drafts`                      | List email drafts associated with the conversation |
| `/send 1` or `/send all`       | Send a numbered draft or every pending draft       |
| `/discard 1` or `/discard all` | Discard a numbered draft or every pending draft    |
| `/cancel`                      | Cancel the current agent run                       |
| `/reset` or `/new`             | Start fresh conversation context                   |
| `/whoami`                      | Show the identity and workspace Spot resolved     |
| `/leave`                       | Ask Spot to leave the current group               |

Except for help, identity-sensitive commands require a linked sender. Review a
draft's recipients and content before using `/send`.

## What to ask

iMessage works well for concise policy questions, compliance status, mailbox
searches, voice-note requests, COIs, and document retrieval. Include identifying
details when a workspace has several similar policies or vendors.

For long source wording, side-by-side comparisons, or several files, open the
mirrored thread in Spot. The web view gives more room for evidence and action
status.

## Notifications versus conversations

Spot can also send selected event notifications as text. Notification choices
are personal and live under **Settings → Workflows → Notifications**. Receiving
a notification does not change who can use the iMessage agent, and turning off
a notification category does not disable your active conversation.

## Troubleshooting

### Spot responds as if it does not know me

Check the phone number on your Spot profile, including country code. If you
recently changed numbers or organizations, ask an administrator to update the
member record, then use `/whoami` to verify the resolved identity.

### Spot does not respond

Confirm that **Available by iMessage** is on and that you are messaging the
current Spot number. In a group, confirm Spot has not left; if it has, start a
new group that includes the Spot number.

### A group request uses the wrong client context

Name the intended client and policy explicitly. If the action is sensitive,
move it to a direct conversation or the signed-in web app before confirming it.

### A voice note or file was ignored

Use one of the supported formats. Keep audio below 12 MiB, and resend essential
instructions as text if transcription fails.

### I need a human

iMessage is AI-only. Use the dedicated Slack support channel or contact the
broker or service contact listed in Spot.
