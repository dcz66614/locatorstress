// FIX-R1-03 — CLI run store (P022-R1-P1-03, PROJECT_BOOK §7.3).
//
// A "run" is one fixture or custom scenario's latest CLI output,
// stored as JSON under `<repoRoot>/runs/<runId>.json` so a later
// `npm run export -- --run <id>` can export it. The store is local
// lab state (gitignored, like dist/); it is never part of any
// canonical hash and never written under evidence/.
//
// Envelope (`locatorstress.cli-run/v1`):
//   - runId: fixture id (F001–F024), scenario_id, or "demo".
//   - analysis: the latest FixtureAnalysis from `analyze` (drops any
//     stored witness: it belonged to the previous analysis).
//   - witness: the latest WitnessSummary from `search` (kept across
//     analyze only when the analysis is unchanged — analyze drops it,
//     search merges into it; see commands/analyze.ts).
//   - scenario: the parsed custom scenario, when the run is custom
//     (so the run is self-contained and re-runnable).
//   - report: a full AnalysisReport, when present (the demo command
//     writes one; a run with a report exports through the same
//     exportReportJson/exportReportHtml path as POST /api/export).
//   - scenario_sha256 (FIX-R2-02): the fingerprint of the scenario
//     whose analysis/witness this run holds (see
//     scenarioFingerprint). `search` keeps a stored analysis ONLY
//     when the stored fingerprint matches the scenario being
//     searched; a mismatch (or a missing fingerprint, i.e. a run
//     written before this fix) drops the stale analysis instead of
//     exporting a self-contradictory run. Fixture runs fingerprint
//     the fixture id (frozen content); custom runs fingerprint the
//     whole scenario document.
//
// FIX-R2-02 — reserved run ids (P022-R2-P1-02): the ids "demo",
// "t008" and the fixture ids F001–F024 are owned by the demo
// command, the frozen T008 report and the frozen fixtures. A custom
// scenario may NOT claim one of them as its scenario_id — analyze /
// search reject it with RESERVED_RUN_ID before any browser is
// launched, so a custom run can never overwrite the demo report or
// a fixture run. Independently, analyze / search refuse
// (REPORT_OVERWRITE_REFUSED) to touch a stored run that holds a
// complete report: a complete report is never overwritten without
// explicit authorisation, and the CLI offers no --force flag, so the
// refusal is unconditional.
//
// The frozen T008 report is NOT copied into the store: `export
// --run t008` reads evidence/s2/T008_API_REPORT.json directly
// (read-only; never overwritten).
//
// Writes are verified (read back + byte-compare, retry on transient
// storage errors) because this VM has shown EPERM jitter on writes.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, hashCanonical } from "../canonical/canonical-json.js";
import { runtimeError } from "./errors.js";

export const RUN_STORE_SCHEMA = "locatorstress.cli-run/v1";
export const RUNS_DIR_NAME = "runs";
export const T008_RUN_ID = "t008";
export const DEMO_RUN_ID = "demo";

/** Run ids owned by the demo command, the frozen T008 report and the frozen fixtures. Custom scenario_ids may not claim them (FIX-R2-02). */
export const RESERVED_RUN_IDS: ReadonlySet<string> = new Set([
  DEMO_RUN_ID,
  T008_RUN_ID,
  ...Array.from({ length: 24 }, (_, i) => `F${String(i + 1).padStart(3, "0")}`),
]);

/** True when a run id is reserved (exact, case-sensitive match). */
export function isReservedRunId(runId: string): boolean {
  return RESERVED_RUN_IDS.has(runId);
}

/**
 * The identity of the scenario a run belongs to: a fixture is
 * identified by its (frozen) fixture id; a custom run by the whole
 * scenario document as supplied (html + locator + target + suite +
 * bfs + seed — anything that changes what the analysis means).
 * The fingerprint is the frozen §6 canonical hash of that identity,
 * so key order in the file does not matter, but any content change
 * does. Run options (--mutations, --max-depth) are NOT part of the
 * identity: they select a subset/bound of the same scenario, exactly
 * as for fixture runs, whose stored analysis a later search keeps.
 */
export type RunScenarioIdentity =
  | { kind: "fixture"; fixtureId: string }
  | { kind: "custom"; scenario: unknown };

export function scenarioFingerprint(identity: RunScenarioIdentity): string {
  return hashCanonical(identity);
}

/** Run ids are file-name safe by construction (fixture / scenario ids). */
export const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface CliRunEnvelope {
  schema: typeof RUN_STORE_SCHEMA;
  runId: string;
  analysis?: Record<string, unknown>;
  witness?: Record<string, unknown>;
  scenario?: unknown;
  report?: Record<string, unknown>;
  /** FIX-R2-02: fingerprint of the scenario this run's analysis/witness belong to (see scenarioFingerprint). */
  scenario_sha256?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Locate the repo root: walk up from this module's directory until a
 * package.json named "locatorstress" is found. Works from src/cli/
 * (tsc source) and dist/cli/ (compiled output), and does not depend
 * on the process working directory — the CLI is always run from the
 * repo root, but this also tolerates a subdirectory. Falls back to
 * the module directory's parent chain end (the directory itself)
 * when no package.json is found.
 */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
          name?: unknown;
        };
        if (pkg.name === "locatorstress") return dir;
      } catch {
        // Not readable JSON — keep walking up.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
}

export function runsDir(root: string = repoRoot()): string {
  return join(root, RUNS_DIR_NAME);
}

export function runFilePath(runId: string, root: string = repoRoot()): string {
  return join(runsDir(root), `${runId}.json`);
}

export function t008ReportPath(root: string = repoRoot()): string {
  return join(root, "evidence", "s2", "T008_API_REPORT.json");
}

export function assertRunId(runId: unknown): string {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw runtimeError(
      "INVALID_RUN_ID",
      `run id must be 1–64 chars of [A-Za-z0-9_-], got ${JSON.stringify(runId)}`,
    );
  }
  return runId;
}

/** Write a file, then read it back and byte-compare (retry on EPERM jitter). */
export function writeFileVerified(filePath: string, text: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const expectedSha = createHash("sha256").update(text, "utf8").digest("hex");
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      writeFileSync(filePath, text, "utf-8");
      const back = readFileSync(filePath, "utf-8");
      if (back !== text) {
        throw new Error(
          `write verification failed for ${filePath}: read-back differs (${back.length} vs ${text.length} bytes)`,
        );
      }
      const actualSha = createHash("sha256").update(back, "utf8").digest("hex");
      if (actualSha !== expectedSha) {
        throw new Error(
          `write verification failed for ${filePath}: sha256 mismatch after write`,
        );
      }
      return;
    } catch (err) {
      lastError = err;
      continue;
    }
  }
  throw new Error(
    `failed to write ${filePath} after 3 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Parse + validate a stored run envelope. Throws CliError on bad input. */
export function parseRunEnvelope(text: string, runId: string): CliRunEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    throw runtimeError(
      "INVALID_RUN",
      `stored run ${runId} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isPlainObject(parsed) || parsed["schema"] !== RUN_STORE_SCHEMA) {
    throw runtimeError(
      "INVALID_RUN",
      `stored run ${runId} is not a ${RUN_STORE_SCHEMA} envelope`,
    );
  }
  if (parsed["runId"] !== runId) {
    throw runtimeError(
      "INVALID_RUN",
      `stored run file ${runId}.json carries runId ${JSON.stringify(parsed["runId"])}`,
    );
  }
  for (const key of ["analysis", "witness", "report"] as const) {
    const v = parsed[key];
    if (v !== undefined && !isPlainObject(v)) {
      throw runtimeError(
        "INVALID_RUN",
        `stored run ${runId}: ${key} must be an object`,
      );
    }
  }
  const fp = parsed["scenario_sha256"];
  if (
    fp !== undefined &&
    (typeof fp !== "string" || !/^[0-9a-f]{64}$/.test(fp))
  ) {
    throw runtimeError(
      "INVALID_RUN",
      `stored run ${runId}: scenario_sha256 must be a 64-hex sha256`,
    );
  }
  return parsed as unknown as CliRunEnvelope;
}

/**
 * FIX-R2-02 — refuse to touch a stored run that holds a complete
 * report. A complete report (the demo report, or any future
 * report-bearing run) is never overwritten by analyze / search
 * without explicit authorisation, and the CLI offers no --force
 * flag, so the refusal is unconditional. Call before any browser
 * work so the refusal is fast.
 */
export function assertNoStoredReport(
  existing: CliRunEnvelope | null,
  runId: string,
): void {
  if (existing?.report !== undefined) {
    throw runtimeError(
      "REPORT_OVERWRITE_REFUSED",
      `stored run ${runId} holds a complete report; analyze/search never overwrite a complete report (run "demo" to rebuild it, or export it first)`,
    );
  }
}

/**
 * Load a stored run. Returns null when no file exists (the caller
 * reports UNKNOWN_RUN); throws CliError when the file exists but is
 * not a valid envelope — fail closed, never silently overwrite it.
 */
export function loadRun(
  runId: string,
  root: string = repoRoot(),
): CliRunEnvelope | null {
  const path = runFilePath(runId, root);
  if (!existsSync(path)) return null;
  return parseRunEnvelope(readFileSync(path, "utf-8"), runId);
}

/** Save a run envelope (canonical bytes + trailing LF, like the JSON export). */
export function saveRun(
  envelope: CliRunEnvelope,
  root: string = repoRoot(),
): string {
  const path = runFilePath(envelope.runId, root);
  writeFileVerified(path, `${canonicalJson(envelope)}\n`);
  return path;
}

/** List stored run ids (excluding `<id>.export.*` output files). */
export function listRunIds(root: string = repoRoot()): string[] {
  const dir = runsDir(root);
  if (!existsSync(dir)) return [];
  const ids: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    if (name.includes(".export.")) continue;
    const id = name.slice(0, -".json".length);
    if (RUN_ID_PATTERN.test(id)) ids.push(id);
  }
  ids.sort();
  return ids;
}

/** Human-readable list of exportable runs (stored runs + the T008 report). */
export function listExportableRuns(root: string = repoRoot()): string[] {
  const ids = listRunIds(root);
  if (!ids.includes(T008_RUN_ID)) ids.push(T008_RUN_ID);
  ids.sort();
  return ids;
}
