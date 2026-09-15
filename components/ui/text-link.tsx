import type { ComponentPropsWithRef } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

type TextLinkProps = ComponentPropsWithRef<"a"> & { href: string };

export function TextLink({
  children,
  className,
  href,
  ...props
}: TextLinkProps) {
  const classes = cn(
    typeStyle("body.medium"),
    "inline-flex max-w-full items-baseline gap-1 text-muted-foreground hover:text-foreground focus-visible:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
    className,
  );
  const content = (
    <>
      <span className="underline underline-offset-4">{children}</span>
      <ArrowUpRight aria-hidden="true" className="size-[0.75em] shrink-0" />
    </>
  );

  if (
    href.startsWith("/") &&
    !href.startsWith("//") &&
    props.download === undefined
  ) {
    return (
      <Link href={href} prefetch className={classes} {...props}>
        {content}
      </Link>
    );
  }

  return (
    <a href={href} className={classes} {...props}>
      {content}
    </a>
  );
}
