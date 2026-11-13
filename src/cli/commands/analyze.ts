// FIX-R1-03 — `analyze` command (P022-R1-P1-03, PROJECT_BOOK §7.3).
//
//   npm run analyze -- --scenario <file>
//   npm run analyze -- --fixture <id> [--mutations M01,M03] [--out <path>]
//
// Runs baseline + single mutations for one fixture or one custom
// scenario through the frozen AnalysisService (real Playwright +
// M01–M08 + Oracle + verdict classification) and prints the
// FixtureAnalysis as canonical JSON on stdout. The result is also
// saved as a run under runs/<fixtureId|scenario_id>.json, so a later
// `export --run <id>` can export it. A re-run replaces the stored
// run wholesale: any previously stored witness for that run id
// belonged to the previous analysis and must not be exported
// alongside a new one. A previously stored complete report is NOT
// replaced: analyze refuses (REPORT_OVERWRITE_REFUSED) instead of
// silently dropping it — see run-store.ts (FIX-R2-02).
//
// Exit codes: 0 ok; 1 input/run failure (SCENARIO_NOT_FOUND,
// INVALID_SCENARIO_JSON, INVALID_SCENARIO, INVALID_FIXTURE,
// CUSTOM_TARGET_NOT_FOUND, CUSTOM_TARGET_AMBIGUOUS,
// CUSTOM_HTML_TOO_LARGE, BROWSER_LAUNCH_FAILED, RESERVED_RUN_ID,
// REPORT_OVERWRITE_REFUSED); 2 CLI usage error.

import { canonicalJson } from "../../canonical/canonical-json.js";
import { mapApiError, withBrowserService } from "../browser-service.js";
import { parseFlags, rejectPositionals } from "../args.js";
import type { ParsedFlags } from "../args.js";
import {
  assertNoStoredReport,
  loadRun,
  saveRun,
  scenarioFingerprint,
  writeFileVerified,
} from "../run-store.js";
import type { CliRunEnvelope, RunScenarioIdentity } from "../run-store.js";
import {
  parseMutations,
  parseOutFlag,
  resolveRunInput,
  runIdForInput,
} from "./input.js";

export const ANALYZE_USAGE =
  "usage: npm run analyze -- --scenario <file> | --fixture <id> [--mutations M01,M03] [--out <path>]";

const VALUE_FLAGS = new Set(["scenario", "fixture", "mutations", "out"]);
const BOOLEAN_FLAGS = new Set(["help"]);

export async function runAnalyze(argv: readonly string[]): Promise<number> {
  const flags: ParsedFlags = parseFlags(argv, VALUE_FLAGS, BOOLEAN_FLAGS);
  if (flags.values.has("help")) {
    process.stdout.write(`${ANALYZE_USAGE}\n`);
    return 0;
  }
  rejectPositionals(flags);
  const input = resolveRunInput(flags);
  const mutationIds = parseMutations(flags);
  const outPath = parseOutFlag(flags);

  // FIX-R2-02 — fail fast, before any browser work, when this run
  // id already holds a complete report: analyze never overwrites
  // one. (Reserved custom ids are already rejected in
  // resolveRunInput, so this is the defence-in-depth path.)
  assertNoStoredReport(loadRun(runIdForInput(input)), runIdForInput(input));

  let analysisJson: string;
  let runId: string;
  try {
    const result = await withBrowserService(async ({ service }) => {
      if (input.kind === "fixture") {
        return service.analyze({
          fixtureId: input.fixtureId,
          ...(mutationIds !== undefined ? { mutationIds } : {}),
        });
      }
      return service.analyze({
        scenario: input.scenario,
        ...(mutationIds !== undefined ? { mutationIds } : {}),
      });
    });
    analysisJson = `${canonicalJson(result)}\n`;
    runId = result.fixtureId;
  } catch (err) {
    throw mapApiError(err);
  }

  // Save the run, replacing any previous stored content for this id.
  // The envelope carries the scenario fingerprint (FIX-R2-02) so a
  // later `search` can verify it is still merging into the same
  // scenario before keeping this analysis. The identity is the
  // fixture id or the scenario document itself — never the scenario
  // file path, so the same scenario from a different path still
  // matches.
  const identity: RunScenarioIdentity =
    input.kind === "fixture"
      ? { kind: "fixture", fixtureId: input.fixtureId }
      : { kind: "custom", scenario: input.scenario };
  const envelope: CliRunEnvelope = {
    schema: "locatorstress.cli-run/v1",
    runId,
    analysis: JSON.parse(analysisJson) as Record<string, unknown>,
    scenario_sha256: scenarioFingerprint(identity),
    ...(input.kind === "custom" ? { scenario: input.scenario } : {}),
  };
  const savedPath = saveRun(envelope);
  if (outPath !== undefined) {
    writeFileVerified(outPath, analysisJson);
  }
  process.stdout.write(analysisJson);
  process.stderr.write(`RUN_SAVED ${savedPath}\n`);
  return 0;
}
