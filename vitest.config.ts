// T011 — vitest configuration: v8 coverage for the frozen production tree.
//
// Coverage measures src/ only (production code). Tests, scripts and
// fixtures are excluded: scripts/ holds orchestration (oracle, gate,
// reports) whose coverage is not part of the T011 acceptance, and
// test code measuring itself would inflate the number.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/fixtures/**", "**/*.d.ts"],
      reporter: ["text", "json-summary", "json"],
      reportsDirectory: "coverage",
      all: true,
    },
  },
});
