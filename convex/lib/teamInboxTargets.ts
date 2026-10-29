import dayjs from "dayjs";
import type {
  DecideResponse,
  DecisionEntry,
  DecisionQuestion,
} from "../../contracts/cl-router/policy";
import { normalizeProcurementSubject } from "./procurement";

/**
 * Which `search_team_inbox` results are the thread the operator named. Code
 * decides from subjects first; Jev is asked only when a named target has no
 * exact subject match, and only about the top candidates.
 */

export type SubjectMatch = "exact" | "partial" | "none";

/** Reply/forward prefixes, case, punctuation and spacing removed. */
export function subjectMatchKey(subject: string) {
  return normalizeProcurementSubject(subject)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// A partial match needs this many words on the shorter side, so a one-word
// query or subject never counts as a partial match by containment.
const PARTIAL_MIN_WORDS = 2;
// Queries with at least this many words name a specific thread; shorter ones
// are topic searches and never trigger Jev.
const NAMED_TARGET_MIN_WORDS = 3;
// Candidates Jev judges when no subject matches exactly.
export const TEAM_INBOX_TARGET_CANDIDATES = 10;

const words = (key: string) => (key ? key.split(" ").length : 0);

export function subjectMatch(query: string, subject: string): SubjectMatch {
  const wanted = subjectMatchKey(query);
  const actual = subjectMatchKey(subject);
  if (!wanted || !actual) return "none";
  if (wanted === actual) return "exact";
  const [shorter, longer] =
    wanted.length <= actual.length ? [wanted, actual] : [actual, wanted];
  return words(shorter) >= PARTIAL_MIN_WORDS &&
    ` ${longer} `.includes(` ${shorter} `)
    ? "partial"
    : "none";
}

export function looksLikeNamedTarget(query: string) {
  return words(subjectMatchKey(query)) >= NAMED_TARGET_MIN_WORDS;
}

const MATCH_RANK: Record<SubjectMatch, number> = {
  exact: 0,
  partial: 1,
  none: 2,
};

/** Exact subject matches first, then partial, each keeping search order. */
export function rankBySubjectMatch<T extends { subjectMatch: SubjectMatch }>(
  rows: readonly T[],
) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (left, right) =>
        MATCH_RANK[left.row.subjectMatch] -
          MATCH_RANK[right.row.subjectMatch] || left.index - right.index,
    )
    .map(({ row }) => row);
}

export type TeamInboxCandidate = {
  teamEmailThreadId: string;
  subject: string;
  subjectMatch: SubjectMatch;
  matchedIn: "subject" | "body";
  client: { name: string } | null;
  latestDirection?: "inbound" | "outbound";
  latestFrom?: string;
  participants: string[];
  snippet?: string;
};

export type TeamInboxTargetDecision = {
  status: "not_needed" | "decided" | "unavailable";
  requestId?: string;
  ms?: number;
};

export type TargetedRow<T> = T & {
  likelyTarget: boolean;
  targetProbability?: number;
};

const IS_NAMED_CONVERSATION =
  "Is `threads.{id}` the email conversation that `request` names, judged by its subject, client and participants? A thread that only mentions the same company or topic in its body does not count.";
const SAME_SUBMISSION =
  "Is `threads.{id}` part of the same submission that `request` names: the same client and coverage request, such as another provider's thread for it? Unrelated mail about the same client does not count.";

function questionsFor(candidates: readonly { key: string }[]) {
  return Object.fromEntries(
    candidates.flatMap(({ key }): [string, DecisionQuestion][] => [
      [
        `${key}_named`,
        {
          type: "noul",
          instructions: IS_NAMED_CONVERSATION.replace("{id}", key),
        },
      ],
      [
        `${key}_submission`,
        { type: "noul", instructions: SAME_SUBMISSION.replace("{id}", key) },
      ],
    ]),
  );
}

function probability(answer: DecideResponse["answers"][string] | undefined) {
  return answer?.type === "noul" &&
    Number.isFinite(answer.noul) &&
    answer.noul >= 0 &&
    answer.noul <= 1
    ? answer.noul
    : undefined;
}

/**
 * Flags likely targets. Exact subject matches are targets and Jev is never
 * asked. Otherwise, for a named target, one batched decision judges the top
 * candidates; a candidate is a target when either answer reaches the
 * threshold. Uncertain answers stay false with their probability shown, and
 * a failed decision leaves the deterministic flags.
 */
export async function flagTeamInboxTargets<T extends TeamInboxCandidate>(
  query: string,
  rows: readonly T[],
  decide: (request: {
    state: DecisionEntry;
    questions: Record<string, DecisionQuestion>;
  }) => Promise<Pick<DecideResponse, "answers" | "requestId">>,
  threshold: number,
): Promise<{ rows: TargetedRow<T>[]; decision: TeamInboxTargetDecision }> {
  const ranked = rankBySubjectMatch(rows);
  const deterministic = ranked.map((row) => ({
    ...row,
    likelyTarget: row.subjectMatch === "exact",
  }));
  if (
    !ranked.length ||
    ranked.some((row) => row.subjectMatch === "exact") ||
    !looksLikeNamedTarget(query)
  )
    return { rows: deterministic, decision: { status: "not_needed" } };
  const candidates = ranked
    .slice(0, TEAM_INBOX_TARGET_CANDIDATES)
    .map((row, index) => ({ key: `t${index + 1}`, row }));
  const startedAt = dayjs().valueOf();
  try {
    const result = await decide({
      state: {
        request: query.slice(0, 300),
        threads: Object.fromEntries(
          candidates.map(({ key, row }) => [
            key,
            {
              subject: subjectMatchKey(row.subject),
              matchedIn: row.matchedIn,
              client: row.client?.name ?? null,
              latestDirection: row.latestDirection ?? null,
              latestFrom: row.latestFrom ?? null,
              participants: row.participants.slice(0, 4),
              snippet: row.snippet?.slice(0, 240) ?? null,
            },
          ]),
        ),
      },
      questions: questionsFor(candidates),
    });
    const judged = new Map(
      candidates.map(({ key, row }) => {
        const answers = [
          probability(result.answers[`${key}_named`]),
          probability(result.answers[`${key}_submission`]),
        ].filter((value) => value !== undefined);
        return [
          row.teamEmailThreadId,
          answers.length ? Math.max(...answers) : undefined,
        ] as const;
      }),
    );
    const flagged = deterministic.map((row) => {
      const targetProbability = judged.get(row.teamEmailThreadId);
      return targetProbability === undefined
        ? row
        : {
            ...row,
            likelyTarget: targetProbability >= threshold,
            targetProbability,
          };
    });
    return {
      rows: [
        ...flagged.filter((row) => row.likelyTarget),
        ...flagged.filter((row) => !row.likelyTarget),
      ],
      decision: {
        status: "decided",
        requestId: result.requestId,
        ms: dayjs().valueOf() - startedAt,
      },
    };
  } catch {
    return {
      rows: deterministic,
      decision: { status: "unavailable", ms: dayjs().valueOf() - startedAt },
    };
  }
}
