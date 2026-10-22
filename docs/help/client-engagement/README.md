# Client engagement channels

Spot gives a client team several ways to work with the same insurance
workspace. Choose the channel that fits the conversation; you do not need to
repeat the background each time a conversation is preserved in Spot.

## Choose a surface

| Surface                                     | Best for                                                                     | Start here                                                                                   | Typical visibility                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Web chat](web-chat.md)                     | Detailed policy questions, source review, files, and multi-step service work | Open Spot and start a conversation                                                           | Your organization; a thread marked **Private** is visible only to its owner                    |
| [Agent email](agent-email.md)               | Existing email chains, requests from approved senders, and document intake   | Email the address shown in **Settings → Agent → Channels**                                   | Email recipients and the client workspace selected from the sender and address                 |
| [iMessage](imessage.md)                     | Quick mobile questions, voice notes, files, and group coordination           | Message the Spot number from a phone linked to your profile                                  | Direct messages are private in Spot; group messages are shared with the group and organization |
| [Slack](slack.md)                           | Team collaboration and human support in shared channels                      | Install Spot, accept the separate support-channel invitation, or open the app's Messages tab | The Slack channel or DM audience; shared channel mirrors are visible in Spot                   |
| [Connected mailbox](connected-mailboxes.md) | Letting Spot search or monitor an existing mailbox                           | **Settings → Mailboxes**                                                                     | Live access follows the mailbox scope; imported workspace data is organization-visible         |
| [Notifications](notifications.md)           | Event alerts and status changes                                              | Bell menu or **Settings → Workflows → Notifications**                                        | The notified user, plus the workspace record the alert links to                                |

Agent email and connected mailboxes are different:

- **Agent email** is an address people send messages to when they want a reply
  from Spot.
- A **connected mailbox** is a mailbox Spot may search or monitor. Connecting
  one does not make it the address Spot uses to send agent replies.

## What follows you between channels

Spot stores the conversation and any approved workspace actions, not merely a
copy of the latest answer. Depending on the channel, a thread may include:

- policy and requirement references;
- source-backed answers and source links;
- uploaded or generated documents;
- certificate, policy-change, and email-draft status;
- workflow outcomes and failures; and
- a record of who requested or confirmed an action.

Email, iMessage, and Slack conversations can appear in **All threads** in the
web app. A Slack-origin thread is read-only in Spot; continue it in Slack.
An iMessage-origin thread can be continued from Spot and the response is sent
back to iMessage.

## Identity and workspace access

Spot determines workspace access differently on each surface:

| Surface  | How Spot recognizes you                                                                      |
| -------- | -------------------------------------------------------------------------------------------- |
| Web      | Your signed-in Spot account and current organization                                         |
| Email    | The sender address, the agent address used, and the client's inbound-email rules             |
| iMessage | The phone number linked to your Spot profile                                                 |
| Slack    | Your Slack workspace identity and, for a private web mirror, the email on your Slack profile |

An unrecognized sender is never granted a client's private workspace merely
because they know an agent address or phone number. They may receive a
constrained product demonstration or be routed for review without access to
client data.

## Shared and private conversations

Use a channel whose audience matches the information you plan to share.

- A public or shared Slack channel is visible to every member of that channel,
  including external participants in a Slack Connect channel.
- A Slack DM and a direct iMessage conversation are private in the Spot web
  mirror when Spot can map the sender to a current workspace member.
- A private Slack channel can be mirrored only to the mapped member who began
  the conversation. If no current member can be mapped, it remains in Slack
  and is not exposed to the wider Spot workspace.
- Email replies retain the relevant recipients. Check **To** and **Cc** before
  sending sensitive material into an existing chain.
- Connected-mailbox scope controls who may search the live mailbox. A policy,
  requirement, attachment, or company fact imported from it becomes ordinary
  workspace data and may be visible to the organization.

## Document readiness and confirmations

A newly uploaded policy may become available for a preliminary summary before
all source evidence has finished processing. Spot can answer broad questions
during that stage, but these operations wait for final processing:

- exact source-evidence confirmation;
- certificate generation;
- policy changes and endorsements; and
- other actions that depend on finalized policy facts.

Spot may ask for missing details or an explicit confirmation before a
consequential action. A request also has to be allowed by your workspace role.
See [Common service requests](service-requests.md) for the information to
include in common requests.

## Human help

The dedicated Slack Connect support channel is the channel where a Spot human
operator can join the same conversation. Email and iMessage are AI-only
surfaces. In Slack, mention Spot and send `human`, `person`, `operator`, or
`handoff`. You can also contact the provider or service contact listed in your
workspace.

For a claim, cancellation, binding instruction, or other time-sensitive legal
notice, follow the official notice method in the policy and contact the provider
or carrier directly. Do not rely on an AI conversation as formal notice.
