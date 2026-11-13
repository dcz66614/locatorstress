# FIX-R1-01 — Custom synthetic HTML / Locator wired into analyze + BFS

- Task: P022-R1-P1-01 — "Custom synthetic HTML / Locator not wired into actual analysis and BFS."
- Work dir: `~/workspace/p022-locatorstress/` (git local, no remote). HEAD at start: `2102506`.
- Status: **DONE, not committed** (coordinator commits). No push, no commit by this session.
- Date: 2026-11-11 (work ~12:51–13:45 GMT).

## What was built

A user-supplied `locatorstress.scenario/v1` scenario (spec §11.2) **plus a private
target descriptor** can now be sent to `POST /api/analyze` and `POST /api/search`
instead of a `fixtureId`, and runs through the real pipeline: Playwright +
M01–M08 + Node-side identity Oracle + bounded BFS. The Web UI has a
"自定义输入" mode that edits HTML + LocatorSpec + target, validates it, and runs
analyze/search on the user's own input.

### The target descriptor (Oracle privacy)

- New contract `src/contracts/custom-scenario.ts`: `target: { css, framePath?, shadowHost? }`
  (framePath/shadowHost mutually exclusive, mirroring fixture capture modes).
- New `src/oracle/custom-target.ts`: resolves the descriptor to exactly one
  `ElementHandle` via a Playwright Locator used **only** to obtain the handle.
  The descriptor is never written into the DOM, never returned by the API, never
  passed to the locator under test. Identity is established afterwards by the
  existing `oracle/identity-compare.ts` (DOM node identity in page context).
- No target-identifying attribute/class/id is added anywhere. M03's class token is
  derived from the target's own first class token at preflight (empty when the
  target has no class → M03 is an honest no-op for that scenario).
- Fail closed: target matches 0 → HTTP 422 `CUSTOM_TARGET_NOT_FOUND`; matches
  >1 → HTTP 422 `CUSTOM_TARGET_AMBIGUOUS`; never a silent fall back to a fixture
  locator. A scenario without a target → 400; both `fixtureId`+`scenario` → 400;
  neither → 400.

### Safety bounds (spec §13)

- HTML size ≤ 128 KiB (`MAX_CUSTOM_HTML_BYTES`); DOM ≤ 2000 elements after
  `setContent` (run-time preflight → 422 `CUSTOM_HTML_TOO_LARGE`).
- Fail-closed denylist on the raw HTML (also scans `srcdoc` payloads):
  `<script>`, `<link>`, `<base>`, `<object>`, `<embed>`, refresh `<meta>`,
  `<iframe src=>` (srcdoc only), any `src/href/action/poster/cite/data` with an
  absolute or protocol-relative URL, `javascript:`, `url(`, `@import`, inline
  `on*=` handlers. All → 400 via the same validation as `/api/validate`.
- The service page already aborts every non-loopback request (route handler in
  `runner/browser.ts`); custom HTML cannot exfiltrate even if a check missed.
- BFS stays inside the frozen caps (depth ≤ 6, states ≤ 4096); scenario `bfs`
  defaults apply, request-level bounds override them.

### API

- `POST /api/analyze { scenario, mutationIds? }` → `FixtureAnalysis` with
  `source: "custom"`, `scenarioId`, `fixtureId` = scenario_id (or `"custom"`),
  `controlGroup: "custom"` on every case, `expectedVerdict: null`,
  `matchesGolden: null` (no golden matrix exists for user input).
- `POST /api/search { scenario, maxDepth?, maxExpandedStates? }` → `WitnessSummary`
  with `fixtureId` = scenario_id.
- `POST /api/validate { scenario }` now also enforces the HTML safety denylist
  and validates a present `target`; a scenario without a target is still
  shape-valid there (frozen behaviour — existing tests require it), but
  analyze/search require it.
- `POST /ui/dom-snapshot { scenario, sequence }` produces the mutated-DOM diff
  for custom input (same frozen mutations + Oracle target capture).
- `/ui/scores` accepts custom cases (controlGroup `"custom"` is omitted before
  the frozen T005 scorer, which rejects unknown groups; control metrics are
  never computed for custom runs since they have no expected verdicts).

### Web UI

- Locator edit page: new "内置 fixture / 自定义输入" mode switch + custom fields
  (scenario_id, synthetic HTML, target.css, target framePath, target shadowHost),
  "校验自定义场景" button, custom match preview (edited locator vs private target,
  same-element check only).
- "运行分析" and "运行 BFS" send the custom scenario in custom mode; matrix,
  witness steps (DOM diff via `/ui/dom-snapshot`), report scores and JSON download
  (`<scenario_id>-analysis.json`, `source: "custom"`) all work for custom runs.
- Removed/corrected the frozen-locator text: the Fixture Lab hint and the Locator
  edit hint no longer say analysis always uses the frozen fixture locator; both
  now say fixture mode uses the frozen locator and custom mode uses the user's input.

### Design note (bug found during the smoke test)

`normalizeLocatorSpec()` adds `exact`/`includeHidden` keys, which the frozen
resolver validator rejects for css/xpath specs (and the frozen validate-http test
requires that rejection). The first smoke run returned verdict `null` for every
custom case for this reason. Fix: `normalizeCustomScenario()` keeps the locator
**exactly as supplied** (already validated); the normaliser is never applied to
a run-path locator. Documented in the code.

## Files changed (git diff --stat: 10 files, +655/−96; plus 2 new src files, 4 new test files)

| File | Change |
|---|---|
| `src/contracts/custom-scenario.ts` (NEW) | Scenario + target contract, safety denylist, size bounds, shape/run validators, normaliser |
| `src/oracle/custom-target.ts` (NEW) | Private target locator builder + exactly-one capture (`CustomTargetError`), M03 class-token reader |
| `src/api/service.ts` | `AnalyzeRequest`/`SearchRequest` accept `scenario`; `resolveRunInput`, `prepareCustomRun` (preflight: node-count + target capture + M03 token), `evaluateCustomSequence`, `analysedCustomCase`; fixture path untouched |
| `src/api/routes.ts` | analyze/search forward `scenario`; P2-2 rejection message updated |
| `src/search/browser-evaluator.ts` | Added `createBrowserEvaluatorForCustom` (own body mirroring the fixture evaluator; the fixture function is byte-unchanged) |
| `src/search/index.ts`, `src/api/index.ts` | Export new symbols |
| `src/ui/snapshot.ts` | Added `snapshotCustom` |
| `src/ui/server.ts` | `/ui/dom-snapshot` accepts `scenario`; `/ui/scores` omits non-frozen controlGroup |
| `src/ui/index.html` | Custom-mode fields; frozen-locator text corrected |
| `src/ui/app.js` | Custom mode state, scenario builder, validate/preview/run/search/download all mode-aware |
| `package.json` | Added `test:custom`, `test:e2e:custom` scripts (no other script changed) |
| `tests/contracts/custom-scenario.test.ts` (NEW, 14 tests) | Pure validation: target shape, HTML denylist, oversize, shape/run split, normaliser defaults + raw-locator rule |
| `tests/api/custom-input-browser.test.ts` (NEW, 14 tests) | Real-browser service tests (see below) |
| `tests/api/custom-routes.test.ts` (NEW, 4 tests) | Route forwarding + P2-2 rejection with a scenario |
| `tests/e2e/custom-input.test.ts` (NEW, 6 tests) | Real-Chromium UI tests (see below) |
| `evidence/s4/T012_CUSTOM_E2E_REQUESTS.json` (NEW, untracked) | Request log from the custom E2E run (0 external) |

NOT touched: `src/cli` (does not exist — FIX-R1-03), `/api/export` HTML handling
(FIX-R1-02), frozen modules (`runner/`, `mutations/`, `canonical/`, `fixtures/`,
`score/`, `oracle/identity-compare.ts`, `oracle/target-capture.ts`), S0 gate
scripts, `src/contracts/locator.ts` validator semantics.

## Test coverage of the required cases (all with CUSTOM input)

Shared custom page (CSS/XPath/role tests): two buttons, Save `button.primary`
(target `main > form > button:nth-child(1)`), Cancel secondary.

- **CSS**: baseline STABLE; M01/M02/M05/M06/M08 STABLE; **M03 MISSING** (class
  token changed); **M04 AMBIGUOUS, M07 AMBIGUOUS** (decoy copies class).
- **XPath** (`//button[@class='primary']`): baseline STABLE; M03 MISSING, M04 AMBIGUOUS.
- **Role** (`button`, name `Save`): baseline STABLE; **M08 MISSING** (text changed),
  M04 AMBIGUOUS.
- **WRONG_TARGET**: single-button page, locator `button` + `index: 0` → baseline
  STABLE, **M04 WRONG_TARGET** (decoy steals `nth(0)`, `identityMatch: false`,
  `matchCount: 1`).
- **MISSING**: CSS M03, role M08, and a no-match locator baseline (`button.gone` →
  baseline MISSING, `matchCount: 0`).
- **AMBIGUOUS**: CSS/XPath/role M04, CSS M07.
- **Shortest witness (BFS)**: CSS scenario, `maxDepth: 1` → `FOUND`, witness
  `{ sequence: ["M03"], depth: 1, verdict: "MISSING" }`, `statesEvaluated: 4`,
  `incompleteStates: 0`. A robust locator (`button[type=submit]`, single button)
  → `BOUNDED_NO_WITNESS`, `statesEvaluated: 9`.
- **Fail-closed**: ambiguous target (`button` on a 2-button page) → 422
  `CUSTOM_TARGET_AMBIGUOUS`; missing target → 422 `CUSTOM_TARGET_NOT_FOUND`;
  `<script>` / external-URL / oversized HTML / missing target / bad schema →
  400; both/neither input → 400. UI shows `CUSTOM_TARGET_AMBIGUOUS` in
  `#run-status` and the server stays alive (health 200 afterwards).
- **UI report**: custom CSS run scores 62.5 (5/8 STABLE); download
  `P022-CUSTOM-001-analysis.json` with `source: "custom"`, baseline STABLE,
  witness `["M03"]`, matching the backend field by field.

## Full regression (all run by this session, sequentially, no concurrency with the gate)

| Command | Result (exit) |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run typecheck:scripts` | exit 0 |
| `npm run build` | exit 0 |
| `npm run test:custom` | 32/32 passed (14 contract + 14 browser + 4 routes) |
| `npm run test:e2e:custom` | 6/6 passed |
| `npm test` | **549/549 passed, 43 files** (511 baseline + 38 new) — 289 s |
| `npm run test:e2e` | 7/7 passed |
| `npm run test:offline` | 6/6 passed |
| `npm run test:performance` | 4/4 passed (150 s) |
| `npm run test:stress` | 6/6 passed |
| `npm run test:coverage` | exit 0 (same 549-test suite; coverage table in run log) |
| `npm run test:mutation` | **40/40 killed = 100.0%** (threshold 90%), 0 survived |
| `npm run test:oracle` | 3/3 passed (2 files) |
| `npm run s0:gate` | **GATE PASS, gate_sha256 = 651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52 — EXACT match**; 100/100 replays, 1 unique hash; all four hashes match frozen values (scenario `1ffb5f85…`, oracle `3502d81…`, analysis `4410d5c…`, gate `651c3fd4…`). `evidence/s0/S0_P2A.log` restored with `git checkout` after the run. |
| `npm run verify:all` | **PASSED — all 9 steps green** (434.5 s) |
| `npm run verify:review-pack` | **exit 1 — 18 problems, ALL attributable to this fix** (see below) |

### verify:review-pack — expected failure, change surface is exactly the fix

The frozen S5 review pack predates FIX-R1-01, so any source change trips it. The
18 problems are precisely the 10 changed files, nothing else:

- 2 files missing from `COVERAGE_MATRIX.csv`: the 2 NEW files
  (`src/contracts/custom-scenario.ts`, `src/oracle/custom-target.ts`).
- 8 sha256 mismatches in `COVERAGE_MATRIX.csv` + 8 in `sha256.txt`: the 8
  modified files (`src/api/index.ts`, `src/api/routes.ts`, `src/api/service.ts`,
  `src/search/browser-evaluator.ts`, `src/search/index.ts`, `src/ui/index.html`,
  `src/ui/server.ts`, `src/ui/snapshot.ts`).
- `src/ui/app.js` and `package.json` are accepted as known FIX deltas by the
  script itself. No frozen module, fixture, golden file or hash mismatched.
- Resolution belongs to FIX-R1-04 (re-freeze regenerates the review pack); the
  script cannot pass before that by design.

### Notes on two misleading exit codes observed

- The `s0:gate` exec wrapper reported exit 1 although the gate printed
  `GATE PASS … GATE_EXIT=0`: the failure was my own trailing `grep -o` for the
  gate hash (pattern did not match the JSON layout). The gate result itself was
  re-verified with Python from `evidence/s0/S0_GATE.json` (`result: PASS`, all
  four hashes as above).
- The first `verify:review-pack` invocation reported `VERIFY_RP_EXIT=0` because
  `$?` was read after a `| tail` pipeline; the script's real exit code (no pipe)
  is 1, as reported above.

## Live end-to-end demonstration (real server, curl)

Server: `node dist/ui/server.js --port 0` (loopback; demo URL
`http://127.0.0.1:33503`, since closed). Custom scenario `P022-CUSTOM-DEMO`
(two-button page, `button.primary`, target
`main > form > button:nth-child(1)`):

- `POST /api/analyze {scenario}` → **HTTP 200**, `source: "custom"`,
  baseline STABLE (`matchCount: 1, identityMatch: true`), cases:
  M01 STABLE, M02 STABLE, **M03 MISSING** (match 0), **M04 AMBIGUOUS** (match 2),
  M05 STABLE, M06 STABLE, **M07 AMBIGUOUS** (match 2), M08 STABLE;
  all `expectedVerdict: null, matchesGolden: null`.
- `POST /api/search {scenario, maxDepth: 1}` → **HTTP 200**, `status: "FOUND"`,
  witness `{sequence: ["M03"], depth: 1, verdict: "MISSING"}`,
  `statesEvaluated: 4`, `incompleteStates: 0`.
- `POST /api/analyze {fixtureId: "F001"}` sanity → **HTTP 200**, baseline STABLE,
  all 8 cases STABLE.
- Error paths (same server, earlier smoke run): ambiguous target → 422
  `CUSTOM_TARGET_AMBIGUOUS`; missing target → 422 `CUSTOM_TARGET_NOT_FOUND`;
  script HTML → 400; no target → 400; both inputs → 400; neither → 400;
  `/api/validate {scenario}` → 200 `{valid: true, errors: []}`.

## Open points / follow-ups for the coordinator

1. **Re-freeze (FIX-R1-04)** must regenerate the review pack
   (`COVERAGE_MATRIX.csv`, `sha256.txt`) — `verify:review-pack` cannot pass
   until then, by design (18 problems = exactly this fix's files).
2. The S0 gate hash is unchanged, so no per-field hash explanation is needed.
3. `coverage/` (untracked, pre-existing) was left untouched. Test-run byproducts
   (`evidence/s3/screenshots/matrix-F002.png`, `evidence/s4/T012_E2E_REQUESTS.json`,
   `evidence/s4/T012_PERF.json`, `evidence/s4/T011_MUTATION_RESULTS.json`) were
   restored or are regenerated deterministically by the suites; only the new
   `evidence/s4/T012_CUSTOM_E2E_REQUESTS.json` is an intentional new artifact.
4. No EPERM write failures were observed during this session's writes (all files
   verified by size + sha after writing); no file needed restoring from git
   except the routine post-gate `S0_P2A.log` restore.
5. Model route used: Muse self-review only (no WorkBuddy/Qoder/Copilot calls
   were needed — all work was done directly in this session).
