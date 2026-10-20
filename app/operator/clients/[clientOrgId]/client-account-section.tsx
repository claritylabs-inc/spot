"use client";
import { WebsiteInput } from "@claritylabs-inc/ui/components/website-input";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@claritylabs-inc/ui/components/operational-panel";
import { StatusLabel } from "@claritylabs-inc/ui/components/status-tag";
import {
  OPERATOR_CLIENT_STATUSES,
  operatorClientStatuses,
  type OperatorClientRow,
} from "../client-model";
import { ClientLogoField } from "../client-logo-field";
export type ClientAccountDraft = {
  name: string;
  website: string;
  status: OperatorClientRow["clientAccessStatus"];
};
export function ClientAccountSection({
  client,
  editing,
  value,
  onChange,
  disabled,
}: {
  client: OperatorClientRow;
  editing: boolean;
  value: ClientAccountDraft;
  onChange: (value: ClientAccountDraft) => void;
  disabled?: boolean;
}) {
  if (!editing)
    return (
      <section data-review-content className="space-y-3">
        <OperationalLabelValueList>
          <OperationalLabelValueRow
            label="Organization name"
            value={value.name}
          />
          <OperationalLabelValueRow
            label="Website"
            value={value.website || "Not provided"}
          />
          <OperationalLabelValueRow
            label="Status"
            value={OPERATOR_CLIENT_STATUSES[value.status].label}
          />
        </OperationalLabelValueList>
      </section>
    );
  const { label: statusLabel, ...statusPresentation } =
    OPERATOR_CLIENT_STATUSES[value.status];
  return (
    <fieldset disabled={disabled} aria-label="Account">
      <InlineFieldCard>
        <InlineFieldRow label="Organization name">
          <Input
            aria-label="Organization name"
            value={value.name}
            onChange={(event) =>
              onChange({ ...value, name: event.target.value })
            }
          />
        </InlineFieldRow>
        <InlineFieldRow label="Website">
          <WebsiteInput
            aria-label="Website"
            value={value.website}
            onChange={(website) => onChange({ ...value, website })}
          />
        </InlineFieldRow>
        <InlineFieldRow label="Status">
          <Select
            value={value.status}
            items={operatorClientStatuses}
            disabled={disabled}
            onValueChange={(status) => {
              if (status && status in OPERATOR_CLIENT_STATUSES)
                onChange({
                  ...value,
                  status: status as ClientAccountDraft["status"],
                });
            }}
          >
            <SelectTrigger className="w-full" aria-label="Status">
              <SelectValue>
                <StatusLabel {...statusPresentation}>{statusLabel}</StatusLabel>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(OPERATOR_CLIENT_STATUSES).map(
                ([id, { label, ...presentation }]) => (
                  <SelectItem key={id} value={id}>
                    <StatusLabel {...presentation}>{label}</StatusLabel>
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </InlineFieldRow>
        <InlineFieldRow label="Logo">
          <ClientLogoField client={client} disabled={disabled} hideLabel />
        </InlineFieldRow>
      </InlineFieldCard>
    </fieldset>
  );
}
