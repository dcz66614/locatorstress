// T008 JSON export tests — round-trip, hash recomputation and
// tamper detection. All reports are built in memory (no browser).

import { describe, it, expect } from "vitest";

import { canonicalJson } from "../../src/canonical/canonical-json.js";
import { validateReportStructure } from "../../src/contracts/report.js";
import {
  exportReportJson,
  validateExportedJsonText,
  validateExportedReport,
} from "../../src/export/json-export.js";
import { buildAnalysisReport, summarizeWitness } from "../../src/analysis/witness.js";
import { fakeBfsResult, smallReportInput } from "../t008-helpers.js";

describe("exportReportJson", () => {
  it("exports canonical bytes (sorted keys) plus one trailing LF", () => {
    const report = buildAnalysisReport(smallReportInput());
    const text = exportReportJson(report);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    const withoutLf = text.slice(0, -1);
    expect(withoutLf).toBe(canonicalJson(JSON.parse(withoutLf)));
    expect(JSON.parse(withoutLf)).toEqual(JSON.parse(canonicalJson(report)));
  });

  it("round-trips: exported text validates with all four hashes recomputed", () => {
    const report = buildAnalysisReport(smallReportInput());
    const text = exportReportJson(report);
    const { report: parsed, validation } = validateExportedJsonText(text);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.recomputed).toEqual(report.hashes);
    expect((parsed as typeof report).hashes).toEqual(report.hashes);
  });

  it("detects a tampered verdict count (structure error)", () => {
    const report = buildAnalysisReport(smallReportInput());
    const tampered = JSON.parse(JSON.stringify(report)) as typeof report;
    tampered.verdictCounts.STABLE = 1;
    const validation = validateExportedReport(tampered);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("verdictCounts.STABLE"))).toBe(true);
  });

  it("detects a tampered hash (recomputation error, structure still fine)", () => {
    const report = buildAnalysisReport(smallReportInput());
    const tampered = JSON.parse(JSON.stringify(report)) as typeof report;
    tampered.hashes.analysis_sha256 = "0".repeat(64);
    const validation = validateExportedReport(tampered);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("analysis_sha256"))).toBe(true);
  });

  it("detects a tampered witness status (FOUND with a null witness)", () => {
    const report = buildAnalysisReport(smallReportInput());
    const tampered = JSON.parse(JSON.stringify(report)) as typeof report;
    tampered.witnesses["F001"].status = "FOUND";
    const validation = validateExportedReport(tampered);
    expect(validation.valid).toBe(false);
    expect(
      validation.errors.some((e) => e.includes("FOUND requires a non-null witness")),
    ).toBe(true);
  });

  it("detects a tampered canonical object (hash no longer recomputes)", () => {
    const report = buildAnalysisReport(smallReportInput());
    const tampered = JSON.parse(JSON.stringify(report)) as typeof report;
    const analysis = tampered.canonical.analysis as Record<string, unknown>;
    const bfs = analysis["bfs"] as Record<string, unknown>;
    bfs["found"] = 99;
    const validation = validateExportedReport(tampered);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("analysis_sha256"))).toBe(true);
  });

  it("refuses to export an invalid report", () => {
    const report = buildAnalysisReport(smallReportInput());
    const tampered = JSON.parse(JSON.stringify(report)) as typeof report;
    tampered.hashes.gate_sha256 = "0".repeat(64);
    expect(() => exportReportJson(tampered)).toThrow(/refusing to export/);
  });

  it("invalid JSON text and non-object reports fail validation, not throw", () => {
    const badJson = validateExportedJsonText("{not json");
    expect(badJson.validation.valid).toBe(false);
    expect(validateExportedReport(null).valid).toBe(false);
    expect(validateExportedReport("x").valid).toBe(false);
    expect(validateExportedReport({}).errors.length).toBeGreaterThan(0);
  });

  it("accepts a depth-0 FOUND witness: baseline fails with an empty sequence", () => {
    // P2-25 (T013 review): a failing baseline is reported as a
    // depth-0 witness with an empty sequence (see runBoundedBfs), and
    // the report validator must accept it — FOUND + depth 0 is the
    // only legal empty sequence. Rebuild honestly via the builder.
    const input = smallReportInput();
    input.witnesses["F002"] = summarizeWitness(
      fakeBfsResult({
        fixtureId: "F002",
        status: "FOUND",
        witness: { sequence: [], depth: 0, verdict: "WRONG_TARGET" },
        statesEvaluated: 1,
        statesExpanded: 0,
        maxDepthReached: 0,
        queueRemaining: 0,
        perDepthEvaluated: { 0: 1 },
      }),
    );
    const report = buildAnalysisReport(input);
    expect(report.witnessCoverage.found).toBe(1);
    expect(report.witnesses["F002"].witness).toEqual({
      sequence: [],
      depth: 0,
      verdict: "WRONG_TARGET",
    });
    expect(validateReportStructure(report)).toEqual([]);
    const text = exportReportJson(report);
    expect(text).toContain("WRONG_TARGET");
    const { validation } = validateExportedJsonText(text);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("still rejects an empty sequence when depth is not 0", () => {
    const report = buildAnalysisReport(smallReportInput());
    const tampered = JSON.parse(JSON.stringify(report)) as typeof report;
    const w = tampered.witnesses["F002"].witness!;
    w.sequence = [];
    // depth stays 1: empty sequence with depth != 0 is a structure error.
    expect(w.depth).toBe(1);
    const validation = validateExportedReport(tampered);
    expect(validation.valid).toBe(false);
    expect(
      validation.errors.some((e) => e.includes("witness.sequence must be a non-empty array")),
    ).toBe(true);
  });

  it("exported BOUNDED_INCOMPLETE keeps status beside the null witness", () => {
    // Rebuild the report honestly (via the builder, not post-hoc
    // editing) with F001's witness replaced by a BOUNDED_INCOMPLETE
    // summary at the frozen 6/4096 bounds.
    const input = smallReportInput();
    input.witnesses["F001"] = summarizeWitness(
      fakeBfsResult({
        fixtureId: "F001",
        status: "BOUNDED_INCOMPLETE",
        statesExpanded: 4096,
        queueRemaining: 42,
        notes: [
          "expansion budget exhausted (4096 states) with 42 sequence(s) still queued; search is bounded incomplete",
        ],
      }),
    );
    const report = buildAnalysisReport(input);
    expect(report.witnessCoverage.boundedIncomplete).toBe(1);
    expect(report.witnesses["F001"].witness).toBeNull();
    expect(report.witnesses["F001"].budgetNote).toContain("8801");
    const text = exportReportJson(report);
    expect(text).toContain("BOUNDED_INCOMPLETE");
    const { validation } = validateExportedJsonText(text);
    expect(validation.valid).toBe(true);
  });
});
