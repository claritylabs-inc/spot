"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import dayjs from "dayjs";
import { api } from "@/convex/_generated/api";
import { SENDING_ADDRESSES } from "@/convex/lib/sendingMailbox";
import { useFollowedState, useLeaderOnly } from "@/hooks/use-followed-state";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import {
  OperationalPanel,
  OperationalPanelHeader,
  OperationalPanelBody,
} from "@claritylabs-inc/ui/components/operational-panel";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { typeStyle } from "@/lib/typography";
type Check = FunctionReturnType<
  typeof api.operatorSendingMailboxes.overview
>["placementChecks"][number];
function Choice<T extends string>({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: T;
  values: readonly T[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useFollowedState(
    `email-health:placement:${label}`,
    false,
  );
  return (
    <label className="block space-y-2">
      <span className={typeStyle("label.field")}>{label}</span>
      <Select
        value={value}
        onValueChange={(v) => {
          if (v) onChange(v);
        }}
        open={open}
        onOpenChange={setOpen}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue>{value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {values.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
export function RecordCheck({ onClose }: { onClose: () => void }) {
  const [sender, setSender] = useState("zac@insurewithspot.com");
  const [destination, setDestination] = useState<Check["destination"]>("Gmail");
  const [placement, setPlacement] = useState<Check["placement"]>("Inbox");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const record = useLeaderOnly(
    useMutation(api.operatorSendingMailboxes.recordPlacement),
  );
  return (
    <SettingsDrawer
      open
      title="Record placement check"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <div className="space-y-5">
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          Record where a test email actually arrived after checking the
          recipient mailbox. This saves an observation; it does not send an
          email.
        </p>
        <Choice
          label="Sender"
          value={sender}
          values={SENDING_ADDRESSES}
          onChange={setSender}
        />
        <Choice
          label="Recipient service"
          value={destination}
          values={["Gmail", "Microsoft", "Other"]}
          onChange={setDestination}
        />
        <Choice
          label="Observed placement"
          value={placement}
          values={["Inbox", "Spam", "Missing"]}
          onChange={setPlacement}
        />
        <label className="block space-y-2">
          <span className={typeStyle("label.field")}>Evidence notes</span>
          <Input
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Authentication results or test reference"
          />
        </label>
        <PillButton
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await record({ sender, destination, placement, note });
              toast.success("Placement observation recorded");
              onClose();
            } catch {
              toast.error("Observation could not be saved.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Recording…" : "Record observation"}
        </PillButton>
      </div>
    </SettingsDrawer>
  );
}
export function PlacementChecks({
  checks,
  onRecord,
}: {
  checks: Check[];
  onRecord: () => void;
}) {
  return (
    <>
      <OperationalPanel>
        <OperationalPanelHeader
          title="Observed inbox placement"
          description="Latest 100 manual seed observations. These are individual checks, not a measure of provider-wide inbox delivery."
          action={<PillButton onClick={onRecord}>Record check</PillButton>}
        />
        <OperationalPanelBody>
          {checks.length ? (
            checks.map((check) => (
              <div
                key={check._id}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-border py-3 last:border-0"
              >
                <div>
                  <p className={typeStyle("body.medium")}>{check.sender}</p>
                  <p
                    className={`text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    {check.destination} ·{" "}
                    {dayjs(check.checkedAt).format("MMM D, h:mm A")} · Manually
                    observed
                  </p>
                  {check.note ? (
                    <p
                      className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
                    >
                      {check.note}
                    </p>
                  ) : null}
                </div>
                <StatusTag
                  tone={check.placement === "Inbox" ? "success" : "warning"}
                >
                  {check.placement}
                </StatusTag>
              </div>
            ))
          ) : (
            <p
              className={`py-6 text-muted-foreground ${typeStyle("body.default")}`}
            >
              No placement checks recorded. Check realistic seed messages in
              Gmail and Microsoft, then record the results here.
            </p>
          )}
        </OperationalPanelBody>
      </OperationalPanel>
    </>
  );
}
