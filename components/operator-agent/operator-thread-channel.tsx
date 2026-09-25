import { Globe } from "lucide-react";

import { ChatChannelIcon, chatChannelLabel } from "@/components/chat/channel-icon";
import type { OperatorAgentThread } from "@/lib/operator-agent-api";

export function operatorThreadChannelLabel(
  channel: OperatorAgentThread["channel"],
) {
  return chatChannelLabel(channel, "Portal");
}

export function OperatorThreadChannelIcon({
  channel,
  className,
}: {
  channel: OperatorAgentThread["channel"];
  className?: string;
}) {
  return <ChatChannelIcon channel={channel} fallback={Globe} className={className} />;
}
