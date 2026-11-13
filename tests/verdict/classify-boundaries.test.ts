// T011 — classifyVerdict extra boundaries (PROJECT_BOOK §5.2/§5.3).
//
// The T004 table already covers the four verdicts, all execution
// statuses, frame precedence and contradictory counts. These rows pin
// the remaining edges a mutation could flip without tripping that
// table: frame failure when the selector DID match, identity values
// that must be ignored once an earlier rule has decided, NaN /
// Infinity counts, and large-count boundaries.

import { describe, it, expect } from "vitest";

import type { ResolverResult } from "../../src/runner/execution.js";
import { classifyVerdict } from "../../src/verdict/classify.js";

function completed(overrides: Partial<ResolverResult> = {}): ResolverResult {
  return {
    executionStatus: "COMPLETED",
    rawMatchCount: 1,
    finalMatchCount: 1,
    frameFailure: null,
    errorMessage: null,
    ...overrides,
  };
}

describe("classifyVerdict — frame failure beats a matching selector", () => {
  it("FRAME_AMBIGUOUS wins even when raw/final counts are 1/1 with identity true", () => {
    const out = classifyVerdict(
      completed({
        frameFailure: { layer: 0, selector: "iframe.a", matchCount: 2, kind: "FRAME_AMBIGUOUS" },
      }),
      true,
    );
    expect(out.verdict).toBe("AMBIGUOUS");
    expect(out.analysisStatus).toBe("COMPLETE");
  });

  it("FRAME_MISSING wins even when raw/final counts are 1/1 with identity true", () => {
    const out = classifyVerdict(
      completed({
        frameFailure: { layer: 1, selector: "iframe.inner", matchCount: 0, kind: "FRAME_MISSING" },
      }),
      true,
    );
    expect(out.verdict).toBe("MISSING");
    expect(out.analysisStatus).toBe("COMPLETE");
  });

  it("frameFailure kind decides, not the matchCount number: kind MISSING with count 2 is still MISSING", () => {
    // A contradictory resolver payload: kind is authoritative per §5.2.
    const out = classifyVerdict(
      completed({
        rawMatchCount: 0,
        finalMatchCount: 0,
        frameFailure: { layer: 0, selector: "iframe.a", matchCount: 2, kind: "FRAME_MISSING" },
      }),
      null,
    );
    expect(out.verdict).toBe("MISSING");
  });
});

describe("classifyVerdict — identity is only consulted at exactly 1 final match", () => {
  it("identity true with 0 final matches is MISSING, not STABLE", () => {
    expect(classifyVerdict(completed({ rawMatchCount: 0, finalMatchCount: 0 }), true).verdict).toBe(
      "MISSING",
    );
  });

  it("identity true with 2 final matches is AMBIGUOUS, not STABLE", () => {
    expect(classifyVerdict(completed({ rawMatchCount: 2, finalMatchCount: 2 }), true).verdict).toBe(
      "AMBIGUOUS",
    );
  });

  it("identity false with 0 final matches is MISSING, not WRONG_TARGET", () => {
    expect(classifyVerdict(completed({ rawMatchCount: 0, finalMatchCount: 0 }), false).verdict).toBe(
      "MISSING",
    );
  });

  it("identity null with 2 final matches is AMBIGUOUS (identity is irrelevant there)", () => {
    expect(classifyVerdict(completed({ rawMatchCount: 5, finalMatchCount: 5 }), null).verdict).toBe(
      "AMBIGUOUS",
    );
  });

  it("large counts: raw 1000 / final 1000 is AMBIGUOUS", () => {
    expect(
      classifyVerdict(completed({ rawMatchCount: 1000, finalMatchCount: 1000 }), null).verdict,
    ).toBe("AMBIGUOUS");
  });

  it("large counts: raw 1000 narrowed to final 1 with identity true is STABLE", () => {
    expect(
      classifyVerdict(completed({ rawMatchCount: 1000, finalMatchCount: 1 }), true).verdict,
    ).toBe("STABLE");
  });

  it("boundary raw == final == 1 with identity null is INCOMPLETE, never a guess", () => {
    const out = classifyVerdict(completed({ rawMatchCount: 1, finalMatchCount: 1 }), null);
    expect(out.verdict).toBeNull();
    expect(out.analysisStatus).toBe("INCOMPLETE");
    expect(out.reason).toMatch(/identity is unknown/);
  });
});

describe("classifyVerdict — non-finite and contradictory counts", () => {
  it("NaN rawMatchCount yields no verdict", () => {
    const out = classifyVerdict(completed({ rawMatchCount: NaN, finalMatchCount: 0 }), null);
    expect(out.verdict).toBeNull();
    expect(out.analysisStatus).toBe("INCOMPLETE");
  });

  it("NaN finalMatchCount yields no verdict", () => {
    const out = classifyVerdict(completed({ rawMatchCount: 1, finalMatchCount: NaN }), null);
    expect(out.verdict).toBeNull();
  });

  it("Infinity rawMatchCount yields no verdict", () => {
    const out = classifyVerdict(completed({ rawMatchCount: Infinity, finalMatchCount: 1 }), true);
    expect(out.verdict).toBeNull();
  });

  it("negative raw with negative final yields no verdict", () => {
    expect(classifyVerdict(completed({ rawMatchCount: -2, finalMatchCount: -1 }), null).verdict).toBeNull();
  });

  it("final == raw == 0 with a frame failure still follows the frame rule", () => {
    const out = classifyVerdict(
      completed({
        rawMatchCount: 0,
        finalMatchCount: 0,
        frameFailure: { layer: 0, selector: "iframe.a", matchCount: 3, kind: "FRAME_AMBIGUOUS" },
      }),
      null,
    );
    expect(out.verdict).toBe("AMBIGUOUS");
  });
});

describe("classifyVerdict — negative counts with a decisive identity (kills the >= 0 mutant)", () => {
  // T011 mutation finding: dropping the `value >= 0` check from
  // isValidCount survived the suite (M-CL-06) because every
  // negative-count row used identity null, and with identity null a
  // negative final count still falls through to INCOMPLETE. These
  // rows pin the guard with a decisive identity: without the >= 0
  // check, raw 1 / final -1 / identity true would be misread STABLE.
  it("raw 1, final -1, identity true is no verdict (not STABLE)", () => {
    const out = classifyVerdict(completed({ rawMatchCount: 1, finalMatchCount: -1 }), true);
    expect(out.verdict).toBeNull();
    expect(out.analysisStatus).toBe("INCOMPLETE");
  });

  it("raw 1, final -1, identity false is no verdict (not WRONG_TARGET)", () => {
    const out = classifyVerdict(completed({ rawMatchCount: 1, finalMatchCount: -1 }), false);
    expect(out.verdict).toBeNull();
    expect(out.analysisStatus).toBe("INCOMPLETE");
  });

  it("raw 0, final -1, identity true is no verdict", () => {
    const out = classifyVerdict(completed({ rawMatchCount: 0, finalMatchCount: -1 }), true);
    expect(out.verdict).toBeNull();
    expect(out.analysisStatus).toBe("INCOMPLETE");
  });

  it("raw -1, final -1, identity true is no verdict (both counts negative)", () => {
    const out = classifyVerdict(completed({ rawMatchCount: -1, finalMatchCount: -1 }), true);
    expect(out.verdict).toBeNull();
    expect(out.analysisStatus).toBe("INCOMPLETE");
  });

  it("raw -1, final -2, identity false is no verdict", () => {
    const out = classifyVerdict(completed({ rawMatchCount: -1, finalMatchCount: -2 }), false);
    expect(out.verdict).toBeNull();
    expect(out.analysisStatus).toBe("INCOMPLETE");
  });
});

describe("classifyVerdict — reason strings name the deciding rule", () => {
  it("STABLE reason names identity", () => {
    expect(classifyVerdict(completed(), true).reason).toMatch(/original target/);
  });

  it("WRONG_TARGET reason names the mismatch", () => {
    expect(classifyVerdict(completed(), false).reason).toMatch(/not the original target/);
  });

  it("MISSING reason names the count", () => {
    expect(classifyVerdict(completed({ rawMatchCount: 0, finalMatchCount: 0 }), null).reason).toMatch(
      /final match count is 0/,
    );
  });

  it("AMBIGUOUS reason names the count", () => {
    expect(classifyVerdict(completed({ rawMatchCount: 3, finalMatchCount: 3 }), null).reason).toMatch(
      /final match count is 3/,
    );
  });

  it("ERROR reason names the execution status", () => {
    expect(
      classifyVerdict(completed({ executionStatus: "ERROR", errorMessage: "boom" }), true).reason,
    ).toMatch(/executionStatus is ERROR/);
  });

  it("invalid-count reason echoes both counts", () => {
    const out = classifyVerdict(completed({ rawMatchCount: 1, finalMatchCount: 2 }), null);
    expect(out.reason).toMatch(/rawMatchCount=1/);
    expect(out.reason).toMatch(/finalMatchCount=2/);
  });
});
