// FIX-P022-T013-01 — run every verification command in one go.
//
// Order (matches T013 test_commands.txt, minus the exclusions below):
//   typecheck, typecheck:scripts, build, test, test:oracle,
//   test:offline, test:stress, test:coverage, test:mutation
//
// NOT run here, by design:
//   - test:performance — rewrites evidence/s4/T012_PERF.json. That file
//     holds measured timings (matrix/BFS milliseconds, RSS), so every
//     run produces new numbers and a new SHA, breaking the FIX-04
//     alignment in evidence/s4/T012_E2E_OFFLINE_PERF_REPORT.md.
//   - test:e2e — its only file, tests/e2e/e2e-main-flow.test.ts,
//     rewrites evidence/s4/T012_E2E_REQUESTS.json (and writes traces
//     under evidence/s4/traces/), so it cannot run without touching
//     frozen evidence either.
//   - s0:gate — the S0 gate is run separately by the coordinator.
//
// The two evidence-rewriting test files are also excluded from the
// `test` and `test:coverage` steps (vitest --exclude, one flag per
// file), because a plain full `vitest run` collects them: without the
// excludes, the `test` step itself would rewrite the frozen T012
// evidence. The exclusion list is exhaustive for test files whose
// re-run changes frozen evidence content: every other test that writes
// under evidence/ regenerates byte-identical files by design
// (recomputable verdicts/counts only — T002, T004, T005, T007,
// T011_ORACLE_PARITY; the ui-flow screenshots are not frozen), and
// test:offline and test:stress write nothing under evidence/ at all.
// Coverage of the two excluded files rests on the T012 frozen records
// (evidence/s4/T012_PERF.json + T012_E2E_REQUESTS.json, whose SHAs the
// FIX-04 report quotes) plus the coordinator's full re-run.
//
// NOTE: the test:mutation step regenerates its own results artifact,
// evidence/s4/T011_MUTATION_RESULTS.json, on every run. The runner
// writes deterministic output (the payload no longer includes
// per-mutant durationMs — timings remain only in console output), so a
// re-run produces a byte-identical file and no longer changes the
// file's SHA or breaks verify:review-pack. The file is listed in
// scripts/verify-review-pack.mjs KNOWN_FIX_DELTAS because the
// deterministic payload differs from the frozen (pre-FIX) value by the
// removed durationMs field alone.
//
// Stops at the first failing step and exits with that step's exit code
// (non-zero). Each step runs via `npm run <name>` with output inherited
// so no exit code is ever hidden behind a pipe; the `test` and
// `test:coverage` steps pass their --exclude flags through as
// `npm run <name> -- --exclude <file> ...`.
//
// Usage: npm run verify:all
// Exit:  0 iff every step passes; otherwise the failing step's code.

import { spawnSync } from "node:child_process";

// Evidence-rewriting tests: running them rewrites frozen T012 evidence
// (see header). vitest --exclude takes one glob per flag and may be
// repeated; the paths are relative to the project root.
const EVIDENCE_REWRITING_TESTS = [
  "tests/e2e/performance.test.ts",
  "tests/e2e/e2e-main-flow.test.ts",
];
const EXCLUDE_ARGS = EVIDENCE_REWRITING_TESTS.flatMap((f) => [
  "--exclude",
  f,
]);

// Steps: { name } runs `npm run <name>`; { name, extraArgs } appends the
// args after `--` (`npm run <name> -- <args...>`).
const STEPS = [
  { name: "typecheck" },
  { name: "typecheck:scripts" },
  { name: "build" },
  { name: "test", extraArgs: EXCLUDE_ARGS },
  { name: "test:oracle" },
  { name: "test:offline" },
  { name: "test:stress" },
  { name: "test:coverage", extraArgs: EXCLUDE_ARGS },
  { name: "test:mutation" },
];

const started = Date.now();
for (let i = 0; i < STEPS.length; i += 1) {
  const step = STEPS[i];
  const label = `npm run ${step.name}`;
  console.log(`\n=== [${i + 1}/${STEPS.length}] ${label} ===`);
  const stepStart = Date.now();
  const args = ["run", step.name];
  if (step.extraArgs !== undefined && step.extraArgs.length > 0) {
    args.push("--", ...step.extraArgs);
  }
  const result = spawnSync("npm", args, { stdio: "inherit" });
  const elapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
  const code = result.status ?? 1;
  if (code !== 0) {
    console.error(
      `\nverify:all FAILED at step ${i + 1}/${STEPS.length} (${label}, exit ${code}, ${elapsed}s)`,
    );
    process.exit(code);
  }
  console.log(`--- step ${i + 1}/${STEPS.length} passed: ${label} (${elapsed}s)`);
}
const total = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\nverify:all PASSED — all ${STEPS.length} steps green (${total}s total)`);
