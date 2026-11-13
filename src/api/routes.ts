// T008 — Local API routes (PROJECT_BOOK §7.3).
//
// Pure dispatch over an AnalysisService: no sockets, no browser, no
// I/O here, so every route is unit-testable without a port. The HTTP
// wrapper lives in server.ts and only adds body parsing + the
// loopback-only bind.
//
// Routes:
//   GET  /api/health     — service status, seed, BFS limits.
//   GET  /api/fixtures   — 24 synthetic fixtures (public fields only;
//                          private Oracle fields are never exposed).
//   GET  /api/mutations  — M01–M08 contract (id + name, fixed order).
//   POST /api/validate   — LocatorSpec / scenario validation.
//   POST /api/analyze    — baseline + single mutations for one fixture,
//                          or for a custom scenario (FIX-R1-01).
//   POST /api/search     — bounded BFS witness for one fixture,
//                          or for a custom scenario (FIX-R1-01).
//   POST /api/export     — JSON or HTML export of an AnalysisReport
//                          (validates schema + recomputes all four
//                          hashes; FIX-R1-02 wired the existing T010
//                          exportReportHtml() in here, so format=html
//                          now returns 200 text/html instead of 501).
//
// P2-2 (T007 review): /api/search accepts ONLY fixtureId,
// maxDepth and maxExpandedStates. A body containing operatorOrder or
// allowRepeat is rejected with 400 — those options are test-only hooks
// and must never reach runBoundedBfs from an API caller.
//
// Errors are always { error: { code, message } } with an HTTP status;
// ApiError carries the status. Unknown paths are 404; a known path with
// the wrong method is 405.

import { ApiError } from "./service.js";
import type { AnalysisService } from "./service.js";
import { exportReportHtml } from "../export/html-export.js";
import { exportReportJson, validateExportedReport } from "../export/json-export.js";

export interface RouteResult {
  status: number;
  body: unknown;
  /**
   * FIX-R1-02: when set, the HTTP layer sends this raw text with
   * `contentType` instead of serialising `body` as JSON. Used by the
   * HTML export (a text/html document is not a JSON value). `body`
   * still carries the JSON metadata (format + recomputed hashes) so
   * direct handleApiRequest callers can assert on it without parsing
   * the HTML.
   */
  contentType?: string;
  rawBody?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorBody(error: ApiError): RouteResult {
  return {
    status: error.status,
    body: { error: { code: error.code, message: error.message } },
  };
}

function badRequest(message: string): ApiError {
  return new ApiError(400, "BAD_REQUEST", message);
}

const KNOWN_PATHS = new Set([
  "/api/health",
  "/api/fixtures",
  "/api/mutations",
  "/api/validate",
  "/api/analyze",
  "/api/search",
  "/api/export",
]);

export async function handleApiRequest(
  service: AnalysisService,
  method: string,
  path: string,
  body: unknown,
): Promise<RouteResult> {
  try {
    if (!KNOWN_PATHS.has(path)) {
      return {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: `unknown path ${path}` } },
      };
    }
    if (method === "GET" && path === "/api/health") {
      return { status: 200, body: service.health() };
    }
    if (method === "GET" && path === "/api/fixtures") {
      return { status: 200, body: { fixtures: service.listFixtures() } };
    }
    if (method === "GET" && path === "/api/mutations") {
      return { status: 200, body: { mutations: service.listMutations() } };
    }
    if (method === "POST" && path === "/api/validate") {
      if (!isPlainObject(body)) {
        throw badRequest("validate body must be a JSON object");
      }
      const result = service.validate({
        locator: body["locator"],
        scenario: body["scenario"],
      });
      return { status: 200, body: result };
    }
    if (method === "POST" && path === "/api/analyze") {
      if (!isPlainObject(body)) {
        throw badRequest("analyze body must be a JSON object");
      }
      // FIX-R1-01: a custom scenario may replace fixtureId. The
      // service rejects both-together and neither (400); a scenario
      // without a target, or with unsafe HTML, is a 400 there too.
      const analysis = await service.analyze({
        fixtureId: body["fixtureId"] as string | undefined,
        scenario: body["scenario"],
        mutationIds: body["mutationIds"] as never,
      });
      return { status: 200, body: analysis };
    }
    if (method === "POST" && path === "/api/search") {
      if (!isPlainObject(body)) {
        throw badRequest("search body must be a JSON object");
      }
      // P2-2: test-only BFS options are rejected, never forwarded.
      if ("operatorOrder" in body || "allowRepeat" in body) {
        throw badRequest(
          "operatorOrder and allowRepeat are test-only BFS options and are not accepted by the API; only fixtureId, scenario, maxDepth and maxExpandedStates may be supplied",
        );
      }
      const summary = await service.search({
        fixtureId: body["fixtureId"] as string | undefined,
        scenario: body["scenario"],
        maxDepth: body["maxDepth"] as number | undefined,
        maxExpandedStates: body["maxExpandedStates"] as number | undefined,
      });
      return { status: 200, body: summary };
    }
    if (method === "POST" && path === "/api/export") {
      if (!isPlainObject(body)) {
        throw badRequest("export body must be a JSON object");
      }
      const format = body["format"] ?? "json";
      if (format !== "json" && format !== "html") {
        throw badRequest(`unsupported export format ${JSON.stringify(format)} (expected "json" or "html")`);
      }
      const validation = validateExportedReport(body["report"]);
      if (!validation.valid) {
        return {
          status: 422,
          body: {
            error: {
              code: "INVALID_REPORT",
              message: `report failed validation: ${validation.errors.join("; ")}`,
            },
            errors: validation.errors,
          },
        };
      }
      if (format === "html") {
        // FIX-R1-02: the T010 generator already validates the report
        // itself (and re-checks its own output for external resources),
        // so this is the same validation as the JSON path, rendered.
        // The embedded JSON in the HTML is exactly the JSON export's
        // report, so the two formats are consistent by construction.
        const html = exportReportHtml(body["report"]);
        return {
          status: 200,
          body: {
            format: "html",
            hashes: validation.recomputed,
          },
          contentType: "text/html; charset=utf-8",
          rawBody: html,
        };
      }
      const canonicalJson = exportReportJson(body["report"]);
      return {
        status: 200,
        body: {
          format: "json",
          canonicalJson,
          hashes: validation.recomputed,
        },
      };
    }
    return {
      status: 405,
      body: {
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: `${method} is not allowed on ${path}`,
        },
      },
    };
  } catch (err) {
    if (err instanceof ApiError) {
      return errorBody(err);
    }
    return {
      status: 500,
      body: {
        error: {
          code: "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
      },
    };
  }
}
