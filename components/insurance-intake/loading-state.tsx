import { Card, CardContent } from "@claritylabs-inc/ui/components/card";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import { typeStyle } from "@/lib/typography";

/** One announced status, with decorative placeholders that respect reduced motion. */
export function IntakeLoadingState({
  title = "Loading your application",
  description = "Getting your saved answers ready.",
  compact = false,
}: {
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  if (compact) return (
    <Card role="status" aria-live="polite" aria-busy="true">
      <CardContent className="flex items-start gap-3 p-5">
        <Spinner aria-hidden="true" className="mt-1 size-5 shrink-0 motion-reduce:animate-none" />
        <div className="space-y-2">
          <p className={typeStyle("heading.item")}>{title}</p>
          <p className={`text-muted-foreground ${typeStyle("body.root")}`}>{description}</p>
        </div>
      </CardContent>
    </Card>
  );
  return (
    <Card role="status" aria-live="polite" aria-busy="true">
      <CardContent className="space-y-8 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <Spinner
              aria-hidden="true"
              className="size-5 motion-reduce:animate-none"
            />
          </div>
          <div className="min-w-0 space-y-1">
            <p className={typeStyle("heading.micro")}>{title}</p>
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              {description}
            </p>
          </div>
        </div>
        <div aria-hidden="true" className="space-y-6 motion-safe:animate-pulse">
          {["w-1/3", "w-1/2"].map((width) => (
            <div key={width} className="space-y-3">
              <Skeleton className={`h-4 ${width}`} />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
