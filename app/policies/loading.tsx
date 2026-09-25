import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";

export default function PoliciesLoading() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="flex min-h-44 min-w-0 flex-col rounded-xl border border-border p-4"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Skeleton className="size-8 rounded-md" />
              <Skeleton className="h-3.5 w-32" />
            </div>
            <div className="mt-5 mb-3 min-h-12 space-y-2">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-4 w-44 max-w-full" />
            </div>
            <div className="mt-auto grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)] gap-4 border-t border-border pt-3">
              {["w-20", "w-32"].map((width) => (
                <div key={width} className="min-w-0 space-y-2">
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className={`h-3.5 max-w-full ${width}`} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
