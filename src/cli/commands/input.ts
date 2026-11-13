// FIX-R1-03 — Shared input handling for `analyze` / `search`
// (P022-R1-P1-03).
//
// The CLI accepts exactly one input: `--scenario <file>` (a
// user-supplied locatorstress.scenario/v1 document, the same format
// FIX-R1-01 added to /api/analyze) or `--fixture <id>` (one of the
// 24 frozen fixtures). The scenario file is read, parsed and
// shape-validated BEFORE any browser is launched, so a bad file
// fails fast with a CLI error code and never spends a Chromium
// launch. Target resolvability (exactly one match) can only be
// checked against the live DOM, so it still fails at run time with
// the service's 422 codes (CUSTOM_TARGET_NOT_FOUND /
// CUSTOM_TARGET_AMBIGUOUS / CUSTOM_HTML_TOO_LARGE).

import { existsSync, readFileSync } from "node:fs";
import { MUTATION_ORDER } from "../../mutations/registry.js";
import type { MutationId } from "../../mutations/types.js";
import {
  CUSTOM_RUN_ID,
  validateCustomScenarioForRun,
} from "../../contracts/custom-scenario.js";
import { isReservedRunId } from "../run-store.js";
import { runtimeError, usageError } from "../errors.js";
import type { ParsedFlags } from "../args.js";

export type RunInput =
  | { kind: "fixture"; fixtureId: string }
  | { kind: "custom"; scenario: unknown; scenarioPath: string };

const FIXTURE_ID_PATTERN = /^F0(0[1-9]|1[0-9]|2[0-4])$/;

export function readScenarioFile(scenarioPath: string): unknown {
  if (!existsSync(scenarioPath)) {
    throw runtimeError(
      "SCENARIO_NOT_FOUND",
      `scenario file not found: ${scenarioPath}`,
    );
  }
  let text: string;
  try {
    text = readFileSync(scenarioPath, "utf-8");
  } catch (err) {
    throw runtimeError(
      "SCENARIO_NOT_FOUND",
      `cannot read scenario file ${scenarioPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw runtimeError(
      "INVALID_SCENARIO_JSON",
      `scenario file ${scenarioPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Resolve exactly one of --scenario / --fixture. Pure validation only (no browser). */
export function resolveRunInput(flags: ParsedFlags): RunInput {
  const scenarioPath = flags.values.get("scenario");
  const fixtureId = flags.values.get("fixture");
  if (scenarioPath !== undefined && fixtureId !== undefined) {
    throw usageError("supply exactly one of --scenario or --fixture, not both");
  }
  if (scenarioPath === undefined && fixtureId === undefined) {
    throw usageError("analyze/search require exactly one of --scenario <file> or --fixture <id>");
  }
  if (fixtureId !== undefined) {
    if (!FIXTURE_ID_PATTERN.test(fixtureId)) {
      throw runtimeError(
        "INVALID_FIXTURE",
        `fixtureId must match /^F0(0[1-9]|1[0-9]|2[0-4])$/, got ${JSON.stringify(fixtureId)}`,
      );
    }
    return { kind: "fixture", fixtureId };
  }
  const scenario = readScenarioFile(scenarioPath!);
  const errors = validateCustomScenarioForRun(scenario);
  if (errors.length > 0) {
    throw runtimeError(
      "INVALID_SCENARIO",
      `invalid custom scenario in ${scenarioPath}: ${errors.join("; ")}`,
    );
  }
  // FIX-R2-02 — a custom scenario may not claim a reserved run id
  // ("demo", "t008", F001–F024). Reject before any browser is
  // launched, so a custom run can never overwrite the demo report
  // or a fixture run. A scenario without scenario_id defaults to
  // "custom" (not reserved) at the service layer.
  const scenarioId = (scenario as Record<string, unknown>)["scenario_id"];
  if (typeof scenarioId === "string" && isReservedRunId(scenarioId)) {
    throw runtimeError(
      "RESERVED_RUN_ID",
      `custom scenario_id ${JSON.stringify(scenarioId)} is reserved ("demo", "t008" and fixture ids F001–F024 are owned by the demo command and the frozen fixtures); choose a different scenario_id`,
    );
  }
  return { kind: "custom", scenario, scenarioPath: scenarioPath! };
}

/**
 * FIX-R2-02 — the run id an analyze/search input will be stored
 * under, derived the same way the service derives it (fixture id,
 * or the custom scenario_id, defaulting to "custom" when absent).
 * Used for the pre-flight complete-report check, before any browser
 * work; the stored envelope still takes its runId from the service
 * result, which is authoritative.
 */
export function runIdForInput(input: RunInput): string {
  if (input.kind === "fixture") return input.fixtureId;
  const id = (input.scenario as Record<string, unknown>)["scenario_id"];
  return typeof id === "string" ? id : CUSTOM_RUN_ID;
}

/** Parse --mutations M01,M03 (deduped, frozen order kept). */
export function parseMutations(flags: ParsedFlags): MutationId[] | undefined {
  const raw = flags.values.get("mutations");
  if (raw === undefined) return undefined;
  const ids: MutationId[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (id === "") continue;
    if (!(MUTATION_ORDER as readonly string[]).includes(id)) {
      throw usageError(
        `--mutations must be a comma list of M01–M08, got ${JSON.stringify(raw)}`,
      );
    }
    if (!ids.includes(id as MutationId)) ids.push(id as MutationId);
  }
  if (ids.length === 0) {
    throw usageError("--mutations must list at least one of M01–M08");
  }
  return ids;
}

/** Optional --out <path>: where to also write the command's JSON result. */
export function parseOutFlag(flags: ParsedFlags): string | undefined {
  return flags.values.get("out");
}
