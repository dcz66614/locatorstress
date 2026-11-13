// T004 — Four-state verdict classification (PROJECT_BOOK §5.2 / §5.3).
//
// This is the single production classifier. It is a pure function over the
// frozen S0 resolver result plus the Oracle identity boolean; it performs no
// browser I/O, reads no fixture, and never consults the golden matrix.
//
// Resolution order (§5.2), applied exactly in this sequence:
//   1. executionStatus — anything other than COMPLETED yields no verdict.
//   2. count sanity — negative / non-integer counts, or final > raw, are
//      contradictory resolver output and yield no verdict.
//   3. frameFailure — a framePath layer that matched 0 frames is MISSING,
//      a layer that matched >1 frames is AMBIGUOUS.
//   4. finalMatchCount — 0 is MISSING, >1 is AMBIGUOUS.
//   5. identity — with exactly 1 final match, identityMatch true is
//      STABLE, false is WRONG_TARGET, null (identity unknown) is no verdict.
//
// A null verdict always pairs with analysisStatus "INCOMPLETE": the case
// must not be counted as STABLE (or as any other verdict) downstream.

import type {
  ExecutionStatus,
  ResolverResult,
} from "../runner/execution.js";

export type Verdict = "STABLE" | "WRONG_TARGET" | "AMBIGUOUS" | "MISSING";

export type AnalysisStatus = "COMPLETE" | "INCOMPLETE";

export interface VerdictClassification {
  /** The four-state verdict, or null when no verdict may be claimed. */
  verdict: Verdict | null;
  /** Echo of the resolver execution status (§5.3: independent of verdict). */
  executionStatus: ExecutionStatus;
  /** COMPLETE only when a verdict was produced; otherwise INCOMPLETE. */
  analysisStatus: AnalysisStatus;
  /** Deterministic, human-readable reason naming the deciding rule. */
  reason: string;
}

function incomplete(
  executionStatus: ExecutionStatus,
  reason: string,
): VerdictClassification {
  return {
    verdict: null,
    executionStatus,
    analysisStatus: "INCOMPLETE",
    reason,
  };
}

function complete(
  executionStatus: ExecutionStatus,
  verdict: Verdict,
  reason: string,
): VerdictClassification {
  return {
    verdict,
    executionStatus,
    analysisStatus: "COMPLETE",
    reason,
  };
}

function isValidCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Classify one resolved locator run.
 *
 * @param result — frozen S0 ResolverResult from resolveLocator (§5.2 steps
 *   1–6: spec validation, framePath layer counts, locator execution, raw
 *   match count, optional .nth(index), final match count).
 * @param identityMatch — Oracle identity boolean: true when the single final
 *   match is the same DOM object as the original target, false when it is a
 *   different object, null when identity was not / could not be determined
 *   (e.g. no single final match, or the identity probe itself errored).
 */
export function classifyVerdict(
  result: ResolverResult,
  identityMatch: boolean | null,
): VerdictClassification {
  const executionStatus = result.executionStatus;

  // Step 7 (§5.2): browser errors / timeouts / invalid fixtures use an
  // independent execution status and must never be disguised as a verdict.
  if (executionStatus !== "COMPLETED") {
    return incomplete(
      executionStatus,
      `executionStatus is ${executionStatus}; no verdict may be claimed`,
    );
  }

  // Defensive guard: the frozen resolver only ever emits non-negative
  // integer counts with finalMatchCount <= rawMatchCount (an index narrows
  // raw matches to 0 or 1 final match; without an index final == raw,
  // except a null handle which is reported as 0). Anything else is
  // contradictory input, not a fifth verdict.
  if (
    !isValidCount(result.rawMatchCount) ||
    !isValidCount(result.finalMatchCount) ||
    result.finalMatchCount > result.rawMatchCount
  ) {
    return incomplete(
      executionStatus,
      `invalid match counts: rawMatchCount=${String(result.rawMatchCount)}, finalMatchCount=${String(result.finalMatchCount)}`,
    );
  }

  // Frame scope (§5.2 step 2, §5.3): decided before the selector count,
  // because the selector never ran inside a resolved frame scope.
  if (result.frameFailure !== null) {
    if (result.frameFailure.kind === "FRAME_AMBIGUOUS") {
      return complete(
        executionStatus,
        "AMBIGUOUS",
        `framePath layer ${result.frameFailure.layer} selector ${result.frameFailure.selector} matched ${result.frameFailure.matchCount} frames`,
      );
    }
    return complete(
      executionStatus,
      "MISSING",
      `framePath layer ${result.frameFailure.layer} selector ${result.frameFailure.selector} matched 0 frames`,
    );
  }

  // Final match count (§5.3).
  if (result.finalMatchCount === 0) {
    return complete(
      executionStatus,
      "MISSING",
      `final match count is 0 (raw match count ${result.rawMatchCount})`,
    );
  }
  if (result.finalMatchCount > 1) {
    return complete(
      executionStatus,
      "AMBIGUOUS",
      `final match count is ${result.finalMatchCount}`,
    );
  }

  // Exactly one final match: only the Oracle identity decides
  // STABLE vs WRONG_TARGET (§5.3, §14: WRONG_TARGET must never be
  // misread as STABLE).
  if (identityMatch === true) {
    return complete(
      executionStatus,
      "STABLE",
      "final match count is 1 and the match is the original target",
    );
  }
  if (identityMatch === false) {
    return complete(
      executionStatus,
      "WRONG_TARGET",
      "final match count is 1 but the match is not the original target",
    );
  }
  return incomplete(
    executionStatus,
    "final match count is 1 but target identity is unknown; STABLE and WRONG_TARGET cannot be distinguished",
  );
}
