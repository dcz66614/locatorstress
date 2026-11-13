# REVIEW_PACK_03 — 有界 BFS、状态键、浏览器评估器、分析报告与报告契约

审查 commit：`a78d765`。本包为审查时原文逐字拼接（机械拼接，内容未经改写），每个文件附行数、字节数与 SHA-256；审查结论见 `INDEPENDENT_REVIEW.md`。

## src/search/bfs.ts

- 行数：302；字节数：11589；SHA-256：`c54e4dfb6f95800699c5e619b7a4fae2f8bb8df30e192a032c81ac2eab261eea`

```ts
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
```

## src/search/state-key.ts

- 行数：102；字节数：4190；SHA-256：`8e5273c8fd30625eb1db536d8c717b1911b15e51a846422aa0ed245725cee80e`

```ts
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
```

## src/search/browser-evaluator.ts

- 行数：105；字节数：4226；SHA-256：`fff399ddbe8e91f0bff9b81aeeaa1399501a806685915ec82e041112d148a630`

```ts
// T007 — Browser evaluator for the bounded BFS (PROJECT_BOOK §5.6).
//
// Adapts the frozen S0 machinery (fixture loader, mutation registry,
// locator resolver, Oracle identity compare, T004 classifier) to the
// BfsEvaluator interface in bfs.ts. It changes none of those modules:
// it only calls them, in exactly the per-case order the S0 integration
// test uses (setContent -> capture original target -> apply mutations
// in sequence order -> resolve locator -> identity compare when there
// is exactly one final match -> classify).
//
// Per evaluation, the page is reset from the fixture HTML, so every
// sequence is evaluated from the same baseline, independently of every
// other sequence. The state key is the canonical DOM-state hash of the
// serialised DOM after the sequence (domStateKey); two sequences that
// converge on the same DOM share a key and the second is pruned.
//
// INCOMPLETE handling: any throw during apply/resolve/identity (or a
// null verdict from the classifier) yields verdict null / INCOMPLETE,
// never a disguised verdict. The evaluator still tries to snapshot the
// DOM for the state key; if even that fails, it falls back to the
// canonical plan hash of the sequence, so the BFS can still dedup
// repeated evaluations of the same failing sequence.

import type { Page } from "playwright";

import type { FixtureManifest } from "../fixtures/fixture-manifest.js";
import {
  loadFixture,
  setFixtureContent,
  captureOriginalTargetForFixture,
  mutationContextForFixture,
} from "../fixtures/fixture-loader.js";
import { getMutation } from "../mutations/registry.js";
import type { MutationId } from "../mutations/types.js";
import { resolveLocator } from "../runner/locator-resolver.js";
import { isSameElement } from "../oracle/identity-compare.js";
import { classifyVerdict } from "../verdict/classify.js";
import type { BfsEvaluator } from "./bfs.js";
import { domStateKey, planStateKey } from "./state-key.js";

export interface BrowserEvaluatorOptions {
  manifest: FixtureManifest;
}

/**
 * Build a BFS evaluator bound to one fixture and one Playwright page.
 * The caller owns the page (launch/close); the evaluator only calls
 * setContent / evaluate / resolve on it, and performs no navigation and
 * no network access beyond what the page's own route handler allows.
 */
export function createBrowserEvaluator(
  page: Page,
  manifest: FixtureManifest,
): BfsEvaluator {
  const fixture = loadFixture(manifest.fixtureId);
  const ctx = mutationContextForFixture(manifest);

  return async (sequence: readonly MutationId[]) => {
    try {
      await setFixtureContent(page, fixture);
      const original = await captureOriginalTargetForFixture(page, manifest);
      for (const mutationId of sequence) {
        const mutation = getMutation(mutationId);
        await mutation.apply(page, original, ctx);
      }
      const html = await page.evaluate(
        () => document.documentElement.outerHTML,
      );
      const stateKey = domStateKey(manifest.fixtureId, html);

      const { result, finalHandle } = await resolveLocator(
        page,
        manifest.locator,
      );
      let identityMatch: boolean | null = null;
      if (
        result.executionStatus === "COMPLETED" &&
        result.finalMatchCount === 1 &&
        finalHandle !== null
      ) {
        identityMatch = await isSameElement(page, finalHandle, original);
      }
      const classification = classifyVerdict(result, identityMatch);
      return {
        verdict: classification.verdict,
        analysisStatus: classification.analysisStatus,
        stateKey,
      };
    } catch {
      // No verdict may be claimed from a failed evaluation. Snapshot
      // if the DOM is still readable; otherwise fall back to the plan
      // hash so repeated failures of the same sequence still dedup.
      let stateKey: string;
      try {
        const html = await page.evaluate(
          () => document.documentElement.outerHTML,
        );
        stateKey = domStateKey(manifest.fixtureId, html);
      } catch {
        stateKey = planStateKey(manifest.fixtureId, sequence);
      }
      return { verdict: null, analysisStatus: "INCOMPLETE", stateKey };
    }
  };
}
```

## src/search/index.ts

- 行数：26；字节数：584；SHA-256：`f996f5bad3f21568228b58f4cb251871b29b56fbcc16b2bdc3ed63234a8fcc16`

```ts
// T007 — Bounded BFS search module.
export {
  BFS_MAX_DEPTH,
  BFS_MAX_EXPANDED_STATES,
  runBoundedBfs,
} from "./bfs.js";
export type {
  BfsStatus,
  BfsEvaluation,
  BfsEvaluator,
  BfsOptions,
  BfsWitness,
  BfsEvaluationRecord,
  BfsResult,
} from "./bfs.js";
export {
  SCHEMA_BFS_PLAN_STATE_KEY,
  SCHEMA_BFS_DOM_STATE_KEY,
  sequenceKey,
  planStateKey,
  domStateKey,
  compareSequences,
  isFailureVerdict,
} from "./state-key.js";
export { createBrowserEvaluator } from "./browser-evaluator.js";
export type { BrowserEvaluatorOptions } from "./browser-evaluator.js";
```

## src/analysis/witness.ts

- 行数：611；字节数：22345；SHA-256：`57fb95096df2eee546da8f4c21120b1d03de04e0fb268df36ac8df2dba1d4608`

```ts
// T008 — Witness summary + AnalysisReport assembly
// (PROJECT_BOOK §5.5–§5.7, §6, §11.4; IMPLEMENTATION_PLAN T008).
//
// This module integrates the frozen pieces without modifying any of
// them: verdict (T004), stability score + control metrics (T005),
// canonical JSON + the frozen scenario/oracle/gate builders (T006),
// and the bounded BFS (T007). It only READS those modules.
//
// Two rules from the T007 independent review (P2-1 / P2-2) are enforced
// here and in the API service, not just documented:
//   - P2-1 (BOUNDED_INCOMPLETE passthrough): summarizeWitness() copies
//     the BFS status verbatim and writes a meaning that says the search
//     is incomplete. A null witness is always paired with its status,
//     and BOUNDED_INCOMPLETE is never rendered as "no witness", "no
//     failure" or "safe" anywhere in the report or API. When the frozen
//     6/4096 bounds were in force, a budgetNote records the arithmetic:
//     reaching depth 6 in the full 8-operator no-repeat tree needs
//     1+8+56+336+1680+6720 = 8801 expansions, more than the 4096 budget,
//     so BOUNDED_INCOMPLETE is the correct outcome there.
//   - P2-2 (BFS defaults only): this module never passes operatorOrder
//     or allowRepeat to runBoundedBfs; the API service likewise accepts
//     only fixtureId (+ smaller maxDepth / maxExpandedStates) and
//     rejects operatorOrder / allowRepeat in request bodies.
//
// Analysis hash basis (read before comparing hashes): the frozen S0
// builder buildAnalysisCanonical() hardcodes
// `bfs: { status: "NOT_IMPLEMENTED_S0", witness: null }`, and
// src/canonical/ is frozen, so this module does NOT reuse it. It builds
// its own analysis canonical object (schema "locatorstress.analysis/v1")
// with the same field shape for verdict counts / score / coverage /
// controls / oracle parity / analysisStatus, but with a real per-fixture
// `bfs` map. The resulting analysis_sha256 therefore differs from the
// S0 gate's frozen analysis_sha256 by design; the S0 gate hash
// (651c3fd4…) and evidence/s0/S0_GATE.json are untouched, and the report
// records that in its notes. The scenario and oracle hashes DO reuse the
// frozen builders, so they recompute identically to the S0 gate's values
// for the same 192-case input set.

import { hashCanonical } from "../canonical/canonical-json.js";
import {
  SEED,
  buildGateCanonical as buildGateCanonicalFromHashes,
  buildGateCounts as buildGateCountsFromHashes,
  buildOracleCanonical as buildOracleCanonicalFromHashes,
  buildScenarioCanonical as buildScenarioCanonicalFromHashes,
} from "../canonical/hashes.js";
import type {
  Coverage,
  GateCountsInput,
  OracleCaseInput,
  ScenarioFixtureInput,
  VerdictCounts,
} from "../canonical/hashes.js";
import type { AnalysisReport, ReportCase, WitnessSummary } from "../contracts/report.js";
import { SCHEMA_ANALYSIS_REPORT } from "../contracts/report.js";
import {
  computeControlMetrics,
  computeStabilityScores,
} from "../score/stability-score.js";
import type { ScoreCase } from "../score/stability-score.js";
import type { BfsResult, BfsWitness } from "../search/bfs.js";
import { BFS_MAX_DEPTH, BFS_MAX_EXPANDED_STATES } from "../search/bfs.js";
import type { AnalysisStatus, Verdict } from "../verdict/classify.js";

export const SCHEMA_ANALYSIS_T008 = "locatorstress.analysis/v1";

/** Expansions needed to reach depth 6 in the unpruned 8-operator tree. */
export const DEPTH6_UNPRUNED_EXPANSIONS = 8801;

export function witnessMeaning(
  status: BfsResult["status"],
  witness: BfsWitness | null,
  limits: { maxDepth: number; maxExpandedStates: number },
  queueRemaining: number,
): string {
  if (status === "FOUND" && witness !== null) {
    return (
      `Shortest failing sequence found: ${witness.sequence.join("+")} ` +
      `fails with ${witness.verdict} at depth ${witness.depth}.`
    );
  }
  if (status === "BOUNDED_NO_WITNESS") {
    return (
      `No failing sequence exists inside the searched space ` +
      `(depth <= ${limits.maxDepth}, <= ${limits.maxExpandedStates} expansions). ` +
      `This does NOT prove the locator is safe for all DOM changes.`
    );
  }
  // BOUNDED_INCOMPLETE — the wording is deliberately a negation of any
  // "no witness" reading: the search stopped early, it did not finish.
  return (
    `Search budget exhausted with ${queueRemaining} sequence(s) still ` +
    `queued; the search is INCOMPLETE — this is NOT "no witness", NOT ` +
    `"no failure" and NOT "safe".`
  );
}

export function depth6BudgetNote(
  result: BfsResult,
): string | undefined {
  if (
    result.status === "BOUNDED_INCOMPLETE" &&
    result.limits.maxDepth === BFS_MAX_DEPTH &&
    result.limits.maxExpandedStates === BFS_MAX_EXPANDED_STATES
  ) {
    return (
      `Depth-6 witness is budget-conditional: reaching depth 6 in the ` +
      `full 8-operator no-repeat tree needs ${DEPTH6_UNPRUNED_EXPANSIONS} ` +
      `expansions (1+8+56+336+1680+6720), more than the frozen ` +
      `${BFS_MAX_EXPANDED_STATES} budget, so BOUNDED_INCOMPLETE is the ` +
      `correct outcome for an unpruned depth-6 search. Real DOM trees ` +
      `may still prune enough (state dedup, non-expansion of failures) ` +
      `for depth 6 to be reachable for a given fixture; the BFS never ` +
      `claims otherwise.`
    );
  }
  return undefined;
}

/**
 * Summarise one BfsResult for the report / API. Validates the BFS
 * invariants and throws on contradiction instead of silently repairing
 * it: FOUND requires a witness, BOUNDED_* require witness null, and a
 * witness depth must equal its sequence length. The status is copied
 * verbatim — never remapped, never softened.
 */
export function summarizeWitness(result: BfsResult): WitnessSummary {
  if (result.status === "FOUND" && result.witness === null) {
    throw new Error(
      `BFS invariant violated for ${result.fixtureId}: status FOUND with null witness`,
    );
  }
  if (result.status !== "FOUND" && result.witness !== null) {
    throw new Error(
      `BFS invariant violated for ${result.fixtureId}: status ${result.status} with a non-null witness`,
    );
  }
  if (
    result.witness !== null &&
    result.witness.depth !== result.witness.sequence.length
  ) {
    throw new Error(
      `BFS invariant violated for ${result.fixtureId}: witness depth ${result.witness.depth} != sequence length ${result.witness.sequence.length}`,
    );
  }
  const summary: WitnessSummary = {
    fixtureId: result.fixtureId,
    status: result.status,
    witness:
      result.witness === null
        ? null
        : {
            sequence: [...result.witness.sequence],
            depth: result.witness.depth,
            verdict: result.witness.verdict,
          },
    meaning: witnessMeaning(
      result.status,
      result.witness,
      result.limits,
      result.queueRemaining,
    ),
    limits: { ...result.limits },
    statesEvaluated: result.statesEvaluated,
    statesExpanded: result.statesExpanded,
    statesDeduplicated: result.statesDeduplicated,
    uniqueStates: result.uniqueStates,
    incompleteStates: result.incompleteStates,
    maxDepthReached: result.maxDepthReached,
    queueRemaining: result.queueRemaining,
    perDepthEvaluated: { ...result.perDepthEvaluated },
    notes: [...result.notes],
  };
  const note = depth6BudgetNote(result);
  if (note !== undefined) {
    summary.budgetNote = note;
  }
  return summary;
}

export interface AnalysisCanonicalInput {
  verdictCounts: VerdictCounts;
  verdictCountsByKind: Record<string, VerdictCounts>;
  stabilityScore: { stable: number; completed: number; score: string };
  coverage: Coverage;
  controls: {
    stable: { pairs: number; mismatches: number };
    fragile: { pairs: number; mismatches: number };
  };
  analysisStatus: AnalysisStatus;
  oracleParity: { compared: number; matched: number; mismatched: number };
  witnesses: Record<string, WitnessSummary>;
}

/**
 * T008 analysis canonical object. Same field shape as the frozen
 * buildAnalysisCanonical() for verdict counts / score / coverage /
 * controls / oracle parity / analysisStatus, but `bfs` carries the real
 * per-fixture witness summaries (status, witness, limits, exact counts)
 * instead of the S0 NOT_IMPLEMENTED_S0 placeholder. Schema string is
 * new ("locatorstress.analysis/v1") so this hash can never be confused
 * with the frozen S0 analysis hash.
 */
export function buildAnalysisCanonicalT008(
  input: AnalysisCanonicalInput,
): Record<string, unknown> {
  const witnessEntries = Object.entries(input.witnesses)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([fixtureId, w]) => ({
      fixtureId,
      status: w.status,
      witness: w.witness,
      limits: { ...w.limits },
      statesEvaluated: w.statesEvaluated,
      statesExpanded: w.statesExpanded,
      statesDeduplicated: w.statesDeduplicated,
      uniqueStates: w.uniqueStates,
      incompleteStates: w.incompleteStates,
      maxDepthReached: w.maxDepthReached,
      queueRemaining: w.queueRemaining,
      perDepthEvaluated: { ...w.perDepthEvaluated },
      notes: [...w.notes],
    }));
  let found = 0;
  let boundedNoWitness = 0;
  let boundedIncomplete = 0;
  for (const w of Object.values(input.witnesses)) {
    if (w.status === "FOUND") found += 1;
    else if (w.status === "BOUNDED_NO_WITNESS") boundedNoWitness += 1;
    else boundedIncomplete += 1;
  }
  return {
    schema: SCHEMA_ANALYSIS_T008,
    seed: SEED,
    verdictCounts: input.verdictCounts,
    verdictCountsByKind: input.verdictCountsByKind,
    stabilityScore: {
      stable: input.stabilityScore.stable,
      completed: input.stabilityScore.completed,
      score: input.stabilityScore.score,
    },
    coverage: input.coverage,
    controls: {
      stable: {
        pairs: input.controls.stable.pairs,
        mismatches: input.controls.stable.mismatches,
      },
      fragile: {
        pairs: input.controls.fragile.pairs,
        mismatches: input.controls.fragile.mismatches,
      },
    },
    analysisStatus: input.analysisStatus,
    bfs: {
      searchedFixtures: witnessEntries.length,
      found,
      boundedNoWitness,
      boundedIncomplete,
      witnesses: witnessEntries,
    },
    oracleParity: {
      compared: input.oracleParity.compared,
      matched: input.oracleParity.matched,
      mismatched: input.oracleParity.mismatched,
    },
  };
}

export interface BuildAnalysisReportInput {
  /** Single-mutation cases, any order (sorted by fixtureId/mutationId). */
  cases: ReportCase[];
  /** Fixture inputs for the scenario hash (html included). */
  fixtures: ScenarioFixtureInput[];
  /** BFS summaries for the fixtures actually searched (may be a subset). */
  witnesses: Record<string, WitnessSummary>;
  oracleParity: { compared: number; matched: number; mismatched: number };
  baseline: { passed: number; total: number };
  externalRequests: number;
  blockedRequests: number;
  staticOfflineScanHits: number;
  gateResult: "PASS" | "FAIL";
  gateFailureType: string | null;
  notes?: string[];
  verification?: AnalysisReport["verification"];
}

function countFrameLayers(locator: {
  framePath?: string[];
}): number {
  return Array.isArray(locator.framePath) ? locator.framePath.length : 0;
}

function computeCoverage(
  cases: ReportCase[],
  fixtures: ScenarioFixtureInput[],
): Coverage {
  const coverage: Coverage = {
    cssFixtures: 0,
    xpathFixtures: 0,
    roleFixtures: 0,
    framePathFixtures: 0,
    framePathCases: 0,
    indexFixtures: 0,
    indexCases: 0,
    twoLayerFramePathFixtures: 0,
  };
  const byId = new Map(fixtures.map((f) => [f.fixtureId, f]));
  for (const f of fixtures) {
    if (f.kind === "css") coverage.cssFixtures += 1;
    if (f.kind === "xpath") coverage.xpathFixtures += 1;
    if (f.kind === "role") coverage.roleFixtures += 1;
    const layers = countFrameLayers(f.locator);
    if (layers > 0) {
      coverage.framePathFixtures += 1;
      if (layers >= 2) coverage.twoLayerFramePathFixtures += 1;
    }
    // Raw manifest index: the normalised locator preserves a set index
    // (null when unset), mirroring the S0 gate's rule.
    if (f.locator.index !== null && f.locator.index !== undefined) {
      coverage.indexFixtures += 1;
    }
  }
  for (const c of cases) {
    const f = byId.get(c.fixtureId);
    if (!f) continue;
    const layers = countFrameLayers(f.locator);
    if (layers > 0) coverage.framePathCases += 1;
    if (f.locator.index !== null && f.locator.index !== undefined) {
      coverage.indexCases += 1;
    }
  }
  return coverage;
}

function emptyVerdictCounts(): VerdictCounts {
  return { STABLE: 0, WRONG_TARGET: 0, AMBIGUOUS: 0, MISSING: 0 };
}

function assertReportCase(c: ReportCase): void {
  if (typeof c.fixtureId !== "string" || c.fixtureId.length === 0) {
    throw new Error("ReportCase requires a non-empty fixtureId");
  }
  if (
    (c.verdict === null && c.analysisStatus !== "INCOMPLETE") ||
    (c.verdict !== null && c.analysisStatus !== "COMPLETE")
  ) {
    throw new Error(
      `ReportCase ${c.fixtureId}/${c.mutationId}: verdict null ⟺ analysisStatus INCOMPLETE violated`,
    );
  }
}

/**
 * Assemble a complete AnalysisReport from analysed cases, fixture
 * inputs and BFS summaries. Pure function: every count, score and hash
 * is computed from the inputs. Throws on contradictory inputs (bad
 * verdict/status pairing, unknown witness fixture, missing control
 * group / expected verdict) instead of guessing.
 */
export function buildAnalysisReport(
  input: BuildAnalysisReportInput,
): AnalysisReport {
  for (const c of input.cases) assertReportCase(c);
  const sortedCases = [...input.cases].sort((a, b) => {
    if (a.fixtureId !== b.fixtureId) return a.fixtureId < b.fixtureId ? -1 : 1;
    return a.mutationId < b.mutationId ? -1 : a.mutationId > b.mutationId ? 1 : 0;
  });
  const seen = new Set<string>();
  for (const c of sortedCases) {
    const key = `${c.fixtureId}/${c.mutationId}`;
    if (seen.has(key)) {
      throw new Error(`duplicate case ${key}`);
    }
    seen.add(key);
  }

  const fixtureIds = new Set(input.fixtures.map((f) => f.fixtureId));
  for (const c of sortedCases) {
    if (!fixtureIds.has(c.fixtureId)) {
      throw new Error(
        `case ${c.fixtureId}/${c.mutationId} has no fixture input for the scenario hash`,
      );
    }
  }
  for (const fixtureId of Object.keys(input.witnesses)) {
    if (!fixtureIds.has(fixtureId)) {
      throw new Error(
        `witness for unknown fixture ${fixtureId} (no fixture input)`,
      );
    }
  }

  // Verdict counts (overall + by locator kind).
  const verdictCounts = emptyVerdictCounts();
  const verdictCountsByKind: Record<string, VerdictCounts> = {};
  for (const c of sortedCases) {
    if (c.verdict !== null) {
      verdictCounts[c.verdict] += 1;
      const row =
        verdictCountsByKind[c.locatorKind] ?? (verdictCountsByKind[c.locatorKind] = emptyVerdictCounts());
      row[c.verdict] += 1;
    }
  }
  // Every kind present in the input gets a row, even if all its cases
  // are incomplete (counts stay 0); kinds absent stay absent.
  const completedCases = sortedCases.filter((c) => c.verdict !== null).length;
  const analysisStatus: AnalysisStatus =
    completedCases === sortedCases.length ? "COMPLETE" : "INCOMPLETE";

  // Scores + control metrics (T005, pure recomputation from cases).
  const scoreCases: ScoreCase[] = sortedCases.map((c) => ({
    fixtureId: c.fixtureId,
    mutationId: c.mutationId as ScoreCase["mutationId"],
    locatorKind: c.locatorKind,
    controlGroup: c.controlGroup,
    verdict: c.verdict,
    analysisStatus: c.analysisStatus,
    expectedVerdict: c.expectedVerdict,
  }));
  const scores = computeStabilityScores(scoreCases);
  const controls = computeControlMetrics(scoreCases);
  const coverage = computeCoverage(sortedCases, input.fixtures);

  // Canonical objects + four hashes (frozen builders for scenario /
  // oracle / gate; T008 builder for analysis with the real BFS map).
  const scenarioCanonical = buildScenarioCanonicalFromHashes(input.fixtures);
  const oracleInputs: OracleCaseInput[] = sortedCases.map((c) => ({
    fixtureId: c.fixtureId,
    mutationId: c.mutationId,
    verdict: c.verdict as Verdict | null,
    matchCount: c.matchCount,
    identityMatch: c.identityMatch,
    executionStatus: c.executionStatus,
  }));
  const oracleCanonical = buildOracleCanonicalFromHashes(oracleInputs);
  const analysisCanonical = buildAnalysisCanonicalT008({
    verdictCounts,
    verdictCountsByKind,
    stabilityScore: {
      stable: scores.overall.stable,
      completed: scores.overall.completed,
      score: scores.overall.score ?? "0",
    },
    coverage,
    controls: {
      stable: {
        pairs: controls.stable.pairs,
        mismatches: controls.stable.mismatched,
      },
      fragile: {
        pairs: controls.fragile.pairs,
        mismatches: controls.fragile.mismatched,
      },
    },
    analysisStatus,
    oracleParity: input.oracleParity,
    witnesses: input.witnesses,
  });
  const stableFixtures = input.fixtures.filter(
    (f) => f.controlGroup === "stable",
  ).length;
  const fragileFixtures = input.fixtures.filter(
    (f) => f.controlGroup === "fragile",
  ).length;
  const gateCountsInput: GateCountsInput = {
    fixtures: input.fixtures.length,
    stableFixtures,
    fragileFixtures,
    baselinePassed: input.baseline.passed,
    casesCompleted: completedCases,
    casesTotal: sortedCases.length,
    verdictCounts,
    verdictCountsByKind,
    controls: {
      stable: {
        pairs: controls.stable.pairs,
        mismatches: controls.stable.mismatched,
      },
      fragile: {
        pairs: controls.fragile.pairs,
        mismatches: controls.fragile.mismatched,
      },
    },
    oracleParity: input.oracleParity,
    stabilityScore: {
      stable: scores.overall.stable,
      completed: scores.overall.completed,
      score: scores.overall.score ?? "0",
    },
    coverage,
    externalRequests: input.externalRequests,
    blockedRequests: input.blockedRequests,
    staticOfflineScanHits: input.staticOfflineScanHits,
  };
  const gateCounts = buildGateCountsFromHashes(gateCountsInput);
  const scenario_sha256 = hashCanonical(scenarioCanonical);
  const oracle_result_sha256 = hashCanonical(oracleCanonical);
  const analysis_sha256 = hashCanonical(analysisCanonical);
  const gateCanonical = buildGateCanonicalFromHashes({
    result: input.gateResult,
    failureType: input.gateFailureType,
    counts: gateCounts,
    hashes: { scenario_sha256, oracle_result_sha256, analysis_sha256 },
  });
  const gate_sha256 = hashCanonical(gateCanonical);

  let found = 0;
  let boundedNoWitness = 0;
  let boundedIncomplete = 0;
  for (const w of Object.values(input.witnesses)) {
    if (w.status === "FOUND") found += 1;
    else if (w.status === "BOUNDED_NO_WITNESS") boundedNoWitness += 1;
    else boundedIncomplete += 1;
  }

  const notes: string[] = [
    "analysis_sha256 here is computed over schema locatorstress.analysis/v1 with the real per-fixture BFS witness map; it differs from the frozen S0 gate analysis hash (NOT_IMPLEMENTED_S0 placeholder) by design. The S0 gate hash and evidence/s0/S0_GATE.json are untouched.",
    "scenario_sha256 and oracle_result_sha256 reuse the frozen T006 builders and recompute identically to the S0 gate for the same 192-case input set.",
    "gate_sha256 here is computed over this report's analysis object, so it differs from the frozen S0 gate_sha256; it is this report's gate hash, not the S0 gate's.",
    "BOUNDED_INCOMPLETE means the search budget ran out with sequences still queued; it is never 'no witness', never 'no failure', never 'safe'. BOUNDED_NO_WITNESS means only that no failing sequence exists inside the searched space.",
    ...(input.notes ?? []),
  ];

  return {
    schema: SCHEMA_ANALYSIS_REPORT,
    seed: SEED,
    task: "T008",
    analysisStatus,
    expectedCases: sortedCases.length,
    completedCases,
    baseline: { ...input.baseline },
    verdictCounts,
    verdictCountsByKind,
    scores,
    controls,
    coverage,
    oracleParity: { ...input.oracleParity },
    witnesses: { ...input.witnesses },
    witnessCoverage: {
      searchedFixtures: Object.keys(input.witnesses).length,
      found,
      boundedNoWitness,
      boundedIncomplete,
    },
    cases: sortedCases,
    externalRequests: input.externalRequests,
    blockedRequests: input.blockedRequests,
    staticOfflineScanHits: input.staticOfflineScanHits,
    hashes: {
      scenario_sha256,
      oracle_result_sha256,
      analysis_sha256,
      gate_sha256,
    },
    canonical: {
      scenario: scenarioCanonical,
      oracle: oracleCanonical,
      analysis: analysisCanonical,
      gate: gateCanonical,
    },
    notes,
    verification: input.verification ?? null,
  };
}

/**
 * Recompute all four hashes of a report from its embedded canonical
 * objects and compare with the recorded hashes. Returns the recomputed
 * values plus a list of mismatches (empty when the report's hashes
 * recompute). Throws when the embedded canonical objects are missing.
 */
export function recomputeReportHashes(report: AnalysisReport): {
  recomputed: {
    scenario_sha256: string;
    oracle_result_sha256: string;
    analysis_sha256: string;
    gate_sha256: string;
  };
  errors: string[];
} {
  if (
    !report.canonical ||
    typeof report.canonical !== "object" ||
    !report.canonical.scenario ||
    !report.canonical.oracle ||
    !report.canonical.analysis ||
    !report.canonical.gate
  ) {
    throw new Error("report has no embedded canonical objects to recompute from");
  }
  const recomputed = {
    scenario_sha256: hashCanonical(report.canonical.scenario),
    oracle_result_sha256: hashCanonical(report.canonical.oracle),
    analysis_sha256: hashCanonical(report.canonical.analysis),
    gate_sha256: hashCanonical(report.canonical.gate),
  };
  const errors: string[] = [];
  for (const field of [
    "scenario_sha256",
    "oracle_result_sha256",
    "analysis_sha256",
    "gate_sha256",
  ] as const) {
    if (recomputed[field] !== report.hashes[field]) {
      errors.push(
        `hashes.${field} mismatch: recorded ${report.hashes[field]}, recomputed ${recomputed[field]}`,
      );
    }
  }
  return { recomputed, errors };
}
```

## src/analysis/index.ts

- 行数：12；字节数：344；SHA-256：`9e128d5775bd7c0fe70240ae3c2cbae7194129f96173022db30b25f129e4f90a`

```ts
// T008 — Analysis module barrel.
export {
  SCHEMA_ANALYSIS_T008,
  DEPTH6_UNPRUNED_EXPANSIONS,
  witnessMeaning,
  depth6BudgetNote,
  summarizeWitness,
  buildAnalysisCanonicalT008,
  buildAnalysisReport,
  recomputeReportHashes,
} from "./witness.js";
export type { AnalysisCanonicalInput, BuildAnalysisReportInput } from "./witness.js";
```

## src/contracts/report.ts

- 行数：476；字节数：16444；SHA-256：`afddb16098f1040e06b7eca1f42270a07b126d79c359d552c02de53e477948d1`

```ts
// T008 — AnalysisReport schema (PROJECT_BOOK §11.4; IMPLEMENTATION_PLAN T008).
//
// This file defines the report shape only. It builds nothing and hashes
// nothing: the assembly lives in src/analysis/witness.ts, hash
// recomputation in the same module, and JSON export/validation in
// src/export/json-export.ts.
//
// The report integrates verdict (T004), stability score + coverage
// (T005), canonical hashes (T006, frozen builders) and the bounded-BFS
// witness (T007). It is the first report to carry a REAL BFS witness:
// the S0 gate's analysis object still carries the frozen placeholder
// `bfs: { status: "NOT_IMPLEMENTED_S0", witness: null }` and MUST NOT be
// edited (evidence/s0/ and src/canonical/ are frozen). The T008 analysis
// object therefore uses its own schema string
// ("locatorstress.analysis/v1", see src/analysis/witness.ts) and its own
// per-fixture `bfs` map; its analysis_sha256 is a different hash from
// the S0 gate's frozen analysis_sha256 by design, and the S0 gate hash
// (651c3fd4…) is untouched. The report says so in its `notes`.
//
// Witness-status rule (T007 review P2-1, mandatory): a null witness is
// NEVER reported as "no witness" / "safe". The report carries the BFS
// `status` next to every null witness, and the two null-witness statuses
// mean different things:
//   - BOUNDED_NO_WITNESS: no failing sequence inside the searched space.
//     It does NOT prove the locator safe for all DOM changes.
//   - BOUNDED_INCOMPLETE: the expansion budget ran out with sequences
//     still queued. The search is incomplete; nothing may be claimed
//     about sequences beyond the budget. In the full 8-operator no-repeat
//     tree a depth-6 witness needs 8801 expansions, more than the frozen
//     4096 budget, so BOUNDED_INCOMPLETE is the CORRECT outcome there,
//     never a failure to report and never a "no witness".

import type { BfsStatus, BfsWitness } from "../search/bfs.js";
import type { AnalysisStatus, Verdict } from "../verdict/classify.js";
import type {
  ControlMetrics,
  StabilityScores,
} from "../score/stability-score.js";
import type {
  Coverage,
  VerdictCounts,
} from "../canonical/hashes.js";

export type { AnalysisStatus, Verdict, BfsStatus, BfsWitness };
export type { Coverage, VerdictCounts, ControlMetrics, StabilityScores };

export const SCHEMA_ANALYSIS_REPORT = "locatorstress.analysis-report/v1";

/** One analysed single-mutation case (baseline is reported separately). */
export interface ReportCase {
  fixtureId: string;
  mutationId: string;
  locatorKind: "css" | "xpath" | "role";
  controlGroup: "stable" | "fragile";
  verdict: Verdict | null;
  analysisStatus: AnalysisStatus;
  executionStatus: string;
  matchCount: number;
  identityMatch: boolean | null;
  expectedVerdict: Verdict;
}

/**
 * One fixture's BFS outcome, as it appears in the report and in API
 * responses. The full BfsResult evaluation trace is intentionally NOT
 * embedded here (it can hold up to 4096 records); it stays in memory
 * for the caller that ran the search. `status` is always present, so a
 * null `witness` is unambiguous: BOUNDED_NO_WITNESS vs
 * BOUNDED_INCOMPLETE.
 */
export interface WitnessSummary {
  fixtureId: string;
  status: BfsStatus;
  witness: BfsWitness | null;
  /** Plain-language meaning of this status (see module header). */
  meaning: string;
  /**
   * Present only when status is BOUNDED_INCOMPLETE and the frozen
   * 6/4096 bounds were in force: explains the 8801-expansion depth-6
   * budget tension. Absent otherwise.
   */
  budgetNote?: string;
  limits: { maxDepth: number; maxExpandedStates: number };
  statesEvaluated: number;
  statesExpanded: number;
  statesDeduplicated: number;
  uniqueStates: number;
  incompleteStates: number;
  maxDepthReached: number;
  queueRemaining: number;
  perDepthEvaluated: Record<number, number>;
  notes: string[];
}

export interface ReportHashes {
  scenario_sha256: string;
  oracle_result_sha256: string;
  analysis_sha256: string;
  gate_sha256: string;
}

/**
 * The four canonical objects the hashes are computed over, embedded so
 * every hash in this report recomputes from the report alone
 * (hashCanonical(canonical.scenario) === hashes.scenario_sha256, and
 * likewise for oracle / analysis / gate; the gate object contains the
 * three lower hashes, never gate_sha256 itself).
 */
export interface ReportCanonicalObjects {
  scenario: Record<string, unknown>;
  oracle: Record<string, unknown>;
  analysis: Record<string, unknown>;
  gate: Record<string, unknown>;
}

export interface WitnessCoverage {
  searchedFixtures: number;
  found: number;
  boundedNoWitness: number;
  boundedIncomplete: number;
}

export interface OracleParitySummary {
  compared: number;
  matched: number;
  mismatched: number;
}

export interface BaselineSummary {
  passed: number;
  total: number;
}

export interface ApiSmokeSummary {
  host: string;
  port: number;
  address: string;
  healthOk: boolean;
  fixturesListed: number;
  searchFixtureId: string;
  searchStatus: BfsStatus;
}

export interface ReportVerification {
  s0GateJsonSha256Before: string;
  s0GateJsonSha256After: string;
  s0GateJsonUnchanged: boolean;
  reportRevalidated: boolean;
  apiSmoke: ApiSmokeSummary | null;
}

export interface AnalysisReport {
  schema: typeof SCHEMA_ANALYSIS_REPORT;
  seed: string;
  task: "T008";
  analysisStatus: AnalysisStatus;
  expectedCases: number;
  completedCases: number;
  baseline: BaselineSummary;
  verdictCounts: VerdictCounts;
  verdictCountsByKind: Record<string, VerdictCounts>;
  scores: StabilityScores;
  controls: ControlMetrics;
  coverage: Coverage;
  oracleParity: OracleParitySummary;
  witnesses: Record<string, WitnessSummary>;
  witnessCoverage: WitnessCoverage;
  cases: ReportCase[];
  externalRequests: number;
  blockedRequests: number;
  staticOfflineScanHits: number;
  hashes: ReportHashes;
  canonical: ReportCanonicalObjects;
  notes: string[];
  verification: ReportVerification | null;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

const VERDICTS: readonly string[] = [
  "STABLE",
  "WRONG_TARGET",
  "AMBIGUOUS",
  "MISSING",
];

const BFS_STATUSES: readonly string[] = [
  "FOUND",
  "BOUNDED_NO_WITNESS",
  "BOUNDED_INCOMPLETE",
];

/**
 * Structural validation of an AnalysisReport. Checks shapes, count
 * consistency, score numerator/denominator consistency, and the
 * witness-status rules (FOUND ⟺ witness non-null; BOUNDED_* ⟹ witness
 * null; witness depth equals sequence length and is within the frozen
 * depth cap). It does NOT recompute hashes — that is
 * recomputeReportHashes() in src/analysis/witness.ts (and the export
 * validator, which calls it), because hash recomputation needs the
 * canonical builders. Returns a list of error strings; empty means
 * structurally valid.
 */
export function validateReportStructure(report: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainObject(report)) {
    return ["report is not a plain object"];
  }
  if (report["schema"] !== SCHEMA_ANALYSIS_REPORT) {
    errors.push(
      `schema must be "${SCHEMA_ANALYSIS_REPORT}", got ${JSON.stringify(report["schema"])}`,
    );
  }
  if (report["seed"] !== "P022-LOCATORSTRESS-S0-2026-11-10") {
    errors.push(`seed must be "P022-LOCATORSTRESS-S0-2026-11-10"`);
  }
  if (report["task"] !== "T008") {
    errors.push(`task must be "T008"`);
  }
  if (
    report["analysisStatus"] !== "COMPLETE" &&
    report["analysisStatus"] !== "INCOMPLETE"
  ) {
    errors.push(`analysisStatus must be "COMPLETE" or "INCOMPLETE"`);
  }

  const cases = report["cases"];
  if (!Array.isArray(cases)) {
    errors.push("cases must be an array");
    return errors;
  }
  if (report["expectedCases"] !== cases.length) {
    errors.push(
      `expectedCases (${String(report["expectedCases"])}) must equal cases.length (${cases.length})`,
    );
  }
  let completed = 0;
  const counts: Record<string, number> = {
    STABLE: 0,
    WRONG_TARGET: 0,
    AMBIGUOUS: 0,
    MISSING: 0,
  };
  for (let i = 0; i < cases.length; i += 1) {
    const c = cases[i] as Record<string, unknown>;
    if (!isPlainObject(c)) {
      errors.push(`cases[${i}] is not a plain object`);
      continue;
    }
    if (c["verdict"] !== null && typeof c["verdict"] === "string" && VERDICTS.includes(c["verdict"])) {
      counts[c["verdict"]] += 1;
      completed += 1;
      if (c["analysisStatus"] !== "COMPLETE") {
        errors.push(
          `cases[${i}] (${String(c["fixtureId"])}/${String(c["mutationId"])}): verdict ${String(c["verdict"])} requires analysisStatus COMPLETE`,
        );
      }
    } else if (c["verdict"] === null) {
      if (c["analysisStatus"] !== "INCOMPLETE") {
        errors.push(
          `cases[${i}] (${String(c["fixtureId"])}/${String(c["mutationId"])}): null verdict requires analysisStatus INCOMPLETE`,
        );
      }
    } else {
      errors.push(`cases[${i}]: unknown verdict ${JSON.stringify(c["verdict"])}`);
    }
    if (!isNonNegativeInteger(c["matchCount"])) {
      errors.push(`cases[${i}]: matchCount must be a non-negative integer`);
    }
    if (
      c["identityMatch"] !== null &&
      c["identityMatch"] !== true &&
      c["identityMatch"] !== false
    ) {
      errors.push(`cases[${i}]: identityMatch must be boolean or null`);
    }
    if (
      typeof c["expectedVerdict"] !== "string" ||
      !VERDICTS.includes(c["expectedVerdict"])
    ) {
      errors.push(`cases[${i}]: expectedVerdict must be a four-state verdict`);
    }
  }
  if (report["completedCases"] !== completed) {
    errors.push(
      `completedCases (${String(report["completedCases"])}) must equal cases with a verdict (${completed})`,
    );
  }
  const vc = report["verdictCounts"];
  if (!isPlainObject(vc)) {
    errors.push("verdictCounts must be an object");
  } else {
    for (const v of VERDICTS) {
      if (vc[v] !== counts[v]) {
        errors.push(
          `verdictCounts.${v} (${String(vc[v])}) must equal counted ${v} cases (${counts[v]})`,
        );
      }
    }
  }

  const scores = report["scores"];
  if (!isPlainObject(scores) || !isPlainObject(scores["overall"])) {
    errors.push("scores.overall must be an object");
  } else {
    const overall = scores["overall"] as Record<string, unknown>;
    if (overall["expected"] !== cases.length) {
      errors.push(
        `scores.overall.expected (${String(overall["expected"])}) must equal cases.length (${cases.length})`,
      );
    }
    if (overall["completed"] !== completed) {
      errors.push(
        `scores.overall.completed (${String(overall["completed"])}) must equal completed cases (${completed})`,
      );
    }
    if (overall["scoreNumerator"] !== counts["STABLE"]) {
      errors.push(
        `scores.overall.scoreNumerator must equal STABLE count (${counts["STABLE"]})`,
      );
    }
    if (overall["scoreDenominator"] !== completed) {
      errors.push(
        `scores.overall.scoreDenominator must equal completed cases (${completed})`,
      );
    }
  }

  // Witness-status rules (T007 P2-1): status always present next to a
  // null witness; FOUND ⟺ witness non-null.
  const witnesses = report["witnesses"];
  if (!isPlainObject(witnesses)) {
    errors.push("witnesses must be an object");
  } else {
    let found = 0;
    let noWitness = 0;
    let incomplete = 0;
    for (const [fixtureId, w] of Object.entries(witnesses)) {
      if (!isPlainObject(w)) {
        errors.push(`witnesses.${fixtureId} is not a plain object`);
        continue;
      }
      const status = w["status"];
      if (typeof status !== "string" || !BFS_STATUSES.includes(status)) {
        errors.push(`witnesses.${fixtureId}: status must be a BfsStatus`);
        continue;
      }
      if (w["fixtureId"] !== fixtureId) {
        errors.push(
          `witnesses.${fixtureId}: fixtureId field must equal its key`,
        );
      }
      if (typeof w["meaning"] !== "string" || w["meaning"].length === 0) {
        errors.push(`witnesses.${fixtureId}: meaning must be a non-empty string`);
      }
      if (status === "FOUND") {
        found += 1;
        const witness = w["witness"];
        if (!isPlainObject(witness)) {
          errors.push(
            `witnesses.${fixtureId}: status FOUND requires a non-null witness`,
          );
        } else {
          const seq = witness["sequence"];
          if (!Array.isArray(seq) || seq.length === 0) {
            errors.push(`witnesses.${fixtureId}: witness.sequence must be a non-empty array`);
          } else if (witness["depth"] !== seq.length) {
            errors.push(
              `witnesses.${fixtureId}: witness.depth (${String(witness["depth"])}) must equal sequence length (${seq.length})`,
            );
          }
          if (
            typeof witness["depth"] !== "number" ||
            witness["depth"] > 6
          ) {
            errors.push(`witnesses.${fixtureId}: witness.depth must be within 0..6`);
          }
          if (
            typeof witness["verdict"] !== "string" ||
            !VERDICTS.includes(witness["verdict"]) ||
            witness["verdict"] === "STABLE"
          ) {
            errors.push(
              `witnesses.${fixtureId}: witness.verdict must be a failing four-state verdict`,
            );
          }
        }
      } else {
        if (status === "BOUNDED_NO_WITNESS") noWitness += 1;
        if (status === "BOUNDED_INCOMPLETE") incomplete += 1;
        if (w["witness"] !== null) {
          errors.push(
            `witnesses.${fixtureId}: status ${status} requires witness null`,
          );
        }
        // The status field itself is the guard: BOUNDED_INCOMPLETE is
        // never presented as a no-witness outcome. (The meaning text
        // for BOUNDED_INCOMPLETE explicitly negates "no witness", so no
        // substring check is applied here — it would false-positive on
        // the negation.)

      }
      if (!isPlainObject(w["limits"])) {
        errors.push(`witnesses.${fixtureId}: limits must be an object`);
      }
    }
    const wc = report["witnessCoverage"];
    if (!isPlainObject(wc)) {
      errors.push("witnessCoverage must be an object");
    } else {
      if (wc["searchedFixtures"] !== Object.keys(witnesses).length) {
        errors.push("witnessCoverage.searchedFixtures must equal witnesses size");
      }
      if (wc["found"] !== found) {
        errors.push(`witnessCoverage.found must equal FOUND count (${found})`);
      }
      if (wc["boundedNoWitness"] !== noWitness) {
        errors.push(
          `witnessCoverage.boundedNoWitness must equal BOUNDED_NO_WITNESS count (${noWitness})`,
        );
      }
      if (wc["boundedIncomplete"] !== incomplete) {
        errors.push(
          `witnessCoverage.boundedIncomplete must equal BOUNDED_INCOMPLETE count (${incomplete})`,
        );
      }
    }
  }

  const hashes = report["hashes"];
  if (!isPlainObject(hashes)) {
    errors.push("hashes must be an object");
  } else {
    for (const field of [
      "scenario_sha256",
      "oracle_result_sha256",
      "analysis_sha256",
      "gate_sha256",
    ]) {
      if (typeof hashes[field] !== "string" || !HASH_PATTERN.test(hashes[field])) {
        errors.push(`hashes.${field} must be a 64-char lowercase hex SHA-256`);
      }
    }
  }
  const canonical = report["canonical"];
  if (!isPlainObject(canonical)) {
    errors.push("canonical must be an object");
  } else {
    for (const field of ["scenario", "oracle", "analysis", "gate"]) {
      if (!isPlainObject(canonical[field])) {
        errors.push(`canonical.${field} must be an object`);
      }
    }
  }
  if (!isNonNegativeInteger(report["externalRequests"])) {
    errors.push("externalRequests must be a non-negative integer");
  }
  if (!isNonNegativeInteger(report["blockedRequests"])) {
    errors.push("blockedRequests must be a non-negative integer");
  }
  if (!isNonNegativeInteger(report["staticOfflineScanHits"])) {
    errors.push("staticOfflineScanHits must be a non-negative integer");
  }
  if (!Array.isArray(report["notes"])) {
    errors.push("notes must be an array");
  }
  return errors;
}
```
