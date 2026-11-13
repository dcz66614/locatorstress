# P022 LocatorStress — FIX-R2-03 independent freeze review

- **Reviewer:** fresh session, independent (no prior work on this project).
- **Date:** 2026-11-13 ~03:28–04:20 GMT.
- **Frozen object (code):** `a834eea` (full `a834eeae36f816c2f273677636127facb6902dbf`).
- **Freeze commit reviewed:** `cd15e63` — "P022 R2 rework FIX-R2-03: re-freeze a834eea (R3 candidate)", 14 files.
- **FINAL_VERDICT: PASS**
- **P0 0 / P1 0 / P2 2** (both non-blocking, listed below).

## 1. Verdict

The re-freeze is sound. Every freeze artifact's size and SHA-256 recomputed
by this reviewer matches the claimed values exactly; all three release
checks pass; the git bundle clones (with `--branch r2-frozen`) and its
`git archive` output is byte-identical to `source.zip`; the full test suite
(630/630), mutation (40/40), S0 gate (GATE PASS, gate hash exact, 100/100,
1 hash), verify:all (9/9) and verify:review-pack (148/148, 0 problems) all
pass on my own re-runs from scratch. Both R2 P1 closures are present in the
frozen code (spot-checked, §5). No P0 or P1 findings. The freeze is a valid
R3 candidate.

## 2. Freeze artifacts (sizes + SHA-256 recomputed by this reviewer)

| file | bytes | SHA-256 (recomputed) | matches claim |
| --- | ---: | --- | --- |
| `release/source.zip` | 15,618,130 | `a4cbb9343a52299b2d362430aeaca1ea5104011dee7ea159c4726c4ecb73ed12` | yes |
| `release/dist.zip` | 371,752 | `555f54196d4ac1c09070ee8ec366250028e82581838a50a05476be64e5ff339c` | yes |
| `release/RELEASE_MANIFEST.json` | 3,942 | `a8f6fc5cbef7c0d8aa2792aa476790b54c0a5830251f977ea34aaba96264c6b4` | yes |
| `release/SHA256SUMS.txt` | 240 | `deab6c100a8f39e65a753963faf04e40d3c5f3c0cdbc7888e3818bd44ad6d5f5` | yes |
| `release/R2_FREEZE_REPORT.md` | 7,879 | `c12b957b370b3d9d058e9da21f32c47845eb0cde38880ec9f41630bd1992ad25` | yes |
| `release/P022-R2-FREEZE.bundle` | 15,707,613 | `f1fb5ac43e096e6d89d15a88675e128c8c2c7cac32ecfd02137306d118d11e9a` | yes |

The freeze report's Acceptance section claims were re-checked against my own
runs and agree (release:verify 6/6 detail, compare-source 297/297,
verify-hashes 3/3).

## 3. Checks personally run (all from scratch, exit codes read directly)

| # | Check | Command | Result |
| --- | --- | --- | --- |
| 1 | Repo state | `git log --oneline -1`, `git status --short` | HEAD `cd15e63`; clean except untracked `.tmp-gate-r2/`, `coverage/`, `handoff/P022-FINAL-R2/`, `handoff/P022-FINAL-R3/` (all expected, none committable) |
| 2 | Release verify | `npm run release:verify` | PASSED, exit 0 (6/6: 5/5 files, manifest OK, zips vs manifest OK, 297/64 entries, S0 hashes OK, 4/4 report rows) |
| 3 | Compare source | `npm run release:compare-source` | PASSED, exit 0 — 297/297 files byte-identical, 0 path / 0 byte differences |
| 4 | Verify hashes | `npm run release:verify-hashes` | PASSED, exit 0 — 3/3 hashes match |
| 5 | Bundle clone | `git clone --branch r2-frozen release/P022-R2-FREEZE.bundle` (scratch dir outside repo) | Cloned, HEAD `a834eea`; `git bundle verify`: "is okay", complete history, single ref `refs/heads/r2-frozen` |
| 6 | Bundle archive identity | `git archive --format=zip a834eea` in the clone, `sha256sum` | `a4cbb934…`, 15,618,130 B — byte-identical to `release/source.zip` |
| 7 | Nested stale artifacts | `unzip -p release/source.zip release/P022-R1-FREEZE.bundle \| sha256sum`; same for nested `release/source.zip` | `bab36e27…` and `ebd66c01…` — exactly the disclosed R1 values; nesting is as documented, not a defect |
| 8 | Full suite | `npm test` | 49 files, **630/630 passed**, 451.58 s, exit 0 |
| 9 | Mutation | `npm run test:mutation` | **40/40 = 100.0%**, 0 survived, 0 config errors, exit 0 (all 40 mutants KILLED in the log) |
| 10 | S0 gate | `npm run s0:gate` | **GATE PASS**, `failure_type=null`, `gate_sha256=651c3fd4…` exact, replay 100/100, 1 unique hash, exit 0 |
| 11 | Full verification | `npm run verify:all` | **PASSED — all 9 steps green** (896.5 s total), exit 0; step 4 test 315.3 s, step 8 coverage 357.4 s, step 9 mutation 83.1 s |
| 12 | Review pack | `npm run verify:review-pack` | **PASSED**, exit 0 — 18/18 pack files; matrix 188 rows, 117 src files, 0 missing, 0 mismatches; sha256.txt 148/148 match |
| 13 | Frozen evidence SHAs | `sha256sum` after every run (evidence restored from git after each step) | S0_GATE.json `15b5c2d5…`, S0_P2A.log `2a76dec1…`, T012_PERF.json `b1838d3f…`, T012_E2E_REQUESTS.json `497de20a…`, T012_CUSTOM_E2E_REQUESTS.json `f7a8159c…`, matrix-F002.png `d814537d…` — all match frozen values |

Notes on runs: acceptance steps were run sequentially (never concurrent with
the gate), each with `TMPDIR` set to a workspace scratch dir
(`.tmp-r2-03-review/`, deleted afterwards). Durations differ from the
coordinator's runs (e.g. npm test 451.58 s vs 355.39 s; verify:all 896.5 s
vs 534.0 s) — machine-load variance only; counts and hashes are identical.
A VM restart (#91, ~03:07 GMT) occurred before this review's battery started
(~03:28 GMT); the battery was unaffected. No EPERM failures hit this review.

## 4. Findings

### P0 — 0

None.

### P1 — 0

None.

### P2 — 2 (non-blocking)

- **P2-RVW-R2-03-01 — bundle's only ref is `refs/heads/r2-frozen`; a plain
  `git clone` fails.** Reproduced the failure mode by inspection (`git bundle
  verify` lists exactly one ref) and confirmed the `--branch r2-frozen`
  clone works. The R3 draft already documents the exact command, so this is
  a usability note, not a freeze defect. Non-blocking.
- **P2-RVW-R2-03-02 — `verify:review-pack` fails until test-rewritten
  evidence byproducts are restored.** The three files `S0_P2A.log`,
  `T012_E2E_REQUESTS.json`, `T012_PERF.json` are rewritten by test runs;
  the check passes only after `git checkout -- evidence/`. This is the
  long-standing documented pattern (also in the coordinator's R3 draft §3),
  and my battery passed on the first attempt only because it restores
  evidence after every step. Non-blocking; a future hardening would make the
  verifier tolerate or auto-restore these byproducts.

### Carried, not new (checked, no action in this review)

- `dist.zip` is build output + docs, not standalone runnable (T014 P2-1,
  still open; disclosed in the freeze report and R3 draft).
- Nested stale R1 artifacts inside `source.zip` (R1 bundle + R1 source.zip)
  — disclosed and kept by design; byte-identity verified (§3 checks 6–7).
- P2-RVW-02 (stale `COVERAGE_MATRIX.csv` "frozen commit 23a5a91" comment)
  is closed by this freeze's re-registration: I counted 42 rows carrying
  "; re-confirmed at R2 freeze (frozen commit a834eea)" in the matrix, and
  `verify:review-pack` passes 148/148. The R3 draft's carried-P2 total of 31
  is consistent.
- Windows untested; real-browser BFS only on F001; license still
  PENDING_SAM_DECISION. All pre-existing, disclosed limitations.

## 5. P1-closure spot-checks (frozen tree `a834eea`, read-only)

- **P1-01 (custom HTML `<script/>` bypass):** present. `src/contracts/
  custom-scenario.ts` carries the structured HTML tokenizer (9 "tokeniz"
  mentions in the frozen blob; header comment states self-closing
  `<script/>`, SVG scripts, srcdoc scripts and unquoted values are caught);
  `src/runner/browser.ts:131` exports `withPageJavaScriptDisabled` using CDP
  `Emulation.setScriptExecutionDisabled`, imported and used by
  `src/api/service.ts`. The old regex-only validation is no longer the sole
  defence. (This review did not re-run the live Chromium exploit; the
  FIX-R2-01 review did, and its 19 new tests pass in the 630/630 suite.)
- **P1-02 (Run Store scenario mixing):** present. `src/cli/run-store.ts`
  has `scenario_sha256` (4 mentions in the frozen blob) +
  `scenarioFingerprint()`, `RESERVED_RUN_IDS` + `isReservedRunId()`, and
  `REPORT_OVERWRITE_REFUSED`; `src/cli/commands/input.ts:91` rejects reserved
  IDs before launching a browser. The new `tests/cli/run-store.test.ts`
  (14 tests) is in the suite and passes. (The live repro was re-run by the
  FIX-R2-02 review #2 and passed; this review re-ran the suite, not the
  manual repro.)

## 6. Limitations of this review

- I did not re-run GPT's R2 live exploit payloads in Chromium, nor the
  manual CLI repro sequence; those were covered by the FIX-R2-01 and
  FIX-R2-02 independent reviews and by the suite (630/630, incl. 19 + 21
  new tests). My scope was the freeze.
- I did not download the Drive copies; the Drive upload is the
  coordinator's step and is verified separately by re-download.
- Durations are machine-load dependent; only counts, hashes and exit codes
  are asserted.

## 7. Required next actions

None blocking. Proceed: Drive upload of the 6 freeze files + the two FIX
review reports, fill the Drive links + freeze commit `cd15e63` into the R3
draft, and send R3 in the establishment conversation.
