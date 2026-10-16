import { Globe } from "lucide-react";

import { ChatChannelIcon } from "@/components/chat/channel-icon";
import type { OperatorAgentThread } from "@/lib/operator-agent-api";

export function OperatorThreadChannelIcon({
  channel,
  className,
}: {
  channel: OperatorAgentThread["channel"];
  className?: string;
}) {
  return <ChatChannelIcon channel={channel} fallback={Globe} className={className} />;
}
