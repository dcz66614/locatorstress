// T010 HTML export tests — content parity with the JSON export,
// self-containment, and escaping. No browser here; the real-browser
// offline open is in html-safety.test.ts.

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalJson } from "../../src/canonical/canonical-json.js";
import { buildAnalysisReport } from "../../src/analysis/witness.js";
import { escapeHtml, scanExternalResources } from "../../src/export/html-escape.js";
import {
  exportReportHtml,
  parseEmbeddedReportJson,
  writeReportHtml,
} from "../../src/export/html-export.js";
import { exportReportJson } from "../../src/export/json-export.js";
import { smallReportInput } from "../t008-helpers.js";
import { XSS_PAYLOADS, payloadReportInput } from "./t010-helpers.js";

describe("exportReportHtml", () => {
  it("renders the report: counts, score, hashes, witnesses and all 16 cases", () => {
    const report = buildAnalysisReport(smallReportInput());
    const html = exportReportHtml(report);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("LocatorStress analysis report");
    expect(html).toContain("P022-LOCATORSTRESS-S0-2026-11-10");
    expect(html).toContain("WRONG_TARGET");
    // Overall score for the small input: 15 STABLE of 16 completed.
    expect(html).toContain("15/16");
    for (const field of [
      "scenario_sha256",
      "oracle_result_sha256",
      "analysis_sha256",
      "gate_sha256",
    ] as const) {
      expect(html).toContain(report.hashes[field]);
    }
    expect(html).toContain("FOUND");
    expect(html).toContain("BOUNDED_NO_WITNESS");
    // 16 case rows (8 per fixture; the witness table adds one more
    // F001/F002 cell each, so count case rows by fixture+mutation).
    expect((html.match(/<td>F001<\/td><td>M0\d<\/td>/g) ?? []).length).toBe(8);
    expect((html.match(/<td>F002<\/td><td>M0\d<\/td>/g) ?? []).length).toBe(8);
  });

  it("embedded JSON parses back to exactly the JSON export's report", () => {
    const report = buildAnalysisReport(smallReportInput());
    const html = exportReportHtml(report);
    const embedded = parseEmbeddedReportJson(html);
    expect(embedded).toEqual(JSON.parse(exportReportJson(report)));
    expect(JSON.stringify(embedded)).toBe(JSON.stringify(JSON.parse(canonicalJson(report))));
    // The visible <pre> copy is the same canonical JSON, HTML-escaped.
    expect(html).toContain(escapeHtml(canonicalJson(report)));
  });

  it("is self-contained: zero external-resource hits, one non-executable script", () => {
    const report = buildAnalysisReport(smallReportInput());
    const html = exportReportHtml(report);
    expect(scanExternalResources(html)).toEqual([]);
    expect((html.match(/<script/g) ?? []).length).toBe(1);
    expect(html).toContain('<script type="application/json" id="report-json">');
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("script-src 'none'");
  });

  it("renders XSS payloads as inert text, never as markup", () => {
    const report = buildAnalysisReport(payloadReportInput());
    const html = exportReportHtml(report);
    // No payload may appear raw as markup.
    for (const raw of ["<script>alert(1)", "<img ", "<svg", "<iframe", "<math"]) {
      expect(html).not.toContain(raw);
    }
    // Each payload appears in its escaped form (visible as text).
    for (const payload of XSS_PAYLOADS) {
      expect(html).toContain(escapeHtml(payload));
    }
    // The embedded JSON block cannot be broken out of: no literal
    // </script> inside it (the only </script> closes the block itself).
    expect((html.match(/<\/script>/g) ?? []).length).toBe(1);
    expect(scanExternalResources(html)).toEqual([]);
    // And the payload report still round-trips as the same report.
    expect(parseEmbeddedReportJson(html)).toEqual(JSON.parse(exportReportJson(report)));
  });

  it("refuses to export an invalid report as HTML", () => {
    const report = buildAnalysisReport(smallReportInput());
    const tampered = JSON.parse(JSON.stringify(report)) as typeof report;
    tampered.hashes.gate_sha256 = "0".repeat(64);
    expect(() => exportReportHtml(tampered)).toThrow(/refusing to export/);
  });

  it("writeReportHtml writes a file that reads back and parses", () => {
    const dir = mkdtempSync(join(tmpdir(), "locatorstress-t010-"));
    try {
      const report = buildAnalysisReport(smallReportInput());
      const filePath = join(dir, "report.html");
      const text = writeReportHtml(filePath, report);
      expect(text.endsWith("\n")).toBe(true);
      expect(readFileSync(filePath, "utf-8")).toBe(text);
      expect(parseEmbeddedReportJson(text)).toEqual(JSON.parse(exportReportJson(report)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scanExternalResources", () => {
  it("flags resource tags, remote src/href, handlers and dangerous schemes", () => {
    const cases: Array<[string, number]> = [
      ['<img src="https://example.com/x.png">', 1],
      ['<script src="https://example.com/x.js"></script>', 1],
      ['<link rel="stylesheet" href="https://example.com/x.css">', 1],
      ['<iframe src="https://example.com/"></iframe>', 1],
      ['<div onclick="alert(1)">x</div>', 1],
      ['<a href="javascript:alert(1)">x</a>', 1],
      ['<a href="https://example.com/">x</a>', 1],
      ['<style>@import url("https://example.com/x.css");</style>', 1],
      ['<style>a{background:url(https://example.com/x.png)}</style>', 1],
      ['<video src="clip.mp4"></video>', 1],
    ];
    for (const [html, minHits] of cases) {
      expect(scanExternalResources(html).length).toBeGreaterThanOrEqual(minHits);
    }
  });

  it("does not flag escaped payload text or plain-text URLs", () => {
    expect(scanExternalResources("<p>&lt;img src=x onerror=alert(1)&gt;</p>")).toEqual([]);
    expect(scanExternalResources("<p>see https://example.com/evil.png for details</p>")).toEqual([]);
    expect(scanExternalResources("<p>javascript:alert(1) as plain text</p>")).toEqual([]);
    expect(scanExternalResources('<script type="application/json" id="report-json">{}</script>')).toEqual([]);
  });
});
