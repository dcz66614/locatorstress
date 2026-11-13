// FIX-R1-03 — `export` command (P022-R1-P1-03, PROJECT_BOOK §7.3).
//
//   npm run export -- --run <id> --format json|html [--out <path>] [--stdout]
//
// Exports a stored run/report. Two tiers, both reusing the wired
// exporters (no rendering logic lives in the CLI):
//
//   1. Full report — run id `t008` (the frozen T008 report at
//      evidence/s2/T008_API_REPORT.json, read-only) or any stored
//      run holding a full AnalysisReport (the `demo` run):
//        json → exportReportJson(report)
//        html → exportReportHtml(report)
//      These are the exact functions POST /api/export calls, so the
//      CLI bytes are byte-identical to the API export of the same
//      report (asserted by tests/cli/cli.test.ts).
//   2. Page-level run — a stored analyze/search run
//      (locatorstress.cli-run/v1 with an analysis):
//        json → canonical JSON of the page-level payload
//        html → exportPageReportHtml(payload)
//      This is the UI page-level export (FIX-R1-02). A custom run
//      cannot be a full AnalysisReport (ReportCase requires
//      controlGroup stable|fragile + a non-null expectedVerdict),
//      so the page-level export is the only honest HTML path for
//      custom runs. The HTML embeds exactly the canonical JSON the
//      JSON export writes, so the two formats agree by construction.
//      A witness-only run (no stored analysis) exports as JSON only;
//      HTML fails closed with EXPORT_HTML_REQUIRES_ANALYSIS.
//
// Output: by default the document is written to
// runs/<id>.export.json|.html and the CLI prints
// `EXPORTED <path> <bytes> bytes sha256 <hash> format <format> run
// <id>` on stdout. --out <path> writes there instead; --stdout
// prints the document itself (no EXPORTED line).
//
// Exit codes: 0 ok; 1 unknown run / invalid stored report /
// HTML-requires-analysis; 2 CLI usage error (missing --run/--format,
// unknown format value, bad run id).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../../canonical/canonical-json.js";
import { SCHEMA_ANALYSIS_REPORT } from "../../contracts/report.js";
import { exportReportHtml } from "../../export/html-export.js";
import {
  exportReportJson,
  validateExportedReport,
} from "../../export/json-export.js";
import { exportPageReportHtml } from "../../export/ui-report-html.js";
import { parseFlags, rejectPositionals, requiredFlag } from "../args.js";
import type { ParsedFlags } from "../args.js";
import { runtimeError, usageError } from "../errors.js";
import {
  assertRunId,
  listExportableRuns,
  loadRun,
  repoRoot,
  runsDir,
  sha256Hex,
  t008ReportPath,
  writeFileVerified,
  T008_RUN_ID,
} from "../run-store.js";
import type { CliRunEnvelope } from "../run-store.js";
import { buildPagePayload } from "../page-payload.js";

export const EXPORT_USAGE =
  "usage: npm run export -- --run <id> --format json|html [--out <path>] [--stdout]";

const VALUE_FLAGS = new Set(["run", "format", "out"]);
const BOOLEAN_FLAGS = new Set(["help", "stdout"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownRun(runId: string): never {
  const available = listExportableRuns().join(", ");
  throw runtimeError(
    "UNKNOWN_RUN",
    `unknown run ${JSON.stringify(runId)} (available runs: ${available || "(none — run demo, analyze or search first)"})`,
  );
}

/** Read a full AnalysisReport from a parsed JSON value (validates it). */
function asFullReport(value: unknown, where: string): Record<string, unknown> {
  if (!isPlainObject(value) || value["schema"] !== SCHEMA_ANALYSIS_REPORT) {
    throw runtimeError(
      "INVALID_REPORT",
      `${where} is not a ${SCHEMA_ANALYSIS_REPORT} document`,
    );
  }
  const validation = validateExportedReport(value);
  if (!validation.valid) {
    throw runtimeError(
      "INVALID_REPORT",
      `${where} failed validation: ${validation.errors.join("; ")}`,
    );
  }
  return value;
}

export async function runExport(argv: readonly string[]): Promise<number> {
  const flags: ParsedFlags = parseFlags(argv, VALUE_FLAGS, BOOLEAN_FLAGS);
  if (flags.values.has("help")) {
    process.stdout.write(`${EXPORT_USAGE}\n`);
    return 0;
  }
  rejectPositionals(flags);
  const runId = assertRunId(requiredFlag(flags, "run"));
  const format = requiredFlag(flags, "format");
  if (format !== "json" && format !== "html") {
    throw usageError(
      `--format must be "json" or "html", got ${JSON.stringify(format)}`,
    );
  }
  const outPath = flags.values.get("out");
  const toStdout = flags.values.has("stdout");
  if (outPath !== undefined && toStdout) {
    throw usageError("--out and --stdout cannot be combined");
  }

  const root = repoRoot();
  let document: string;
  let sourceDescription: string;
  if (runId === T008_RUN_ID) {
    const path = t008ReportPath(root);
    if (!existsSync(path)) {
      throw runtimeError(
        "UNKNOWN_RUN",
        `run ${T008_RUN_ID} unavailable: ${path} does not exist`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    } catch (err) {
      throw runtimeError(
        "INVALID_REPORT",
        `run ${T008_RUN_ID} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const report = asFullReport(parsed, `run ${T008_RUN_ID} (${path})`);
    document =
      format === "json" ? exportReportJson(report) : exportReportHtml(report);
    sourceDescription = `full report ${T008_RUN_ID}`;
  } else {
    const run: CliRunEnvelope | null = loadRun(runId, root);
    if (run === null) unknownRun(runId);
    const stored = run as CliRunEnvelope;
    if (stored.report !== undefined) {
      const report = asFullReport(
        stored.report,
        `stored run ${runId} (report)`,
      );
      document =
        format === "json" ? exportReportJson(report) : exportReportHtml(report);
      sourceDescription = `full report ${runId}`;
    } else if (stored.analysis !== undefined) {
      const payload = buildPagePayload(stored);
      if (format === "json") {
        document = `${canonicalJson(payload)}\n`;
      } else {
        document = exportPageReportHtml(payload);
        if (!document.endsWith("\n")) document += "\n";
      }
      sourceDescription = `page-level run ${runId}`;
    } else if (stored.witness !== undefined) {
      if (format === "html") {
        // buildPagePayload throws EXPORT_HTML_REQUIRES_ANALYSIS.
        buildPagePayload(stored);
      }
      document = `${canonicalJson(stored.witness)}\n`;
      sourceDescription = `witness-only run ${runId}`;
    } else {
      throw runtimeError(
        "INVALID_RUN",
        `stored run ${runId} holds neither a report, an analysis nor a witness`,
      );
    }
  }

  if (toStdout) {
    process.stdout.write(document);
    return 0;
  }
  const ext = format === "json" ? "json" : "html";
  const target =
    outPath ?? join(runsDir(root), `${runId}.export.${ext}`);
  writeFileVerified(target, document);
  const bytes = new TextEncoder().encode(document).length;
  process.stdout.write(
    `EXPORTED ${target} ${bytes} bytes sha256 ${sha256Hex(document)} format ${format} run ${runId} (${sourceDescription})\n`,
  );
  return 0;
}
