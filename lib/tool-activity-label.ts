/**
 * Sentence labels for tool activity rows, derived from the snake_case tool
 * name: the leading verb is conjugated and the rest is read as its object
 * ("search_company_email" → "Searched company email" / "Searching company
 * email" / "Search company email"). Names whose literal reading is awkward are spelled out.
 */
const VERBS: Record<
  string,
  readonly [past: string, progressive: string, imperative?: string]
> = {
  add: ["Added", "Adding"],
  archive: ["Archived", "Archiving"],
  attach: ["Attached", "Attaching"],
  call: ["Called", "Calling"],
  cancel: ["Cancelled", "Cancelling"],
  clear: ["Cleared", "Clearing"],
  compact: ["Compacted", "Compacting"],
  compare: ["Compared", "Comparing"],
  confirm: ["Confirmed", "Confirming"],
  control: ["Updated", "Updating", "Update"],
  create: ["Created", "Creating"],
  describe: ["Described", "Describing"],
  draft: ["Drafted", "Drafting"],
  ensure: ["Checked", "Checking", "Check"],
  expand: ["Expanded", "Expanding"],
  fetch: ["Fetched", "Fetching"],
  file: ["Filed", "Filing"],
  generate: ["Generated", "Generating"],
  get: ["Looked up", "Looking up", "Look up"],
  import: ["Imported", "Importing"],
  invite: ["Invited", "Inviting"],
  launch: ["Launched", "Launching"],
  link: ["Linked", "Linking"],
  list: ["Listed", "Listing"],
  lookup: ["Looked up", "Looking up", "Look up"],
  manage: ["Updated", "Updating", "Update"],
  preview: ["Previewed", "Previewing"],
  read: ["Read", "Reading"],
  reply: ["Replied to", "Replying to", "Reply to"],
  research: ["Researched", "Researching"],
  retry: ["Retried", "Retrying"],
  revoke: ["Revoked", "Revoking"],
  rotate: ["Rotated", "Rotating"],
  save: ["Saved", "Saving"],
  scan: ["Scanned", "Scanning"],
  search: ["Searched", "Searching"],
  select: ["Selected", "Selecting"],
  send: ["Sent", "Sending"],
  set: ["Set", "Setting"],
  stop: ["Stopped", "Stopping"],
  update: ["Updated", "Updating"],
};

const SPELLED: Record<
  string,
  readonly [past: string, progressive: string, imperative?: string]
> = {
  web_search: ["Searched the web", "Searching the web", "Search the web"],
  fetch_url: ["Opened a page", "Opening a page", "Open a page"],
  send_operator_slack_message: [
    "Sent a Slack message",
    "Sending a Slack message",
    "Send a Slack message",
  ],
  list_mcp_tools: [
    "Listed connected tools",
    "Listing connected tools",
    "List connected tools",
  ],
};

/** Past for calls that ran, progressive while running, imperative for calls
 * that have not run (awaiting approval, skipped). */
export type ToolLabelTense = "past" | "progressive" | "imperative";

function conjugate(
  verb: string,
  forms: readonly [string, string, string?],
  tense: ToolLabelTense,
) {
  if (tense === "past") return forms[0];
  if (tense === "progressive") return forms[1];
  return forms[2] ?? verb.charAt(0).toUpperCase() + verb.slice(1);
}

export function toolActivityLabel(name: string, tense: ToolLabelTense) {
  if (Object.hasOwn(SPELLED, name))
    return conjugate(name, SPELLED[name], tense);
  const [verb, ...rest] = name.split("_");
  const object = rest.join(" ");
  if (Object.hasOwn(VERBS, verb)) {
    const label = conjugate(verb, VERBS[verb], tense);
    return object ? `${label} ${object}` : label;
  }
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
