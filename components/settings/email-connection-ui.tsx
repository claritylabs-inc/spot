"use client";

import type { SVGProps } from "react";
import { Mail } from "lucide-react";

import type { Id } from "@/convex/_generated/dataModel";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { OperationalPanel } from "@/components/ui/operational-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";

export type EmailScope = "user" | "org";

export type MailboxAutomation = {
  policyImports: boolean;
  requirementImports: boolean;
  companyMemory: boolean;
};

export type ConnectedEmailAccountRow = {
  _id: Id<"connectedEmailAccounts">;
  orgId: Id<"organizations">;
  userId?: Id<"users">;
  scope: EmailScope;
  label?: string;
  emailAddress: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  status: string;
  lastError?: string;
  lastTestedAt?: number;
  automation?: MailboxAutomation;
  automationConfigured?: boolean;
  lastScanAt?: number;
  lastScanError?: string;
  createdAt: number;
  updatedAt: number;
};

export const EMAIL_SCOPE_LABELS: Record<EmailScope, string> = {
  user: "Just me",
  org: "Everyone in the organization",
};

export const AUTOMATION_ENABLED: MailboxAutomation = {
  policyImports: true,
  requirementImports: true,
  companyMemory: true,
};

export const AUTOMATION_DISABLED: MailboxAutomation = {
  policyImports: false,
  requirementImports: false,
  companyMemory: false,
};

export function GoogleLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" {...props}>
      <path
        fill="#FFC107"
        d="M43.61 20.08H42V20H24v8h11.3C33.65 32.66 29.22 36 24 36c-6.63 0-12-5.37-12-12s5.37-12 12-12c3.06 0 5.84 1.15 7.96 3.04l5.66-5.66C34.05 6.05 29.27 4 24 4 12.95 4 4 12.95 4 24s8.95 20 20 20 20-8.95 20-20c0-1.34-.14-2.65-.39-3.92Z"
      />
      <path
        fill="#FF3D00"
        d="m6.31 14.69 6.57 4.82C14.66 15.11 18.96 12 24 12c3.06 0 5.84 1.15 7.96 3.04l5.66-5.66C34.05 6.05 29.27 4 24 4 16.32 4 9.66 8.34 6.31 14.69Z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.17 0 9.86-1.98 13.41-5.19l-6.19-5.24C29.14 35.15 26.63 36 24 36c-5.2 0-9.62-3.32-11.28-7.95l-6.52 5.02C9.51 39.56 16.23 44 24 44Z"
      />
      <path
        fill="#1976D2"
        d="M43.61 20.08H42V20H24v8h11.3a12.04 12.04 0 0 1-4.09 5.57l.01-.01 6.19 5.24C36.97 39.2 44 34 44 24c0-1.34-.14-2.65-.39-3.92Z"
      />
    </svg>
  );
}

export function MicrosoftLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 23 23" aria-hidden="true" {...props}>
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}

export function iconForMailboxHost(host: string) {
  const normalizedHost = host.toLowerCase();
  if (normalizedHost.includes("gmail") || normalizedHost.includes("google")) {
    return GoogleLogo;
  }
  if (
    normalizedHost.includes("outlook") ||
    normalizedHost.includes("office365") ||
    normalizedHost.includes("exchange")
  ) {
    return MicrosoftLogo;
  }
  return Mail;
}

export function configuredAutomation(account: ConnectedEmailAccountRow) {
  if (!account.automationConfigured) return AUTOMATION_DISABLED;
  return account.automation ?? AUTOMATION_DISABLED;
}

export function automationSummary(account: ConnectedEmailAccountRow) {
  if (!account.automationConfigured) {
    return account.scope === "org" ? "Alerts only" : "Monitoring off";
  }

  const automation = configuredAutomation(account);
  const enabled = [
    automation.policyImports ? "policies" : null,
    automation.requirementImports ? "requirements" : null,
    automation.companyMemory ? "company wiki" : null,
  ].filter(Boolean);

  if (enabled.length === 0) return "Monitoring off";
  if (enabled.length === 3) return "Policies, requirements, and company wiki";
  return enabled.join(" and ");
}

export function formatMailboxActivity(value?: number) {
  return formatDisplayDateTime(value, "Not yet");
}

export function EmailScopeSelect({
  value,
  onValueChange,
  allowOrgScope,
  disabled,
}: {
  value: EmailScope;
  onValueChange: (value: EmailScope) => void;
  allowOrgScope: boolean;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(nextValue) => {
        if (nextValue !== "user" && nextValue !== "org") return;
        if (nextValue === "org" && !allowOrgScope) return;
        onValueChange(nextValue);
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue>{EMAIL_SCOPE_LABELS[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="user">Just me</SelectItem>
        <SelectItem value="org" disabled={!allowOrgScope}>
          Everyone in the organization
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

export function AutomationToggleRows({
  value,
  onChange,
  disabled,
}: {
  value: MailboxAutomation;
  onChange: (value: MailboxAutomation) => void;
  disabled?: boolean;
}) {
  const rows: Array<{
    key: keyof MailboxAutomation;
    title: string;
    description: string;
  }> = [
    {
      key: "policyImports",
      title: "Policy documents",
      description: "Import insurance policies and supporting documents.",
    },
    {
      key: "requirementImports",
      title: "Insurance requirements",
      description: "Import requests from clients, lenders, landlords, and investors.",
    },
    {
      key: "companyMemory",
      title: "Company wiki",
      description: "Add durable company facts to the company wiki.",
    },
  ];

  return (
    <OperationalPanel as="div" className="divide-y divide-border">
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex items-center justify-between gap-4 px-4 py-3"
        >
          <div className="min-w-0">
            <p className={`text-foreground ${typeStyle("body.medium")}`}>{row.title}</p>
            <p className={`mt-0.5 text-muted-foreground ${typeStyle("body.default")}`}>
              {row.description}
            </p>
          </div>
          <SettingsSwitch
            checked={value[row.key]}
            disabled={disabled}
            onCheckedChange={() =>
              onChange({ ...value, [row.key]: !value[row.key] })
            }
            label={`Monitor ${row.title.toLowerCase()}`}
          />
        </div>
      ))}
    </OperationalPanel>
  );
}
