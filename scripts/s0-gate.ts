import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { launchBaselineBrowser } from "../dist/runner/browser.js";
import { resolveLocator } from "../dist/runner/locator-resolver.js";
import { isSameElement } from "../dist/oracle/identity-compare.js";
import {
  SEED,
  FIXTURE_IDS,
  loadAllFixtureManifests,
  validateFixtureManifest,
} from "../dist/fixtures/fixture-manifest.js";
import {
  loadFixture,
  setFixtureContent,
  captureOriginalTargetForFixture,
  mutationContextForFixture,
} from "../dist/fixtures/fixture-loader.js";
import { MUTATION_ORDER, getMutation } from "../dist/mutations/registry.js";
import { normalizeLocatorSpec } from "../dist/contracts/locator.js";

import type { Page } from "playwright";
import type { LocatorSpecV1 } from "../src/contracts/locator.js";


const repoRoot = process.cwd();

const THRESHOLDS = {
  baselineRequired: 24,
  casesRequired: 192,
  plantedDetectionRequired: 96,
  stableFalseAlarmMaxNumerator: 1,
  stableFalseAlarmDenominator: 96,
  fourStateMin: 8,
  oracleParityRequired: 192,
  replayRuns: 100,
  uniqueGateHashesRequired: 1,
  externalRequestsMax: 0,
} as const;

const NOTES = [
  "M08 freeze: all T002 fixtures do NOT sync aria-label on M08 CHANGE_TEXT; this is the frozen S0 decision.",
  "Oracle parity matchCount expected values are the frozen per-case finalMatchCount values from evidence/s0/T002_MUTATION_REPORT.json, validated 192/192 against golden verdicts; verdict, identityMatch and executionStatus expectations are derived from the golden verdict itself.",
  "BFS witness: NOT_IMPLEMENTED_S0 (T007, S2); placeholder in analysis hash.",
];

const EXPECTED_CHROMIUM_VERSION = "158.0.8127.18";
const EXPECTED_PLAYWRIGHT_VERSION = "1.65.0";
const CHROMIUM_EXECUTABLE = join(
  process.env.HOME ?? "",
  ".cache/ms-playwright/chromium-1254/chrome-linux64/chrome",
);

const VERDICT_STATES = ["STABLE", "WRONG_TARGET", "AMBIGUOUS", "MISSING"] as const;
type Verdict = (typeof VERDICT_STATES)[number];

const FAMILIES = [
  "form-submit",
  "search-box",
  "nav-link",
  "dialog-confirm",
  "table-row-action",
  "toolbar-menu",
  "nested-iframe",
  "open-shadow-dom",
];

const MUTATION_SUITE = ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"];

const GOLDEN_PATH = join(repoRoot, "src/fixtures/golden/expected-verdicts.json");
const T002_PATH = join(repoRoot, "evidence/s0/T002_MUTATION_REPORT.json");
const S0_GATE_DIR = join(repoRoot, "evidence/s0");
const S0_GATE_JSON = join(S0_GATE_DIR, "S0_GATE.json");
const S0_GATE_LOG = join(S0_GATE_DIR, "S0_GATE.log");
const S0_P2A_LOG = join(S0_GATE_DIR, "S0_P2A.log");

// ---------------------------------------------------------------------------
// Canonical JSON + hashing + sanitization
// ---------------------------------------------------------------------------

function compareCodePoints(a: string, b: string): number {
  const aa = Array.from(a);
  const bb = Array.from(b);
  const n = Math.min(aa.length, bb.length);
  for (let i = 0; i < n; i++) {
    const ca = aa[i].codePointAt(0)!;
    const cb = bb[i].codePointAt(0)!;
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
  return aa.length - bb.length;
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(compareCodePoints);
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k.normalize("NFC")] = canonicalize(obj[k]);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sanitize(text: string, root: string): string {
  let out = text;
  if (root) out = out.split(root).join("<repo>");
  const home = process.env.HOME;
  if (home) out = out.split(home).join("<home>");
  return out;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VerdictCounts {
  STABLE: number;
  WRONG_TARGET: number;
  AMBIGUOUS: number;
  MISSING: number;
}

interface Coverage {
  cssFixtures: number;
  xpathFixtures: number;
  roleFixtures: number;
  framePathFixtures: number;
  framePathCases: number;
  indexFixtures: number;
  indexCases: number;
  twoLayerFramePathFixtures: number;
}

interface Controls {
  stable: { pairs: number; mismatches: number };
  fragile: { pairs: number; mismatches: number };
}

interface OracleMismatch {
  fixtureId: string;
  mutationId: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

interface OracleParity {
  compared: number;
  matched: number;
  mismatched: number;
  mismatches: OracleMismatch[];
}

interface StabilityScore {
  stable: number;
  completed: number;
  score: string;
}

interface DeterministicResult {
  passed: boolean;
  failureType: string | null;
  chromiumVersion: string;

  counts: Record<string, unknown>;
  hashes: {
    scenario_sha256: string;
    oracle_result_sha256: string;
    analysis_sha256: string;
  };
  verdictCounts: VerdictCounts;
  verdictCountsByKind: Record<string, VerdictCounts>;
  coverage: Coverage;
  controls: Controls;
  oracleParity: OracleParity;
  stabilityScore: StabilityScore;
  analysisStatus: "COMPLETE" | "INCOMPLETE";
  externalRequests: number;
  blockedRequests: number;
  staticOfflineScanHits: number;
  baselinePassed: number;
}

interface CaseRecord {
  fixtureId: string;
  mutationId: string;
  verdict: Verdict | null;
  finalMatchCount: number;
  identityMatch: boolean | null;
  executionStatus: string;
  frameFailureKind: string | null;
}

interface GoldenCase {
  fixtureId: string;
  mutationId: string;
  expectedVerdict: string;
  reason: string;
}

interface T002Case {
  fixtureId: string;
  mutationId: string;
  expectedVerdict: string;
  actualVerdict: string;
  executionStatus: string;
  rawMatchCount: number;
  finalMatchCount: number;
  frameFailureKind: string | null;
  identityMatch: boolean | null;
  match: boolean;
}

interface ManifestLike {
  fixtureId: string;
  family: string;
  kind: string;
  controlGroup: string;
  seed: string;
  locator: LocatorSpecV1;

}

// ---------------------------------------------------------------------------
// Verdict derivation
// ---------------------------------------------------------------------------

function deriveVerdict(
  executionStatus: string,
  frameFailureKind: string | null,
  finalMatchCount: number,
  identityMatch: boolean | null,
): Verdict | null {
  if (executionStatus !== "COMPLETED") return null;
  if (frameFailureKind !== null) {
    return frameFailureKind === "FRAME_AMBIGUOUS" ? "AMBIGUOUS" : "MISSING";
  }
  if (finalMatchCount === 0) return "MISSING";
  if (finalMatchCount > 1) return "AMBIGUOUS";
  if (finalMatchCount === 1) {
    if (identityMatch === true) return "STABLE";
    if (identityMatch === false) return "WRONG_TARGET";
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyVerdictCounts(): VerdictCounts {
  return { STABLE: 0, WRONG_TARGET: 0, AMBIGUOUS: 0, MISSING: 0 };
}

function bumpVerdict(counts: VerdictCounts, verdict: Verdict | null): void {
  if (verdict !== null) counts[verdict] += 1;
}

function formatScore(stable: number, completed: number): string {
  if (completed === 0) return "0";
  const raw = (stable * 100) / completed;
  let s = raw.toFixed(3);
  if (s.indexOf(".") >= 0) {
    s = s.replace(/0+$/, "");
    if (s.endsWith(".")) s = s.slice(0, -1);
  }
  return s;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

// ---------------------------------------------------------------------------
// Deterministic analysis
// ---------------------------------------------------------------------------

export async function runDeterministicAnalysis(): Promise<DeterministicResult> {
  const log = (msg: string): void => console.log(sanitize(msg, repoRoot));
  let failureType: string | null = null;
  const staticOfflineScanHits = { count: 0 };
  let externalRequests = 0;
  let blockedRequests = 0;
  let baselinePassed = 0;
  let chromiumVersion = "";


  // -------- a. Environment --------
  log("stage environment");
  {
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    if (!(nodeMajor >= 24)) {
      failureType = failureType ?? "ENVIRONMENT";
    }
    if (!existsSync(CHROMIUM_EXECUTABLE)) {
      failureType = failureType ?? "ENVIRONMENT";
    }
    let playwrightVersion = "";
    try {
      const pwPkg = readJson<{ version: string }>(
        join(repoRoot, "node_modules/playwright/package.json"),
      );
      playwrightVersion = pwPkg.version;
    } catch {
      playwrightVersion = "";
    }
    if (playwrightVersion !== EXPECTED_PLAYWRIGHT_VERSION) {
      failureType = failureType ?? "ENVIRONMENT";
    }
  }

  const manifests = loadAllFixtureManifests() as unknown as ManifestLike[];
  const manifestById = new Map<string, ManifestLike>();
  for (const m of manifests) manifestById.set(m.fixtureId, m);

  // -------- b. Fixtures validity --------
  log("stage fixtures");
  {
    let ok = true;
    if (manifests.length !== 24) ok = false;
    const kindCounts: Record<string, number> = { css: 0, xpath: 0, role: 0 };
    const controlCounts: Record<string, number> = { stable: 0, fragile: 0 };
    const familyCounts: Record<string, number> = {};
    for (const fam of FAMILIES) familyCounts[fam] = 0;
    for (const m of manifests) {
      const errs = validateFixtureManifest(m as unknown);
      if (!Array.isArray(errs) || errs.length !== 0) ok = false;
      if (typeof m.kind === "string") kindCounts[m.kind] = (kindCounts[m.kind] ?? 0) + 1;
      if (typeof m.controlGroup === "string")
        controlCounts[m.controlGroup] = (controlCounts[m.controlGroup] ?? 0) + 1;
      if (typeof m.family === "string")
        familyCounts[m.family] = (familyCounts[m.family] ?? 0) + 1;
      if (m.seed !== SEED) ok = false;
    }
    if (kindCounts.css !== 8 || kindCounts.xpath !== 8 || kindCounts.role !== 8) ok = false;
    if (controlCounts.stable !== 12 || controlCounts.fragile !== 12) ok = false;
    for (const fam of FAMILIES) {
      if (familyCounts[fam] !== 3) ok = false;
    }
    // golden
    let golden: { seed?: string; cases?: GoldenCase[] } = {};
    try {
      golden = readJson<{ seed?: string; cases?: GoldenCase[] }>(GOLDEN_PATH);
    } catch {
      ok = false;
    }
    const goldenCases = golden.cases ?? [];
    if (goldenCases.length !== 192) ok = false;
    if (golden.seed !== SEED) ok = false;
    const seen = new Set<string>();
    for (const gc of goldenCases) {
      const key = `${gc.fixtureId}/${gc.mutationId}`;
      if (seen.has(key)) ok = false;
      seen.add(key);
      if (!(VERDICT_STATES as readonly string[]).includes(gc.expectedVerdict)) ok = false;
    }
    if (!ok) failureType = failureType ?? "FIXTURES";
  }

  // -------- c. Static offline scan --------
  log("stage offline-scan");
  {
    const fixtures = FIXTURE_IDS.map((id) => loadFixture(id));
    for (const fx of fixtures) {
      const html = fx.html;
      const m1 = html.match(/https?:\/\//g);
      const m2 = html.match(/(src|href)\s*=\s*["']https?:/gi);
      staticOfflineScanHits.count += (m1 ? m1.length : 0) + (m2 ? m2.length : 0);
    }
    if (staticOfflineScanHits.count !== 0) failureType = failureType ?? "OFFLINE";
  }

  // Load golden & T002 outside browser.
  const golden = readJson<{ seed: string; cases: GoldenCase[] }>(GOLDEN_PATH);
  const goldenByKey = new Map<string, GoldenCase>();
  for (const gc of golden.cases) goldenByKey.set(`${gc.fixtureId}/${gc.mutationId}`, gc);

  const t002 = readJson<{ cases: T002Case[] }>(T002_PATH);
  const t002ByKey = new Map<string, T002Case>();
  for (const c of t002.cases) t002ByKey.set(`${c.fixtureId}/${c.mutationId}`, c);

  const fixtureHtmById = new Map<string, string>();
  const fixtures = FIXTURE_IDS.map((id) => loadFixture(id));
  for (const fx of fixtures) fixtureHtmById.set(fx.manifest.fixtureId, fx.html);

  const verdictCounts = emptyVerdictCounts();
  const verdictCountsByKind: Record<string, VerdictCounts> = {
    css: emptyVerdictCounts(),
    xpath: emptyVerdictCounts(),
    role: emptyVerdictCounts(),
  };
  const caseRecords: CaseRecord[] = [];

  const launcher = await launchBaselineBrowser({ executablePath: CHROMIUM_EXECUTABLE });
  try {
    const version = launcher.browser.version();
    chromiumVersion = version;
    if (version !== EXPECTED_CHROMIUM_VERSION) {
      failureType = failureType ?? "ENVIRONMENT";
    }


    const page: Page = launcher.page;

    // -------- d. Baseline --------
    log("stage baseline");
    for (const id of FIXTURE_IDS) {
      const fx = loadFixture(id);
      await setFixtureContent(page, fx);
      const original = await captureOriginalTargetForFixture(page, fx.manifest);
      const res = await resolveLocator(page, fx.manifest.locator);
      let pass = false;
      if (res.result.executionStatus === "COMPLETED" && res.result.finalMatchCount === 1) {
        const same = await isSameElement(page, res.finalHandle, original);
        pass = same === true;
      }
      if (pass) baselinePassed += 1;
    }
    log(`baseline ${baselinePassed}/24`);
    if (baselinePassed !== 24) failureType = failureType ?? "BASELINE";

    // -------- e. Mutations --------
    log("stage mutations");
    let casesCompleted = 0;
    for (const id of FIXTURE_IDS) {
      const fx = loadFixture(id);
      const locSpec = fx.manifest.locator;
      let done = 0;
      for (const mutationId of MUTATION_ORDER) {
        await setFixtureContent(page, fx);
        const original = await captureOriginalTargetForFixture(page, fx.manifest);
        const ctx = mutationContextForFixture(fx.manifest);
        const mutation = getMutation(mutationId);
        await mutation.apply(page, original, ctx);
        const res = await resolveLocator(page, locSpec);
        const execStatus = res.result.executionStatus;
        const frameKind = res.result.frameFailure ? res.result.frameFailure.kind : null;
        let identityMatch: boolean | null = null;
        if (
          execStatus === "COMPLETED" &&
          res.result.finalMatchCount === 1 &&
          res.finalHandle
        ) {
          const same = await isSameElement(page, res.finalHandle, original);
          identityMatch = same;
        }
        const verdict = deriveVerdict(
          execStatus,
          frameKind,
          res.result.finalMatchCount,
          identityMatch,
        );
        caseRecords.push({
          fixtureId: id,
          mutationId,
          verdict,
          finalMatchCount: res.result.finalMatchCount,
          identityMatch,
          executionStatus: execStatus,
          frameFailureKind: frameKind,
        });
        if (execStatus === "COMPLETED") casesCompleted += 1;
        done += 1;
      }
      log(`fixture ${id} ${done}/8 done`);
    }
    if (casesCompleted !== 192) failureType = failureType ?? "MUTATIONS";

    // Aggregate verdict counts by kind
    for (const cr of caseRecords) {
      bumpVerdict(verdictCounts, cr.verdict);
      const m = manifestById.get(cr.fixtureId);
      const kind = m ? m.kind : "css";
      const bucket = verdictCountsByKind[kind];
      if (bucket === undefined) {
        log(`unknown locator kind: ${kind} (fixture ${cr.fixtureId})`);
        throw new Error(`unknown locator kind: ${kind} (fixture ${cr.fixtureId})`);
      }
      bumpVerdict(bucket, cr.verdict);
    }


    // -------- f. Oracle parity --------
    log("stage oracle-parity");
    const oracleParity: OracleParity = {
      compared: 0,
      matched: 0,
      mismatched: 0,
      mismatches: [],
    };
    {
      // Validate snapshot
      let snapOk = true;
      if (t002.cases.length !== 192) snapOk = false;
      for (const sc of t002.cases) {
        const gc = goldenByKey.get(`${sc.fixtureId}/${sc.mutationId}`);
        if (!gc) {
          snapOk = false;
          continue;
        }
        if (sc.expectedVerdict !== gc.expectedVerdict) snapOk = false;
        if (sc.actualVerdict !== gc.expectedVerdict) snapOk = false;
      }
      if (!snapOk) failureType = failureType ?? "ORACLE_PARITY";

      for (const cr of caseRecords) {
        const key = `${cr.fixtureId}/${cr.mutationId}`;
        const gc = goldenByKey.get(key);
        const sc = t002ByKey.get(key);
        if (!gc || !sc) continue;
        const expectedVerdict = gc.expectedVerdict;
        const expectedExecutionStatus = "COMPLETED";
        const expectedIdentityMatch =
          expectedVerdict === "STABLE"
            ? true
            : expectedVerdict === "WRONG_TARGET"
              ? false
              : null;
        const expectedMatchCount = sc.finalMatchCount;

        const actual = {
          fixtureId: cr.fixtureId,
          mutationId: cr.mutationId,
          verdict: cr.verdict,
          matchCount: cr.finalMatchCount,
          identityMatch: cr.identityMatch,
          executionStatus: cr.executionStatus,
        };
        const expected = {
          fixtureId: cr.fixtureId,
          mutationId: cr.mutationId,
          verdict: expectedVerdict,
          matchCount: expectedMatchCount,
          identityMatch: expectedIdentityMatch,
          executionStatus: expectedExecutionStatus,
        };
        oracleParity.compared += 1;
        const fields: (keyof typeof actual)[] = [
          "fixtureId",
          "mutationId",
          "verdict",
          "matchCount",
          "identityMatch",
          "executionStatus",
        ];
        let caseMismatch = false;
        for (const field of fields) {
          const ev = expected[field];
          const av = actual[field];
          const eq = JSON.stringify(ev) === JSON.stringify(av);
          if (!eq) {
            caseMismatch = true;
            oracleParity.mismatches.push({
              fixtureId: cr.fixtureId,
              mutationId: cr.mutationId,
              field: String(field),
              expected: ev,
              actual: av,
            });
          }
        }
        if (caseMismatch) {
          oracleParity.mismatched += 1;
        } else {
          oracleParity.matched += 1;
        }
      }
      for (const mm of oracleParity.mismatches) {
        log(
          `oracle-parity mismatch ${mm.fixtureId}/${mm.mutationId} field=${mm.field} expected=${JSON.stringify(mm.expected)} actual=${JSON.stringify(mm.actual)}`,
        );
      }
      if (oracleParity.matched !== 192) failureType = failureType ?? "ORACLE_PARITY";
    }


    // -------- g. Controls --------
    log("stage controls");
    const controls: Controls = {
      stable: { pairs: 96, mismatches: 0 },
      fragile: { pairs: 96, mismatches: 0 },
    };
    {
      let stablePairs = 0;
      let fragilePairs = 0;
      let stableMismatches = 0;
      let fragileMismatches = 0;
      for (const cr of caseRecords) {
        const m = manifestById.get(cr.fixtureId);
        const gc = goldenByKey.get(`${cr.fixtureId}/${cr.mutationId}`);
        if (!m || !gc) continue;
        const matched = cr.verdict !== null && cr.verdict === gc.expectedVerdict;
        if (m.controlGroup === "stable") {
          stablePairs += 1;
          if (!matched) stableMismatches += 1;
        } else if (m.controlGroup === "fragile") {
          fragilePairs += 1;
          if (!matched) fragileMismatches += 1;
        }
      }
      controls.stable.pairs = stablePairs;
      controls.stable.mismatches = stableMismatches;
      controls.fragile.pairs = fragilePairs;
      controls.fragile.mismatches = fragileMismatches;

      const pairsOk = stablePairs === 96 && fragilePairs === 96;
      const stableOk = stableMismatches <= THRESHOLDS.stableFalseAlarmMaxNumerator;
      const fragileOk = fragileMismatches === 0;
      if (!stableOk || !fragileOk || !pairsOk) failureType = failureType ?? "CONTROLS";

    }

    // -------- h. Coverage --------
    log("stage coverage");
    const coverage: Coverage = {
      cssFixtures: 0,
      xpathFixtures: 0,
      roleFixtures: 0,
      framePathFixtures: 0,
      framePathCases: 0,
      indexFixtures: 0,
      indexCases: 0,
      twoLayerFramePathFixtures: 0,
    };
    {
      for (const m of manifests) {
        if (m.kind === "css") coverage.cssFixtures += 1;
        if (m.kind === "xpath") coverage.xpathFixtures += 1;
        if (m.kind === "role") coverage.roleFixtures += 1;
        const frameLayers = countFrameLayers(m.locator);
        if (frameLayers > 0) {
          coverage.framePathFixtures += 1;
          if (frameLayers >= 2) coverage.twoLayerFramePathFixtures += 1;
        }
        // NOTE: normalizeLocatorSpec always emits "index": null, so a
        // substring test on the normalized JSON would match every fixture.
        // An index fixture is one whose raw manifest locator sets index.
        if (m.locator.index !== null && m.locator.index !== undefined) {
          coverage.indexFixtures += 1;
        }
      }
      for (const cr of caseRecords) {
        const m = manifestById.get(cr.fixtureId);
        if (!m) continue;
        const frameLayers = countFrameLayers(m.locator);
        if (frameLayers > 0) coverage.framePathCases += 1;
        if (m.locator.index !== null && m.locator.index !== undefined) {
          coverage.indexCases += 1;
        }
      }
      const anyBelow = VERDICT_STATES.some((s) => verdictCounts[s] < THRESHOLDS.fourStateMin);
      if (anyBelow) failureType = failureType ?? "COVERAGE";
    }

    // -------- i. Stability score --------
    log("stage stability");
    const completedCount = caseRecords.filter((c) => c.executionStatus === "COMPLETED").length;
    const stableCount = verdictCounts.STABLE;
    const stabilityScore: StabilityScore = {
      stable: stableCount,
      completed: completedCount,
      score: formatScore(stableCount, completedCount),
    };
    const analysisStatus: "COMPLETE" | "INCOMPLETE" =
      completedCount === 192 ? "COMPLETE" : "INCOMPLETE";

    // -------- j. Offline runtime --------
    log("stage offline-runtime");
    externalRequests = launcher.externalRequestCount();
    blockedRequests = launcher.blockedRequestCount();
    if (
      externalRequests !== THRESHOLDS.externalRequestsMax ||
      blockedRequests !== THRESHOLDS.externalRequestsMax
    ) {
      failureType = failureType ?? "OFFLINE";
    }

    // -------- k. Hashes --------
    log("stage hashes");
    const scenarioFixtures = manifests
      .map((m) => ({
        fixtureId: m.fixtureId,
        family: m.family,
        kind: m.kind,
        controlGroup: m.controlGroup,
        locator: normalizeLocatorSpec(m.locator),
        html: fixtureHtmById.get(m.fixtureId) ?? "",
      }))
      .sort((a, b) => compareCodePoints(a.fixtureId, b.fixtureId));
    const scenarioCanonical = {
      schema: "locatorstress.scenario-canonical/v1",
      seed: SEED,
      bfs: { max_depth: 6, max_expanded_states: 4096 },
      mutationSuite: MUTATION_SUITE,
      fixtures: scenarioFixtures,
    };
    const scenario_sha256 = sha256Hex(canonicalJson(scenarioCanonical));

    const oracleCases = caseRecords
      .map((c) => ({
        fixtureId: c.fixtureId,
        mutationId: c.mutationId,
        verdict: c.verdict,
        matchCount: c.finalMatchCount,
        identityMatch: c.identityMatch,
        executionStatus: c.executionStatus,
      }))
      .sort((a, b) => {
        const c = compareCodePoints(a.fixtureId, b.fixtureId);
        if (c !== 0) return c;
        return compareCodePoints(a.mutationId, b.mutationId);
      });
    const oracleCanonical = {
      schema: "locatorstress.oracle-canonical/v1",
      seed: SEED,
      cases: oracleCases,
    };
    const oracle_result_sha256 = sha256Hex(canonicalJson(oracleCanonical));

    const analysisCanonical = {
      schema: "locatorstress.analysis-canonical/v1",
      seed: SEED,
      verdictCounts,
      verdictCountsByKind,
      stabilityScore: {
        stable: stabilityScore.stable,
        completed: stabilityScore.completed,
        score: stabilityScore.score,
      },
      coverage,
      controls: {
        stable: { pairs: controls.stable.pairs, mismatches: controls.stable.mismatches },
        fragile: { pairs: controls.fragile.pairs, mismatches: controls.fragile.mismatches },
      },
      analysisStatus,
      bfs: { status: "NOT_IMPLEMENTED_S0", witness: null },
      oracleParity: {
        compared: oracleParity.compared,
        matched: oracleParity.matched,
        mismatched: oracleParity.mismatched,
      },
    };
    const analysis_sha256 = sha256Hex(canonicalJson(analysisCanonical));

    const passed = failureType === null;

    const counts = buildCounts({
      fixtures: FIXTURE_IDS.length,
      stableFixtures: manifests.filter((m) => m.controlGroup === "stable").length,
      fragileFixtures: manifests.filter((m) => m.controlGroup === "fragile").length,
      baselinePassed,
      casesCompleted,
      casesTotal: 192,
      verdictCounts,
      verdictCountsByKind,
      controls,
      oracleParity,
      stabilityScore,
      coverage,
      externalRequests,
      blockedRequests,
      staticOfflineScanHits: staticOfflineScanHits.count,
    });

    return {
      passed,
      failureType,
      chromiumVersion,
      counts,

      hashes: { scenario_sha256, oracle_result_sha256, analysis_sha256 },
      verdictCounts,
      verdictCountsByKind,
      coverage,
      controls,
      oracleParity,
      stabilityScore,
      analysisStatus,
      externalRequests,
      blockedRequests,
      staticOfflineScanHits: staticOfflineScanHits.count,
      baselinePassed,
    };
  } finally {
    await launcher.close();
  }
}

function countFrameLayers(locator: unknown): number {
  const spec = normalizeLocatorSpec(locator) as Record<string, unknown> | null;
  if (!spec) return 0;
  const framePath = spec.framePath;
  if (Array.isArray(framePath)) return framePath.length;
  return 0;
}

interface BuildCountsInput {
  fixtures: number;
  stableFixtures: number;
  fragileFixtures: number;
  baselinePassed: number;
  casesCompleted: number;
  casesTotal: number;
  verdictCounts: VerdictCounts;
  verdictCountsByKind: Record<string, VerdictCounts>;
  controls: Controls;
  oracleParity: OracleParity;
  stabilityScore: StabilityScore;
  coverage: Coverage;
  externalRequests: number;
  blockedRequests: number;
  staticOfflineScanHits: number;
}

function buildCounts(input: BuildCountsInput): Record<string, unknown> {
  const {
    fixtures,
    stableFixtures,
    fragileFixtures,
    baselinePassed,
    casesCompleted,
    casesTotal,
    verdictCounts,
    verdictCountsByKind,
    controls,
    oracleParity,
    stabilityScore,
    coverage,
    externalRequests,
    blockedRequests,
    staticOfflineScanHits,
  } = input;
  return {
    fixtures,
    baselinePassed,
    casesCompleted,
    casesTotal,
    verdictCounts,
    verdictCountsByKind,
    stableControl: {
      fixtures: stableFixtures,
      pairs: controls.stable.pairs,
      mismatches: controls.stable.mismatches,
      falseAlarm: `${controls.stable.mismatches}/${controls.stable.pairs}`,
    },
    fragileControl: {
      fixtures: fragileFixtures,
      pairs: controls.fragile.pairs,
      mismatches: controls.fragile.mismatches,
      detected: controls.fragile.pairs - controls.fragile.mismatches,
    },
    oracleParity: {
      compared: oracleParity.compared,
      matched: oracleParity.matched,
      mismatched: oracleParity.mismatched,
    },
    stabilityScore: {
      stable: stabilityScore.stable,
      completed: stabilityScore.completed,
      score: stabilityScore.score,
    },
    coverage,
    externalRequests,
    blockedRequests,
    staticOfflineScanHits,
  };
}

// ---------------------------------------------------------------------------
// Gate canonical + hashing
// ---------------------------------------------------------------------------

interface GateEnvironment {
  node: string;
  playwright: string;
  chromium: string;
}

function readVersions(measuredChromium: string): GateEnvironment {
  let playwright = "";
  try {
    const pwPkg = readJson<{ version: string }>(
      join(repoRoot, "node_modules/playwright/package.json"),
    );
    playwright = pwPkg.version;
  } catch {
    playwright = "";
  }
  return {
    node: process.version,
    playwright,
    chromium: measuredChromium,
  };
}


interface BuildGateCanonicalInput {
  result: "PASS" | "FAIL";
  failureType: string | null;
  counts: unknown;
  hashes: {
    scenario_sha256: string;
    oracle_result_sha256: string;
    analysis_sha256: string;
  };
}

function buildGateCanonicalObject(input: BuildGateCanonicalInput): Record<string, unknown> {
  return {
    schema: "locatorstress.s0-gate/v1",
    seed: SEED,
    result: input.result,
    failureType: input.failureType,
    thresholds: THRESHOLDS,
    counts: input.counts,
    hashes: input.hashes,
    notes: NOTES,
  };
}


// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

interface ReplayResult {
  runs: number;
  uniqueGateHashes: number;
  gate_sha256: string;
  matchesMainGateHash: boolean;
}

interface P2aResult {
  ran: boolean;
  status: "PASS" | "FAIL";
  exitCode: number | null;
}

const DETERMINISTIC_FAILURE_ORDER = [
  "ENVIRONMENT",
  "FIXTURES",
  "BASELINE",
  "MUTATIONS",
  "ORACLE_PARITY",
  "CONTROLS",
  "COVERAGE",
  "OFFLINE",
] as const;

async function runSingleAnalysis(outPath: string): Promise<number> {
  const det = await runDeterministicAnalysis();
  const result: "PASS" | "FAIL" = det.passed ? "PASS" : "FAIL";
  const canonical = buildGateCanonicalObject({
    result,
    failureType: det.failureType,
    counts: det.counts,
    hashes: det.hashes,
  });

  const gate_sha256 = sha256Hex(canonicalJson(canonical));
  const record = {
    schema: "locatorstress.s0-single-analysis/v1",
    seed: SEED,
    gate_sha256,
    scenario_sha256: det.hashes.scenario_sha256,
    oracle_result_sha256: det.hashes.oracle_result_sha256,
    analysis_sha256: det.hashes.analysis_sha256,
    passed: det.passed,
    failureType: det.failureType,
    counts: det.counts,
    verdictCounts: det.verdictCounts,
    externalRequests: det.externalRequests,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, canonicalJson(record) + "\n", "utf8");
  console.log(
    `SINGLE_ANALYSIS gate_sha256=${gate_sha256} external_requests=${det.externalRequests} passed=${det.passed ? "true" : "false"}`,
  );
  return det.passed ? 0 : 1;
}

function runP2a(): P2aResult {
  mkdirSync(S0_GATE_DIR, { recursive: true });
  const proc = spawnSync(
    "npx",
    ["vitest", "run", "tests/integration/p2a-detach-regression.test.ts"],
    {
      cwd: repoRoot,
      timeout: 300000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const out = `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
  writeFileSync(S0_P2A_LOG, sanitize(out, repoRoot), "utf8");
  const exitCode = proc.status;
  const status: "PASS" | "FAIL" = exitCode === 0 ? "PASS" : "FAIL";
  return { ran: true, status, exitCode };
}

function runReplay(): Promise<ReplayResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["scripts/repeat-hash.ts"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      stdout += s;
      for (const line of s.split("\n")) {
        if (line.length > 0) console.log(line);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      stderr += s;
      for (const line of s.split("\n")) {
        if (line.length > 0) console.error(line);
      }
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`repeat-hash exited with code ${code}`));
        return;
      }
      const lines = `${stdout}\n${stderr}`.split("\n");
      let last: string | null = null;
      for (const line of lines) {
        if (line.startsWith("REPEAT_HASH ")) last = line;
      }
      if (!last) {
        reject(new Error("repeat-hash produced no REPEAT_HASH line"));
        return;
      }
      const uniqueMatch = last.match(/unique_gate_hashes=(\d+)/);
      const hashMatch = last.match(/gate_sha256=([0-9a-f]+)/);
      if (!uniqueMatch || !hashMatch) {
        reject(new Error("could not parse REPEAT_HASH line"));
        return;
      }
      resolve({
        runs: THRESHOLDS.replayRuns,
        uniqueGateHashes: Number(uniqueMatch[1]),
        gate_sha256: hashMatch[1],
        matchesMainGateHash: false,
      });
    });
  });
}

function pickDeterministicFailure(failureType: string | null): string | null {
  if (failureType === null) return null;
  if ((DETERMINISTIC_FAILURE_ORDER as readonly string[]).includes(failureType)) {
    return failureType;
  }
  return failureType;
}

interface GateReport {
  schema: string;
  seed: string;
  result: "PASS" | "FAIL";
  failureType: string | null;
  thresholds: typeof THRESHOLDS;
  counts: unknown;
  hashes: {
    scenario_sha256: string;
    oracle_result_sha256: string;
    analysis_sha256: string;
    gate_sha256: string;
  };
  replay: ReplayResult;
  p2a: P2aResult;
  notes: string[];
  environment?: GateEnvironment;
}


async function runMainGate(): Promise<number> {
  // Remove stale files FIRST.
  try {
    rmSync(S0_GATE_JSON, { force: true });
  } catch {
    // ignore
  }
  try {
    rmSync(S0_GATE_LOG, { force: true });
  } catch {
    // ignore
  }
  mkdirSync(S0_GATE_DIR, { recursive: true });

  const collected: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map((a) => String(a)).join(" ");
    collected.push(line);
    originalLog(line);
  };

  try {
    let det: DeterministicResult;
    try {
      det = await runDeterministicAnalysis();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const minimal: GateReport = {
        schema: "locatorstress.s0-gate/v1",
        seed: SEED,
        result: "FAIL",
        failureType: "GATE_ERROR",
        thresholds: THRESHOLDS,
        counts: null,
        hashes: {
          scenario_sha256: "",
          oracle_result_sha256: "",
          analysis_sha256: "",
          gate_sha256: "",
        },
        replay: {
          runs: THRESHOLDS.replayRuns,
          uniqueGateHashes: 0,
          gate_sha256: "",
          matchesMainGateHash: false,
        },
        p2a: { ran: false, status: "FAIL", exitCode: null },
        notes: NOTES,
      };
      writeFileSync(S0_GATE_JSON, canonicalJson(minimal) + "\n", "utf8");
      console.log(`GATE FAIL failure_type=GATE_ERROR gate_sha256=`);
      const logContent = collected.map((l) => sanitize(l, repoRoot)).join("\n") + "\n";
      writeFileSync(S0_GATE_LOG, logContent, "utf8");
      console.error(sanitize(`Unexpected exception: ${msg}`, repoRoot));
      return 1;

    }

    const environment = readVersions(det.chromiumVersion);

    // P2-A

    let p2a: P2aResult;
    try {
      p2a = runP2a();
    } catch {
      p2a = { ran: true, status: "FAIL", exitCode: null };
    }
    console.log(`P2A status=${p2a.status} exit=${p2a.exitCode === null ? "null" : p2a.exitCode}`);

    // Replay
    let replay: ReplayResult;
    try {
      replay = await runReplay();
    } catch {
      replay = {
        runs: THRESHOLDS.replayRuns,
        uniqueGateHashes: 0,
        gate_sha256: "",
        matchesMainGateHash: false,
      };
    }

    // Provisional gate hash with deterministic result.
    const provisionalResult: "PASS" | "FAIL" = det.passed ? "PASS" : "FAIL";
    const provisionalCanonical = buildGateCanonicalObject({
      result: provisionalResult,
      failureType: det.failureType,
      counts: det.counts,
      hashes: det.hashes,
    });

    const provisionalGateHash = sha256Hex(canonicalJson(provisionalCanonical));

    const detFailed = !det.passed;
    const p2aFailed = p2a.exitCode !== 0;
    const replayUniqueOk = replay.uniqueGateHashes === THRESHOLDS.uniqueGateHashesRequired;
    const replayHashMatches = replay.gate_sha256 === provisionalGateHash;

    let overallPass = !detFailed && !p2aFailed && replayUniqueOk;
    // Note: replayHashMatches influences matchesMainGateHash but not the pass decision
    // by itself when replay already matches the provisional gate hash; we require both
    // unique hash and equality for the replay stage to be considered passing.
    if (!replayHashMatches) overallPass = false;

    let finalFailureType: string | null;
    if (detFailed) {
      finalFailureType = pickDeterministicFailure(det.failureType);
      if (finalFailureType === null) finalFailureType = "ENVIRONMENT";
    } else if (p2aFailed) {
      finalFailureType = "P2A_REGRESSION";
    } else if (!replayUniqueOk || !replayHashMatches) {
      finalFailureType = "HASH_REPLAY";
    } else {
      finalFailureType = null;
    }

    const finalResult: "PASS" | "FAIL" = overallPass && finalFailureType === null ? "PASS" : "FAIL";

    const finalCanonical = buildGateCanonicalObject({
      result: finalResult,
      failureType: finalFailureType,
      counts: det.counts,
      hashes: det.hashes,
    });

    const finalGateHash = sha256Hex(canonicalJson(finalCanonical));

    const replayWithMatch: ReplayResult = {
      ...replay,
      matchesMainGateHash: replay.gate_sha256 === finalGateHash,
    };

    const report: GateReport = {
      schema: "locatorstress.s0-gate/v1",
      seed: SEED,
      result: finalResult,
      failureType: finalFailureType,
      thresholds: THRESHOLDS,
      counts: det.counts,
      hashes: {
        scenario_sha256: det.hashes.scenario_sha256,
        oracle_result_sha256: det.hashes.oracle_result_sha256,
        analysis_sha256: det.hashes.analysis_sha256,
        gate_sha256: finalGateHash,
      },
      replay: replayWithMatch,
      p2a,
      notes: NOTES,
      environment,
    };


    writeFileSync(S0_GATE_JSON, canonicalJson(report) + "\n", "utf8");

    console.log(
      `GATE ${finalResult} failure_type=${finalFailureType === null ? "null" : finalFailureType} gate_sha256=${finalGateHash}`,
    );

    const logContent = collected.map((l) => sanitize(l, repoRoot)).join("\n") + "\n";
    writeFileSync(S0_GATE_LOG, logContent, "utf8");

    return finalResult === "PASS" ? 0 : 1;
  } finally {
    console.log = originalLog;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log("Usage:");
  console.log("  node scripts/s0-gate.ts");
  console.log("    Run the full S0 gate: deterministic analysis, P2-A regression, hash replay.");
  console.log("  node scripts/s0-gate.ts --single-analysis --out <path>");
  console.log("    Run one deterministic analysis and write a single-analysis JSON to <path>.");
  console.log("  node scripts/s0-gate.ts --help");
  console.log("    Print this help.");
}

function isMain(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return argv1.endsWith("s0-gate.ts");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  // Recompute cleanly: parse --out <path>.

  const outIdx = args.indexOf("--out");
  let outPath: string | null = null;
  if (outIdx >= 0) {
    if (outIdx + 1 >= args.length) {
      console.error("--out requires a path");
      process.exit(2);
    }
    outPath = args[outIdx + 1];
  }
  const single = args.includes("--single-analysis");

  // Validate remaining args.
  const allowed = new Set<string>();
  if (single) allowed.add("--single-analysis");
  if (outPath !== null) {
    allowed.add("--out");
    allowed.add(outPath);
  }
  for (const a of args) {
    if (!allowed.has(a)) {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (single) {

    if (outPath === null) {
      console.error("--single-analysis requires --out <path>");
      process.exit(2);
    }
    const code = await runSingleAnalysis(outPath);
    process.exit(code);
  }

  if (outPath !== null) {
    console.error("--out is only valid with --single-analysis");
    process.exit(2);
  }

  const code = await runMainGate();
  process.exit(code);
}

if (isMain()) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(sanitize(`Fatal: ${msg}`, repoRoot));
    process.exit(1);
  });
}


