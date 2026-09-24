import * as React from "react";
import { LogoIcon as BaseLogoIcon } from "@claritylabs-inc/ui/components/brand/logo-icon";

type BaseLogoIconProps = React.ComponentProps<typeof BaseLogoIcon>;

type LogoIconProps = BaseLogoIconProps & {
  /** No longer meaningful — the package's mark is always static. Kept for call-site compatibility. */
  static?: boolean;
};

/** Canonical Spot globe for compact, icon-only product surfaces. */
function LogoIcon({ static: _static, ...props }: LogoIconProps) {
  return <BaseLogoIcon {...props} />;
}

export { LogoIcon };
export type { LogoIconProps };
