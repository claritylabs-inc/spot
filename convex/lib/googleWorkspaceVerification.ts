"use node";

import dayjs from "dayjs";
import {
  GOOGLE_WORKSPACE_LIMITS,
  type OperatorGoogleWorkspaceConfig,
  type OperatorGoogleWorkspaceDirectoryDiagnostic,
  type OperatorGoogleWorkspaceMailboxDiagnostic,
  type OperatorGoogleWorkspaceVerificationResult,
} from "./googleWorkspace";
import {
  isEligibleDirectoryMailbox,
  sanitizeGoogleWorkspaceError,
  type GoogleWorkspaceProvider,
} from "./googleWorkspaceProvider";

const DIRECTORY_PAGE_SIZE = 50;
const MAX_DIRECTORY_PAGES = 20;
const VERIFY_CONCURRENCY = 10;
const VERIFY_DEADLINE_MS = 60_000;

class VerificationDeadlineError extends Error {
  constructor() {
    super("Google Workspace verification reached its time limit.");
    this.name = "VerificationDeadlineError";
  }
}

async function withVerificationDeadline<T>(
  deadlineAt: number,
  operation: (signal: AbortSignal) => Promise<T>,
) {
  const remainingMs = deadlineAt - dayjs().valueOf();
  if (remainingMs <= 0) throw new VerificationDeadlineError();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new VerificationDeadlineError());
        }, remainingMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function directoryTargets(
  provider: GoogleWorkspaceProvider,
  config: OperatorGoogleWorkspaceConfig,
  deadlineAt: number,
): Promise<{
  mailboxes: string[];
  diagnostic: OperatorGoogleWorkspaceDirectoryDiagnostic;
}> {
  const adminEmail = config.directoryAdminEmail;
  if (!adminEmail) {
    return {
      mailboxes: [],
      diagnostic: {
        status: "failed",
        adminEmail: null,
        discoveredMailboxCount: 0,
        totalMailboxCount: null,
        hasMore: false,
        error: "Google Workspace directory mode is not configured.",
      },
    };
  }
  const mailboxes: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  try {
    do {
      const page = await withVerificationDeadline(deadlineAt, (signal) =>
        provider.listDirectoryUsers({
          subject: adminEmail,
          pageToken,
          maxResults: DIRECTORY_PAGE_SIZE,
          signal,
        }),
      );
      pages += 1;
      for (const user of page.users) {
        if (isEligibleDirectoryMailbox(user)) mailboxes.push(user.primaryEmail);
        if (
          mailboxes.length > GOOGLE_WORKSPACE_LIMITS.maxVerificationMailboxes
        ) {
          break;
        }
      }
      pageToken = page.nextPageToken ?? undefined;
    } while (
      pageToken &&
      pages < MAX_DIRECTORY_PAGES &&
      mailboxes.length <= GOOGLE_WORKSPACE_LIMITS.maxVerificationMailboxes
    );
  } catch (error) {
    const deadlineReached = error instanceof VerificationDeadlineError;
    return {
      mailboxes: deadlineReached
        ? mailboxes.slice(0, GOOGLE_WORKSPACE_LIMITS.maxVerificationMailboxes)
        : [],
      diagnostic: {
        status: deadlineReached && mailboxes.length ? "partial" : "failed",
        adminEmail,
        discoveredMailboxCount: Math.min(
          mailboxes.length,
          GOOGLE_WORKSPACE_LIMITS.maxVerificationMailboxes,
        ),
        totalMailboxCount: null,
        hasMore: deadlineReached || Boolean(pageToken),
        error: deadlineReached
          ? error.message
          : sanitizeGoogleWorkspaceError(error),
      },
    };
  }

  const hasMore =
    Boolean(pageToken) ||
    mailboxes.length > GOOGLE_WORKSPACE_LIMITS.maxVerificationMailboxes;
  const bounded = mailboxes.slice(
    0,
    GOOGLE_WORKSPACE_LIMITS.maxVerificationMailboxes,
  );
  return {
    mailboxes: bounded,
    diagnostic: {
      status: hasMore ? "partial" : "verified",
      adminEmail,
      discoveredMailboxCount: bounded.length,
      totalMailboxCount: hasMore ? null : bounded.length,
      hasMore,
      error: null,
    },
  };
}

export function failedGoogleWorkspaceVerification(
  config: OperatorGoogleWorkspaceConfig | null,
  error: string,
): OperatorGoogleWorkspaceVerificationResult {
  const directory = config?.mailboxMode === "directory";
  return {
    status: "failed",
    completeness: "partial",
    error,
    verifiedAt: dayjs().valueOf(),
    configUpdatedAt: config?.updatedAt ?? 0,
    checkedMailboxCount: 0,
    totalMailboxCount:
      config?.mailboxMode === "manual" ? config.mailboxes.length : null,
    maxMailboxChecks: GOOGLE_WORKSPACE_LIMITS.maxVerificationMailboxes,
    directory: {
      status: directory ? "failed" : "not_required",
      adminEmail: directory ? (config?.directoryAdminEmail ?? null) : null,
      discoveredMailboxCount: 0,
      totalMailboxCount: directory ? null : (config?.mailboxes.length ?? 0),
      hasMore: false,
      error: directory ? error : null,
    },
    mailboxes: [],
  };
}

export async function verifyGoogleWorkspaceConnection(
  provider: GoogleWorkspaceProvider,
  config: OperatorGoogleWorkspaceConfig,
  options: { deadlineMs?: number } = {},
): Promise<OperatorGoogleWorkspaceVerificationResult> {
  const deadlineAt = dayjs()
    .add(options.deadlineMs ?? VERIFY_DEADLINE_MS, "millisecond")
    .valueOf();
  let directory: OperatorGoogleWorkspaceDirectoryDiagnostic;
  let mailboxes: string[];
  if (config.mailboxMode === "directory") {
    const resolved = await directoryTargets(provider, config, deadlineAt);
    directory = resolved.diagnostic;
    mailboxes = resolved.mailboxes;
    if (directory.status === "failed") {
      return {
        status: "failed",
        completeness: "partial",
        error:
          directory.error ?? "Google Workspace directory verification failed.",
        verifiedAt: dayjs().valueOf(),
        configUpdatedAt: config.updatedAt,
        checkedMailboxCount: 0,
        totalMailboxCount: null,
        maxMailboxChecks: GOOGLE_WORKSPACE_LIMITS.maxVerificationMailboxes,
        directory,
        mailboxes: [],
      };
    }
  } else {
    mailboxes = config.mailboxes.slice(
      0,
      GOOGLE_WORKSPACE_LIMITS.maxVerificationMailboxes,
    );
    directory = {
      status: "not_required",
      adminEmail: null,
      discoveredMailboxCount: mailboxes.length,
      totalMailboxCount: config.mailboxes.length,
      hasMore:
        config.mailboxes.length >
        GOOGLE_WORKSPACE_LIMITS.maxVerificationMailboxes,
      error: null,
    };
  }

  const diagnostics: OperatorGoogleWorkspaceMailboxDiagnostic[] = [];
  let aggregateError = directory.error;
  for (
    let offset = 0;
    offset < mailboxes.length;
    offset += VERIFY_CONCURRENCY
  ) {
    const batch = mailboxes.slice(offset, offset + VERIFY_CONCURRENCY);
    const settled: Array<OperatorGoogleWorkspaceMailboxDiagnostic | undefined> =
      new Array(batch.length);
    try {
      const results = await withVerificationDeadline(deadlineAt, (signal) =>
        Promise.all(
          batch.map(
            async (
              mailbox,
              index,
            ): Promise<OperatorGoogleWorkspaceMailboxDiagnostic> => {
              let diagnostic: OperatorGoogleWorkspaceMailboxDiagnostic;
              try {
                await provider.getMailboxProfile(mailbox, { signal });
                diagnostic = { mailbox, status: "verified", error: null };
              } catch (error) {
                diagnostic = {
                  mailbox,
                  status: "failed",
                  error: signal.aborted
                    ? "Google Workspace verification reached its time limit."
                    : sanitizeGoogleWorkspaceError(error),
                };
              }
              if (!signal.aborted) settled[index] = diagnostic;
              return diagnostic;
            },
          ),
        ),
      );
      diagnostics.push(...results);
    } catch (error) {
      if (!(error instanceof VerificationDeadlineError)) throw error;
      aggregateError = error.message;
      diagnostics.push(
        ...settled.filter(
          (
            diagnostic,
          ): diagnostic is OperatorGoogleWorkspaceMailboxDiagnostic =>
            diagnostic !== undefined,
        ),
      );
      break;
    }
  }
  const successful = diagnostics.filter(
    (diagnostic) => diagnostic.status === "verified",
  ).length;
  const enumerationComplete = !directory.hasMore;
  const allSucceeded =
    diagnostics.length > 0 && successful === diagnostics.length;
  const allMailboxesChecked = diagnostics.length === mailboxes.length;
  const completeness =
    enumerationComplete && allMailboxesChecked && allSucceeded
      ? "complete"
      : "partial";
  return {
    ...(aggregateError ? { error: aggregateError } : {}),
    status:
      completeness === "complete"
        ? "verified"
        : successful > 0
          ? "partial"
          : "failed",
    completeness,
    verifiedAt: dayjs().valueOf(),
    configUpdatedAt: config.updatedAt,
    checkedMailboxCount: diagnostics.length,
    totalMailboxCount: enumerationComplete ? mailboxes.length : null,
    maxMailboxChecks: GOOGLE_WORKSPACE_LIMITS.maxVerificationMailboxes,
    directory,
    mailboxes: diagnostics,
  };
}
