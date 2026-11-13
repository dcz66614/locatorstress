// FIX-R1-03 — `search` command (P022-R1-P1-03, PROJECT_BOOK §7.3).
//
//   npm run search -- --scenario <file> [--max-depth N] [--max-expanded-states N] [--out <path>]
//   npm run search -- --fixture <id> [--max-depth N] [--max-expanded-states N] [--out <path>]
//
// Runs the bounded BFS witness search for one fixture or one custom
// scenario through the frozen AnalysisService (real Playwright +
// M01–M08 + Oracle + BFS, depth ≤ 6, states ≤ 4096 — the frozen
// caps) and prints the WitnessSummary as canonical JSON on stdout.
// The result is merged into the run under
// runs/<fixtureId|scenario_id>.json (keeping a stored analysis ONLY
// when the stored scenario fingerprint still matches this scenario
// — see run-store.ts, FIX-R2-02 — so a later `export --run <id>`
// can export analysis + witness together, and never a
// self-contradictory mix). A search with no prior analysis still
// saves a witness-only run; exporting that run as HTML requires an
// analysis (see commands/export.ts). A stored complete report is
// never silently dropped by a search: it is refused before launch
// (REPORT_OVERWRITE_REFUSED).
//
// Exit codes: 0 ok; 1 input/run failure (same codes as analyze);
// 2 CLI usage error (including --max-depth outside 0..6 or
// --max-expanded-states outside 1..4096).

import { canonicalJson } from "../../canonical/canonical-json.js";
import { mapApiError, withBrowserService } from "../browser-service.js";
import { integerFlag, parseFlags, rejectPositionals } from "../args.js";
import type { ParsedFlags } from "../args.js";
import {
  assertNoStoredReport,
  loadRun,
  saveRun,
  scenarioFingerprint,
  writeFileVerified,
} from "../run-store.js";
import type { CliRunEnvelope, RunScenarioIdentity } from "../run-store.js";
import { parseOutFlag, resolveRunInput, runIdForInput } from "./input.js";

export const SEARCH_USAGE =
  "usage: npm run search -- --scenario <file> | --fixture <id> [--max-depth 0..6] [--max-expanded-states 1..4096] [--out <path>]";

const VALUE_FLAGS = new Set([
  "scenario",
  "fixture",
  "max-depth",
  "max-expanded-states",
  "out",
]);
const BOOLEAN_FLAGS = new Set(["help"]);

export async function runSearch(argv: readonly string[]): Promise<number> {
  const flags: ParsedFlags = parseFlags(argv, VALUE_FLAGS, BOOLEAN_FLAGS);
  if (flags.values.has("help")) {
    process.stdout.write(`${SEARCH_USAGE}\n`);
    return 0;
  }
  rejectPositionals(flags);
  const input = resolveRunInput(flags);
  const maxDepth = integerFlag(flags, "max-depth", 0, 6);
  const maxExpandedStates = integerFlag(flags, "max-expanded-states", 1, 4096);
  const outPath = parseOutFlag(flags);

  // FIX-R2-02 — fail fast, before any browser work, when this run
  // id already holds a complete report: search never overwrites
  // one. (Reserved custom ids are already rejected in
  // resolveRunInput, so this is the defence-in-depth path.)
  const runId = runIdForInput(input);
  const existing = loadRun(runId);
  assertNoStoredReport(existing, runId);

  let witnessJson: string;
  let witnessRunId: string;
  try {
    const result = await withBrowserService(async ({ service }) => {
      if (input.kind === "fixture") {
        return service.search({
          fixtureId: input.fixtureId,
          ...(maxDepth !== undefined ? { maxDepth } : {}),
          ...(maxExpandedStates !== undefined ? { maxExpandedStates } : {}),
        });
      }
      return service.search({
        scenario: input.scenario,
        ...(maxDepth !== undefined ? { maxDepth } : {}),
        ...(maxExpandedStates !== undefined ? { maxExpandedStates } : {}),
      });
    });
    witnessJson = `${canonicalJson(result)}\n`;
    witnessRunId = result.fixtureId;
  } catch (err) {
    throw mapApiError(err);
  }

  // Merge the witness into the stored run — but keep the stored
  // analysis ONLY when the stored scenario fingerprint matches this
  // scenario (FIX-R2-02). When the scenario changed (or the stored
  // run predates fingerprints and carries none), the old analysis
  // belonged to a different scenario and is dropped, never exported
  // alongside the new witness. The envelope is re-stamped with this
  // scenario's fingerprint, so the next merge can verify again.
  const identity: RunScenarioIdentity =
    input.kind === "fixture"
      ? { kind: "fixture", fixtureId: input.fixtureId }
      : { kind: "custom", scenario: input.scenario };
  const fingerprint = scenarioFingerprint(identity);
  const analysisKept =
    existing?.analysis !== undefined &&
    existing.scenario_sha256 === fingerprint;
  const envelope: CliRunEnvelope = {
    schema: "locatorstress.cli-run/v1",
    runId: witnessRunId,
    ...(analysisKept ? { analysis: existing!.analysis } : {}),
    witness: JSON.parse(witnessJson) as Record<string, unknown>,
    scenario_sha256: fingerprint,
    ...(input.kind === "custom" ? { scenario: input.scenario } : {}),
  };
  const savedPath = saveRun(envelope);
  if (outPath !== undefined) {
    writeFileVerified(outPath, witnessJson);
  }
  process.stdout.write(witnessJson);
  process.stderr.write(`RUN_SAVED ${savedPath}\n`);
  return 0;
}
