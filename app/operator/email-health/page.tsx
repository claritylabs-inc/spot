"use client";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import dayjs from "dayjs";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PageTabsRail, PageTabsList } from "@/components/ui/folder-tabs";
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
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@claritylabs-inc/ui/components/operational-panel";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { Input } from "@claritylabs-inc/ui/components/input";
import { TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import { typeStyle } from "@/lib/typography";
import { PlacementChecks, RecordCheck } from "./placement-checks";
type Mailbox = FunctionReturnType<
  typeof api.operatorSendingMailboxes.overview
>["mailboxes"][number];
const when = (value: number | null) =>
  value ? dayjs(value).format("MMM D, h:mm A") : "—";
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
        {mailbox.owner ? (
          <OperationalLabelValueRow
            label="Connected by"
            value={mailbox.owner}
          />
        ) : null}
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
          Connect with the Google app password from InboxKit. Sending uses
          automatic defaults and stays paused until resumed.
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
          disabled={busy || !password.trim() || !mailbox.canManage}
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
export default function EmailHealth() {
  const data = useQuery(api.operatorSendingMailboxes.overview, {});
  const [view, setView] = useFollowedState("email-health:view", "mailboxes");
  const [selected, setSelected] = useFollowedState<string | null>(
    "email-health:mailbox",
    null,
  );
  const [placementOpen, setPlacementOpen] = useFollowedState(
    "email-health:placement-record",
    false,
  );
  const [search, setSearch] = useFollowedState("email-health:search", "");
  const [busy, setBusy] = useState<string | null>(null);
  const pause = useLeaderOnly(useMutation(api.operatorSendingMailboxes.pause));
  const makeDefault = useLeaderOnly(
    useMutation(api.operatorSendingMailboxes.makeDefault),
  );
  const sync = useLeaderOnly(
    useAction(api.actions.operatorSendingMailboxes.sync),
  );
  const columns = {
    address: (row: Mailbox) => row.address,
    status: (row: Mailbox) =>
      row.error ? "error" : row.id ? "connected" : "unconnected",
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
  async function act(address: string, run: () => Promise<unknown>) {
    setBusy(address);
    try {
      await run();
    } catch {
      toast.error("Mailbox could not be updated. Please try again.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <AppShell
      actions={
        data?.capture || data?.restricted ? (
          <StatusTag tone="warning">
            {data.capture ? "Sending captured" : "Test recipients only"}
          </StatusTag>
        ) : undefined
      }
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
      <div className="space-y-4">
        <ListToolbar
          followKey="email-health"
          tabsPlacement="navbar"
          tabs={
            <PageTabsRail value={view} onValueChange={setView}>
              <PageTabsList>
                <TabsTrigger value="mailboxes">Mailboxes</TabsTrigger>
                <TabsTrigger value="activity">Sending activity</TabsTrigger>
                <TabsTrigger value="placement">Placement checks</TabsTrigger>
              </PageTabsList>
            </PageTabsRail>
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
            checks={data.placementChecks}
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
                  <TableHead>Sender</TableHead>
                  <SortableTableHead {...sorted.head("sent")}>
                    Today
                  </SortableTableHead>
                  <SortableTableHead {...sorted.head("sync")}>
                    Last checked
                  </SortableTableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!sorted.rows.length ? (
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
                      <PillButton
                        variant="ghost"
                        size="compact"
                        onClick={() => setSelected(mailbox.address)}
                      >
                        {mailbox.address}
                      </PillButton>
                    </TableCell>
                    <TableCell>
                      <StatusTag
                        tone={
                          mailbox.error
                            ? "danger"
                            : mailbox.id
                              ? "success"
                              : "neutral"
                        }
                      >
                        {mailbox.error
                          ? "Needs attention"
                          : mailbox.id
                            ? "Connected"
                            : "Not connected"}
                      </StatusTag>
                      {mailbox.error ? (
                        <p
                          className={`mt-1 max-w-xs text-destructive ${typeStyle("caption.default")}`}
                        >
                          {mailbox.error}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {mailbox.isDefault ? (
                        <StatusTag tone={mailbox.enabled ? "info" : "warning"}>
                          {mailbox.enabled ? "Default" : "Default · paused"}
                        </StatusTag>
                      ) : mailbox.id && mailbox.canManage ? (
                        <PillButton
                          variant="ghost"
                          size="compact"
                          disabled={busy === mailbox.address}
                          onClick={() =>
                            void act(mailbox.address, () =>
                              makeDefault({ id: mailbox.id! }),
                            )
                          }
                        >
                          Use for sending
                        </PillButton>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{mailbox.acceptedToday}</TableCell>
                    <TableCell>{when(mailbox.lastSyncAt)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <PillButton
                          variant={mailbox.id ? "ghost" : "primary"}
                          size="compact"
                          disabled={!mailbox.canManage}
                          onClick={() => setSelected(mailbox.address)}
                        >
                          {mailbox.id ? "Reconnect" : "Connect"}
                        </PillButton>
                        {mailbox.id ? (
                          <>
                            <PillButton
                              variant="ghost"
                              size="compact"
                              disabled={busy === mailbox.address}
                              onClick={() =>
                                void act(mailbox.address, async () => {
                                  const result = await sync({
                                    address: mailbox.address,
                                  });
                                  toast[result.ok ? "success" : "error"](
                                    result.message,
                                  );
                                })
                              }
                            >
                              Check replies
                            </PillButton>
                            <PillButton
                              variant="ghost"
                              size="compact"
                              disabled={
                                busy === mailbox.address || !mailbox.canManage
                              }
                              onClick={() =>
                                void act(mailbox.address, () =>
                                  pause({
                                    id: mailbox.id!,
                                    paused: mailbox.enabled,
                                  }),
                                )
                              }
                            >
                              {mailbox.enabled ? "Pause" : "Resume"}
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.attempts.length ? (
                  data.attempts.map((attempt) => (
                    <TableRow key={attempt.id}>
                      <TableCell>
                        <p className={typeStyle("body.medium")}>
                          {attempt.subject ?? "Email attempt"}
                        </p>
                        <p
                          className={`text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          {attempt.to ?? "Recipient unavailable"}
                        </p>
                        {attempt.error ? (
                          <p
                            className={`text-destructive ${typeStyle("caption.default")}`}
                          >
                            {attempt.error}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {attempt.provider === "google_smtp"
                          ? "Google Workspace"
                          : "Resend"}
                      </TableCell>
                      <TableCell>
                        <StatusTag
                          tone={
                            attempt.stage === "unknown"
                              ? "warning"
                              : attempt.status === "sent"
                                ? "success"
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
                      </TableCell>
                      <TableCell>{when(attempt.at)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No sending activity yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </OperationalPanel>
        )}
      </div>
    </AppShell>
  );
}
