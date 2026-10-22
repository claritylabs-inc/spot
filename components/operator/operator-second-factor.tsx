"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import dayjs from "dayjs";
import { useAction, useMutation, useQuery } from "convex/react";
import { renderSVG } from "uqr";
import { ArrowRight, Check, Copy, Loader2 } from "lucide-react";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { api } from "@/convex/_generated/api";
import { RECOVERY_CODE_COUNT } from "@/convex/lib/operatorSecondFactor";
import { OtpField } from "@/components/ui/otp-field";
import { PillButton } from "@/components/ui/pill-button";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

type CodeFailure =
  | { ok: false; reason: "invalid_code" | "not_enrolled" }
  | { ok: false; reason: "rate_limited"; retryAfter: number };

function failureMessage(failure: CodeFailure) {
  if (failure.reason === "rate_limited") {
    return `Too many attempts. Try again in ${Math.max(1, Math.ceil(failure.retryAfter / 1000))} seconds.`;
  }
  if (failure.reason === "not_enrolled") return "No authenticator is set up for this account.";
  return "That code didn't work.";
}

const inputClass = `h-9 w-full rounded-lg border border-input bg-popover px-3 placeholder:text-muted-foreground/40 focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-input ${typeStyle("control.input")}`;

function SubmitButton({ loading, disabled, label, loadingLabel }: { loading: boolean; disabled: boolean; label: string; loadingLabel: string }) {
  return (
    <PillButton type="submit" disabled={loading || disabled} className="justify-center">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {loading ? loadingLabel : label}
      {!loading ? <ArrowRight className="h-4 w-4" /> : null}
    </PillButton>
  );
}

function ErrorText({ error }: { error: string }) {
  return error ? <p role="alert" className={`text-muted-foreground ${typeStyle("body.default")}`}>{error}</p> : null;
}

export function RecoveryCodeList({ codes, onDone, doneLabel }: { codes: string[]; onDone: () => void; doneLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
        Save these recovery codes somewhere safe. Each one signs you in once if you lose your authenticator. They will not be shown again.
      </p>
      <ul className={`grid grid-cols-2 gap-2 rounded-lg border border-input bg-popover p-3 ${typeStyle("technical.code")}`}>
        {codes.map((code) => <li key={code}>{code}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <PillButton
          type="button"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(codes.join("\n")).then(() => setCopied(true));
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy codes"}
        </PillButton>
        <PillButton type="button" onClick={onDone}>
          {doneLabel}
          <ArrowRight className="h-4 w-4" />
        </PillButton>
      </div>
    </div>
  );
}

function Enrollment({ onDone }: { onDone: () => void }) {
  const beginEnrollment = useAction(api.actions.operatorSecondFactor.beginEnrollment);
  const confirmEnrollment = useAction(api.actions.operatorSecondFactor.confirmEnrollment);
  const [setup, setSetup] = useState<{ keyUri: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  // Remounting refocuses the first digit after a rejected code.
  const [attempt, setAttempt] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    beginEnrollment({})
      .then(setSetup)
      .catch((err: unknown) => setError(getUserFacingErrorMessage(err, "Could not start authenticator setup.")));
  }, [beginEnrollment]);

  const qrSrc = useMemo(
    () => (setup ? `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(setup.keyUri, { border: 2 }))}` : null),
    [setup],
  );

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await confirmEnrollment({ code });
      if (result.ok) setRecoveryCodes(result.recoveryCodes);
      else {
        setError(failureMessage(result));
        setCode("");
        setAttempt((n) => n + 1);
      }
    } catch (err) {
      setError(getUserFacingErrorMessage(err, "Could not verify that code."));
    } finally {
      setLoading(false);
    }
  }

  if (recoveryCodes) return <RecoveryCodeList codes={recoveryCodes} onDone={onDone} doneLabel="Continue to operator console" />;

  return (
    <form onSubmit={confirm} className="space-y-4">
      <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
        Operator access requires an authenticator app. Scan this code with 1Password, Google Authenticator, or a similar app, then enter the 6-digit code it shows.
      </p>
      {setup && qrSrc ? (
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrSrc} alt="Authenticator setup QR code" className="size-44 rounded-lg bg-white p-1" />
          <div>
            <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>Or enter this setup key manually</p>
            <p className={`break-all ${typeStyle("technical.code")}`}>{setup.secret}</p>
          </div>
        </div>
      ) : !error ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : null}
      <div>
        <label htmlFor="operator-totp-enroll" className={`mb-2 block text-muted-foreground ${typeStyle("label.field")}`}>
          Authenticator code
        </label>
        <OtpField key={attempt} id="operator-totp-enroll" value={code} onValueChange={setCode} label="Authenticator code" autoFocus={attempt > 0} disabled={!setup} required />
      </div>
      <ErrorText error={error} />
      <SubmitButton loading={loading} disabled={!setup || code.length < 6} label="Turn on two-factor" loadingLabel="Verifying..." />
    </form>
  );
}

function Challenge({ onDone }: { onDone: () => void }) {
  const verify = useAction(api.actions.operatorSecondFactor.verify);
  const verifyRecoveryCode = useMutation(api.operatorSecondFactor.verifyRecoveryCode);
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = mode === "totp" ? await verify({ code }) : await verifyRecoveryCode({ code });
      if (result.ok) {
        onDone();
        return;
      }
      setError(failureMessage(result));
      setCode("");
      setAttempt((n) => n + 1);
    } catch (err) {
      setError(getUserFacingErrorMessage(err, "Could not verify that code."));
    }
    setLoading(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {mode === "totp" ? (
        <div>
          <label htmlFor="operator-totp" className={`mb-2 block text-muted-foreground ${typeStyle("label.field")}`}>
            Authenticator code
          </label>
          <OtpField key={attempt} id="operator-totp" value={code} onValueChange={setCode} label="Authenticator code" autoFocus required />
          <p className={`mt-2 text-muted-foreground ${typeStyle("body.default")}`}>
            Enter the 6-digit code from your authenticator app.
          </p>
        </div>
      ) : (
        <div>
          <label htmlFor="operator-recovery-code" className={`mb-1.5 block text-muted-foreground ${typeStyle("label.field")}`}>
            Recovery code
          </label>
          <input
            id="operator-recovery-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="xxxxx-xxxxx"
            autoComplete="one-time-code"
            autoFocus
            required
            className={inputClass}
          />
        </div>
      )}
      <ErrorText error={error} />
      <SubmitButton
        loading={loading}
        disabled={mode === "totp" ? code.length < 6 : code.trim().length < 10}
        label="Verify and continue"
        loadingLabel="Verifying..."
      />
      <p>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "totp" ? "recovery" : "totp");
            setCode("");
            setError("");
          }}
          className={`text-muted-foreground hover:text-foreground ${typeStyle("caption.default")}`}
        >
          {mode === "totp" ? "Use a recovery code instead" : "Use your authenticator app"}
        </button>
      </p>
    </form>
  );
}

export function OperatorSecondFactor({ enrolled, onDone }: { enrolled: boolean; onDone: () => void }) {
  return enrolled ? <Challenge onDone={onDone} /> : <Enrollment onDone={onDone} />;
}

export function OperatorSecondFactorSettings() {
  const status = useQuery(api.operatorSecondFactor.status, {});
  const regenerate = useAction(api.actions.operatorSecondFactor.regenerateRecoveryCodes);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!status?.enrolled) return null;

  return (
    <OperationalPanel className="mt-4">
      <OperationalPanelHeader title="Two-factor authentication" />
      <OperationalPanelBody className="space-y-4">
        {codes ? (
          <RecoveryCodeList codes={codes} onDone={() => setCodes(null)} doneLabel="Done" />
        ) : (
          <>
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              Authenticator app on since {dayjs(status.enabledAt).format("MMM D, YYYY")}. {status.recoveryCodesRemaining} of {RECOVERY_CODE_COUNT} recovery codes left.
            </p>
            <ErrorText error={error} />
            <PillButton
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                setError("");
                regenerate({})
                  .then((result) => setCodes(result.recoveryCodes))
                  .catch((err: unknown) => setError(getUserFacingErrorMessage(err, "Could not create new recovery codes.")))
                  .finally(() => setLoading(false));
              }}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Replace recovery codes
            </PillButton>
          </>
        )}
      </OperationalPanelBody>
    </OperationalPanel>
  );
}
