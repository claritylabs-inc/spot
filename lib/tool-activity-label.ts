/**
 * Sentence labels for tool activity rows, derived from the snake_case tool
 * name: the leading verb is conjugated and the rest is read as its object
 * ("search_company_email" → "Searched company email" / "Searching company
 * email"). Names whose literal reading is awkward are spelled out.
 */
const VERBS: Record<string, readonly [past: string, progressive: string]> = {
  add: ["Added", "Adding"],
  archive: ["Archived", "Archiving"],
  attach: ["Attached", "Attaching"],
  call: ["Called", "Calling"],
  cancel: ["Cancelled", "Cancelling"],
  clear: ["Cleared", "Clearing"],
  compact: ["Compacted", "Compacting"],
  compare: ["Compared", "Comparing"],
  confirm: ["Confirmed", "Confirming"],
  control: ["Updated", "Updating"],
  create: ["Created", "Creating"],
  describe: ["Described", "Describing"],
  draft: ["Drafted", "Drafting"],
  ensure: ["Checked", "Checking"],
  expand: ["Expanded", "Expanding"],
  fetch: ["Fetched", "Fetching"],
  file: ["Filed", "Filing"],
  generate: ["Generated", "Generating"],
  get: ["Looked up", "Looking up"],
  import: ["Imported", "Importing"],
  invite: ["Invited", "Inviting"],
  launch: ["Launched", "Launching"],
  link: ["Linked", "Linking"],
  list: ["Listed", "Listing"],
  lookup: ["Looked up", "Looking up"],
  manage: ["Updated", "Updating"],
  preview: ["Previewed", "Previewing"],
  read: ["Read", "Reading"],
  reply: ["Replied to", "Replying to"],
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

const SPELLED: Record<string, readonly [past: string, progressive: string]> = {
  web_search: ["Searched the web", "Searching the web"],
  fetch_url: ["Opened a page", "Opening a page"],
  send_operator_slack_message: ["Sent a Slack message", "Sending a Slack message"],
  list_mcp_tools: ["Listed connected tools", "Listing connected tools"],
};

export type ToolLabelTense = "past" | "progressive";

export function toolActivityLabel(name: string, tense: ToolLabelTense) {
  const index = tense === "past" ? 0 : 1;
  if (Object.hasOwn(SPELLED, name)) return SPELLED[name][index];
  const [verb, ...rest] = name.split("_");
  const object = rest.join(" ");
  if (Object.hasOwn(VERBS, verb))
    return object ? `${VERBS[verb][index]} ${object}` : VERBS[verb][index];
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
