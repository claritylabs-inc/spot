import * as React from "react";
import Link from "next/link";
import {
  ActionSurface,
  ActionSurfaceButton,
  ActionSurfaceLink as BaseActionSurfaceLink,
} from "@claritylabs-inc/ui/components/action-surface";

type BaseActionSurfaceLinkProps = React.ComponentProps<
  typeof BaseActionSurfaceLink
>;

// Keep Next client navigation when rendering shared links.
function ActionSurfaceLink({
  href,
  render,
  ...props
}: BaseActionSurfaceLinkProps) {
  return (
    <BaseActionSurfaceLink
      href={href}
      render={render ?? <Link href={href} />}
      {...props}
    />
  );
}

export { ActionSurface, ActionSurfaceButton, ActionSurfaceLink };
