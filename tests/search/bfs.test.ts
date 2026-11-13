// T007 unit tests — pure BFS, no browser.
//
// The evaluator here is a fake driven by an explicit verdict map keyed
// by sequence ("M01+M04"), plus an explicit state-key function, so every
// BFS property (shortest-first, tie-break, dedup, bounds, INCOMPLETE)
// is tested without Playwright. Browser behaviour is covered by
// bfs-browser.test.ts; determinism across repeated runs by
// bfs-determinism.test.ts.
//
// Spec: PROJECT_BOOK §5.6 (bounded BFS) and §5.7 (fixed order /
// tie-break); IMPLEMENTATION_PLAN T007.

import { describe, it, expect } from "vitest";

import type { MutationId } from "../../src/mutations/types.js";
import type { Verdict } from "../../src/verdict/classify.js";
import {
  runBoundedBfs,
  BFS_MAX_DEPTH,
  BFS_MAX_EXPANDED_STATES,
  type BfsEvaluator,
} from "../../src/search/bfs.js";
import {
  planStateKey,
  compareSequences,
  sequenceKey,
} from "../../src/search/state-key.js";
import { hashCanonical } from "../../src/canonical/canonical-json.js";

const FIXTURE = "F-TEST";

/** Fake evaluator: verdicts from a map; state key = plan hash unless overridden. */
function mapEvaluator(
  verdicts: Record<string, Verdict | null>,
  stateKeyFor?: (sequence: readonly MutationId[]) => string,
): { evaluator: BfsEvaluator; calls: string[] } {
  const calls: string[] = [];
  const evaluator: BfsEvaluator = async (sequence) => {
    calls.push(sequenceKey(sequence));
    const key = sequenceKey(sequence);
    // NB: `key in verdicts`, not `??`: an explicit null verdict means
    // INCOMPLETE and must survive (?? would coerce it to STABLE).
    const verdict = key in verdicts ? verdicts[key] : "STABLE";
    return {
      verdict,
      analysisStatus: verdict === null ? "INCOMPLETE" : "COMPLETE",
      stateKey: stateKeyFor
        ? stateKeyFor(sequence)
        : planStateKey(FIXTURE, sequence),
    };
  };
  return { evaluator, calls };
}

describe("state keys", () => {
  it("planStateKey is deterministic and order-sensitive", () => {
    expect(planStateKey(FIXTURE, ["M01", "M03"])).toBe(
      planStateKey(FIXTURE, ["M01", "M03"]),
    );
    expect(planStateKey(FIXTURE, ["M01", "M03"])).not.toBe(
      planStateKey(FIXTURE, ["M03", "M01"]),
    );
    expect(planStateKey(FIXTURE, ["M01"])).not.toBe(
      planStateKey("F-OTHER", ["M01"]),
    );
    expect(planStateKey(FIXTURE, [])).not.toBe(
      planStateKey(FIXTURE, ["M01"]),
    );
  });

  it("planStateKey equals the canonical hash of the documented object", () => {
    expect(planStateKey(FIXTURE, ["M02", "M04"])).toBe(
      hashCanonical({
        schema: "locatorstress.bfs-plan-state-key/v1",
        seed: "P022-LOCATORSTRESS-S0-2026-11-10",
        fixtureId: FIXTURE,
        plan: ["M02", "M04"],
      }),
    );
  });

  it("compareSequences orders lexicographically by mutation id", () => {
    expect(compareSequences(["M01", "M02"], ["M01", "M03"])).toBeLessThan(0);
    expect(compareSequences(["M02"], ["M01", "M08"])).toBeGreaterThan(0);
    expect(compareSequences(["M01"], ["M01"])).toBe(0);
    expect(compareSequences(["M01"], ["M01", "M02"])).toBeLessThan(0);
  });
});

describe("runBoundedBfs — shortest witness", () => {
  it("returns the depth-1 witness when a single mutation fails", async () => {
    const { evaluator } = mapEvaluator({ M04: "WRONG_TARGET" });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 1,
    });
    expect(result.status).toBe("FOUND");
    expect(result.witness).toEqual({
      sequence: ["M04"],
      depth: 1,
      verdict: "WRONG_TARGET",
    });
    // Root + M01..M04 evaluated; M05..M08 never reached.
    expect(result.statesEvaluated).toBe(5);
    expect(result.statesExpanded).toBe(1);
    expect(result.maxDepthReached).toBe(1);
  });

  it("returns the shortest witness, not the first failing sequence in operator order", async () => {
    // Depth-1 all STABLE; the only depth-2 failure is M03+M07.
    // A depth-3 failure also exists but must not win over depth 2.
    const { evaluator } = mapEvaluator({
      "M03+M07": "AMBIGUOUS",
      "M01+M02+M03": "MISSING",
    });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 3,
    });
    expect(result.status).toBe("FOUND");
    expect(result.witness?.sequence).toEqual(["M03", "M07"]);
    expect(result.witness?.depth).toBe(2);
  });

  it("finds witnesses at depths 3, 4 and 5", async () => {
    for (const depth of [3, 4, 5]) {
      const ops: MutationId[] = ["M01", "M02", "M03", "M04", "M05", "M06"];
      const seq = ops.slice(0, depth);
      const { evaluator } = mapEvaluator({ [sequenceKey(seq)]: "MISSING" });
      const result = await runBoundedBfs(evaluator, {
        fixtureId: FIXTURE,
        maxDepth: 6,
      });
      expect(result.status).toBe("FOUND");
      expect(result.witness?.sequence).toEqual(seq);
      expect(result.witness?.depth).toBe(depth);
    }
  });

  it("finds a depth-6 witness when the operator set is small enough for the budget", async () => {
    // With 6 operators the depth-5 frontier is 720 nodes, so reaching
    // depth 6 costs ~1,237 expansions — inside the 4096 budget.
    const ops: MutationId[] = ["M01", "M02", "M03", "M04", "M05", "M06"];
    const { evaluator } = mapEvaluator({ "M01+M02+M03+M04+M05+M06": "MISSING" });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 6,
      operatorOrder: ops,
    });
    expect(result.status).toBe("FOUND");
    expect(result.witness?.sequence).toEqual(ops);
    expect(result.witness?.depth).toBe(6);
  });

  it("honestly reports BOUNDED_INCOMPLETE for a depth-6 witness in the full 8-operator space", async () => {
    // Reaching depth 6 in the full no-repeat space requires expanding
    // every node of depth 0..5 (1+8+56+336+1680+6720 = 8,801 states)
    // before the first depth-6 node is dequeued — more than the frozen
    // 4096 budget. The search must say so, not pretend depth 6 was
    // covered. (Dedup / INCOMPLETE pruning in a real DOM tree can
    // shrink the frontier; the pure tree cannot.)
    const { evaluator } = mapEvaluator({
      "M01+M02+M03+M04+M05+M06": "MISSING",
    });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 6,
    });
    expect(result.status).toBe("BOUNDED_INCOMPLETE");
    expect(result.statesExpanded).toBe(4096);
    expect(result.queueRemaining).toBeGreaterThan(0);
    expect(result.witness).toBeNull();
  });

  it("reports a depth-0 witness when the baseline itself fails", async () => {
    const { evaluator } = mapEvaluator({ "": "MISSING" });
    const result = await runBoundedBfs(evaluator, { fixtureId: FIXTURE });
    expect(result.status).toBe("FOUND");
    expect(result.witness).toEqual({ sequence: [], depth: 0, verdict: "MISSING" });
    expect(result.statesEvaluated).toBe(1);
    expect(result.statesExpanded).toBe(0);
  });
});

describe("runBoundedBfs — tie-break", () => {
  it("among same-depth witnesses picks the lexicographically smallest sequence", async () => {
    const { evaluator } = mapEvaluator({
      "M02+M01": "WRONG_TARGET",
      "M01+M02": "WRONG_TARGET",
      "M01+M03": "AMBIGUOUS",
    });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 2,
    });
    expect(result.witness?.sequence).toEqual(["M01", "M02"]);
  });

  it("among depth-1 witnesses picks the smallest failing operator", async () => {
    const { evaluator } = mapEvaluator({
      M02: "MISSING",
      M04: "WRONG_TARGET",
      M07: "AMBIGUOUS",
    });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 1,
    });
    expect(result.witness?.sequence).toEqual(["M02"]);
    expect(result.witness?.verdict).toBe("MISSING");
  });
});

describe("runBoundedBfs — no witness and bounds", () => {
  it("reports BOUNDED_NO_WITNESS when the queue empties within the bounds", async () => {
    const { evaluator } = mapEvaluator({});
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 2,
    });
    expect(result.status).toBe("BOUNDED_NO_WITNESS");
    expect(result.witness).toBeNull();
    expect(result.queueRemaining).toBe(0);
    // Root + 8 depth-1 + 56 depth-2 = 65 evaluations; 1 + 8 expansions.
    expect(result.statesEvaluated).toBe(65);
    expect(result.statesExpanded).toBe(9);
    expect(result.uniqueStates).toBe(65);
    expect(result.statesDeduplicated).toBe(0);
  });

  it("reports BOUNDED_NO_WITNESS when the failure is deeper than maxDepth", async () => {
    const { evaluator } = mapEvaluator({ "M01+M02+M03": "MISSING" });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 2,
    });
    expect(result.status).toBe("BOUNDED_NO_WITNESS");
    expect(result.maxDepthReached).toBe(2);
  });

  it("reports BOUNDED_INCOMPLETE, never NO_WITNESS, when the state budget runs out", async () => {
    const { evaluator } = mapEvaluator({});
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 6,
      maxExpandedStates: 3,
    });
    expect(result.status).toBe("BOUNDED_INCOMPLETE");
    expect(result.witness).toBeNull();
    expect(result.statesExpanded).toBe(3);
    expect(result.queueRemaining).toBeGreaterThan(0);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it("still finds a witness even when the budget would have run out later", async () => {
    const { evaluator } = mapEvaluator({ M01: "MISSING" });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 6,
      maxExpandedStates: 1,
    });
    expect(result.status).toBe("FOUND");
    expect(result.witness?.sequence).toEqual(["M01"]);
  });
});

describe("runBoundedBfs — dedup and no-repeat", () => {
  it("prunes a duplicate state and never expands it", async () => {
    // [M02] and [M03] converge on the same DOM state key ("shared-dom-key").
    // The first visit ([M02]) is kept and expanded; the second ([M03])
    // is pruned as a duplicate and its children are never evaluated.
    // The witness [M02, M04] is reachable through the kept path.
    const { evaluator, calls } = mapEvaluator(
      { "M02+M04": "WRONG_TARGET" },
      (sequence) => {
        if (sequenceKey(sequence) === "M03") return "shared-dom-key";
        if (sequenceKey(sequence) === "M02") return "shared-dom-key";
        return planStateKey(FIXTURE, sequence);
      },
    );
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 2,
    });
    expect(result.status).toBe("FOUND");
    expect(result.witness?.sequence).toEqual(["M02", "M04"]);
    expect(result.statesDeduplicated).toBe(1);
    // No child of the duplicate [M03] was ever evaluated.
    expect(calls.filter((c) => c.startsWith("M03+"))).toEqual([]);
    // But children of the kept [M02] were evaluated.
    expect(calls).toContain("M02+M04");
  });

  it("never repeats an operator within one sequence", async () => {
    const { evaluator, calls } = mapEvaluator({});
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 6,
      maxExpandedStates: 4096,
    });
    expect(result.status).toBe("BOUNDED_INCOMPLETE");
    for (const call of calls) {
      const ops = call === "" ? [] : call.split("+");
      expect(new Set(ops).size).toBe(ops.length);
    }
    // Full no-repeat space to depth 6 is 28,961 sequences; the 4096
    // expansion budget stops the search first.
    expect(result.statesExpanded).toBe(4096);
  });

  it("allowRepeat explores repeated operators (test hook only)", async () => {
    const { evaluator, calls } = mapEvaluator({ "M01+M01": "MISSING" });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 2,
      allowRepeat: true,
    });
    expect(result.status).toBe("FOUND");
    expect(result.witness?.sequence).toEqual(["M01", "M01"]);
    expect(calls).toContain("M01+M01");
  });
});

describe("runBoundedBfs — INCOMPLETE is never a witness", () => {
  it("skips an incomplete node, does not expand it, and keeps searching", async () => {
    const { evaluator, calls } = mapEvaluator({
      M01: null,
      M02: "AMBIGUOUS",
    });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 2,
    });
    expect(result.status).toBe("FOUND");
    expect(result.witness?.sequence).toEqual(["M02"]);
    expect(result.incompleteStates).toBe(1);
    expect(calls.filter((c) => c.startsWith("M01+"))).toEqual([]);
  });

  it("an incomplete root is BOUNDED_INCOMPLETE, never BOUNDED_NO_WITNESS", async () => {
    const { evaluator } = mapEvaluator({ "": null });
    const result = await runBoundedBfs(evaluator, { fixtureId: FIXTURE });
    expect(result.status).toBe("BOUNDED_INCOMPLETE");
    expect(result.witness).toBeNull();
    expect(result.incompleteStates).toBe(1);
    expect(result.statesEvaluated).toBe(1);
  });
});

describe("runBoundedBfs — option validation and defaults", () => {
  it("defaults to the frozen limits (depth 6, 4096 states)", async () => {
    const { evaluator } = mapEvaluator({});
    const result = await runBoundedBfs(evaluator, { fixtureId: FIXTURE });
    expect(result.limits).toEqual({ maxDepth: 6, maxExpandedStates: 4096 });
    expect(BFS_MAX_DEPTH).toBe(6);
    expect(BFS_MAX_EXPANDED_STATES).toBe(4096);
  });

  it("rejects maxDepth above the frozen cap", async () => {
    const { evaluator } = mapEvaluator({});
    await expect(
      runBoundedBfs(evaluator, { fixtureId: FIXTURE, maxDepth: 7 }),
    ).rejects.toThrow(RangeError);
  });

  it("rejects maxExpandedStates above the frozen cap and below 1", async () => {
    const { evaluator } = mapEvaluator({});
    await expect(
      runBoundedBfs(evaluator, { fixtureId: FIXTURE, maxExpandedStates: 4097 }),
    ).rejects.toThrow(RangeError);
    await expect(
      runBoundedBfs(evaluator, { fixtureId: FIXTURE, maxExpandedStates: 0 }),
    ).rejects.toThrow(RangeError);
  });

  it("rejects an empty operator order", async () => {
    const { evaluator } = mapEvaluator({});
    await expect(
      runBoundedBfs(evaluator, { fixtureId: FIXTURE, operatorOrder: [] }),
    ).rejects.toThrow(/must not be empty/);
  });
});
