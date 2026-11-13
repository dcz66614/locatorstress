// FIX-R1-02 — HTML export through the real API route (POST /api/export
// format=html). No sockets and no browser here: handleApiRequest is the
// same dispatch the HTTP server uses, so a 200 here is the API serving
// HTML; the live-server and real-browser paths are in
// tests/e2e/offline.test.ts and tests/e2e/custom-input.test.ts.
//
// Covers (all through /api/export, format=html):
//   - a fixture-run full report (small synthetic report + the real
//     T008 report file: 192 real fixture-run cases);
//   - JSON/HTML field consistency (same verdicts, scores, witness,
//     hashes — the embedded JSON is exactly the JSON export);
//   - offline (0 external-resource references);
//   - all 7 XSS test vectors through the API path;
//   - invalid reports rejected with 422, same as the JSON path.
//
// A single custom run cannot be a full AnalysisReport — ReportCase
// requires controlGroup stable|fragile and a non-null expectedVerdict
// — so custom runs export as HTML through the UI page-level endpoint
// (POST /ui/export-html); that path is covered in ui-report-html.test.ts
// and in the custom-input E2E.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { handleApiRequest } from "../../src/api/routes.js";
import { buildAnalysisReport } from "../../src/analysis/witness.js";
import { canonicalJson } from "../../src/canonical/canonical-json.js";
import { escapeHtml, scanExternalResources } from "../../src/export/html-escape.js";
import { parseEmbeddedReportJson } from "../../src/export/html-export.js";
import { exportReportJson } from "../../src/export/json-export.js";
import { repoRoot } from "../integration/s0-helpers.js";
import { smallReportInput } from "../t008-helpers.js";
import { XSS_PAYLOADS, payloadReportInput } from "./t010-helpers.js";
import type { AnalysisService } from "../../src/api/service.js";

function fakeService(): AnalysisService {
  return {
    health: () => ({
      status: "ok",
      service: "locatorstress",
      version: "0.1.0",
      seed: "P022-LOCATORSTRESS-S0-2026-11-10",
      bfsLimits: { maxDepth: 6, maxExpandedStates: 4096 },
      mutationOrder: ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"],
    }),
    listFixtures: () => [],
    listMutations: () => [],
    validate: () => ({ valid: true, errors: [] }),
    analyze: async () => {
      throw new Error("not used in export tests");
    },
    search: async () => {
      throw new Error("not used in export tests");
    },
  };
}

async function exportHtml(report: unknown): Promise<{
  status: number;
  contentType: string | undefined;
  rawBody: string;
  body: Record<string, unknown>;
}> {
  const r = await handleApiRequest(fakeService(), "POST", "/api/export", {
    format: "html",
    report,
  });
  return {
    status: r.status,
    contentType: r.contentType,
    rawBody: r.rawBody as string,
    body: r.body as Record<string, unknown>,
  };
}

describe("POST /api/export format=html (FIX-R1-02)", () => {
  it("exports a fixture-run report as standalone HTML, consistent with the JSON export", async () => {
    const report = buildAnalysisReport(smallReportInput());
    const { status, contentType, rawBody: html, body } = await exportHtml(report);
    expect(status).toBe(200);
    expect(contentType).toBe("text/html; charset=utf-8");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(body["format"]).toBe("html");
    // Same verdicts, scores, witness, hashes as the JSON export.
    expect(parseEmbeddedReportJson(html)).toEqual(JSON.parse(exportReportJson(report)));
    expect(html).toContain("15/16");
    expect(html).toContain("WRONG_TARGET");
    expect(html).toContain("FOUND");
    for (const field of [
      "scenario_sha256",
      "oracle_result_sha256",
      "analysis_sha256",
      "gate_sha256",
    ] as const) {
      expect(html).toContain(report.hashes[field]);
    }
    const hashes = body["hashes"] as Record<string, string>;
    expect(hashes["gate_sha256"]).toBe(report.hashes.gate_sha256);
    // Offline: zero external-resource references.
    expect(scanExternalResources(html)).toEqual([]);
    expect(html).not.toContain("<link");
    expect(html).not.toContain("https://");
  });

  it("exports the real T008 full report (192 real fixture-run cases) as HTML", async () => {
    const report = JSON.parse(
      readFileSync(join(repoRoot(), "evidence", "s2", "T008_API_REPORT.json"), "utf-8"),
    ) as ReturnType<typeof buildAnalysisReport>;
    const { status, rawBody: html } = await exportHtml(report);
    expect(status).toBe(200);
    // The embedded JSON is exactly the report file's report.
    expect(parseEmbeddedReportJson(html)).toEqual(JSON.parse(canonicalJson(report)));
    // Field consistency with the JSON export of the same report.
    expect(html).toContain("138");
    expect(html).toContain("71.875");
    expect(html).toContain(report.hashes.gate_sha256);
    expect(html).toContain(report.hashes.analysis_sha256);
    expect(html).toContain("WRONG_TARGET");
    expect(html).toContain("FOUND");
    expect(scanExternalResources(html)).toEqual([]);
    expect((html.match(/<\/script>/g) ?? []).length).toBe(1);
  });

  it("renders all 7 XSS vectors as inert text through the API path", async () => {
    const report = buildAnalysisReport(payloadReportInput());
    const { status, rawBody: html } = await exportHtml(report);
    expect(status).toBe(200);
    for (const raw of ["<script>alert(1)", "<img ", "<svg", "<iframe", "<math"]) {
      expect(html).not.toContain(raw);
    }
    for (const payload of XSS_PAYLOADS) {
      expect(html).toContain(escapeHtml(payload));
    }
    expect((html.match(/<\/script>/g) ?? []).length).toBe(1);
    expect(scanExternalResources(html)).toEqual([]);
    // The payload report still round-trips as the same report.
    expect(parseEmbeddedReportJson(html)).toEqual(JSON.parse(exportReportJson(report)));
  });

  it("rejects a missing report with 422, same as the JSON path", async () => {
    const r = await handleApiRequest(fakeService(), "POST", "/api/export", {
      format: "html",
    });
    expect(r.status).toBe(422);
    expect((r.body as { error: { code: string } }).error.code).toBe("INVALID_REPORT");
  });

  it("still rejects an unknown format with 400", async () => {
    const report = buildAnalysisReport(smallReportInput());
    const r = await handleApiRequest(fakeService(), "POST", "/api/export", {
      format: "xml",
      report,
    });
    expect(r.status).toBe(400);
  });
});
