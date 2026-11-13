// FIX-R1-03 — `demo` command (P022-R1-P1-03, PROJECT_BOOK §7.3).
//
//   npm run demo [--out <path>]
//
// Runs a fixed, deterministic, offline demo: baseline + M01–M08
// analysis for fixtures F001, F002, F003 plus the same BFS samples
// the T008 report uses (F001 depth 2, F002 depth 1, F003 depth 1),
// then assembles a real full AnalysisReport with the frozen
// buildAnalysisReport() and stores it as run `demo`
// (runs/demo.json). Everything goes through the frozen
// AnalysisService (real Playwright + M01–M08 + Oracle + BFS); the
// demo computes nothing itself except the report assembly inputs
// (parity counts, the static offline scan) — the same inputs the
// T008 script computes.
//
// Determinism: fixed fixture set, fixed BFS bounds, fixed seed, no
// wall-clock time, no random ids, no ports in the output. Running
// the demo twice produces byte-identical stdout and an identical
// runs/demo.json.
//
// Honesty note: the demo covers 3 of the 24 fixtures (24 cases),
// so it is NOT the 192-case gate. The stored report says so in its
// notes and carries gateResult FAIL / failureType DEMO_SUBSET — the
// gate field is this report's own gate, not the frozen S0 gate
// (651c3fd4…). The S0 gate is untouched; `npm run s0:gate` still
// reports it.
//
// Offline: the demo browser aborts every non-loopback request
// (frozen launchBaselineBrowser); the run prints the external
// request count, which must be 0.

import { canonicalJson } from "../../canonical/canonical-json.js";
import type { ScenarioFixtureInput } from "../../canonical/hashes.js";
import { buildAnalysisReport } from "../../analysis/witness.js";
import type { ReportCase } from "../../contracts/report.js";
import type { WitnessSummary } from "../../contracts/report.js";
import type { FixtureAnalysis } from "../../api/service.js";
import { mapApiError, withBrowserService } from "../browser-service.js";
import { isCliError, parseFlags, rejectPositionals } from "../args.js";
import type { ParsedFlags } from "../args.js";
import { runtimeError } from "../errors.js";
import { DEMO_RUN_ID, saveRun, writeFileVerified } from "../run-store.js";
import type { CliRunEnvelope } from "../run-store.js";
import { loadAllFixtureManifests } from "../../fixtures/fixture-manifest.js";
import { loadFixture } from "../../fixtures/fixture-loader.js";

export const DEMO_USAGE = "usage: npm run demo [--out <path>]";

/** Fixed demo fixtures, in order. F001 stable, F002/F003 fragile. */
export const DEMO_FIXTURES = ["F001", "F002", "F003"] as const;

/** Fixed BFS samples: the same bounds the T008 report uses. */
export const DEMO_SEARCHES = [
  { fixtureId: "F001", maxDepth: 2 },
  { fixtureId: "F002", maxDepth: 1 },
  { fixtureId: "F003", maxDepth: 1 },
] as const;

const VALUE_FLAGS = new Set(["out"]);
const BOOLEAN_FLAGS = new Set(["help"]);

function verdictLine(counts: Record<string, number>): string {
  return ["STABLE", "WRONG_TARGET", "AMBIGUOUS", "MISSING"]
    .map((v) => `${v} ${counts[v] ?? 0}`)
    .join(" / ");
}

export async function runDemo(argv: readonly string[]): Promise<number> {
  const flags: ParsedFlags = parseFlags(argv, VALUE_FLAGS, BOOLEAN_FLAGS);
  if (flags.values.has("help")) {
    process.stdout.write(`${DEMO_USAGE}\n`);
    return 0;
  }
  rejectPositionals(flags);
  const outPath = flags.values.get("out");

  const manifests = loadAllFixtureManifests().filter((m) =>
    (DEMO_FIXTURES as readonly string[]).includes(m.fixtureId),
  );
  if (manifests.length !== DEMO_FIXTURES.length) {
    throw runtimeError(
      "INTERNAL_ERROR",
      `demo fixtures missing from manifests: found ${manifests.map((m) => m.fixtureId).join(",")}`,
    );
  }
  const fixtureInputs: ScenarioFixtureInput[] = manifests.map((m) => ({
    fixtureId: m.fixtureId,
    family: m.family,
    kind: m.kind,
    controlGroup: m.controlGroup,
    locator: m.locator,
    html: loadFixture(m.fixtureId).html,
  }));

  let analyses: FixtureAnalysis[];
  let witnesses: Record<string, WitnessSummary>;
  let externalRequests = 0;
  let blockedRequests = 0;
  try {
    const outcome = await withBrowserService(async ({ browserHandle, service }) => {
      const found: FixtureAnalysis[] = [];
      for (const fixtureId of DEMO_FIXTURES) {
        found.push(await service.analyze({ fixtureId }));
      }
      const foundWitnesses: Record<string, WitnessSummary> = {};
      for (const s of DEMO_SEARCHES) {
        foundWitnesses[s.fixtureId] = await service.search({
          fixtureId: s.fixtureId,
          maxDepth: s.maxDepth,
        });
      }
      return {
        analyses: found,
        witnesses: foundWitnesses,
        externalRequests: browserHandle.externalRequestCount(),
        blockedRequests: browserHandle.blockedRequestCount(),
      };
    });
    analyses = outcome.analyses;
    witnesses = outcome.witnesses;
    externalRequests = outcome.externalRequests;
    blockedRequests = outcome.blockedRequests;
  } catch (err) {
    // A CliError from the browser launch (or from inside the work)
    // keeps its code; a service ApiError is mapped to the CLI code
    // that names the failing input.
    if (isCliError(err)) throw err;
    throw mapApiError(err);
  }

  // ---- Assemble the full report from the real runs ----
  const cases: ReportCase[] = [];
  let baselinePassed = 0;
  let matched = 0;
  for (const analysis of analyses) {
    if (analysis.baseline.verdict === "STABLE") baselinePassed += 1;
    for (const c of analysis.cases) {
      if (c.mutationId === null) continue;
      if (c.expectedVerdict === null) {
        throw runtimeError(
          "INTERNAL_ERROR",
          `demo case ${c.fixtureId}/${c.mutationId}: golden expected verdict missing`,
        );
      }
      if (c.verdict !== null && c.verdict === c.expectedVerdict) matched += 1;
      cases.push({
        fixtureId: c.fixtureId,
        mutationId: c.mutationId,
        locatorKind: c.locatorKind,
        controlGroup: c.controlGroup as "stable" | "fragile",
        verdict: c.verdict,
        analysisStatus: c.analysisStatus,
        executionStatus: c.executionStatus,
        matchCount: c.matchCount,
        identityMatch: c.identityMatch,
        expectedVerdict: c.expectedVerdict,
      });
    }
  }
  const completed = cases.filter((c) => c.verdict !== null).length;
  const verdictCounts: Record<string, number> = {
    STABLE: 0,
    WRONG_TARGET: 0,
    AMBIGUOUS: 0,
    MISSING: 0,
  };
  for (const c of cases) {
    if (c.verdict !== null) verdictCounts[c.verdict] += 1;
  }
  let stableMismatches = 0;
  let fragileMismatches = 0;
  for (const c of cases) {
    const ok = c.verdict !== null && c.verdict === c.expectedVerdict;
    if (!ok && c.controlGroup === "stable") stableMismatches += 1;
    if (!ok && c.controlGroup === "fragile") fragileMismatches += 1;
  }
  // Static offline scan (same formula as the T008 script, §c of the gate).
  let staticOfflineScanHits = 0;
  for (const f of fixtureInputs) {
    const m1 = f.html.match(/https?:\/\//g);
    const m2 = f.html.match(/(src|href)\s*=\s*["']https?:/gi);
    staticOfflineScanHits += (m1 ? m1.length : 0) + (m2 ? m2.length : 0);
  }
  // Gate derivation for the DEMO subset only. A 3-fixture report can
  // never satisfy the 192-case coverage thresholds, so a demo report
  // is honestly FAIL / DEMO_SUBSET — never a PASS claim, never the
  // frozen S0 gate.
  let failureType: string | null = null;
  if (baselinePassed !== DEMO_FIXTURES.length) failureType = "BASELINE";
  else if (completed !== cases.length) failureType = "CASES";
  else if (stableMismatches > 1 || fragileMismatches !== 0) failureType = "CONTROLS";
  else if (matched !== cases.length) failureType = "ORACLE_PARITY";
  else if (externalRequests !== 0 || staticOfflineScanHits !== 0) failureType = "OFFLINE";
  else failureType = "DEMO_SUBSET";
  const gateResult = failureType === null ? "PASS" : "FAIL";

  const sampleNotes = DEMO_SEARCHES.map((s) => {
    const w = witnesses[s.fixtureId]!;
    return `${s.fixtureId} depth ${s.maxDepth}: status=${w.status} witness=${w.witness === null ? "null" : w.witness.sequence.join("+")} evaluated=${w.statesEvaluated} expanded=${w.statesExpanded}`;
  });
  const report = buildAnalysisReport({
    cases,
    fixtures: fixtureInputs,
    witnesses,
    oracleParity: {
      compared: cases.length,
      matched,
      mismatched: cases.length - matched,
    },
    baseline: { passed: baselinePassed, total: DEMO_FIXTURES.length },
    externalRequests,
    blockedRequests,
    staticOfflineScanHits,
    gateResult,
    gateFailureType: failureType,
    notes: [
      `CLI demo report: 3 of the 24 frozen fixtures (F001, F002, F003), 24 cases. This is a demo subset, NOT the 192-case gate: its gate field is this report's own gate (FAIL / DEMO_SUBSET by construction), not the frozen S0 gate_sha256. Run "npm run s0:gate" for the frozen gate.`,
      `BFS samples (same bounds as the T008 report): ${sampleNotes.join(" | ")}`,
      `Demo run id "demo": export it with "npm run export -- --run demo --format json" or "--format html".`,
    ],
    verification: null,
  });

  const envelope: CliRunEnvelope = {
    schema: "locatorstress.cli-run/v1",
    runId: DEMO_RUN_ID,
    report: report as unknown as Record<string, unknown>,
  };
  const savedPath = saveRun(envelope);
  if (outPath !== undefined) {
    writeFileVerified(outPath, `${canonicalJson(report)}\n`);
  }

  const witnessLines = DEMO_FIXTURES.map((id) => {
    const w = witnesses[id]!;
    const seq =
      w.witness === null ? "—" : `${w.witness.sequence.join("+")} (${w.witness.verdict})`;
    return `  ${id}: ${w.status} ${seq}`;
  }).join("\n");
  const lines = [
    "LocatorStress demo (deterministic, offline)",
    `fixtures: ${DEMO_FIXTURES.join(" ")}`,
    `baseline: ${baselinePassed}/${DEMO_FIXTURES.length} STABLE`,
    `cases: ${cases.length} (expected ${cases.length}, completed ${completed})`,
    `verdicts: ${verdictLine(verdictCounts)}`,
    `score: ${report.scores.overall.score} (${report.scores.overall.stable}/${report.scores.overall.completed} stable of completed)`,
    "witnesses:",
    witnessLines,
    `external requests: ${externalRequests}`,
    `run saved: ${savedPath}`,
    `hashes: scenario=${report.hashes.scenario_sha256} oracle=${report.hashes.oracle_result_sha256} analysis=${report.hashes.analysis_sha256} gate=${report.hashes.gate_sha256}`,
    "export: npm run export -- --run demo --format json",
    "export: npm run export -- --run demo --format html",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}
