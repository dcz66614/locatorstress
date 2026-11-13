# FIX-R2-01 — Report: close P022-R2-P1-01 (custom HTML script execution)

- Builder session: `ac3c2ac2-612e-44e7-8801-45ebfcc17a66`
- Date: 2026-11-12 (work ~01:12–03:20 GMT)
- Frozen base: object d26a3cc (freeze commit 935a3db); HEAD 2b74796 (unchanged, uncommitted work only)
- Verdict / verification: `~/workspace/P022_R2_VERDICT.md`, `~/workspace/p022-R2-verification-2026-11-12.md`
- Status: **FIX COMPLETE. All acceptance items pass except one known, explained exception: `verify:review-pack` reports exactly 1 problem (the verifier script's own hash) — see §6. Nothing is committed; no message was sent to GPT; the Run Store (`run-store.ts`, CLI analyze/search) was not touched.**

## 1. Files changed

| File | Change |
|---|---|
| `src/contracts/custom-scenario.ts` | Structured HTML safety parsing (tokenizer second pass) in `validateCustomHtmlSafety()`; regex denylist kept as first pass |
| `src/runner/browser.ts` | New `withPageJavaScriptDisabled(page, work)` — per-page CDP toggle (`Emulation.setScriptExecutionDisabled`); general runner context intentionally left JavaScript-enabled (see §3) |
| `src/api/service.ts` | Custom `analyze` / `search` branches run inside `withPageJavaScriptDisabled` |
| `src/ui/snapshot.ts` | `snapshotCustom` runs inside `withPageJavaScriptDisabled` |
| `scripts/verify-review-pack.mjs` | Registered the 4 source files in `KNOWN_FIX_DELTAS` (the script's documented mechanism for FIX rounds); check logic untouched |
| `tests/contracts/custom-scenario-r2.test.ts` | NEW — 9 unit tests (validation only, no browser) |
| `tests/api/custom-scenario-r2-browser.test.ts` | NEW — 10 live-Chromium tests |
| `handoff/FIX-R2-01/GATE-RERUN2.log` | Evidence: full output of the passing S0 gate re-run |

`git diff --stat` (uncommitted, nothing committed):

```
 scripts/verify-review-pack.mjs   |  37 ++++-
 src/api/service.ts               |  87 +++++-----
 src/contracts/custom-scenario.ts | 342 ++++++++++++++++++++++++++++++++++++++-
 src/runner/browser.ts            |  52 +++++-
 src/ui/snapshot.ts               |  68 ++++----
 5 files changed, 514 insertions(+), 72 deletions(-)
```

`git status --short` at finish: the 5 modified files above, plus untracked `tests/api/custom-scenario-r2-browser.test.ts`, `tests/contracts/custom-scenario-r2.test.ts`, `handoff/FIX-R2-01/` — and pre-existing untracked `coverage/` and `handoff/P022-FINAL-R2/` + `handoff/R2_COORDINATOR_STATE.md` (not mine). `runs/` untouched: all 7 files still dated 2026-11-11 16:53–17:32, none created by this task (my tests write no `runs/` files).

## 2. Fix design

### 2a. Structured parsing — why regex alone is insufficient

The R2 bypasses are all spelling variants the HTML parser accepts but a string denylist cannot enumerate:

- `<script/>` — the script regex required `[\s>]` after the tag name; a self-closing slash slipped through.
- `src=https://...` — the external-URL regex required a quote around the value.
- `<img src="x"onerror=...>` — the handler regex required whitespace before `on*`.
- `java&#115;cript:` — an entity-obfuscated scheme is invisible to a plain-text scan but decodes to `javascript:` in the parser.

Fix: `validateCustomHtmlSafety()` now runs **two layers** and dedupes reasons:

1. **Regex denylist (kept, unchanged)** — first pass / defence in depth. It also scans text the tokenizer deliberately skips (comments, CDATA, raw-text elements).
2. **Structured second pass `validateCustomHtmlStructure()`** — a dependency-free (~150-line) HTML tokenizer that sees what the browser's parser sees: tag names case-insensitively regardless of whitespace or a self-closing slash; attributes in double / single / no quotes (and no-space-after-quote); values after single-pass entity decoding (`&#115;`, `&#x73;`, `&colon;`, `&Tab;`, … — single pass, matching browser parsing). It rejects: any `<script>`/`<link>`/`<base>`/`<object>`/`<embed>` start tag in any nesting (incl. SVG/MathML foreign content); refresh `<meta>` by parsed `http-equiv`; `<iframe src=>`; `<iframe srcdoc>` recursed into (entity-decoded first, depth cap 3); any `on*` attribute; external URLs (`http://`, `https://`, `//`) on URL-bearing attributes incl. `srcset` candidates, in any quoting; `javascript:`/`vbscript:` URIs (whitespace/control-stripped after decoding) and `data:text/html` URIs on any attribute. Deliberate over-approximation: a `<script>` start tag is rejected wherever it appears (even inside `<template>`/`<noscript>`), because synthetic lab HTML never needs one.

No new dependency was added (the repo has only `playwright` + dev tools; no HTML parser is installed).

### 2b. Execution-layer defence — per-page CDP toggle, NOT a blanket context flag

**First design (tried, then abandoned — see §7):** `javaScriptEnabled: false` on the `launchBaselineBrowser` context. It blocks scripts and leaves sync CDP `page.evaluate` working — but it breaks frozen verification machinery (see §7).

**Final design:** `withPageJavaScriptDisabled(page, work)` in `src/runner/browser.ts` — CDP `Emulation.setScriptExecutionDisabled` on a session attached to **that page only**, held open for the duration of `work`, restored to `false` in a `finally` (then detached). Applied at exactly the three places user HTML reaches a page:

- `src/api/service.ts` — the whole custom `analyze` branch and the whole custom `search` branch (every `setContent`, mutation, resolution, BFS evaluation inside);
- `src/ui/snapshot.ts` — the whole `snapshotCustom` body.

Fixture runs never touch the toggle; the general runner context stays JavaScript-enabled. Proven properties (live probes, see §5): while the toggle is on, `<script/>` payloads do not execute, sync CDP evaluate and CSS/XPath/role locators still work; after it, page timers fire again; a second page in the same context is unaffected. One subtlety found by experiment: **the CDP session must stay attached** — sending the command then detaching immediately lets `<script/>` execute (`window.__pwned = 1`); with the session attached, `window.__pwned` stays `undefined`.

## 3. Why the blanket `javaScriptEnabled: false` was abandoned (design correction)

The task allowed the general-context flag "if it does not break frozen fixtures". It does break frozen **verification machinery** (not the fixtures — frozen fixtures contain zero `<script>` tags and the gate's 192 cases still passed):

- `scripts/s0-locator-oracle.mjs` (T001 baseline evidence producer) runs an offline probe inside `page.evaluate`: a 5 s in-page `setTimeout` race plus image load/error listeners. With page JavaScript disabled, **in-page `setTimeout` callbacks never fire and image load/error listeners never fire** (verified live with a probe script: `setTimeout` → TIMEOUT after 8 s; `img` error event → TIMEOUT; the verbatim oracle probe → TIMEOUT; sync evaluate and aborted-`fetch` still work). The probe's `page.evaluate` therefore hangs forever.
- Observed consequence: `npm run verify:all` hung >18 min on `test:oracle` (oracle script + Chromium alive, ~0 CPU, sleeping) and had to be killed (`page.evaluate: Target page, context or browser has been closed` on kill). `npm run test:oracle` was the discriminating check.
- After reverting the blanket flag, `npm run test:oracle` passes in ~27–33 s.

The per-page toggle avoids this completely: the oracle probe runs on its own browser instance, which never enters the toggle.

## 4. Regression tests — before / after

### `tests/contracts/custom-scenario-r2.test.ts` — 9 unit tests (validation only)

| Test | Before (regex-only code) | After |
|---|---|---|
| rejects the exact GPT `<script/>` probe and full payload | FAIL | PASS |
| rejects `<script>` in any form/case/whitespace (`<ScRiPt/>`, `<script\n>`, …) | FAIL | PASS |
| rejects script nested inside SVG / MathML | PASS (regex caught plain `<script>`) | PASS |
| rejects `<iframe srcdoc>` carrying a script (incl. `<script/>` inside) | FAIL | PASS |
| rejects external URLs in any quoting (unquoted, `//`, `formaction`, `srcset` quoted+unquoted) | FAIL | PASS |
| rejects event handlers in any quoting (unquoted, no-space-after-quote, `ONCLICK`) | FAIL | PASS |
| rejects `javascript:` URIs incl. entity-obfuscated (`java&#115;cript:`, `java&#x73;cript:`) | FAIL | PASS |
| rejects forbidden elements / refresh meta in any quoting | PASS | PASS |
| still accepts valid synthetic HTML (positive controls: safe `srcdoc`, safe `<svg>`, relative URLs, plain `<style>`, `data-x="https://…"`, text URLs, `value="onload"`, two-button form) | PASS | PASS |

Before run: **6 failed / 3 passed**; after: **9/9 passed**.

### `tests/api/custom-scenario-r2-browser.test.ts` — 10 live-Chromium tests

| Test | Before | After |
|---|---|---|
| validation rejects exact GPT payloads + unquoted URL | FAIL (`valid: true`) | PASS |
| execution layer: `<script/>` probe inside toggle does not execute (`__pwned` undefined) | FAIL (`__pwned` = 1) | PASS |
| execution layer: GPT full payload inside toggle does not strip `button.primary` class | FAIL (count 0) | PASS |
| execution layer: SVG script + srcdoc script inside toggle do not execute | FAIL (`__pwned` = 1) | PASS |
| toggle restores page JavaScript afterwards (timer fires) | n/a (new) | PASS |
| toggle is page-scoped (second page keeps timers while first is disabled) | n/a (new) | PASS |
| positive control: CSS analyze (STABLE / M03 MISSING / M04 AMBIGUOUS) | PASS | PASS |
| positive control: XPath + role locators resolve | PASS | PASS |
| positive control: search finds M03 witness at depth 1 | PASS | PASS |
| no toggle leak: timers fire + fixture F001 analyze STABLE after custom runs | n/a (new) | PASS |

Before/after for the final file was demonstrated by `git stash` of `src/` + `scripts/` (pre-fix code): **6 failed** (validation passes payloads; `TypeError: withPageJavaScriptDisabled is not a function` on the toggle tests); after `git stash pop`, **10/10 passed** (stash restored byte-identical — SHAs re-verified after pop). The earlier design's version of this file (7 tests, JS-disabled-context assumption) went 4 failed / 3 passed before its fix; it was rewritten for the toggle design.

Note on proof scope (stated plainly): the toggle mechanism is proven behaviorally at the helper level (payloads fed directly inside the toggle do not execute) plus restoration/no-leak tests; that the service/snapshotter route **all** custom page work through the helper is by construction (the three call sites wrap the whole custom branches) and is for the independent reviewer to confirm by reading — no valid scenario can distinguish it behaviorally, because validation already rejects every script before any browser work.

## 5. Live Chromium repro evidence (P1-01 payloads)

Exact GPT payloads (verbatim from `~/workspace/P022_R2_VERDICT.md`):

1. `<script/>window.__pwned=1</script>` → validation now rejects ("script elements are not allowed"); fed directly inside the toggle, `window.__pwned` stays `undefined` (pre-fix on a JS-enabled page it was `1`).
2. Full payload `<main><button class="primary">Save</button><script/>document.querySelector("button").classList.remove("primary")</script></main>` → validation rejects; fed directly inside the toggle, `button.primary` count stays `1` and class stays `"primary"` (pre-fix: count `0`, class stripped).
3. `<img src=https://example.invalid/a.png>` → validation rejects ("external URLs are not allowed") (pre-fix: passed validation).
4. SVG `<svg><script>window.__pwned=1</script></svg>` and srcdoc `<iframe srcdoc="<script>window.__pwned=1</script>">` fed directly inside the toggle → `__pwned` stays `undefined`, `button.primary` count `1`.

Positive control (same JS-disabled-during-custom-run conditions): CSS analyze baseline STABLE, M03 MISSING, M04 AMBIGUOUS; XPath baseline STABLE; role baseline STABLE with M08 MISSING; search depth-1 witness `[M03]` MISSING; mutations M01–M08 all run. All via the service's real code path, not a hand-rolled page.

## 6. Acceptance numbers (all run by the builder)

| Check | Result |
|---|---|
| `npm test` (full) | **609/609 passed, 48 files, 0 failures** (was 590/590; +19 new tests: 9 unit + 10 browser), 343 s |
| `npm run test:mutation` | **40/40 = 100.0%** (Killed 40, Survived 0) |
| `npm run test:oracle` | **PASS** (27 s standalone; also step 5/9 of verify:all, 32.8 s) — the check that caught the first-design hang |
| `npm run s0:gate` | **GATE PASS, gate_sha256 EXACTLY `651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52`** (exit 0; full log in `handoff/FIX-R2-01/GATE-RERUN2.log`). Replay 100/100, unique hash 1, P2A PASS, 192/192 cases, oracle parity 192/192 |
| `npm run verify:all` | **PASSED — all 9 steps green** (471.8 s): typecheck, typecheck:scripts, build, test (160.5 s), test:oracle (32.8 s), test:offline, test:stress, test:coverage (176.8 s), test:mutation (69.8 s) |
| `npm run verify:review-pack` | **FAILED — exactly 1 problem** (see below) |

### verify:review-pack — the one exception, explained

After restoring all evidence byproducts, the run reports exactly 1 problem:

```
sha256.txt: hash mismatch: scripts/verify-review-pack.mjs (not a known FIX delta)
```

The 4 source files **are accepted**: each note confirms `d26a3cc…:<path>` still matches the frozen hash — "accepted as the intentional FIX-R2-01 delta". The remaining problem is the verifier script itself: registering any delta requires editing its `KNOWN_FIX_DELTAS` map (the mechanism the script's own header documents for future FIX rounds: "Future FIX rounds add entries here"), and the script's own hash is recorded in `sha256.txt`. It cannot self-register: `checkKnownFixDelta` refuses it because the script's baseline pin (`d26a3cc`) no longer matches its recorded hash — the pack was regenerated at freeze #2 (935a3db), where the script already differed from d26a3cc (`git show d26a3cc:…` = `59f1c288…` vs recorded `bc602395…`; `935a3db`/`HEAD` = `bc602395…`). I tried the self-registration, watched the checker refuse it for exactly this reason, and reverted it. **This resolves at re-freeze (FIX-R2-03), when the pack is regenerated from the new tree and the map returns to `{}`** — the same pattern as the T013 deltas, which were baked into the d26a3cc tree at re-baseline. No check logic in the script was touched (map + comments only).

### Gate incident during acceptance (environmental, not a product defect)

The first `s0:gate` run failed at the replay stage (`REPEAT_HASH FAILED run=10`, exit code 1). Investigation showed it was **not** a hash mismatch: the 9 completed replays all hashed exactly `651c3fd4…`, the main stages all passed (192/192, parity 192/192, P2A PASS), and a direct single-analysis run reproduced `651c3fd4…`. Root cause: the 512 MB `/tmp` tmpfs hit **100% (ENOSPC: no space left on device)** — filled by concurrent Turnkeep/pytest work (four 64 MB `turnkeep-repro-r9-*` dirs + 238 MB `pytest-of-root`), not by this task. A re-run with `TMPDIR` redirected completed 100/100 replays but was killed by a VM/runtime restart before writing `S0_GATE.json`; the final clean re-run passed (see table). No other project's `/tmp` files were deleted. Lesson for the coordinator: the gate's 100-run replay is fragile against a full `/tmp`; consider a persistent `TMPDIR` for gate runs.

### Evidence byproducts — restored and re-verified

After every test/gate run, the byproducts were restored from git; frozen SHAs re-verified at finish:

| File | SHA prefix (expected → observed) |
|---|---|
| `evidence/s0/S0_GATE.json` | `15b5c2d5…` → `15b5c2d5b4f995ff` ✓ |
| `evidence/s4/T012_PERF.json` | `b1838d3f…` → `b1838d3ff1c0a20d` ✓ |
| `evidence/s4/T012_E2E_REQUESTS.json` | `497de20a…` → `497de20a8405aadf` ✓ |
| `evidence/s0/S0_P2A.log` | `2a76dec1…` → `2a76dec117c42ee2` ✓ |

(The passing gate's own `S0_GATE.json` output is byte-identical to the frozen file — deterministic canonical JSON, no timestamps — so the restore is a no-op for it.)

## 7. Design history (for the reviewer)

1. Implemented the parser fix + **blanket `javaScriptEnabled: false`** on the runner context. Unit tests 9/9, browser tests 7/7, full suite 606/606, mutation 40/40 — then `s0:gate` first failed on ENOSPC (§6) and, after the ENOSPC re-run passed the gate, `verify:all` hung on `test:oracle` (see §3). Root-caused to the blanket flag via a minimal probe (timers/img events never fire with page JS disabled; the verbatim oracle probe times out).
2. Reverted the blanket flag; introduced the per-page CDP toggle scoped to custom page work only; rewrote the browser tests for the toggle (10 tests). Re-ran everything: `test:oracle` 27 s, full suite 609/609, mutation 40/40, gate PASS with the exact frozen hash, verify:all 9/9.
3. `verify:review-pack`: registered the 4 source deltas per the script's documented mechanism; the script's own hash is the single remaining problem until re-freeze (see §6).

## 8. Open items / notes for the coordinator

- **FIX-R2-03 (re-freeze)** must regenerate the review pack from the new tree and reset `KNOWN_FIX_DELTAS` to `{}` (as was done at FIX-R1-04/04b); that clears the last `verify:review-pack` problem.
- The 28 P2s were not touched, per instructions. No broad refactoring was done; the only files changed are the ones listed in §1.
- `coverage/` is untracked test output (expected); `handoff/P022-FINAL-R2/` and `handoff/R2_COORDINATOR_STATE.md` pre-date this task.
- EPERM storage jitter was not observed to corrupt any write in this task (every write was verified by size + sha; the stash pop restored byte-identical files).
