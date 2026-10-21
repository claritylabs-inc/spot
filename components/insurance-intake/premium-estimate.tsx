"use client";
import { Card, CardContent } from "@claritylabs-inc/ui/components/card";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import { typeStyle } from "@/lib/typography";

export function IntakePremiumEstimate({ estimate }: {estimate?: {
  status: "pending" | "running" | "completed" | "failed";
  currency: string; minimumMonthly?: number; maximumMonthly?: number;
}}) {
  const loading = !estimate || estimate.status === "pending" || estimate.status === "running";
  const ready = estimate?.status === "completed" && (estimate.minimumMonthly !== undefined || estimate.maximumMonthly !== undefined);
  const range = ready && estimate.minimumMonthly !== undefined && estimate.maximumMonthly !== undefined;
  if (!loading && !ready) return null;
  const format = (amount: number) => new Intl.NumberFormat("en-US", {style:"currency",currency:estimate?.currency ?? "USD",maximumFractionDigits:0}).format(amount);
  return <Card className="mt-6 border border-border py-0 ring-0" aria-label="Estimated monthly premium" aria-busy={loading}>
    <CardContent className="space-y-6 px-6 py-5">
      <div className="space-y-3">
        <h2 className={typeStyle("heading.item")}>Your estimated monthly premium</h2>
        <p className={`text-foreground/80 ${typeStyle("body.root")}`}>For all the coverages in your submitted application.</p>
      </div>
      {ready ? <>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={typeStyle("heading.page")}>{range ? `${format(estimate.minimumMonthly!)}–${format(estimate.maximumMonthly!)}` : estimate.minimumMonthly !== undefined ? `Starting from ${format(estimate.minimumMonthly)}` : `About ${format(estimate.maximumMonthly!)}`}</span>
          <span className={`text-foreground/80 ${typeStyle("body.root")}`}>{estimate.currency} / month</span>
        </div>
        {range && <div role="img" aria-label={`Rough estimated range: ${format(estimate.minimumMonthly!)} to ${format(estimate.maximumMonthly!)} ${estimate.currency} per month`} className="space-y-3">
          <div aria-hidden="true" className="relative h-2 rounded-full bg-muted">
            <div className="absolute inset-y-0 left-[12%] right-[12%] rounded-full bg-primary"/>
            <span className="absolute left-[12%] top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-background bg-primary"/>
            <span className="absolute right-[12%] top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-background bg-primary"/>
          </div>
          <div className={`flex justify-between text-foreground/80 ${typeStyle("body.root")}`} aria-hidden="true"><span>Lower estimate</span><span>Upper estimate</span></div>
        </div>}
      </> : loading ? <div role="status" className={`flex items-center gap-3 text-muted-foreground ${typeStyle("body.default")}`}>
        <Spinner aria-hidden="true" className="size-5 motion-reduce:animate-none" />
        <span>Estimating your monthly premium…</span>
      </div> : null}
    </CardContent>
  </Card>;
}
