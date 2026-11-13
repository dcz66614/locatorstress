// T011 — API route boundaries (PROJECT_BOOK §7.3).
//
// The T008 route tests cover the happy paths, 404/405, P2-2 and the
// export shapes. These rows pin the remaining edges: every known path
// with the wrong method is 405, non-object bodies are 400 on every
// POST route, export without a report is 422, and search bounds are
// rejected by the service layer (400, not a crash).

import { describe, it, expect } from "vitest";

import { handleApiRequest } from "../../src/api/routes.js";
import { ApiError } from "../../src/api/service.js";
import type { AnalysisService } from "../../src/api/service.js";
import { smallReportInput } from "../t008-helpers.js";
import { buildAnalysisReport } from "../../src/analysis/witness.js";

function fakeService(): AnalysisService {
  const report = buildAnalysisReport(smallReportInput());
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
    listMutations: () => [{ id: "M01", name: "WRAP_TARGET" }],
    validate: () => ({ valid: true, errors: [], locator: { kind: "css", selector: "a" } as never }),
    analyze: async () => {
      throw new ApiError(404, "NOT_FOUND", "unknown fixture NOPE");
    },
    search: async (request) => {
      if (request.maxDepth !== undefined && (request.maxDepth < 0 || request.maxDepth > 6)) {
        throw new ApiError(400, "BAD_REQUEST", "maxDepth must be an integer in 0..6");
      }
      if (
        request.maxExpandedStates !== undefined &&
        (request.maxExpandedStates < 1 || request.maxExpandedStates > 4096)
      ) {
        throw new ApiError(400, "BAD_REQUEST", "maxExpandedStates must be an integer in 1..4096");
      }
      return {
        fixtureId: request.fixtureId,
        status: "BOUNDED_NO_WITNESS",
        witness: null,
        meaning: "No failing sequence exists inside the searched space. This does NOT prove the locator is safe for all DOM changes.",
        limits: { maxDepth: request.maxDepth ?? 6, maxExpandedStates: request.maxExpandedStates ?? 4096 },
        statesEvaluated: 1,
        statesExpanded: 0,
        statesDeduplicated: 0,
        uniqueStates: 1,
        incompleteStates: 0,
        maxDepthReached: 0,
        queueRemaining: 0,
        perDepthEvaluated: { 0: 1 },
        notes: [],
      };
    },
  } as unknown as AnalysisService;
}

describe("routes — method not allowed on every known path", () => {
  it.each([
    ["POST", "/api/health"],
    ["PUT", "/api/health"],
    ["DELETE", "/api/health"],
    ["POST", "/api/fixtures"],
    ["DELETE", "/api/fixtures"],
    ["POST", "/api/mutations"],
    ["GET", "/api/validate"],
    ["PUT", "/api/validate"],
    ["GET", "/api/analyze"],
    ["GET", "/api/search"],
    ["GET", "/api/export"],
  ])("%s %s is 405 with METHOD_NOT_ALLOWED", async (method, path) => {
    const res = await handleApiRequest(fakeService(), method, path, {});
    expect(res.status).toBe(405);
    expect((res.body as { error: { code: string } }).error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("unknown paths are 404 for any method", async () => {
    for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
      const res = await handleApiRequest(fakeService(), method, "/api/nope", {});
      expect(res.status, method).toBe(404);
      expect((res.body as { error: { code: string } }).error.code).toBe("NOT_FOUND");
    }
  });

  it("a trailing slash makes the path unknown (404), not a silent match", async () => {
    const res = await handleApiRequest(fakeService(), "GET", "/api/health/", null);
    expect(res.status).toBe(404);
  });
});

describe("routes — non-object bodies are 400 on every POST route", () => {
  it.each(["/api/validate", "/api/analyze", "/api/search", "/api/export"])(
    "POST %s with an array body is 400",
    async (path) => {
      const res = await handleApiRequest(fakeService(), "POST", path, []);
      expect(res.status).toBe(400);
      expect((res.body as { error: { code: string } }).error.code).toBe("BAD_REQUEST");
    },
  );

  it.each(["/api/validate", "/api/analyze", "/api/search", "/api/export"])(
    "POST %s with a null body is 400",
    async (path) => {
      const res = await handleApiRequest(fakeService(), "POST", path, null);
      expect(res.status).toBe(400);
    },
  );

  it.each(["/api/validate", "/api/analyze", "/api/search", "/api/export"])(
    "POST %s with a string body is 400",
    async (path) => {
      const res = await handleApiRequest(fakeService(), "POST", path, "x");
      expect(res.status).toBe(400);
    },
  );
});

describe("routes — search bounds and export validation edges", () => {
  it("search with maxDepth 7 is 400 (service rejects out-of-range bounds)", async () => {
    const res = await handleApiRequest(fakeService(), "POST", "/api/search", {
      fixtureId: "F001",
      maxDepth: 7,
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("BAD_REQUEST");
  });

  it("search with maxDepth -1 is 400", async () => {
    const res = await handleApiRequest(fakeService(), "POST", "/api/search", {
      fixtureId: "F001",
      maxDepth: -1,
    });
    expect(res.status).toBe(400);
  });

  it("search with maxExpandedStates 0 is 400", async () => {
    const res = await handleApiRequest(fakeService(), "POST", "/api/search", {
      fixtureId: "F001",
      maxExpandedStates: 0,
    });
    expect(res.status).toBe(400);
  });

  it("search with maxExpandedStates 4097 is 400", async () => {
    const res = await handleApiRequest(fakeService(), "POST", "/api/search", {
      fixtureId: "F001",
      maxExpandedStates: 4097,
    });
    expect(res.status).toBe(400);
  });

  it("search at the frozen bounds (6 / 4096) is accepted", async () => {
    const res = await handleApiRequest(fakeService(), "POST", "/api/search", {
      fixtureId: "F001",
      maxDepth: 6,
      maxExpandedStates: 4096,
    });
    expect(res.status).toBe(200);
  });

  it("export without a report is 422 INVALID_REPORT", async () => {
    const res = await handleApiRequest(fakeService(), "POST", "/api/export", { format: "json" });
    expect(res.status).toBe(422);
    expect((res.body as { error: { code: string } }).error.code).toBe("INVALID_REPORT");
  });

  it("export with a null report is 422, not a crash", async () => {
    const res = await handleApiRequest(fakeService(), "POST", "/api/export", {
      format: "json",
      report: null,
    });
    expect(res.status).toBe(422);
  });

  it("export with an unknown format value (e.g. a number) is 400", async () => {
    const res = await handleApiRequest(fakeService(), "POST", "/api/export", { format: 42 });
    expect(res.status).toBe(400);
  });

  it("analyze with an unknown fixture is 404 (service error passes through)", async () => {
    const res = await handleApiRequest(fakeService(), "POST", "/api/analyze", {
      fixtureId: "NOPE",
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("error bodies always have the { error: { code, message } } shape", async () => {
    const res = await handleApiRequest(fakeService(), "GET", "/api/unknown", null);
    const body = res.body as { error: { code: string; message: string } };
    expect(typeof body.error.code).toBe("string");
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
  });
});
