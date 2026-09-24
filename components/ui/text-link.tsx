import * as React from "react";
import { TextLink as BaseTextLink } from "@claritylabs-inc/ui/components/text-link";
import Link from "next/link";

import { isInternalAppHref } from "@/lib/internal-link";

type BaseTextLinkProps = React.ComponentProps<typeof BaseTextLink>;

// Keep Next client navigation when rendering shared links.
export function TextLink({
  href,
  render,
  download,
  ...props
}: BaseTextLinkProps) {
  const resolvedRender =
    render ??
    (isInternalAppHref(href) && download === undefined ? (
      <Link href={href} prefetch />
    ) : undefined);

  return (
    <BaseTextLink
      href={href}
      download={download}
      render={resolvedRender}
      {...props}
    />
  );
}
