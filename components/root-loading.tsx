import { Loader2 } from "lucide-react";
import { typeStyle } from "@/lib/typography";

/** Neutral transition while the root route resolves the user's destination. */
export function RootLoading() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background text-foreground">
      <div
        role="status"
        className={`flex items-center gap-3 text-muted-foreground ${typeStyle("body.default")}`}
      >
        <Loader2
          aria-hidden="true"
          className="size-4 animate-spin motion-reduce:animate-none"
        />
        <span>Loading…</span>
      </div>
    </main>
  );
}
