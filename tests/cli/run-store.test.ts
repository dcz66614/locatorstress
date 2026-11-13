// FIX-R2-02 — Run Store identity unit tests (P022-R2-P1-02).
//
// Pure functions, no browser, no fixture reads. The CLI-level
// behaviour (analyze/search merge + reserved-id rejection) is
// covered by tests/cli/cli.test.ts with real browser runs; these
// tests pin the fingerprint and reservation rules the commands
// depend on.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterAll } from "vitest";

import { hashCanonical } from "../../src/canonical/canonical-json.js";
import {
  RESERVED_RUN_IDS,
  assertNoStoredReport,
  isReservedRunId,
  loadRun,
  parseRunEnvelope,
  saveRun,
  scenarioFingerprint,
} from "../../src/cli/run-store.js";
import type { CliRunEnvelope } from "../../src/cli/run-store.js";

const SEED = "P022-LOCATORSTRESS-S0-2026-11-10";
const HTML_A =
  '<main><button class="primary">Save</button></main>';
const HTML_B =
  '<main><button class="secondary">Save</button></main>';

function customScenario(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema: "locatorstress.scenario/v1",
    scenario_id: "P022-R2-02-UNIT",
    seed: SEED,
    html: HTML_A,
    locator: { kind: "css", selector: "button.primary" },
    target: { css: "main > button" },
    ...overrides,
  };
}

describe("scenarioFingerprint", () => {
  it("is deterministic and insensitive to key order", () => {
    const a = customScenario();
    const reordered = {
      target: { css: "main > button" },
      locator: { kind: "css", selector: "button.primary" },
      html: HTML_A,
      seed: SEED,
      scenario_id: "P022-R2-02-UNIT",
      schema: "locatorstress.scenario/v1",
    };
    expect(scenarioFingerprint({ kind: "custom", scenario: a })).toBe(
      scenarioFingerprint({ kind: "custom", scenario: reordered }),
    );
    expect(scenarioFingerprint({ kind: "custom", scenario: a })).toBe(
      hashCanonical({ kind: "custom", scenario: a }),
    );
    expect(scenarioFingerprint({ kind: "custom", scenario: a })).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("changes when the HTML changes", () => {
    const base = scenarioFingerprint({
      kind: "custom",
      scenario: customScenario(),
    });
    expect(
      scenarioFingerprint({
        kind: "custom",
        scenario: customScenario({ html: HTML_B }),
      }),
    ).not.toBe(base);
  });

  it("changes when the locator changes", () => {
    const base = scenarioFingerprint({
      kind: "custom",
      scenario: customScenario(),
    });
    expect(
      scenarioFingerprint({
        kind: "custom",
        scenario: customScenario({
          locator: { kind: "css", selector: "button.secondary" },
        }),
      }),
    ).not.toBe(base);
  });

  it("changes when the target changes", () => {
    const base = scenarioFingerprint({
      kind: "custom",
      scenario: customScenario(),
    });
    expect(
      scenarioFingerprint({
        kind: "custom",
        scenario: customScenario({ target: { css: "main > button:nth-child(2)" } }),
      }),
    ).not.toBe(base);
  });

  it("changes when the mutation suite changes", () => {
    const base = scenarioFingerprint({
      kind: "custom",
      scenario: customScenario(),
    });
    expect(
      scenarioFingerprint({
        kind: "custom",
        scenario: customScenario({ mutation_suite: ["M03"] }),
      }),
    ).not.toBe(base);
  });

  it("distinguishes fixture from custom identity", () => {
    const fixture = scenarioFingerprint({
      kind: "fixture",
      fixtureId: "F001",
    });
    const custom = scenarioFingerprint({
      kind: "custom",
      scenario: customScenario({ scenario_id: "F001" }),
    });
    expect(fixture).not.toBe(custom);
    expect(fixture).toBe(
      hashCanonical({ kind: "fixture", fixtureId: "F001" }),
    );
  });

  it("fixture fingerprint depends only on the fixture id", () => {
    expect(
      scenarioFingerprint({ kind: "fixture", fixtureId: "F001" }),
    ).not.toBe(
      scenarioFingerprint({ kind: "fixture", fixtureId: "F002" }),
    );
  });
});

describe("isReservedRunId", () => {
  it("reserves demo, t008 and F001–F024", () => {
    expect(RESERVED_RUN_IDS.size).toBe(26);
    for (const id of ["demo", "t008", "F001", "F012", "F024"]) {
      expect(isReservedRunId(id)).toBe(true);
    }
  });

  it("does not reserve ordinary ids", () => {
    for (const id of [
      "custom",
      "P022-R2-02-UNIT",
      "F025",
      "F000",
      "f001",
      "Demo",
      "demo2",
      "t008x",
      "",
    ]) {
      expect(isReservedRunId(id)).toBe(false);
    }
  });
});

describe("parseRunEnvelope + round-trip", () => {
  const root = mkdtempSync(join(tmpdir(), "p022-run-store-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("accepts a valid scenario_sha256 and round-trips it", () => {
    const fp = scenarioFingerprint({
      kind: "custom",
      scenario: customScenario(),
    });
    const envelope: CliRunEnvelope = {
      schema: "locatorstress.cli-run/v1",
      runId: "P022-R2-02-UNIT",
      analysis: { fixtureId: "P022-R2-02-UNIT" },
      scenario_sha256: fp,
      scenario: customScenario(),
    };
    const saved = saveRun(envelope, root);
    expect(saved).toBe(join(root, "runs", "P022-R2-02-UNIT.json"));
    const loaded = loadRun("P022-R2-02-UNIT", root);
    expect(loaded?.scenario_sha256).toBe(fp);
    expect(loaded?.scenario).toEqual(customScenario());
  });

  it("rejects a malformed scenario_sha256", () => {
    const bad = JSON.stringify({
      schema: "locatorstress.cli-run/v1",
      runId: "X",
      scenario_sha256: "not-a-sha",
    });
    expect(() => parseRunEnvelope(bad, "X")).toThrow("scenario_sha256");
    const badType = JSON.stringify({
      schema: "locatorstress.cli-run/v1",
      runId: "X",
      scenario_sha256: 123,
    });
    expect(() => parseRunEnvelope(badType, "X")).toThrow("scenario_sha256");
  });

  it("accepts a legacy envelope without scenario_sha256", () => {
    const legacy = JSON.stringify({
      schema: "locatorstress.cli-run/v1",
      runId: "X",
      analysis: { fixtureId: "X" },
    });
    expect(parseRunEnvelope(legacy, "X").scenario_sha256).toBeUndefined();
  });
});

describe("assertNoStoredReport", () => {
  it("throws REPORT_OVERWRITE_REFUSED when a report is stored", () => {
    const existing: CliRunEnvelope = {
      schema: "locatorstress.cli-run/v1",
      runId: "demo",
      report: { schema: "locatorstress.analysis-report/v1" },
    };
    // The code lives on the CliError, not in the message.
    try {
      assertNoStoredReport(existing, "demo");
      expect.unreachable("expected REPORT_OVERWRITE_REFUSED");
    } catch (err) {
      expect((err as { code?: unknown }).code).toBe(
        "REPORT_OVERWRITE_REFUSED",
      );
      expect((err as Error).message).toContain("complete report");
    }
  });

  it("passes when there is no stored run or no report", () => {
    expect(() => assertNoStoredReport(null, "demo")).not.toThrow();
    expect(() =>
      assertNoStoredReport(
        {
          schema: "locatorstress.cli-run/v1",
          runId: "X",
          analysis: { fixtureId: "X" },
        },
        "X",
      ),
    ).not.toThrow();
  });
});
