# P022 LocatorStress — Re-freeze #2 (FIX-R1-04b) Independent Review

- Reviewer: fresh-session independent reviewer (subagent, read-only; no commits, no pushes, no source/test/release modifications)
- Date: 2026-11-11 ~21:40–22:20 GMT
- Scope: freeze commit `935a3db788876288aa9bea84105a3c17647568ba` (HEAD, verified), frozen object `d26a3cc76b8e4da6cc92bc2c949101a69b179100`
- Inputs read: `~/workspace/P022_R1_VERDICT.md`, `~/workspace/p022-R1-verification-2026-11-11.md`, `release/R1_FREEZE_REPORT.md` (299 lines), `handoff/FIX-R1-04/REPORT.md` (re-freeze #2 section), `handoff/R1_COORDINATOR_STATE.md`

## FINAL_VERDICT: PASS

- **P0: 0, P1: 0, P2: 2** (both new P2s are non-blocking documentation/hygiene items found by this review; see §7)
- The 23 R1 P2s and the 3 prior review P2s remain carried as documented in the freeze report; none was re-opened, none blocks R2.
- The re-freeze is ready for R2. Every builder/coordinator claim I was asked to check reproduced exactly, except the two P2 notes below.

## 1. Release artifacts — recomputed from disk (all MATCH)

| file | bytes (expected → observed) | SHA-256 (recomputed) |
| --- | --- | --- |
| `release/source.zip` | 6,996,297 → 6,996,297 | `ebd66c019826d8fa9c1b94b502c98ae0e31770f0f682bb66ad1c84292a035a74` ✓ |
| `release/dist.zip` | 349,982 → 349,982 | `50a9d20609d2dc4b2027339077c93e64047f8757ef23e5f01cbb7e178ccd2057` ✓ |
| `release/RELEASE_MANIFEST.json` | 3,941 → 3,941 | `8924e10284a56f616627c797498781a5faefa9727a1ec8dd2b0dd20850a57a1d` ✓ |
| `release/SHA256SUMS.txt` | 240 → 240 | `e44d7f629bf07320ea9d27e528424186657382a805c02045bb6bfb5cc29b74b6` ✓ |
| `release/P022-R1-FREEZE.bundle` | 7,044,453 → 7,044,453 | `bab36e27c6862b890ea3c5a39ddf9e7035aabe1e3347a117ef9d0df3b39b41d2` ✓ |

- Manifest `frozen_commit` = `d26a3cc76b8e4da6cc92bc2c949101a69b179100` ✓, `spec_version` 1.0.0, license `PENDING_SAM_DECISION`.
- `SHA256SUMS.txt` lists exactly 3 artifacts (source.zip, dist.zip, RELEASE_MANIFEST.json), no self-reference ✓.
- Freeze report on disk: 299 lines, SHA-256 `c687002c4afe975bdd19e462a7c04642be999a6d6acb4a19e5018fc7c4ffc9fa`, identical to the committed copy (`git show HEAD:release/R1_FREEZE_REPORT.md`) ✓.
- `dist.zip` is byte-identical to freeze #1 (`50a9d206…`, 349,982 B) as claimed ✓ — no source change since `23a5a91`.

## 2. source.zip == git archive of d26a3cc

- `npm run release:compare-source` — exit 0: `release:compare-source PASSED: source.zip files 284, git archive files 284, git ls-tree files 284; compared 284 files, 284 byte-identical, 0 path differences, 0 byte differences` ✓
- Independent check: `git ls-tree -r --name-only d26a3cc | wc -l` = 284; zip holds 284 files + 54 directory entries ✓.

### The 2.75 MB → 7.0 MB growth — explanation confirmed, judged acceptable for R2 (with P2-RVW-01)

- The frozen tree `d26a3cc` contains freeze #1's own artifacts as tracked files. Zip listing of `release/source.zip` confirms the nested entries: `release/source.zip` 2,754,449 B, `release/dist.zip` 349,982 B, `release/P022-R1-FREEZE.bundle` 2,734,280 B (sum 5,838,711 B uncompressed).
- Byte accounting reconciles: nested entries compress to 5,550,533 B inside the new zip (notably the STORE-packed `dist.zip` re-compresses 349,982 → 94,575 B), non-nested content 1,395,484 B, total compressed 6,946,017 B + zip overhead = 6,996,297 B ✓. The growth is fully explained by nesting, not by new product code.
- I additionally extracted the nested `release/source.zip` and confirmed it is freeze #1's archive (281 files, total compressed 2,704,747 B) — the nesting is recursive (freeze #1's archive itself embeds the S5 freeze's `release/source.zip` 1,278,357 B and `release/dist.zip` 253,503 B).
- Judgement: acceptable for R2 — the archive is a faithful `git archive` of the frozen commit, all hashes verify, and the freeze report discloses the nesting. It is wasteful and a mild R2 confusion risk (see P2-RVW-01), but it is not a correctness or evidence defect, and fixing it would require a new frozen object for zero R2 benefit.

## 3. EVID-R1-01 git bundle — independently verified

- `git bundle verify release/P022-R1-FREEZE.bundle` — exit 0: `is okay`, complete history; head `refs/heads/master` → `d26a3cc76b8e4da6cc92bc2c949101a69b179100` ✓
- Clone into fresh dir `~/workspace/p022-bundle-check2` (outside `/tmp`): exit 0, HEAD = `d26a3cc…`, 284 files; `git archive --format=zip d26a3cc…` there produced a zip with whole-file SHA-256 `ebd66c01…` — **byte-identical to `release/source.zip`** ✓
- The bundle does NOT contain the freeze commit `935a3db` (grep of clone log: 0 occurrences) — correct by design; its head is the frozen object, as R1's EVID-R1-01 required. GPT in R2 can clone this bundle and run `git archive` itself.
- Nested stale bundle (see P2-RVW-01): the bundle embedded *inside* `source.zip` (`release/P022-R1-FREEZE.bundle`, 2,734,280 B) verifies OK but its head is freeze #1's `23a5a91`. R2 must use the top-level `release/P022-R1-FREEZE.bundle`.

## 4. Full acceptance — re-run by me, sequentially, exit codes read directly

| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `npm test` | 0 | **590/590 passed, 46 test files, 333.71 s** (log `~/workspace/p022-review-npm-test.log`) |
| 2 | `npm run test:mutation` | 0 | **40/40 killed, 0 survived, 0 config errors, 100.0%, passed:true**; M-RT-03 KILLED (failed=1); M-RT-01 failedTests 48 as expected (log `~/workspace/p022-review-mutation.log`) |
| 3 | `npm run verify:all` | 0 | **`verify:all PASSED — all 9 steps green (437.9 s)`**; step 9/9 `test:mutation` 40/40 (68.0 s) (log `~/workspace/p022-review-verify-all.log`) |
| 4 | `npm run verify:review-pack` | 0 | `PASSED: 18/18 pack files; COVERAGE_MATRIX.csv 185 rows, 0 missing src files, 0 sha256 mismatches; sha256.txt 148/148 match` |
| 5 | `npm run release:verify` | 0 | `PASSED` (5/5 files; manifest OK; source.zip 284 files, dist.zip 64 files; S0_GATE.json SHA + 4 S0 hashes OK; freeze-report SHA rows 4/4) |
| 6 | `npm run release:verify-hashes` | 0 | `PASSED: 3/3 hashes match` |
| 7 | `npm run s0:gate` | 0 | **GATE PASS, failure_type=null, replay 100/100, 1 unique gate hash** (see §4.1) |
| 8 | `npm run test:e2e` | 0 | **7/7 passed** (log `~/workspace/p022-review-e2e.log`) |

- `verify:all` step detail: 1/9 typecheck, 2/9 typecheck:scripts, 3/9 build, 4/9 test (151.9 s), 5/9 test:oracle (30.9 s), 6/9 test:offline (11.4 s), 7/9 test:stress (11.3 s), 8/9 test:coverage (155.6 s), 9/9 test:mutation (68.0 s) — all passed.
- The full `npm test` run includes all five `tests/e2e/*.test.ts` files (custom-input, e2e-main-flow, offline, performance, stress), so the builder's test:e2e 7/7, test:offline 6/6, test:performance 4/4, test:stress 6/6 claims are covered by my own 590/590 run as well as by `verify:all` steps 5–7.
- I did NOT re-run `npm run release:freeze` itself (it rewrites the release artifacts; equivalence is already proven independently by `release:compare-source`, the bundle clone+archive byte-identity, and `release:verify-hashes`). The freeze report's "run twice, identical SHAs" idempotency claim is therefore corroborated, not directly re-proven — recorded as a scoping note, not a finding.

### 4.1 S0 gate — four hashes observed (all EXACT)

- `GATE PASS failure_type=null gate_sha256=651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52` (log `~/workspace/p022-review-gate2.log`; replay progress 10/100 … 100/100, `unique_gate_hashes=1` throughout)
- From `evidence/s0/S0_GATE.json` after the run (SHA `15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d`, frozen value):
  - `scenario_sha256`: `1ffb5f85561c6dd9f10fc15773097691c5c07fe20c6e9a001e231a41b61c9f22`
  - `oracle_result_sha256`: `3502d81fa730605dd85548e39af6b7272015c026e65f91a2dae132c3e345a988`
  - `analysis_sha256`: `4410d5c85cf5fe8ee858c4e01822cdbc1515c39afa7ba40d833aceb00a9576a4`
  - `gate_sha256`: `651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52`
- All four match the manifest, the freeze report, and the R1 verdict's independently recomputed values exactly. No S0 hash changed.

### Evidence hygiene after my runs

- Every run's byproducts were restored from git and SHAs re-verified: `evidence/s4/T012_PERF.json` `b1838d3f…`, `evidence/s4/T012_E2E_REQUESTS.json` `497de20a…`, `evidence/s0/S0_P2A.log` `2a76dec1…`, `evidence/s0/S0_GATE.json` `15b5c2d5…`, `evidence/s4/T011_MUTATION_RESULTS.json` `5faa8d7e…` (unchanged after every mutation run, as claimed).
- Final `git status`: `evidence/` clean. The only modified tracked file is `handoff/R1_COORDINATOR_STATE.md`, which was already modified before I started (coordinator's working file — I did not touch it). Untracked items are the pre-existing `coverage/`, `handoff/FIX-R1-04/`, `handoff/P022-FINAL-R1/`. My `npm run demo` regenerated `runs/demo.json`, which is git-ignored. No commits, no pushes, no source/test/release modifications by me.

## 5. Review-pack coverage of the new files

- `verify:review-pack` PASSED (see §4): 185 rows, 0 missing src files, 0 mismatches; `sha256.txt` 148/148.
- Spot-checked by grep: matrix rows exist for all 13 `src/cli/*` files, `src/contracts/custom-scenario.ts`, `src/oracle/custom-target.ts`, `src/export/ui-report-html.ts`, new tests (`tests/contracts/custom-scenario.test.ts`, `tests/export/ui-report-html.test.ts`, `tests/cli/cli.test.ts`, `tests/export/html-api.test.ts`) and the re-pointed scripts including `scripts/t011-mutation-runner.mjs` (29,774 B, sha `7c29b1eb…`).
- `evidence/s4/T011_MUTATION_RESULTS.json` hashes to `5faa8d7ea066ad4104706bf414eaa208eebfa0fb49c93845c38c2cb9545be616` (prefix `5faa8d7e…` as claimed); its content records totals 40/40 killed, 0 survived, 0 config errors, `passed:true`.
- Minor staleness: the matrix notes column for the new-file rows still says "frozen commit 23a5a91" (freeze #1's object) — the hashes themselves are current and verify clean. See P2-RVW-02.

## 6. Freeze-report honesty — checked item by item

| Freeze-report claim | My check |
| --- | --- |
| dist.zip not standalone runnable (no package.json / node_modules / src/ui; `ERR_MODULE_NOT_FOUND: playwright`) | CONFIRMED by file list: the 64 dist.zip entries (manifest + my `release:verify`) contain no `package.json`, no `node_modules`, no `src/ui` static files. T014 P2-1 still open, correctly carried. |
| CLI demo report is FAIL / DEMO_SUBSET by construction (3 fixtures, 24 cases, own gate not the frozen S0 gate) | CONFIRMED live (§7): my demo run produced `failureType: DEMO_SUBSET`, `result: FAIL`, gate `115b30df15fe84c036e090517f439d4adf0d8ee27606f88157da96e023c610f8` ≠ frozen `651c3fd4…`; report notes state the same. |
| `/api/export` full-report-only; custom-shaped report gets honest 422 | CONFIRMED live (§7): posting my ad-hoc analyze response got HTTP 422 `INVALID_REPORT` with field-level errors (`schema must be "locatorstress.analysis-report/v1"`, `seed must be …`, `task must be "T008"` …). |
| FIX-R1-02 review P2-1: 422 message does not point callers at `/ui/export-html` | CONFIRMED: the 422 message I received lists validation errors only, no mention of `/ui/export-html`. Still present, non-blocking, correctly recorded. |
| FIX-R1-03 review P2-1: bad run id exits 1 vs documented exit 2 / `CLI_USAGE` | CONFIRMED live: malformed id `../evil` → exit 1 `INVALID_RUN_ID` (fail-closed, no traversal); well-formed unknown id `does-not-exist` → exit 1 `UNKNOWN_RUN`. See note below. |
| FIX-R1-03 review P2-2: `test:cli` afterAll deletes pre-existing runs sharing its 5 cleanup ids | CONFIRMED in source: `tests/cli/cli.test.ts:96-105` — afterAll `rmSync(runFile(id))` plus `${id}.export.json`/`.export.html` for its id list (incl. `demo`). Hygiene note only, correctly recorded. |
| M-RT-03 FIXED; `test:mutation` 40/40, `verify:all` 9/9 | CONFIRMED by my own runs (§4). Freeze #1's blocker is closed. |
| Three review P2s (above) carried as known limitations | Present and accurate in the freeze report's Known limitations section. |

- Note on the P2-1 wording: the freeze report says "a bad run id exits 1 with `INVALID_RUN_ID`". That is exact for a *malformed* id, but a well-formed *unknown* id exits 1 with `UNKNOWN_RUN` (`src/cli/commands/export.ts:79,129`). The substance — exit 1, not the documented exit 2 / `CLI_USAGE` — is correct in both cases; only the code name is case-dependent. Not counted as a new finding; the P2 itself stands as documented.
- Nothing material was found omitted from the Known limitations section. The report's parenthetical in the artifact-growth note — "(release/source.zip, release/dist.zip, release/P022-R1-FREEZE.bundle, 2,734,280 bytes)" — is ambiguous: 2,734,280 B is the bundle alone, not the sum of the three (5,838,711 B). The builder report gives the full breakdown; the freeze report's figure is not wrong, just easy to misread. Folded into P2-RVW-01.

## 7. The three P1s — spot-checked live in the frozen tree (all closed)

### P1-01 — custom scenario through /api/analyze + /api/search: CLOSED (live)

- Started the built server (`node dist/ui/server.js --port 8931`, UI + proxied API, health 200).
- `POST /api/analyze` with a custom scenario (`button.primary` on synthetic HTML, target `main > button.primary`, mutations M01+M02) → **HTTP 200**, `source: "custom"`, `scenarioId: "P022-REVIEW-CUSTOM"`, 2 cases.
- `POST /api/search` with the same custom scenario (`maxDepth: 2`) → **HTTP 200**, `status: "FOUND"`, witness `{depth: 1, sequence: ["M03"], verdict: "MISSING"}` — a real BFS witness from the custom input, not a fixture.
- Source check: `src/api/routes.ts:114-145` forwards `scenario` to the service for both endpoints; no live `501` remains in `src/api/routes.ts` (only the comment at line 22 noting the HTML branch now returns 200 instead of 501).

### P1-02 — /api/export format=html returns 200: CLOSED (live)

- `POST /api/export` with the frozen `evidence/s3/T010_SAMPLE_REPORT.json` (schema `locatorstress.analysis-report/v1`, task T008, COMPLETE) and `format: "html"` → **HTTP 200, `Content-Type: text/html; charset=utf-8`**, 53,460-byte offline HTML (`<!doctype html>`, CSP `default-src 'none'`, no external URLs found in the output).
- Source check: `src/api/routes.ts:163-180` renders `exportReportHtml()` for `format: "html"`.

### P1-03 — all five CLI commands exist as npm scripts: CLOSED (live)

- `package.json` scripts contain all five: `dev`, `demo`, `analyze`, `search`, `export` (each `npm run build && node dist/cli/index.js <cmd>`).
- `npm run demo` live → **exit 0**: 24/24 cases (F001–F003), verdicts STABLE 18 / WRONG_TARGET 5 / AMBIGUOUS 1 / MISSING 0, score 75, run saved `runs/demo.json`.
- `npm run export -- --run demo --format html --out …` live → **exit 0**: `EXPORTED … 71708 bytes sha256 15ad7d09… format html run demo (full report demo)`; `npm run export -- --run demo --format json --stdout` → exit 0 with a complete `locatorstress.analysis-report/v1` document.
- (The `dev` / `analyze` / `search` commands were verified by the FIX-R1-03 reviewer live and are covered by `test:cli` 30/30 within my 590/590 run; I ran `demo` + `export` live as the task required.)

## 8. Findings

### P2-RVW-01 — source.zip embeds superseded freeze #1 artifacts, including a stale bundle (non-blocking)

- Evidence: `release/source.zip` contains `release/P022-R1-FREEZE.bundle` (2,734,280 B). I extracted it and ran `git bundle verify`: valid bundle, but head is freeze #1's `23a5a916f110b0bb2f5a94c15bda6819b53ad269`, not the frozen `d26a3cc`. It also embeds freeze #1's `source.zip`/`dist.zip`, which themselves embed the S5 freeze's artifacts (recursive nesting; §2).
- Risk: low. The current bundle is the top-level `release/P022-R1-FREEZE.bundle` (head `d26a3cc`, verified byte-identical in §3), and the freeze report discloses the nesting. But GPT in R2 unpacking `source.zip` could pick up the stale bundle or stale freeze report if it reads from inside the zip instead of the top-level release files.
- Recommendation (not required for R2): R2's pack message should point GPT explicitly at the top-level `release/P022-R1-FREEZE.bundle` (head `d26a3cc`). Longer term, a future re-freeze should exclude `release/*.zip` / `release/*.bundle` from the frozen tree (or `.gitignore` them) so each freeze stops growing (~7.0 MB now; a freeze #3 on this pattern would be ~13 MB+).

### P2-RVW-02 — COVERAGE_MATRIX.csv notes still cite freeze #1's frozen commit (non-blocking, cosmetic)

- Evidence: `handoff/T013/COVERAGE_MATRIX.csv` rows for the new R1 files carry the note "frozen commit 23a5a91"; the frozen commit is now `d26a3cc`. The hashes/lines/bytes in those rows are current and `verify:review-pack` passes with 0 mismatches, so this is notes-column staleness only.
- Recommendation: update the notes to `d26a3cc` at the next pack regeneration; no re-freeze needed.

### No P0 / no P1

- No blocking issue found. All artifact hashes, the bundle, the full test suite, mutation, `verify:all`, the review pack, the S0 gate, and live P1 checks reproduce the builder's claims exactly.

## 9. Commands run (all by this reviewer, sequential, never concurrent with the gate)

| Command | Exit | Key result |
| --- | --- | --- |
| `git log --oneline -5` / `git rev-parse HEAD` / `git status` | 0 | HEAD `935a3db…`; tree clean except pre-existing coordinator-state modification + untracked items |
| `sha256sum release/{source.zip,dist.zip,RELEASE_MANIFEST.json,SHA256SUMS.txt,P022-R1-FREEZE.bundle}` + `stat` | 0 | All sizes + SHAs match §1 |
| `git ls-tree -r --name-only d26a3cc \| wc -l` | 0 | 284 |
| `git bundle verify release/P022-R1-FREEZE.bundle` | 0 | is okay, complete history, head `d26a3cc` |
| `git clone <bundle> ~/workspace/p022-bundle-check2` + `git archive --format=zip d26a3cc` + `sha256sum` | 0 | Clone HEAD `d26a3cc`; archive SHA `ebd66c01…` = `release/source.zip` byte-identical |
| `npm run release:compare-source` | 0 | 284/284 byte-identical |
| `npm run release:verify` | 0 | PASSED |
| `npm run release:verify-hashes` | 0 | PASSED 3/3 |
| `npm run verify:review-pack` | 0 | PASSED 18/18, 185 rows, 148/148 |
| Chromium probe `~/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome --version` (×2) | 0 | Google Chrome for Testing 158.0.8127.18 |
| `npm test` | 0 | 590/590, 46 files, 333.71 s |
| `npm run test:mutation` | 0 | 40/40, 0 config errors |
| `npm run verify:all` | 0 | 9/9 green, 437.9 s |
| `npm run s0:gate` (attempt 1) | — | Killed by a VM/runtime restart mid-run (see §10); no result |
| `npm run s0:gate` (attempt 2, after evidence restore + Chromium re-probe) | 0 | GATE PASS, 100/100, 1 hash, gate `651c3fd4…` |
| `npm run test:e2e` | 0 | 7/7 |
| Live server `node dist/ui/server.js --port 8931` + curl `/api/analyze`, `/api/search`, `/api/export` (html 200 + 422 cases) | 0 | §7 |
| `npm run demo` | 0 | 24/24 cases, run saved |
| `npm run export -- --run demo --format html --out …` / `--format json --stdout` | 0 / 0 | HTML 71,708 B sha `15ad7d09…`; JSON full report |
| `node dist/cli/index.js export --run does-not-exist --format json` | 1 | `UNKNOWN_RUN` (expected P2-1 behaviour) |
| `node dist/cli/index.js export --run '../evil' --format json` | 1 | `INVALID_RUN_ID`, fail-closed, no traversal |
| `git bundle verify` on the nested freeze #1 bundle extracted from `source.zip` | 0 | is okay, head `23a5a91` (P2-RVW-01) |
| `git checkout -- evidence/` after each test run + SHA re-verification | 0 | All frozen evidence SHAs intact (§4.1) |

## 10. Environment notes (not product defects)

- **VM/runtime restart during gate attempt 1 (~22:00 GMT):** the first `s0:gate` run was killed mid-flight (log stopped at `stage hashes`; `evidence/s0/S0_GATE.json` + `S0_GATE.log` were left deleted by the gate's own regeneration step). I restored `evidence/s0/` from git (SHAs re-verified: `S0_GATE.json` `15b5c2d5…`, `S0_P2A.log` `2a76dec1…`), re-probed Chromium (healthy, 158.0.8127.18), and re-ran the gate from scratch — attempt 2 completed with GATE PASS (§4.1). No EPERM wave was encountered in my session; all writes landed first try.
- **`pkill -f` self-match:** an attempt to stop my live test server with `pkill -f "node dist/ui/server.js --port 8931"` matched my own exec shell and killed it (same known pattern as `AGENTS.md` 2026-11-08). The server was confirmed down afterwards (port 8931 closed, HTTP 000); no other process was harmed — the remaining `node src/server.js` (pid 7115, port 8322) is the Copilot bridge server and was left alone.
- **Unrelated context change:** `~/MEMORY.md` was updated mid-task by another session (Turnkeep R7 verification record). It does not touch P022 and had no effect on this review.

## 11. Review scratch files (outside the repo, for the coordinator)

- Logs: `~/workspace/p022-review-npm-test.log`, `~/workspace/p022-review-mutation.log`, `~/workspace/p022-review-verify-all.log`, `~/workspace/p022-review-gate.log` (killed attempt 1), `~/workspace/p022-review-gate2.log` (PASS), `~/workspace/p022-review-e2e.log`, `~/workspace/p022-review-demo.log`, `~/workspace/p022-review-export-cli.log`, `~/workspace/p022-review-server.log`
- Live-call artefacts: `~/workspace/p022-review-scenario.json`, `~/workspace/p022-review-analyze.json`, `~/workspace/p022-review-search.json`, `~/workspace/p022-review-export.html` (422 body), `~/workspace/p022-review-export2.html` (53,460 B, 200), `~/workspace/p022-review-demo-export.html` (71,708 B)
- Bundle check: `~/workspace/p022-bundle-check2/` (clone of the bundle), `~/workspace/p022-bundle-check2-archive.zip` (SHA `ebd66c01…`), `~/workspace/p022-review-nested/` (extracted freeze #1 source.zip + bundle)
- This report: `handoff/FIX-R1-04/REVIEW.md`
