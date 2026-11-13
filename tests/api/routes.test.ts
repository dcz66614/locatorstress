// T008 API route tests — pure dispatch tests over a fake service
// (no sockets, no browser). Covers every §7.3 route, the P2-2
// rejection of test-only BFS options, and error shapes.

import { describe, it, expect } from "vitest";

import { handleApiRequest } from "../../src/api/routes.js";
import { ApiError } from "../../src/api/service.js";
import type { AnalysisService } from "../../src/api/service.js";
import { buildAnalysisReport } from "../../src/analysis/witness.js";
import { scanExternalResources } from "../../src/export/html-escape.js";
import { parseEmbeddedReportJson } from "../../src/export/html-export.js";
import { exportReportJson } from "../../src/export/json-export.js";
import { smallReportInput } from "../t008-helpers.js";

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
    listFixtures: () => [
      {
        fixtureId: "F001",
        family: "form-submit",
        kind: "css",
        controlGroup: "stable",
        locator: { kind: "css", selector: "button[type='submit']" },
      },
    ],
    listMutations: () => [
      { id: "M01", name: "WRAP_TARGET" },
      { id: "M02", name: "REORDER_SIBLINGS" },
    ],
    validate: (request) => {
      if (request.locator !== undefined && typeof request.locator === "object" && request.locator !== null) {
        const loc = request.locator as Record<string, unknown>;
        if (loc["kind"] === "css" && typeof loc["selector"] === "string") {
          return { valid: true, errors: [], locator: loc as never };
        }
        return { valid: false, errors: ["selector must be a non-empty string"] };
      }
      return { valid: false, errors: ["validate requires a locator or a scenario"] };
    },
    analyze: async (request) => {
      if (request.fixtureId !== "F001") {
        throw new ApiError(404, "NOT_FOUND", `unknown fixture ${request.fixtureId}`);
      }
      return {
        fixtureId: "F001",
        baseline: {
          fixtureId: "F001",
          mutationId: null,
          kind: "baseline",
          locatorKind: "css",
          controlGroup: "stable",
          verdict: "STABLE",
          analysisStatus: "COMPLETE",
          executionStatus: "COMPLETED",
          matchCount: 1,
          identityMatch: true,
          expectedVerdict: "STABLE",
          matchesGolden: true,
        },
        cases: [],
      };
    },
    search: async (request) => {
      if (request.fixtureId !== "F001") {
        throw new ApiError(404, "NOT_FOUND", `unknown fixture ${request.fixtureId}`);
      }
      if (request.maxDepth !== undefined && request.maxDepth > 6) {
        throw new ApiError(400, "BAD_REQUEST", "maxDepth must be an integer in 0..6");
      }
      return {
        fixtureId: "F001",
        status: "BOUNDED_NO_WITNESS",
        witness: null,
        meaning: "No failing sequence exists inside the searched space (depth <= 1, <= 4096 expansions). This does NOT prove the locator is safe for all DOM changes.",
        limits: { maxDepth: request.maxDepth ?? 6, maxExpandedStates: 4096 },
        statesEvaluated: 9,
        statesExpanded: 1,
        statesDeduplicated: 0,
        uniqueStates: 9,
        incompleteStates: 0,
        maxDepthReached: 1,
        queueRemaining: 0,
        perDepthEvaluated: { 0: 1, 1: 8 },
        notes: [],
      };
    },
  };
}

describe("GET routes", () => {
  it("GET /api/health returns ok + seed + BFS limits", async () => {
    const r = await handleApiRequest(fakeService(), "GET", "/api/health", null);
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
    expect(body["seed"]).toBe("P022-LOCATORSTRESS-S0-2026-11-10");
    expect(body["bfsLimits"]).toEqual({ maxDepth: 6, maxExpandedStates: 4096 });
  });

  it("GET /api/fixtures returns public fields only", async () => {
    const r = await handleApiRequest(fakeService(), "GET", "/api/fixtures", null);
    expect(r.status).toBe(200);
    const body = r.body as { fixtures: Array<Record<string, unknown>> };
    expect(body.fixtures).toHaveLength(1);
    expect(body.fixtures[0]).not.toHaveProperty("privateTargetPath");
    expect(body.fixtures[0]).not.toHaveProperty("m03Token");
    expect(body.fixtures[0]).not.toHaveProperty("shadowHost");
    expect(body.fixtures[0]).not.toHaveProperty("captureMode");
  });

  it("GET /api/mutations returns the fixed M01–M08 order", async () => {
    const r = await handleApiRequest(fakeService(), "GET", "/api/mutations", null);
    expect(r.status).toBe(200);
    const body = r.body as { mutations: Array<{ id: string }> };
    expect(body.mutations.map((m) => m.id)).toEqual(["M01", "M02"]);
  });

  it("unknown path is 404 and wrong method is 405", async () => {
    const missing = await handleApiRequest(fakeService(), "GET", "/api/nope", null);
    expect(missing.status).toBe(404);
    const wrongMethod = await handleApiRequest(fakeService(), "GET", "/api/analyze", null);
    expect(wrongMethod.status).toBe(405);
    const postHealth = await handleApiRequest(fakeService(), "POST", "/api/health", {});
    expect(postHealth.status).toBe(405);
  });
});

describe("POST /api/validate", () => {
  it("accepts a valid LocatorSpec and rejects a broken one", async () => {
    const ok = await handleApiRequest(fakeService(), "POST", "/api/validate", {
      locator: { kind: "css", selector: "button" },
    });
    expect(ok.status).toBe(200);
    expect((ok.body as Record<string, unknown>)["valid"]).toBe(true);

    const bad = await handleApiRequest(fakeService(), "POST", "/api/validate", {
      locator: { kind: "css" },
    });
    expect(bad.status).toBe(200);
    expect((bad.body as Record<string, unknown>)["valid"]).toBe(false);
  });

  it("non-object body is 400", async () => {
    const r = await handleApiRequest(fakeService(), "POST", "/api/validate", "nope");
    expect(r.status).toBe(400);
  });
});

describe("POST /api/analyze and /api/search", () => {
  it("analyze returns the fixture analysis; unknown fixture is 404", async () => {
    const ok = await handleApiRequest(fakeService(), "POST", "/api/analyze", {
      fixtureId: "F001",
    });
    expect(ok.status).toBe(200);
    expect((ok.body as Record<string, unknown>)["fixtureId"]).toBe("F001");

    const missing = await handleApiRequest(fakeService(), "POST", "/api/analyze", {
      fixtureId: "F099",
    });
    expect(missing.status).toBe(404);
    expect((missing.body as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("search returns the witness summary with status beside a null witness", async () => {
    const r = await handleApiRequest(fakeService(), "POST", "/api/search", {
      fixtureId: "F001",
      maxDepth: 1,
    });
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body["status"]).toBe("BOUNDED_NO_WITNESS");
    expect(body["witness"]).toBeNull();
    expect(typeof body["meaning"]).toBe("string");
  });

  it("search rejects operatorOrder and allowRepeat (P2-2 test-only options)", async () => {
    for (const badBody of [
      { fixtureId: "F001", operatorOrder: ["M01"] },
      { fixtureId: "F001", allowRepeat: true },
    ]) {
      const r = await handleApiRequest(fakeService(), "POST", "/api/search", badBody);
      expect(r.status).toBe(400);
      expect((r.body as { error: { message: string } }).error.message).toContain("test-only");
    }
  });

  it("search rejects out-of-range bounds", async () => {
    const r = await handleApiRequest(fakeService(), "POST", "/api/search", {
      fixtureId: "F001",
      maxDepth: 7,
    });
    expect(r.status).toBe(400);
  });
});

describe("POST /api/export", () => {
  it("exports a valid report as canonical JSON with recomputed hashes", async () => {
    const report = buildAnalysisReport(smallReportInput());
    const r = await handleApiRequest(fakeService(), "POST", "/api/export", {
      format: "json",
      report,
    });
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body["format"]).toBe("json");
    expect(typeof body["canonicalJson"]).toBe("string");
    const parsed = JSON.parse(body["canonicalJson"] as string) as Record<string, unknown>;
    expect(parsed["schema"]).toBe("locatorstress.analysis-report/v1");
    const hashes = body["hashes"] as Record<string, string>;
    expect(hashes["analysis_sha256"]).toBe(report.hashes.analysis_sha256);
  });

  it("rejects a tampered report with 422", async () => {
    const report = buildAnalysisReport(smallReportInput());
    const tampered = JSON.parse(JSON.stringify(report)) as typeof report;
    tampered.verdictCounts.STABLE = 1;
    const r = await handleApiRequest(fakeService(), "POST", "/api/export", {
      format: "json",
      report: tampered,
    });
    expect(r.status).toBe(422);
    expect((r.body as { error: { code: string } }).error.code).toBe("INVALID_REPORT");
  });

  it("rejects a tampered report with 422 for HTML too", async () => {
    const report = buildAnalysisReport(smallReportInput());
    const tampered = JSON.parse(JSON.stringify(report)) as typeof report;
    tampered.verdictCounts.STABLE = 1;
    const r = await handleApiRequest(fakeService(), "POST", "/api/export", {
      format: "html",
      report: tampered,
    });
    expect(r.status).toBe(422);
    expect((r.body as { error: { code: string } }).error.code).toBe("INVALID_REPORT");
  });

  it("FIX-R1-02: exports a valid report as standalone offline HTML", async () => {
    const report = buildAnalysisReport(smallReportInput());
    const r = await handleApiRequest(fakeService(), "POST", "/api/export", {
      format: "html",
      report,
    });
    expect(r.status).toBe(200);
    expect(r.contentType).toBe("text/html; charset=utf-8");
    const body = r.body as Record<string, unknown>;
    expect(body["format"]).toBe("html");
    const hashes = body["hashes"] as Record<string, string>;
    expect(hashes["gate_sha256"]).toBe(report.hashes.gate_sha256);
    // The raw HTML body carries the same report as the JSON export.
    const html = r.rawBody as string;
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(report.hashes.gate_sha256);
    expect(html).toContain("WRONG_TARGET");
    expect(parseEmbeddedReportJson(html)).toEqual(JSON.parse(exportReportJson(report)));
    expect(scanExternalResources(html)).toEqual([]);
  });

  it("unknown export format is 400", async () => {
    const report = buildAnalysisReport(smallReportInput());
    const r = await handleApiRequest(fakeService(), "POST", "/api/export", {
      format: "xml",
      report,
    });
    expect(r.status).toBe(400);
  });
});
