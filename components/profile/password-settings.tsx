"use client";

import { useEffect, useState, type FormEvent } from "react";
import dayjs from "dayjs";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Field, FieldLabel } from "@claritylabs-inc/ui/components/field";
import { Input } from "@claritylabs-inc/ui/components/input";
import { OperationalPanel, OperationalPanelBody, OperationalPanelHeader } from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

export function PasswordSettings() {
  const status = useQuery(api.passwordAccounts.status, {});
  const setPassword = useAction(api.passwordAccounts.setPassword);
  const [editing, setEditing] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => dayjs().valueOf());
  useEffect(() => {
    const timer = setInterval(() => setNow(dayjs().valueOf()), 15_000);
    return () => clearInterval(timer);
  }, []);

  if (!status?.eligible) return null;
  const recentSignIn = status.recentSignInExpiresAt > now;
  const needsCurrentPassword = status.hasPassword && !recentSignIn;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await setPassword({ newPassword, ...(currentPassword ? { currentPassword } : {}) });
      setEditing(false);
      setNewPassword("");
      setCurrentPassword("");
      setMessage("Password saved. Other devices have been signed out. You can still sign in with an email code.");
    } catch (err) {
      setError(getUserFacingErrorMessage(err, "Could not save your password. Try signing in again with an email code."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <OperationalPanel className="mt-4">
      <OperationalPanelHeader title="Password" />
      <OperationalPanelBody className="space-y-4">
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          {status.hasPassword
            ? "You can sign in with your password or an email code."
            : "You sign in with an email code. Add a password if you prefer."}
        </p>
        {message && <p role="status" className={typeStyle("body.default")}>{message}</p>}
        {editing ? (
          <form onSubmit={save} className="max-w-md space-y-4">
            {needsCurrentPassword && (
              <Field>
                <FieldLabel htmlFor="current-password">Current password</FieldLabel>
                <Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <Input id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={256} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
              <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>Use at least 12 characters.</p>
            </Field>
            {error && <p role="alert" className={typeStyle("body.default")}>{error}</p>}
            <div className="flex gap-2">
              <PillButton type="submit" disabled={saving || newPassword.length < 12}>{saving ? "Saving…" : "Save password"}</PillButton>
              <PillButton type="button" variant="secondary" disabled={saving} onClick={() => { setEditing(false); setNewPassword(""); setCurrentPassword(""); setError(""); }}>Cancel</PillButton>
            </div>
            <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>Forgot your password? Sign out and use an email code to sign back in, then set a new password here.</p>
          </form>
        ) : !status.hasPassword && !recentSignIn ? (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>To set a password, sign out and sign back in with an email code, then return here.</p>
        ) : (
          <PillButton type="button" variant="secondary" onClick={() => { setEditing(true); setMessage(""); }}>
            {status.hasPassword ? "Change password" : "Set password"}
          </PillButton>
        )}
      </OperationalPanelBody>
    </OperationalPanel>
  );
}
