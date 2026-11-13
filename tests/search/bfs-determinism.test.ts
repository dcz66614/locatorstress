// T007 determinism tests — the BFS must return byte-identical results
// across repeated runs with the same evaluator and options.
//
// The evaluator here is a deterministic pseudo-random function of the
// sequence (fixed-seed LCG over the plan hash), so the test exercises a
// non-trivial search tree — witnesses at several depths, duplicates via
// a colliding state key — rather than a hand-picked map. Three fresh
// runs must produce deeply equal result objects, and the canonical JSON
// of each result must hash identically.
//
// Spec: PROJECT_BOOK §5.6 / §5.7 (fixed order, tie-break, no
// randomness); IMPLEMENTATION_PLAN T007 (test:bfs:determinism).

import { describe, it, expect } from "vitest";

import type { MutationId } from "../../src/mutations/types.js";
import type { Verdict } from "../../src/verdict/classify.js";
import {
  runBoundedBfs,
  type BfsEvaluator,
  type BfsResult,
} from "../../src/search/bfs.js";
import {
  planStateKey,
  sequenceKey,
} from "../../src/search/state-key.js";
import { canonicalJson, hashCanonical } from "../../src/canonical/canonical-json.js";

const FIXTURE = "F-DET";

/** Deterministic 32-bit hash of a string (FNV-1a). No Math.random. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Deterministic evaluator: verdict from the FNV-1a hash of the plan key.
 *   - hash % 23 === 0 and depth >= 1 -> WRONG_TARGET (sparse failures)
 *   - hash % 31 === 0 -> INCOMPLETE (null verdict, never a witness)
 *   - otherwise STABLE
 * State key: the plan hash, except sequences ending in M08 collapse
 * onto the key of the same sequence without M08 (a deterministic
 * duplicate), exercising dedup on every run.
 */
function deterministicEvaluator(): BfsEvaluator {
  return async (sequence) => {
    const key = sequenceKey(sequence);
    const h = fnv1a(key);
    let verdict: Verdict | null = "STABLE";
    if (sequence.length >= 1 && h % 23 === 0) verdict = "WRONG_TARGET";
    else if (h % 31 === 0) verdict = null;
    const stateKey =
      sequence.length > 0 && sequence[sequence.length - 1] === "M08"
        ? planStateKey(FIXTURE, sequence.slice(0, -1))
        : planStateKey(FIXTURE, sequence);
    return {
      verdict,
      analysisStatus: verdict === null ? "INCOMPLETE" : "COMPLETE",
      stateKey,
    };
  };
}

async function runOnce(options: {
  maxDepth: number;
  maxExpandedStates?: number;
}): Promise<BfsResult> {
  return runBoundedBfs(deterministicEvaluator(), {
    fixtureId: FIXTURE,
    ...options,
  });
}

describe("BFS determinism", () => {
  it("three runs of a depth-3 search return deeply equal results", async () => {
    const runs = await Promise.all([
      runOnce({ maxDepth: 3 }),
      runOnce({ maxDepth: 3 }),
      runOnce({ maxDepth: 3 }),
    ]);
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
    expect(canonicalJson(runs[0])).toBe(canonicalJson(runs[1]));
    expect(hashCanonical(runs[0])).toBe(hashCanonical(runs[1]));
  });

  it("three runs of a budget-limited depth-6 search return deeply equal results", async () => {
    // All-STABLE evaluator: the budget is the only thing that can stop
    // the search, so the outcome is BOUNDED_INCOMPLETE on every run.
    const stable: BfsEvaluator = async (sequence) => ({
      verdict: "STABLE",
      analysisStatus: "COMPLETE",
      stateKey: planStateKey(FIXTURE, sequence),
    });
    const runs = await Promise.all([
      runBoundedBfs(stable, { fixtureId: FIXTURE, maxDepth: 6, maxExpandedStates: 64 }),
      runBoundedBfs(stable, { fixtureId: FIXTURE, maxDepth: 6, maxExpandedStates: 64 }),
      runBoundedBfs(stable, { fixtureId: FIXTURE, maxDepth: 6, maxExpandedStates: 64 }),
    ]);
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
    expect(runs[0].status).toBe("BOUNDED_INCOMPLETE");
    expect(runs[0].statesExpanded).toBe(64);
    expect(runs[0].queueRemaining).toBeGreaterThan(0);
  });

  it("the deterministic evaluator exercises a witness and dedup with fixed counts", async () => {
    // Exact outcome of the fixed-seed evaluator at depth 3, measured
    // 2026-11-10 (FNV-1a over the plan key; M08-collapsing state keys).
    // Locked here so any future change to BFS order, dedup or the
    // failure predicate shows up as a test failure, not silent drift.
    // (INCOMPLETE handling itself is covered in bfs.test.ts; this
    // evaluator happens to produce 0 incomplete states before the
    // depth-2 witness stops the search.)
    const result = await runOnce({ maxDepth: 3 });
    expect(result.status).toBe("FOUND");
    expect(result.witness).toEqual({
      sequence: ["M02", "M05"],
      depth: 2,
      verdict: "WRONG_TARGET",
    });
    expect(result.statesEvaluated).toBe(20);
    expect(result.statesExpanded).toBe(17);
    expect(result.statesDeduplicated).toBe(2);
    expect(result.uniqueStates).toBe(18);
    expect(result.incompleteStates).toBe(0);
    expect(result.maxDepthReached).toBe(2);
  });

  it("evaluation order within a depth is lexicographic on every run", async () => {
    const result = await runOnce({ maxDepth: 2 });
    const byDepth = new Map<number, MutationId[][]>();
    for (const ev of result.evaluations) {
      const list = byDepth.get(ev.depth) ?? [];
      list.push(ev.sequence);
      byDepth.set(ev.depth, list);
    }
    for (const [depth, sequences] of byDepth) {
      const keys = sequences.map((s) => sequenceKey(s));
      const sorted = [...keys].sort();
      expect(keys, `depth ${depth} not in lexicographic order`).toEqual(sorted);
    }
  });
});
