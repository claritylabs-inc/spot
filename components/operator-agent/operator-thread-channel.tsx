import { Globe, Mail, MessageCircle, SquareTerminal } from "lucide-react";
import { SiSlack } from "react-icons/si";

import type { OperatorAgentThread } from "@/lib/operator-agent-api";

export function operatorThreadChannelLabel(
  channel: OperatorAgentThread["channel"],
) {
  if (channel === "slack") return "Slack";
  if (channel === "imessage") return "iMessage";
  if (channel === "email") return "Email";
  if (channel === "mcp") return "MCP";
  return "Portal";
}

export function OperatorThreadChannelIcon({
  channel,
  className,
}: {
  channel: OperatorAgentThread["channel"];
  className?: string;
}) {
  if (channel === "slack") return <SiSlack className={className} />;
  if (channel === "imessage") return <MessageCircle className={className} />;
  if (channel === "email") return <Mail className={className} />;
  if (channel === "mcp") return <SquareTerminal className={className} />;
  return <Globe className={className} />;
}
