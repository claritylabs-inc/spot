import { LogoIcon } from "@/components/LogoIcon";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-8 text-center">
      <div>
        <p className="m-0 text-8xl font-bold leading-none tracking-tighter text-border">
          404
        </p>

        <h1 className="mt-2 font-heading text-4xl font-normal tracking-tight text-foreground">
          Nothing here
        </h1>

        <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
          This page doesn&apos;t exist. If you&apos;re looking to upload a
          policy, text Spot to get your link.
        </p>

        <a
          href="https://claritylabs.inc"
          className="mt-8 inline-block rounded-full bg-foreground px-6 py-2.5 text-sm text-white no-underline transition-opacity hover:opacity-90"
        >
          Go to Clarity Labs
        </a>

        <div className="mt-12 flex items-center justify-center gap-1.5 text-xs text-muted-foreground/50">
          <LogoIcon size={12} color="#9ca3af" />
          <span>Spot from Clarity Labs</span>
        </div>
      </div>
    </div>
  );
}
