"use client";

import { useEffect, useId, useRef } from "react";
import { OTPFieldPreview as OTPField } from "@base-ui/react/otp-field";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

const slotClass =
  `min-w-0 flex-1 aspect-square max-h-14 rounded-lg border border-input bg-popover text-center text-foreground transition-colors focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-emphasized disabled:bg-foreground/[0.02] disabled:text-muted-foreground/60 ${typeStyle("technical.otp")}`;

export function OtpField({
  value,
  onValueChange,
  length = 6,
  label = "Verification code",
  autoFocus = false,
  disabled = false,
  required = false,
  className,
  id: idProp,
  name,
  paramDescription,
}: {
  value: string;
  onValueChange: (value: string) => void;
  length?: number;
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  /** Names the hidden input that carries the whole code in form submissions. */
  name?: string;
  /** WebMCP `toolparamdescription` for the named hidden input. */
  paramDescription?: string;
}) {
  const generatedId = useId();
  const inputId = idProp ?? generatedId;
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!name || !paramDescription) return;
    // Base UI renders the named hidden input beside the slot container.
    rootRef.current?.parentElement
      ?.querySelector(`input[name="${name}"]`)
      ?.setAttribute("toolparamdescription", paramDescription);
  }, [name, paramDescription]);
  return (
    <OTPField.Root
      ref={rootRef}
      id={inputId}
      name={name}
      length={length}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      required={required}
      className={cn("flex gap-2", className)}
    >
      {Array.from({ length }, (_, index) => (
        <OTPField.Input
          key={index}
          autoFocus={autoFocus && index === 0 ? true : undefined}
          aria-label={`${label}, digit ${index + 1} of ${length}`}
          className={slotClass}
        />
      ))}
    </OTPField.Root>
  );
}
