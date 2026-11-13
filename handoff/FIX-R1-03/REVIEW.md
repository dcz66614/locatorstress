# FIX-R1-03 Independent Review — Five CLI commands (P022-R1-P1-03)

- Reviewer: fresh-session independent reviewer (not the builder, not the coordinator)
- Date: 2026-11-11 (work ~17:24–18:05 GMT; one VM/runtime restart interrupted the first `s0:gate` attempt, see §8)
- Work dir: `~/workspace/p022-locatorstress/`, HEAD `c162579`; FIX-R1-03 changes UNCOMMITTED in the working tree
- Read first: `~/workspace/P022_R1_VERDICT.md` (§五 FIX-R1-03), `~/workspace/p022-R1-verification-2026-11-11.md`, `handoff/FIX-R1-03/REPORT.md`, `~/workspace/P022_PROJECT_BOOK.md` §7.3 + §8, `~/workspace/P022_IMPLEMENTATION_PLAN.md` (cli/index.ts + cli/commands/)
- Method: read all 13 new `src/cli/` files + `tests/cli/cli.test.ts` in full, then re-ran every command live myself (own scenario id `P022-CLI-REVIEW`, not the builder's files). Nothing below is taken from the builder's or coordinator's claims on trust.

## FINAL_VERDICT: PASS

- **P0: 0 · P1: 0 · P2: 2** (both non-blocking; details §6–§7)
- P022-R1-P1-03 is CLOSED: all five §7.3 CLI commands exist as npm scripts and work end to end via `npm run`, with the spec's error behaviour, honest demo labelling, unchanged UI-server behaviour, full regression green, and the S0 gate hash exactly unchanged.
- The coordinator may commit on this verdict (P0 0 / P1 0).

## 1. The five commands (all re-run live by the reviewer)

All via `npm run` (which rebuilds first). Direct `node dist/cli/index.js …` was used only for the error-path battery (same entry point, no npm banner in stdout).

### 1.1 `dev` — PASS

- Python-spawned `node dist/cli/index.js dev --port 0`: printed `UI_URL=http://127.0.0.1:38829`, `/` → **200** (13,612 B, `<title>LocatorStress — 定位器压力台</title>`), `/api/health` → **200** `{"status":"ok", … "seed":"P022-LOCATORSTRESS-S0-2026-11-10", …}`, SIGTERM → **exit 0**, stderr empty, no stray process.
- An earlier shell-backgrounded attempt returned 143 only because the exec wrapper's `$!` did not point at the node process (the process stayed alive and listening on both ports; a direct `kill -TERM <pid>` then shut it down). The Python-spawned test is authoritative and matches the suite's dev test. Not a product issue.
- Note (documented by the builder, confirmed as standard npm behaviour, not a defect): killing the `npm run dev` wrapper does not kill its node child; stop the node process itself (or Ctrl-C in the foreground terminal).

### 1.2 `demo` — PASS (deterministic, offline, honestly labelled)

- Run 1: exit 0. Run 2: exit 0, **stdout byte-identical** (`cmp` clean), **`runs/demo.json` byte-identical**, sha256 `e33d8d4c20486b0a8329280588d082812735247951525fef8eac0058a1323b29` — identical to the sha the builder's/coordinator's demo file had before my `test:cli` run deleted it (see §6).
- Live output (both runs): `baseline: 3/3 STABLE`, `cases: 24 (expected 24, completed 24)`, `verdicts: STABLE 18 / WRONG_TARGET 5 / AMBIGUOUS 1 / MISSING 0`, `score: 75 (18/24 stable of completed)`, `F001: BOUNDED_NO_WITNESS`, `F002: FOUND M01 (WRONG_TARGET)`, `F003: FOUND M04 (AMBIGUOUS)`, `external requests: 0`.
- Demo hashes: scenario `50bb45db…`, oracle `3a2e6f28…`, analysis `917addcb…`, gate `115b30df…` — match the builder's claims; gate hash differs from the frozen S0 gate, as it must.
- Honesty labelling (item 3, verified in `runs/demo.json`): the report's `canonical.gate.result` is `"FAIL"` and `canonical.gate.failureType` is `"DEMO_SUBSET"` (`src/cli/commands/demo.ts:199-206` computes them; `src/analysis/witness.ts:499-505,559` folds them into `report.canonical.gate`); `notes[4]` states in plain language that this is a 3-of-24-fixture demo subset, NOT the 192-case gate, and to run `npm run s0:gate` for the frozen gate; `expectedCases` is 24, not 192. The gate field cannot be mistaken for the frozen S0 gate (different hash, different counts, explicit note). One wording nit, not a finding: REPORT.md says the report "carries gateResult: FAIL / gateFailureType: DEMO_SUBSET" — in the stored report these live under `report.canonical.gate`, not as top-level fields. Substance verified true.
- Minor observation, not a finding: `canonical.gate.notes` still carries the frozen T008 boilerplate "BFS witness: NOT_IMPLEMENTED_S0 (T007, S2); placeholder in analysis hash" although the demo does include real BFS witnesses — the same text is verbatim in `evidence/s2/T008_API_REPORT.json`, i.e. frozen `buildAnalysisReport()` boilerplate, and the demo's own `notes[5]` gives the real BFS samples. Not a CLI defect.

### 1.3 `analyze` — PASS

- Custom scenario `P022-CLI-REVIEW` (two-button page, `button.primary`, target `main > form > button:nth-child(1)`, my own file): exit 0, `RUN_SAVED runs/P022-CLI-REVIEW.json`, baseline **STABLE** (match 1, identity true), **M01 STABLE, M02 STABLE, M03 MISSING, M04 AMBIGUOUS, M05 STABLE, M06 STABLE, M07 AMBIGUOUS, M08 STABLE** — exactly the builder's claimed verdicts.
- `--fixture F002 --mutations M03`: exit 0, exactly 1 case, M03 STABLE (subset flag works, deduped/validated per `src/cli/commands/input.ts:74-93`).

### 1.4 `search` — PASS

- Custom scenario, `--max-depth 1`: exit 0, status **FOUND**, witness `{ depth: 1, sequence: ["M03"], verdict: "MISSING" }`, `statesEvaluated: 4` — exactly the builder's claim.
- `--fixture F002 --max-depth 1`: exit 0, status **FOUND**, witness `{ depth: 1, sequence: ["M01"], verdict: "WRONG_TARGET" }`.
- Witness merged into the stored run (`runs/P022-CLI-REVIEW.json` kept its analysis after search; `src/cli/commands/search.ts:77-91`).

### 1.5 `export` — PASS

| Run / format | Exit | Result (reviewer-observed) |
|---|---|---|
| `t008` json | 0 | 94,248 B, **byte-identical to `evidence/s2/T008_API_REPORT.json`** (`cmp` clean) |
| `t008` html | 0 | 308,103 B / 308,017 chars, **byte-identical to the API export** (`POST /api/export` via `handleApiRequest` in-process, status 200, `api.rawBody === cliHtml`); embedded JSON == report; 0 external resources |
| `demo` json | 0 | 22,377 B, sha `a3df9a21…`, **== stored report** in `runs/demo.json` |
| `demo` html | 0 | 71,708 B, sha `15ad7d09…`, embeds exactly the stored report; 0 external resources |
| `P022-CLI-REVIEW` json | 0 | 6,552 B, page-level payload `locatorstress.ui-fixture-export/v1`, score `62.5`, witness `FOUND` |
| `P022-CLI-REVIEW` html | 0 | 24,245 B, **embedded JSON == the JSON export** (`parseEmbeddedReportJson` equality), contains MISSING + AMBIGUOUS, 0 external resources |
| `F003` witness-only json | 0 | 416 B, witness JSON |
| `F003` witness-only html | 1 | `ERROR EXPORT_HTML_REQUIRES_ANALYSIS` — fails closed, as designed |

- The two-tier design is honest and justified: full reports (`t008`, `demo`) go through the exact `exportReportJson`/`exportReportHtml` functions `POST /api/export` calls (byte-identical, proven above); a custom run cannot be a full `AnalysisReport` (`ReportCase` requires controlGroup stable|fragile + non-null expectedVerdict), so the page-level export (`exportPageReportHtml`, FIX-R1-02's UI renderer) is the only honest HTML path — the same conclusion FIX-R1-02 reached and its reviewer accepted. No requirement was removed: §7.3 lists `export --run <id> --format json|html`, which exists and works for every run kind; `--fixture` (analyze/search) is an addition beyond the spec table's `--scenario`-only form, documented in REPORT.md, and removes nothing.

## 2. Error paths — PASS (25 cases run; one P2, §7)

All via direct `node dist/cli/index.js …`. No crash, no silent wrong output in any case.

| Case | Exit | Code (stderr) |
|---|---|---|
| analyze, missing scenario file | 1 | `SCENARIO_NOT_FOUND` |
| analyze, unparsable JSON | 1 | `INVALID_SCENARIO_JSON` |
| analyze, bad schema (empty css selector) | 1 | `INVALID_SCENARIO` |
| analyze, `<script>` HTML | 1 | `INVALID_SCENARIO` ("script elements are not allowed") |
| analyze, target matches 0 | 1 | `CUSTOM_TARGET_NOT_FOUND` ("matched 0 elements") |
| analyze, target matches 2 (`button.primary` as target) | 1 | `CUSTOM_TARGET_AMBIGUOUS` ("matched 2 elements") |
| analyze, ambiguous *locator* (target unique) | 0 | Correctly NOT an error: baseline AMBIGUOUS, matchCount 2, M03 WRONG_TARGET — verdicts, not a failure |
| analyze, both `--scenario` + `--fixture` | 2 | `CLI_USAGE` |
| analyze, neither input | 2 | `CLI_USAGE` |
| analyze, unknown flag `--bogus` | 2 | `CLI_USAGE` |
| analyze, `--mutations M09` | 2 | `CLI_USAGE` |
| search, `--max-depth 7` | 2 | `CLI_USAGE` ("must be an integer in 0..6") |
| search, `--max-depth abc` | 2 | `CLI_USAGE` |
| search, `--max-expanded-states 0` | 2 | `CLI_USAGE` ("must be an integer in 1..4096") |
| analyze, `--fixture F099` / `F000` | 1 | `INVALID_FIXTURE` |
| export, unknown run `nope-no-such` | 1 | `UNKNOWN_RUN` (lists available runs incl. `t008`) |
| export, `--format xml` | 2 | `CLI_USAGE` |
| export, missing `--format` | 2 | `CLI_USAGE` |
| export, `--run a/b` | 1 | `INVALID_RUN_ID` — see P2-1 (§7): fail-closed, no traversal, wrong exit code |
| export, `--run ../x` | 1 | `INVALID_RUN_ID` — same |
| export, `--out` + `--stdout` together | 2 | `CLI_USAGE` |
| no args | 2 | `CLI_USAGE` + usage text |
| unknown command `frobnicate` | 2 | `CLI_USAGE` |
| `--help` / `analyze --help` | 0 | usage text |

Usage errors exit 2, work failures exit 1, throughout — except P2-1.

## 3. `src/ui/server.ts` import guard — PASS (item 4)

- The only change to a pre-existing source file: `src/ui/server.ts` — `void main()` now runs only when the module is the entry point (`resolve(process.argv[1]) === fileURLToPath(import.meta.url)`), 12 insertions / 1 deletion. No route, UI, or product logic touched.
- `npm run test:ui` → **12/12, exit 0**; `npm run test:e2e:custom` → **6/6, exit 0**; `npm run test:offline` → **6/6, exit 0** (all re-run by me, sequentially).
- Standalone entry point re-checked by me: `node dist/ui/server.js --port 0` serves `/` 200 and `/api/health` 200 `ok`, SIGTERM → exit 0, stderr empty. The guard preserves entry-point behaviour.

## 4. Full regression + S0 gate — PASS (item 5)

- `npm run typecheck` exit 0; `npm run build` exit 0.
- `npm run test:cli` exit 0: **30/30** (1 file, ~31 s).
- `npm test` exit 0: **46 files, 590 passed / 590** (baseline 560 + this fix 30; ~321 s).
- `npm run s0:gate` (fresh re-run after the interrupted attempt, §8) exit 0: **GATE PASS**, `REPEAT_HASH runs=100/100 unique_gate_hashes=1`, ~17.9 min. Full log: `~/workspace/r103-s0gate-rerun.log`.

### Four gate hashes observed (my fresh gate run, `evidence/s0/S0_GATE.json`)

| Hash | Observed | Frozen / R1-verdict value | Match |
|---|---|---|---|
| scenario_sha256 | `1ffb5f85561c6dd9f10fc15773097691c5c07fe20c6e9a001e231a41b61c9f22` | same | ✅ |
| oracle_result_sha256 | `3502d81fa730605ddd8548e39af6b7272015c026e65f91a2dae132c3e345a988` | same | ✅ |
| analysis_sha256 | `4410d5c85cf5fe8ee858c4e01822cdbc1515c39afa7ba40d833aceb00a9576a4` | same | ✅ |
| gate_sha256 | **`651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52`** | same (required value, exact) | ✅ |

- `evidence/s0/S0_GATE.json` sha256 after the gate: `15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d` — unchanged from the frozen value (the gate regenerated a byte-identical file).
- `evidence/s0/S0_P2A.log` restored from git after my runs: sha256 `2a76dec117c42ee2e5bfcf44b452407222658b3665c39dc47f0e21c957e06a5d`, same as before. Test-run byproducts (`evidence/s3/screenshots/matrix-F002.png`, `evidence/s4/T012_CUSTOM_E2E_REQUESTS.json`, `evidence/s4/T012_E2E_REQUESTS.json`, `evidence/s4/T012_PERF.json`) restored from git; `git status evidence/` is clean.
- `node scripts/verify-review-pack.mjs` exit 1 with **34 problems** — exactly as the builder stated, and all on the R1-fix surface (16 files missing from `COVERAGE_MATRIX.csv`: 13 CLI files + `custom-scenario.ts` + `custom-target.ts` + `ui-report-html.ts`; 9 sha256 mismatches ×2 lists: the 8 FIX-R1-01 files + `src/ui/server.ts`). The script's "(not a known FIX delta)" suffix only means its known-delta list predates the R1 fixes. This cannot pass until FIX-R1-04 re-freezes the review pack — by design, not a defect of this fix.

## 5. No requirement removed, nothing frozen touched (item 7)

- All six §7.3 npm scripts exist: `dev`, `demo`, `analyze`, `search`, `export`, `s0:gate` (verified in `package.json`).
- `git diff --name-only` (tracked): `.gitignore`, `package.json`, `src/ui/server.ts`, plus the coordinator's own `handoff/R1_COORDINATOR_STATE.md`. Untracked: only `src/cli/`, `tests/cli/`, `handoff/FIX-R1-03/`, `handoff/P022-FINAL-R1/`, `coverage/`.
- Frozen modules (`runner/`, `mutations/`, `canonical/`, `fixtures/`, `score/`, `oracle/identity-compare.ts`, `oracle/target-capture.ts`), S0 gate scripts, golden files, the export HTML renderer, and the API routes: **untouched** — `git diff` over `src/runner src/mutations src/canonical src/fixtures src/score src/oracle scripts evidence` is empty (after restoring test byproducts).
- The CLI computes no verdict, score, or witness itself: every browser-backed command goes through the frozen `AnalysisService` (`src/cli/browser-service.ts`, `launchBaselineBrowser` + `createBrowserAnalysisService`); export reuses the wired exporters; scores in page payloads come from the frozen T005 scorer (`src/cli/page-payload.ts`).
- The coordinator's verification note in `handoff/R1_COORDINATOR_STATE.md` (test:cli 30/30, npm test 590/590, gate PASS, demo hashes matching) is consistent with everything I re-ran myself; I relied on my own runs, not on it.

## 6. Item 6 judgement — test:cli cleanup vs pre-existing `runs/demo.json`

**Finding: P2-2 (non-blocking, §7). The cleanup is acceptable as-is for R1-03, with a cheap hygiene fix recommended.**

What the coordinator observed, reproduced by me first-hand:

1. Before my `test:cli` run, `runs/demo.json` existed (sha `e33d8d4c…`, the coordinator's re-run of the builder's demo).
2. After my `test:cli` run (30/30, exit 0), `runs/demo.json`, `demo.export.json`, and `demo.export.html` were gone — only the builder's `P022-CLI-LIVE.*` files (not in the suite's cleanup list) survived.
3. My immediate `npm run export -- --run demo --format json` then returned exit 1, honest `ERROR UNKNOWN_RUN: unknown run "demo" (available runs: P022-CLI-LIVE, t008)`.
4. Re-running `npm run demo` restored `demo.json` byte-identically (sha `e33d8d4c…` again).

Why this is **not** over-broad enough to block:

- The cleanup is a **fixed 5-id allowlist**, not a directory wipe: `tests/cli/cli.test.ts:96-110`, `CREATED_RUN_IDS = [P022-CLI-TEST-CSS, F001, F002, F003, demo]` plus `t008.export.*`. It deletes only ids the suite itself creates in a full run.
- **No content was actually lost.** The suite's own demo determinism test runs `demo` twice before the afterAll cleanup, overwriting `runs/demo.json` with a deterministic byte-identical file — I proved this twice over: my two demo runs produced identical stdout and identical `runs/demo.json` (sha `e33d8d4c…`, the same sha as the file before deletion). What the cleanup deletes is the suite's own regenerated copy, content-identical to what was there.
- The failure mode is **honest fail-closed**, not silent corruption: `export --run demo` says `UNKNOWN_RUN` and lists what is available; nothing is exported from stale data.
- `runs/` is explicitly gitignored lab state, regenerable in ~6 s (`npm run demo`) or seconds per analyze/search; no evidence, canonical hash, or source is involved.

Why it still earns a P2 rather than no-finding: a test suite should not delete files it did not create in that run. If the demo test were ever skipped or failed before running, the afterAll would still delete a pre-existing `demo.json` whose content the suite never reproduced; and a user's manual `analyze --fixture F002` run can be silently replaced-then-deleted the same way. The fix is cheap — snapshot the 5 ids (bytes or mtimes) in a beforeAll and restore pre-existing files in afterAll, or point the suite at an isolated runs dir — and should be done, but it is hygiene on regenerable lab state, not a product defect, and it does not block P1-03 closure.

## 7. Findings

### P2-1 — Bad run id exits 1, but the builder's own contract documents exit 2

- Evidence: `src/cli/run-store.ts:104-111` — `assertRunId()` throws `runtimeError("INVALID_RUN_ID", …)` (exit 1). But `handoff/FIX-R1-03/REPORT.md` ("Exit-code / error-code summary" and §5) and the `export` header comment `src/cli/commands/export.ts:19-21` both document bad run id as `CLI_USAGE`, exit 2. `INVALID_RUN_ID` appears nowhere in the REPORT's error-code table.
- Observed: `export --run a/b` → exit 1 `ERROR INVALID_RUN_ID`; `export --run ../x` → exit 1 `ERROR INVALID_RUN_ID`.
- Impact: nil on safety — the id is validated against `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` before any path is joined, so there is no traversal and no silent wrong output; the command fails closed with a named code. This is a doc/code mismatch on one exit code only, in a code path the frozen spec §7.3 does not define. Fix (either way, one line): make `assertRunId` throw `usageError`, or correct REPORT.md + the export header to document exit 1 / `INVALID_RUN_ID`. Non-blocking.

### P2-2 — test:cli afterAll deletes pre-existing runs sharing its 5 cleanup ids (item 6)

- Evidence: `tests/cli/cli.test.ts:96-110` (fixed `CREATED_RUN_IDS` allowlist incl. `demo`); reproduced as described in §6.
- Impact: limited to regenerable, gitignored `runs/` lab state; the demo file's content is provably byte-identical when regenerated; the resulting `UNKNOWN_RUN` is honest fail-closed. Recommended fix: snapshot-and-restore pre-existing files for those ids, or isolate the suite's runs dir. Non-blocking.

### P0: none. P1: none.

## 8. Environment notes (not product findings)

- **First `s0:gate` attempt interrupted by a VM/runtime restart** (~5m48s in, no confirmed result). It left `evidence/s0/` mid-run: `S0_GATE.json` and `S0_GATE.log` deleted, `S0_P2A.log` rewritten (sha `4a5a46a5…`). I restored all of `evidence/` from git (retry loop; verified `S0_GATE.json` `15b5c2d5…`, `S0_P2A.log` `2a76dec1…`, `S0_GATE.log` `56de50e1…` — all exactly HEAD), probed Chromium directly (`~/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome --version` → `Google Chrome for Testing 158.0.8127.18`, exit 0; no SIGTRAP/SIGILL), and re-ran the gate cleanly to PASS (§4). Environment, not product; no EPERM write failure was hit in any of my runs.
- **`/tmp` was wiped by that restart**: my early `/tmp/r103-*` logs/scenario files are gone. Every number cited in this review was read from tool output in-session; the gate re-run log survives at `~/workspace/r103-s0gate-rerun.log` and the final demo output at `~/workspace/r103-demo-final.out`.
- The Copilot bridge was not touched (tokenless, per instructions); no WorkBuddy/Qoder route was needed — all work was done by direct execution in this session.

## 9. Commands run by the reviewer (exit codes)

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` | 0 | clean |
| `npm run build` | 0 | clean |
| `npm run test:cli` | 0 | 30/30, ~31 s |
| `npm run export -- --run demo --format json` (demo.json deleted by test:cli) | 1 | honest `UNKNOWN_RUN` |
| `npm run demo` (×2) | 0, 0 | byte-identical stdout + byte-identical `runs/demo.json` (sha `e33d8d4c…`) |
| `npm run analyze -- --scenario /tmp/r103-review-scenario.json` | 0 | baseline STABLE; M03 MISSING, M04/M07 AMBIGUOUS |
| `npm run search -- --scenario … --max-depth 1` | 0 | FOUND [M03] MISSING, statesEvaluated 4 |
| `npm run search -- --fixture F002 --max-depth 1` | 0 | FOUND [M01] WRONG_TARGET |
| `npm run analyze -- --fixture F002 --mutations M03` | 0 | 1 case, M03 STABLE |
| `npm run export -- --run P022-CLI-REVIEW --format json\|html` | 0, 0 | 6,552 B / 24,245 B; embedded JSON == JSON export |
| `npm run export -- --run demo --format json\|html` | 0, 0 | 22,377 B sha `a3df9a21…` / 71,708 B sha `15ad7d09…` |
| `npm run export -- --run t008 --format json` | 0 | 94,248 B, byte-identical to evidence file |
| `npm run export -- --run t008 --format html` | 0 | 308,103 B, byte-identical to API export |
| `npm run search -- --fixture F003 --max-depth 1` | 0 | witness-only run created |
| `npm run export -- --run F003 --format json` | 0 | 416 B |
| `npm run export -- --run F003 --format html` | 1 | `EXPORT_HTML_REQUIRES_ANALYSIS` |
| dev (Python spawn, direct node) + SIGTERM | 0 | `/` 200, `/api/health` 200 ok, clean exit |
| `node dist/ui/server.js --port 0` + SIGTERM | 0 | `/` 200, `/api/health` 200 ok, clean exit |
| Error-path battery (25 cases, §2) | 0/1/2 as listed | all fail closed with named codes |
| `npm run test:ui` | 0 | 12/12 |
| `npm run test:e2e:custom` | 0 | 6/6 |
| `npm run test:offline` | 0 | 6/6 |
| `npm test` | 0 | 46 files, **590/590**, ~321 s |
| `npm run s0:gate` (attempt 1) | — | interrupted by runtime restart, no result |
| `npm run s0:gate` (re-run) | 0 | **GATE PASS**, 100/100 replay, 1 hash, ~17.9 min |
| `node scripts/verify-review-pack.mjs` | 1 | 34 problems, all R1-fix surface (FIX-R1-04's job) |
| `npm run demo` (final, restore `runs/demo.json`) | 0 | sha `e33d8d4c…` restored |

## 10. Live-demo evidence (reviewer's own runs)

- Custom scenario `P022-CLI-REVIEW` (`button.primary`, target `main > form > button:nth-child(1)`): baseline STABLE, M03 MISSING, M04 AMBIGUOUS, M07 AMBIGUOUS, all others STABLE; search depth 1 FOUND [M03] MISSING; page-level export score 62.5 with witness FOUND. Stored run: `runs/P022-CLI-REVIEW.json` (+ `.export.json` / `.export.html`).
- Demo: 24 cases, 18 STABLE / 5 WRONG_TARGET / 1 AMBIGUOUS / 0 MISSING, score 75, 0 external requests; `runs/demo.json` sha `e33d8d4c20486b0a8329280588d082812735247951525fef8eac0058a1323b29` (present in `runs/` at review end, with `demo.export.json` sha `a3df9a21…` and `demo.export.html` sha `15ad7d09…` — identical to the builder's).
- t008: json export byte-identical to `evidence/s2/T008_API_REPORT.json` (94,248 B); html export byte-identical to the API's `POST /api/export` html for the same report (308,017 chars / 308,103 bytes).

## 11. Recommendation to the coordinator

Commit FIX-R1-03 on this PASS. Carry the two P2s as non-blocking follow-ups (either is a one-line / small fix; neither needs a re-review round on its own):

1. P2-1: align the bad-run-id exit code — either `usageError` in `assertRunId` (`src/cli/run-store.ts:104`) or correct REPORT.md + `src/cli/commands/export.ts:19-21` to document exit 1 / `INVALID_RUN_ID`.
2. P2-2: make `tests/cli/cli.test.ts` afterAll snapshot-and-restore pre-existing runs (or isolate the suite's runs dir) so a test run never deletes lab state it did not create.

Then proceed to FIX-R1-04 (re-freeze, which regenerates the review pack and clears the 34 `verify:review-pack` problems) and EVID-R1-01.
