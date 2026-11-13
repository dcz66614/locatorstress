// T007 — Bounded BFS for the shortest failing mutation sequence
// (PROJECT_BOOK §5.6 / §5.7; IMPLEMENTATION_PLAN T007).
//
// The search is deliberately evaluator-agnostic: the caller supplies an
// async evaluator that, for a mutation sequence, returns the classified
// verdict (or null when no verdict may be claimed) plus a canonical
// state key. The browser evaluator lives in browser-evaluator.ts; unit
// tests use a pure fake evaluator. The BFS itself performs no browser
// I/O, reads no fixture, and consults no golden matrix.
//
// Frozen bounds (§5.6, §12.1, canonical BFS_LIMITS):
//   - max depth 6 (sequences of length 0..6);
//   - max expanded states 4096 per locator.
// Callers may ask for SMALLER bounds (tests do); asking for larger ones
// is a RangeError, because the caps are frozen, not advisory.
//
// Rules, in the order they are enforced:
//   1. No operator repeats within one sequence (§5.6: "同一算子一条序列
//      最多一次，除非 fixture 显式允许重复" — no fixture allows repeats,
//      so allowRepeat defaults to false and is only a test hook).
//   2. Fixed operator order: children are generated in MUTATION_ORDER
//      (M01..M08), and the FIFO queue preserves lexicographic order
//      within a depth (children of a lexicographically smaller parent are
//      all enqueued before children of a larger parent, and siblings are
//      enqueued in operator order). The first witness found is therefore
//      the shortest, and among the shortest the lexicographically
//      smallest sequence (§5.7 tie-break).
//   3. State dedup by the evaluator's canonical state key: the FIRST
//      visit to a key wins. Under rule 2 that first visit is via the
//      shortest, lexicographically smallest sequence reaching the state.
//      A duplicate is recorded (statesDeduplicated) and never expanded.
//   4. Failure predicate: verdict !== STABLE, and only when a verdict was
//      actually claimed (verdict !== null). An INCOMPLETE evaluation
//      (verdict null: execution error, unknown identity) is NEVER a
//      witness and is NEVER expanded — its DOM state is untrusted — but
//      it is recorded (incompleteStates) and the search continues past it.
//   5. Bounds are reported honestly:
//      - FOUND: a witness was dequeued (shortest by construction).
//      - BOUNDED_NO_WITNESS: the queue emptied within the bounds. This
//        says ONLY that no witness exists inside the searched space; it
//        never claims the locator is safe for all DOM changes (§5.6).
//      - BOUNDED_INCOMPLETE: the expansion budget ran out while the
//        queue was still non-empty. This is NEVER reported as
//        BOUNDED_NO_WITNESS and NEVER as "no witness".
//   6. Determinism: no randomness, no wall clock, no PID, no absolute
//      path anywhere in the result. The same evaluator + options always
//      produce the same result object.
//
// Counting (all counts are exact, not estimates):
//   - statesEvaluated: evaluator calls made (root + every dequeued child).
//   - statesExpanded: nodes whose children were generated (root counts
//     when its children are generated).
//   - statesDeduplicated: evaluated nodes whose state key was already
//     seen (not expanded, not counted as new states).
//   - uniqueStates: distinct state keys ever seen (visited set size).
//   - queueRemaining: sequences still in the queue when the search
//     stopped (0 for BOUNDED_NO_WITNESS and FOUND-by-exhaustion cases
//     only when the queue actually emptied; >0 for BOUNDED_INCOMPLETE).

import { MUTATION_ORDER } from "../mutations/registry.js";
import type { MutationId } from "../mutations/types.js";
import type { AnalysisStatus, Verdict } from "../verdict/classify.js";
import { BFS_LIMITS } from "../canonical/hashes.js";
import { isFailureVerdict } from "./state-key.js";

export const BFS_MAX_DEPTH = BFS_LIMITS.max_depth;
export const BFS_MAX_EXPANDED_STATES = BFS_LIMITS.max_expanded_states;

export type BfsStatus = "FOUND" | "BOUNDED_NO_WITNESS" | "BOUNDED_INCOMPLETE";

export interface BfsEvaluation {
  /** Claimed verdict, or null when no verdict may be claimed (INCOMPLETE). */
  verdict: Verdict | null;
  analysisStatus: AnalysisStatus;
  /** Canonical state key (plan hash or DOM hash) for dedup. */
  stateKey: string;
}

/** Async evaluator: verdict + state key for one mutation sequence. */
export type BfsEvaluator = (
  sequence: readonly MutationId[],
) => Promise<BfsEvaluation>;

export interface BfsOptions {
  fixtureId: string;
  /** Default 6. Must be 0..6 (frozen cap). */
  maxDepth?: number;
  /** Default 4096. Must be 1..4096 (frozen cap). */
  maxExpandedStates?: number;
  /** Default MUTATION_ORDER (M01..M08). */
  operatorOrder?: readonly MutationId[];
  /** Default false (§5.6: one use per operator per sequence). */
  allowRepeat?: boolean;
}

export interface BfsWitness {
  sequence: MutationId[];
  depth: number;
  verdict: Verdict;
}

export interface BfsEvaluationRecord {
  sequence: MutationId[];
  depth: number;
  verdict: Verdict | null;
  analysisStatus: AnalysisStatus;
  stateKey: string;
  /** True when this evaluation was a duplicate state (not expanded). */
  duplicate: boolean;
}

export interface BfsResult {
  status: BfsStatus;
  fixtureId: string;
  witness: BfsWitness | null;
  limits: { maxDepth: number; maxExpandedStates: number };
  statesEvaluated: number;
  statesExpanded: number;
  statesDeduplicated: number;
  uniqueStates: number;
  incompleteStates: number;
  maxDepthReached: number;
  queueRemaining: number;
  /** Evaluations per depth (depth -> count), evaluated nodes only. */
  perDepthEvaluated: Record<number, number>;
  /** Full evaluation trace, in dequeue order (bounded by the search). */
  evaluations: BfsEvaluationRecord[];
  notes: string[];
}

function assertBfsOptions(options: BfsOptions): {
  maxDepth: number;
  maxExpandedStates: number;
  operatorOrder: readonly MutationId[];
  allowRepeat: boolean;
} {
  if (typeof options.fixtureId !== "string" || options.fixtureId.length === 0) {
    throw new Error("BFS requires a non-empty fixtureId");
  }
  const maxDepth = options.maxDepth ?? BFS_MAX_DEPTH;
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > BFS_MAX_DEPTH) {
    throw new RangeError(
      `maxDepth must be an integer in 0..${BFS_MAX_DEPTH} (frozen cap), got ${String(options.maxDepth)}`,
    );
  }
  const maxExpandedStates =
    options.maxExpandedStates ?? BFS_MAX_EXPANDED_STATES;
  if (
    !Number.isInteger(maxExpandedStates) ||
    maxExpandedStates < 1 ||
    maxExpandedStates > BFS_MAX_EXPANDED_STATES
  ) {
    throw new RangeError(
      `maxExpandedStates must be an integer in 1..${BFS_MAX_EXPANDED_STATES} (frozen cap), got ${String(options.maxExpandedStates)}`,
    );
  }
  const operatorOrder = options.operatorOrder ?? MUTATION_ORDER;
  if (operatorOrder.length === 0) {
    throw new Error("BFS operatorOrder must not be empty");
  }
  const seen = new Set<string>();
  for (const op of operatorOrder) {
    if (seen.has(op)) {
      throw new Error(`BFS operatorOrder contains duplicate operator ${op}`);
    }
    seen.add(op);
  }
  return {
    maxDepth,
    maxExpandedStates,
    operatorOrder,
    allowRepeat: options.allowRepeat ?? false,
  };
}

/**
 * Run the bounded BFS. The root (empty sequence) is evaluated first:
 * a failing root means the baseline itself does not hold, and is
 * reported as a depth-0 witness; an incomplete root means the baseline
 * cannot be trusted, and the search reports BOUNDED_INCOMPLETE with a
 * note instead of claiming anything about the locator.
 */
export async function runBoundedBfs(
  evaluator: BfsEvaluator,
  options: BfsOptions,
): Promise<BfsResult> {
  const { maxDepth, maxExpandedStates, operatorOrder, allowRepeat } =
    assertBfsOptions(options);
  const fixtureId = options.fixtureId;

  const evaluations: BfsEvaluationRecord[] = [];
  const perDepthEvaluated: Record<number, number> = {};
  const notes: string[] = [];
  const visited = new Set<string>();
  // FIFO queue of sequences awaiting evaluation, in visit order.
  const queue: MutationId[][] = [[]];
  let statesEvaluated = 0;
  let statesExpanded = 0;
  let statesDeduplicated = 0;
  let incompleteStates = 0;
  let maxDepthReached = 0;

  const finish = (
    status: BfsStatus,
    witness: BfsWitness | null,
  ): BfsResult => ({
    status,
    fixtureId,
    witness,
    limits: { maxDepth, maxExpandedStates },
    statesEvaluated,
    statesExpanded,
    statesDeduplicated,
    uniqueStates: visited.size,
    incompleteStates,
    maxDepthReached,
    queueRemaining: queue.length,
    perDepthEvaluated,
    evaluations,
    notes,
  });

  while (queue.length > 0) {
    const sequence = queue.shift() as MutationId[];
    const depth = sequence.length;
    if (depth > maxDepthReached) maxDepthReached = depth;

    const evaluation = await evaluator(sequence);
    statesEvaluated += 1;
    perDepthEvaluated[depth] = (perDepthEvaluated[depth] ?? 0) + 1;

    const duplicate = visited.has(evaluation.stateKey);
    evaluations.push({
      sequence: [...sequence],
      depth,
      verdict: evaluation.verdict,
      analysisStatus: evaluation.analysisStatus,
      stateKey: evaluation.stateKey,
      duplicate,
    });

    if (duplicate) {
      // First visit wins (shortest, lexicographically smallest path to
      // this state); do not expand, do not re-check for a witness: the
      // first visit already produced this state's verdict.
      statesDeduplicated += 1;
      continue;
    }
    visited.add(evaluation.stateKey);

    // Witness check: only a claimed non-STABLE verdict counts.
    if (isFailureVerdict(evaluation.verdict)) {
      return finish("FOUND", {
        sequence: [...sequence],
        depth,
        verdict: evaluation.verdict,
      });
    }

    if (evaluation.verdict === null) {
      // INCOMPLETE: no verdict may be claimed, and the DOM state is
      // untrusted, so do not expand past this node. The search
      // continues with the rest of the queue — except for the root:
      // an incomplete baseline means nothing about the locator can be
      // claimed at all, so the search is bounded incomplete.
      incompleteStates += 1;
      if (depth === 0) {
        notes.push(
          "root evaluation is INCOMPLETE (no verdict may be claimed for the baseline); search is bounded incomplete, not BOUNDED_NO_WITNESS",
        );
        return finish("BOUNDED_INCOMPLETE", null);
      }
      continue;
    }

    // STABLE and within depth: expand, unless the budget is exhausted.
    if (depth >= maxDepth) {
      continue;
    }
    if (statesExpanded >= maxExpandedStates) {
      // Budget ran out with unexplored sequences still queued: this is
      // BOUNDED_INCOMPLETE, never BOUNDED_NO_WITNESS. The current node
      // itself was evaluated but NOT expanded, so put it back on the
      // queue: queueRemaining then counts every unexplored sequence.
      queue.push(sequence);
      notes.push(
        `expansion budget exhausted (${maxExpandedStates} states) with ${queue.length} sequence(s) still queued; search is bounded incomplete`,
      );
      return finish("BOUNDED_INCOMPLETE", null);
    }
    statesExpanded += 1;
    for (const op of operatorOrder) {
      if (!allowRepeat && sequence.includes(op)) {
        continue;
      }
      queue.push([...sequence, op]);
    }
  }

  // Queue emptied inside the bounds: no witness in the searched space.
  return finish("BOUNDED_NO_WITNESS", null);
}
