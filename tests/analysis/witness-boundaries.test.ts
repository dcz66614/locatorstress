// T011 — witness meaning / budget-note boundaries (T008, PROJECT_BOOK §5.6).
//
// The T008 witness tests cover the three statuses and the depth-6 note
// at frozen bounds. These rows pin the exact wording contracts a
// mutation could soften: FOUND must name sequence + verdict + depth,
// BOUNDED_NO_WITNESS must disclaim safety, BOUNDED_INCOMPLETE must
// never read as "no witness", and the budget note must appear only at
// exactly 6/4096.

import { describe, it, expect } from "vitest";

import {
  DEPTH6_UNPRUNED_EXPANSIONS,
  depth6BudgetNote,
  summarizeWitness,
  witnessMeaning,
} from "../../src/analysis/witness.js";
import { fakeBfsResult } from "../t008-helpers.js";

describe("witnessMeaning — exact wording contracts", () => {
  it("FOUND names the sequence, the verdict and the depth", () => {
    const text = witnessMeaning(
      "FOUND",
      { sequence: ["M01", "M04"], depth: 2, verdict: "AMBIGUOUS" },
      { maxDepth: 6, maxExpandedStates: 4096 },
      0,
    );
    expect(text).toContain("M01+M04");
    expect(text).toContain("AMBIGUOUS");
    expect(text).toContain("depth 2");
  });

  it("FOUND at depth 0 names the baseline failure", () => {
    const text = witnessMeaning(
      "FOUND",
      { sequence: [], depth: 0, verdict: "MISSING" },
      { maxDepth: 6, maxExpandedStates: 4096 },
      0,
    );
    expect(text).toContain("MISSING");
    expect(text).toContain("depth 0");
  });

  it("BOUNDED_NO_WITNESS names the limits and disclaims safety", () => {
    const text = witnessMeaning(
      "BOUNDED_NO_WITNESS",
      null,
      { maxDepth: 3, maxExpandedStates: 100 },
      0,
    );
    expect(text).toContain("depth <= 3");
    expect(text).toContain("<= 100 expansions");
    expect(text).toContain("does NOT prove the locator is safe");
  });

  it("BOUNDED_INCOMPLETE names the queue remainder and negates every soft reading", () => {
    const text = witnessMeaning("BOUNDED_INCOMPLETE", null, { maxDepth: 6, maxExpandedStates: 4096 }, 42);
    expect(text).toContain("42 sequence(s) still queued");
    expect(text).toContain("INCOMPLETE");
    expect(text).toContain('NOT "no witness"');
    expect(text).toContain('NOT "no failure"');
    expect(text).toContain('NOT "safe"');
  });

  it("DEPTH6_UNPRUNED_EXPANSIONS is the documented 8801 (1+8+56+336+1680+6720)", () => {
    expect(DEPTH6_UNPRUNED_EXPANSIONS).toBe(8801);
    expect(1 + 8 + 56 + 336 + 1680 + 6720).toBe(8801);
  });
});

describe("depth6BudgetNote — appears only at exactly the frozen bounds", () => {
  function incompleteAt(limits: { maxDepth: number; maxExpandedStates: number }) {
    return fakeBfsResult({ status: "BOUNDED_INCOMPLETE", limits, queueRemaining: 3 });
  }

  it("appears at 6/4096 and quotes the 8801-expansion arithmetic", () => {
    const note = depth6BudgetNote(incompleteAt({ maxDepth: 6, maxExpandedStates: 4096 }));
    expect(note).toContain("8801");
    expect(note).toContain("1+8+56+336+1680+6720");
    expect(note).toContain("4096");
  });

  it("does not appear at reduced depth (5/4096)", () => {
    expect(depth6BudgetNote(incompleteAt({ maxDepth: 5, maxExpandedStates: 4096 }))).toBeUndefined();
  });

  it("does not appear at reduced budget (6/100)", () => {
    expect(depth6BudgetNote(incompleteAt({ maxDepth: 6, maxExpandedStates: 100 }))).toBeUndefined();
  });

  it("does not appear for BOUNDED_NO_WITNESS even at frozen bounds", () => {
    const r = fakeBfsResult({ status: "BOUNDED_NO_WITNESS" });
    expect(depth6BudgetNote(r)).toBeUndefined();
  });

  it("does not appear for FOUND even at frozen bounds", () => {
    const r = fakeBfsResult({
      status: "FOUND",
      witness: { sequence: ["M01"], depth: 1, verdict: "MISSING" },
    });
    expect(depth6BudgetNote(r)).toBeUndefined();
  });
});

describe("summarizeWitness — copies counts verbatim, never softens status", () => {
  it("copies limits and counts verbatim into the summary", () => {
    const s = summarizeWitness(
      fakeBfsResult({
        status: "BOUNDED_NO_WITNESS",
        limits: { maxDepth: 2, maxExpandedStates: 50 },
        statesEvaluated: 11,
        statesExpanded: 3,
        statesDeduplicated: 2,
        uniqueStates: 9,
        incompleteStates: 1,
        maxDepthReached: 2,
        queueRemaining: 0,
        perDepthEvaluated: { 0: 1, 1: 8, 2: 2 },
      }),
    );
    expect(s.limits).toEqual({ maxDepth: 2, maxExpandedStates: 50 });
    expect(s.statesEvaluated).toBe(11);
    expect(s.statesExpanded).toBe(3);
    expect(s.statesDeduplicated).toBe(2);
    expect(s.uniqueStates).toBe(9);
    expect(s.incompleteStates).toBe(1);
    expect(s.maxDepthReached).toBe(2);
    expect(s.perDepthEvaluated).toEqual({ 0: 1, 1: 8, 2: 2 });
  });

  it("a FOUND summary with a depth-6 witness at frozen bounds carries no budget note", () => {
    // A witness was found, so the budget never ran out: no note.
    const s = summarizeWitness(
      fakeBfsResult({
        status: "FOUND",
        witness: { sequence: ["M01", "M02", "M03", "M04", "M05", "M06"], depth: 6, verdict: "MISSING" },
      }),
    );
    expect(s.budgetNote).toBeUndefined();
  });

  it("throws when a FOUND witness depth disagrees with its sequence length", () => {
    expect(() =>
      summarizeWitness(
        fakeBfsResult({
          status: "FOUND",
          witness: { sequence: ["M01"], depth: 2, verdict: "MISSING" },
        }),
      ),
    ).toThrow(/depth 2 != sequence length 1/);
  });

  it("summarizeWitness does not mutate its input result", () => {
    const input = fakeBfsResult({
      status: "FOUND",
      witness: { sequence: ["M01"], depth: 1, verdict: "WRONG_TARGET" },
      notes: ["n1"],
    });
    const before = JSON.stringify(input);
    summarizeWitness(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
