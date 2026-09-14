"use client";

import { useState, type SetStateAction } from "react";
import { stableHash } from "@claritylabs/cl-sync";

// Keep local edits separate from subscription values so reads never become writes.
export function useLiveRecordDraft<T extends object>(
  recordKey: string,
  source: T,
) {
  const [state, setState] = useState({
    recordKey,
    generation: 0,
    revision: 0,
    edits: {} as Partial<T>,
    fieldRevisions: {} as Partial<Record<keyof T, number>>,
  });
  if (state.recordKey !== recordKey) {
    setState({
      recordKey,
      generation: state.generation + 1,
      revision: 0,
      edits: {},
      fieldRevisions: {},
    });
  }
  const current: typeof state =
    state.recordKey === recordKey
      ? state
      : {
          recordKey,
          generation: state.generation + 1,
          revision: 0,
          edits: {},
          fieldRevisions: {},
        };
  const value = { ...source, ...current.edits };

  function setValue(update: SetStateAction<T>) {
    setState((previous) => {
      if (
        previous.recordKey !== recordKey ||
        previous.generation !== current.generation
      )
        return previous;
      const before = { ...source, ...previous.edits };
      const next = typeof update === "function" ? update(before) : update;
      const changed = (Object.keys(next) as (keyof T)[]).filter(
        (key) => stableHash(next[key]) !== stableHash(before[key]),
      );
      if (!changed.length) return previous;
      const revision = previous.revision + 1;
      const edits = { ...previous.edits };
      const fieldRevisions = { ...previous.fieldRevisions };
      for (const key of changed) {
        edits[key] = next[key];
        fieldRevisions[key] = revision;
      }
      return { ...previous, revision, edits, fieldRevisions };
    });
  }

  function field<K extends keyof T>(key: K) {
    return (update: SetStateAction<T[K]>) =>
      setValue((before) => ({
        ...before,
        [key]:
          typeof update === "function"
            ? (update as (value: T[K]) => T[K])(before[key])
            : update,
      }));
  }

  function acknowledge(revision: number) {
    setState((previous) => {
      if (
        previous.recordKey !== recordKey ||
        previous.generation !== current.generation
      )
        return previous;
      const edits = { ...previous.edits };
      const fieldRevisions = { ...previous.fieldRevisions };
      for (const key of Object.keys(fieldRevisions) as (keyof T)[]) {
        if (fieldRevisions[key]! <= revision) {
          delete edits[key];
          delete fieldRevisions[key];
        }
      }
      return { ...previous, edits, fieldRevisions };
    });
  }

  return {
    value,
    patch: current.edits,
    revision: current.revision,
    setValue,
    field,
    acknowledge,
  };
}
