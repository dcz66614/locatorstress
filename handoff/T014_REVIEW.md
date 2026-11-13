# P022 LocatorStress — T014 Freeze Package Independent Review

- Reviewer: independent reviewer (fresh session; did not participate in any implementation, FIX, or freeze work)
- Review date: 2026-11-11 ~09:20–09:45 GMT
- Frozen commit: `afcc2d1d6edf0cc45ce693bbd9839c42f4cf2aa1` (short `afcc2d1`); HEAD verified equal to it
- Scope: the freeze package itself (`release/` artifacts + 5 release scripts + `package.json` release scripts). Full regression was already run by the coordinator; this review does not repeat it.
- **FINAL_VERDICT: PASS — P0 0 / P1 0 / P2 4 (all non-blocking, listed below)**

## 1. Independent re-computation (my own commands, not the builder's numbers)

All four artifact sizes + SHA-256 values match the claimed values exactly. Recomputed with `ls -l` + `sha256sum` in `~/workspace/p022-locatorstress`:

| file | bytes | SHA-256 (recomputed by me) | matches claim |
| --- | ---: | --- | --- |
| `release/source.zip` | 1,278,357 | `2b355d37f47bca03fe50e5d0c08e91d79e7a87057e633745f9ba9b8dcbdfabfc` | yes |
| `release/dist.zip` | 253,503 | `c3f083234be856f4fe6b23d3f1f22d5e286e695e418ae8f9f01713e06ec7d02c` | yes |
| `release/RELEASE_MANIFEST.json` | 3,421 | `d4afdc54987519c2fa0ea2eea65d2b5e86cb81c330c83792c7c90184c04c2e38` | yes |
| `release/SHA256SUMS.txt` | 240 | `b1e3ffb0a1b7d6dc090e5c03c05189f7e34c98afdf4d04454d0384b4958ca4cd` | yes |
| `release/T014_FREEZE_REPORT.md` | 6,594 | `29280c185a47f763b93e163c109a2fb8356c36b338d2fd872639732dd04b4cd7` | yes |

- `sha256sum -c release/SHA256SUMS.txt` (run from `release/`): all 3 lines `OK`, exit 0. The file has exactly 3 lines and does not list itself or `T014_FREEZE_REPORT.md` (grep count 0) — no self-reference.
- `evidence/s0/S0_GATE.json` SHA-256 recomputed by me: `15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d` — equals the frozen value. Its four hashes equal the manifest values (checked field-by-field with Python): scenario `1ffb5f85…`, oracle_result `3502d81f…`, analysis `4410d5c8…`, gate `651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52`.
- Manifest cross-check (Python, independent of the release scripts): `frozen_commit` = the frozen commit; `spec_version` `1.0.0`; `license` `PENDING_SAM_DECISION`; `source_zip.bytes`/`sha256`/`file_count` (238) and `dist_zip.bytes`/`sha256`/`file_count` (49) all equal disk; `s0.s0_gate_json_sha256` equals disk; all four `s0.*_sha256` equal `S0_GATE.json`'s `hashes`.
- Freeze-report artifact table (4 rows) checked independently with Python (bytes + SHA per row vs disk): all 4 rows match. Report's stated counts also match: source.zip 238 files, dist.zip 49 files.
- All 5 release docs in `release/` are byte-identical to the frozen commit's copies (`git show afcc2d1…:release/<doc>` comparison, 5/5).

## 2. source.zip vs `git archive` — independent comparison (my own method)

Method (not the builder's scripts): Python `zipfile` (stdlib) to read `release/source.zip`, plus a fresh `git archive --format=zip <frozen commit>` piped through `sha256sum` and re-read with the same `zipfile` code; per-file SHA-256 comparison; cross-check against `git ls-tree -r --name-only`.

- Whole-zip bytes: `release/source.zip` is **byte-identical to the fresh `git archive` output** itself (SHA-256 `2b355d37…` both).
- File count: source.zip 238 files (+ 47 explicit directory entries, 285 entries total) = git archive 238 files = `git ls-tree` 238; path sets identical.
- Byte comparison: **238 files compared, 238 byte-identical, 0 path differences, 0 byte differences.**
- Empty files in source.zip: 0.

## 3. dist.zip vs fresh build — independent comparison (my own method)

- Ran a fresh `npm run build` myself (exit 0, Node `v24.22.1`, `tsc`, no errors). Then compared with Python `zipfile`: all 49 entries (44 under `dist/` + 5 release docs at the zip root) against disk `dist/` and `release/*.md`.
- Result: **49/49 byte-identical, 0 mismatches, 0 missing, 0 empty entries.** Disk `dist/` has exactly 44 files, exactly matching the 44 `dist/*` entries; no disk file is missing from the zip and no zip entry is missing from disk.
- Manifest `dist_zip.files` (49 entries) equals the zip entry set and order exactly.
- Note on idempotency: I did not re-run `release:freeze` (forbidden — it would reset the freeze report's acceptance section). Idempotency is instead supported by independent re-derivation: source.zip == fresh `git archive` bytes, and dist.zip entries == fresh `tsc` build bytes, while `release-zip.mjs` writes STORE entries with fixed 1980-01-01 timestamps and paths sorted — so a re-freeze from the same commit would reproduce the same bytes. The builder's claim of two identical freeze runs is consistent with this evidence but was not re-proven by re-running freeze.

## 4. Release scripts — full read-through

Read in full: `scripts/release-freeze.mjs`, `scripts/release-verify.mjs`, `scripts/release-compare-source.mjs`, `scripts/release-verify-hashes.mjs`, `scripts/release-zip.mjs`, plus the `release:*` entries in `package.json` (4 lines added, nothing else changed in `package.json`).

- **FROZEN_COMMIT is a hard-coded constant everywhere it appears**: `release-freeze.mjs:60`, `release-verify.mjs:34`, `release-compare-source.mjs:28`, `release-verify-hashes.mjs:23` — all `afcc2d1d6edf0cc45ce693bbd9839c42f4cf2aa1`. `release-zip.mjs` holds no commit constant by design (its header states it holds no release policy). Every `HEAD` mention in the four scripts is a comment ("never HEAD", "never taken from HEAD"); there is no `rev-parse`, `symbolic-ref`, `branch`, or tip-following logic anywhere in the five scripts. All git invocations use the constant.
- **Freeze idempotency is real for the hashed artifacts** (see §3): source.zip from `git archive` of the constant; dist.zip via deterministic STORE zip; manifest/sums are deterministic functions of those; no wall-clock timestamps enter any hashed artifact (the only time-like text, "~08:50 GMT", is in the manually completed, unhashed acceptance section).
- **SHA256SUMS cannot self-reference by construction** (`release-freeze.mjs` writes exactly three lines: source.zip, dist.zip, manifest) and this was verified on disk (§1).
- **Empty-file handling**: `release-freeze.mjs` `writeChecked` deletes a 0-byte write, retries once, then fails loudly rather than leaving a 0-byte artifact. `release-zip.mjs` `readZip` verifies CRC-32, sizes, rejects encrypted/unsupported methods and duplicate entries, and handles both STORE and DEFLATE (git archive emits DEFLATE).
- **Checker completeness**: `release-compare-source.mjs` is complete — path lists, per-file SHA-256, counts cross-checked against `git ls-tree`, temp dirs removed in `finally`. `release-verify-hashes.mjs` is complete for its scope — strict order, exactly 3 entries, rejects self-reference and report reference, unparsable lines fail. Gaps found are latent only (see P2-3); no gap affects the delivered package, because every fact the checkers skip was verified independently by me in §§1–3.
- `release-freeze.mjs` Step 0 does verify `evidence/s0/S0_GATE.json` SHA and the five release docs against the frozen commit before packaging — but it does not verify the working tree is clean before building (see P2-2).

## 5. Acceptance commands run by me

| command | exit code | key output |
| --- | ---: | --- |
| `npm run typecheck:scripts` | 0 | `tsc -p tsconfig.scripts.json`, no errors |
| `npm run build` (fresh, for §3) | 0 | `tsc`, no errors |
| `npm run release:verify` | 0 | `release:verify PASSED` — 5/5 files present; manifest commit/version OK; bytes+SHA OK; source.zip 238 files, dist.zip 49 files; S0_GATE.json SHA matches frozen value, four S0 hashes OK; freeze-report SHA rows 4/4 checked |
| `npm run release:compare-source` | 0 | `release:compare-source PASSED` — source.zip 238, git archive 238, git ls-tree 238; compared 238 files, 238 byte-identical, 0 path differences, 0 byte differences |
| `npm run release:verify-hashes` | 0 | `release:verify-hashes PASSED` — 3/3 hashes match (source.zip, dist.zip, RELEASE_MANIFEST.json) |

Not run (per task constraints): `release:freeze`, `npm test`, `test:e2e`, `test:performance`, `test:mutation`, `s0:gate`, `verify:all`. No files modified, no commit, no push, no Drive upload. `git status` before and after my review is identical (see §6); the fresh `npm run build` only rewrote gitignored `dist/`.

## 6. Freeze scope

- HEAD = `afcc2d1d6edf0cc45ce693bbd9839c42f4cf2aa1`. `git diff --name-only`: exactly two tracked files modified — `package.json` (only the 4 added `release:*` scripts, expected) and `handoff/S5_COORDINATOR_STATE.md` (coordinator's own status log, +36 lines documenting T014 dispatch/verification; see Observation O-1).
- `git diff --name-only -- src/ tests/ evidence/`: empty — no business source, fixture, golden, test, or evidence file changed.
- Untracked, all expected: the 5 release scripts, the 5 release artifacts (`source.zip`, `dist.zip`, `RELEASE_MANIFEST.json`, `SHA256SUMS.txt`, `T014_FREEZE_REPORT.md`), plus `coverage/` (generated directory, never committed).
- `evidence/s0/S0_GATE.json` SHA still equals the frozen value (§1). No `LICENSE` file exists (`ls LICENSE` → No such file) — license remains `PENDING_SAM_DECISION`.

## 7. dist.zip standalone runnability — verdict: NOT standalone; P2 documentation gap (P2-1)

Findings (read `release/README.md`, `release/HOW_TO_REPRODUCE.md`, `src/ui/server.ts` in full; empirical test in `/tmp/dist-alone`):

- Unpacked alone, `node dist/ui/server.js --port 8901` fails immediately, exit 1: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright' imported from /tmp/dist-alone/dist/runner/locator-resolver.js`. `dist.zip` contains no `package.json`, no `package-lock.json`, and no `node_modules/` — `npm ci` cannot even run inside a dist-only unpack. (`dist/runner/browser.js:1` does `import { chromium } from "playwright"`.)
- Even with dependencies present, the UI could not serve its static files: `src/ui/server.ts:64-76` `uiDir()` looks for `index.html` in `dist/ui/` (absent) and then in `<root>/src/ui` (absent in a dist-only unpack) and falls back to `dist/ui/`, so `/`, `/index.html`, `/styles.css`, `/app.js` would return 500. Fixture HTML and Oracle manifests are likewise resolved from `src/fixtures/` (`src/fixtures/fixture-manifest.ts:61-72`), which is absent; `/api/analyze` and `/ui/fixture-html/*` would fail. Evidence files are absent, so `/ui/reports` would report `present: false` (graceful degradation, not fatal).
- However: neither the spec nor the docs claim dist.zip is standalone. `IMPLEMENTATION_PLAN.md` §12 / T014 require only that "dist.zip 只含分发物和必要文档"; `release/README.md`'s quick start (`npm ci`, `npm run build`, `node dist/ui/server.js`) is written for the source tree, and `HOW_TO_REPRODUCE.md` §6 says reproduction is via `git clone` / a workspace copy. `source.zip` is the complete, runnable artifact (it contains `package.json`, `src/`, fixtures, evidence, and all 238 files).
- **Verdict: not a product defect (no P0/P1). The gap is documentation scope: no document states explicitly that dist.zip alone cannot run the product and that running requires source.zip + `npm ci`. Graded P2-1 below.**

## 8. Freeze-report manual completion — verdict: ACCEPT as-is; recorded as P2-4

- The acceptance section of `release/T014_FREEZE_REPORT.md` was filled in manually after freeze; `scripts/release-freeze.mjs`'s report template (line ~330, "Status at freeze time: PENDING") regenerates only the freeze-time sections, so a re-run of `release:freeze` would reset this section to PENDING. This behavior is documented in the script header and in the report itself.
- This does **not** affect freeze validity: the report is not listed in `SHA256SUMS.txt` and not referenced by the manifest, so completing it changed no hashed artifact (I re-verified: report SHA `29280c18…` is unchanged since the coordinator's check, and the artifact-table rows still match disk, §1). The claims in the acceptance section are independently true — I re-ran the same three commands myself with the same results (§5), and the quoted SHAs match disk.
- Residual risk is only process fragility: a future accidental re-freeze would silently wipe the acceptance record (detectable, since the report SHA is recorded in the coordinator state file and the reset text says PENDING, but not hash-bound). No rework is required for this freeze. **Verdict: accept as-is, recorded as P2-4.**

## 9. Issue list

### P0 — none (0)

### P1 — none (0)

### P2 — 4 (all non-blocking; none blocks acceptance of the freeze package)

**P2-1 — dist.zip is not independently runnable, and no doc says so.**
Evidence: `release/dist.zip` (no `package.json`/`node_modules`); `dist/runner/browser.js:1` (`import { chromium } from "playwright"`); `src/ui/server.ts:64-76` (`uiDir()` falls back to `src/ui/`); empirical: unpacked alone in `/tmp/dist-alone`, `node dist/ui/server.js --port 8901` exits 1 with `ERR_MODULE_NOT_FOUND: Cannot find package 'playwright'`. `release/README.md` "快速开始" and `release/HOW_TO_REPRODUCE.md` §2–§3 describe running from the source tree without ever stating dist.zip alone is insufficient.
Grading rationale: the freeze spec (§12) never requires dist.zip to be standalone, and `source.zip` is the complete runnable artifact, so this is a documentation-scope gap, not a product defect. Suggested fix (non-blocking, for a later docs pass): add one paragraph to `release/README.md` stating dist.zip is a build-output + docs bundle only and that running the product requires `source.zip` followed by `npm ci` + `npm run build`.

**P2-2 — `release:freeze` builds `dist/` from the working tree without first verifying it matches the frozen commit.**
Evidence: `scripts/release-freeze.mjs:164-176` (Step 1 runs `npm run build` with no `git status`/`git diff` cleanliness check), whereas Step 0 (`:115-160`) does verify `S0_GATE.json` and the five release docs against the frozen commit. A dirty `src/` at freeze time would silently package uncommitted code into `dist.zip` while `source.zip` (from `git archive`) stayed clean — and no verify script compares dist content to source.
Grading rationale: latent process gap only. In this freeze the working tree `src/` is clean (`git diff -- src/` empty) and my fresh build reproduced all 49 dist.zip entries byte-identically (§3), so the delivered dist.zip is proven to match the frozen commit. Suggested fix: add a `git status --porcelain` cleanliness gate before Step 1 in a future script revision.

**P2-3 — `release:verify` does not check the freeze-report bytes column, nor dist.zip entry bytes against disk `dist/`.**
Evidence: `scripts/release-verify.mjs:197-221` (Check 6) — the regex at `:210` captures only the SHA column (`\| \d+ \| \`([0-9a-f]{64})\` \|`); a wrong byte count in the report table would still pass. Check 4 (`:122-160`) compares the manifest dist list against the zip entries only; it never compares zip entry bytes to disk `dist/`, so a dist.zip whose entries differ from the build would pass as long as manifest and zip agree.
Grading rationale: latent checker gap only. I verified both facts independently — all 4 report rows' bytes match disk (§1) and all 49 dist.zip entries match a fresh build byte-for-byte (§3). Suggested fix: extend Check 6 to compare the bytes column, and extend Check 4 (or `release:compare-source`) to byte-compare dist.zip entries against a fresh build or against `source.zip`'s `src/` via the frozen commit.

**P2-4 — Freeze-report acceptance section is manually completed and unhashed; a re-freeze would reset it to PENDING.**
Evidence: `release/T014_FREEZE_REPORT.md` "Acceptance verification" section (manual completion, 2026-11-11 ~08:50 GMT); `scripts/release-freeze.mjs:330` template ("Status at freeze time: PENDING"); the report is absent from `SHA256SUMS.txt` and from the manifest.
Grading rationale: accepted as-is (see §8). The section's claims are true and independently re-verified by me; the reset behavior is documented in the script and the report; detection is via the recorded report SHA `29280c18…`. No rework required; recorded here so the fragility is on the record for any future freeze-tooling revision (e.g. generating the acceptance section from the verification run instead of hand-editing).

## 10. Observations (not graded issues)

- **O-1 — `handoff/S5_COORDINATOR_STATE.md` is modified in the working tree** (coordinator's log entries for T014 dispatch/verification, +36 lines). It is outside the task's expected-files list (5 scripts + `package.json` + 5 artifacts), but it is a handoff/status log, not business source, fixture, golden, test, or evidence — and it cannot affect the frozen package, which comes from `git archive` of `afcc2d1`. Noted for the coordinator to include or exclude deliberately at T014 commit time.
- **O-2 — `FROZEN_COMMIT` in `release-verify-hashes.mjs:23` is declared but never used** by that script's logic (it does no git call). The comment claims it "pins the release", but an unused constant pins nothing functionally. Cosmetic; the script's actual checks (strict 3-entry order, hash recomputation) are complete.
- **O-3 — `coverage/` is untracked** (generated by the coordinator's regression runs, never committed). Pre-existing, not created by T014, no effect on the freeze.

## 11. What this review did not do

- Did not run `npm run release:freeze` (would reset the freeze report's acceptance section to PENDING).
- Did not run `npm test` / `test:e2e` / `test:performance` / `test:mutation` / `s0:gate` / `verify:all` (would rewrite frozen evidence; full regression already run and verified by the coordinator).
- Did not modify any repository file, commit, push, or upload to Google Drive. All scratch work was in `/tmp` (`/tmp/dist-alone`, `/tmp/my-git-archive.zip`); the fresh `npm run build` only rewrote gitignored `dist/`.
