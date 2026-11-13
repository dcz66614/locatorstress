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
