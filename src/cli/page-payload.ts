// FIX-R1-03 — Page-level export payload for a stored CLI run
// (P022-R1-P1-03).
//
// Builds exactly the payload the Web UI downloads
// (`locatorstress.ui-fixture-export/v1`, see src/ui/app.js
// buildPageExportPayload): one fixture/custom analysis + optional
// witness + server-side scores + controls. Scores come from the
// frozen T005 scorer (computeStabilityScores /
// computeControlMetrics), with the same controlGroup mapping the UI
// server uses (src/ui/server.ts toScoreCases): custom cases carry
// controlGroup "custom", which the scorer rejects, so it is omitted
// and control metrics are null for custom runs (they have no golden
// expected verdicts).
//
// Scope (honest, same as the UI download): this is a PAGE-LEVEL
// export of one analysis, NOT a T008 full AnalysisReport. A custom
// run cannot be a full AnalysisReport at all — ReportCase requires
// controlGroup stable|fragile and a non-null expectedVerdict — so
// the page-level export is the only HTML path for custom runs (the
// same conclusion FIX-R1-02 reached). Full reports (demo, t008)
// export through exportReportJson/exportReportHtml instead.

import { SEED } from "../canonical/hashes.js";
import type { CliRunEnvelope } from "./run-store.js";
import { runtimeError } from "./errors.js";
import {
  computeControlMetrics,
  computeStabilityScores,
} from "../score/stability-score.js";
import type { ScoreCase } from "../score/stability-score.js";

export interface PageReportPayload {
  schema: "locatorstress.ui-fixture-export/v1";
  fixtureId: string;
  seed: string;
  analysis: Record<string, unknown>;
  witness: Record<string, unknown> | null;
  scores: Record<string, unknown> | null;
  controls: Record<string, unknown> | null;
  note: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Map a stored analysis case list to ScoreCase input for the frozen
 * T005 scorer. Mirrors src/ui/server.ts toScoreCases exactly.
 */
function toScoreCases(analysis: Record<string, unknown>): ScoreCase[] {
  const cases = analysis["cases"];
  if (!Array.isArray(cases)) {
    throw runtimeError(
      "INVALID_RUN",
      `stored run ${String(analysis["fixtureId"])}: analysis.cases must be an array`,
    );
  }
  return cases.map((entry, i) => {
    if (!isPlainObject(entry)) {
      throw runtimeError(
        "INVALID_RUN",
        `stored run: analysis.cases[${i}] is not a plain object`,
      );
    }
    const expected =
      entry["expectedVerdict"] === null ||
      entry["expectedVerdict"] === undefined
        ? undefined
        : entry["expectedVerdict"];
    const controlGroup = entry["controlGroup"];
    return {
      fixtureId: entry["fixtureId"],
      mutationId: entry["mutationId"],
      locatorKind: entry["locatorKind"],
      ...(controlGroup === "stable" || controlGroup === "fragile"
        ? { controlGroup }
        : {}),
      verdict: entry["verdict"],
      analysisStatus: entry["analysisStatus"],
      expectedVerdict: expected,
    } as ScoreCase;
  });
}

function buildScores(
  analysis: Record<string, unknown>,
): { scores: Record<string, unknown>; controls: Record<string, unknown> | null } {
  const cases = toScoreCases(analysis);
  const scores = computeStabilityScores(cases) as unknown as Record<
    string,
    unknown
  >;
  const allHaveExpected = cases.every(
    (c) => c.expectedVerdict !== undefined,
  );
  const controls = allHaveExpected
    ? (computeControlMetrics(cases) as unknown as Record<string, unknown>)
    : null;
  return { scores, controls };
}

/** Build the page-level export payload for a stored run. Throws when the run has no analysis. */
export function buildPagePayload(run: CliRunEnvelope): PageReportPayload {
  const analysis = run.analysis;
  if (analysis === undefined) {
    throw runtimeError(
      "EXPORT_HTML_REQUIRES_ANALYSIS",
      `run ${run.runId} has no stored analysis (only a BFS witness); run "analyze" first, or export it as JSON`,
    );
  }
  const { scores, controls } = buildScores(analysis);
  const source = analysis["source"];
  return {
    schema: "locatorstress.ui-fixture-export/v1",
    fixtureId: String(analysis["fixtureId"]),
    seed: SEED,
    analysis,
    witness: run.witness ?? null,
    scores,
    controls,
    note:
      source === "custom"
        ? "Custom-scenario export from the LocatorStress CLI: verdicts/witness from the frozen API for a user-supplied scenario, scores computed server-side by the frozen T005 scorer. No golden expected verdicts exist for custom input. Not a T008 full AnalysisReport."
        : "Fixture-level export from the LocatorStress CLI: verdicts/witness from the frozen API, scores computed server-side by the frozen T005 scorer. Not a T008 full AnalysisReport.",
  };
}
