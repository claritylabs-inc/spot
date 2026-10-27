"use client";
import { PlacementChecks, RecordCheck } from "./placement-checks";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import dayjs from "dayjs";
import { StatCard } from "@claritylabs-inc/ui/components/stat-card";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { ListToolbar } from "@/components/ui/list-toolbar";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHead,
  TableRow,
  SortableTableHead,
} from "@/components/ui/table";
import { useTableSort } from "@/hooks/use-table-sort";
import { useFollowedState, useLeaderOnly } from "@/hooks/use-followed-state";
import {
  OperationalPanel,
  OperationalPanelHeader,
  OperationalPanelBody,
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@claritylabs-inc/ui/components/operational-panel";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@claritylabs-inc/ui/components/tabs";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import { typeStyle } from "@/lib/typography";

type Mailbox = FunctionReturnType<
  typeof api.operatorSendingMailboxes.overview
>["mailboxes"][number];
const when = (value: number | null) =>
  value ? dayjs(value).format("MMM D, h:mm A") : "Not yet";
function Connection({
  mailbox,
  onClose,
}: {
  mailbox: Mailbox;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const connect = useLeaderOnly(
    useAction(api.actions.operatorSendingMailboxes.connect),
  );
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={mailbox.address}
    >
      <OperationalLabelValueList>
        <OperationalLabelValueRow
          label="Provider"
          value="Google Workspace · managed in InboxKit"
        />
        <OperationalLabelValueRow
          label="Purpose"
          value="Spot provider and client correspondence"
        />
        <OperationalLabelValueRow
          label="Warmup"
          value="Managed separately in Instantly"
        />
      </OperationalLabelValueList>
      <div className="space-y-4 pt-6" data-follow-private>
        {feedback ? (
          <p
            role="status"
            className={`text-muted-foreground ${typeStyle("body.default")}`}
          >
            {feedback}
          </p>
        ) : null}
        <p className={typeStyle("body.default")}>
          Connect this mailbox to your operator account. Spot verifies SMTP and
          IMAP access before storing its encrypted app password. Connecting does
          not send an email; sending stays paused until you resume it.
        </p>
        <label className={`block space-y-2 ${typeStyle("label.field")}`}>
          <span>Google app password</span>
          <Input
            type="password"
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="16-character app password"
          />
        </label>
        <PillButton
          disabled={busy || !password.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await connect({
                address: mailbox.address,
                appPassword: password,
              });
              setFeedback(result.message);
              toast[result.ok ? "success" : "error"](result.message);
              if (result.ok) {
                setPassword("");
                onClose();
              }
            } catch {
              toast.error(
                "Connection could not be verified. Check the mailbox and try again.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Verifying…" : "Verify connection"}
        </PillButton>
      </div>
    </SettingsDrawer>
  );
}
function Limits({ mailbox }: { mailbox: Mailbox }) {
  const update = useLeaderOnly(
    useMutation(api.operatorSendingMailboxes.setLimits),
  );
  const save = async (field: "dailyLimit" | "gapMinutes", value: string) => {
    if (!mailbox.id) return;
    const parsed = Number(value);
    if (parsed === mailbox[field]) return;
    try {
      await update({
        id: mailbox.id,
        dailyLimit: field === "dailyLimit" ? parsed : mailbox.dailyLimit,
        gapMinutes: field === "gapMinutes" ? parsed : mailbox.gapMinutes,
      });
    } catch {
      toast.error("Use 1–30 emails/day and a 5–60 minute gap.");
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={`Daily limit for ${mailbox.address}`}
        type="number"
        min={1}
        max={30}
        className="w-16"
        defaultValue={mailbox.dailyLimit}
        key={`${mailbox.address}:${mailbox.dailyLimit}`}
        onBlur={(e) => void save("dailyLimit", e.target.value)}
        disabled={!mailbox.id}
      />
      <span className="text-muted-foreground">/day</span>
      <Input
        aria-label={`Gap minutes for ${mailbox.address}`}
        type="number"
        min={5}
        max={60}
        className="w-16"
        defaultValue={mailbox.gapMinutes}
        key={`${mailbox.address}:${mailbox.gapMinutes}`}
        onBlur={(e) => void save("gapMinutes", e.target.value)}
        disabled={!mailbox.id}
      />
      <span className="text-muted-foreground">min</span>
    </div>
  );
}
export default function EmailHealth() {
  const data = useQuery(api.operatorSendingMailboxes.overview, {});
  const [placementOpen, setPlacementOpen] = useFollowedState(
    "email-health:placement-record",
    false,
  );
  const [view, setView] = useFollowedState("email-health:view", "mailboxes");
  const [selected, setSelected] = useFollowedState<string | null>(
    "email-health:mailbox",
    null,
  );
  const [search, setSearch] = useFollowedState("email-health:search", "");
  const [busy, setBusy] = useState<string | null>(null);
  const pause = useLeaderOnly(useMutation(api.operatorSendingMailboxes.pause));
  const sync = useLeaderOnly(
    useAction(api.actions.operatorSendingMailboxes.sync),
  );
  const columns = {
    address: (row: Mailbox) => row.address,
    status: (row: Mailbox) =>
      row.enabled ? "active" : row.id ? "paused" : "unconnected",
    sent: (row: Mailbox) => row.acceptedToday,
    sync: (row: Mailbox) => row.lastSyncAt,
  };
  const sorted = useTableSort(
    "email-health",
    (data?.mailboxes ?? []).filter((row) =>
      row.address.includes(search.toLowerCase()),
    ),
    columns,
    { key: "address", direction: "asc" },
  );
  const current = data?.mailboxes.find((row) => row.address === selected);
  const sent =
    data?.mailboxes.reduce((total, row) => total + row.acceptedToday, 0) ?? 0;
  const active = data?.mailboxes.filter((row) => row.enabled).length ?? 0;
  const issues = data?.mailboxes.filter((row) => row.error).length ?? 0;
  return (
    <AppShell
      rightPanel={
        placementOpen ? (
          <RecordCheck onClose={() => setPlacementOpen(false)} />
        ) : current ? (
          <Connection
            key={current.address}
            mailbox={current}
            onClose={() => setSelected(null)}
          />
        ) : undefined
      }
    >
      <div className="space-y-6 pb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl space-y-1">
            <p className={typeStyle("heading.section")}>
              Know what happens after Send.
            </p>
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              Mailbox connectivity, controlled sending and reply synchronization
              for insurewithspot.com.
            </p>
          </div>
          <StatusTag tone={data?.capture ? "warning" : "info"}>
            {data?.capture
              ? "Local capture · no external email"
              : "Live environment"}
          </StatusTag>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Active mailboxes",
              value: `${active} / 5`,
              detail: "Connected and enabled in Spot",
            },
            {
              label: "Reserved today",
              value: String(sent),
              detail: "Quota reservations; includes unresolved sends",
            },
            {
              label: "Connection issues",
              value: String(issues),
              detail: "Latest checks that need attention",
            },
            {
              label: "Inbox placement",
              value: data?.capture
                ? "Local preview"
                : data?.placementChecks?.length
                  ? `${data.placementChecks.filter((c) => c.placement === "Inbox").length} / ${data.placementChecks.length} seeds`
                  : "Not measured",
              detail: data?.capture
                ? "Live inbox placement has not been measured"
                : "Acceptance does not prove inbox delivery",
            },
          ].map((metric) => (
            <StatCard
              key={metric.label}
              label={metric.label}
              value={metric.value}
              description={metric.detail}
            />
          ))}
        </div>
        <OperationalPanel>
          <OperationalPanelHeader
            title="A dedicated sending domain"
            description="Spot handles correspondence and pacing. InboxKit manages the mailboxes. Instantly continues warmups."
          />
          <OperationalPanelBody>
            <div className="grid gap-6 md:grid-cols-3">
              {[
                {
                  title: "Send deliberately",
                  body: "Default: 20 emails per mailbox per day, spaced at least 10 minutes apart. Limits cover Spot traffic; allow for warmup and any other mailbox use.",
                },
                {
                  title: "Keep the conversation",
                  body: "Replies remain linked to the client and request. Older Resend addresses remain known so existing conversations can still receive replies.",
                },
                {
                  title: "Verify placement",
                  body: "Use realistic seed tests across Gmail and Microsoft before switching live traffic. A warmup score is separate evidence, not an inbox guarantee.",
                },
              ].map((item) => (
                <div key={item.title}>
                  <p className={typeStyle("body.medium")}>{item.title}</p>
                  <p
                    className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </OperationalPanelBody>
        </OperationalPanel>
        <ListToolbar
          followKey="email-health"
          tabs={
            <Tabs value={view} onValueChange={(value) => setView(value)}>
              <TabsList variant="pill">
                <TabsTrigger value="mailboxes">Mailboxes</TabsTrigger>
                <TabsTrigger value="activity">Sending activity</TabsTrigger>
                <TabsTrigger value="placement">Placement checks</TabsTrigger>
              </TabsList>
            </Tabs>
          }
          search={
            view === "mailboxes"
              ? {
                  value: search,
                  onChange: setSearch,
                  label: "Search sending mailboxes",
                  placeholder: "Search mailboxes",
                }
              : undefined
          }
        />
        {!data ? (
          <Skeleton className="h-64 w-full" />
        ) : view === "placement" ? (
          <PlacementChecks
            checks={data.placementChecks ?? []}
            onRecord={() => setPlacementOpen(true)}
          />
        ) : view === "mailboxes" ? (
          <OperationalPanel>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead {...sorted.head("address")}>
                    Mailbox
                  </SortableTableHead>
                  <SortableTableHead {...sorted.head("status")}>
                    Connection
                  </SortableTableHead>
                  <SortableTableHead {...sorted.head("sent")}>
                    Today
                  </SortableTableHead>
                  <TableHead>Sending limits</TableHead>
                  <SortableTableHead {...sorted.head("sync")}>
                    Last reply sync
                  </SortableTableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No mailboxes match your search.
                    </TableCell>
                  </TableRow>
                ) : null}
                {sorted.rows.map((mailbox) => (
                  <TableRow key={mailbox.address}>
                    <TableCell>
                      <p className={typeStyle("body.medium")}>
                        {mailbox.address}
                      </p>
                      <p
                        className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                      >
                        {mailbox.owner ?? "No operator connected"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusTag
                        tone={
                          mailbox.error
                            ? "danger"
                            : mailbox.enabled
                              ? "success"
                              : mailbox.id
                                ? "warning"
                                : "neutral"
                        }
                      >
                        {mailbox.error
                          ? "Needs attention"
                          : mailbox.enabled
                            ? "Active"
                            : mailbox.id
                              ? "Paused"
                              : "Not connected"}
                      </StatusTag>
                      {mailbox.error ? (
                        <p
                          className={`mt-2 max-w-xs text-destructive ${typeStyle("caption.default")}`}
                        >
                          {mailbox.error}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {mailbox.acceptedToday} / {mailbox.dailyLimit}
                    </TableCell>
                    <TableCell>
                      <Limits mailbox={mailbox} />
                    </TableCell>
                    <TableCell>{when(mailbox.lastSyncAt)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <PillButton
                          onClick={() => setSelected(mailbox.address)}
                        >
                          {mailbox.id ? "Reconnect" : "Connect"}
                        </PillButton>
                        {mailbox.id ? (
                          <>
                            <PillButton
                              disabled={busy === mailbox.address}
                              onClick={async () => {
                                setBusy(mailbox.address);
                                try {
                                  await pause({
                                    id: mailbox.id!,
                                    paused: mailbox.enabled,
                                  });
                                } catch {
                                  toast.error(
                                    "Mailbox status could not be updated.",
                                  );
                                } finally {
                                  setBusy(null);
                                }
                              }}
                            >
                              {mailbox.enabled ? "Pause" : "Resume"}
                            </PillButton>
                            <PillButton
                              disabled={busy === mailbox.address}
                              onClick={async () => {
                                setBusy(mailbox.address);
                                try {
                                  const result = await sync({
                                    address: mailbox.address,
                                  });
                                  toast[result.ok ? "success" : "error"](
                                    result.message,
                                  );
                                } catch {
                                  toast.error("Mailbox sync failed.");
                                } finally {
                                  setBusy(null);
                                }
                              }}
                            >
                              Check replies
                            </PillButton>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </OperationalPanel>
        ) : (
          <OperationalPanel>
            <OperationalPanelHeader
              title="Recent sending attempts"
              description={`Latest ${data.attempts.length} recorded attempts${data.attemptsLimited ? " · bounded to 100 records" : ""}. Sent means accepted by the sending service; inbox placement is not known.`}
            />
            <OperationalPanelBody>
              {data.attempts.length ? (
                data.attempts.map((attempt) => (
                  <div
                    key={attempt.id}
                    className="flex flex-wrap items-start justify-between gap-3 border-b border-border py-3 last:border-0"
                  >
                    <div>
                      <p className={typeStyle("body.medium")}>
                        {attempt.subject ?? "Email attempt"}
                      </p>
                      <p
                        className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                      >
                        {attempt.to ?? "Recipient unavailable"} ·{" "}
                        {attempt.provider === "google_smtp"
                          ? "Google Workspace"
                          : "Resend"}{" "}
                        · {when(attempt.at)}
                      </p>
                      {attempt.error ? (
                        <p
                          className={`mt-1 text-destructive ${typeStyle("body.default")}`}
                        >
                          {attempt.error}
                        </p>
                      ) : null}
                    </div>
                    <StatusTag
                      tone={
                        attempt.stage === "unknown"
                          ? "warning"
                          : attempt.status === "sent"
                            ? "info"
                            : attempt.status === "failed"
                              ? "danger"
                              : "neutral"
                      }
                    >
                      {attempt.stage === "unknown"
                        ? "Outcome unknown"
                        : attempt.status === "sent"
                          ? "Accepted"
                          : attempt.status}
                    </StatusTag>
                  </div>
                ))
              ) : (
                <p className="py-8 text-muted-foreground">
                  No sending attempts recorded in this environment.
                </p>
              )}
            </OperationalPanelBody>
          </OperationalPanel>
        )}
      </div>
    </AppShell>
  );
}
