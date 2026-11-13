// FIX-R1-02 — unit tests for the UI page-level HTML export
// (src/export/ui-report-html.ts, served as POST /ui/export-html).
// No browser here; the real-browser download path is in
// tests/e2e/custom-input.test.ts (custom run) and tests/ui/ui-flow.test.ts
// (fixture run).
//
// Covers:
//   - HTML export of a fixture run and of a custom run (the same
//     payload the JSON download writes);
//   - JSON/HTML consistency (embedded JSON == the payload);
//   - offline (0 external-resource references);
//   - XSS vectors through the page renderer;
//   - malformed payloads rejected, never rendered as if good.

import { describe, it, expect } from "vitest";

import { canonicalJson } from "../../src/canonical/canonical-json.js";
import { escapeHtml, scanExternalResources } from "../../src/export/html-escape.js";
import { parseEmbeddedReportJson } from "../../src/export/html-export.js";
import {
  exportPageReportHtml,
  validatePageReportPayload,
} from "../../src/export/ui-report-html.js";
import { XSS_PAYLOADS } from "./t010-helpers.js";

const SEED = "P022-LOCATORSTRESS-S0-2026-11-10";

function scoreRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "overall",
    stable: 3,
    wrongTarget: 5,
    ambiguous: 0,
    missing: 0,
    incomplete: 0,
    completed: 8,
    expected: 8,
    scoreNumerator: 3,
    scoreDenominator: 8,
    score: "37.5",
    coverageNumerator: 8,
    coverageDenominator: 8,
    coverage: "100",
    analysisStatus: "COMPLETE",
    ...overrides,
  };
}

/** A fixture-run page payload, mirroring the UI JSON download (F002). */
function fixturePayload(): Record<string, unknown> {
  const cases = ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"].map((id) => ({
    fixtureId: "F002",
    mutationId: id,
    locatorKind: "xpath",
    controlGroup: "fragile",
    verdict: id === "M01" ? "WRONG_TARGET" : "STABLE",
    analysisStatus: "COMPLETE",
    executionStatus: "COMPLETED",
    matchCount: 1,
    identityMatch: id !== "M01",
    expectedVerdict: id === "M01" ? "WRONG_TARGET" : "STABLE",
    matchesGolden: true,
  }));
  return {
    schema: "locatorstress.ui-fixture-export/v1",
    fixtureId: "F002",
    seed: SEED,
    analysis: {
      fixtureId: "F002",
      source: "fixture",
      baseline: {
        fixtureId: "F002",
        mutationId: null,
        locatorKind: "xpath",
        controlGroup: "fragile",
        verdict: "STABLE",
        analysisStatus: "COMPLETE",
        executionStatus: "COMPLETED",
        matchCount: 1,
        identityMatch: true,
        expectedVerdict: "STABLE",
        matchesGolden: true,
      },
      cases,
    },
    witness: {
      fixtureId: "F002",
      status: "FOUND",
      witness: { sequence: ["M01"], depth: 1, verdict: "WRONG_TARGET" },
      meaning: "Found a shortest failing sequence.",
      limits: { maxDepth: 1, maxExpandedStates: 4096 },
      statesEvaluated: 2,
      statesExpanded: 1,
      statesDeduplicated: 0,
      uniqueStates: 2,
      incompleteStates: 0,
      maxDepthReached: 1,
      queueRemaining: 7,
      perDepthEvaluated: { 0: 1, 1: 1 },
      notes: [],
    },
    scores: {
      overall: scoreRow(),
      perLocator: {},
      perOperator: {
        M01: scoreRow({ key: "M01", stable: 0, wrongTarget: 1, completed: 1, expected: 1, scoreNumerator: 0, scoreDenominator: 1, score: "0", coverageNumerator: 1, coverageDenominator: 1, coverage: "100" }),
      },
    },
    controls: {
      stable: { group: "stable", fixtures: 1, pairs: 8, completed: 8, incomplete: 0, matched: 8, mismatched: 0, falseAlarms: 0, falseAlarmRate: "0", falseAlarmFraction: "0/8", detected: 8, detectionRate: "100" },
      fragile: { group: "fragile", fixtures: 1, pairs: 8, completed: 8, incomplete: 0, matched: 8, mismatched: 0, falseAlarms: 0, falseAlarmRate: "0", falseAlarmFraction: "0/8", detected: 8, detectionRate: "100" },
    },
    note: "Fixture-level export from the T009 UI: verdicts/witness from the frozen API, scores computed server-side by the frozen T005 scorer. Not a T008 full AnalysisReport.",
  };
}

/** A custom-run page payload, mirroring the UI JSON download (P022-CUSTOM-001). */
function customPayload(): Record<string, unknown> {
  const payload = fixturePayload();
  const analysis = payload["analysis"] as Record<string, unknown>;
  analysis["fixtureId"] = "P022-CUSTOM-001";
  analysis["source"] = "custom";
  analysis["scenarioId"] = "P022-CUSTOM-001";
  const cases = (analysis["cases"] as Array<Record<string, unknown>>).map((c) => ({
    ...c,
    fixtureId: "P022-CUSTOM-001",
    locatorKind: "css",
    controlGroup: "custom",
    verdict: c["mutationId"] === "M03" ? "MISSING" : c["mutationId"] === "M04" || c["mutationId"] === "M07" ? "AMBIGUOUS" : "STABLE",
    identityMatch: c["mutationId"] === "M03" ? false : c["mutationId"] === "M04" || c["mutationId"] === "M07" ? null : true,
    expectedVerdict: null,
    matchesGolden: null,
  }));
  analysis["cases"] = cases;
  const baseline = analysis["baseline"] as Record<string, unknown>;
  baseline["fixtureId"] = "P022-CUSTOM-001";
  baseline["locatorKind"] = "css";
  baseline["controlGroup"] = "custom";
  baseline["expectedVerdict"] = null;
  baseline["matchesGolden"] = null;
  payload["fixtureId"] = "P022-CUSTOM-001";
  payload["witness"] = {
    fixtureId: "P022-CUSTOM-001",
    status: "FOUND",
    witness: { sequence: ["M03"], depth: 1, verdict: "MISSING" },
    meaning: "Found a shortest failing sequence.",
    limits: { maxDepth: 1, maxExpandedStates: 4096 },
    statesEvaluated: 2,
    statesExpanded: 1,
    statesDeduplicated: 0,
    uniqueStates: 2,
    incompleteStates: 0,
    maxDepthReached: 1,
    queueRemaining: 7,
    perDepthEvaluated: { 0: 1, 1: 1 },
    notes: [],
  };
  payload["scores"] = {
    overall: scoreRow({ stable: 5, wrongTarget: 0, ambiguous: 2, missing: 1, scoreNumerator: 5, score: "62.5" }),
    perLocator: {},
    perOperator: {},
  };
  payload["controls"] = null;
  payload["note"] = "Custom-scenario export from the T009 UI: verdicts/witness from the frozen API for a user-supplied scenario, scores computed server-side by the frozen T005 scorer. No golden expected verdicts exist for custom input. Not a T008 full AnalysisReport.";
  return payload;
}

describe("exportPageReportHtml (FIX-R1-02)", () => {
  it("exports a fixture run as standalone HTML, consistent with its JSON payload", () => {
    const payload = fixturePayload();
    const html = exportPageReportHtml(payload);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("F002");
    expect(html).toContain("WRONG_TARGET");
    expect(html).toContain("37.5");
    expect(html).toContain("Not a T008 full AnalysisReport");
    // Embedded JSON is exactly the payload the JSON download writes.
    expect(parseEmbeddedReportJson(html)).toEqual(JSON.parse(canonicalJson(payload)));
    expect(html).toContain(escapeHtml(canonicalJson(payload)));
    expect(scanExternalResources(html)).toEqual([]);
    expect((html.match(/<script/g) ?? []).length).toBe(1);
  });

  it("exports a custom run as standalone HTML (source custom, no golden verdicts)", () => {
    const payload = customPayload();
    const html = exportPageReportHtml(payload);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("P022-CUSTOM-001");
    expect(html).toContain("MISSING");
    expect(html).toContain("AMBIGUOUS");
    expect(html).toContain("62.5");
    expect(html).toContain("No golden expected verdicts exist for custom input");
    expect(parseEmbeddedReportJson(html)).toEqual(JSON.parse(canonicalJson(payload)));
    expect(scanExternalResources(html)).toEqual([]);
  });

  it("renders witness-less and scoreless payloads without failing", () => {
    const payload = fixturePayload();
    payload["witness"] = null;
    payload["scores"] = null;
    payload["controls"] = null;
    const html = exportPageReportHtml(payload);
    expect(html).toContain("BFS witness not run");
    expect(parseEmbeddedReportJson(html)).toEqual(JSON.parse(canonicalJson(payload)));
    expect(scanExternalResources(html)).toEqual([]);
  });

  it("renders XSS payloads in note and witness meaning as inert text", () => {
    const payload = customPayload();
    payload["note"] = [...XSS_PAYLOADS, "javascript:alert(1)", "https://example.com/evil.png"].join(" | ");
    const witness = payload["witness"] as Record<string, unknown>;
    witness["meaning"] = "<script>alert(1)</script> in witness meaning";
    const html = exportPageReportHtml(payload);
    for (const raw of ["<script>alert(1)", "<img ", "<svg", "<iframe", "<math"]) {
      expect(html).not.toContain(raw);
    }
    for (const xss of XSS_PAYLOADS) {
      expect(html).toContain(escapeHtml(xss));
    }
    expect((html.match(/<\/script>/g) ?? []).length).toBe(1);
    expect(scanExternalResources(html)).toEqual([]);
    expect(parseEmbeddedReportJson(html)).toEqual(JSON.parse(canonicalJson(payload)));
  });

  it("rejects malformed payloads instead of rendering them", () => {
    expect(() => validatePageReportPayload(null)).toThrow(/JSON object/);
    expect(() => validatePageReportPayload({})).toThrow(/schema/);
    expect(() => validatePageReportPayload({ ...fixturePayload(), analysis: null })).toThrow(
      /analysis must be an object/,
    );
    expect(() =>
      validatePageReportPayload({
        ...fixturePayload(),
        analysis: { ...(fixturePayload()["analysis"] as object), cases: "nope" },
      }),
    ).toThrow(/cases must be an array/);
    expect(() =>
      validatePageReportPayload({
        ...fixturePayload(),
        analysis: { ...(fixturePayload()["analysis"] as object), source: "bogus" },
      }),
    ).toThrow(/source must be/);
    expect(() => exportPageReportHtml({})).toThrow();
  });
});
