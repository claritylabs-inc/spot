export type SlackBlock = Record<string, unknown>;

export function slackBlockId(...parts: Array<string | number>): string {
  return parts.join("-").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 255);
}

export function truncateSlackText(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

export function escapeSlackMrkdwn(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
