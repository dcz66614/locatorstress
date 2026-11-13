// T011 — BFS state-key boundaries (PROJECT_BOOK §5.6/§5.7).
//
// The T007 tests pin planStateKey determinism/order-sensitivity and
// compareSequences. These rows pin the rest: domStateKey convergence
// (same DOM, different plan -> same key), sequenceKey, isFailureVerdict
// for every input including null, compareSequences prefix/empty cases,
// and the schema strings that keep the two key kinds distinct.

import { describe, it, expect } from "vitest";

import {
  SCHEMA_BFS_DOM_STATE_KEY,
  SCHEMA_BFS_PLAN_STATE_KEY,
  compareSequences,
  domStateKey,
  isFailureVerdict,
  planStateKey,
  sequenceKey,
} from "../../src/search/state-key.js";

describe("sequenceKey", () => {
  it("root is the empty string", () => {
    expect(sequenceKey([])).toBe("");
  });

  it("joins with +", () => {
    expect(sequenceKey(["M01"])).toBe("M01");
    expect(sequenceKey(["M01", "M04", "M08"])).toBe("M01+M04+M08");
  });

  it("is order-sensitive as a string", () => {
    expect(sequenceKey(["M01", "M03"])).not.toBe(sequenceKey(["M03", "M01"]));
  });
});

describe("planStateKey — order and fixture sensitivity", () => {
  it("same plan twice gives the same key", () => {
    expect(planStateKey("F001", ["M01", "M02"])).toBe(planStateKey("F001", ["M01", "M02"]));
  });

  it("different order gives a different key (plan hash is order-sensitive)", () => {
    expect(planStateKey("F001", ["M01", "M03"])).not.toBe(planStateKey("F001", ["M03", "M01"]));
  });

  it("different fixture gives a different key for the same plan", () => {
    expect(planStateKey("F001", ["M01"])).not.toBe(planStateKey("F002", ["M01"]));
  });

  it("root plan key differs from any non-empty plan key", () => {
    expect(planStateKey("F001", [])).not.toBe(planStateKey("F001", ["M01"]));
  });

  it("keys are 64 lowercase hex chars", () => {
    expect(planStateKey("F001", ["M01"])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("plan and DOM key schemas are distinct strings", () => {
    expect(SCHEMA_BFS_PLAN_STATE_KEY).not.toBe(SCHEMA_BFS_DOM_STATE_KEY);
    expect(SCHEMA_BFS_PLAN_STATE_KEY).toContain("bfs-plan-state-key");
    expect(SCHEMA_BFS_DOM_STATE_KEY).toContain("bfs-dom-state-key");
  });
});

describe("domStateKey — convergence on identical DOM", () => {
  const html = "<main><button class=\"primary\">Save</button></main>";

  it("same DOM twice gives the same key", () => {
    expect(domStateKey("F001", html)).toBe(domStateKey("F001", html));
  });

  it("different DOM gives a different key", () => {
    expect(domStateKey("F001", html)).not.toBe(
      domStateKey("F001", "<main><button>Other</button></main>"),
    );
  });

  it("same DOM in a different fixture gives a different key", () => {
    expect(domStateKey("F001", html)).not.toBe(domStateKey("F002", html));
  });

  it("whitespace differences are significant (no normalisation of the DOM string)", () => {
    expect(domStateKey("F001", "<a> x </a>")).not.toBe(domStateKey("F001", "<a>x</a>"));
  });

  it("a plan key never equals a DOM key for the same fixture", () => {
    expect(planStateKey("F001", ["M01"])).not.toBe(domStateKey("F001", html));
  });
});

describe("compareSequences — tie-break ordering", () => {
  it("empty sequences compare equal", () => {
    expect(compareSequences([], [])).toBe(0);
  });

  it("a prefix is smaller than the longer sequence", () => {
    expect(compareSequences(["M01"], ["M01", "M02"])).toBeLessThan(0);
    expect(compareSequences(["M01", "M02"], ["M01"])).toBeGreaterThan(0);
  });

  it("orders by first differing operator", () => {
    expect(compareSequences(["M02"], ["M03"])).toBeLessThan(0);
    expect(compareSequences(["M08"], ["M01"])).toBeGreaterThan(0);
  });

  it("orders by the second element when the first is equal", () => {
    expect(compareSequences(["M01", "M02"], ["M01", "M03"])).toBeLessThan(0);
  });

  it("is consistent with Array.sort for a shuffled operator list", () => {
    const seqs: Array<Array<"M01" | "M02" | "M03" | "M04" | "M05" | "M06" | "M07" | "M08">> = [
      ["M02"],
      ["M01", "M03"],
      [],
      ["M01"],
      ["M01", "M02"],
    ];
    expect([...seqs].sort(compareSequences)).toEqual([[], ["M01"], ["M01", "M02"], ["M01", "M03"], ["M02"]]);
  });
});

describe("isFailureVerdict — the BFS failure predicate", () => {
  it("STABLE is not a failure", () => {
    expect(isFailureVerdict("STABLE")).toBe(false);
  });

  it("WRONG_TARGET, AMBIGUOUS and MISSING are failures", () => {
    expect(isFailureVerdict("WRONG_TARGET")).toBe(true);
    expect(isFailureVerdict("AMBIGUOUS")).toBe(true);
    expect(isFailureVerdict("MISSING")).toBe(true);
  });

  it("null (no verdict claimed) is NOT a failure — an INCOMPLETE node is never a witness", () => {
    expect(isFailureVerdict(null)).toBe(false);
  });
});
