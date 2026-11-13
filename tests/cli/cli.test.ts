// FIX-R1-03 — CLI tests (P022-R1-P1-03, PROJECT_BOOK §7.3).
//
// The CLI is tested as a real subprocess (`node dist/cli/index.js
// ...`, the exact entry point the npm scripts run), never by
// importing command handlers: exit codes, stdout/stderr and the run
// store are all asserted from the outside. Browser-backed commands
// run real Playwright analysis/search on a custom scenario file and
// on frozen fixtures, through the same service the API uses.
//
// Run store hygiene: every run this suite creates (ids below, plus
// `demo`, `F002`, `F003` and their `.export.*` outputs) is deleted
// in afterAll. The frozen T008 evidence file is only READ, never
// written.

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { handleApiRequest } from "../../src/api/routes.js";
import { hashCanonical } from "../../src/canonical/canonical-json.js";
import { scanExternalResources } from "../../src/export/html-escape.js";
import { parseEmbeddedReportJson } from "../../src/export/html-export.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI_ENTRY = join(REPO_ROOT, "dist", "cli", "index.js");
const RUNS_DIR = join(REPO_ROOT, "runs");
const SEED = "P022-LOCATORSTRESS-S0-2026-11-10";

const TWO_BUTTON_HTML =
  '<main><form><button type="submit" class="primary">Save</button>' +
  '<button type="button" class="secondary">Cancel</button></form></main>';
const TWO_BUTTON_TARGET = { css: "main > form > button:nth-child(1)" };

function cssScenario(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "locatorstress.scenario/v1",
    scenario_id: "P022-CLI-TEST-CSS",
    seed: SEED,
    html: TWO_BUTTON_HTML,
    locator: { kind: "css", selector: "button.primary" },
    target: TWO_BUTTON_TARGET,
    ...overrides,
  };
}

const CUSTOM_RUN_ID = "P022-CLI-TEST-CSS";
const CREATED_RUN_IDS = [CUSTOM_RUN_ID, "F001", "F002", "F003", "demo"];

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], timeoutMs = 120_000): CliResult {
  const res = spawnSync("node", [CLI_ENTRY, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    timeout: timeoutMs,
  });
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

function runFile(runId: string): string {
  return join(RUNS_DIR, `${runId}.json`);
}

function readRun(runId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(runFile(runId), "utf-8")) as Record<
    string,
    unknown
  >;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

// File-level cleanup: every run this suite creates (ids below, plus
// `demo`, `F002`, `F003` and their `.export.*` outputs) is deleted
// here, AFTER all describes have run. (A describe-level afterAll
// would delete the analyze/search runs before the export describes
// that need them.)
afterAll(() => {
  for (const id of CREATED_RUN_IDS) {
    rmSync(runFile(id), { force: true });
    rmSync(join(RUNS_DIR, `${id}.export.json`), { force: true });
    rmSync(join(RUNS_DIR, `${id}.export.html`), { force: true });
  }
  rmSync(join(RUNS_DIR, "t008.export.json"), { force: true });
  rmSync(join(RUNS_DIR, "t008.export.html"), { force: true });
});

describe("CLI usage (no browser)", () => {
  it("no args prints usage and exits 2", () => {
    const res = runCli([]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("CLI_USAGE");
    expect(res.stderr).toContain("usage:");
  });

  it("--help prints usage and exits 0", () => {
    const res = runCli(["--help"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("npm run dev");
    expect(res.stdout).toContain("npm run demo");
    expect(res.stdout).toContain("npm run analyze");
    expect(res.stdout).toContain("npm run search");
    expect(res.stdout).toContain("npm run export");
  });

  it("unknown command exits 2 with CLI_USAGE", () => {
    const res = runCli(["bogus"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("ERROR CLI_USAGE");
    expect(res.stderr).toContain('unknown command "bogus"');
  });

  it("each command accepts --help and exits 0", () => {
    for (const cmd of ["dev", "demo", "analyze", "search", "export"]) {
      const res = runCli([cmd, "--help"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("usage:");
    }
  });
});

describe("CLI analyze/search (real browser)", () => {
  let scenarioPath: string;
  let ambPath: string;
  let missPath: string;
  let badPath: string;
  let scriptPath: string;
  let badJsonPath: string;

  beforeAll(() => {
    mkdirSync("/tmp/p022-cli-tests", { recursive: true });
    scenarioPath = "/tmp/p022-cli-tests/scenario.json";
    writeFileSync(scenarioPath, JSON.stringify(cssScenario()), "utf-8");
    ambPath = "/tmp/p022-cli-tests/ambiguous.json";
    writeFileSync(
      ambPath,
      JSON.stringify(
        cssScenario({ scenario_id: "P022-CLI-TEST-AMB", target: { css: "button" } }),
      ),
      "utf-8",
    );
    missPath = "/tmp/p022-cli-tests/missing-target.json";
    writeFileSync(
      missPath,
      JSON.stringify(
        cssScenario({
          scenario_id: "P022-CLI-TEST-MISS",
          target: { css: "button.gone" },
        }),
      ),
      "utf-8",
    );
    badPath = "/tmp/p022-cli-tests/bad-schema.json";
    writeFileSync(
      badPath,
      JSON.stringify(cssScenario({ schema: "wrong" })),
      "utf-8",
    );
    scriptPath = "/tmp/p022-cli-tests/script.json";
    writeFileSync(
      scriptPath,
      JSON.stringify(
        cssScenario({
          scenario_id: "P022-CLI-TEST-SCRIPT",
          html: "<script>alert(1)</script>",
        }),
      ),
      "utf-8",
    );
    badJsonPath = "/tmp/p022-cli-tests/bad-json.json";
    writeFileSync(badJsonPath, "{not json", "utf-8");
  });

  afterAll(() => {
    rmSync("/tmp/p022-cli-tests", { recursive: true, force: true });
  });

  it(
    "analyze --scenario: real custom run, baseline STABLE, M03 MISSING, M04/M07 AMBIGUOUS",
    () => {
      const res = runCli(["analyze", "--scenario", scenarioPath]);
      expect(res.status).toBe(0);
      expect(res.stderr).toContain("RUN_SAVED");
      const analysis = JSON.parse(res.stdout) as {
        source: string;
        fixtureId: string;
        baseline: { verdict: string; matchCount: number; identityMatch: boolean };
        cases: Array<{ mutationId: string; verdict: string }>;
      };
      expect(analysis.source).toBe("custom");
      expect(analysis.fixtureId).toBe(CUSTOM_RUN_ID);
      expect(analysis.baseline.verdict).toBe("STABLE");
      expect(analysis.baseline.matchCount).toBe(1);
      expect(analysis.baseline.identityMatch).toBe(true);
      expect(analysis.cases).toHaveLength(8);
      const byId = new Map(analysis.cases.map((c) => [c.mutationId, c.verdict]));
      expect(byId.get("M03")).toBe("MISSING");
      expect(byId.get("M04")).toBe("AMBIGUOUS");
      expect(byId.get("M07")).toBe("AMBIGUOUS");
      expect(byId.get("M01")).toBe("STABLE");
      // The run is stored for later export.
      expect(existsSync(runFile(CUSTOM_RUN_ID))).toBe(true);
      const stored = readRun(CUSTOM_RUN_ID);
      expect(stored["schema"]).toBe("locatorstress.cli-run/v1");
      expect(stored["runId"]).toBe(CUSTOM_RUN_ID);
      expect(stored["analysis"]).toBeDefined();
      expect(stored["scenario"]).toBeDefined();
    },
    120_000,
  );

  it(
    "analyze --fixture F002: real fixture run, 8 cases",
    () => {
      const res = runCli(["analyze", "--fixture", "F002"]);
      expect(res.status).toBe(0);
      const analysis = JSON.parse(res.stdout) as {
        source: string;
        fixtureId: string;
        baseline: { verdict: string };
        cases: Array<{ mutationId: string; verdict: string }>;
      };
      expect(analysis.source).toBe("fixture");
      expect(analysis.baseline.verdict).toBe("STABLE");
      expect(analysis.cases).toHaveLength(8);
      expect(existsSync(runFile("F002"))).toBe(true);
    },
    120_000,
  );

  it(
    "analyze --fixture --mutations M03: subset run, exactly 1 case",
    () => {
      const res = runCli(["analyze", "--fixture", "F001", "--mutations", "M03"]);
      expect(res.status).toBe(0);
      const analysis = JSON.parse(res.stdout) as {
        cases: Array<{ mutationId: string }>;
      };
      expect(analysis.cases).toHaveLength(1);
      expect(analysis.cases[0]?.mutationId).toBe("M03");
    },
    120_000,
  );

  it("analyze: missing file exits 1 SCENARIO_NOT_FOUND", () => {
    const res = runCli(["analyze", "--scenario", "/tmp/p022-cli-tests/nope.json"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("ERROR SCENARIO_NOT_FOUND");
  });

  it("analyze: malformed JSON exits 1 INVALID_SCENARIO_JSON", () => {
    const res = runCli(["analyze", "--scenario", badJsonPath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("ERROR INVALID_SCENARIO_JSON");
  });

  it("analyze: bad schema exits 1 INVALID_SCENARIO (no browser launched)", () => {
    const res = runCli(["analyze", "--scenario", badPath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("ERROR INVALID_SCENARIO");
    expect(res.stderr).toContain("locatorstress.scenario/v1");
  });

  it("analyze: script HTML exits 1 INVALID_SCENARIO", () => {
    const res = runCli(["analyze", "--scenario", scriptPath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("ERROR INVALID_SCENARIO");
    expect(res.stderr).toContain("script elements are not allowed");
  });

  it("analyze: both --scenario and --fixture exits 2 CLI_USAGE", () => {
    const res = runCli([
      "analyze",
      "--scenario",
      scenarioPath,
      "--fixture",
      "F001",
    ]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("ERROR CLI_USAGE");
  });

  it("analyze: neither input exits 2 CLI_USAGE", () => {
    const res = runCli(["analyze"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("ERROR CLI_USAGE");
  });

  it("analyze: unknown flag exits 2 CLI_USAGE", () => {
    const res = runCli(["analyze", "--fixture", "F001", "--bogus"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("ERROR CLI_USAGE");
  });

  it(
    "analyze: ambiguous target fails closed with 422 code",
    () => {
      const res = runCli(["analyze", "--scenario", ambPath]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("ERROR CUSTOM_TARGET_AMBIGUOUS");
    },
    120_000,
  );

  it(
    "analyze: missing target fails closed with 422 code",
    () => {
      const res = runCli(["analyze", "--scenario", missPath]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("ERROR CUSTOM_TARGET_NOT_FOUND");
    },
    120_000,
  );

  it(
    "search --scenario --max-depth 1: FOUND [M03], witness merged into the run",
    () => {
      const res = runCli([
        "search",
        "--scenario",
        scenarioPath,
        "--max-depth",
        "1",
      ]);
      expect(res.status).toBe(0);
      const witness = JSON.parse(res.stdout) as {
        fixtureId: string;
        status: string;
        witness: { sequence: string[]; depth: number; verdict: string } | null;
        statesEvaluated: number;
      };
      expect(witness.fixtureId).toBe(CUSTOM_RUN_ID);
      expect(witness.status).toBe("FOUND");
      expect(witness.witness?.sequence).toEqual(["M03"]);
      expect(witness.witness?.depth).toBe(1);
      expect(witness.witness?.verdict).toBe("MISSING");
      expect(witness.statesEvaluated).toBe(4);
      const stored = readRun(CUSTOM_RUN_ID);
      expect(stored["analysis"]).toBeDefined();
      expect(stored["witness"]).toBeDefined();
    },
    120_000,
  );

  it(
    "search --fixture F002 --max-depth 1: FOUND [M01] WRONG_TARGET",
    () => {
      const res = runCli(["search", "--fixture", "F002", "--max-depth", "1"]);
      expect(res.status).toBe(0);
      const witness = JSON.parse(res.stdout) as {
        status: string;
        witness: { sequence: string[]; verdict: string } | null;
      };
      expect(witness.status).toBe("FOUND");
      expect(witness.witness?.sequence).toEqual(["M01"]);
      expect(witness.witness?.verdict).toBe("WRONG_TARGET");
    },
    120_000,
  );

  it("search: --max-depth 7 exits 2 CLI_USAGE (frozen cap)", () => {
    const res = runCli(["search", "--fixture", "F002", "--max-depth", "7"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("ERROR CLI_USAGE");
    expect(res.stderr).toContain("0..6");
  });

  it("search: --max-expanded-states 0 exits 2 CLI_USAGE", () => {
    const res = runCli([
      "search",
      "--fixture",
      "F002",
      "--max-expanded-states",
      "0",
    ]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("ERROR CLI_USAGE");
    expect(res.stderr).toContain("1..4096");
  });
});

describe("CLI export (stored runs)", () => {
  it("export --run t008 --format json: bytes identical to the evidence file", () => {
    const res = runCli(["export", "--run", "t008", "--format", "json"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("EXPORTED");
    expect(res.stdout).toContain("format json run t008 (full report t008)");
    const outPath = join(RUNS_DIR, "t008.export.json");
    expect(existsSync(outPath)).toBe(true);
    const written = readFileSync(outPath, "utf-8");
    const evidence = readFileSync(
      join(REPO_ROOT, "evidence", "s2", "T008_API_REPORT.json"),
      "utf-8",
    );
    expect(written).toBe(evidence);
    expect(res.stdout).toContain(`sha256 ${sha256Hex(written)}`);
    const parsed = JSON.parse(written) as { schema: string; expectedCases: number };
    expect(parsed.schema).toBe("locatorstress.analysis-report/v1");
    expect(parsed.expectedCases).toBe(192);
  });

  it("export --run t008 --format html: byte-identical to the API export", async () => {
    const outPath = join(RUNS_DIR, "t008.export.html");
    const res = runCli(["export", "--run", "t008", "--format", "html"]);
    expect(res.status).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    const cliHtml = readFileSync(outPath, "utf-8");
    const report = JSON.parse(
      readFileSync(
        join(REPO_ROOT, "evidence", "s2", "T008_API_REPORT.json"),
        "utf-8",
      ),
    ) as unknown;
    const api = await handleApiRequest(
      // The export route needs no service methods; pass a stub.
      {} as never,
      "POST",
      "/api/export",
      { report, format: "html" },
    );
    expect(api.status).toBe(200);
    expect(api.rawBody).toBe(cliHtml);
    expect(scanExternalResources(cliHtml)).toEqual([]);
    const embedded = parseEmbeddedReportJson(cliHtml) as Record<string, unknown>;
    expect(embedded).toEqual(report);
  });

  it("export page-level run: json payload + html with the same embedded JSON", () => {
    const jsonRes = runCli([
      "export",
      "--run",
      CUSTOM_RUN_ID,
      "--format",
      "json",
    ]);
    expect(jsonRes.status).toBe(0);
    const jsonPath = join(RUNS_DIR, `${CUSTOM_RUN_ID}.export.json`);
    const payload = JSON.parse(readFileSync(jsonPath, "utf-8")) as {
      schema: string;
      fixtureId: string;
      analysis: { source: string };
      witness: { status: string } | null;
      scores: { overall: { score: string } } | null;
    };
    expect(payload.schema).toBe("locatorstress.ui-fixture-export/v1");
    expect(payload.fixtureId).toBe(CUSTOM_RUN_ID);
    expect(payload.analysis.source).toBe("custom");
    expect(payload.witness?.status).toBe("FOUND");
    expect(payload.scores?.overall.score).toBe("62.5");

    const htmlRes = runCli([
      "export",
      "--run",
      CUSTOM_RUN_ID,
      "--format",
      "html",
    ]);
    expect(htmlRes.status).toBe(0);
    const htmlPath = join(RUNS_DIR, `${CUSTOM_RUN_ID}.export.html`);
    const html = readFileSync(htmlPath, "utf-8");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(scanExternalResources(html)).toEqual([]);
    // The HTML embeds exactly the JSON the JSON export writes.
    const embedded = parseEmbeddedReportJson(html) as Record<string, unknown>;
    expect(embedded).toEqual(payload);
    expect(html).toContain("MISSING");
    expect(html).toContain("AMBIGUOUS");
  });

  it("export witness-only run as json works; as html fails closed", () => {
    const searchRes = runCli(["search", "--fixture", "F003", "--max-depth", "1"]);
    expect(searchRes.status).toBe(0);
    const stored = readRun("F003");
    expect(stored["analysis"]).toBeUndefined();
    expect(stored["witness"]).toBeDefined();

    const jsonRes = runCli(["export", "--run", "F003", "--format", "json"]);
    expect(jsonRes.status).toBe(0);
    const witness = JSON.parse(
      readFileSync(join(RUNS_DIR, "F003.export.json"), "utf-8"),
    ) as { fixtureId: string; status: string };
    expect(witness.fixtureId).toBe("F003");

    const htmlRes = runCli(["export", "--run", "F003", "--format", "html"]);
    expect(htmlRes.status).toBe(1);
    expect(htmlRes.stderr).toContain("ERROR EXPORT_HTML_REQUIRES_ANALYSIS");
  });

  it("export: unknown run exits 1 UNKNOWN_RUN and lists available runs", () => {
    const res = runCli(["export", "--run", "nope-no-such", "--format", "json"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("ERROR UNKNOWN_RUN");
    expect(res.stderr).toContain("t008");
  });

  it("export: unknown format exits 2 CLI_USAGE", () => {
    const res = runCli(["export", "--run", "t008", "--format", "xml"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("ERROR CLI_USAGE");
  });

  it("export: missing --format exits 2 CLI_USAGE", () => {
    const res = runCli(["export", "--run", "t008"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("ERROR CLI_USAGE");
  });
});

describe("CLI demo (deterministic, offline)", () => {
  it(
    "demo twice: identical stdout and identical stored run; 0 external requests",
    () => {
      const first = runCli(["demo"]);
      expect(first.status).toBe(0);
      expect(first.stdout).toContain("LocatorStress demo (deterministic, offline)");
      expect(first.stdout).toContain("baseline: 3/3 STABLE");
      expect(first.stdout).toContain("cases: 24 (expected 24, completed 24)");
      expect(first.stdout).toContain("score: 75 (18/24 stable of completed)");
      expect(first.stdout).toContain("F001: BOUNDED_NO_WITNESS");
      expect(first.stdout).toContain("F002: FOUND M01 (WRONG_TARGET)");
      expect(first.stdout).toContain("F003: FOUND M04 (AMBIGUOUS)");
      expect(first.stdout).toContain("external requests: 0");
      expect(first.stdout).toContain("run saved:");
      const firstBytes = readFileSync(runFile("demo"), "utf-8");
      const firstSha = sha256Hex(firstBytes);

      const second = runCli(["demo"]);
      expect(second.status).toBe(0);
      expect(second.stdout).toBe(first.stdout);
      const secondBytes = readFileSync(runFile("demo"), "utf-8");
      expect(sha256Hex(secondBytes)).toBe(firstSha);
      expect(secondBytes).toBe(firstBytes);

      const stored = JSON.parse(firstBytes) as {
        schema: string;
        runId: string;
        report: { schema: string; expectedCases: number; notes: string[] };
      };
      expect(stored.schema).toBe("locatorstress.cli-run/v1");
      expect(stored.runId).toBe("demo");
      expect(stored.report.schema).toBe("locatorstress.analysis-report/v1");
      expect(stored.report.expectedCases).toBe(24);
      expect(stored.report.notes.join("\n")).toContain("DEMO_SUBSET");
    },
    180_000,
  );

  it("export --run demo: json == stored report, html embeds the same report", () => {
    const stored = JSON.parse(readFileSync(runFile("demo"), "utf-8")) as {
      report: Record<string, unknown>;
    };
    const jsonRes = runCli(["export", "--run", "demo", "--format", "json"]);
    expect(jsonRes.status).toBe(0);
    const exported = JSON.parse(
      readFileSync(join(RUNS_DIR, "demo.export.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(exported).toEqual(stored.report);

    const htmlRes = runCli(["export", "--run", "demo", "--format", "html"]);
    expect(htmlRes.status).toBe(0);
    const html = readFileSync(join(RUNS_DIR, "demo.export.html"), "utf-8");
    expect(scanExternalResources(html)).toEqual([]);
    const embedded = parseEmbeddedReportJson(html) as Record<string, unknown>;
    expect(embedded).toEqual(stored.report);
  });
});

describe("CLI run-store identity (FIX-R2-02)", () => {
  const DIR = "/tmp/p022-cli-r2-02";
  const MIX_ID = "P022-R2-02-MIX";
  const LOC_ID = "P022-R2-02-LOC";
  const KEEP_ID = "P022-R2-02-KEEP";
  const REP_ID = "P022-R2-02-REP";
  const ONE_BUTTON_SECONDARY_HTML =
    '<main><form><button type="button" class="secondary">Cancel</button></form></main>';

  let mixAPath: string;
  let mixBPath: string;
  let locAPath: string;
  let locBPath: string;
  let keepPath: string;
  let repPath: string;
  let demoPath: string;
  let reservedPath: string;

  beforeAll(() => {
    mkdirSync(DIR, { recursive: true });
    mixAPath = join(DIR, "mix-a.json");
    writeFileSync(
      mixAPath,
      JSON.stringify(cssScenario({ scenario_id: MIX_ID })),
      "utf-8",
    );
    mixBPath = join(DIR, "mix-b.json");
    writeFileSync(
      mixBPath,
      JSON.stringify(
        cssScenario({ scenario_id: MIX_ID, html: ONE_BUTTON_SECONDARY_HTML }),
      ),
      "utf-8",
    );
    locAPath = join(DIR, "loc-a.json");
    writeFileSync(
      locAPath,
      JSON.stringify(cssScenario({ scenario_id: LOC_ID })),
      "utf-8",
    );
    locBPath = join(DIR, "loc-b.json");
    writeFileSync(
      locBPath,
      JSON.stringify(
        cssScenario({
          scenario_id: LOC_ID,
          locator: { kind: "css", selector: "button.secondary" },
        }),
      ),
      "utf-8",
    );
    keepPath = join(DIR, "keep.json");
    writeFileSync(
      keepPath,
      JSON.stringify(cssScenario({ scenario_id: KEEP_ID })),
      "utf-8",
    );
    repPath = join(DIR, "rep.json");
    writeFileSync(
      repPath,
      JSON.stringify(cssScenario({ scenario_id: REP_ID })),
      "utf-8",
    );
    demoPath = join(DIR, "demo.json");
    writeFileSync(
      demoPath,
      JSON.stringify(cssScenario({ scenario_id: "demo" })),
      "utf-8",
    );
    reservedPath = join(DIR, "reserved-f001.json");
    writeFileSync(
      reservedPath,
      JSON.stringify(cssScenario({ scenario_id: "F001" })),
      "utf-8",
    );
  });

  afterAll(() => {
    for (const id of [MIX_ID, LOC_ID, KEEP_ID, REP_ID, "demo"]) {
      rmSync(runFile(id), { force: true });
    }
    rmSync(DIR, { recursive: true, force: true });
  });

  /** Plant a stored run holding a complete report; returns its bytes. */
  function plantReportRun(runId: string): string {
    const envelope = {
      schema: "locatorstress.cli-run/v1",
      runId,
      report: {
        schema: "locatorstress.analysis-report/v1",
        note: "planted by FIX-R2-02 test: a complete report that must never be overwritten",
      },
    };
    writeFileSync(runFile(runId), `${JSON.stringify(envelope)}\n`, "utf-8");
    return readFileSync(runFile(runId), "utf-8");
  }

  function scenarioFileFingerprint(path: string): string {
    const scenario = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return hashCanonical({ kind: "custom", scenario });
  }

  it(
    "search with changed HTML drops the stale analysis (GPT P1-02 repro)",
    () => {
      const a = runCli(["analyze", "--scenario", mixAPath]);
      expect(a.status).toBe(0);
      const analysisA = JSON.parse(a.stdout) as {
        baseline: { verdict: string };
      };
      expect(analysisA.baseline.verdict).toBe("STABLE");
      const storedA = readRun(MIX_ID);
      expect(storedA["scenario_sha256"]).toBe(scenarioFileFingerprint(mixAPath));

      const s = runCli(["search", "--scenario", mixBPath, "--max-depth", "1"]);
      expect(s.status).toBe(0);
      const witness = JSON.parse(s.stdout) as {
        status: string;
        witness: { sequence: string[]; depth: number; verdict: string } | null;
      };
      expect(witness.status).toBe("FOUND");
      expect(witness.witness?.sequence).toEqual([]);
      expect(witness.witness?.depth).toBe(0);
      expect(witness.witness?.verdict).toBe("MISSING");

      // The stored run must NOT mix scenario B with analysis A.
      const stored = readRun(MIX_ID);
      expect(stored["analysis"]).toBeUndefined();
      expect(stored["witness"]).toBeDefined();
      expect((stored["scenario"] as { html: string }).html).toContain(
        "secondary",
      );
      expect((stored["scenario"] as { html: string }).html).not.toContain(
        "primary",
      );
      expect(stored["scenario_sha256"]).toBe(scenarioFileFingerprint(mixBPath));
      expect(stored["scenario_sha256"]).not.toBe(storedA["scenario_sha256"]);
    },
    180_000,
  );

  it(
    "search with changed locator drops the stale analysis",
    () => {
      const a = runCli(["analyze", "--scenario", locAPath]);
      expect(a.status).toBe(0);
      expect(
        (JSON.parse(a.stdout) as { baseline: { verdict: string } }).baseline
          .verdict,
      ).toBe("STABLE");

      const s = runCli(["search", "--scenario", locBPath, "--max-depth", "1"]);
      expect(s.status).toBe(0);
      const witness = JSON.parse(s.stdout) as {
        status: string;
        witness: { sequence: string[]; depth: number; verdict: string } | null;
      };
      expect(witness.status).toBe("FOUND");
      expect(witness.witness?.depth).toBe(0);
      expect(witness.witness?.verdict).toBe("WRONG_TARGET");

      const stored = readRun(LOC_ID);
      expect(stored["analysis"]).toBeUndefined();
      expect(stored["witness"]).toBeDefined();
      expect(stored["scenario_sha256"]).toBe(scenarioFileFingerprint(locBPath));
    },
    180_000,
  );

  it(
    "search with the unchanged scenario keeps the analysis",
    () => {
      const a = runCli(["analyze", "--scenario", keepPath]);
      expect(a.status).toBe(0);
      const storedA = readRun(KEEP_ID);
      expect(storedA["scenario_sha256"]).toBe(
        scenarioFileFingerprint(keepPath),
      );

      const s = runCli(["search", "--scenario", keepPath, "--max-depth", "1"]);
      expect(s.status).toBe(0);
      const stored = readRun(KEEP_ID);
      expect(stored["analysis"]).toBeDefined();
      expect(stored["witness"]).toBeDefined();
      expect(stored["scenario_sha256"]).toBe(storedA["scenario_sha256"]);
    },
    180_000,
  );

  it("analyze/search with scenario_id demo are refused; the demo report is untouched", () => {
    const before = plantReportRun("demo");
    const a = runCli(["analyze", "--scenario", demoPath]);
    expect(a.status).toBe(1);
    expect(a.stderr).toContain("ERROR RESERVED_RUN_ID");
    expect(a.stderr).not.toContain("RUN_SAVED");
    expect(readFileSync(runFile("demo"), "utf-8")).toBe(before);

    const s = runCli(["search", "--scenario", demoPath, "--max-depth", "1"]);
    expect(s.status).toBe(1);
    expect(s.stderr).toContain("ERROR RESERVED_RUN_ID");
    expect(readFileSync(runFile("demo"), "utf-8")).toBe(before);
  });

  it("analyze with scenario_id F001 is refused before any browser work", () => {
    const res = runCli(["analyze", "--scenario", reservedPath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("ERROR RESERVED_RUN_ID");
    expect(res.stderr).toContain("F001");
  });

  it("analyze/search refuse a stored complete report on a non-reserved id", () => {
    const before = plantReportRun(REP_ID);
    const a = runCli(["analyze", "--scenario", repPath]);
    expect(a.status).toBe(1);
    expect(a.stderr).toContain("ERROR REPORT_OVERWRITE_REFUSED");
    expect(readFileSync(runFile(REP_ID), "utf-8")).toBe(before);

    const s = runCli(["search", "--scenario", repPath, "--max-depth", "1"]);
    expect(s.status).toBe(1);
    expect(s.stderr).toContain("ERROR REPORT_OVERWRITE_REFUSED");
    expect(readFileSync(runFile(REP_ID), "utf-8")).toBe(before);
  });

  it(
    "fixture analyze/search keep the analysis under the fixture fingerprint",
    () => {
      const a = runCli(["analyze", "--fixture", "F003"]);
      expect(a.status).toBe(0);
      const storedA = readRun("F003");
      expect(storedA["scenario_sha256"]).toBe(
        hashCanonical({ kind: "fixture", fixtureId: "F003" }),
      );

      const s = runCli(["search", "--fixture", "F003", "--max-depth", "1"]);
      expect(s.status).toBe(0);
      const stored = readRun("F003");
      expect(stored["analysis"]).toBeDefined();
      expect(stored["witness"]).toBeDefined();
      expect(stored["scenario_sha256"]).toBe(storedA["scenario_sha256"]);
    },
    180_000,
  );
});

describe("CLI dev (real UI server)", () => {
  it(
    "dev serves the UI page and /api/health, then exits 0 on SIGTERM",
    async () => {
      const child: ChildProcess = spawn("node", [CLI_ENTRY, "dev", "--port", "0"], {
        cwd: REPO_ROOT,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });
      const exitPromise = new Promise<number | null>((done) => {
        child.once("exit", (code) => done(code));
      });
      try {
        let uiUrl = "";
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          const match = /UI_URL=(http:\/\/127\.0\.0\.1:\d+)/.exec(stdout);
          if (match?.[1]) {
            uiUrl = match[1];
            break;
          }
          if (child.exitCode !== null) break;
          await sleep(200);
        }
        expect(uiUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        const pageRes = await fetch(`${uiUrl}/`);
        expect(pageRes.status).toBe(200);
        const pageText = await pageRes.text();
        expect(pageText).toContain("<title>LocatorStress");
        const healthRes = await fetch(`${uiUrl}/api/health`);
        expect(healthRes.status).toBe(200);
        const health = (await healthRes.json()) as { status: string };
        expect(health.status).toBe("ok");
      } finally {
        child.kill("SIGTERM");
        const code = await Promise.race([
          exitPromise,
          sleep(15_000).then(() => null),
        ]);
        if (code === null) {
          child.kill("SIGKILL");
          await exitPromise;
        }
        expect(stderr).not.toContain("failed to start UI server");
      }
      const finalCode = await exitPromise;
      expect(finalCode).toBe(0);
    },
    60_000,
  );
});
