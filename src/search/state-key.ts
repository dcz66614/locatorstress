// T007 — BFS state keys (PROJECT_BOOK §5.6 / §5.7; IMPLEMENTATION_PLAN T007).
//
// Two keys, for two different layers:
//
//   1. planStateKey — the "canonical mutation plan hash" of §5.6: the
//      SHA-256 of the canonical JSON of { schema, seed, fixtureId, plan },
//      where plan is the ORDERED mutation sequence. Two different orders
//      of the same operators are different plans and therefore different
//      keys (M01 then M03 need not equal M03 then M01). This is the
//      fallback key used when no DOM snapshot is available (e.g. an
//      evaluation that errored before a snapshot could be taken), and the
//      key used by the pure/unit evaluator in tests.
//
//   2. domStateKey — the SHA-256 of the canonical JSON of { schema, seed,
//      fixtureId, html }, where html is the serialised DOM
//      (document.documentElement.outerHTML) after the sequence was
//      applied. This is the key the browser evaluator uses: two different
//      sequences that converge on the same DOM (e.g. a no-op operator, or
//      commuting operators) share one key, so the second visit is pruned
//      as a duplicate instead of re-expanding an already-seen state.
//
// Both keys are built with the frozen T006 canonicaliser
// (canonicalJson / hashCanonical): UTF-8, LF, NFC, keys sorted by Unicode
// code point, no wall clock, no UUID, no PID, no absolute path. The
// schema strings are new (no frozen hash depends on them), so adding
// them cannot change any S0/S1 hash.
//
// Tie-break (§5.7): within one BFS depth, sequences compare
// lexicographically by mutation id (compareSequences), using the same
// code-point order as the canonicaliser. BFS explores level by level and
// dequeues in lexicographic order, so the first witness found is the
// shortest, and among the shortest it is the lexicographically smallest
// sequence. State dedup keeps the FIRST visit to a key, which under
// that visit order is the shortest, lexicographically smallest sequence
// reaching that state.

import { compareCodePoints, hashCanonical } from "../canonical/canonical-json.js";
import { SEED } from "../canonical/hashes.js";
import type { MutationId } from "../mutations/types.js";

export const SCHEMA_BFS_PLAN_STATE_KEY = "locatorstress.bfs-plan-state-key/v1";
export const SCHEMA_BFS_DOM_STATE_KEY = "locatorstress.bfs-dom-state-key/v1";

/** Human-readable key for a sequence: "" for the root, else "M01+M04". */
export function sequenceKey(sequence: readonly MutationId[]): string {
  return sequence.join("+");
}

/**
 * Canonical mutation-plan hash (§5.6 "canonical mutation plan hash").
 * Order-sensitive: planStateKey(f, [M01, M03]) !== planStateKey(f, [M03, M01]).
 */
export function planStateKey(
  fixtureId: string,
  sequence: readonly MutationId[],
): string {
  return hashCanonical({
    schema: SCHEMA_BFS_PLAN_STATE_KEY,
    seed: SEED,
    fixtureId,
    plan: [...sequence],
  });
}

/**
 * Canonical DOM-state hash: SHA-256 of the canonical JSON of the
 * serialised DOM after a mutation sequence was applied. Two sequences
 * that produce byte-identical serialised DOM share this key.
 */
export function domStateKey(fixtureId: string, html: string): string {
  return hashCanonical({
    schema: SCHEMA_BFS_DOM_STATE_KEY,
    seed: SEED,
    fixtureId,
    html,
  });
}

/**
 * Lexicographic comparison of two mutation sequences by mutation id,
 * code-point order (§5.7 tie-break). Shorter-is-smaller only when one
 * sequence is a prefix of the other; BFS level order already separates
 * depths, so this is used for ordering within a single depth.
 */
export function compareSequences(
  a: readonly MutationId[],
  b: readonly MutationId[],
): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = compareCodePoints(a[i], b[i]);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

/** Failure predicate (§5.6): any claimed verdict other than STABLE. */
export function isFailureVerdict(
  verdict: "STABLE" | "WRONG_TARGET" | "AMBIGUOUS" | "MISSING" | null,
): verdict is "WRONG_TARGET" | "AMBIGUOUS" | "MISSING" {
  return verdict !== null && verdict !== "STABLE";
}
