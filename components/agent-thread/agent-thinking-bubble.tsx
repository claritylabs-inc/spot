import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import { typeStyle } from "@/lib/typography";

export function AgentThinkingBubble() {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex min-h-9 items-center gap-2 text-muted-foreground/50 ${typeStyle("caption.default")}`}
    >
      <Spinner
        aria-hidden="true"
        role="presentation"
        aria-label={undefined}
        className="motion-reduce:animate-none"
      />
      <span>Thinking…</span>
    </div>
  );
}
