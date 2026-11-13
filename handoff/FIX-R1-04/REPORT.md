# P022 LocatorStress — FIX-R1-04 Re-freeze + EVID-R1-01 Git Bundle — Builder Report

- Status: **DONE, committed locally. No push** (no remote; never push).
- Frozen object: `23a5a916f110b0bb2f5a94c15bda6819b53ad269` (short `23a5a91`,
  FIX-R1-03 commit; FIX-R1-01 `f691edd` + FIX-R1-02 `c162579` + FIX-R1-03 `23a5a91`).
- Freeze commit: `b546f8ae8d077a231e1976d6bf8e4f71d62c9977` (short `b546f8a`,
  13 files, 2026-11-11 ~19:07 GMT). One commit, local only.
- Freeze report: `release/R1_FREEZE_REPORT.md` (SHA-256
  `6ca576eb297671984f4059aed4d599c10cd336119026293c94716942b1bcc4d2`,
  282 lines; follows the T014 report structure).
- Prior freeze for reference: S5 freeze commit `3fc5dbb`, frozen object
  `afcc2d1d6edf0cc45ce693bbd9839c42f4cf2aa1` (source.zip 238 files).

## 1. What was done (in order)

1. **Clean-tree check before freezing:** `git status` showed only the two
   pre-existing untracked items (`coverage/`, `handoff/P022-FINAL-R1/`).
   Tree frozen as-is (this was T014 P2-2 — never freeze a dirty tree).
2. **Release scripts re-pointed** (`scripts/release-freeze.mjs`,
   `release-verify.mjs`, `release-compare-source.mjs`,
   `release-verify-hashes.mjs`): `FROZEN_COMMIT` `afcc2d1…` →
   `23a5a91…`, report name `T014_FREEZE_REPORT.md` → `R1_FREEZE_REPORT.md`,
   `TASK_ID` T014 → FIX-R1-04. This mirrors T014 exactly: the release
   tooling lives in the freeze commit and pins the frozen object; the
   frozen tree itself still contains the old scripts (as T014's frozen
   tree contained no release scripts at all). `npm run typecheck:scripts`
   exit 0 after the edits.
3. **Review pack regenerated** from the frozen tree
   (`/tmp/regen_pack.py`, kept out of the repo):
   `handoff/T013/COVERAGE_MATRIX.csv` 155 → **185 rows** (137 kept verbatim,
   18 changed, 30 new: 13 `src/cli/` + `custom-scenario.ts` +
   `custom-target.ts` + `ui-report-html.ts`, 7 new scripts, 7 new tests);
   `handoff/T013/sha256.txt` 126 → **148 entries** (16 evidence +
   package.json + package-lock.json + 117 src + 13 scripts).
   `scripts/verify-review-pack.mjs` re-baselined to frozen 23a5a91
   (`FROZEN_COMMIT`, `EXPECTED_ENTRIES` 126 → 148, `KNOWN_FIX_DELTAS`
   emptied — the T013 deltas are now baked into the frozen tree).
   The T013 prose review docs were NOT touched. Note: the pack records
   the hash of `verify-review-pack.mjs` itself, so any future edit to
   that script must be followed by a pack regeneration (the first
   regeneration attempt failed on exactly that — 147/148 — and was
   re-run after the script edit).
4. **Freeze run twice** (`npm run release:freeze`, exit 0 both times):
   all four artifact SHAs identical between runs (idempotency proven).
5. **Full acceptance** (sequential, exit codes read directly — see §3).
6. **Bundle (EVID-R1-01)** created and verified by clone + `git archive`
   (see §4).
7. **Committed as ONE commit** `b546f8a` (13 files). No push.

## 2. Release artifacts (frozen commit 23a5a91)

| file | bytes | SHA-256 |
| --- | ---: | --- |
| `release/source.zip` | 2754449 | `1e6ce2fe3914986905ba4e9ba9bcf817debb6a9deea1ba6c2987601ed6940ca4` |
| `release/dist.zip` | 349982 | `50a9d20609d2dc4b2027339077c93e64047f8757ef23e5f01cbb7e178ccd2057` |
| `release/RELEASE_MANIFEST.json` | 3941 | `e87547040cae4f3fe8021bd2c3fe2211138269cd72964a9aaa155537762bd7c1` |
| `release/SHA256SUMS.txt` | 240 | `a046ab4d2f3510a7777799507e05f94bd0e266c4ead0f149c4a1a6eac397ba5b` |

- `source.zip`: 281 files (was 238; +43 = 16 src + 7 scripts + 7 tests +
  13 others incl. handoff/REVIEW docs and release docs). Equals
  `git ls-tree -r --name-only 23a5a91` (281); the zip also carries 53
  explicit directory entries.
- `dist.zip`: 64 files (59 build outputs under `dist/` + 5 release docs).
  New outputs vs T014: 12 `dist/cli/*.js` (13 cli sources minus
  `node-shims.d.ts`, which emits no JS) + `dist/contracts/
  custom-scenario.js` + `dist/oracle/custom-target.js` + `dist/export/
  ui-report-html.js` = 15 new.
- Manifest `frozen_commit` = 23a5a91…, `spec_version` 1.0.0,
  `license` PENDING_SAM_DECISION; `SHA256SUMS.txt` lists exactly 3 items,
  no self-reference, no report reference.

## 3. Acceptance (all commands sequential, exit codes read directly)

| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 0 | clean |
| 2 | `npm run typecheck:scripts` | 0 | clean |
| 3 | `npm run build` | 0 | clean |
| 4 | `npm run release:freeze` (×2) | 0, 0 | identical SHAs both runs |
| 5 | `npm test` | 0 | **590/590 passed, 46 files** (320.63 s) |
| 6 | `npm run test:e2e` | 0 | 7/7 passed |
| 7 | `npm run test:offline` | 0 | 6/6 passed |
| 8 | `npm run test:performance` | 0 | 4/4 passed (148.51 s) |
| 9 | `npm run test:stress` | 0 | 6/6 passed |
| 10 | `npm run test:mutation` | **1** | **39/40 killed, 0 survived, 1 CONFIG_ERROR (M-RT-03), 97.5%, passed:false** — see §5 |
| 11 | `npm run test:coverage` | 0 | full suite green |
| 12 | `npm run s0:gate` | 0 | **GATE PASS**, failure_type=null, replay 100/100, 1 unique gate hash |
| 13 | `npm run verify:all` | **1** | **steps 1–8 PASSED, step 9/9 (`test:mutation`) FAILED exit 1** — same M-RT-03 cause |
| 14 | `npm run verify:review-pack` | 0 | PASSED: 18/18 files, matrix 185 rows / 0 missing / 0 mismatches, sha256.txt 148/148 |
| 15 | `npm run release:verify` | 0 | PASSED (5/5 files, 281/64 files, 4/4 report SHA rows) |
| 16 | `npm run release:compare-source` | 0 | PASSED: 281/281 byte-identical, 0 path / 0 byte differences |
| 17 | `npm run release:verify-hashes` | 0 | PASSED: 3/3 hashes match |
| 18 | post-completion re-check (`release:verify` + `release:verify-hashes` after filling in the freeze report) | 0, 0 | PASSED — completion changed no hashed artifact |

### S0 gate — all four hashes exactly unchanged

- `evidence/s0/S0_GATE.json` SHA-256:
  `15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d`
  (frozen value)
- `scenario_sha256`: `1ffb5f85561c6dd9f10fc15773097691c5c07fe20c6e9a001e231a41b61c9f22`
- `oracle_result_sha256`: `3502d81fa730605dd85548e39af6b7272015c026e65f91a2dae132c3e345a988`
- `analysis_sha256`: `4410d5c85cf5fe8ee858c4e01822cdbc1515c39afa7ba40d833aceb00a9576a4`
- `gate_sha256`: `651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52`
- All stages PASS (environment, fixtures, offline-scan, baseline,
  mutations, oracle-parity, controls, coverage, stability,
  offline-runtime, hashes, P2A PASS). Verdict counts 138 / 22 / 17 / 15.
- Chromium was healthy throughout (direct binary probe before the gate:
  Google Chrome for Testing 158.0.8127.18, exit 0; no SIGTRAP/SIGILL,
  no restart during the gate). `evidence/s0/S0_P2A.log` restored from
  git after the gate run, as required.

### Evidence hygiene

Every test run's byproducts were restored from git with SHA re-verification
(`evidence/s3/screenshots/matrix-F002.png`,
`evidence/s4/T012_CUSTOM_E2E_REQUESTS.json`,
`evidence/s4/T012_E2E_REQUESTS.json` `497de20a…`,
`evidence/s4/T012_PERF.json` `b1838d3f…`,
`evidence/s4/T011_MUTATION_RESULTS.json` `98ff10ae…`,
`evidence/s0/S0_P2A.log` `2a76dec1…`). `git status evidence/` clean at
commit time. No EPERM jitter encountered in this session.

## 4. EVID-R1-01 — git bundle

- Path: `release/P022-R1-FREEZE.bundle` (part of freeze commit `b546f8a`)
- Size: **2,734,280 bytes**; SHA-256:
  `5bf4429bbc6776c23cbb9eb52d849a24ed15d6c7cbbffc31808d7b92a93bc59c`
- Head: `refs/heads/master` →
  `23a5a916f110b0bb2f5a94c15bda6819b53ad269` (the frozen commit);
  `git bundle verify` → "is okay", complete history (28 commits).
- Note: a bare commit SHA as the bundle argument was refused
  ("Refusing to create empty bundle" — a bundle needs a named ref), so
  the bundle was created from `master` (== the frozen commit at bundle
  time).
- **Clone-and-archive verification (done by me):** cloned the bundle
  into a fresh `/tmp` dir (exit 0, HEAD = 23a5a91…), ran
  `git archive --format=zip 23a5a91…` there — the resulting zip is
  **byte-identical to `release/source.zip`** (whole-zip SHA-256
  `1e6ce2fe…` on both; per-file comparison: 281 files, path sets
  identical, 0 byte differences). GPT in R2 can clone this bundle and
  run `git archive` itself.
- Scope note: the bundle's head is the **frozen object** 23a5a91 by
  design; it does NOT contain the freeze commit `b546f8a` (re-generated
  pack, updated scripts, R1 report, bundle file itself). R2 should read
  those from Drive 04_release / the freeze commit, and use the bundle
  for the git-object-level `git archive` check it asked for.

## 5. Open points (read before R2)

### BLOCKING for a clean `verify:all` — stale mutation mutant M-RT-03

- `test:mutation` exits 1 (39/40 killed, 0 survived, 1 CONFIG_ERROR,
  score 97.5%, `passed:false`) and therefore `verify:all` fails at
  step 9/9. Steps 1–8 all pass.
- Cause (proven, not inferred): mutant M-RT-03
  (`scripts/t011-mutation-runner.mjs:357-362`, anchor `status: 501,`,
  "HTML export 501 -> 200") can no longer be applied — FIX-R1-02
  correctly removed the 501 from `src/api/routes.ts` (the only remaining
  `501` there is a comment saying it "now returns 200 text/html instead
  of 501"). The runner reports CONFIG_ERROR for that mutant.
- This is NOT a product defect and NOT a test-coverage gap: no mutant
  survived; the full suite is 590/590 and the S0 gate is unchanged.
  The frozen `evidence/s4/T011_MUTATION_RESULTS.json` still records the
  pre-R1 40/40 PASS (it predates FIX-R1-02).
- Fix (deliberately NOT done here — it would change the frozen tree and
  require a new frozen object + re-freeze): remove or replace M-RT-03
  with a mutant against the new 200/HTML behaviour, re-run
  `test:mutation`, re-freeze. Alternatively carry it into R2 as a known
  failure with this exact cause. The freeze report (§Known limitations)
  records it in full so GPT does not mistake it for a product failure.
- Side observation: one other mutant's `failedTests` moved 47 → 48
  (suite grew 560 → 590); expected, deterministic, not a failure.

### Known limitations carried in the freeze report (non-blocking)

- `dist.zip` is build output + docs, NOT standalone runnable
  (no `package.json`/`node_modules`/`src/ui`; T014 P2-1, still open).
- CLI demo report is FAIL / DEMO_SUBSET by construction (3 of 24
  fixtures, 24 cases — not the 192-case gate).
- `/api/export` stays full-report-only with honest 422 for custom-shaped
  reports; custom runs export as HTML via `POST /ui/export-html`.
- FIX-R1-02 review P2-1: the 422 message does not hint at
  `/ui/export-html`.
- FIX-R1-03 review P2-1: bad run id exits 1 `INVALID_RUN_ID` vs
  documented exit 2 `CLI_USAGE`.
- FIX-R1-03 review P2-2: `test:cli` afterAll deletes pre-existing runs
  sharing its 5 cleanup ids.

### Process notes for the next freeze

- T014 P2-2 is still open in the tooling: `release:freeze` builds `dist/`
  from the working tree without a cleanliness gate (I checked cleanliness
  manually before freezing). T014 P2-3 (verify does not check the report's
  bytes column, nor dist.zip entry bytes vs disk `dist/`) is still open;
  I checked the bytes column by hand (all four rows match disk).
- The freeze report's acceptance section is still manually completed and
  unhashed (T014 P2-4); a re-freeze would reset it to PENDING.
- The frozen tree's own release scripts still pin `afcc2d1` (they predate
  this freeze); the freeze commit's scripts pin `23a5a91`. Same pattern
  as T014 — flagged so nobody "fixes" the frozen tree's copies by hand.

## 6. Files

- Freeze commit `b546f8ae8d077a231e1976d6bf8e4f71d62c9977` (13 files):
  `handoff/T013/COVERAGE_MATRIX.csv`, `handoff/T013/sha256.txt`,
  `release/RELEASE_MANIFEST.json`, `release/SHA256SUMS.txt`,
  `release/dist.zip`, `release/source.zip`,
  `release/R1_FREEZE_REPORT.md`, `release/P022-R1-FREEZE.bundle`,
  `scripts/release-compare-source.mjs`, `scripts/release-freeze.mjs`,
  `scripts/release-verify-hashes.mjs`, `scripts/release-verify.mjs`,
  `scripts/verify-review-pack.mjs`.
- This report: `handoff/FIX-R1-04/REPORT.md` (written after the commit so
  it can cite the real freeze-commit hash; not part of the freeze commit).
- Left untracked, as found: `coverage/` (generated), `handoff/P022-FINAL-R1/`
  (pre-existing R1 pack message).
- No Drive upload, no GitHub push, no code or test changes beyond the
  freeze tooling + regenerated pack described above.

---

# Re-freeze #2 (FIX-R1-04b) — appended 2026-11-11 ~20:09–20:55 GMT

- Status: **DONE, committed locally. No push** (no remote configured; never push).
- Frozen object: `d26a3cc76b8e4da6cc92bc2c949101a69b179100` (short `d26a3cc`,
  FIX-R1-05 commit; only change vs freeze #1's frozen object `23a5a91` is
  FIX-R1-05 — `scripts/t011-mutation-runner.mjs` M-RT-03 replaced +
  `evidence/s4/T011_MUTATION_RESULTS.json` regenerated, sha `5faa8d7e…`).
- Freeze commit: `935a3db788876288aa9bea84105a3c17647568ba` (short `935a3db`,
  12 files, 2026-11-11 ~20:55 GMT). One commit, local only.
- Freeze report: `release/R1_FREEZE_REPORT.md` (SHA-256
  `c687002c4afe975bdd19e462a7c04642be999a6d6acb4a19e5018fc7c4ffc9fa`,
  299 lines; TASK_ID stays FIX-R1-04, noted as re-freeze #2 / FIX-R1-04b).
- Freeze #1 (above) is superseded; its artifacts are not reused
  (old source.zip sha `1e6ce2fe…`, old bundle sha `5bf4429b…`).

## 1. What was done (in order)

1. **Clean-tree check before freezing:** `git status` showed only the
   three pre-existing untracked items (`coverage/`,
   `handoff/P022-FINAL-R1/`, `handoff/FIX-R1-04/`; `handoff/FIX-R1-05/`
   is tracked, committed in `d26a3cc`). Tree frozen as-is.
2. **Release scripts re-pointed** (`scripts/release-freeze.mjs`,
   `release-verify.mjs`, `release-compare-source.mjs`,
   `release-verify-hashes.mjs`, plus `scripts/verify-review-pack.mjs`):
   `FROZEN_COMMIT` `23a5a91…` → `d26a3cc…`; short-hash mentions
   updated; TASK_ID stays FIX-R1-04, report name stays
   `R1_FREEZE_REPORT.md`. `npm run typecheck:scripts` exit 0 after the
   edits. Also fixed a stale comment in `verify-review-pack.mjs`
   (check 3 said "126 entries", now "148 entries").
3. **Review pack regenerated** from the frozen tree with a re-derived
   script (`/tmp/regen_pack2.py`, kept out of the repo — the freeze #1
   script `/tmp/regen_pack.py` no longer exists; procedure re-derived
   from the freeze #1 report §1 step 3; it hashes the working tree
   after the step-2 re-pointing, exactly as freeze #1 did).
   `handoff/T013/COVERAGE_MATRIX.csv` still 185 rows, exactly 6 rows
   updated (the 5 re-pointed scripts + `t011-mutation-runner.mjs`);
   `handoff/T013/sha256.txt` still 148 entries, exactly 7 hashes
   updated (the same 6 files + `T011_MUTATION_RESULTS.json`
   `98ff10ae…` → `5faa8d7e…`). `scripts/verify-review-pack.mjs`
   re-baselined to frozen `d26a3cc` (`FROZEN_COMMIT`,
   `KNOWN_FIX_DELTAS` stays empty). The T013 prose review docs were
   NOT touched. Gotcha found and fixed mid-regen: the matrix uses
   CRLF line endings — the first regen attempt rewrote it with LF
   (372-line diff); discarded and re-run with CRLF, final diff is
   exactly the 6 rows.
4. **Freeze run twice** (`npm run release:freeze`, exit 0 both times):
   all four artifact SHAs identical between runs (idempotency proven).
5. **Full acceptance** (sequential, exit codes read directly — see §3).
6. **Bundle (EVID-R1-01, re-created)** and verified by clone +
   `git archive` (see §4).
7. **Committed as ONE commit** `935a3db` (12 files). No push.

## 2. Release artifacts (frozen commit d26a3cc)

| file | bytes | SHA-256 |
| --- | ---: | --- |
| `release/source.zip` | 6996297 | `ebd66c019826d8fa9c1b94b502c98ae0e31770f0f682bb66ad1c84292a035a74` |
| `release/dist.zip` | 349982 | `50a9d20609d2dc4b2027339077c93e64047f8757ef23e5f01cbb7e178ccd2057` |
| `release/RELEASE_MANIFEST.json` | 3941 | `8924e10284a56f616627c797498781a5faefa9727a1ec8dd2b0dd20850a57a1d` |
| `release/SHA256SUMS.txt` | 240 | `e44d7f629bf07320ea9d27e528424186657382a805c02045bb6bfb5cc29b74b6` |

- `source.zip`: 284 files (was 281; +3 = `handoff/FIX-R1-05/REPORT.md` +
  `release/R1_FREEZE_REPORT.md` + `release/P022-R1-FREEZE.bundle`).
  Equals `git ls-tree -r --name-only d26a3cc` (284); the zip also carries
  54 explicit directory entries. It grew 2,754,449 → 6,996,297 bytes
  because the frozen tree now contains freeze #1's own artifacts
  (old source.zip 2,754,449 B + dist.zip 349,982 B + bundle 2,734,280 B)
  as tracked files — expected, not an anomaly.
- `dist.zip`: 64 files (59 build outputs under `dist/` + 5 release docs).
  Byte-identical to freeze #1 (`50a9d206…`) — no source change since
  `23a5a91`, build deterministic. It is therefore NOT modified in the
  freeze commit (12 files, not 13).
- Manifest `frozen_commit` = d26a3cc…, `spec_version` 1.0.0,
  `license` PENDING_SAM_DECISION; `SHA256SUMS.txt` lists exactly 3 items,
  no self-reference, no report reference.

## 3. Acceptance (all commands sequential, exit codes read directly)

| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 0 | clean |
| 2 | `npm run typecheck:scripts` | 0 | clean |
| 3 | `npm run build` | 0 | clean |
| 4 | `npm run release:freeze` (×2) | 0, 0 | identical SHAs both runs |
| 5 | `npm test` | 0 | **590/590 passed, 46 files** (326.15 s) |
| 6 | `npm run test:e2e` | 0 | 7/7 passed |
| 7 | `npm run test:offline` | 0 | 6/6 passed |
| 8 | `npm run test:performance` | 0 | 4/4 passed (142.60 s) |
| 9 | `npm run test:stress` | 0 | 6/6 passed |
| 10 | `npm run test:mutation` | 0 | **40/40 killed, 0 survived, 0 config errors, 100.0%, passed:true** — M-RT-03 FIXED |
| 11 | `npm run test:coverage` | 0 | full suite green |
| 12 | `npm run s0:gate` | 0 | **GATE PASS**, failure_type=null, replay 100/100, 1 unique gate hash |
| 13 | `npm run verify:all` | 0 | **PASSED — all 9 steps green (461.5 s)**; step 9/9 `test:mutation` 40/40 (67.9 s) |
| 14 | `npm run verify:review-pack` | 0 | PASSED: 18/18 files, matrix 185 rows / 0 missing / 0 mismatches, sha256.txt 148/148 |
| 15 | `npm run release:verify` | 0 | PASSED (5/5 files, 284/64 files, 4/4 report SHA rows) |
| 16 | `npm run release:compare-source` | 0 | PASSED: 284/284 byte-identical, 0 path / 0 byte differences |
| 17 | `npm run release:verify-hashes` | 0 | PASSED: 3/3 hashes match |
| 18 | post-completion re-check (`release:verify` + `release:verify-hashes` after filling in the freeze report) | 0, 0 | PASSED — completion changed no hashed artifact |

### S0 gate — all four hashes exactly unchanged

- `evidence/s0/S0_GATE.json` SHA-256:
  `15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d`
  (frozen value)
- `scenario_sha256`: `1ffb5f85561c6dd9f10fc15773097691c5c07fe20c6e9a001e231a41b61c9f22`
- `oracle_result_sha256`: `3502d81fa730605dd85548e39af6b7272015c026e65f91a2dae132c3e345a988`
- `analysis_sha256`: `4410d5c85cf5fe8ee858c4e01822cdbc1515c39afa7ba40d833aceb00a9576a4`
- `gate_sha256`: `651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52`
- Chromium was healthy throughout (direct launch probe before the gate:
  Google Chrome for Testing 158.0.8127.18, exit 0; no SIGTRAP/SIGILL,
  no restart during the gate). `evidence/s0/S0_P2A.log` restored from
  git after the gate run, as required.

### Evidence hygiene

Every test run's byproducts were restored from git with SHA re-verification
(`evidence/s3/screenshots/matrix-F002.png`,
`evidence/s4/T012_CUSTOM_E2E_REQUESTS.json`,
`evidence/s4/T012_E2E_REQUESTS.json` `497de20a…`,
`evidence/s4/T012_PERF.json` `b1838d3f…`,
`evidence/s0/S0_P2A.log` `2a76dec1…`). `evidence/s4/
T011_MUTATION_RESULTS.json` was NOT restored — the mutation runs
regenerate it legitimately; it is deterministic and its SHA stayed
`5faa8d7e…` after every run in this session (including the two
`verify:all` mutation steps). `git status evidence/` clean at commit
time. No EPERM jitter encountered in this session (write probe OK
before freezing; all writes landed first try).

## 4. EVID-R1-01 — git bundle (re-created)

- Path: `release/P022-R1-FREEZE.bundle` (part of freeze commit `935a3db`)
- Size: **7,044,453 bytes**; SHA-256:
  `bab36e27c6862b890ea3c5a39ddf9e7035aabe1e3347a117ef9d0df3b39b41d2`
- Head: `refs/heads/master` →
  `d26a3cc76b8e4da6cc92bc2c949101a69b179100` (the frozen commit);
  `git bundle verify` → "is okay", complete history.
  (Bigger than freeze #1's 2,734,280-byte bundle because the frozen
  tree now contains freeze #1's artifacts.)
- Note: a bare commit SHA as the bundle argument was refused
  ("Refusing to create empty bundle" — a bundle needs a named ref), so
  the bundle was created from `master` (== the frozen commit at bundle
  time).
- **Clone-and-archive verification (done by me):** cloned the bundle
  into a fresh `/tmp` dir (`/tmp/bundle-check2`, exit 0, HEAD = d26a3cc…),
  ran `git archive --format=zip d26a3cc…` there — the resulting zip is
  **byte-identical to `release/source.zip`** (whole-zip SHA-256
  `ebd66c01…` on both; per-file comparison: 284 files, path sets
  identical, 0 byte differences; 54 directory entries both). GPT in R2
  can clone this bundle and run `git archive` itself.
- Scope note: the bundle's head is the **frozen object** d26a3cc by
  design; it does NOT contain the freeze commit `935a3db` (re-generated
  pack, updated scripts, R1 report, bundle file itself). R2 should read
  those from Drive 04_release / the freeze commit, and use the bundle
  for the git-object-level `git archive` check it asked for.

## 5. Open points (read before R2)

### FIXED at this re-freeze — stale mutation mutant M-RT-03

- Freeze #1's blocker is closed: `test:mutation` now exits 0
  (40/40 killed, 0 survived, 0 config errors, 100.0%) and
  `verify:all` passes all 9 steps (461.5 s). M-RT-03 (new definition:
  "HTML export regresses to 501 (FIX-R1-02 undone)") is killed by the
  FIX-R1-02 routes test (failed=1). M-RT-01 failedTests 47 → 48 is
  expected (routes test group grew by one test); still KILLED.
- The frozen `evidence/s4/T011_MUTATION_RESULTS.json` now records the
  40/40 PASS (SHA `5faa8d7e…`).

### Known limitations carried in the freeze report (non-blocking)

- `dist.zip` is build output + docs, NOT standalone runnable
  (no `package.json`/`node_modules`/`src/ui`; T014 P2-1, still open).
- CLI demo report is FAIL / DEMO_SUBSET by construction (3 of 24
  fixtures, 24 cases — not the 192-case gate).
- `/api/export` stays full-report-only with honest 422 for custom-shaped
  reports; custom runs export as HTML via `POST /ui/export-html`.
- FIX-R1-02 review P2-1: the 422 message does not hint at
  `/ui/export-html`.
- FIX-R1-03 review P2-1: bad run id exits 1 `INVALID_RUN_ID` vs
  documented exit 2 `CLI_USAGE`.
- FIX-R1-03 review P2-2: `test:cli` afterAll deletes pre-existing runs
  sharing its 5 cleanup ids.

### Process notes for the next freeze

- T014 P2-2 is still open in the tooling: `release:freeze` builds `dist/`
  from the working tree without a cleanliness gate (I checked cleanliness
  manually before freezing). T014 P2-3 (verify does not check the report's
  bytes column, nor dist.zip entry bytes vs disk `dist/`) is still open;
  I checked the bytes column by hand (all four rows match disk).
- The freeze report's acceptance section is still manually completed and
  unhashed (T014 P2-4); a re-freeze would reset it to PENDING.
- The frozen tree's own release scripts still pin `23a5a91` (they predate
  this freeze); the freeze commit's scripts pin `d26a3cc`. Same pattern
  as T014 / freeze #1 — flagged so nobody "fixes" the frozen tree's
  copies by hand.
- `dist.zip` being byte-identical to freeze #1 means it is not part of
  this freeze commit's diff (12 files, not 13) — the file on disk and in
  the commit is the same bytes either way.

## 6. Files

- Freeze commit `935a3db788876288aa9bea84105a3c17647568ba` (12 files):
  `handoff/T013/COVERAGE_MATRIX.csv`, `handoff/T013/sha256.txt`,
  `release/RELEASE_MANIFEST.json`, `release/SHA256SUMS.txt`,
  `release/source.zip`, `release/P022-R1-FREEZE.bundle`,
  `release/R1_FREEZE_REPORT.md`,
  `scripts/release-compare-source.mjs`, `scripts/release-freeze.mjs`,
  `scripts/release-verify-hashes.mjs`, `scripts/release-verify.mjs`,
  `scripts/verify-review-pack.mjs`.
  (`release/dist.zip` unchanged from freeze #1, so not in the diff.)
- This report: `handoff/FIX-R1-04/REPORT.md` (this "Re-freeze #2"
  section appended after the commit so it can cite the real
  freeze-commit hash; not part of the freeze commit).
- Left untracked, as found: `coverage/` (generated), `handoff/P022-FINAL-R1/`
  (pre-existing R1 pack message), `handoff/FIX-R1-04/` (this report).
- No Drive upload, no GitHub push, no code or test changes beyond the
  freeze tooling + regenerated pack described above.
