import { createHmac, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import dayjs from "dayjs";
import {
  conductorPorts,
  parseEnvFile,
  repoRoot,
} from "./lib/conductor-workspace.mjs";

function option(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const fixtureEnvPath = path.join(repoRoot, ".context", "slack-fixture.env");
const signingSecret = existsSync(fixtureEnvPath)
  ? parseEnvFile(fixtureEnvPath).get("SLACK_SIGNING_SECRET")?.trim()
  : undefined;
if (!signingSecret) {
  throw new Error(
    "SLACK_SIGNING_SECRET is missing. Run npm run conductor:setup first.",
  );
}

const now = dayjs();
const messageTs = `${now.unix()}.${String(now.millisecond()).padStart(3, "0")}`;
const threadTs = option("thread", messageTs);
const text = option("text", "<@U-SPOT> summarize my current policy");
const teamId = option("team", "T-COVE-FIXTURE");
const channelId = option("channel", "C-COVE-FIXTURE");
const payload = {
  type: "event_callback",
  team_id: teamId,
  api_app_id: "A-SPOT-FIXTURE",
  event_id: `fixture-${randomUUID()}`,
  event_time: now.unix(),
  event: {
    type: "app_mention",
    ts: messageTs,
    thread_ts: threadTs,
    event_ts: messageTs,
    channel: channelId,
    channel_type: option(
      "channel-type",
      channelId.startsWith("D") ? "im" : "channel",
    ),
    user: option("user", "U-COVE-ADMIN"),
    user_team: teamId,
    text,
  },
};
const rawBody = JSON.stringify(payload);
const timestamp = String(now.unix());
const signature = `v0=${createHmac("sha256", signingSecret)
  .update(`v0:${timestamp}:${rawBody}`)
  .digest("hex")}`;
const { convexSite } = conductorPorts();
const response = await fetch(
  `http://127.0.0.1:${convexSite}/slack/events`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": signature,
    },
    body: rawBody,
  },
);
const body = await response.text();
if (!response.ok) {
  throw new Error(`Slack fixture failed (${response.status}): ${body}`);
}
console.log(body);
