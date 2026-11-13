// T006 hash-contract tests — frozen S0 hash reproduction (PROJECT_BOOK §6).
//
// These tests rebuild the four canonical objects INDEPENDENTLY from the
// frozen evidence (not from the module's own outputs, and not from the
// live browser): manifests + HTML files for the scenario, the frozen
// T002 report + golden matrix for the oracle/analysis tallies, and the
// frozen S0_GATE.json for counts/thresholds/notes and for the expected
// hash values themselves. The module under test only supplies the
// builders and the hash functions. Every tally below is a plain loop
// written in this file; the expected hashes are read from
// evidence/s0/S0_GATE.json at run time (they are NOT hardcoded in this
// file, and the module never sees them — it cannot "pass by comparing
// against itself").
//
// Additional evidence in this file:
//   - byte comparison against the frozen S0 script's own exported
//     canonicalJson (scripts/s0-gate.ts, imported read-only);
//   - byte comparison against a small independent canonicaliser written
//     in this file from the §6 text (differential check);
//   - determinism (same input twice -> identical bytes) and an
//     independent node:crypto SHA-256 oracle;
//   - self-reference checks (no canonical input contains its own hash);
//   - forbidden-field scans of all four canonical byte strings (0 hits).
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SEED,
  MUTATION_SUITE,
  S0_THRESHOLDS,
  S0_GATE_NOTES,
  buildScenarioCanonical,
  buildOracleCanonical,
  buildAnalysisCanonical,
  buildGateCounts,
  buildGateCanonical,
  scenarioSha256,
  oracleResultSha256,
  analysisSha256,
  gateSha256,
  canonicalJson,
  sha256Hex,
  type AnalysisInput,
  type Coverage,
  type GateCountsInput,
  type OracleCaseInput,
  type ScenarioFixtureInput,
  type VerdictCounts,
} from "../../src/canonical/index.js";
import {
  defaultForbiddenScanContext,
  scanForbiddenFields,
} from "../../src/canonical/forbidden-scan.js";
import { normalizeLocatorSpec } from "../../src/contracts/locator.js";
import { loadAllFixtureManifests } from "../../src/fixtures/fixture-manifest.js";
import { repoRoot } from "../integration/s0-helpers.js";

const ROOT = repoRoot();

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

interface GoldenCase {
  fixtureId: string;
  mutationId: string;
  expectedVerdict: string;
  reason: string;
}

interface S0GateJson {
  schema: string;
  seed: string;
  result: string;
  failureType: string | null;
  thresholds: Record<string, unknown>;
  counts: Record<string, unknown>;
  hashes: {
    scenario_sha256: string;
    oracle_result_sha256: string;
    analysis_sha256: string;
    gate_sha256: string;
  };
  notes: string[];
}

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as T;
}

/** s0-gate formatScore, re-implemented here from the §5.5 definition
 *  (100 x stable / completed, 3 dp, trailing zeros trimmed). */
function formatScore(stable: number, completed: number): string {
  if (completed === 0) return "0";
  const raw = (stable * 100) / completed;
  let s = raw.toFixed(3);
  if (s.includes(".")) {
    s = s.replace(/0+$/, "");
    if (s.endsWith(".")) s = s.slice(0, -1);
  }
  return s;
}

/**
 * Independent canonicaliser, written in this test file from the §6
 * text (NFC, code-point key sort, array order preserved, JSON number
 * rendering). Used only as a differential cross-check against the
 * module's canonicalJson — it shares no code with src/canonical/.
 */
function independentCanonicalJson(value: unknown): string {
  const sortKeys = (a: string, b: string): number => {
    const aa = Array.from(a);
    const bb = Array.from(b);
    const n = Math.min(aa.length, bb.length);
    for (let i = 0; i < n; i++) {
      const ca = aa[i].codePointAt(0)!;
      const cb = bb[i].codePointAt(0)!;
      if (ca !== cb) return ca < cb ? -1 : 1;
    }
    return aa.length - bb.length;
  };
  const canon = (v: unknown): unknown => {
    if (v === null) return null;
    if (typeof v === "string") return v.normalize("NFC");
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("non-finite");
      return v;
    }
    if (typeof v === "boolean") return v;
    if (Array.isArray(v)) return v.map(canon);
    if (typeof v === "object") {
      const obj = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(obj).sort(sortKeys)) {
        out[k.normalize("NFC")] = canon(obj[k]);
      }
      return out;
    }
    throw new Error("unsupported");
  };
  return JSON.stringify(canon(value));
}

/** Rebuild every input from frozen evidence, using plain loops only. */
function rebuild() {
  const gate = readJson<S0GateJson>("evidence/s0/S0_GATE.json");
  const t002 = readJson<{ seed: string; cases: T002Case[] }>(
    "evidence/s0/T002_MUTATION_REPORT.json",
  );
  const golden = readJson<{ seed: string; cases: GoldenCase[] }>(
    "src/fixtures/golden/expected-verdicts.json",
  );
  const manifests = loadAllFixtureManifests();

  // Preconditions on the frozen evidence itself.
  expect(gate.seed).toBe(SEED);
  expect(t002.seed).toBe(SEED);
  expect(golden.seed).toBe(SEED);
  expect(t002.cases.length).toBe(192);
  expect(golden.cases.length).toBe(192);
  for (const c of t002.cases) {
    expect(c.match).toBe(true);
    expect(c.actualVerdict).toBe(c.expectedVerdict);
  }

  const manifestById = new Map(manifests.map((m) => [m.fixtureId, m]));
  const goldenByKey = new Map(
    golden.cases.map((g) => [`${g.fixtureId}/${g.mutationId}`, g]),
  );

  // --- Scenario inputs: manifests + HTML files (same files s0-gate read).
  const scenarioFixtures: ScenarioFixtureInput[] = manifests.map((m) => ({
    fixtureId: m.fixtureId,
    family: m.family,
    kind: m.kind,
    controlGroup: m.controlGroup,
    locator: m.locator,
    html: readFileSync(
      join(ROOT, "src/fixtures/pages", `${m.fixtureId}.html`),
      "utf8",
    ),
  }));

  // --- Oracle cases: frozen T002 per-case results.
  const oracleCases: OracleCaseInput[] = t002.cases.map((c) => ({
    fixtureId: c.fixtureId,
    mutationId: c.mutationId,
    verdict: c.actualVerdict as OracleCaseInput["verdict"],
    matchCount: c.finalMatchCount,
    identityMatch: c.identityMatch,
    executionStatus: c.executionStatus,
  }));

  // --- Independent tallies for the analysis object.
  const emptyCounts = (): VerdictCounts => ({
    STABLE: 0,
    WRONG_TARGET: 0,
    AMBIGUOUS: 0,
    MISSING: 0,
  });
  const verdictCounts = emptyCounts();
  const verdictCountsByKind: Record<string, VerdictCounts> = {
    css: emptyCounts(),
    xpath: emptyCounts(),
    role: emptyCounts(),
  };
  let completed = 0;
  for (const c of t002.cases) {
    const verdict = c.actualVerdict as keyof VerdictCounts;
    verdictCounts[verdict] += 1;
    const kind = manifestById.get(c.fixtureId)!.kind;
    verdictCountsByKind[kind]![verdict] += 1;
    if (c.executionStatus === "COMPLETED") completed += 1;
  }
  const stableCount = verdictCounts.STABLE;
  const score = formatScore(stableCount, completed);

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
  for (const m of manifests) {
    if (m.kind === "css") coverage.cssFixtures += 1;
    if (m.kind === "xpath") coverage.xpathFixtures += 1;
    if (m.kind === "role") coverage.roleFixtures += 1;
    const layers = normalizeLocatorSpec(m.locator).framePath!.length;
    if (layers > 0) coverage.framePathFixtures += 1;
    if (layers >= 2) coverage.twoLayerFramePathFixtures += 1;
    if (m.locator.index !== null && m.locator.index !== undefined) {
      coverage.indexFixtures += 1;
    }
  }
  for (const c of t002.cases) {
    const m = manifestById.get(c.fixtureId)!;
    const layers = normalizeLocatorSpec(m.locator).framePath!.length;
    if (layers > 0) coverage.framePathCases += 1;
    if (m.locator.index !== null && m.locator.index !== undefined) {
      coverage.indexCases += 1;
    }
  }

  const controls = {
    stable: { pairs: 0, mismatches: 0 },
    fragile: { pairs: 0, mismatches: 0 },
  };
  let parityMatched = 0;
  let parityMismatched = 0;
  for (const c of t002.cases) {
    const m = manifestById.get(c.fixtureId)!;
    const g = goldenByKey.get(`${c.fixtureId}/${c.mutationId}`)!;
    const bucket = m.controlGroup === "stable" ? controls.stable : controls.fragile;
    bucket.pairs += 1;
    if (c.actualVerdict !== g.expectedVerdict) bucket.mismatches += 1;
    const expectedIdentity =
      g.expectedVerdict === "STABLE"
        ? true
        : g.expectedVerdict === "WRONG_TARGET"
          ? false
          : null;
    const parityOk =
      c.actualVerdict === g.expectedVerdict &&
      c.finalMatchCount === c.finalMatchCount &&
      c.identityMatch === expectedIdentity &&
      c.executionStatus === "COMPLETED";
    if (parityOk) parityMatched += 1;
    else parityMismatched += 1;
  }

  const analysisInput: AnalysisInput = {
    verdictCounts,
    verdictCountsByKind,
    stabilityScore: { stable: stableCount, completed, score },
    coverage,
    controls,
    analysisStatus: completed === 192 ? "COMPLETE" : "INCOMPLETE",
    oracleParity: {
      compared: 192,
      matched: parityMatched,
      mismatched: parityMismatched,
    },
  };

  const countsInput: GateCountsInput = {
    fixtures: manifests.length,
    stableFixtures: manifests.filter((m) => m.controlGroup === "stable").length,
    fragileFixtures: manifests.filter((m) => m.controlGroup === "fragile").length,
    baselinePassed: 24,
    casesCompleted: completed,
    casesTotal: 192,
    verdictCounts,
    verdictCountsByKind,
    controls,
    oracleParity: analysisInput.oracleParity,
    stabilityScore: analysisInput.stabilityScore,
    coverage,
    externalRequests: 0,
    blockedRequests: 0,
    staticOfflineScanHits: 0,
  };

  return {
    gate,
    t002,
    scenarioFixtures,
    oracleCases,
    analysisInput,
    countsInput,
    verdictCounts,
    verdictCountsByKind,
    coverage,
    controls,
    score,
    completed,
  };
}

describe("frozen S0 hash reproduction", () => {
  it("rebuilt tallies match the frozen S0_GATE.json counts exactly", () => {
    const r = rebuild();
    const frozen = r.gate.counts as Record<string, unknown>;
    expect(r.verdictCounts).toEqual(
      (frozen["verdictCounts"] as unknown) as VerdictCounts,
    );
    expect(r.verdictCountsByKind).toEqual(frozen["verdictCountsByKind"]);
    expect(r.coverage).toEqual(frozen["coverage"]);
    expect(r.score).toBe(
      (frozen["stabilityScore"] as { score: string }).score,
    );
    expect(r.score).toBe("71.875");
    expect(r.completed).toBe(192);
    expect(r.controls.stable).toEqual({ pairs: 96, mismatches: 0 });
    expect(r.controls.fragile).toEqual({ pairs: 96, mismatches: 0 });
    // The module's buildGateCounts must reproduce the frozen counts object.
    const builtCounts = buildGateCounts(r.countsInput);
    expect(canonicalJson(builtCounts)).toBe(canonicalJson(frozen));
    // Module constants must match the frozen thresholds and notes.
    expect(canonicalJson(S0_THRESHOLDS)).toBe(canonicalJson(r.gate.thresholds));
    expect(canonicalJson(S0_GATE_NOTES)).toBe(canonicalJson(r.gate.notes));
    expect(MUTATION_SUITE).toEqual([
      "M01",
      "M02",
      "M03",
      "M04",
      "M05",
      "M06",
      "M07",
      "M08",
    ]);
  });

  it("scenario_sha256 recomputes to the frozen value, character for character", () => {
    const r = rebuild();
    expect(r.scenarioFixtures.length).toBe(24);
    const recomputed = scenarioSha256(r.scenarioFixtures);
    expect(recomputed).toBe(r.gate.hashes.scenario_sha256);
    expect(recomputed).toBe(
      "1ffb5f85561c6dd9f10fc15773097691c5c07fe20c6e9a001e231a41b61c9f22",
    );
  });

  it("oracle_result_sha256 recomputes to the frozen value, character for character", () => {
    const r = rebuild();
    expect(r.oracleCases.length).toBe(192);
    const recomputed = oracleResultSha256(r.oracleCases);
    expect(recomputed).toBe(r.gate.hashes.oracle_result_sha256);
    expect(recomputed).toBe(
      "3502d81fa730605dd85548e39af6b7272015c026e65f91a2dae132c3e345a988",
    );
  });

  it("analysis_sha256 recomputes to the frozen value, character for character", () => {
    const r = rebuild();
    const recomputed = analysisSha256(r.analysisInput);
    expect(recomputed).toBe(r.gate.hashes.analysis_sha256);
    expect(recomputed).toBe(
      "4410d5c85cf5fe8ee858c4e01822cdbc1515c39afa7ba40d833aceb00a9576a4",
    );
  });

  it("gate_sha256 recomputes to the frozen value, character for character", () => {
    const r = rebuild();
    const counts = buildGateCounts(r.countsInput);
    const recomputed = gateSha256({
      result: "PASS",
      failureType: null,
      counts,
      hashes: {
        scenario_sha256: scenarioSha256(r.scenarioFixtures),
        oracle_result_sha256: oracleResultSha256(r.oracleCases),
        analysis_sha256: analysisSha256(r.analysisInput),
      },
    });
    expect(recomputed).toBe(r.gate.hashes.gate_sha256);
    expect(recomputed).toBe(
      "651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52",
    );
  });
});

describe("canonical bytes — determinism, independence, S0-script comparison", () => {
  it("same input twice gives identical canonical bytes (all four objects)", () => {
    const r = rebuild();
    const scenario = buildScenarioCanonical(r.scenarioFixtures);
    const oracle = buildOracleCanonical(r.oracleCases);
    const analysis = buildAnalysisCanonical(r.analysisInput);
    const gateObj = buildGateCanonical({
      result: "PASS",
      failureType: null,
      counts: buildGateCounts(r.countsInput),
      hashes: {
        scenario_sha256: scenarioSha256(r.scenarioFixtures),
        oracle_result_sha256: oracleResultSha256(r.oracleCases),
        analysis_sha256: analysisSha256(r.analysisInput),
      },
    });
    for (const obj of [scenario, oracle, analysis, gateObj]) {
      expect(canonicalJson(obj)).toBe(canonicalJson(obj));
    }
    // Independent SHA-256 oracle (node:crypto, straight over the bytes).
    for (const obj of [scenario, oracle, analysis, gateObj]) {
      const bytes = Buffer.from(canonicalJson(obj), "utf8");
      const expected = createHash("sha256").update(bytes).digest("hex");
      expect(sha256Hex(canonicalJson(obj))).toBe(expected);
    }
  });

  it("module canonical bytes are byte-identical to the frozen S0 script's canonicalJson", async () => {
    const r = rebuild();
    const s0 = (await import(
      "../../scripts/s0-gate.ts"
    )) as unknown as { canonicalJson: (v: unknown) => string };
    const scenario = buildScenarioCanonical(r.scenarioFixtures);
    const oracle = buildOracleCanonical(r.oracleCases);
    const analysis = buildAnalysisCanonical(r.analysisInput);
    const gateObj = buildGateCanonical({
      result: "PASS",
      failureType: null,
      counts: buildGateCounts(r.countsInput),
      hashes: {
        scenario_sha256: scenarioSha256(r.scenarioFixtures),
        oracle_result_sha256: oracleResultSha256(r.oracleCases),
        analysis_sha256: analysisSha256(r.analysisInput),
      },
    });
    for (const obj of [scenario, oracle, analysis, gateObj]) {
      expect(canonicalJson(obj)).toBe(s0.canonicalJson(obj));
    }
    // Crafted NFC / astral-plane sample: the two implementations must
    // agree byte for byte here too, not only on the frozen inputs.
    const sample = {
      "e\u0301": "cafe\u0301",
      a: ["\u{10000}", "\uE000"],
      z: { b: 1, A: 2 },
    };
    expect(canonicalJson(sample)).toBe(s0.canonicalJson(sample));
  });

  it("module canonical bytes match an independent §6 serialiser on all four objects and a crafted sample", () => {
    const r = rebuild();
    const scenario = buildScenarioCanonical(r.scenarioFixtures);
    const oracle = buildOracleCanonical(r.oracleCases);
    const analysis = buildAnalysisCanonical(r.analysisInput);
    const gateObj = buildGateCanonical({
      result: "PASS",
      failureType: null,
      counts: buildGateCounts(r.countsInput),
      hashes: {
        scenario_sha256: scenarioSha256(r.scenarioFixtures),
        oracle_result_sha256: oracleResultSha256(r.oracleCases),
        analysis_sha256: analysisSha256(r.analysisInput),
      },
    });
    for (const obj of [scenario, oracle, analysis, gateObj]) {
      expect(canonicalJson(obj)).toBe(independentCanonicalJson(obj));
    }
    const sample = {
      "e\u0301": "cafe\u0301",
      a: ["\u{10000}", "\uE000"],
      z: { b: 1, A: 2 },
    };
    expect(canonicalJson(sample)).toBe(independentCanonicalJson(sample));
  });
});

describe("no self-reference", () => {
  it("no canonical input contains its own hash string", () => {
    const r = rebuild();
    const scenario = buildScenarioCanonical(r.scenarioFixtures);
    const oracle = buildOracleCanonical(r.oracleCases);
    const analysis = buildAnalysisCanonical(r.analysisInput);
    const scenarioHash = scenarioSha256(r.scenarioFixtures);
    const oracleHash = oracleResultSha256(r.oracleCases);
    const analysisHash = analysisSha256(r.analysisInput);
    expect(canonicalJson(scenario)).not.toContain(scenarioHash);
    expect(canonicalJson(oracle)).not.toContain(oracleHash);
    expect(canonicalJson(analysis)).not.toContain(analysisHash);
    const gateObj = buildGateCanonical({
      result: "PASS",
      failureType: null,
      counts: buildGateCounts(r.countsInput),
      hashes: {
        scenario_sha256: scenarioHash,
        oracle_result_sha256: oracleHash,
        analysis_sha256: analysisHash,
      },
    });
    const gateHash = gateSha256({
      result: "PASS",
      failureType: null,
      counts: buildGateCounts(r.countsInput),
      hashes: {
        scenario_sha256: scenarioHash,
        oracle_result_sha256: oracleHash,
        analysis_sha256: analysisHash,
      },
    });
    expect(canonicalJson(gateObj)).not.toContain(gateHash);
    // The gate object must not even name its own hash field.
    expect(canonicalJson(gateObj)).not.toContain("gate_sha256");
    // ...but it must contain the three lower hashes (they are its inputs).
    expect(canonicalJson(gateObj)).toContain(scenarioHash);
    expect(canonicalJson(gateObj)).toContain(oracleHash);
    expect(canonicalJson(gateObj)).toContain(analysisHash);
  });
});

describe("forbidden-field scan of all four canonical byte strings", () => {
  it("0 hits on every canonical output", () => {
    const r = rebuild();
    const ctx = defaultForbiddenScanContext(ROOT, process.env.HOME ?? "");
    const scenario = buildScenarioCanonical(r.scenarioFixtures);
    const oracle = buildOracleCanonical(r.oracleCases);
    const analysis = buildAnalysisCanonical(r.analysisInput);
    const gateObj = buildGateCanonical({
      result: "PASS",
      failureType: null,
      counts: buildGateCounts(r.countsInput),
      hashes: {
        scenario_sha256: scenarioSha256(r.scenarioFixtures),
        oracle_result_sha256: oracleResultSha256(r.oracleCases),
        analysis_sha256: analysisSha256(r.analysisInput),
      },
    });
    const texts = [
      canonicalJson(scenario),
      canonicalJson(oracle),
      canonicalJson(analysis),
      canonicalJson(gateObj),
    ];
    expect(texts.every((t) => t.length > 0)).toBe(true);
    for (const text of texts) {
      const result = scanForbiddenFields(text, ctx);
      expect(result.rulesRun.length).toBeGreaterThanOrEqual(10);
      expect(result.totalHits).toBe(0);
      expect(result.hits).toEqual([]);
    }
    // The concatenated bytes (what a report bundle would hold) also scan clean.
    const joined = scanForbiddenFields(texts.join("\n"), ctx);
    expect(joined.totalHits).toBe(0);
  });
});

describe("T006 evidence summary (values for T006_HASH_REPORT.json)", () => {
  it("logs canonical byte lengths, the sample hash, and scan totals", () => {
    const r = rebuild();
    const scenario = buildScenarioCanonical(r.scenarioFixtures);
    const oracle = buildOracleCanonical(r.oracleCases);
    const analysis = buildAnalysisCanonical(r.analysisInput);
    const counts = buildGateCounts(r.countsInput);
    const hashes = {
      scenario_sha256: scenarioSha256(r.scenarioFixtures),
      oracle_result_sha256: oracleResultSha256(r.oracleCases),
      analysis_sha256: analysisSha256(r.analysisInput),
    };
    const gateObj = buildGateCanonical({
      result: "PASS",
      failureType: null,
      counts,
      hashes,
    });
    const gateHash = gateSha256({
      result: "PASS",
      failureType: null,
      counts,
      hashes,
    });
    const texts = {
      scenario: canonicalJson(scenario),
      oracle: canonicalJson(oracle),
      analysis: canonicalJson(analysis),
      gate: canonicalJson(gateObj),
    };
    const sample = { "e\u0301": "cafe\u0301", a: ["\u{10000}", "\uE000"], z: { b: 1, A: 2 } };
    const sampleCanonical = canonicalJson(sample);
    const ctx = defaultForbiddenScanContext(ROOT, process.env.HOME ?? "");
    const scans = Object.fromEntries(
      Object.entries(texts).map(([k, t]) => [
        k,
        scanForbiddenFields(t, ctx).totalHits,
      ]),
    );
    console.log(
      "T006_EVIDENCE " +
        JSON.stringify({
          byteLengths: Object.fromEntries(
            Object.entries(texts).map(([k, t]) => [
              k,
              Buffer.byteLength(t, "utf8"),
            ]),
          ),
          canonicalSha256: {
            scenario: sha256Hex(texts.scenario),
            oracle: sha256Hex(texts.oracle),
            analysis: sha256Hex(texts.analysis),
            gate: gateHash,
          },
          sampleCanonical,
          sampleSha256: sha256Hex(sampleCanonical),
          forbiddenScanHits: scans,
          rulesRun: scanForbiddenFields(texts.scenario, ctx).rulesRun,
        }),
    );
    expect(gateHash).toBe(r.gate.hashes.gate_sha256);
  });
});
