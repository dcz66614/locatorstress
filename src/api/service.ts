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
import type { ElementHandle, Page } from "playwright";

import { SEED } from "../canonical/hashes.js";
import { normalizeLocatorSpec, validateLocatorSpec } from "../contracts/locator.js";
import type { LocatorSpecV1 } from "../contracts/locator.js";
import type { WitnessSummary } from "../contracts/report.js";
import {
  MAX_CUSTOM_DOM_NODES,
  normalizeCustomScenario,
  validateCustomScenarioForRun,
  validateCustomScenarioShape,
  type CustomScenarioV1,
} from "../contracts/custom-scenario.js";
import {
  captureCustomTarget,
  CustomTargetError,
  readTargetClassToken,
} from "../oracle/custom-target.js";
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
import type { MutationContext, MutationId } from "../mutations/types.js";
import { isSameElement } from "../oracle/identity-compare.js";
import { resolveLocator } from "../runner/locator-resolver.js";
import { withPageJavaScriptDisabled } from "../runner/browser.js";
import { summarizeWitness } from "../analysis/witness.js";
import {
  createBrowserEvaluator,
  createBrowserEvaluatorForCustom,
} from "../search/browser-evaluator.js";
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
  /** Frozen fixtures are stable/fragile controls; custom runs have no control group. */
  controlGroup: "stable" | "fragile" | "custom";
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
  /** "fixture" = one of the 24 frozen fixtures; "custom" = user-supplied scenario. */
  source: "fixture" | "custom";
  /** scenario_id for custom runs; absent for fixture runs. */
  scenarioId?: string;
  baseline: AnalyzedCase;
  cases: AnalyzedCase[];
}

export interface AnalyzeRequest {
  /** Exactly one of fixtureId / scenario must be supplied. */
  fixtureId?: string;
  /** Custom scenario (locatorstress.scenario/v1 + private target descriptor). */
  scenario?: unknown;
  mutationIds?: MutationId[];
}

export interface SearchRequest {
  /** Exactly one of fixtureId / scenario must be supplied. */
  fixtureId?: string;
  /** Custom scenario (locatorstress.scenario/v1 + private target descriptor). */
  scenario?: unknown;
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

// ---- FIX-R1-01: custom-scenario runs ----
//
// A custom run resolves the same pipeline as a fixture run (reset ->
// capture original target -> apply mutations -> resolve locator ->
// identity compare -> classify) but the HTML, locator and target all
// come from the user's scenario. The fixture helpers above are
// untouched; the custom helpers below mirror them so the frozen
// 192-case path cannot drift.
//
// The target descriptor is resolved ONLY through the private Oracle
// path (oracle/custom-target.ts). It is never written into the DOM,
// never returned by the API, and never passed to the locator under
// test. A target that does not resolve to exactly one element fails
// the whole run closed with 422 — never a silent fall back to a
// fixture locator.

export interface CustomRun {
  runId: string;
  scenario: CustomScenarioV1;
  ctx: MutationContext;
}

function resolveRunInput(request: {
  fixtureId?: unknown;
  scenario?: unknown;
}):
  | { kind: "fixture"; fixtureId: string }
  | { kind: "custom"; scenario: CustomScenarioV1 } {
  const hasFixture = request.fixtureId !== undefined;
  const hasScenario = request.scenario !== undefined;
  if (hasFixture && hasScenario) {
    throw badRequest("supply exactly one of fixtureId or scenario, not both");
  }
  if (!hasFixture && !hasScenario) {
    throw badRequest("analyze/search require exactly one of fixtureId or scenario");
  }
  if (hasFixture) {
    return { kind: "fixture", fixtureId: validateFixtureId(request.fixtureId) };
  }
  const errors = validateCustomScenarioForRun(request.scenario);
  if (errors.length > 0) {
    throw badRequest(`invalid custom scenario: ${errors.join("; ")}`);
  }
  return { kind: "custom", scenario: normalizeCustomScenario(request.scenario) };
}

/**
 * Preflight for a custom run, on the shared page: load the pristine
 * custom HTML, enforce the DOM-node bound, capture the original
 * target through the private descriptor, and derive the M03 class
 * token from the target itself. Throws ApiError 422 when the target
 * is missing/ambiguous or the DOM is too large.
 */
async function prepareCustomRun(
  page: Page,
  scenario: CustomScenarioV1,
): Promise<CustomRun> {
  await page.setContent(scenario.html);
  const nodeCount = await page.evaluate(
    () => document.querySelectorAll("*").length,
  );
  if (nodeCount > MAX_CUSTOM_DOM_NODES) {
    throw new ApiError(
      422,
      "CUSTOM_HTML_TOO_LARGE",
      `custom scenario HTML has ${nodeCount} elements (max ${MAX_CUSTOM_DOM_NODES}); reduce the DOM size`,
    );
  }
  let original: ElementHandle;
  try {
    original = await captureCustomTarget(page, scenario.target);
  } catch (err) {
    if (err instanceof CustomTargetError) {
      throw new ApiError(422, err.code, err.message);
    }
    throw err;
  }
  const m03Token = await readTargetClassToken(original);
  return {
    runId: scenario.scenario_id,
    scenario,
    ctx: {
      fixtureId: scenario.scenario_id,
      seed: SEED,
      m03Token,
      framePath: [...(scenario.locator.framePath ?? [])],
      newText: "Changed Text",
    },
  };
}

/** Evaluate one sequence (baseline = []) for a custom run. Mirrors evaluateSequence. */
async function evaluateCustomSequence(
  page: Page,
  run: CustomRun,
  sequence: readonly MutationId[],
): Promise<{
  verdict: Verdict | null;
  analysisStatus: "COMPLETE" | "INCOMPLETE";
  executionStatus: string;
  matchCount: number;
  identityMatch: boolean | null;
}> {
  await page.setContent(run.scenario.html);
  const original = await captureCustomTarget(page, run.scenario.target);
  for (const mutationId of sequence) {
    await getMutation(mutationId).apply(page, original, run.ctx);
  }
  const { result, finalHandle } = await resolveLocator(page, run.scenario.locator);
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

function analysedCustomCase(
  run: CustomRun,
  mutationId: MutationId | null,
  evaluated: Awaited<ReturnType<typeof evaluateCustomSequence>>,
): AnalyzedCase {
  return {
    fixtureId: run.runId,
    mutationId,
    kind: mutationId === null ? "baseline" : "mutation",
    locatorKind: run.scenario.locator.kind,
    controlGroup: "custom",
    verdict: evaluated.verdict,
    analysisStatus: evaluated.analysisStatus,
    executionStatus: evaluated.executionStatus,
    matchCount: evaluated.matchCount,
    identityMatch: evaluated.identityMatch,
    // No golden matrix exists for user input: no expected verdict,
    // no parity claim.
    expectedVerdict: null,
    matchesGolden: null,
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
        const input = resolveRunInput(request);
        if (input.kind === "custom") {
          // FIX-R2-01: the whole custom run — every setContent of
          // user-supplied HTML, every mutation, every resolution —
          // executes with page JavaScript disabled, so even a payload
          // that slipped past validation cannot run. Restored in a
          // finally inside withPageJavaScriptDisabled; fixture runs
          // below never touch the toggle.
          return withPageJavaScriptDisabled(page, async () => {
            const run = await prepareCustomRun(page, input.scenario);
            const mutationIds =
              validateMutationIds(request.mutationIds) ?? [...run.scenario.mutation_suite];
            const baselineEval = await evaluateCustomSequence(page, run, []);
            const baseline = analysedCustomCase(run, null, baselineEval);
            const cases: AnalyzedCase[] = [];
            for (const mutationId of mutationIds) {
              const evaluated = await evaluateCustomSequence(page, run, [mutationId]);
              cases.push(analysedCustomCase(run, mutationId, evaluated));
            }
            return {
              fixtureId: run.runId,
              source: "custom",
              scenarioId: run.scenario.scenario_id,
              baseline,
              cases,
            };
          });
        }
        const fixtureId = input.fixtureId;
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
        return { fixtureId, source: "fixture", baseline, cases };
      });
    },

    async search(request: SearchRequest): Promise<WitnessSummary> {
      return runExclusive(async () => {
        const input = resolveRunInput(request);
        if (input.kind === "custom") {
          // FIX-R2-01: see analyze() — the whole custom search runs
          // with page JavaScript disabled.
          return withPageJavaScriptDisabled(page, async () => {
            const run = await prepareCustomRun(page, input.scenario);
            const { maxDepth, maxExpandedStates } = validateBfsBounds({
              maxDepth: request.maxDepth ?? run.scenario.bfs.max_depth,
              maxExpandedStates:
                request.maxExpandedStates ?? run.scenario.bfs.max_expanded_states,
            });
            const evaluator = createBrowserEvaluatorForCustom(page, {
              runId: run.runId,
              html: run.scenario.html,
              locator: run.scenario.locator,
              target: run.scenario.target,
              ctx: run.ctx,
            });
            // P2-2: ONLY the run id (+ smaller bounds). Never
            // operatorOrder or allowRepeat — those are test-only hooks.
            const result = await runBoundedBfs(evaluator, {
              fixtureId: run.runId,
              ...(maxDepth !== undefined ? { maxDepth } : {}),
              ...(maxExpandedStates !== undefined ? { maxExpandedStates } : {}),
            });
            return summarizeWitness(result);
          });
        }
        const fixtureId = input.fixtureId;
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

// FIX-R1-01: scenario shape + HTML safety + target-shape checks live
// in contracts/custom-scenario.ts (single source of truth shared by
// /api/validate and the analyze/search run path). The target stays
// OPTIONAL here so /api/validate keeps its frozen behaviour (a
// scenario without a target is still shape-checkable); analyze/search
// require it via validateCustomScenarioForRun().
function validateScenarioShape(scenario: unknown): string[] {
  return validateCustomScenarioShape(scenario);
}
