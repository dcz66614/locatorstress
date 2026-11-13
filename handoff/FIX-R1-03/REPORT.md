# FIX-R1-03 — Five CLI commands (P022-R1-P1-03)

- Task: P022-R1-P1-03 — "five CLI commands missing" (PROJECT_BOOK §7.3 CLI table).
- Work dir: `~/workspace/p022-locatorstress/` (git local, no remote). HEAD at start: `c162579` (FIX-R1-01 + FIX-R1-02 committed).
- Status: **DONE, not committed** (coordinator commits). No push, no commit by this session.
- Date: 2026-11-11 (work ~16:05–17:00 GMT).
- Model route: Muse self-review only (all work done directly in this session; no WorkBuddy/Qoder/Copilot calls needed).

## What was built

All five §7.3 CLI commands now exist as npm scripts and work end to end.
Every command reuses the existing service API — FIX-R1-01's custom-scenario
path for analyze/search and FIX-R1-02's export path for export — and the
frozen runner/mutations/Oracle/BFS. The CLI computes no verdict, score or
witness itself.

### New module: `src/cli/` (12 files) + `tests/cli/cli.test.ts`

| File | Change |
|---|---|
| `src/cli/index.ts` (NEW) | Entry point + dispatch + top-level usage; failures print `ERROR <CODE>: <message>` on stderr; exit 0 ok / 1 work failed / 2 invoked wrongly |
| `src/cli/errors.ts` (NEW) | `CliError` + `usageError` (exit 2) / `runtimeError` (exit 1) |
| `src/cli/args.ts` (NEW) | `--long` flag parser (value/boolean flags, `--` separator, duplicate/unknown-flag rejection) + integer-range validation |
| `src/cli/run-store.ts` (NEW) | Run store: `runs/<runId>.json` envelopes (`locatorstress.cli-run/v1`), repo-root resolution from `import.meta.url`, verified writes (read-back + sha256, 3-attempt retry on EPERM jitter), `t008` special id |
| `src/cli/browser-service.ts` (NEW) | Shared browser lifecycle (frozen `launchBaselineBrowser` + `createBrowserAnalysisService`) + ApiError → CLI error-code mapping |
| `src/cli/page-payload.ts` (NEW) | Page-level export payload builder (same shape as `src/ui/app.js` `buildPageExportPayload`; scores via frozen T005 scorer, same controlGroup mapping as `src/ui/server.ts`) |
| `src/cli/node-shims.d.ts` (NEW) | Minimal ambient declarations for `mkdirSync`/`readdirSync` (project has no `@types/node`; same precedent as `src/canonical/node-shims.d.ts`) |
| `src/cli/commands/analyze.ts` (NEW) | `analyze` |
| `src/cli/commands/search.ts` (NEW) | `search` |
| `src/cli/commands/demo.ts` (NEW) | `demo` |
| `src/cli/commands/dev.ts` (NEW) | `dev` |
| `src/cli/commands/export.ts` (NEW) | `export` |
| `src/cli/commands/input.ts` (NEW) | Shared `--scenario`/`--fixture` resolution; scenario file read + parsed + shape-validated **before** any browser launch |
| `tests/cli/cli.test.ts` (NEW, 30 tests) | Subprocess tests (see below) |
| `package.json` | Added `dev`, `demo`, `analyze`, `search`, `export`, `test:cli` scripts (no other script changed) |
| `.gitignore` | Added `runs/` (local lab state, like `dist/`) |
| `src/ui/server.ts` | **One import-safety fix (see below)** — the only change to a pre-existing source file |

### The one change to pre-existing code (not a requirement change)

`src/ui/server.ts` ran `void main()` unconditionally at module load, so
importing `startUiServer()` from the CLI parsed the *CLI's* argv as UI-server
args and printed a spurious `failed to start UI server: unknown argument …`
plus a wrong exit code on every CLI invocation. Fix: `main()` now runs only
when the module is the entry point (`resolve(process.argv[1]) ===
fileURLToPath(import.meta.url)`). Behaviour of `node dist/ui/server.js` is
unchanged (verified by the live dev demo and by the full suite: `test:ui`
12/12, `test:e2e:custom` 6/6, `test:offline` 6/6 all still green). No product
logic, route, or UI behaviour was touched.

### NOT touched

Frozen modules (`runner/`, `mutations/`, `canonical/`, `fixtures/`,
`score/`, `oracle/identity-compare.ts`, `oracle/target-capture.ts`), S0 gate
scripts, golden files, the export HTML renderer, the API routes, any of the
23 P2s. `git diff --name-only` confirms: only `.gitignore`, `package.json`,
`src/ui/server.ts` modified; everything else is new files under `src/cli/`
and `tests/cli/`.

### Diff stat (tracked files)

```
 .gitignore       | 1 +
 package.json     | 6 ++++++
 src/ui/server.ts | 13 ++++++++++++-
 3 files changed, 19 insertions(+), 1 deletion(-)
```

New files: 1,501 lines in `src/cli/` (13 files incl. shims), 647 lines in
`tests/cli/cli.test.ts`.

## The five commands

### Run store (shared by all five)

A "run" is one fixture/custom scenario's latest CLI output, stored as
`runs/<runId>.json` (`locatorstress.cli-run/v1` envelope: `runId`,
`analysis?`, `witness?`, `scenario?`, `report?`). `analyze` replaces the
stored run wholesale (a stale witness/report belonged to the previous
analysis); `search` merges its witness into the stored run (keeping a
stored analysis). `runs/` is gitignored local lab state, never part of
any canonical hash, never under `evidence/`. `export --run t008` reads the
frozen T008 report at `evidence/s2/T008_API_REPORT.json` directly
(read-only, never overwritten or copied into the store).

### 1. `npm run dev [--port N] [--host 127.0.0.1]`

Starts the local Web UI server — the same `startUiServer()` the UI entry
point uses (frozen API proxied same-origin, static UI files, loopback-only
bind) — and stays in the foreground until SIGINT/SIGTERM (clean exit 0).
Default port 0 (ephemeral, repo convention); prints `UI_URL=` / `API_URL=`.

- Error codes: `CLI_USAGE` (exit 2, bad flag/port), `SERVER_START_FAILED`
  (exit 1, e.g. non-loopback `--host`).

### 2. `npm run demo [--out <path>]`

Fixed, deterministic, offline demo: baseline + M01–M08 for fixtures F001,
F002, F003 plus the T008 BFS samples (F001 depth 2, F002 depth 1, F003 depth
1), assembled into a real full `AnalysisReport` with the frozen
`buildAnalysisReport()` and stored as run `demo` (`runs/demo.json`).
Deterministic: fixed fixtures/bounds/seed, no wall-clock, no ports in the
output — two runs produce byte-identical stdout and an identical
`runs/demo.json`. Offline: the demo browser aborts every non-loopback
request; the run prints `external requests: 0`.

- Honesty note: the demo covers 3 of 24 fixtures (24 cases), so it is NOT
  the 192-case gate. The stored report says so in its notes and carries
  `gateResult: FAIL` / `gateFailureType: DEMO_SUBSET` — the gate field is
  this report's own gate, not the frozen S0 gate. No PASS is claimed.
- Live result: baseline 3/3 STABLE, 24 cases, verdicts STABLE 18 /
  WRONG_TARGET 5 / AMBIGUOUS 1 / MISSING 0, score `75` (18/24),
  F001 `BOUNDED_NO_WITNESS`, F002 `FOUND [M01] WRONG_TARGET`,
  F003 `FOUND [M04] AMBIGUOUS`, external requests 0.
  Demo hashes: scenario `50bb45db…`, oracle `3a2e6f28…`,
  analysis `917addcb…`, gate `115b30df…` (demo-report hashes, not S0's).
- Error codes: `BROWSER_LAUNCH_FAILED`, `INTERNAL_ERROR` (exit 1);
  `CLI_USAGE` (exit 2).

### 3. `npm run analyze -- --scenario <file> | --fixture <id> [--mutations M01,M03] [--out <path>]`

Baseline + single mutations for one fixture or one custom scenario through
the frozen `AnalysisService` (real Playwright + M01–M08 + Oracle +
classification). Prints the `FixtureAnalysis` as canonical JSON on stdout;
also saves the run (`runs/<fixtureId|scenario_id>.json`) and prints
`RUN_SAVED <path>` on stderr. `--fixture` is the CLI form of the frozen
fixture runs; the spec's §7.3 table shows only the `--scenario` form, so
both are supported and documented (exactly one required). `--mutations`
runs a subset (validated M01–M08, deduped).

- Error codes (fail closed, exit 1 unless noted):
  `SCENARIO_NOT_FOUND` (missing file), `INVALID_SCENARIO_JSON` (unparsable),
  `INVALID_SCENARIO` (bad schema / unsafe HTML / missing target — validated
  before any browser launch), `INVALID_FIXTURE` (bad fixture id),
  `CUSTOM_TARGET_NOT_FOUND` / `CUSTOM_TARGET_AMBIGUOUS` /
  `CUSTOM_HTML_TOO_LARGE` (service 422s passed through verbatim),
  `BROWSER_LAUNCH_FAILED`, `INVALID_REQUEST` (other service 400s).
  `CLI_USAGE` (exit 2): both/neither input, unknown flag, bad `--mutations`.
- Live result (custom scenario `P022-CLI-LIVE`, `button.primary`): baseline
  STABLE (match 1, identity true); M01 STABLE, M02 STABLE, **M03 MISSING**,
  **M04 AMBIGUOUS**, M05 STABLE, M06 STABLE, **M07 AMBIGUOUS**, M08 STABLE.

### 4. `npm run search -- --scenario <file> | --fixture <id> [--max-depth 0..6] [--max-expanded-states 1..4096] [--out <path>]`

Bounded BFS witness search through the same service (real Playwright +
M01–M08 + Oracle + BFS, frozen caps depth ≤ 6 / states ≤ 4096). Prints the
`WitnessSummary` as canonical JSON on stdout; merges the witness into the
stored run. Bounds are validated in the CLI first (exit 2 when out of
range) and re-validated by the service.

- Error codes: same input codes as analyze, plus `CLI_USAGE` (exit 2) for
  `--max-depth` outside 0..6 or `--max-expanded-states` outside 1..4096.
- Live result (same custom scenario, depth 1): `FOUND`, witness
  `{ sequence: ["M03"], depth: 1, verdict: "MISSING" }`,
  `statesEvaluated: 4`. Fixture F002 depth 1: `FOUND [M01] WRONG_TARGET`.

### 5. `npm run export -- --run <id> --format json|html [--out <path>] [--stdout]`

Exports a stored run/report. Two tiers, both reusing the wired exporters
(no rendering logic in the CLI):

1. **Full report** — run id `t008` (frozen T008 report) or any stored run
   holding a full `AnalysisReport` (the `demo` run):
   json → `exportReportJson()`, html → `exportReportHtml()` — the exact
   functions `POST /api/export` calls, so CLI bytes are byte-identical to
   the API export of the same report (asserted by test).
2. **Page-level run** — a stored analyze/search run:
   json → canonical JSON of the page-level payload,
   html → `exportPageReportHtml()` (FIX-R1-02's UI page renderer).
   This is the UI page-level export. A custom run **cannot** be a full
   `AnalysisReport` (ReportCase requires controlGroup stable|fragile + a
   non-null expectedVerdict), so the page-level export is the only honest
   HTML path for custom runs — the same conclusion FIX-R1-02 reached.
   The HTML embeds exactly the canonical JSON the JSON export writes, so
   the two formats agree by construction. A witness-only run (no stored
   analysis) exports as JSON only; HTML fails closed with
   `EXPORT_HTML_REQUIRES_ANALYSIS`.

- Output: by default the document is written to
  `runs/<id>.export.json|.html` and the CLI prints
  `EXPORTED <path> <bytes> bytes sha256 <hash> format <format> run <id>
  (<kind>)`. `--out <path>` writes there instead; `--stdout` prints the
  document itself. Run ids are validated (`[A-Za-z0-9_-]{1,64}`) before
  any path is joined.
- Error codes: `UNKNOWN_RUN` (exit 1; message lists available runs),
  `INVALID_REPORT` / `INVALID_RUN` (exit 1),
  `EXPORT_HTML_REQUIRES_ANALYSIS` (exit 1), `CLI_USAGE` (exit 2: missing
  `--run`/`--format`, unknown format value, `--out` + `--stdout` together,
  bad run id).
- Live result: `t008` json export bytes are identical to
  `evidence/s2/T008_API_REPORT.json` (94,248 B); `t008` html export is
  string-identical to the API's `POST /api/export` html for the same
  report (308,017 chars / 308,103 bytes — the difference is UTF-8
  multi-byte characters vs JS string length, same document).

### Exit-code / error-code summary

| Situation | Code | Exit |
|---|---|---|
| Success | — | 0 |
| Unknown/missing command, unknown flag, missing required flag, malformed flag value (`--max-depth` 0..6, `--max-expanded-states` 1..4096, `--format` json\|html, `--mutations` list, bad run id) | `CLI_USAGE` | 2 |
| Scenario file missing / unreadable | `SCENARIO_NOT_FOUND` | 1 |
| Scenario file not JSON | `INVALID_SCENARIO_JSON` | 1 |
| Scenario fails shape/safety/run validation | `INVALID_SCENARIO` | 1 |
| Bad fixture id | `INVALID_FIXTURE` | 1 |
| Target matches 0 / >1 / HTML too large (service 422s) | `CUSTOM_TARGET_NOT_FOUND` / `CUSTOM_TARGET_AMBIGUOUS` / `CUSTOM_HTML_TOO_LARGE` | 1 |
| Unknown run id | `UNKNOWN_RUN` | 1 |
| Stored report fails validation / stored run malformed | `INVALID_REPORT` / `INVALID_RUN` | 1 |
| HTML export of a witness-only run | `EXPORT_HTML_REQUIRES_ANALYSIS` | 1 |
| Chromium launch failure / UI server start failure | `BROWSER_LAUNCH_FAILED` / `SERVER_START_FAILED` | 1 |

## New tests (30, `tests/cli/cli.test.ts`, `npm run test:cli`)

The CLI is tested as a real subprocess (`node dist/cli/index.js …`, the
exact entry point the npm scripts run): exit codes, stdout/stderr and the
run store are asserted from the outside. The suite cleans up every run it
creates (verified: `runs/` is empty after the suite).

| Group | Tests | Coverage |
|---|---|---|
| Usage (no browser) | 4 | no-args → 2, `--help` → 0, unknown command → 2, per-command `--help` → 0 |
| Analyze/search (real browser) | 15 | custom happy path (baseline STABLE, M03 MISSING, M04/M07 AMBIGUOUS, run stored); fixture F002 (8 cases); `--mutations M03` subset (1 case); missing file / bad JSON / bad schema / script HTML / both inputs / neither / unknown flag; ambiguous + missing target 422s; search custom FOUND [M03] + witness merged into run; search F002 FOUND [M01]; `--max-depth 7` / `--max-expanded-states 0` → 2 |
| Export (stored runs) | 7 | t008 json bytes == evidence file; t008 html == API export bytes (`handleApiRequest` in-process) + embedded JSON == report; page-level json + html with identical embedded JSON (score 62.5, MISSING/AMBIGUOUS present); witness-only run json ok / html fails closed; unknown run / bad format / missing format |
| Demo (deterministic, offline) | 2 | demo twice: identical stdout + identical `runs/demo.json` (sha), 0 external requests, exact verdicts/witnesses; demo export json == stored report, html embeds same report |
| Dev (real UI server) | 1 | dev serves `/` 200 + title, `/api/health` 200 ok, SIGTERM → exit 0, no spurious stderr |

## Acceptance (all run sequentially, exit codes read from files — no piped exit codes)

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` | 0 | clean |
| `npm run build` | 0 | clean (`dist/cli/` + `dist/cli/commands/` emitted) |
| `npm run test:cli` | 0 | **30/30 passed** (1 file, ~32 s) |
| `npm test` (full suite) | 0 | **46 files, 590 passed** (baseline 560 + this fix 30) |
| `npm run s0:gate` | 0 | **GATE PASS** (see hashes below; ~16 min incl. 100 replays) |

### s0:gate — GATE PASS, all four hashes EXACTLY unchanged

```
REPEAT_HASH runs=100/100 unique_gate_hashes=1
GATE PASS failure_type=null gate_sha256=651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52
```

| Hash | Fresh gate run (`evidence/s0/S0_GATE.json`) | Frozen / R1-verdict value | Match |
|---|---|---|---|
| scenario_sha256 | `1ffb5f85561c6dd9f10fc15773097691c5c07fe20c6e9a001e231a41b61c9f22` | same | ✅ |
| oracle_result_sha256 | `3502d81fa730605ddd8548e39af6b7272015c026e65f91a2dae132c3e345a988` | same | ✅ |
| analysis_sha256 | `4410d5c85cf5fe8ee858c4e01822cdbc1515c39afa7ba40d833aceb00a9576a4` | same | ✅ |
| gate_sha256 | `651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52` | same | ✅ |

No per-field diff exists to report.

### Other checks run

| Command | Exit | Result |
|---|---|---|
| `node scripts/verify-review-pack.mjs` | 1 | **34 problems, ALL attributable to the FIX-R1-01/02/03 change surface** (see below) — expected, same as FIX-R1-01 |
| Chromium probe (`chromium-1254 --version`) | 0 | `Google Chrome for Testing 158.0.8127.18` — healthy; no Chromium failure hit during this session |

`verify:review-pack` (34 problems = exactly the three R1 fixes' surface,
nothing else): 16 files missing from `COVERAGE_MATRIX.csv` (13 CLI files
from this fix + `custom-scenario.ts` + `custom-target.ts` from FIX-R1-01 +
`ui-report-html.ts` from FIX-R1-02); 9 sha256 mismatches in the matrix + 9
in `sha256.txt` (the 8 FIX-R1-01 files + `src/ui/server.ts`, whose hash
also changed by this fix's import guard). No frozen module, fixture,
golden file or hash mismatched. Resolution belongs to FIX-R1-04 (re-freeze
regenerates the review pack); the script cannot pass before that by design.

`test:mutation` was not re-run: the runner mutates only frozen pure modules
(`classify`, `score`, `canonical`, …), none of which this fix touches.

## Live demo (real terminal, all five commands via `npm run`)

Custom scenario `P022-CLI-LIVE` (two-button page, `button.primary`, target
`main > form > button:nth-child(1)`); demo run `demo` left in `runs/` for
immediate re-export.

```
$ npm run demo
live_demo_exit=0
LocatorStress demo (deterministic, offline)
fixtures: F001 F002 F003
baseline: 3/3 STABLE
cases: 24 (expected 24, completed 24)
verdicts: STABLE 18 / WRONG_TARGET 5 / AMBIGUOUS 1 / MISSING 0
score: 75 (18/24 stable of completed)
witnesses:
  F001: BOUNDED_NO_WITNESS —
  F002: FOUND M01 (WRONG_TARGET)
  F003: FOUND M04 (AMBIGUOUS)
external requests: 0
run saved: /home/hatch/workspace/p022-locatorstress/runs/demo.json
hashes: scenario=50bb45db… oracle=3a2e6f28… analysis=917addcb… gate=115b30df…
export: npm run export -- --run demo --format json
export: npm run export -- --run demo --format html

$ npm run analyze -- --scenario /tmp/r103-live-scenario.json
live_analyze_exit=0
RUN_SAVED /home/hatch/workspace/p022-locatorstress/runs/P022-CLI-LIVE.json
source custom, baseline STABLE
M01 STABLE, M02 STABLE, M03 MISSING, M04 AMBIGUOUS,
M05 STABLE, M06 STABLE, M07 AMBIGUOUS, M08 STABLE

$ npm run search -- --scenario /tmp/r103-live-scenario.json --max-depth 1
live_search_exit=0
RUN_SAVED /home/hatch/workspace/p022-locatorstress/runs/P022-CLI-LIVE.json
status FOUND, witness { depth: 1, sequence: ["M03"], verdict: "MISSING" }

$ npm run export -- --run P022-CLI-LIVE --format json
live_export_json_exit=0
EXPORTED /home/hatch/workspace/p022-locatorstress/runs/P022-CLI-LIVE.export.json 6526 bytes sha256 fcb0021d… format json run P022-CLI-LIVE (page-level run P022-CLI-LIVE)

$ npm run export -- --run P022-CLI-LIVE --format html
live_export_html_exit=0
EXPORTED /home/hatch/workspace/p022-locatorstress/runs/P022-CLI-LIVE.export.html 24171 bytes sha256 b2418e66… format html run P022-CLI-LIVE (page-level run P022-CLI-LIVE)

$ npm run export -- --run demo --format json
live_demo_export_json_exit=0
EXPORTED /home/hatch/workspace/p022-locatorstress/runs/demo.export.json 22377 bytes sha256 a3df9a21… format json run demo (full report demo)

$ npm run export -- --run demo --format html
live_demo_export_html_exit=0
EXPORTED /home/hatch/workspace/p022-locatorstress/runs/demo.export.html 71708 bytes sha256 15ad7d09… format html run demo (full report demo)

$ npm run dev -- --port 0
UI_URL=http://127.0.0.1:36481
API_URL=http://127.0.0.1:42641
LocatorStress UI listening on http://127.0.0.1:36481 (API proxied at /api, backend http://127.0.0.1:42641)
ui_page_status=200 bytes=13612
<title>LocatorStress — 定位器压力台</title>
api_health_status=200  {"status":"ok", … "seed":"P022-LOCATORSTRESS-S0-2026-11-10", …}
fixtures_listed= 24
```

Error paths (same session, direct `node dist/cli/index.js`):

```
analyze --scenario <missing file>        exit 1  ERROR SCENARIO_NOT_FOUND
analyze --scenario <ambiguous target>    exit 1  ERROR CUSTOM_TARGET_AMBIGUOUS (matched 2 elements)
analyze --scenario <missing target>      exit 1  ERROR CUSTOM_TARGET_NOT_FOUND (matched 0 elements)
analyze --scenario <bad schema>          exit 1  ERROR INVALID_SCENARIO
analyze --scenario <script HTML>         exit 1  ERROR INVALID_SCENARIO
analyze --scenario X --fixture F001     exit 2  ERROR CLI_USAGE (exactly one of --scenario or --fixture)
search --fixture F002 --max-depth 7      exit 2  ERROR CLI_USAGE (--max-depth must be an integer in 0..6)
export --run nope-no-such --format json  exit 1  ERROR UNKNOWN_RUN (available runs: …, t008)
export --run t008 --format xml          exit 2  ERROR CLI_USAGE (--format must be "json" or "html")
```

### Dev shutdown note (npm-wrapper semantics, not a CLI defect)

Killing the `npm run dev` wrapper process with SIGTERM does **not** kill
its `node` child (standard npm behaviour) — the dev server kept serving
until SIGTERM was sent to the `node dist/cli/index.js dev` process itself,
which then shut down cleanly (URL 000, no stray processes). The CLI's own
SIGTERM handling is proven by the test suite (direct spawn + SIGTERM →
exit 0). Anyone stopping a dev server started via npm should kill the
node process (or use Ctrl-C in the foreground terminal, which reaches it).

## Evidence hygiene

- `evidence/s0/S0_P2A.log` restored from git after the gate run (sha256
  after restore `2a76dec117c42ee2e5bfcf44b452407222658b3665c39dc47f0e21c957e06a5d`,
  same as before the gate). `git status evidence/` is clean.
- Test-run byproducts restored from git after the full suite:
  `evidence/s3/screenshots/matrix-F002.png`,
  `evidence/s4/T012_CUSTOM_E2E_REQUESTS.json`,
  `evidence/s4/T012_E2E_REQUESTS.json`, `evidence/s4/T012_PERF.json`.
- No EPERM write failures hit during this session (all run-store writes
  verified by size + sha after writing; the retry loop was never triggered).
- No Chromium failure hit during this session (probe OK before the work;
  no gate/test run died inside Chromium).
- `runs/` is intentionally left populated by the final live demo
  (`demo.json`, `demo.export.json/html`, `P022-CLI-LIVE.json`,
  `P022-CLI-LIVE.export.json/html`) so the coordinator/R2 can re-export
  immediately without re-running analysis. It is gitignored; the test
  suite still cleans up after itself (its own runs leave `runs/` empty).
- Pre-existing untracked items left untouched: `coverage/` and
  `handoff/P022-FINAL-R1/` (both present before this session started).
- One test-cleanup bug found and fixed during this session: the CLI test
  suite's cleanup list initially omitted `F001` (created by the
  `--mutations` test); re-running `test:cli` after the fix leaves `runs/`
  empty (30/30 still green).

## Open points for the coordinator

1. **Nothing blocking.** All five §7.3 commands are implemented, tested
   (30 new tests) and live-demonstrated; the full suite is 590/590 and
   the S0 gate hash is unchanged.
2. **For FIX-R1-04 (re-freeze):** new files to include are the 13 files
   under `src/cli/` (incl. `node-shims.d.ts`), `tests/cli/cli.test.ts`,
   the 6 new npm scripts in `package.json`, and the `runs/` `.gitignore`
   entry; the one modified existing file is `src/ui/server.ts` (import
   guard only). `verify:review-pack` (34 problems) cannot pass until the
   pack is regenerated — by design.
3. **For R2 review:** two judgement calls to surface —
   (a) export is two-tier by design (full reports via
   `exportReportHtml()`/`exportReportJson()`, byte-identical to the API;
   page-level runs via `exportPageReportHtml()`, the only honest HTML path
   for custom runs, since a custom run cannot be a full `AnalysisReport`);
   (b) the demo report is honestly `FAIL / DEMO_SUBSET` (3-fixture subset,
   not the 192-case gate) — its gate field is its own, never the frozen
   S0 gate.
4. **Not done (out of scope):** the 23 P2s; `test:mutation` re-run (runner
   targets frozen modules this fix does not touch); any spec change (no
   requirement was removed or weakened — all five commands exist as
   specified).
