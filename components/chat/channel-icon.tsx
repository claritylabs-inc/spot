import { Mail, MessageCircle, SquareTerminal, type LucideIcon } from "lucide-react";
import type { IconType } from "react-icons";
import { SiSlack } from "react-icons/si";

type ChannelIcon = LucideIcon | IconType;

const CHANNELS: Record<string, { icon: ChannelIcon; label: string }> = {
  email: { icon: Mail, label: "Email" },
  imessage: { icon: MessageCircle, label: "iMessage" },
  slack: { icon: SiSlack, label: "Slack" },
  mcp: { icon: SquareTerminal, label: "MCP" },
};

export function chatChannelLabel(channel: string | undefined, fallback: string) {
  return (channel && CHANNELS[channel]?.label) || fallback;
}

/** Icon for a message or thread channel; `fallback` covers plain web chat. */
export function ChatChannelIcon({
  channel,
  fallback,
  className,
}: {
  channel?: string;
  fallback?: ChannelIcon;
  className?: string;
}) {
  const Icon = (channel && CHANNELS[channel]?.icon) || fallback;
  return Icon ? <Icon className={className} /> : null;
}
