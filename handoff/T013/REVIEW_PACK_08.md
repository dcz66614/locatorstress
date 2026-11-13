# REVIEW_PACK_08 — 构建与门禁脚本：S0 gate、Hash 重放、Oracle 基线、T008 报告、T011 变异运行器

审查 commit：`a78d765`。本包为审查时原文逐字拼接（机械拼接，内容未经改写），每个文件附行数、字节数与 SHA-256；审查结论见 `INDEPENDENT_REVIEW.md`。

## scripts/s0-gate.ts

- 行数：1348；字节数：41677；SHA-256：`dfe87bcf1351e339391d064b6255d424281cf4740e9fe2c4910b02b08dd470c9`

```ts
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
```

## scripts/repeat-hash.ts

- 行数：371；字节数：9976；SHA-256：`6e2a6cd10317a01f9b10091dd2335edff394737b74f82f79678cb89e7c0364e3`

```ts
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const SEED = "P022-LOCATORSTRESS-S0-2026-11-10";
const RUNS = 100;
const PER_RUN_TIMEOUT_MS = 600000;

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = dirname(__filename);
const repoRoot = dirname(scriptsDir);
const evidenceDir = join(repoRoot, "evidence", "s0");

function canonicalJson(value: unknown): string {
  return serialize(value);
}

function compareCodePoints(a: string, b: string): number {
  const ca = Array.from(a);
  const cb = Array.from(b);
  const len = Math.min(ca.length, cb.length);
  for (let i = 0; i < len; i++) {
    const pa = ca[i].codePointAt(0)!;
    const pb = cb[i].codePointAt(0)!;
    if (pa !== pb) return pa < pb ? -1 : 1;
  }
  if (ca.length !== cb.length) return ca.length < cb.length ? -1 : 1;
  return 0;
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number in canonical JSON");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (Array.isArray(value)) {
    return "[" + value.map(serialize).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(compareCodePoints);
    const parts: string[] = [];
    for (const k of keys) {
      parts.push(JSON.stringify(k.normalize("NFC")) + ":" + serialize(obj[k]));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new Error("unsupported value in canonical JSON");
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

interface RunOutJson {
  passed?: unknown;
  gate_sha256?: unknown;
  externalRequests?: unknown;
}

interface Failure {
  run: number;
  reason: string;
}

interface Evidence {
  schema: string;
  seed: string;
  runs: number;
  completed: number;
  uniqueGateHashes: number;
  gate_sha256: string;
  hashes: string[];
  passed: boolean;
  failures: Failure[];
}

const HEX64 = /^[0-9a-f]{64}$/;

function sanitize(text: string): string {
  let out = text;
  const roots = [repoRoot, tmpdir()];
  for (const r of roots) {
    if (r.length > 0) {
      out = out.split(r).join("<path>");
    }
  }
  return out;
}

class OutputCollector {
  lines: string[] = [];
  print(line: string): void {
    const clean = sanitize(line);
    this.lines.push(clean);
    process.stdout.write(clean + "\n");
  }
}

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runChild(args: string[]): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (!settled) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }, PER_RUN_TIMEOUT_MS);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, timedOut });
    });
    child.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function lastLineStartingWith(text: string, prefix: string): string | null {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith(prefix)) return lines[i];
  }
  return null;
}

function parseKey(hexLine: string, key: string): string | null {
  const m = new RegExp(key + "=([^\\s]+)").exec(hexLine);
  return m ? m[1] : null;
}

function writeEvidence(evidence: Evidence): void {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, "S0_REPEAT_HASH.json"), canonicalJson(evidence) + "\n", "utf8");
}

function writeLog(lines: string[]): void {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, "S0_REPEAT_HASH.log"), lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf8");
}

function usage(): string {
  return [
    "Usage: node scripts/repeat-hash.ts",
    "",
    "Runs the S0 single-analysis 100 times serially and verifies that the",
    "gate_sha256 is identical across every run.",
    "",
    "No arguments accepted. --help prints this message.",
  ].join("\n");
}

async function main(): Promise<number> {
  const out = new OutputCollector();
  const hashes: string[] = [];
  const failures: Failure[] = [];
  const seen = new Set<string>();
  let firstHash = "";
  let completed = 0;

  let tempDir: string | null = null;
  let passed = false;

  try {
    tempDir = mkdtempSync(join(tmpdir(), "p022-repeat-"));

    for (let i = 1; i <= RUNS; i++) {
      const runNum = i;
      const outPath = join(tempDir, "run-" + pad3(runNum) + ".json");

      const res = await runChild([
        join("scripts", "s0-gate.ts"),
        "--single-analysis",
        "--out",
        outPath,
      ]);

      const fail = (reason: string): number => {
        const cleanReason = sanitize(reason);
        failures.push({ run: runNum, reason: cleanReason });
        out.print(`REPEAT_HASH FAILED run=${runNum} reason=${cleanReason}`);
        const evidence: Evidence = {
          schema: "locatorstress.s0-repeat-hash/v1",
          seed: SEED,
          runs: RUNS,
          completed,
          uniqueGateHashes: seen.size,
          gate_sha256: seen.size === 1 && firstHash !== "" ? firstHash : "",
          hashes,
          passed: false,
          failures,
        };
        writeEvidence(evidence);
        writeLog(out.lines);
        return 1;
      };

      if (res.timedOut) {
        return fail("timeout");
      }
      if (res.code !== 0) {
        return fail("exit code " + String(res.code));
      }

      let parsed: RunOutJson;
      if (!existsSync(outPath)) {
        return fail("out json missing");
      }
      try {
        const raw = readFileSync(outPath, "utf8");
        parsed = JSON.parse(raw) as RunOutJson;
      } catch {
        return fail("out json unparseable");
      }

      if (parsed.passed !== true) {
        return fail("json passed !== true");
      }
      const gate = parsed.gate_sha256;
      if (typeof gate !== "string" || !HEX64.test(gate)) {
        return fail("invalid gate_sha256");
      }
      if (parsed.externalRequests !== 0) {
        return fail("externalRequests !== 0");
      }

      const line = lastLineStartingWith(res.stdout, "SINGLE_ANALYSIS ");
      if (line === null) {
        return fail("missing SINGLE_ANALYSIS line");
      }
      const lineHash = parseKey(line, "gate_sha256");
      if (lineHash === null) {
        return fail("missing gate_sha256 in stdout");
      }
      if (lineHash !== gate) {
        return fail("stdout gate_sha256 mismatch");
      }

      hashes.push(gate);
      seen.add(gate);
      if (firstHash === "") firstHash = gate;
      completed = runNum;

      if (completed % 10 === 0) {
        out.print(
          `REPEAT_HASH progress runs=${completed}/100 unique_gate_hashes=${seen.size} gate_sha256=${firstHash}`,
        );
      }
    }

    const uniqueGateHashes = seen.size;
    passed = completed === RUNS && uniqueGateHashes === 1;

    const evidence: Evidence = {
      schema: "locatorstress.s0-repeat-hash/v1",
      seed: SEED,
      runs: RUNS,
      completed,
      uniqueGateHashes,
      gate_sha256: passed ? firstHash : "",
      hashes,
      passed,
      failures,
    };
    writeEvidence(evidence);
    writeLog(out.lines);

    if (passed) {
      out.print(`REPEAT_HASH unique_gate_hashes=1 gate_sha256=${firstHash}`);
      writeLog(out.lines);
      return 0;
    }
    out.print(
      `REPEAT_HASH FAILED reason=unique_gate_hashes_${uniqueGateHashes}_completed_${completed}`,
    );
    writeLog(out.lines);
    return 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    failures.push({ run: completed + 1, reason: sanitize(msg) });
    out.print(`REPEAT_HASH FAILED run=${completed + 1} reason=${sanitize(msg)}`);
    const evidence: Evidence = {
      schema: "locatorstress.s0-repeat-hash/v1",
      seed: SEED,
      runs: RUNS,
      completed,
      uniqueGateHashes: seen.size,
      gate_sha256: "",
      hashes,
      passed: false,
      failures,
    };
    try {
      writeEvidence(evidence);
      writeLog(out.lines);
    } catch {
      // ignore write errors in error path
    }
    return 1;
  } finally {
    if (tempDir !== null) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

function isMain(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return argv1.replace(/\\/g, "/").endsWith("repeat-hash.ts");
}

if (isMain()) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(usage() + "\n");
    process.exit(0);
  }
  if (args.length !== 0) {
    process.stderr.write("repeat-hash: unexpected arguments\n" + usage() + "\n");
    process.exit(2);
  }
  main().then(
    (code) => {
      process.exit(code);
    },
    () => {
      process.exit(1);
    },
  );
}
```

## scripts/s0-locator-oracle.mjs

- 行数：356；字节数：11008；SHA-256：`78dc12938634cae39549e717737b7b82efdb7482317ae112e3cc618008557755`

```js
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { launchBaselineBrowser } from "../dist/runner/browser.js";
import { runBaselineOracle } from "../dist/oracle/oracle-runner.js";
import {
  probeHandleWrapperIdentity,
  isSameElement,
} from "../dist/oracle/identity-compare.js";
import { captureOriginalTargetFromLocator } from "../dist/oracle/target-capture.js";
import { resolveLocator } from "../dist/runner/locator-resolver.js";

const SEED = "P022-LOCATORSTRESS-S0-2026-11-10";

const EXPECTED_CHROMIUM_VERSION = "158.0.8127.18";

const HTML =
  '<main><h1>LocatorStress baseline</h1><button class="primary">Save</button><button class="secondary">Cancel</button></main>';

const PROBE_HTML = '<main></main>';

const FRAME_HTML =
  "<main><iframe srcdoc=\"<button class='primary'>InFrame</button><button class='decoy'>Decoy</button>\"></iframe></main>";

const SPEC = { kind: "css", selector: "button.primary" };
const PRIVATE_TARGET_PATH = "main > button:nth-child(2)";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);
const evidenceDir = join(repoRoot, "evidence", "environment");
const evidenceJsonPath = join(evidenceDir, "T001_BASELINE.json");
const evidenceLogPath = join(evidenceDir, "T001_BASELINE.log");

function resolveExecutablePath() {
  const home = process.env.HOME;
  if (!home) {
    throw new Error(
      "HOME is not set; cannot locate chromium-1254 (no fallback to another revision is allowed)",
    );
  }
  const candidate = join(
    home,
    ".cache/ms-playwright/chromium-1254/chrome-linux64/chrome",
  );
  if (!existsSync(candidate)) {
    throw new Error(
      `chromium-1254 not found at ${candidate}; no fallback to another revision is allowed`,
    );
  }
  return candidate;
}

function readPlaywrightVersion() {
  try {
    const pkgPath = join(repoRoot, "node_modules/playwright/package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.version === "string") return parsed.version;
    return "unknown";
  } catch {
    return "unknown";
  }
}

function writeStaleEvidence(lines, errorMessage) {
  mkdirSync(evidenceDir, { recursive: true });
  const record = {
    schema: "locatorstress.t001-baseline/v1",
    seed: SEED,
    status: "STALE",
    error: errorMessage,
    note: "previous evidence removed; this run failed before producing fresh evidence",
  };
  writeFileSync(evidenceJsonPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  writeFileSync(
    evidenceLogPath,
    lines.join("\n") +
      "\n" +
      "STALE: run failed, no fresh evidence produced\n",
    "utf8",
  );
}

async function main() {
  const lines = [];
  const log = (line) => {
    lines.push(line);
    console.log(line);
  };

  let evidenceWritten = false;

  const htmlBytes = Buffer.byteLength(HTML, "utf8");

  let browserHandle = null;
  let playwrightVersion = readPlaywrightVersion();
  let chromiumVersion = "unknown";

  let rawMatchCount = 0;
  let finalMatchCount = 0;
  let executionStatus = "UNKNOWN";
  let identityMatch = null;
  let firstRun = null;

  let probe = { nodeIdentity: false, wrapperIdentity: false };
  let secondRun = null;
  let externalRequests = 0;
  let blockedRequests = 0;

  let offlineProbe = {
    attempts: 2,
    externalRequests: 0,
    blockedRequests: 0,
    passed: false,
  };

  let frameIdentityProbe = {
    sameTarget: false,
    decoy: false,
    passed: false,
  };

  let checks = {
    uniqueHit: false,
    identityReproducible: false,
    offlineProbePassed: false,
  };

  // Remove stale evidence up front so a failed run can never leave old files.
  rmSync(evidenceJsonPath, { force: true });
  rmSync(evidenceLogPath, { force: true });
  log("stale evidence removed (T001_BASELINE.json, T001_BASELINE.log)");

  try {
    const executablePath = resolveExecutablePath();

    browserHandle = await launchBaselineBrowser({ executablePath });
    const { browser, page } = browserHandle;

    try {
      chromiumVersion = browser.version();
    } catch {
      chromiumVersion = "unknown";
    }

    if (chromiumVersion !== EXPECTED_CHROMIUM_VERSION) {
      throw new Error(
        `unexpected chromium version: ${chromiumVersion} (expected ${EXPECTED_CHROMIUM_VERSION})`,
      );
    }

    // Offline negative probe: must run BEFORE the baseline setContent.
    // Both the image load and the fetch attempt to reach example.invalid and
    // must be intercepted; failures are caught inside the probe and can never
    // crash the run.
    await page.setContent(PROBE_HTML);
    await page.evaluate(async () => {
      const img = new Image();
      const imgPromise = new Promise((resolve) => {
        img.addEventListener("load", () => resolve("load"));
        img.addEventListener("error", () => resolve("error"));
      });
      img.src = "https://example.invalid/x.png";
      document.body.appendChild(img);
      const fetchPromise = (async () => {
        try {
          await fetch("https://example.invalid/");
          return "fetch-ok";
        } catch {
          return "fetch-error";
        }
      })();
      const timeout = new Promise((resolve) => {
        setTimeout(() => resolve("timeout"), 5000);
      });
      await Promise.race([
        Promise.allSettled([imgPromise, fetchPromise]),
        timeout,
      ]);
    });

    externalRequests = browserHandle.externalRequestCount();
    blockedRequests = browserHandle.blockedRequestCount();
    offlineProbe = {
      attempts: 2,
      externalRequests,
      blockedRequests,
      passed: externalRequests === 2 && blockedRequests === 2,
    };
    log(
      `offline probe attempts=${offlineProbe.attempts} externalRequests=${offlineProbe.externalRequests} blockedRequests=${offlineProbe.blockedRequests} passed=${String(
        offlineProbe.passed,
      )}`,
    );

    await page.setContent(HTML);
    const rawLocator = page.locator(SPEC.selector);
    rawMatchCount = await rawLocator.count();

    firstRun = await runBaselineOracle(page, SPEC, PRIVATE_TARGET_PATH);
    finalMatchCount = firstRun.resolverResult.finalMatchCount;
    executionStatus = firstRun.resolverResult.executionStatus;
    identityMatch = firstRun.identityMatch;

    log(
      `baseline rawMatchCount=${rawMatchCount} finalMatchCount=${finalMatchCount} executionStatus=${executionStatus} identityMatch=${String(
        identityMatch,
      )}`,
    );

    probe = await probeHandleWrapperIdentity(
      page,
      page.locator(PRIVATE_TARGET_PATH),
    );
    log(
      `identity probe nodeIdentity=${String(probe.nodeIdentity)} wrapperIdentity=${String(
        probe.wrapperIdentity,
      )}`,
    );

    await page.setContent(HTML);
    secondRun = await runBaselineOracle(page, SPEC, PRIVATE_TARGET_PATH);
    log(
      `second run rawMatchCount=${secondRun.resolverResult.rawMatchCount} finalMatchCount=${secondRun.resolverResult.finalMatchCount} executionStatus=${secondRun.resolverResult.executionStatus} identityMatch=${String(
        secondRun.identityMatch,
      )}`,
    );

    // Frame identity probe: inline HTML only, no fixture file.
    await page.setContent(FRAME_HTML);
    const original = await captureOriginalTargetFromLocator(
      page,
      page.frameLocator("iframe").locator("button.primary"),
    );
    const resolved = await resolveLocator(page, {
      kind: "css",
      selector: "button.primary",
      framePath: ["iframe"],
    });
    const sameTarget =
      resolved.result.executionStatus === "COMPLETED" &&
      resolved.result.finalMatchCount === 1 &&
      resolved.finalHandle !== null
        ? await isSameElement(page, resolved.finalHandle, original)
        : false;
    const decoyHandle = await page
      .frameLocator("iframe")
      .locator("button.decoy")
      .elementHandle();
    const decoy = await isSameElement(page, decoyHandle, original);
    frameIdentityProbe = {
      sameTarget,
      decoy,
      passed: sameTarget === true && decoy === false,
    };
    log(
      `frame identity probe sameTarget=${String(frameIdentityProbe.sameTarget)} decoy=${String(
        frameIdentityProbe.decoy,
      )} passed=${String(frameIdentityProbe.passed)}`,
    );

    externalRequests = browserHandle.externalRequestCount();
    blockedRequests = browserHandle.blockedRequestCount();
    log(
      `externalRequests=${externalRequests} blockedRequests=${blockedRequests}`,
    );

    const identityReproducible =
      secondRun.resolverResult.executionStatus === "COMPLETED" &&
      secondRun.resolverResult.finalMatchCount === 1 &&
      secondRun.identityMatch === true;

    checks = {
      uniqueHit: rawMatchCount === 1 && finalMatchCount === 1,
      identityReproducible,
      offlineProbePassed: offlineProbe.passed,
    };

    log(
      `checks uniqueHit=${String(checks.uniqueHit)} identityReproducible=${String(
        checks.identityReproducible,
      )} offlineProbePassed=${String(checks.offlineProbePassed)}`,
    );

    const allPass =
      checks.uniqueHit &&
      checks.identityReproducible &&
      checks.offlineProbePassed &&
      frameIdentityProbe.passed;
    log(`result ${allPass ? "PASS" : "FAIL"}`);

    mkdirSync(evidenceDir, { recursive: true });

    const record = {
      schema: "locatorstress.t001-baseline/v1",
      seed: SEED,
      playwright: playwrightVersion,
      chromium: chromiumVersion,
      node: process.version,
      baseline: {
        htmlBytes,
        locator: { kind: SPEC.kind, selector: SPEC.selector },
        privateTargetPathUsed: true,
        rawMatchCount,
        finalMatchCount,
        executionStatus,
        identityMatch,
      },
      identityProbe: {
        nodeIdentity: probe.nodeIdentity,
        wrapperIdentity: probe.wrapperIdentity,
        reproducibleSecondRun: identityReproducible,
      },
      offlineProbe,
      frameIdentityProbe,
      externalRequests,
      blockedRequests,
      checks,
    };

    writeFileSync(evidenceJsonPath, JSON.stringify(record, null, 2) + "\n", "utf8");
    writeFileSync(evidenceLogPath, lines.join("\n") + "\n", "utf8");
    evidenceWritten = true;

    if (!allPass) {
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
  } catch (error) {
    if (!evidenceWritten) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        writeStaleEvidence(lines, message);
      } catch {
        // ignore stale-evidence write errors; exit code still reflects failure
      }
    }
    throw error;
  } finally {
    if (browserHandle) {
      try {
        await browserHandle.close();
      } catch {
        // ignore close errors
      }
    }
  }
}

main().catch((err) => {
  console.error(`fatal: ${err && err.message ? err.message : String(err)}`);
  process.exitCode = 1;
});
```

## scripts/t008-api-report.ts

- 行数：377；字节数：16763；SHA-256：`a56296acbe72007779e1d99cafb4deee31d477f6f065db47ef96397bf6084703`

```ts
// T008 evidence generator — evidence/s2/T008_API_REPORT.json.
//
// Runs a REAL analysis (not the S0 gate): baseline + 8 single mutations
// for all 24 fixtures through the T008 AnalysisService, BFS samples
// through POST-equivalent service.search calls, and a loopback API
// smoke test over real HTTP. Then assembles the AnalysisReport,
// writes it as canonical JSON, re-reads it and re-validates it
// (structure + all four hashes recomputed).
//
// This script is NOT the S0 gate: it never runs scripts/s0-gate.ts,
// never writes evidence/s0/, and its gate_sha256 is computed over this
// report's own analysis object (real BFS witness), so it differs from
// the frozen S0 gate hash by design. It READS evidence/s0/S0_GATE.json
// only to (a) verify its bytes are unchanged before/after, and (b)
// cross-check that the scenario/oracle hashes recompute identically
// to the frozen S0 values for the same 192-case input set.
//
// BFS samples (labelled bounds, all through service.search with BFS
// defaults only — never operatorOrder / allowRepeat):
//   - F001 maxDepth 2  (T007 spot-check: BOUNDED_NO_WITNESS)
//   - F002 maxDepth 1  (FOUND [M01] WRONG_TARGET)
//   - F003 maxDepth 1  (FOUND [M04] AMBIGUOUS)
//   - F001 maxDepth 6, maxExpandedStates 8 — REDUCED-budget
//     BOUNDED_INCOMPLETE demo. This is NOT the frozen 4096 budget; it
//     exercises the passthrough path cheaply and is labelled as such.
//
// Run: npm run report:t008   (builds first, then node this script)

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { launchBaselineBrowser } from "../dist/runner/browser.js";
import { createBrowserAnalysisService } from "../dist/api/service.js";
import { startAnalysisServer } from "../dist/api/server.js";
import { buildAnalysisReport } from "../dist/analysis/witness.js";
import { writeReportJson, validateExportedJsonText } from "../dist/export/json-export.js";
import { FIXTURE_IDS, loadAllFixtureManifests } from "../dist/fixtures/fixture-manifest.js";
import { loadFixture } from "../dist/fixtures/fixture-loader.js";

// Minimal local shapes for the dist-JS values this script uses.
// (s0-gate.ts does the same: scripts never import types from src/,
// because that would pull the whole src tree into the scripts
// typecheck program and clash with scripts/node-shims.d.ts.)
interface ServiceAnalyzedCase {
  fixtureId: string;
  mutationId: string | null;
  locatorKind: string;
  controlGroup: string;
  verdict: string | null;
  analysisStatus: string;
  executionStatus: string;
  matchCount: number;
  identityMatch: boolean | null;
  expectedVerdict: string | null;
}
interface ServiceFixtureAnalysis {
  baseline: { verdict: string | null };
  cases: ServiceAnalyzedCase[];
}
interface ServiceWitnessSummary {
  status: string;
  witness: { sequence: string[]; depth: number; verdict: string } | null;
  statesEvaluated: number;
  statesExpanded: number;
  statesDeduplicated: number;
  queueRemaining: number;
}
interface ServiceLike {
  analyze(request: { fixtureId: string }): Promise<ServiceFixtureAnalysis>;
  search(request: {
    fixtureId: string;
    maxDepth?: number;
    maxExpandedStates?: number;
  }): Promise<ServiceWitnessSummary>;
}

const repoRoot = process.cwd();
const S0_GATE_JSON = join(repoRoot, "evidence", "s0", "S0_GATE.json");
const OUT_PATH = join(repoRoot, "evidence", "s2", "T008_API_REPORT.json");

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function log(message: string): void {
  process.stdout.write(`[t008-report] ${message}\n`);
}

function chromiumExecutable(): string {
  const candidate = join(
    process.env.HOME ?? "",
    ".cache/ms-playwright/chromium-1254/chrome-linux64/chrome",
  );
  if (!existsSync(candidate)) {
    throw new Error(`chromium-1254 not found at ${candidate}; no fallback is allowed`);
  }
  return candidate;
}

async function main(): Promise<number> {
  const s0Before = sha256Hex(readFileSync(S0_GATE_JSON, "utf8"));
  const s0Gate = JSON.parse(readFileSync(S0_GATE_JSON, "utf8")) as {
    hashes?: { scenario_sha256?: string; oracle_result_sha256?: string };
  };
  log(`S0_GATE.json sha256 before: ${s0Before}`);

  const browserHandle = await launchBaselineBrowser({
    executablePath: chromiumExecutable(),
  });
  try {
    const service = createBrowserAnalysisService(
      browserHandle.page,
    ) as unknown as ServiceLike;
    const manifests = loadAllFixtureManifests();
    const manifestById = new Map(manifests.map((m) => [m.fixtureId, m]));

    // ---- 192 single-mutation cases via the API service ----
    const cases: Array<Record<string, unknown>> = [];
    let baselinePassed = 0;
    for (const fixtureId of FIXTURE_IDS) {
      const analysis: ServiceFixtureAnalysis = await service.analyze({ fixtureId });
      if (analysis.baseline.verdict === "STABLE") baselinePassed += 1;
      for (const c of analysis.cases) {
        if (c.mutationId === null) continue;
        if (c.expectedVerdict === null) {
          throw new Error(`case ${fixtureId}/${c.mutationId}: golden expected verdict missing`);
        }
        cases.push({
          fixtureId: c.fixtureId,
          mutationId: c.mutationId,
          locatorKind: c.locatorKind,
          controlGroup: c.controlGroup,
          verdict: c.verdict,
          analysisStatus: c.analysisStatus,
          executionStatus: c.executionStatus,
          matchCount: c.matchCount,
          identityMatch: c.identityMatch,
          expectedVerdict: c.expectedVerdict,
        });
      }
    }
    log(`cases: ${cases.length} (expected 192), baseline STABLE: ${baselinePassed}/24`);
    if (cases.length !== 192) {
      log(`ERROR: expected 192 cases, got ${cases.length}`);
      return 1;
    }

    // ---- Oracle parity vs golden (display only) ----
    let matched = 0;
    for (const c of cases) {
      if (c["verdict"] !== null && c["verdict"] === c["expectedVerdict"]) matched += 1;
    }
    const oracleParity = { compared: 192, matched, mismatched: 192 - matched };
    log(`oracle parity: ${matched}/192 matched`);

    // ---- BFS samples through the service (defaults only) ----
    const witnesses: Record<string, unknown> = {};
    const samples: Array<{ fixtureId: string; maxDepth: number; maxExpandedStates?: number; label: string }> = [
      { fixtureId: "F001", maxDepth: 2, label: "F001 depth 2 (T007 spot-check)" },
      { fixtureId: "F002", maxDepth: 1, label: "F002 depth 1" },
      { fixtureId: "F003", maxDepth: 1, label: "F003 depth 1" },
      { fixtureId: "F001", maxDepth: 6, maxExpandedStates: 8, label: "F001 depth 6, REDUCED budget 8 (BOUNDED_INCOMPLETE demo)" },
    ];
    // A fixture searched twice (F001) keeps the LAST run in the report
    // map; record both runs in the notes instead.
    const sampleNotes: string[] = [];
    for (const s of samples) {
      const summary: ServiceWitnessSummary = await service.search({
        fixtureId: s.fixtureId,
        maxDepth: s.maxDepth,
        ...(s.maxExpandedStates !== undefined ? { maxExpandedStates: s.maxExpandedStates } : {}),
      });
      sampleNotes.push(
        `${s.label}: status=${summary.status} witness=${summary.witness === null ? "null" : summary.witness.sequence.join("+")} ` +
        `evaluated=${summary.statesEvaluated} expanded=${summary.statesExpanded} ` +
        `dedup=${summary.statesDeduplicated} queueRemaining=${summary.queueRemaining}`,
      );
      log(sampleNotes[sampleNotes.length - 1] as string);
      // Keep the widest run per fixture in the report map: for F001
      // the depth-2 run (fuller picture than the reduced-budget demo).
      if (s.fixtureId === "F001" && s.maxExpandedStates !== undefined) continue;
      witnesses[s.fixtureId] = summary;
    }

    // ---- Static offline scan (same formula as s0-gate §c) ----
    let staticOfflineScanHits = 0;
    for (const id of FIXTURE_IDS) {
      const html = loadFixture(id).html;
      const m1 = html.match(/https?:\/\//g);
      const m2 = html.match(/(src|href)\s*=\s*["']https?:/gi);
      staticOfflineScanHits += (m1 ? m1.length : 0) + (m2 ? m2.length : 0);
    }
    const externalRequests = browserHandle.externalRequestCount();
    const blockedRequests = browserHandle.blockedRequestCount();
    log(`external requests: ${externalRequests}, blocked: ${blockedRequests}, static scan hits: ${staticOfflineScanHits}`);

    // ---- Gate result from the S0 thresholds (same numbers) ----
    const verdictCounts: Record<string, number> = {
      STABLE: 0, WRONG_TARGET: 0, AMBIGUOUS: 0, MISSING: 0,
    };
    for (const c of cases) {
      if (typeof c["verdict"] === "string") verdictCounts[c["verdict"] as string] += 1;
    }
    const completed = cases.filter((c) => c["verdict"] !== null).length;
    let stableMismatches = 0;
    let fragileMismatches = 0;
    for (const c of cases) {
      const m = manifestById.get(c["fixtureId"] as string);
      if (!m) continue;
      const ok = c["verdict"] !== null && c["verdict"] === c["expectedVerdict"];
      if (!ok && m.controlGroup === "stable") stableMismatches += 1;
      if (!ok && m.controlGroup === "fragile") fragileMismatches += 1;
    }
    let failureType: string | null = null;
    if (baselinePassed !== 24) failureType = "BASELINE";
    else if (completed !== 192) failureType = "CASES";
    else if (stableMismatches > 1) failureType = "CONTROLS";
    else if (fragileMismatches !== 0) failureType = "CONTROLS";
    else if (Object.values(verdictCounts).some((n) => n < 8)) failureType = "COVERAGE";
    else if (oracleParity.mismatched !== 0) failureType = "ORACLE_PARITY";
    else if (externalRequests !== 0 || staticOfflineScanHits !== 0) failureType = "OFFLINE";
    const gateResult = failureType === null ? "PASS" : "FAIL";
    log(`gate derivation: ${gateResult}${failureType === null ? "" : ` (${failureType})`}`);
    log(`verdict counts: ${JSON.stringify(verdictCounts)}`);

    // ---- API smoke test over real HTTP (loopback only) ----
    const running = await startAnalysisServer(service, { host: "127.0.0.1", port: 0 });
    let apiSmoke: Record<string, unknown> | null = null;
    try {
      const healthRes = await fetch(`${running.url}/api/health`);
      const healthBody = (await healthRes.json()) as Record<string, unknown>;
      const fixturesRes = await fetch(`${running.url}/api/fixtures`);
      const fixturesBody = (await fixturesRes.json()) as { fixtures: unknown[] };
      const searchRes = await fetch(`${running.url}/api/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixtureId: "F002", maxDepth: 1 }),
      });
      const searchBody = (await searchRes.json()) as Record<string, unknown>;
      const address = running.server.address();
      const addressText =
        address !== null && typeof address !== "string"
          ? `${address.address}:${address.port}`
          : String(address);
      apiSmoke = {
        host: running.host,
        port: running.port,
        address: addressText,
        healthOk: healthRes.status === 200 && healthBody["status"] === "ok",
        fixturesListed: fixturesBody.fixtures.length,
        searchFixtureId: "F002",
        searchStatus: searchBody["status"],
      };
      log(`API smoke: ${JSON.stringify(apiSmoke)}`);
      if (
        apiSmoke["healthOk"] !== true ||
        apiSmoke["fixturesListed"] !== 24 ||
        apiSmoke["searchStatus"] !== "FOUND"
      ) {
        log("ERROR: API smoke test failed");
        return 1;
      }
    } finally {
      await running.close();
    }

    // ---- Assemble the report (verification outside the hashed bytes) ----
    const fixtures = manifests.map((m) => ({
      fixtureId: m.fixtureId,
      family: m.family,
      kind: m.kind,
      controlGroup: m.controlGroup,
      locator: m.locator,
      html: loadFixture(m.fixtureId).html,
    }));
    const s0After = sha256Hex(readFileSync(S0_GATE_JSON, "utf8"));
    const report = buildAnalysisReport({
      cases: cases as never,
      fixtures: fixtures as never,
      witnesses: witnesses as never,
      oracleParity,
      baseline: { passed: baselinePassed, total: 24 },
      externalRequests,
      blockedRequests,
      staticOfflineScanHits,
      gateResult,
      gateFailureType: failureType,
      notes: [
        `BFS samples (all through service.search, BFS defaults only): ${sampleNotes.join(" | ")}`,
        `F001 depth-6 BOUNDED_INCOMPLETE demo used a REDUCED expansion budget (maxExpandedStates 8), not the frozen 4096 budget; it exercises the passthrough path only. A full 24-fixture depth-6 sweep belongs to T012 performance/stress.`,
        `API smoke test ran over real HTTP on 127.0.0.1 (ephemeral port, not part of any hash): /api/health ok, /api/fixtures listed 24, /api/search F002 depth 1 FOUND [M01].`,
      ],
      verification: {
        s0GateJsonSha256Before: s0Before,
        s0GateJsonSha256After: s0After,
        s0GateJsonUnchanged: s0Before === s0After,
        reportRevalidated: false,
        apiSmoke: apiSmoke as never,
      },
    });

    // Cross-check: scenario/oracle hashes must recompute identically
    // to the frozen S0 gate values for the same 192-case input set.
    const scenarioMatches =
      s0Gate.hashes?.scenario_sha256 === report.hashes.scenario_sha256;
    const oracleMatches =
      s0Gate.hashes?.oracle_result_sha256 === report.hashes.oracle_result_sha256;
    log(`scenario hash matches frozen S0: ${String(scenarioMatches)}`);
    log(`oracle hash matches frozen S0: ${String(oracleMatches)}`);
    if (!scenarioMatches || !oracleMatches) {
      log("ERROR: scenario/oracle hash cross-check against S0 failed");
      log(`  S0 scenario: ${s0Gate.hashes?.scenario_sha256}`);
      log(`  T008 scenario: ${report.hashes.scenario_sha256}`);
      log(`  S0 oracle: ${s0Gate.hashes?.oracle_result_sha256}`);
      log(`  T008 oracle: ${report.hashes.oracle_result_sha256}`);
      return 1;
    }

    // Write, re-read, re-validate.
    mkdirSync(join(repoRoot, "evidence", "s2"), { recursive: true });
    writeReportJson(OUT_PATH, report);
    const { validation } = validateExportedJsonText(readFileSync(OUT_PATH, "utf8"));
    if (!validation.valid) {
      log(`ERROR: written report failed re-validation: ${validation.errors.join("; ")}`);
      return 1;
    }
    // Record the successful re-validation in the report itself. The
    // verification block is outside every canonical object, so this
    // rebuild cannot change any hash — assert that below.
    const finalReport = buildAnalysisReport({
      cases: cases as never,
      fixtures: fixtures as never,
      witnesses: witnesses as never,
      oracleParity,
      baseline: { passed: baselinePassed, total: 24 },
      externalRequests,
      blockedRequests,
      staticOfflineScanHits,
      gateResult,
      gateFailureType: failureType,
      notes: [
        `BFS samples (all through service.search, BFS defaults only): ${sampleNotes.join(" | ")}`,
        `F001 depth-6 BOUNDED_INCOMPLETE demo used a REDUCED expansion budget (maxExpandedStates 8), not the frozen 4096 budget; it exercises the passthrough path only. A full 24-fixture depth-6 sweep belongs to T012 performance/stress.`,
        `API smoke test ran over real HTTP on 127.0.0.1 (ephemeral port, not part of any hash): /api/health ok, /api/fixtures listed 24, /api/search F002 depth 1 FOUND [M01].`,
      ],
      verification: {
        s0GateJsonSha256Before: s0Before,
        s0GateJsonSha256After: s0After,
        s0GateJsonUnchanged: s0Before === s0After,
        reportRevalidated: true,
        apiSmoke: apiSmoke as never,
      },
    });
    if (JSON.stringify(finalReport.hashes) !== JSON.stringify(report.hashes)) {
      log("ERROR: hashes changed when adding the verification block (must not happen)");
      return 1;
    }
    writeReportJson(OUT_PATH, finalReport);
    const second = validateExportedJsonText(readFileSync(OUT_PATH, "utf8"));
    if (!second.validation.valid) {
      log(`ERROR: final report failed re-validation: ${second.validation.errors.join("; ")}`);
      return 1;
    }

    log(`wrote ${OUT_PATH}`);
    log(`hashes: ${JSON.stringify(finalReport.hashes)}`);
    log(`scores: overall ${finalReport.scores.overall.scoreNumerator}/${finalReport.scores.overall.scoreDenominator} = ${finalReport.scores.overall.score}`);
    log(`witness coverage: ${JSON.stringify(finalReport.witnessCoverage)}`);
    log(`S0_GATE.json unchanged: ${String(s0Before === s0After)}`);
    return 0;
  } finally {
    await browserHandle.close();
  }
}

process.exit(await main());
```

## scripts/t011-mutation-runner.mjs

- 行数：669；字节数：29655；SHA-256：`c10794dfb418f53d6b65667a7eb8462244da8f5392911f0099daf75a622e4911`

```js
// T011 — Hand-rolled mutation testing for the frozen pure modules.
//
// Why hand-rolled: no mutation framework is installed (no Stryker in
// node_modules) and `npm install` is currently blocked by the VM-wide
// exec-write EPERM fault, so a dependency-based runner cannot be
// installed in this session. This script is a real mutation runner,
// not a simulation: for each mutant it (1) rewrites one production
// source file, (2) runs the real vitest suite for that module, and
// (3) restores the file byte-for-byte (SHA-256 verified).
//
// SAFETY DESIGN (v2): mutants are applied ONLY inside a scratch copy
// of the project (~/t011-mutation-work/), NEVER to the real tree.
// The v1 design mutated production files in place; the VM's storage
// fault truncated src/verdict/classify.ts to 0 bytes twice (once when
// a plain write silently wrote 0 bytes, once when the service
// restarted mid-run), and the file had to be restored from git both
// times. Production files are now only READ: the runner verifies the
// real src/ tree against a pre-run SHA-256 manifest before and after,
// and exits 2 if it differs. The scratch tree is disposable.
//
// Mutation score threshold: >= 90% killed, after excluding mutants
// proven equivalent (EQUIVALENT list below, currently empty).
// Justification for 90% (not 100%): these are hand-written,
// single-edit semantic mutants on frozen pure functions; each one
// changes exactly one decision the spec pins down, so the suite
// should catch nearly all of them. 100% would be the ideal, and any
// survivor below the threshold is a FAIL that must be dispositioned
// (add a killing test, or prove the mutant equivalent and record it
// with its proof). A survivor is never silently dropped.
//
// Usage: node scripts/t011-mutation-runner.mjs [--mutant <id>]
// Exit: 0 iff score >= threshold AND inconclusive == 0 AND no config
// errors; 1 for a below-threshold score or inconclusive mutants;
// 2 for a config error (stale anchor), a scratch-setup failure, or a
// real-tree mismatch.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH_ROOT = join(process.env.HOME ?? "/tmp", "t011-mutation-work");
const EVIDENCE_PATH = join(PROJECT_ROOT, "evidence", "s4", "T011_MUTATION_RESULTS.json");
const MUTATION_SCORE_THRESHOLD = 0.9;
const PER_MUTANT_TIMEOUT_MS = 180000;
const MAX_WRITE_ATTEMPTS = 8;

// Mutants proven equivalent to the original (with proof). Empty: every
// mutant below is expected to be killed. Add an entry here ONLY with a
// proof that the replacement is behaviourally identical on all inputs.
const EQUIVALENT = [];

const TESTS = {
  classify: [
    "tests/verdict/classify.test.ts",
    "tests/verdict/classify-boundaries.test.ts",
    "tests/property/property.test.ts",
  ],
  score: [
    "tests/score/stability-score.test.ts",
    "tests/score/format-percent-boundaries.test.ts",
    "tests/score/controls.test.ts",
    "tests/property/property.test.ts",
  ],
  canonical: [
    "tests/canonical/canonical-json.test.ts",
    "tests/canonical/canonical-boundaries.test.ts",
    "tests/canonical/hash-contract.test.ts",
  ],
  stateKey: ["tests/search/bfs.test.ts", "tests/search/state-key-boundaries.test.ts"],
  bfs: [
    "tests/search/bfs.test.ts",
    "tests/search/bfs-determinism.test.ts",
    "tests/analysis/witness.test.ts",
    "tests/analysis/witness-boundaries.test.ts",
  ],
  htmlEscape: ["tests/export/html-escape.test.ts"],
  forbiddenScan: ["tests/canonical/forbidden-scan.test.ts"],
  routes: ["tests/api/routes.test.ts", "tests/api/routes-boundaries.test.ts"],
  locator: ["tests/contracts/locator-spec.test.ts"],
  witness: ["tests/analysis/witness.test.ts", "tests/analysis/witness-boundaries.test.ts"],
};

// Each mutant changes exactly ONE decision in one production file.
// `anchor` must occur exactly once in the file (verified before use);
// `replacement` is the mutated text. `killedBy` names the test that
// is expected to catch it (documentation; the runner checks the real
// vitest result, not the name).
const MUTANTS = [
  // --- verdict/classify.ts -------------------------------------------
  {
    id: "M-CL-01", file: "src/verdict/classify.ts", group: "classify",
    name: "invert execution-status gate (ERROR/TIMEOUT now classified)",
    anchor: 'if (executionStatus !== "COMPLETED") {',
    replacement: 'if (executionStatus === "COMPLETED") {',
    killedBy: "classify: ERROR/TIMEOUT rows must yield no verdict",
  },
  {
    id: "M-CL-02", file: "src/verdict/classify.ts", group: "classify",
    name: "MISSING triggers at final==1 instead of final==0",
    anchor: "if (result.finalMatchCount === 0) {",
    replacement: "if (result.finalMatchCount === 1) {",
    killedBy: "classify: MISSING positive (0 matches) and STABLE (1 match)",
  },
  {
    id: "M-CL-03", file: "src/verdict/classify.ts", group: "classify",
    name: "AMBIGUOUS threshold 1 -> 2 (2 matches no longer ambiguous)",
    anchor: "if (result.finalMatchCount > 1) {",
    replacement: "if (result.finalMatchCount > 2) {",
    killedBy: "classify: AMBIGUOUS positive (2 matches)",
  },
  {
    id: "M-CL-04", file: "src/verdict/classify.ts", group: "classify",
    name: "swap STABLE/WRONG_TARGET (identity true treated as false)",
    anchor: "if (identityMatch === true) {",
    replacement: "if (identityMatch === false) {",
    killedBy: "classify: STABLE positive and WRONG_TARGET positive",
  },
  {
    id: "M-CL-05", file: "src/verdict/classify.ts", group: "classify",
    name: "count sanity final>=raw instead of final>raw (final==raw now invalid)",
    anchor: "result.finalMatchCount > result.rawMatchCount",
    replacement: "result.finalMatchCount >= result.rawMatchCount",
    killedBy: "classify: every valid 1/1 and 2/2 row",
  },
  {
    id: "M-CL-06", file: "src/verdict/classify.ts", group: "classify",
    name: "drop the >= 0 check (negative counts accepted)",
    anchor: "return Number.isInteger(value) && value >= 0;",
    replacement: "return Number.isInteger(value);",
    killedBy: "classify: negative-count rows must yield no verdict",
  },
  {
    id: "M-CL-07", file: "src/verdict/classify.ts", group: "classify",
    name: "frame-kind swap (FRAME_MISSING read as AMBIGUOUS branch)",
    anchor: 'if (result.frameFailure.kind === "FRAME_AMBIGUOUS") {',
    replacement: 'if (result.frameFailure.kind === "FRAME_MISSING") {',
    killedBy: "classify: frame AMBIGUOUS/MISSING positives",
  },
  // --- score/stability-score.ts --------------------------------------
  {
    id: "M-SC-01", file: "src/score/stability-score.ts", group: "score",
    name: "rounding half-up -> truncation (200000n -> 100000n)",
    anchor: "(200000n * BigInt(numerator) + BigInt(denominator))",
    replacement: "(100000n * BigInt(numerator) + BigInt(denominator))",
    killedBy: "formatPercent: exact-half rows (0.0005 -> 0.001)",
  },
  {
    id: "M-SC-02", file: "src/score/stability-score.ts", group: "score",
    name: "score denominator completed -> expected (incomplete cases dilute the score)",
    anchor: "row.scoreDenominator = row.completed;",
    replacement: "row.scoreDenominator = row.expected;",
    killedBy: "score: 1 stable + 1 incomplete must score 100, coverage 50",
  },
  {
    id: "M-SC-03", file: "src/score/stability-score.ts", group: "score",
    name: "invert incomplete handling (complete cases skipped, incomplete counted)",
    anchor: "if (c.verdict === null) {\n    // Incomplete: never counted as STABLE, never enters the score",
    replacement: "if (c.verdict !== null) {\n    // Incomplete: never counted as STABLE, never enters the score",
    killedBy: "score: incomplete cases never count as STABLE",
  },
  {
    id: "M-SC-04", file: "src/score/stability-score.ts", group: "score",
    name: "swap score operands (completed/stable instead of stable/completed)",
    anchor: "row.score = formatPercent(row.stable, row.completed);",
    replacement: "row.score = formatPercent(row.completed, row.stable);",
    killedBy: "score: 1/4 must be 25, not 400",
  },
  {
    id: "M-SC-05", file: "src/score/stability-score.ts", group: "score",
    name: "mismatched = pairs - completed instead of pairs - matched",
    anchor: "out.mismatched = out.pairs - out.matched;",
    replacement: "out.mismatched = out.pairs - out.completed;",
    killedBy: "controls: incomplete cases count as mismatches",
  },
  {
    id: "M-SC-06", file: "src/score/stability-score.ts", group: "score",
    name: "invert row analysisStatus (COMPLETE <-> INCOMPLETE)",
    anchor: 'row.analysisStatus = row.incomplete === 0 ? "COMPLETE" : "INCOMPLETE";',
    replacement: 'row.analysisStatus = row.incomplete === 0 ? "INCOMPLETE" : "COMPLETE";',
    killedBy: "score: empty input row must be COMPLETE",
  },
  // --- canonical/canonical-json.ts ------------------------------------
  {
    id: "M-CJ-01", file: "src/canonical/canonical-json.ts", group: "canonical",
    name: "key sort by code point -> JS default UTF-16 sort",
    anchor: "const keys = Object.keys(obj).sort(compareCodePoints);",
    replacement: "const keys = Object.keys(obj).sort();",
    killedBy: "canonical: astral-plane keys sort after the whole BMP",
  },
  {
    id: "M-CJ-02", file: "src/canonical/canonical-json.ts", group: "canonical",
    name: "string normalisation NFC -> NFD",
    anchor: 'if (typeof value === "string") return value.normalize("NFC");',
    replacement: 'if (typeof value === "string") return value.normalize("NFD");',
    killedBy: "canonical: e + combining acute becomes precomposed é",
  },
  {
    id: "M-CJ-03", file: "src/canonical/canonical-json.ts", group: "canonical",
    name: "non-finite numbers silently pass through instead of throwing",
    anchor: 'if (!Number.isFinite(value)) {\n      throw new Error("non-finite number in canonical JSON");\n    }',
    replacement: 'if (!Number.isFinite(value)) {\n      return value;\n    }',
    killedBy: "canonical: rejects non-finite numbers",
  },
  {
    id: "M-CJ-04", file: "src/canonical/canonical-json.ts", group: "canonical",
    name: "arrays reversed (order no longer preserved)",
    anchor: "if (Array.isArray(value)) return value.map((v) => canonicalize(v));",
    replacement: "if (Array.isArray(value)) return value.map((v) => canonicalize(v)).reverse();",
    killedBy: "canonical: preserves array order",
  },
  {
    id: "M-CJ-05", file: "src/canonical/canonical-json.ts", group: "canonical",
    name: "SHA-256 -> SHA-1 (hash length 64 -> 40)",
    anchor: 'return createHash("sha256").update(text, "utf8").digest("hex");',
    replacement: 'return createHash("sha1").update(text, "utf8").digest("hex");',
    killedBy: "canonical: sha256Hex matches the known vector",
  },
  {
    id: "M-CJ-06", file: "src/canonical/canonical-json.ts", group: "canonical",
    name: "invert code-point comparison (descending order)",
    anchor: "if (ca !== cb) return ca < cb ? -1 : 1;",
    replacement: "if (ca !== cb) return ca < cb ? 1 : -1;",
    killedBy: "canonical: sorts ASCII by code point",
  },
  // --- search/state-key.ts --------------------------------------------
  {
    id: "M-SK-01", file: "src/search/state-key.ts", group: "stateKey",
    name: "plan key sorts the sequence (order-insensitive plan hash)",
    anchor: "plan: [...sequence],",
    replacement: "plan: [...sequence].sort(),",
    killedBy: "state-key: planStateKey is order-sensitive",
  },
  {
    id: "M-SK-02", file: "src/search/state-key.ts", group: "stateKey",
    name: "failure predicate: STABLE counts as failure, MISSING does not",
    anchor: 'return verdict !== null && verdict !== "STABLE";',
    replacement: 'return verdict !== null && verdict !== "MISSING";',
    killedBy: "bfs: depth-1 witness + BOUNDED_NO_WITNESS cases",
  },
  {
    id: "M-SK-03", file: "src/search/state-key.ts", group: "stateKey",
    name: "compareSequences prefix rule inverted (longer sorts first)",
    anchor: "return a.length - b.length;",
    replacement: "return b.length - a.length;",
    killedBy: "state-key: a prefix is smaller than the longer sequence",
  },
  // --- search/bfs.ts ---------------------------------------------------
  {
    id: "M-BF-01", file: "src/search/bfs.ts", group: "bfs",
    name: "depth limit off by one (expand one level too deep)",
    anchor: "if (depth >= maxDepth) {",
    replacement: "if (depth > maxDepth) {",
    killedBy: "bfs: BOUNDED_NO_WITNESS when the failure is deeper than maxDepth",
  },
  {
    id: "M-BF-02", file: "src/search/bfs.ts", group: "bfs",
    name: "expansion budget off by one (one extra expansion allowed)",
    anchor: "if (statesExpanded >= maxExpandedStates) {",
    replacement: "if (statesExpanded > maxExpandedStates) {",
    killedBy: "bfs: BOUNDED_INCOMPLETE when the state budget runs out",
  },
  {
    id: "M-BF-03", file: "src/search/bfs.ts", group: "bfs",
    name: "allowRepeat ignored (repeats always forbidden)",
    anchor: "if (!allowRepeat && sequence.includes(op)) {",
    replacement: "if (sequence.includes(op)) {",
    killedBy: "bfs: allowRepeat explores repeated operators",
  },
  {
    id: "M-BF-04", file: "src/search/bfs.ts", group: "bfs",
    name: "FIFO queue -> LIFO stack (DFS instead of BFS)",
    anchor: "const sequence = queue.shift() as MutationId[];",
    replacement: "const sequence = queue.pop() as MutationId[];",
    killedBy: "bfs: returns the shortest witness, not the first failing sequence",
  },
  {
    id: "M-BF-05", file: "src/search/bfs.ts", group: "bfs",
    name: "dedup disabled (duplicate states re-expanded)",
    anchor: "const duplicate = visited.has(evaluation.stateKey);",
    replacement: "const duplicate = false;",
    killedBy: "bfs: prunes a duplicate state and never expands it",
  },
  {
    id: "M-BF-06", file: "src/search/bfs.ts", group: "bfs",
    name: "INCOMPLETE nodes expanded (untrusted DOM state trusted)",
    anchor: "if (evaluation.verdict === null) {",
    replacement: "if (false) {",
    killedBy: "bfs: skips an incomplete node and does not expand it",
  },
  // --- export/html-escape.ts -------------------------------------------
  {
    id: "M-HE-01", file: "src/export/html-escape.ts", group: "htmlEscape",
    name: "single quote no longer escaped",
    anchor: `"'": "&#39;",`,
    replacement: `"'": "'",`,
    killedBy: "html-escape: escapes each character in isolation",
  },
  {
    id: "M-HE-02", file: "src/export/html-escape.ts", group: "htmlEscape",
    name: "< no longer escaped in the JSON script block (</script> breakout)",
    anchor: '.replace(/</g, "\\\\u003c")',
    replacement: '.replace(/</g, "<")',
    killedBy: "html-escape: rewrites </script> so the block cannot be terminated",
  },
  {
    id: "M-HE-03", file: "src/export/html-escape.ts", group: "htmlEscape",
    name: "<img> removed from the forbidden-tag set",
    anchor: '  "link",\n  "img",\n  "iframe",',
    replacement: '  "link",\n  "iframe",',
    killedBy: "html-escape: flags each forbidden resource tag",
  },
  // --- canonical/forbidden-scan.ts --------------------------------------
  {
    id: "M-FS-01", file: "src/canonical/forbidden-scan.ts", group: "forbiddenScan",
    name: "createdAt rule narrowed to created_at only",
    anchor: "/createdAt|created_at/,",
    replacement: "/created_at/,",
    killedBy: "forbidden-scan: createdAt literal is flagged",
  },
  {
    id: "M-FS-02", file: "src/canonical/forbidden-scan.ts", group: "forbiddenScan",
    name: "epoch rule widened to 14 digits (13-digit epochs missed)",
    anchor: String.raw`/\b1[67]\d{11}\b/,`,
    replacement: String.raw`/\b1[67]\d{12}\b/,`,
    killedBy: "forbidden-scan: 13-digit millisecond epoch is flagged",
  },
  // --- api/routes.ts -----------------------------------------------------
  {
    id: "M-RT-01", file: "src/api/routes.ts", group: "routes",
    name: "known/unknown path check inverted (known paths 404)",
    anchor: "if (!KNOWN_PATHS.has(path)) {",
    replacement: "if (KNOWN_PATHS.has(path)) {",
    killedBy: "routes: GET /api/health returns ok",
  },
  {
    id: "M-RT-02", file: "src/api/routes.ts", group: "routes",
    name: "P2-2 rejection removed (test-only BFS options reach the search)",
    anchor: 'if ("operatorOrder" in body || "allowRepeat" in body) {',
    replacement: "if (false) {",
    killedBy: "routes: search rejects operatorOrder and allowRepeat",
  },
  {
    id: "M-RT-03", file: "src/api/routes.ts", group: "routes",
    name: "HTML export 501 -> 200 (not-implemented reported as success)",
    anchor: "status: 501,",
    replacement: "status: 200,",
    killedBy: "routes: HTML export is an honest 501",
  },
  // --- contracts/locator.ts ----------------------------------------------
  {
    id: "M-LC-01", file: "src/contracts/locator.ts", group: "locator",
    name: "framePath cap 2 -> 3 (3-layer paths accepted)",
    anchor: "if (framePath.length > 2) {",
    replacement: "if (framePath.length > 3) {",
    killedBy: "locator-spec: rejects a 3-layer framePath",
  },
  {
    id: "M-LC-02", file: "src/contracts/locator.ts", group: "locator",
    name: "index must be > 0 (index 0 rejected)",
    anchor: "return typeof value === \"number\" && Number.isInteger(value) && value >= 0;",
    replacement: "return typeof value === \"number\" && Number.isInteger(value) && value > 0;",
    killedBy: "locator-spec: accepts index 0",
  },
  // --- analysis/witness.ts ------------------------------------------------
  {
    id: "M-WN-01", file: "src/analysis/witness.ts", group: "witness",
    name: "BOUNDED_NO_WITNESS meaning swapped with BOUNDED_INCOMPLETE",
    anchor: 'if (status === "BOUNDED_NO_WITNESS") {',
    replacement: 'if (status === "BOUNDED_INCOMPLETE") {',
    killedBy: "witness: BOUNDED_NO_WITNESS disclaims safety",
  },
  {
    id: "M-WN-02", file: "src/analysis/witness.ts", group: "witness",
    name: "FOUND-with-null-witness invariant check removed",
    anchor: 'if (result.status === "FOUND" && result.witness === null) {',
    replacement: "if (false) {",
    killedBy: "witness: throws on contradictory BFS results",
  },
];

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function listFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

// Verified write: the VM's storage fault intermittently makes
// writeFileSync succeed while writing 0 bytes (or throw EPERM), so
// every write is checked by byte length AND SHA-256 of the content
// read back, and retried. Used for scratch files AND evidence.
function writeFileVerified(path, text) {
  const expectedSize = Buffer.byteLength(text, "utf8");
  const expectedSha = sha256(text);
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    try {
      writeFileSync(path, text, "utf-8");
      const back = readFileSync(path, "utf8");
      if (statSync(path).size === expectedSize && sha256(back) === expectedSha) return;
      lastError = new Error(`content mismatch after write (attempt ${attempt})`);
    } catch (err) {
      lastError = err;
    }
    sleepSync(5000);
  }
  throw new Error(
    `cannot write ${path} after ${MAX_WRITE_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function copyFileVerified(src, dest) {
  const text = readFileSync(src, "utf8");
  writeFileVerified(dest, text);
  const destSha = sha256(readFileSync(dest, "utf8"));
  if (destSha !== sha256(text)) {
    throw new Error(`copy verification failed: ${src} -> ${dest}`);
  }
}

function copyTreeVerified(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTreeVerified(src, dest);
    } else if (entry.isFile()) {
      copyFileVerified(src, dest);
    }
  }
}

function setupScratch() {
  if (existsSync(SCRATCH_ROOT)) {
    rmSync(SCRATCH_ROOT, { recursive: true, force: true });
  }
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  copyTreeVerified(join(PROJECT_ROOT, "src"), join(SCRATCH_ROOT, "src"));
  copyTreeVerified(join(PROJECT_ROOT, "tests"), join(SCRATCH_ROOT, "tests"));
  for (const f of ["package.json", "tsconfig.json", "tsconfig.scripts.json"]) {
    copyFileVerified(join(PROJECT_ROOT, f), join(SCRATCH_ROOT, f));
  }
  if (existsSync(join(PROJECT_ROOT, "vitest.config.ts"))) {
    copyFileVerified(join(PROJECT_ROOT, "vitest.config.ts"), join(SCRATCH_ROOT, "vitest.config.ts"));
  }
  // node_modules is a symlink: vitest resolves its own binary and the
  // test imports through it; nothing is ever written into it by the run
  // except vitest's cache, which tolerates write failures.
  symlinkSync(join(PROJECT_ROOT, "node_modules"), join(SCRATCH_ROOT, "node_modules"), "dir");
  // Verify the scratch tree matches the real tree file for file.
  const realFiles = listFiles(join(PROJECT_ROOT, "src"))
    .concat(listFiles(join(PROJECT_ROOT, "tests")))
    .sort();
  for (const f of realFiles) {
    const rel = relative(PROJECT_ROOT, f);
    const scratchFile = join(SCRATCH_ROOT, rel);
    if (!existsSync(scratchFile)) throw new Error(`scratch setup missing ${rel}`);
    if (sha256(readFileSync(scratchFile, "utf8")) !== sha256(readFileSync(f, "utf8"))) {
      throw new Error(`scratch setup mismatch for ${rel}`);
    }
  }
}

function runVitest(testFiles) {
  const vitestEntry = join(SCRATCH_ROOT, "node_modules", "vitest", "vitest.mjs");
  const started = Date.now();
  const res = spawnSync(
    process.execPath,
    [vitestEntry, "run", ...testFiles, "--no-file-parallelism"],
    { cwd: SCRATCH_ROOT, timeout: PER_MUTANT_TIMEOUT_MS, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const durationMs = Date.now() - started;
  const rawOutput = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  // Vitest emits ANSI colour codes even on a pipe, so the "Tests N
  // failed | M passed" summary cannot be matched literally: strip
  // the escapes first, otherwise every killed mutant looks
  // INCONCLUSIVE (exit 1 with failed=0).
  const output = rawOutput.replace(/\[[0-9;]*m/g, "");
  const failedMatch = output.match(/Tests\s+(\d+) failed/);
  const failedCount = failedMatch ? Number(failedMatch[1]) : 0;
  const passedMatch = output.match(/Tests\s+(\d+) passed/);
  const passedCount = passedMatch ? Number(passedMatch[1]) : 0;
  return {
    exitCode: res.status,
    signal: res.signal,
    timedOut: res.error?.code === "ETIMEDOUT",
    failedCount,
    passedCount,
    outputTail: output.slice(-1200),
  };
}

function main() {
  const onlyId = process.argv.includes("--mutant")
    ? process.argv[process.argv.indexOf("--mutant") + 1]
    : null;
  const mutants = onlyId ? MUTANTS.filter((m) => m.id === onlyId) : MUTANTS;
  if (onlyId && mutants.length === 0) {
    console.error(`unknown mutant id: ${onlyId}`);
    process.exit(2);
  }

  // Pre-run manifest of the REAL src/ tree (read-only check).
  const realSrcFiles = listFiles(join(PROJECT_ROOT, "src")).sort();
  const preManifest = new Map(
    realSrcFiles.map((f) => [relative(PROJECT_ROOT, f), sha256(readFileSync(f, "utf8"))]),
  );

  console.log(`setting up scratch tree at ${SCRATCH_ROOT} ...`);
  setupScratch();
  console.log("scratch tree verified against the real tree.");

  const results = [];
  let configErrors = 0;

  for (const mutant of mutants) {
    const realPath = join(PROJECT_ROOT, mutant.file);
    const scratchPath = join(SCRATCH_ROOT, mutant.file);
    const original = readFileSync(realPath, "utf8");
    const occurrences = original.split(mutant.anchor).length - 1;
    if (occurrences !== 1) {
      console.error(`CONFIG ERROR ${mutant.id}: anchor occurs ${occurrences}x in ${mutant.file} (expected exactly 1)`);
      results.push({ ...mutant, status: "CONFIG_ERROR", killed: false, exitCode: null, durationMs: 0 });
      configErrors += 1;
      continue;
    }
    const mutated = original.replace(mutant.anchor, mutant.replacement);
    if (mutated === original) {
      console.error(`CONFIG ERROR ${mutant.id}: replacement equals original in ${mutant.file}`);
      results.push({ ...mutant, status: "CONFIG_ERROR", killed: false, exitCode: null, durationMs: 0 });
      configErrors += 1;
      continue;
    }

    const started = Date.now();
    let run = null;
    let status = "SURVIVED";
    try {
      // Mutate ONLY the scratch copy; the real file is never written.
      writeFileVerified(scratchPath, mutated);
      run = runVitest(TESTS[mutant.group]);
      if (run.timedOut) {
        status = "TIMEOUT";
      } else if (run.exitCode !== 0 && run.failedCount > 0) {
        status = "KILLED";
      } else if (run.exitCode !== 0) {
        // Non-zero exit but no failed test counted: infrastructure
        // fault (e.g. EPERM), not a kill. Re-run once to confirm.
        const retry = runVitest(TESTS[mutant.group]);
        if (retry.exitCode !== 0 && retry.failedCount > 0) {
          run = retry;
          status = "KILLED";
        } else if (retry.exitCode === 0) {
          run = retry;
          status = "SURVIVED";
        } else {
          run = retry;
          status = "INCONCLUSIVE";
        }
      } else {
        status = "SURVIVED";
      }
    } catch (err) {
      status = "ERROR";
      run = { exitCode: null, failedCount: 0, passedCount: 0, outputTail: String(err), timedOut: false };
    } finally {
      // Restore the scratch copy from the pristine real file.
      writeFileVerified(scratchPath, original);
    }
    const durationMs = Date.now() - started;
    console.log(`${status} ${mutant.id} (${mutant.name}) exit=${run?.exitCode} failed=${run?.failedCount} ${durationMs}ms`);
    results.push({
      id: mutant.id,
      file: mutant.file,
      group: mutant.group,
      name: mutant.name,
      killedBy: mutant.killedBy,
      status,
      killed: status === "KILLED",
      exitCode: run?.exitCode ?? null,
      failedTests: run?.failedCount ?? 0,
      passedTests: run?.passedCount ?? 0,
      durationMs,
      outputTail: status === "SURVIVED" || status === "INCONCLUSIVE" || status === "ERROR" ? (run?.outputTail ?? "") : undefined,
    });
  }

  // The real tree must be byte-identical to before the run.
  let treeOk = true;
  for (const [rel, hash] of preManifest) {
    const now = sha256(readFileSync(join(PROJECT_ROOT, rel), "utf8"));
    if (now !== hash) {
      console.error(`REAL TREE MISMATCH after mutation run: ${rel} changed (the runner never writes it — investigate)`);
      treeOk = false;
    }
  }
  if (!treeOk) process.exit(2);

  const total = results.length;
  const killed = results.filter((r) => r.status === "KILLED").length;
  const survived = results.filter((r) => r.status === "SURVIVED").map((r) => r.id);
  const inconclusive = results.filter((r) => ["INCONCLUSIVE", "TIMEOUT", "ERROR"].includes(r.status)).map((r) => r.id);
  const equivalentCount = EQUIVALENT.length;
  const score = total - equivalentCount === 0 ? 1 : killed / (total - equivalentCount);

  const payload = {
    schema: "locatorstress.t011-mutation-results/v1",
    threshold: MUTATION_SCORE_THRESHOLD,
    thresholdRationale:
      "Hand-written single-edit semantic mutants on frozen pure functions; each changes one spec-pinned decision, so the suite should catch >= 90%. Any non-equivalent survivor is a test gap (FAIL).",
    totals: { total, killed, survived: survived.length, inconclusive: inconclusive.length, equivalent: equivalentCount, configErrors },
    mutationScore: score,
    passed: score >= MUTATION_SCORE_THRESHOLD && inconclusive.length === 0 && configErrors === 0 && treeOk,
    survived,
    inconclusive,
    equivalent: EQUIVALENT,
    results,
  };

  const payloadText = JSON.stringify(payload, null, 2) + "\n";
  mkdirSync(join(PROJECT_ROOT, "evidence", "s4"), { recursive: true });
  let evidenceWritten = false;
  try {
    writeFileVerified(EVIDENCE_PATH, payloadText);
    evidenceWritten = true;
  } catch (err) {
    console.error(`evidence write to ${EVIDENCE_PATH} failed (EPERM fault): ${err.message}`);
    // Fall back to the scratch copy so the results are not lost; the
    // coordinator can copy it into evidence/s4/ when the fault clears.
    try {
      writeFileVerified(join(SCRATCH_ROOT, "T011_MUTATION_RESULTS.json"), payloadText);
      console.error(`results preserved at ${join(SCRATCH_ROOT, "T011_MUTATION_RESULTS.json")}`);
    } catch (err2) {
      console.error(`scratch evidence write also failed: ${err2.message}`);
    }
  }

  console.log(`\nMutation score: ${killed}/${total - equivalentCount} = ${(score * 100).toFixed(1)}% (threshold ${(MUTATION_SCORE_THRESHOLD * 100).toFixed(0)}%)`);
  console.log(`Killed: ${killed}, Survived: ${survived.length} [${survived.join(", ")}], Inconclusive: ${inconclusive.length} [${inconclusive.join(", ")}], Config errors: ${configErrors}`);
  console.log(`Evidence written to ${EVIDENCE_PATH}: ${evidenceWritten}`);
  process.exit(payload.passed && evidenceWritten ? 0 : 1);
}

main();
```

## scripts/node-shims.d.ts

- 行数：75；字节数：2503；SHA-256：`a66b9139de5ebadce08f5f57da5ea410c56d0cd6f89bed5207014a167474e968`

```ts
// Minimal ambient declarations for the Node.js built-ins used by scripts/.
// The project has no @types/node dependency (by design: no new dependencies),
// and the build tsconfig (include ["src"]) is untouched. These declarations
// cover exactly the API surface used by scripts/s0-gate.ts and
// scripts/repeat-hash.ts, so `npm run typecheck:scripts` can run strict
// tsc --noEmit over scripts/ without them.

declare module "node:crypto" {
  interface Hash {
    update(data: string, encoding: string): Hash;
    digest(encoding: "hex"): string;
  }
  export function createHash(algorithm: string): Hash;
}

declare module "node:child_process" {
  interface ChildProcessStream {
    on(event: "data", listener: (chunk: Buffer) => void): void;
  }
  interface ChildProcess {
    stdout: ChildProcessStream;
    stderr: ChildProcessStream;
    on(event: "error", listener: (err: unknown) => void): void;
    on(event: "close", listener: (code: number | null) => void): void;
    kill(signal?: string): void;
  }
  export function spawn(
    command: string,
    args: string[],
    options?: { cwd?: string; stdio?: unknown },
  ): ChildProcess;
  export function spawnSync(
    command: string,
    args: string[],
    options: { cwd?: string; timeout?: number; encoding?: string; stdio?: unknown },
  ): { stdout: string; stderr: string; status: number | null };
}

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function rmSync(path: string, options?: { force?: boolean; recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string, encoding: "utf8"): void;
  export function mkdtempSync(prefix: string): string;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare const process: {
  argv: string[];
  version: string;
  versions: { node: string };
  cwd(): string;
  execPath: string;
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  stdout: { write(s: string): void };
  stderr: { write(s: string): void };
};

declare class Buffer extends Uint8Array {
  toString(encoding?: string): string;
}
```
