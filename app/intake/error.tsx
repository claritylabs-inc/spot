"use client";
import { IntakeFrame } from "@/components/insurance-intake/frame";
import { typeStyle } from "@/lib/typography";
import { PillButton } from "@/components/ui/pill-button";
export default function IntakeError({ reset }: { reset: () => void }) {
  return (
    <IntakeFrame
      footer={
        <>
          <PillButton href="/signup" variant="secondary">
            Find my drafts
          </PillButton>
          <PillButton onClick={reset}>Try again</PillButton>
        </>
      }
    >
      <h1 className={`text-wrap-pretty ${typeStyle("heading.page")}`}>
        We couldn’t open this application
      </h1>
      <p>
        Check that you’re signed in to the account that started it. Your saved
        progress remains in your account.
      </p>
    </IntakeFrame>
  );
}
