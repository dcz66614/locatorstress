// T006 unit tests — forbidden-field scan (PROJECT_BOOK §6).
// The scanner is tested against planted forbidden values (each rule must
// fire on its own target) and against clean canonical bytes (0 hits),
// including the two known near-misses in the frozen data: the word
// "root" inside fixture HTML "shadowrootmode", and the bare date in the
// fixed seed (neither is a leak).
import { describe, it, expect } from "vitest";

import {
  buildScenarioCanonical,
  canonicalJson,
} from "../../src/canonical/index.js";
import {
  buildForbiddenScanRules,
  defaultForbiddenScanContext,
  scanForbiddenFields,
} from "../../src/canonical/forbidden-scan.js";
import { repoRoot } from "../integration/s0-helpers.js";

function ctx() {
  return defaultForbiddenScanContext(repoRoot(), process.env.HOME ?? "");
}

describe("forbidden scan — rule set", () => {
  it("runs a non-empty rule set covering every §6 forbidden category", () => {
    const rules = buildForbiddenScanRules(ctx());
    const ids = rules.map((r) => r.id);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    for (const required of [
      "created-at",
      "wall-clock-iso",
      "epoch-millis",
      "uuid",
      "cdp-object-id",
      "cdp-dotted-id",
      "pid",
      "windows-absolute-path",
      "absolute-path-literal",
      "hostname-literal",
      "username-in-path",
    ]) {
      expect(ids).toContain(required);
    }
    // Every rule carries a human-readable description (listed in the report).
    for (const rule of rules) {
      expect(rule.description.length).toBeGreaterThan(0);
    }
  });
});

describe("forbidden scan — planted values trip their own rule", () => {
  it.each([
    ['{"createdAt":"2026-11-10T19:00:00Z"}', "created-at"],
    ['{"ts":"2026-11-10T19:00:00.123Z"}', "wall-clock-iso"],
    ['{"ts":"2026-11-10 19:00:00"}', "wall-clock-iso"],
    ['{"t":1794000000000}', "epoch-millis"],
    ['{"id":"123e4567-e89b-12d3-a456-426614174000"}', "uuid"],
    ['{"handle":{"objectId":"123456789.1.2"}}', "cdp-object-id"],
    ['{"ref":"123456789.1.2"}', "cdp-dotted-id"],
    ['{"pid":1234}', "pid"],
    ['{"processId":99}', "pid"],
    ['{"path":"C:\\Users\\sam\\file.txt"}', "windows-absolute-path"],
  ])("planted %s trips rule %s", (text, ruleId) => {
    const result = scanForbiddenFields(text, ctx());
    expect(result.totalHits).toBeGreaterThan(0);
    expect(result.hits.map((h) => h.ruleId)).toContain(ruleId);
  });

  it("planted repo-root / HOME / tmpdir / hostname literals trip absolute-path-literal or hostname-literal", () => {
    const c = ctx();
    const byPath = scanForbiddenFields(`{"path":"${c.repoRoot}/x.json"}`, c);
    expect(byPath.hits.map((h) => h.ruleId)).toContain("absolute-path-literal");
    const byHome = scanForbiddenFields(`{"path":"${c.homeDir}/x"}`, c);
    expect(byHome.hits.map((h) => h.ruleId)).toContain("absolute-path-literal");
    const byHost = scanForbiddenFields(`{"host":"${c.hostname}"}`, c);
    expect(byHost.hits.map((h) => h.ruleId)).toContain("hostname-literal");
    const byUser = scanForbiddenFields(`{"path":"/home/${c.username}/x"}`, c);
    expect(byUser.hits.map((h) => h.ruleId)).toContain("username-in-path");
  });
});

describe("forbidden scan — clean bytes and known near-misses", () => {
  it("clean canonical bytes scan 0 hits", () => {
    const text = canonicalJson({
      schema: "locatorstress.scenario-canonical/v1",
      seed: "P022-LOCATORSTRESS-S0-2026-11-10",
      fixtures: [],
    });
    const result = scanForbiddenFields(text, ctx());
    expect(result.totalHits).toBe(0);
    expect(result.hits).toEqual([]);
  });
  it("the bare seed date alone is not a wall clock", () => {
    const result = scanForbiddenFields("P022-LOCATORSTRESS-S0-2026-11-10", ctx());
    expect(result.totalHits).toBe(0);
  });
  it("fixture HTML containing 'shadowrootmode' does NOT trip the username rule (username here is 'root')", () => {
    const c = ctx();
    expect(c.username).toBe("root");
    const text = '<template shadowrootmode="open"><button>Submit</button></template>';
    const result = scanForbiddenFields(text, c);
    expect(result.hits.map((h) => h.ruleId)).not.toContain("username-in-path");
    expect(result.totalHits).toBe(0);
  });
  it("a small built scenario object scans 0 hits end to end", () => {
    const obj = buildScenarioCanonical([
      {
        fixtureId: "F001",
        family: "form-submit",
        kind: "css",
        controlGroup: "stable",
        locator: { kind: "css", selector: "button" },
        html: "<button>Submit</button>",
      },
    ]);
    const result = scanForbiddenFields(canonicalJson(obj), ctx());
    expect(result.totalHits).toBe(0);
  });
});
