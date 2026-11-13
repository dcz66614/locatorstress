# REVIEW_PACK_06 — API 服务、路由、服务器与导出（JSON/HTML/转义/模板）

审查 commit：`a78d765`。本包为审查时原文逐字拼接（机械拼接，内容未经改写），每个文件附行数、字节数与 SHA-256；审查结论见 `INDEPENDENT_REVIEW.md`。

## src/api/service.ts

- 行数：496；字节数：16869；SHA-256：`700246b0394c0386e5f04e33f43a01a87f37558d90ed887ecd74431b7f8e78d9`

```ts
// T008 — Browser-backed AnalysisService (PROJECT_BOOK §7.3).
//
// The service is the only production code that runs a browser. It calls
// the frozen machinery (fixture loader, mutation registry, locator
// resolver, Oracle identity compare, T004 classifier, T007 BFS +
// browser evaluator) and never re-implements any of it. The classifier
// never consults the golden matrix: golden expected verdicts are loaded
// only to DISPLAY parity (expectedVerdict / matchesGolden on each case),
// exactly as the S0 gate does.
//
// P2-2 (T007 review): search() calls runBoundedBfs with ONLY fixtureId
// (+ smaller maxDepth / maxExpandedStates when the caller asks for
// them). operatorOrder and allowRepeat are never passed — they are
// test-only hooks, and passing them would silently change tie-break
// semantics. The route layer rejects those keys in request bodies
// before they reach this service.
//
// Concurrency: the service owns ONE Playwright page (the caller owns
// the browser lifecycle). Every public method runs through a single
// promise-chain mutex, so concurrent HTTP requests are executed
// sequentially against the shared page instead of racing setContent
// calls. This keeps results deterministic; the server is a local lab
// tool, not a concurrent production service.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";

import { SEED } from "../canonical/hashes.js";
import { normalizeLocatorSpec, validateLocatorSpec } from "../contracts/locator.js";
import type { LocatorSpecV1 } from "../contracts/locator.js";
import type { WitnessSummary } from "../contracts/report.js";
import {
  loadAllFixtureManifests,
  loadFixtureManifest,
} from "../fixtures/fixture-manifest.js";
import type { FixtureManifest } from "../fixtures/fixture-manifest.js";
import {
  captureOriginalTargetForFixture,
  loadFixture,
  mutationContextForFixture,
  setFixtureContent,
} from "../fixtures/fixture-loader.js";
import { MUTATION_ORDER, MUTATIONS, getMutation } from "../mutations/registry.js";
import type { MutationId } from "../mutations/types.js";
import { isSameElement } from "../oracle/identity-compare.js";
import { resolveLocator } from "../runner/locator-resolver.js";
import { summarizeWitness } from "../analysis/witness.js";
import { createBrowserEvaluator } from "../search/browser-evaluator.js";
import { runBoundedBfs } from "../search/bfs.js";
import { classifyVerdict } from "../verdict/classify.js";
import type { Verdict } from "../verdict/classify.js";

export const API_VERSION = "0.1.0";
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

const FIXTURE_ID_PATTERN = /^F0(0[1-9]|1[0-9]|2[0-4])$/;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function notFound(message: string): ApiError {
  return new ApiError(404, "NOT_FOUND", message);
}

export function badRequest(message: string): ApiError {
  return new ApiError(400, "BAD_REQUEST", message);
}

export interface FixtureSummary {
  fixtureId: string;
  family: string;
  kind: string;
  controlGroup: string;
  locator: LocatorSpecV1;
}

export interface MutationSummary {
  id: MutationId;
  name: string;
}

export interface AnalyzedCase {
  fixtureId: string;
  mutationId: MutationId | null;
  kind: "baseline" | "mutation";
  locatorKind: "css" | "xpath" | "role";
  controlGroup: "stable" | "fragile";
  verdict: Verdict | null;
  analysisStatus: "COMPLETE" | "INCOMPLETE";
  executionStatus: string;
  matchCount: number;
  identityMatch: boolean | null;
  /** Golden expected verdict (display/parity only; never used to classify). */
  expectedVerdict: Verdict | null;
  /** True when the claimed verdict equals the golden expected verdict. */
  matchesGolden: boolean | null;
}

export interface FixtureAnalysis {
  fixtureId: string;
  baseline: AnalyzedCase;
  cases: AnalyzedCase[];
}

export interface AnalyzeRequest {
  fixtureId: string;
  mutationIds?: MutationId[];
}

export interface SearchRequest {
  fixtureId: string;
  maxDepth?: number;
  maxExpandedStates?: number;
}

export interface ValidateRequest {
  locator?: unknown;
  scenario?: unknown;
}

export interface HealthInfo {
  status: "ok";
  service: "locatorstress";
  version: string;
  seed: string;
  bfsLimits: { maxDepth: number; maxExpandedStates: number };
  mutationOrder: MutationId[];
}

export interface AnalysisService {
  health(): HealthInfo;
  listFixtures(): FixtureSummary[];
  listMutations(): MutationSummary[];
  validate(request: ValidateRequest): {
    valid: boolean;
    errors: string[];
    locator?: LocatorSpecV1;
  };
  analyze(request: AnalyzeRequest): Promise<FixtureAnalysis>;
  search(request: SearchRequest): Promise<WitnessSummary>;
}

// ---- Golden matrix (display/parity only) ----

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

function goldenPath(): string {
  const candidates = [
    resolve(MODULE_DIR, "..", "fixtures", "golden", "expected-verdicts.json"),
    resolve(MODULE_DIR, "..", "..", "src", "fixtures", "golden", "expected-verdicts.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0]!;
}

export function loadGoldenExpected(): Map<string, Verdict> {
  const raw = readFileSync(goldenPath(), "utf-8");
  const parsed = JSON.parse(raw) as {
    schema: string;
    seed: string;
    cases: Array<{ fixtureId: string; mutationId: string; expectedVerdict: Verdict }>;
  };
  if (parsed.seed !== SEED) {
    throw new Error(`golden matrix seed mismatch: ${String(parsed.seed)}`);
  }
  const map = new Map<string, Verdict>();
  for (const c of parsed.cases) {
    map.set(`${c.fixtureId}/${c.mutationId}`, c.expectedVerdict);
  }
  return map;
}

function publicFixtureSummary(m: FixtureManifest): FixtureSummary {
  // Private Oracle fields (privateTargetPath, m03Token, shadowHost,
  // captureMode) are NEVER exposed through the API.
  return {
    fixtureId: m.fixtureId,
    family: m.family,
    kind: m.kind,
    controlGroup: m.controlGroup,
    locator: normalizeLocatorSpec(m.locator),
  };
}

function validateFixtureId(fixtureId: unknown): string {
  if (typeof fixtureId !== "string" || !FIXTURE_ID_PATTERN.test(fixtureId)) {
    throw badRequest(
      `fixtureId must match /^F0(0[1-9]|1[0-9]|2[0-4])$/, got ${JSON.stringify(fixtureId)}`,
    );
  }
  return fixtureId;
}

function validateMutationIds(value: unknown): MutationId[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw badRequest("mutationIds must be an array of M01–M08");
  }
  const out: MutationId[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !(MUTATION_ORDER as readonly string[]).includes(id)) {
      throw badRequest(`unknown mutationId ${JSON.stringify(id)} (expected M01–M08)`);
    }
    if (!out.includes(id as MutationId)) out.push(id as MutationId);
  }
  return out;
}

/** Evaluate one sequence (baseline = []) on a fresh page reset. */
async function evaluateSequence(
  page: Page,
  manifest: FixtureManifest,
  sequence: readonly MutationId[],
): Promise<{
  verdict: Verdict | null;
  analysisStatus: "COMPLETE" | "INCOMPLETE";
  executionStatus: string;
  matchCount: number;
  identityMatch: boolean | null;
}> {
  const fixture = loadFixture(manifest.fixtureId);
  const ctx = mutationContextForFixture(manifest);
  await setFixtureContent(page, fixture);
  const original = await captureOriginalTargetForFixture(page, manifest);
  for (const mutationId of sequence) {
    await getMutation(mutationId).apply(page, original, ctx);
  }
  const { result, finalHandle } = await resolveLocator(page, manifest.locator);
  let identityMatch: boolean | null = null;
  if (
    result.executionStatus === "COMPLETED" &&
    result.finalMatchCount === 1 &&
    finalHandle !== null
  ) {
    identityMatch = await isSameElement(page, finalHandle, original);
  }
  const classification = classifyVerdict(result, identityMatch);
  return {
    verdict: classification.verdict,
    analysisStatus: classification.analysisStatus,
    executionStatus: result.executionStatus,
    matchCount: result.finalMatchCount,
    identityMatch,
  };
}

/**
 * Build a browser-backed AnalysisService around one Playwright page.
 * The caller owns the browser/page lifecycle; the service never closes
 * it and performs no navigation outside setContent on that page.
 */
export function createBrowserAnalysisService(page: Page): AnalysisService {
  const golden = loadGoldenExpected();
  // Serialises all browser work on the shared page.
  let chain: Promise<unknown> = Promise.resolve();

  function runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const task = chain.then(work, work);
    // Keep the chain alive even if this task rejects.
    chain = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  function analysedCase(
    manifest: FixtureManifest,
    mutationId: MutationId | null,
    evaluated: Awaited<ReturnType<typeof evaluateSequence>>,
  ): AnalyzedCase {
    const expected =
      mutationId === null
        ? ("STABLE" as Verdict)
        : (golden.get(`${manifest.fixtureId}/${mutationId}`) ?? null);
    return {
      fixtureId: manifest.fixtureId,
      mutationId,
      kind: mutationId === null ? "baseline" : "mutation",
      locatorKind: manifest.kind,
      controlGroup: manifest.controlGroup,
      verdict: evaluated.verdict,
      analysisStatus: evaluated.analysisStatus,
      executionStatus: evaluated.executionStatus,
      matchCount: evaluated.matchCount,
      identityMatch: evaluated.identityMatch,
      expectedVerdict: expected,
      matchesGolden:
        evaluated.verdict === null || expected === null
          ? null
          : evaluated.verdict === expected,
    };
  }

  return {
    health(): HealthInfo {
      return {
        status: "ok",
        service: "locatorstress",
        version: API_VERSION,
        seed: SEED,
        bfsLimits: { maxDepth: 6, maxExpandedStates: 4096 },
        mutationOrder: [...MUTATION_ORDER],
      };
    },

    listFixtures(): FixtureSummary[] {
      return loadAllFixtureManifests().map(publicFixtureSummary);
    },

    listMutations(): MutationSummary[] {
      return MUTATION_ORDER.map((id) => ({ id, name: MUTATIONS[id].name }));
    },

    validate(request: ValidateRequest): {
      valid: boolean;
      errors: string[];
      locator?: LocatorSpecV1;
    } {
      const errors: string[] = [];
      let locator: LocatorSpecV1 | undefined;
      if (request.locator !== undefined) {
        errors.push(...validateLocatorSpec(request.locator));
        if (errors.length === 0) {
          locator = normalizeLocatorSpec(request.locator as LocatorSpecV1);
        }
      }
      if (request.scenario !== undefined) {
        errors.push(...validateScenarioShape(request.scenario));
      }
      if (request.locator === undefined && request.scenario === undefined) {
        errors.push("validate requires a locator or a scenario");
      }
      // FIX-T009: only include `locator` when it is defined. Returning
      // `locator: undefined` as an own property used to kill the server:
      // canonicalJson() throws on undefined values after writeHead(200),
      // and the outer catch then wrote a second header set
      // (ERR_HTTP_HEADERS_SENT), crashing the process.
      const result: {
        valid: boolean;
        errors: string[];
        locator?: LocatorSpecV1;
      } = { valid: errors.length === 0, errors };
      if (locator !== undefined) {
        result.locator = locator;
      }
      return result;
    },

    async analyze(request: AnalyzeRequest): Promise<FixtureAnalysis> {
      return runExclusive(async () => {
        const fixtureId = validateFixtureId(request.fixtureId);
        const mutationIds =
          validateMutationIds(request.mutationIds) ?? [...MUTATION_ORDER];
        let manifest: FixtureManifest;
        try {
          manifest = loadFixtureManifest(fixtureId);
        } catch {
          throw notFound(`unknown fixture ${fixtureId}`);
        }
        const baselineEval = await evaluateSequence(page, manifest, []);
        const baseline = analysedCase(manifest, null, baselineEval);
        const cases: AnalyzedCase[] = [];
        for (const mutationId of mutationIds) {
          const evaluated = await evaluateSequence(page, manifest, [mutationId]);
          cases.push(analysedCase(manifest, mutationId, evaluated));
        }
        return { fixtureId, baseline, cases };
      });
    },

    async search(request: SearchRequest): Promise<WitnessSummary> {
      return runExclusive(async () => {
        const fixtureId = validateFixtureId(request.fixtureId);
        const { maxDepth, maxExpandedStates } = validateBfsBounds(request);
        let manifest: FixtureManifest;
        try {
          manifest = loadFixtureManifest(fixtureId);
        } catch {
          throw notFound(`unknown fixture ${fixtureId}`);
        }
        const evaluator = createBrowserEvaluator(page, manifest);
        // P2-2: ONLY fixtureId (+ smaller bounds). Never operatorOrder
        // or allowRepeat — those are test-only hooks.
        const result = await runBoundedBfs(evaluator, {
          fixtureId,
          ...(maxDepth !== undefined ? { maxDepth } : {}),
          ...(maxExpandedStates !== undefined ? { maxExpandedStates } : {}),
        });
        return summarizeWitness(result);
      });
    },
  };
}

function validateBfsBounds(request: SearchRequest): {
  maxDepth?: number;
  maxExpandedStates?: number;
} {
  let maxDepth: number | undefined;
  let maxExpandedStates: number | undefined;
  if (request.maxDepth !== undefined) {
    if (
      !Number.isInteger(request.maxDepth) ||
      request.maxDepth < 0 ||
      request.maxDepth > 6
    ) {
      throw badRequest(
        `maxDepth must be an integer in 0..6 (frozen cap), got ${JSON.stringify(request.maxDepth)}`,
      );
    }
    maxDepth = request.maxDepth;
  }
  if (request.maxExpandedStates !== undefined) {
    if (
      !Number.isInteger(request.maxExpandedStates) ||
      request.maxExpandedStates < 1 ||
      request.maxExpandedStates > 4096
    ) {
      throw badRequest(
        `maxExpandedStates must be an integer in 1..4096 (frozen cap), got ${JSON.stringify(request.maxExpandedStates)}`,
      );
    }
    maxExpandedStates = request.maxExpandedStates;
  }
  return { maxDepth, maxExpandedStates };
}

function validateScenarioShape(scenario: unknown): string[] {
  const errors: string[] = [];
  if (typeof scenario !== "object" || scenario === null || Array.isArray(scenario)) {
    return ["scenario must be a plain object"];
  }
  const s = scenario as Record<string, unknown>;
  if (s["schema"] !== "locatorstress.scenario/v1") {
    errors.push('scenario.schema must be "locatorstress.scenario/v1"');
  }
  if (s["seed"] !== SEED) {
    errors.push(`scenario.seed must be "${SEED}"`);
  }
  if (typeof s["html"] !== "string" || s["html"].length === 0) {
    errors.push("scenario.html must be a non-empty string");
  }
  if (s["locator"] !== undefined) {
    errors.push(...validateLocatorSpec(s["locator"]).map((e) => `scenario.locator: ${e}`));
  } else {
    errors.push("scenario.locator is required");
  }
  if (s["mutation_suite"] !== undefined) {
    if (
      !Array.isArray(s["mutation_suite"]) ||
      (s["mutation_suite"] as unknown[]).some(
        (m) => typeof m !== "string" || !(MUTATION_ORDER as readonly string[]).includes(m),
      )
    ) {
      errors.push("scenario.mutation_suite must be an array of M01–M08");
    }
  }
  if (s["bfs"] !== undefined) {
    if (typeof s["bfs"] !== "object" || s["bfs"] === null || Array.isArray(s["bfs"])) {
      errors.push("scenario.bfs must be an object");
    } else {
      const bfs = s["bfs"] as Record<string, unknown>;
      if (
        bfs["max_depth"] !== undefined &&
        (typeof bfs["max_depth"] !== "number" ||
          !Number.isInteger(bfs["max_depth"]) ||
          (bfs["max_depth"] as number) < 0 ||
          (bfs["max_depth"] as number) > 6)
      ) {
        errors.push("scenario.bfs.max_depth must be an integer in 0..6");
      }
      if (
        bfs["max_expanded_states"] !== undefined &&
        (typeof bfs["max_expanded_states"] !== "number" ||
          !Number.isInteger(bfs["max_expanded_states"]) ||
          (bfs["max_expanded_states"] as number) < 1 ||
          (bfs["max_expanded_states"] as number) > 4096)
      ) {
        errors.push("scenario.bfs.max_expanded_states must be an integer in 1..4096");
      }
    }
  }
  return errors;
}
```

## src/api/routes.ts

- 行数：190；字节数：6346；SHA-256：`cc16a62d9393e1bc9df61944a452de0a6fa6d728e93ecfd085f900ea373e5e52`

```ts
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
//   POST /api/analyze    — baseline + single mutations for one fixture.
//   POST /api/search     — bounded BFS witness for one fixture.
//   POST /api/export     — JSON export of an AnalysisReport (validates
//                          schema + recomputes all four hashes). HTML
//                          export is owned by T010 and returns 501:
//                          the API reports it as not implemented rather
//                          than faking an HTML export.
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
import { exportReportJson, validateExportedReport } from "../export/json-export.js";

export interface RouteResult {
  status: number;
  body: unknown;
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
      const analysis = await service.analyze({
        fixtureId: body["fixtureId"] as string,
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
          "operatorOrder and allowRepeat are test-only BFS options and are not accepted by the API; only fixtureId, maxDepth and maxExpandedStates may be supplied",
        );
      }
      const summary = await service.search({
        fixtureId: body["fixtureId"] as string,
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
      if (format === "html") {
        return {
          status: 501,
          body: {
            error: {
              code: "HTML_EXPORT_NOT_IMPLEMENTED",
              message:
                "HTML export is owned by T010; this API serves JSON export only",
            },
          },
        };
      }
      if (format !== "json") {
        throw badRequest(`unsupported export format ${JSON.stringify(format)} (expected "json")`);
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
```

## src/api/server.ts

- 行数：175；字节数：5443；SHA-256：`b955e5caaf8a1963da27c0adaa5f2b8933effdf5a29feccb57522de568d33aca`

```ts
// T008 — Local API HTTP server (PROJECT_BOOK §7.3, §10).
//
// Node built-in http only; no framework, no external dependency. The
// server binds ONLY to a loopback address — 127.0.0.1 by default, ::1
// also accepted — and startAnalysisServer() THROWS for any other host,
// including 0.0.0.0. Binding is verified after listen(): the reported
// address must equal the requested loopback host, otherwise the server
// is closed and startup fails. The port defaults to 0 (ephemeral); the
// actual port is reported in the returned handle and is never part of
// any canonical hash.
//
// JSON bodies are limited to 1 MiB; malformed JSON is a 400, never a
// crash. Responses are canonical JSON (sorted keys) for stable bytes.

import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { canonicalJson } from "../canonical/canonical-json.js";
import type { AnalysisService } from "./service.js";
import { MAX_JSON_BODY_BYTES } from "./service.js";
import { handleApiRequest } from "./routes.js";

export const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "::1"];
export const DEFAULT_API_HOST = "127.0.0.1";

export function assertLoopbackHost(host: string): void {
  if (!LOOPBACK_HOSTS.includes(host)) {
    throw new Error(
      `API host must be a loopback address (${LOOPBACK_HOSTS.join(" or ")}); got ${JSON.stringify(host)} — refusing to bind a non-loopback address`,
    );
  }
}

export interface RunningApiServer {
  server: Server;
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

export interface StartApiServerOptions {
  host?: string;
  port?: number;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_JSON_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(new Error(`JSON body exceeds ${MAX_JSON_BODY_BYTES} bytes`));
        return;
      }
      const text = Buffer.concat(chunks).toString("utf-8");
      if (text.trim() === "") {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(text) as unknown);
      } catch {
        reject(new Error("request body is not valid JSON"));
      }
    });
    req.on("error", (err: Error) => reject(err));
  });
}

export async function startAnalysisServer(
  service: AnalysisService,
  options: StartApiServerOptions = {},
): Promise<RunningApiServer> {
  const host = options.host ?? DEFAULT_API_HOST;
  assertLoopbackHost(host);
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`API port must be an integer in 0..65535, got ${String(port)}`);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}`);
      const path = url.pathname;
      let body: unknown = null;
      if (req.method === "POST") {
        try {
          body = await readJsonBody(req);
        } catch (err) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            canonicalJson({
              error: {
                code: "BAD_REQUEST",
                message: err instanceof Error ? err.message : String(err),
              },
            }),
          );
          return;
        }
      }
      const result = await handleApiRequest(
        service,
        req.method ?? "GET",
        path,
        body,
      );
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(canonicalJson(result.body));
    } catch (err) {
      // FIX-T009 (defence in depth): if headers already went out — e.g.
      // canonicalJson() threw after writeHead(200) — never write headers
      // again; doing so throws ERR_HTTP_HEADERS_SENT uncaught and kills
      // the process. Just end the response.
      if (res.headersSent) {
        res.end();
        return;
      }
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        canonicalJson({
          error: {
            code: "INTERNAL_ERROR",
            message: err instanceof Error ? err.message : String(err),
          },
        }),
      );
    }
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, host, () => {
      server.removeListener("error", rejectPromise);
      resolvePromise();
    });
  });

  const address = server.address();
  if (
    address === null ||
    typeof address === "string" ||
    address.address !== host
  ) {
    const actual =
      address === null
        ? "null"
        : typeof address === "string"
          ? address
          : `${address.address}:${address.port}`;
    await new Promise<void>((done) => server.close(() => done()));
    throw new Error(
      `API loopback bind verification failed: requested ${host}, server reports ${actual}`,
    );
  }
  const actualPort = address.port;
  return {
    server,
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    async close(): Promise<void> {
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
```

## src/api/index.ts

- 行数：22；字节数：612；SHA-256：`bb64b7274f0edf738849f94c81324b672d0baa52aef4e268acfb520282db054a`

```ts
// T008 — Local analysis API barrel.
export { ApiError, createBrowserAnalysisService, loadGoldenExpected } from "./service.js";
export type {
  AnalysisService,
  FixtureSummary,
  MutationSummary,
  AnalyzedCase,
  FixtureAnalysis,
  AnalyzeRequest,
  SearchRequest,
  ValidateRequest,
  HealthInfo,
} from "./service.js";
export { handleApiRequest } from "./routes.js";
export type { RouteResult } from "./routes.js";
export {
  LOOPBACK_HOSTS,
  DEFAULT_API_HOST,
  assertLoopbackHost,
  startAnalysisServer,
} from "./server.js";
export type { RunningApiServer, StartApiServerOptions } from "./server.js";
```

## src/api/node-shims.d.ts

- 行数：42；字节数：1522；SHA-256：`5cbb3b5b20b71fe57b00c2298671945c66afe034cd158d2b2e9c0d5c1cfe321e`

```ts
// Minimal ambient declarations for the Node.js built-ins used by the
// API server only. The project has no @types/node dependency (by
// design: no new dependencies), and src/node-builtins.d.ts is shared
// infrastructure — so the API module carries its own declarations,
// covering exactly the API surface it uses (same precedent as
// src/canonical/node-shims.d.ts). Kept in src/api/ so the module stays
// self-contained.

declare module "node:http" {
  interface IncomingMessage {
    url?: string;
    method?: string;
    on(event: "data", listener: (chunk: Buffer) => void): void;
    on(event: "end", listener: () => void): void;
    on(event: "error", listener: (err: Error) => void): void;
  }
  interface ServerResponse {
    readonly headersSent: boolean;
    writeHead(statusCode: number, headers: Record<string, string>): void;
    end(data?: string): void;
  }
  interface AddressInfo {
    address: string;
    port: number;
    family: string;
  }
  interface Server {
    listen(port: number, host: string, callback: () => void): void;
    address(): AddressInfo | string | null;
    close(callback: () => void): void;
    once(event: "error", listener: (err: Error) => void): void;
    removeListener(event: "error", listener: (err: Error) => void): void;
  }
  export function createServer(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ): Server;
}

declare class Buffer extends Uint8Array {
  static concat(list: Buffer[]): Buffer;
  toString(encoding?: string): string;
}
```

## src/export/json-export.ts

- 行数：122；字节数：4063；SHA-256：`25cf84119dffc59c864f2505290bca844e1f17fb20f196c076a7d2abea91ffd7`

```ts
// T008 — JSON exporter for AnalysisReport (PROJECT_BOOK §7.3, §11.4).
//
// Export bytes are canonical JSON (T006 canonicaliser: UTF-8, LF,
// NFC, keys sorted by code point, arrays in stable order) plus one
// trailing LF. The LF is a file convention, not part of the hashed
// bytes — exactly as the T006 evidence files do it.
//
// Validation is two-layer and both layers must pass:
//   1. structural (validateReportStructure in contracts/report.ts):
//      schema, seed, counts, score consistency, witness-status rules;
//   2. hash recomputation (recomputeReportHashes in analysis/witness.ts):
//      all four hashes recompute from the report's embedded canonical
//      objects. A report whose counts were edited after hashing fails
//      here, even if it is structurally self-consistent.
//
// Nothing in this module computes a verdict, a score or a witness: it
// only serialises and verifies a report built by analysis/witness.ts.

import { readFileSync, writeFileSync } from "node:fs";
import { canonicalJson } from "../canonical/canonical-json.js";
import {
  validateReportStructure,
} from "../contracts/report.js";
import type { AnalysisReport } from "../contracts/report.js";
import { recomputeReportHashes } from "../analysis/witness.js";

export interface ReportValidation {
  valid: boolean;
  errors: string[];
  recomputed: {
    scenario_sha256: string;
    oracle_result_sha256: string;
    analysis_sha256: string;
    gate_sha256: string;
  } | null;
}

/**
 * Validate a parsed report value: structure first, then hash
 * recomputation. Never throws for a bad report — it returns the errors.
 */
export function validateExportedReport(report: unknown): ReportValidation {
  const errors = validateReportStructure(report);
  if (errors.length > 0) {
    return { valid: false, errors, recomputed: null };
  }
  try {
    const { recomputed, errors: hashErrors } = recomputeReportHashes(
      report as AnalysisReport,
    );
    if (hashErrors.length > 0) {
      return { valid: false, errors: hashErrors, recomputed };
    }
    return { valid: true, errors: [], recomputed };
  } catch (err) {
    return {
      valid: false,
      errors: [
        `hash recomputation failed: ${err instanceof Error ? err.message : String(err)}`,
      ],
      recomputed: null,
    };
  }
}

/**
 * Serialise a report to its export bytes. Throws when the report fails
 * validation (structure or hash recomputation) — an invalid report is
 * never written out as if it were good.
 */
export function exportReportJson(report: unknown): string {
  const validation = validateExportedReport(report);
  if (!validation.valid) {
    throw new Error(
      `refusing to export an invalid report: ${validation.errors.join("; ")}`,
    );
  }
  return `${canonicalJson(report)}\n`;
}

/** Write a validated report to a file (canonical bytes + trailing LF). */
export function writeReportJson(filePath: string, report: unknown): string {
  const text = exportReportJson(report);
  writeFileSync(filePath, text, "utf-8");
  return text;
}

/**
 * Read a report file, parse it, and validate it (structure + hash
 * recomputation). Returns the parsed report and the validation result;
 * the caller decides whether to accept it.
 */
export function readAndValidateReportJson(filePath: string): {
  report: unknown;
  validation: ReportValidation;
} {
  const text = readFileSync(filePath, "utf-8");
  return validateExportedJsonText(text);
}

/** Validate exported report text (as produced by exportReportJson). */
export function validateExportedJsonText(text: string): {
  report: unknown;
  validation: ReportValidation;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    return {
      report: null,
      validation: {
        valid: false,
        errors: [
          `exported text is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        ],
        recomputed: null,
      },
    };
  }
  return { report: parsed, validation: validateExportedReport(parsed) };
}
```

## src/export/html-export.ts

- 行数：202；字节数：10017；SHA-256：`0e5a644c3950ff3f2cf68145e3717b0da075bc7bff7cb262e55f4e46d8ea5320`

```ts
// T010 — Offline HTML exporter for AnalysisReport
// (IMPLEMENTATION_PLAN T010; PROJECT_BOOK §7.3, §11.4).
//
// A report is valid only if it passes the SAME validation as the JSON
// export (structure + hash recomputation, see json-export.ts). The
// HTML is then built from that validated report only:
//   - every report value is rendered through escapeHtml() — input
//     text (notes, witness meanings/notes, fixture ids, selectors in
//     the embedded JSON) is always displayed as text, never parsed
//     as markup and never executed;
//   - the full canonical JSON is embedded twice, both derived from
//     the single canonicalJson(report) string: once as a
//     <script type="application/json"> block (escapeJsonForHtmlScript)
//     and once as escaped text in a <pre>. Either copy parses back to
//     exactly the report the JSON exporter writes (modulo the JSON
//     exporter's single trailing LF), so HTML and JSON exports are
//     consistent by construction;
//   - the document is self-contained: inline <style> only, no
//     external scripts, fonts, images or links (verified by
//     scanExternalResources(), which must return [] for every export).
//
// Nothing in this module computes a verdict, a score or a witness.

import { writeFileSync } from "node:fs";

import { canonicalJson } from "../canonical/canonical-json.js";
import type { AnalysisReport, VerdictCounts } from "../contracts/report.js";
import {
  escapeHtml,
  escapeJsonForHtmlScript,
  scanExternalResources,
} from "./html-escape.js";
import { validateExportedReport } from "./json-export.js";
import { renderReportHtml } from "./templates/report.html.js";

export { escapeHtml, escapeJsonForHtmlScript, scanExternalResources };

const VERDICT_ORDER = ["STABLE", "WRONG_TARGET", "AMBIGUOUS", "MISSING"] as const;

function verdictCell(verdict: string | null): string {
  if (verdict === null) return "<td>—</td>";
  return `<td><span class="verdict-${escapeHtml(verdict)}">${escapeHtml(verdict)}</span></td>`;
}

function boolCell(value: boolean | null): string {
  if (value === null) return "<td>—</td>";
  return `<td>${value ? "yes" : "no"}</td>`;
}

function countsRow(label: string, counts: VerdictCounts): string {
  const cells = VERDICT_ORDER.map(
    (v) => `<td>${escapeHtml(counts[v] ?? 0)}</td>`,
  ).join("");
  return `<tr><th scope="row">${escapeHtml(label)}</th>${cells}</tr>`;
}

/**
 * Render a validated report as a self-contained offline HTML document.
 * Throws when the report fails validation — an invalid report is never
 * exported as if it were good. Also throws if the finished document
 * fails its own external-resource scan (defence in depth: a template
 * regression must fail loudly, not ship a leaky report).
 */
export function exportReportHtml(report: unknown): string {
  const validation = validateExportedReport(report);
  if (!validation.valid) {
    throw new Error(
      `refusing to export an invalid report as HTML: ${validation.errors.join("; ")}`,
    );
  }
  const r = report as AnalysisReport;
  const canonical = canonicalJson(r);

  const headerHtml = [
    "<header>",
    `<h1>LocatorStress analysis report</h1>`,
    `<p>Schema: <code>${escapeHtml(r.schema)}</code> · Seed: <code>${escapeHtml(r.seed)}</code> · Task: <code>${escapeHtml(r.task)}</code></p>`,
    `<p>Analysis status: <span class="badge">${escapeHtml(r.analysisStatus)}</span> · Cases: ${escapeHtml(r.completedCases)} completed / ${escapeHtml(r.expectedCases)} expected · Baseline: ${escapeHtml(r.baseline.passed)}/${escapeHtml(r.baseline.total)} passed</p>`,
    `<p>External requests: ${escapeHtml(r.externalRequests)} · Blocked requests: ${escapeHtml(r.blockedRequests)} · Static offline-scan hits: ${escapeHtml(r.staticOfflineScanHits)}</p>`,
    "</header>",
  ].join("\n");

  const byKindRows = Object.entries(r.verdictCountsByKind)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([kind, counts]) => countsRow(`By kind: ${kind}`, counts))
    .join("\n");
  const summaryHtml = [
    "<section>",
    "<h2>Summary</h2>",
    "<table>",
    "<thead><tr><th scope=\"col\">Verdict</th><th scope=\"col\">STABLE</th><th scope=\"col\">WRONG_TARGET</th><th scope=\"col\">AMBIGUOUS</th><th scope=\"col\">MISSING</th></tr></thead>",
    "<tbody>",
    countsRow("All cases", r.verdictCounts),
    byKindRows,
    "</tbody>",
    "</table>",
    `<p>Stability score (overall): <strong>${escapeHtml(r.scores.overall.score ?? "—")}</strong> (${escapeHtml(r.scores.overall.stable)}/${escapeHtml(r.scores.overall.completed)} stable of completed; expected ${escapeHtml(r.scores.overall.expected)}, completed ${escapeHtml(r.scores.overall.completed)})</p>`,
    `<p>Coverage: ${escapeHtml(r.coverage.cssFixtures)} CSS / ${escapeHtml(r.coverage.xpathFixtures)} XPath / ${escapeHtml(r.coverage.roleFixtures)} role fixtures; ${escapeHtml(r.coverage.framePathFixtures)} with framePath, ${escapeHtml(r.coverage.indexFixtures)} with index.</p>`,
    `<p>Controls — stable: ${escapeHtml(r.controls.stable.pairs)} pairs, ${escapeHtml(r.controls.stable.mismatched)} mismatched; fragile: ${escapeHtml(r.controls.fragile.pairs)} pairs, ${escapeHtml(r.controls.fragile.mismatched)} mismatched.</p>`,
    `<p>Oracle parity: ${escapeHtml(r.oracleParity.matched)}/${escapeHtml(r.oracleParity.compared)} matched, ${escapeHtml(r.oracleParity.mismatched)} mismatched.</p>`,
    `<p>Witness coverage: ${escapeHtml(r.witnessCoverage.searchedFixtures)} fixtures searched — ${escapeHtml(r.witnessCoverage.found)} FOUND, ${escapeHtml(r.witnessCoverage.boundedNoWitness)} bounded-no-witness, ${escapeHtml(r.witnessCoverage.boundedIncomplete)} bounded-incomplete. BOUNDED_INCOMPLETE is never “no witness” and never “safe”.</p>`,
    "</section>",
  ].join("\n");

  const hashesHtml = [
    "<section>",
    "<h2>Hashes</h2>",
    "<table>",
    "<thead><tr><th scope=\"col\">Hash</th><th scope=\"col\">SHA-256</th></tr></thead>",
    "<tbody>",
    `<tr><th scope="row">scenario_sha256</th><td><code>${escapeHtml(r.hashes.scenario_sha256)}</code></td></tr>`,
    `<tr><th scope="row">oracle_result_sha256</th><td><code>${escapeHtml(r.hashes.oracle_result_sha256)}</code></td></tr>`,
    `<tr><th scope="row">analysis_sha256</th><td><code>${escapeHtml(r.hashes.analysis_sha256)}</code></td></tr>`,
    `<tr><th scope="row">gate_sha256</th><td><code>${escapeHtml(r.hashes.gate_sha256)}</code></td></tr>`,
    "</tbody>",
    "</table>",
    "</section>",
  ].join("\n");

  const witnessRows = Object.values(r.witnesses)
    .sort((a, b) => (a.fixtureId < b.fixtureId ? -1 : a.fixtureId > b.fixtureId ? 1 : 0))
    .map((w) => {
      const seq =
        w.witness === null
          ? "—"
          : `${escapeHtml(w.witness.sequence.join(" + "))} (${escapeHtml(w.witness.verdict)}, depth ${escapeHtml(w.witness.depth)})`;
      const budget = w.budgetNote === undefined ? "" : `<br>${escapeHtml(w.budgetNote)}`;
      return `<tr><td>${escapeHtml(w.fixtureId)}</td><td>${escapeHtml(w.status)}</td><td>${seq}</td><td>${escapeHtml(w.meaning)}${budget}</td><td>${escapeHtml(w.statesEvaluated)} evaluated / ${escapeHtml(w.statesExpanded)} expanded / ${escapeHtml(w.queueRemaining)} queued</td></tr>`;
    })
    .join("\n");
  const witnessesHtml = [
    "<section>",
    "<h2>Witnesses (shortest failing sequences)</h2>",
    "<table>",
    "<thead><tr><th scope=\"col\">Fixture</th><th scope=\"col\">Status</th><th scope=\"col\">Witness</th><th scope=\"col\">Meaning</th><th scope=\"col\">Search</th></tr></thead>",
    `<tbody>${witnessRows}</tbody>`,
    "</table>",
    "</section>",
  ].join("\n");

  const caseRows = r.cases
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.fixtureId)}</td><td>${escapeHtml(c.mutationId)}</td><td>${escapeHtml(c.locatorKind)}</td><td>${escapeHtml(c.controlGroup)}</td>${verdictCell(c.verdict)}<td>${escapeHtml(c.analysisStatus)}</td><td>${escapeHtml(c.executionStatus)}</td><td>${escapeHtml(c.matchCount)}</td>${boolCell(c.identityMatch)}<td>${escapeHtml(c.expectedVerdict)}</td></tr>`,
    )
    .join("\n");
  const casesHtml = [
    "<section>",
    "<h2>Cases</h2>",
    "<table>",
    "<thead><tr><th scope=\"col\">Fixture</th><th scope=\"col\">Mutation</th><th scope=\"col\">Kind</th><th scope=\"col\">Control</th><th scope=\"col\">Verdict</th><th scope=\"col\">Status</th><th scope=\"col\">Execution</th><th scope=\"col\">Matches</th><th scope=\"col\">Identity</th><th scope=\"col\">Expected</th></tr></thead>",
    `<tbody>${caseRows}</tbody>`,
    "</table>",
    "</section>",
  ].join("\n");

  const notesHtml = [
    "<section>",
    "<h2>Notes</h2>",
    "<ul>",
    ...r.notes.map((n) => `<li>${escapeHtml(n)}</li>`),
    "</ul>",
    "</section>",
  ].join("\n");

  const html = renderReportHtml({
    titleText: escapeHtml(`LocatorStress report — ${r.seed}`),
    headerHtml,
    summaryHtml,
    witnessesHtml,
    casesHtml,
    notesHtml,
    hashesHtml,
    embeddedJson: escapeJsonForHtmlScript(canonical),
    embeddedJsonText: escapeHtml(canonical),
  });

  const scanHits = scanExternalResources(html);
  if (scanHits.length > 0) {
    throw new Error(
      `generated HTML failed its own external-resource scan: ${scanHits.join("; ")}`,
    );
  }
  return html;
}

/** Write a validated report as offline HTML (single trailing LF, like the JSON export). */
export function writeReportHtml(filePath: string, report: unknown): string {
  const html = exportReportHtml(report);
  const text = html.endsWith("\n") ? html : `${html}\n`;
  writeFileSync(filePath, text, "utf-8");
  return text;
}

/** Extract and parse the embedded report JSON from exported HTML. Throws on malformed input. */
export function parseEmbeddedReportJson(html: string): unknown {
  const match = /<script type="application\/json" id="report-json">([\s\S]*?)<\/script>/.exec(html);
  if (match === null) {
    throw new Error("exported HTML has no embedded report JSON block");
  }
  return JSON.parse(match[1]!) as unknown;
}
```

## src/export/html-escape.ts

- 行数：121；字节数：4518；SHA-256：`2869088a748790fbbfc5f09fa3632c0ada339772ddf5dd4394b2b481bf809006`

```ts
// T010 — HTML escaping + external-resource scanning for the offline
// HTML exporter (IMPLEMENTATION_PLAN T010; PROJECT_BOOK §7.3, §11.4).
//
// Rules:
//   - Every piece of report text rendered into the HTML goes through
//     escapeHtml(). There is no innerHTML-style interpolation of raw
//     report data anywhere in the exporter.
//   - The full report JSON is embedded in a single
//     <script type="application/json"> block, escaped with
//     escapeJsonForHtmlScript() so a payload can never break out of
//     the block (notably `</script>` becomes \u003c/script\u003e).
//     The block is data, not code: browsers never execute it, and the
//     report's CSP meta tag sets script-src 'none' as defence in depth.
//   - scanExternalResources() inspects only REAL markup (tags and
//     <style> bodies). Escaped payload text such as
//     `&lt;img src=x onerror=...&gt;` contains no `<...>` tag, so it
//     is never mistaken for a resource. Conversely any real <img>,
//     <script src>, <link>, <iframe>, event-handler attribute,
//     javascript:/data: URL or CSS @import/url() is reported.

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

/** Escape text for insertion into HTML text nodes or double-quoted attributes. */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"'`]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * Escape a JSON string for safe embedding inside a
 * <script type="application/json"> block. The result still parses as
 * the same JSON value; only the characters that could terminate the
 * block or start markup are rewritten as \uXXXX escapes.
 */
export function escapeJsonForHtmlScript(json: string): string {
  return json
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const FORBIDDEN_TAGS = new Set([
  "link",
  "img",
  "iframe",
  "video",
  "audio",
  "embed",
  "object",
  "source",
  "track",
]);

/**
 * Scan HTML for anything that could fetch an external (or any
 * non-inline) resource, or execute code. Returns a list of human
 * readable hits; empty means the document is self-contained.
 *
 * Checks, per real tag: forbidden resource tags, <script> with a src
 * or with any type other than application/json, event-handler
 * attributes (on*), javascript:/data:/vbscript: URLs, and absolute
 * http(s) href/src values. <style> bodies are checked for @import
 * and url(). Plain text that merely mentions a URL is NOT a hit —
 * text never fetches.
 */
export function scanExternalResources(html: string): string[] {
  const hits: string[] = [];

  for (const match of html.matchAll(/<([a-zA-Z][^>]{0,4000})>/g)) {
    const tagInner = match[1]!;
    const tagName = tagInner.split(/[\s/>]/, 1)[0]!.toLowerCase();
    const tagText = match[0]!;
    if (FORBIDDEN_TAGS.has(tagName)) {
      hits.push(`forbidden resource tag <${tagName}>: ${truncate(tagText)}`);
      continue;
    }
    if (tagName === "script") {
      const typeMatch = /type\s*=\s*["']([^"']*)["']/i.exec(tagInner);
      const type = typeMatch?.[1]?.trim().toLowerCase() ?? "";
      if (/\ssrc\s*=/i.test(tagInner)) {
        hits.push(`script with src attribute: ${truncate(tagText)}`);
      } else if (type !== "application/json") {
        hits.push(`executable script tag (type=${JSON.stringify(type)}): ${truncate(tagText)}`);
      }
      continue;
    }
    if (/\son[a-z]+\s*=/i.test(tagInner)) {
      hits.push(`event-handler attribute in <${tagName}>: ${truncate(tagText)}`);
    }
    if (/\s(?:href|src|action|formaction|poster|background)\s*=\s*["']\s*(?:javascript|data|vbscript):/i.test(tagInner)) {
      hits.push(`dangerous URL scheme in <${tagName}>: ${truncate(tagText)}`);
    }
    if (/\s(?:href|src|action|formaction|poster|background)\s*=\s*["']\s*(?:https?:)?\/\//i.test(tagInner)) {
      hits.push(`absolute external URL in <${tagName}>: ${truncate(tagText)}`);
    }
  }

  for (const styleMatch of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const body = styleMatch[1] ?? "";
    if (/@import/i.test(body)) {
      hits.push("CSS @import in <style>");
    }
    if (/url\s*\(/i.test(body)) {
      hits.push("CSS url() in <style>");
    }
  }

  return hits;
}

function truncate(text: string): string {
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}
```

## src/export/templates/report.html.ts

- 行数：81；字节数：4020；SHA-256：`7b10e459f36662f32b51ab17536eecb6955b235e22d822e14712e7fbdad7af78`

```ts
// T010 — Offline HTML report template (IMPLEMENTATION_PLAN T010).
//
// This module owns ONLY the document shell: doctype, head, inline
// <style>, and the section slots. It performs no escaping itself —
// every fragment it receives is already escaped HTML produced by
// src/export/html-export.ts (escapeHtml for text, escapeJsonForHtmlScript
// for the embedded JSON block). The shell contains:
//   - no <link>, <img>, <iframe>, <video>, <audio>, <embed>, <object>,
//     <source> or <track>;
//   - exactly one <script>, of type="application/json" (data, never
//     executed), carrying the full canonical report JSON so the HTML
//     and JSON exports are byte-consistent by construction;
//   - a CSP meta tag (default-src 'none'; script-src 'none') as
//     defence in depth: even a payload that slipped through escaping
//     could not load or run anything.
//   - inline <style> only, no url() / @import; verdicts always carry
//     text, never colour alone (same convention as src/ui/styles.css).

export interface ReportHtmlParts {
  /** Escaped <title> text (no tags). */
  titleText: string;
  /** Escaped HTML for the header block (already-built markup). */
  headerHtml: string;
  /** Escaped HTML for the summary tables block. */
  summaryHtml: string;
  /** Escaped HTML for the witness table block. */
  witnessesHtml: string;
  /** Escaped HTML for the cases table block. */
  casesHtml: string;
  /** Escaped HTML for the notes list block. */
  notesHtml: string;
  /** Escaped HTML for the hashes table block. */
  hashesHtml: string;
  /** Canonical report JSON, escaped for a <script type="application/json"> block. */
  embeddedJson: string;
  /** Same canonical JSON, HTML-escaped for display in a <pre>. */
  embeddedJsonText: string;
}

const INLINE_CSS = [
  "body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;margin:2rem auto;max-width:1100px;padding:0 1rem;color:#111;background:#fff;line-height:1.5}",
  "h1{font-size:1.5rem}h2{font-size:1.2rem;margin-top:2rem;border-bottom:1px solid #ccc;padding-bottom:.25rem}",
  "table{border-collapse:collapse;width:100%;margin:.5rem 0}",
  "th,td{border:1px solid #bbb;padding:.35rem .5rem;text-align:left;vertical-align:top;font-size:.9rem}",
  "th{background:#eee}code{font-family:ui-monospace,monospace;font-size:.85rem;word-break:break-all}",
  ".verdict-STABLE{color:#0a6b1a}.verdict-WRONG_TARGET{color:#9a3b00}.verdict-AMBIGUOUS{color:#7a5200}.verdict-MISSING{color:#a00}",
  ".badge{display:inline-block;border:1px solid #666;border-radius:3px;padding:0 .4rem;font-size:.8rem}",
  "pre.json{white-space:pre-wrap;word-break:break-all;background:#f6f6f6;border:1px solid #ccc;padding:.75rem;font-size:.8rem;max-height:24rem;overflow:auto}",
  "details{margin-top:1rem}",
].join("\n");

/** Assemble the complete self-contained HTML document. */
export function renderReportHtml(parts: ReportHtmlParts): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; form-action \'none\'; img-src \'none\'; font-src \'none\'; connect-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'">',
    `<title>${parts.titleText}</title>`,
    `<style>\n${INLINE_CSS}\n</style>`,
    "</head>",
    "<body>",
    parts.headerHtml,
    parts.summaryHtml,
    parts.hashesHtml,
    parts.witnessesHtml,
    parts.casesHtml,
    parts.notesHtml,
    "<details>",
    "<summary>Embedded report JSON (identical to the JSON export)</summary>",
    `<script type="application/json" id="report-json">${parts.embeddedJson}</script>`,
    `<pre class="json" id="report-json-text">${parts.embeddedJsonText}</pre>`,
    "</details>",
    "<noscript><p>The embedded report JSON is in the page source (script type=\"application/json\").</p></noscript>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
```

## src/export/node-shims.d.ts

- 行数：11；字节数：538；SHA-256：`1d0fa077080b7b829137ecbce82ae4c591dd83ce9475fee87e9fc0dfaf4494dd`

```ts
// Minimal ambient declarations for the Node.js built-ins used by the
// JSON exporter only. The project has no @types/node dependency (by
// design: no new dependencies). src/node-builtins.d.ts declares
// readFileSync but not writeFileSync, so this module declares the one
// extra function it uses (same precedent as
// src/canonical/node-shims.d.ts: per-module minimal declarations, no
// shared-file edits).

declare module "node:fs" {
  export function writeFileSync(path: string, data: string, encoding: "utf8" | "utf-8"): void;
}
```
