"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { stableHash, useSyncStore, type SyncStore } from "@claritylabs/cl-sync";
import {
  createAutoSaveSequencer,
  hasRebasedAutoSaveIntent,
  isCurrentAutoSaveRequest,
  isDivergentAutoSaveRequest,
  type AutoSaveRequestIdentity,
  type AutoSaveRequestState,
} from "@/lib/sync/auto-save-sequencer";
import { createClientMutationId } from "@/lib/sync/client-mutation-id";
import { changedByTeammate, leadsSharedRoom } from "@/lib/collab/doc";
import { getPermissionErrorMessage } from "@/lib/user-facing-error";

type LocalFirstAutoSaveOptions<TArgs, TResult> = {
  mutationName: string;
  args: TArgs;
  valueKey?: string;
  resetKey?: string;
  enabled?: boolean;
  canSave?: boolean;
  delayMs?: number;
  autoSave?: boolean;
  applyLocal?: (
    store: SyncStore,
    args: TArgs,
    clientMutationId: string,
  ) => void;
  flush: (args: TArgs, clientMutationId: string) => Promise<TResult>;
  onFlushed?: (result: TResult | undefined, args: TArgs) => void;
  onError?: (error: unknown, args: TArgs) => void;
  errorMessage?: string | ((error: unknown, args: TArgs) => string);
  /**
   * The saved value as the server has it now, in the shape of `args`. With
   * `adopt`, edits saved elsewhere (the Spot agent, an MCP client, anyone not
   * on the page) show up live the way a teammate's do: every field this
   * browser has not edited since takes the saved value.
   */
  source?: TArgs;
  /** Sets the form to `args` with the edits saved elsewhere brought in. */
  adopt?: (next: TArgs) => void;
};

/**
 * How long a browser sharing the page without leading it waits for the leader
 * to bring a saved edit in through the room before bringing in what never
 * arrived itself; both writing the same edit to the room would double it.
 */
const FOLLOWER_ADOPT_DELAY_MS = 1_500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `local` with the changes from `base` to `saved` in every part it has not
 * changed itself. A part both changed keeps this browser's value, which may
 * already hold a teammate's newer text than the save.
 */
function mergeSaved(base: unknown, saved: unknown, local: unknown): unknown {
  if (stableHash(local) === stableHash(base)) return saved;
  if (!isRecord(base) || !isRecord(saved) || !isRecord(local)) return local;
  const merged: Record<string, unknown> = {};
  for (const key of new Set([
    ...Object.keys(base),
    ...Object.keys(saved),
    ...Object.keys(local),
  ])) {
    const value = mergeSaved(base[key], saved[key], local[key]);
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

export type AutoSaveStatus = "saved" | "saving" | "unsaved" | "error";

type PendingAutoSaveRequest = AutoSaveRequestIdentity & {
  promise: Promise<boolean>;
  completion: Promise<boolean>;
};

export function useLocalFirstAutoSave<TArgs, TResult = unknown>({
  mutationName,
  args,
  valueKey = stableHash(args),
  resetKey = mutationName,
  enabled = true,
  canSave = true,
  delayMs = 600,
  autoSave = true,
  applyLocal,
  flush,
  onFlushed,
  onError,
  errorMessage = "Check your connection and try again.",
  source,
  adopt,
}: LocalFirstAutoSaveOptions<TArgs, TResult>) {
  const store = useSyncStore();
  const [sequencer] = useState(createAutoSaveSequencer);
  const [resetGeneration, setResetGeneration] = useState(0);
  const [intentRevision, setIntentRevision] = useState(0);
  const [resetIntentRevision, setResetIntentRevision] = useState(0);
  const [failedSave, setFailedSave] = useState<AutoSaveRequestIdentity | null>(
    null,
  );
  const [latestRequests, setLatestRequests] = useState(
    () => new Map<string, AutoSaveRequestState>(),
  );
  const [lastSavedKey, setLastSavedKey] = useState(valueKey);
  const [settledResetKey, setSettledResetKey] = useState(resetKey);
  const [enabledBaselineKey, setEnabledBaselineKey] = useState<string | null>(
    enabled ? valueKey : null,
  );
  const lastSavedKeyRef = useRef(valueKey);
  const wasEnabledRef = useRef(enabled);
  const lastResetKeyRef = useRef(resetKey);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSavesRef = useRef(new Map<string, PendingAutoSaveRequest>());
  const failedSaveRef = useRef<AutoSaveRequestIdentity | null>(null);
  const latestRequestsRef = useRef(new Map<string, AutoSaveRequestState>());
  const resetGenerationRef = useRef(0);
  const nextRequestIdRef = useRef(0);
  const intentRevisionRef = useRef(0);
  const resetIntentRevisionRef = useRef(0);
  const lastIntentRef = useRef({ resetKey, valueKey });
  const argsRef = useRef(args);
  const valueKeyRef = useRef(valueKey);
  const resetKeyRef = useRef(resetKey);
  const enabledRef = useRef(enabled);
  const canSaveRef = useRef(canSave);
  const applyLocalRef = useRef(applyLocal);
  const flushRef = useRef(flush);
  const onFlushedRef = useRef(onFlushed);
  const onErrorRef = useRef(onError);
  const errorMessageRef = useRef(errorMessage);
  // The last value seen from the server. A part this browser changed since
  // keeps its value, so the echo of its own save (trimmed or normalized by the
  // server) never lands under the caret.
  const sourceBaseRef = useRef(source);
  const sourceRef = useRef(source);
  const adoptRef = useRef(adopt);
  // `args` after bringing in edits saved elsewhere on a clean form.
  const adoptedArgsKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const previousIntent = lastIntentRef.current;
    if (
      previousIntent.resetKey === resetKey &&
      previousIntent.valueKey !== valueKey
    ) {
      if (adoptedArgsKeyRef.current === stableHash(args)) {
        // Already saved where it came from: the form is clean again.
        const nextGeneration = resetGenerationRef.current + 1;
        resetGenerationRef.current = nextGeneration;
        resetIntentRevisionRef.current = intentRevisionRef.current;
        setResetIntentRevision(intentRevisionRef.current);
        lastSavedKeyRef.current = valueKey;
        if (timerRef.current) clearTimeout(timerRef.current);
        setLastSavedKey(valueKey);
        setResetGeneration(nextGeneration);
      } else if (
        // A teammate's edit on a clean form is saved by their browser, not again here.
        changedByTeammate() &&
        previousIntent.valueKey === lastSavedKeyRef.current
      ) {
        lastSavedKeyRef.current = valueKey;
        setLastSavedKey(valueKey);
      } else {
        const nextRevision = intentRevisionRef.current + 1;
        intentRevisionRef.current = nextRevision;
        setIntentRevision(nextRevision);
      }
    }
    adoptedArgsKeyRef.current = null;
    lastIntentRef.current = { resetKey, valueKey };
    argsRef.current = args;
    sourceRef.current = source;
    adoptRef.current = adopt;
    valueKeyRef.current = valueKey;
    resetKeyRef.current = resetKey;
    enabledRef.current = enabled;
    canSaveRef.current = canSave;
    applyLocalRef.current = applyLocal;
    flushRef.current = flush;
    onFlushedRef.current = onFlushed;
    onErrorRef.current = onError;
    errorMessageRef.current = errorMessage;
    failedSaveRef.current = failedSave;
  }, [
    applyLocal,
    args,
    canSave,
    enabled,
    errorMessage,
    failedSave,
    flush,
    onError,
    onFlushed,
    resetKey,
    source,
    adopt,
    valueKey,
  ]);

  const sourceKey = source === undefined ? null : stableHash(source);
  useEffect(() => {
    if (sourceKey === null) return;
    const base = sourceBaseRef.current;
    const saved = sourceRef.current;
    sourceBaseRef.current = saved;
    if (stableHash(base) === sourceKey) return;
    const bringIn = () => {
      const local = argsRef.current;
      const merged = mergeSaved(base, saved, local) as TArgs;
      const mergedKey = stableHash(merged);
      if (mergedKey === stableHash(local)) return;
      const latest = latestRequestsRef.current.get(resetKeyRef.current);
      if (
        valueKeyRef.current === lastSavedKeyRef.current &&
        (!latest || latest.settled)
      ) {
        adoptedArgsKeyRef.current = mergedKey;
      }
      adoptRef.current?.(merged);
    };
    if (leadsSharedRoom()) bringIn();
    else window.setTimeout(bringIn, FOLLOWER_ADOPT_DELAY_MS);
  }, [sourceKey]);

  useLayoutEffect(() => {
    if (resetKey === lastResetKeyRef.current) return;
    lastResetKeyRef.current = resetKey;
    const nextGeneration = resetGenerationRef.current + 1;
    resetGenerationRef.current = nextGeneration;
    resetIntentRevisionRef.current = intentRevisionRef.current;
    setResetIntentRevision(intentRevisionRef.current);
    lastSavedKeyRef.current = valueKey;
    wasEnabledRef.current = enabled;
    if (timerRef.current) clearTimeout(timerRef.current);
    setLastSavedKey(valueKey);
    setResetGeneration(nextGeneration);
    setSettledResetKey(resetKey);
    setEnabledBaselineKey(enabled ? valueKey : null);
    failedSaveRef.current = null;
    setFailedSave(null);
  }, [enabled, resetKey, valueKey]);

  const queueSave = useCallback(
    (options?: { force?: boolean }): Promise<boolean> => {
      const valueKey = valueKeyRef.current;
      const resetKey = resetKeyRef.current;
      const generation = resetGenerationRef.current;
      const current = { generation, resetKey, valueKey };
      const latestRequest = latestRequestsRef.current.get(resetKey) ?? null;
      const pendingSave = pendingSavesRef.current.get(resetKey);
      if (
        pendingSave &&
        isCurrentAutoSaveRequest(pendingSave, latestRequest, current)
      ) {
        return pendingSave.promise;
      }
      if (!enabledRef.current) {
        return Promise.resolve(false);
      }
      const divergentWritePending =
        isDivergentAutoSaveRequest(latestRequest, current) ||
        hasRebasedAutoSaveIntent(
          latestRequest,
          current,
          intentRevisionRef.current !== resetIntentRevisionRef.current,
        );
      if (
        !options?.force &&
        valueKey === lastSavedKeyRef.current &&
        !divergentWritePending
      ) {
        if (
          latestRequest !== null &&
          !latestRequest.settled &&
          latestRequest.generation !== generation &&
          pendingSave?.requestId === latestRequest.requestId
        ) {
          const barrierRequestId = latestRequest.requestId;
          const barrierIntentRevision = intentRevisionRef.current;
          return pendingSave.completion.then(
            (succeeded) =>
              succeeded &&
              resetGenerationRef.current === generation &&
              resetKeyRef.current === resetKey &&
              valueKeyRef.current === valueKey &&
              intentRevisionRef.current === barrierIntentRevision &&
              latestRequestsRef.current.get(resetKey)?.requestId ===
                barrierRequestId,
          );
        }
        return Promise.resolve(true);
      }
      if (!canSaveRef.current) {
        return Promise.resolve(false);
      }
      if (timerRef.current) clearTimeout(timerRef.current);

      const queuedKey = valueKey;
      const queuedResetKey = resetKey;
      const queuedArgs = argsRef.current;
      const requestId = nextRequestIdRef.current + 1;
      nextRequestIdRef.current = requestId;
      const clientMutationId = createClientMutationId(mutationName);
      failedSaveRef.current = null;
      setFailedSave(null);
      const request = {
        generation,
        requestId,
        resetKey: queuedResetKey,
        valueKey: queuedKey,
      };
      const dispatchedSave = {
        ...request,
        settled: false,
      };
      latestRequestsRef.current.set(queuedResetKey, dispatchedSave);
      setLatestRequests((current) =>
        new Map(current).set(queuedResetKey, dispatchedSave),
      );

      const queuedApplyLocal = applyLocalRef.current;
      const queuedFlush = flushRef.current;
      const result = Promise.resolve().then(() => {
        return sequencer.run(() => queuedFlush(queuedArgs, clientMutationId));
      });
      const isRequestCurrent = () =>
        enabledRef.current &&
        isCurrentAutoSaveRequest(
          request,
          latestRequestsRef.current.get(queuedResetKey) ?? null,
          {
            generation: resetGenerationRef.current,
            resetKey: resetKeyRef.current,
            valueKey: valueKeyRef.current,
          },
        );

      let flushSucceeded = false;
      const promise = result
        .then((flushResult) => {
          flushSucceeded = true;
          const isCurrent = isRequestCurrent();
          if (isCurrent) {
            lastSavedKeyRef.current = queuedKey;
            setLastSavedKey(queuedKey);
            queuedApplyLocal?.(store, queuedArgs, clientMutationId);
            failedSaveRef.current = null;
            setFailedSave(null);
            onFlushedRef.current?.(flushResult, queuedArgs);
          }
          return isCurrent;
        })
        .catch((error) => {
          if (isRequestCurrent()) {
            failedSaveRef.current = request;
            setFailedSave(request);
            onErrorRef.current?.(error, queuedArgs);
            const configuredDetail =
              typeof errorMessageRef.current === "function"
                ? errorMessageRef.current(error, queuedArgs)
                : errorMessageRef.current;
            const detail = getPermissionErrorMessage(error) ?? configuredDetail;
            toast.error("Changes weren’t saved", {
              id: `auto-save:${mutationName}`,
              description: detail,
            });
          }
          return false;
        })
        .finally(() => {
          if (
            pendingSavesRef.current.get(queuedResetKey)?.requestId === requestId
          ) {
            pendingSavesRef.current.delete(queuedResetKey);
          }
          const latestRequest = latestRequestsRef.current.get(queuedResetKey);
          if (latestRequest?.requestId === requestId) {
            const settledSave = {
              ...latestRequest,
              settled: true,
            };
            latestRequestsRef.current.set(queuedResetKey, settledSave);
            setLatestRequests((current) => {
              if (current.get(queuedResetKey)?.requestId !== requestId) {
                return current;
              }
              return new Map(current).set(queuedResetKey, settledSave);
            });
          }
        });

      const completion = promise.then(() => flushSucceeded);
      pendingSavesRef.current.set(queuedResetKey, {
        generation,
        requestId,
        resetKey: queuedResetKey,
        valueKey: queuedKey,
        promise,
        completion,
      });
      return promise;
    },
    [mutationName, sequencer, store],
  );

  const latestRequest = latestRequests.get(resetKey) ?? null;
  const queueSaveRef = useRef(queueSave);

  useLayoutEffect(() => {
    queueSaveRef.current = queueSave;
  }, [queueSave]);

  useLayoutEffect(
    () => () => {
      const resetKey = resetKeyRef.current;
      const current = {
        generation: resetGenerationRef.current,
        resetKey,
        valueKey: valueKeyRef.current,
      };
      const latest = latestRequestsRef.current.get(resetKey) ?? null;
      const divergentWritePending =
        isDivergentAutoSaveRequest(latest, current) ||
        hasRebasedAutoSaveIntent(
          latest,
          current,
          intentRevisionRef.current !== resetIntentRevisionRef.current,
        );
      const failedCurrentRequest =
        failedSaveRef.current !== null &&
        isCurrentAutoSaveRequest(failedSaveRef.current, latest, current);
      const dirty =
        current.valueKey !== lastSavedKeyRef.current || divergentWritePending;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (
        enabledRef.current &&
        canSaveRef.current &&
        dirty &&
        !failedCurrentRequest
      ) {
        void queueSaveRef.current();
      }
      enabledRef.current = false;
    },
    [],
  );

  useLayoutEffect(() => {
    if (!enabled) {
      if (wasEnabledRef.current) {
        const nextGeneration = resetGenerationRef.current + 1;
        resetGenerationRef.current = nextGeneration;
        resetIntentRevisionRef.current = intentRevisionRef.current;
        setResetGeneration(nextGeneration);
        setResetIntentRevision(intentRevisionRef.current);
      }
      wasEnabledRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      setEnabledBaselineKey(null);
      return;
    }

    if (!wasEnabledRef.current) {
      lastSavedKeyRef.current = valueKey;
      wasEnabledRef.current = true;
      resetIntentRevisionRef.current = intentRevisionRef.current;
      setLastSavedKey(valueKey);
      setResetIntentRevision(intentRevisionRef.current);
      setEnabledBaselineKey(valueKey);
      failedSaveRef.current = null;
      setFailedSave(null);
      return;
    }

    const current = {
      generation: resetGenerationRef.current,
      resetKey,
      valueKey,
    };
    const divergentWritePending =
      isDivergentAutoSaveRequest(latestRequest, current) ||
      hasRebasedAutoSaveIntent(
        latestRequest,
        current,
        intentRevisionRef.current !== resetIntentRevisionRef.current,
      );
    const failedCurrentRequest =
      failedSave !== null &&
      isCurrentAutoSaveRequest(failedSave, latestRequest, {
        generation: resetGenerationRef.current,
        resetKey,
        valueKey,
      });

    if (valueKey === lastSavedKeyRef.current && !divergentWritePending) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    if (failedCurrentRequest) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    if (!autoSave) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    if (!canSave) {
      return;
    }

    timerRef.current = setTimeout(() => {
      void queueSave();
    }, delayMs);
  }, [
    autoSave,
    canSave,
    delayMs,
    enabled,
    failedSave,
    latestRequest,
    queueSave,
    resetKey,
    valueKey,
  ]);

  const resetting = resetKey !== settledResetKey;
  const resuming = enabled && enabledBaselineKey === null;
  const renderRequest = { generation: resetGeneration, resetKey, valueKey };
  const divergentWritePending =
    isDivergentAutoSaveRequest(latestRequest, renderRequest) ||
    hasRebasedAutoSaveIntent(
      latestRequest,
      renderRequest,
      intentRevision !== resetIntentRevision,
    );
  const currentRequestPending =
    latestRequest !== null &&
    !latestRequest.settled &&
    isCurrentAutoSaveRequest(latestRequest, latestRequest, {
      generation: resetGeneration,
      resetKey,
      valueKey,
    });
  const dirty =
    enabled &&
    !resetting &&
    !resuming &&
    (valueKey !== lastSavedKey ||
      divergentWritePending ||
      currentRequestPending);
  const current = {
    generation: resetGeneration,
    resetKey,
    valueKey,
  };
  const saving = currentRequestPending;
  const failed =
    failedSave !== null &&
    isCurrentAutoSaveRequest(failedSave, latestRequest, current);
  const status: AutoSaveStatus = failed
    ? "error"
    : !dirty
      ? "saved"
      : saving || (autoSave && canSave)
        ? "saving"
        : "unsaved";

  const saveNow = useCallback(
    (options?: { force?: boolean }) => queueSave(options),
    [queueSave],
  );

  return { saving, status, saveNow };
}
