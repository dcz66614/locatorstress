# FIX-R2-01 — Independent Review: close P022-R2-P1-01 (custom HTML script execution)

- Reviewer session: independent fresh session (not the builder `ac3c2ac2-612e-44e7-8801-45ebfcc17a66`)
- Date: 2026-11-12 (review work ~05:35–06:30 GMT)
- Commit under review: `406c6d2` (HEAD) — "P022 R2 rework FIX-R2-01"
- Frozen base: object `d26a3cc` (freeze commit `935a3db`); R2 verdict `~/workspace/P022_R2_VERDICT.md`; verification `~/workspace/p022-R2-verification-2026-11-12.md`
- Builder report: `handoff/FIX-R2-01/REPORT.md` (read in full)
- Acceptance log (this review): `handoff/FIX-R2-01/REVIEW-ACCEPTANCE.log` (build + npm test + mutation + s0:gate + verify:all + verify:review-pack, all re-run by the reviewer personally)
- Status: **FINAL_VERDICT: PASS — P0 0 / P1 0 / P2 4** (all P2s non-blocking, none in the P1-01 fix path)

## 1. What P1-01 was

GPT's R2 finding (verbatim payloads): `validateCustomHtmlSafety()` regex `/<script[\s>]/i` does not match `<script/>window.__pwned=1</script>`; the page then really executed it (`window.__pwned = 1` in Chromium); the same validation also accepted unquoted external URLs (`src=https://...`). Required fix: structured HTML parsing (not a regex denylist) + a browser execution-layer defence; regression tests for `<script/>`, SVG script, iframe srcdoc, unquoted URLs; locators/mutations must keep working.

## 2. The fix (as reviewed)

Two layers, both read in full by the reviewer:

1. **Validation layer** (`src/contracts/custom-scenario.ts`): the regex denylist is kept as a first pass; a new dependency-free tokenizer second pass (`validateCustomHtmlStructure`, ~150 lines) judges tags/attributes by parsed meaning — case-insensitive tag names regardless of whitespace or self-closing slash, attributes in double/single/no quotes, values after single-pass entity decoding. It rejects any `<script>`/`<link>`/`<base>`/`<object>`/`<embed>` start tag in any nesting, refresh `<meta>`, `<iframe src=>`, `<iframe srcdoc>` recursed into (entity-decoded first, depth cap 3), any `on*` attribute, external URLs on URL-bearing attributes incl. `srcset` candidates in any quoting, and `javascript:`/`vbscript:`/`data:text/html` URIs on any attribute.
2. **Execution layer** (`src/runner/browser.ts`): `withPageJavaScriptDisabled(page, work)` — CDP `Emulation.setScriptExecutionDisabled` on a session attached to that page only, held open for the whole of `work`, restored to `false` in a `finally`, then detached. The general runner context stays JavaScript-enabled (the blanket `javaScriptEnabled: false` was tried by the builder and abandoned because it stalls the T001 oracle probe's in-page timers/image events — the builder's reasoning is sound and the oracle check passes in this review's own runs).

## 3. Call-site coverage (reviewer's own code audit)

Every place user-supplied HTML reaches a page, verified by reading the code and grepping all `setContent` / `newPage` / `newContext` sites:

| Entry point | Covered? |
|---|---|
| `src/api/service.ts` — custom `analyze` branch (`prepareCustomRun` + `evaluateCustomSequence`, `setContent` at :342/:388) | YES — whole branch inside one `withPageJavaScriptDisabled` call (:548) |
| `src/api/service.ts` — custom `search` branch (`prepareCustomRun` + `createBrowserEvaluatorForCustom` + `runBoundedBfs`; evaluator `setContent` at `browser-evaluator.ts:144`) | YES — whole branch inside one toggle call (:594), same page, session held for the full BFS |
| `src/ui/snapshot.ts` — `snapshotCustom` (`setContent` at :174) | YES — whole body inside one toggle call (:167) |
| CLI `analyze` / `search` | YES — both go through `withBrowserService` → `service.analyze`/`service.search` (same toggle-covered code); no direct `setContent` in the CLI |
| Fixture paths (`fixture-loader.setFixtureContent`, fixture BFS evaluator) | N/A — frozen HTML only, never touch the toggle |
| Export paths (`/api/export`, `/ui/export-html`, CLI `export`) | N/A — pure string generation, no page load (grep confirms no `setContent`/`evaluate` in `src/export/`) |
| `src/ui/server.ts:289` snapshot page | Covered — it is the snapshotter's dedicated page; `snapshotCustom` wraps its work in the toggle on that page |

Concurrency: both the service and the snapshotter serialise all browser work through a single promise-chain mutex on their page, so no concurrent request can interleave a fixture run inside a custom toggle window. No nested toggle calls on the same page exist. The `finally` restoration means a throwing run cannot leave a page disabled (proven by the timer-restoration test, re-run below).

Diff audit: `src/api/service.ts` and `src/ui/snapshot.ts` diffs are pure re-indentation from wrapping in the toggle + the import (verified by reading the diffs line by line — no logic changes). `scripts/verify-review-pack.mjs` diff is the `KNOWN_FIX_DELTAS` map + comment only — no check logic touched. `src/runner/browser.ts` adds only `withPageJavaScriptDisabled` + its doc comment.

## 4. Adversarial validation probes (reviewer's own, 46 cases + 7 follow-ups)

Run by the reviewer against the freshly rebuilt `dist/` (`node`, no browser). Full probe script was written for this review; results:

- **43/46 as expected on first run.** The 3 apparent misses were investigated individually:
  - `ht&#116;tp://evil.com/x.png` — MY probe was malformed (`ht` + entity-`t` + `tp` decodes to `htttp://`, not `http://` — correctly not an external URL). Re-probed with the correctly formed `h&#116;tp://evil.com/x.png`, `&#104;ttps://…`, `/&#47;evil.com/…` — **all rejected**. The validator is right; the probe was wrong.
  - `ht\ttp://…` / `ht\ntp://…` (tab/newline INSIDE the scheme) — **real validation gap, P2** (see P2-R2-01-1). The WHATWG URL parser strips tab/LF anywhere in a URL, so the browser would treat it as `http://…`; the page route handler is the backstop (proven live in §5).
  - `u&#114;l(https://…)` inside a `style` attribute — **real validation gap, P2** (see P2-R2-01-2). The `url\s*\(` regex misses the entity-obfuscated spelling and the tokenizer does not inspect style values. CSS `url()` cannot execute script; the fetch is blocked by the route handler.
- **All GPT payloads rejected**: exact `<script/>` probe, full payload, unquoted external URL; plus case/whitespace variants (`<ScRiPt/>`, `<script\n>`, `<script\t>`), SVG/MathML scripts, `srcdoc` scripts (quoted, entity-encoded, nested depth 2), no-space/unquoted event handlers, entity-obfuscated `javascript:` (decimal, hex, `&Tab;`, mixed case, leading space/control char), `formaction` javascript:, `srcset` external candidates (first and second), refresh meta (both quotings), `<link>`/`<base>`/`<object>`/`<embed>`, `<iframe src=>`, `data:text/html`, `vbscript:`, `ontoggle`, `xlink:href` javascript:, annotation-xml scripts, external script `src`.
- **11/11 positive controls accepted** (no false positives): safe two-button HTML, relative/fragment URLs, `data-x="https://…"` (not a URL-bearing attribute), safe SVG, plain `<style>`, URL in text, `value="onload"`, safe `srcdoc`, escaped markup text.

Conclusion on the validation layer: every script-execution spelling the reviewer could construct is rejected; the two residual gaps can only cause an external *fetch* attempt (never script execution) and are blocked at the network layer.

## 5. Live Chromium repro (reviewer's own, via the real service + raw browser)

Script written for this review, run against built `dist/` + project Playwright (14 checks):

| # | Check | Result |
|---|---|---|
| 0a | Control: GPT probe WITHOUT toggle executes (`__pwned=1`) | PASS — harness can detect execution |
| 0b | Control: GPT payload WITHOUT toggle strips `button.primary` (count 0) | PASS — harness can detect execution |
| 1 | `service.validate` rejects GPT probe | PASS |
| 2 | `service.validate` rejects GPT full payload | PASS |
| 3 | `service.validate` rejects unquoted external URL | PASS |
| 4 | `service.analyze` rejects GPT payload with HTTP 400 (never reaches a page) | PASS |
| 5 | Toggle, direct feed (validation bypassed): GPT probe does not execute (`__pwned` undefined) | PASS |
| 6 | Toggle, direct feed: GPT payload keeps `button.primary` (count 1, class `primary`) | PASS |
| 7 | Toggle + SUBFRAME: `srcdoc` script trying `parent.__iframePwned=1` does not execute | PASS — **stronger than the builder's own test**, which only checked the top window (a subframe script would never touch it); this probe uses a parent-visible marker |
| 8 | Control: same `srcdoc` payload WITHOUT toggle DOES set the parent marker (=1) | PASS — proves check 7 can detect subframe execution |
| 9 | Positive: safe custom scenario via `service.analyze` → baseline STABLE | PASS |
| 10 | Positive: same scenario M03 MISSING | PASS |
| 11 | Positive: `service.search` finds M03 witness at depth 1 | PASS |
| 12 | Tab-in-scheme img (passes validation): fetch attempted and aborted by route handler (external=1, blocked=1) | PASS — network-layer mitigation for P2-R2-01-1 proven live |
| 13 | Timer fires after toggle (oracle-probe shape) | PASS |

One probe-script bug of the reviewer's own (check 0 asserted `__pwned` on the full payload, which never sets it) was caught, corrected, and re-run as controls 0a/0b above — both pass. All 14 live checks pass.

## 6. Acceptance numbers (all run by the reviewer personally on commit 406c6d2)

| Check | Reviewer's result |
|---|---|
| `npm run build` | exit 0 |
| `npm test` (full) | **609/609 passed, 48 files, 0 failures** (413 s; re-run after a VM restart killed the first chain mid-gate — see §7) |
| `npm run test:mutation` | **40/40 = 100.0%** (Killed 40, Survived 0) |
| `npm run s0:gate` | **GATE PASS, gate_sha256 EXACTLY `651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52`** (100/100 replays, 1 unique hash; exit 0) |
| `npm run verify:all` | **PASSED — all 9 steps green** (555.5 s; exit 0) |
| `npm run verify:review-pack` | **FAILED — exactly 1 problem** (see §8, known exception, not a defect) |
| Frozen evidence SHAs after all runs (restored from git) | `S0_GATE.json 15b5c2d5…`, `T012_PERF.json b1838d3f…`, `T012_E2E_REQUESTS.json 497de20a…`, `S0_P2A.log 2a76dec1…` — all match frozen values |

## 7. Environment incident during this review (not a product defect)

A VM restart (the ~05:49 restart) killed the reviewer's first acceptance chain mid-`s0:gate` (repeat run ~018/100) and wiped `/tmp` (including the reviewer's probe scripts, which were recreated). Evidence was left in the gate's half state (`S0_GATE.json`/`S0_GATE.log` deleted, `S0_P2A.log` rewritten). The reviewer restored evidence from git (`git checkout -- evidence/`), re-ran the full chain from scratch, and re-created the live-repro script. The numbers in §6 are all from the completed second run (plus the first run's `npm test` exit 0 and `test:mutation` 40/40, which had already finished before the restart). The gate's 100-run replay is slow on this VM (~13 s/run, ~22 min) — noted for the coordinator, not a defect.

## 8. Known exception: `verify:review-pack` reports exactly 1 problem

```
verify:review-pack FAILED (1 problem(s)):
  - sha256.txt: hash mismatch: scripts/verify-review-pack.mjs (not a known FIX delta)
```

Verified by the reviewer: the four source-file deltas are all accepted, each with its frozen baseline (`d26a3cc…:<path>`) proved intact by the checker itself. The remaining problem is the verifier script's own hash: registering a delta requires editing the script's `KNOWN_FIX_DELTAS` map, and the script's own hash is recorded in `sha256.txt`; the checker refuses self-registration because the script's baseline pin (`d26a3cc`) no longer matches its recorded hash (the pack was regenerated at freeze #2, `935a3db`). This is the documented cost of the mechanism, identical in kind to the T013 deltas pattern, and it clears when FIX-R2-03 regenerates the pack from the new frozen tree and resets the map to `{}`. **Not a product defect, not a P1/P2 — recorded here as a known exception for the re-freeze step.**

## 9. Findings

### P0 — 0

### P1 — 0

P022-R2-P1-01 is closed: both GPT reproduction paths (script execution via `<script/>`, unquoted external URL) are rejected at validation AND cannot execute even if fed directly to a page (toggle), with the subframe case proven by a parent-visible marker. No script-execution vector was found in the reviewer's adversarial probing.

### P2 — 4 (all non-blocking)

- **P2-R2-01-1 — Tab/newline inside an external-URL scheme passes validation.** `isExternalUrlValue()` strips only *leading* whitespace; the WHATWG URL parser strips tab/LF anywhere, so `ht\ttp://evil.com/x.png` would be fetched as `http://…`. Impact: an external *fetch* attempt only — cannot execute script; the page route handler aborted it live in this review (external=1, blocked=1). Fix (FIX-R2-02 or R2-03, optional): strip `[\u0000-\u0020]` throughout the value in `isExternalUrlValue`, as `scriptUriKind` already does. No test covers it today.
- **P2-R2-01-2 — Entity-obfuscated `url(` inside a `style` attribute passes validation.** `u&#114;l(https://…)` misses the `url\s*\(` regex and the tokenizer does not inspect `style` values. Impact: a CSS `url(https://…)` fetch attempt only — CSS `url(javascript:)` does not execute in modern browsers, and the route handler blocks the fetch. Fix (optional): decode entities before the `url(` regex, or tokenize `style` values for `url(`. No test covers it today.
- **P2-R2-01-3 — Builder's srcdoc browser test asserts on the wrong window.** `tests/api/custom-scenario-r2-browser.test.ts` ("SVG-embedded script and srcdoc script inside the toggle do not execute") checks `window.__pwned` on the TOP window after loading a `srcdoc` iframe script — a subframe script would set `__pwned` on its own window, so that assertion cannot detect subframe execution. The product behaviour is correct (this review's parent-marker probe proves the toggle blocks subframe scripts), but the test is weaker than its name claims. Fix (optional, test-only): assert on a parent-visible marker (`parent.__iframePwned`) as this review did.
- **P2-R2-01-4 — Stale comment.** `tests/contracts/custom-scenario-r2.test.ts` header still describes the execution layer as "javaScriptEnabled:false + live Chromium repro"; the actual mechanism is the per-page CDP toggle. Cosmetic; fix by rewording the comment.

### Carried (not defects)

- The 28 R2 P2s were not touched, per instructions.
- `verify:review-pack`'s 1 remaining problem (the script's own hash) — see §8; clears at FIX-R2-03 re-freeze.

## 10. Final verdict

**FINAL_VERDICT: PASS**

```
PROJECT_ID: P022
PROJECT_NAME: LocatorStress
REVIEW_ROUND: FIX-R2-01 independent review
REVIEWED_COMMIT: 406c6d2
FROZEN_BASE: d26a3cc (freeze 935a3db)

P0: 0
P1: 0
P2: 4 (all non-blocking; listed in §9)

ACCEPTANCE_EVIDENCE (reviewer personally re-ran):
  1. npm test 609/609 (48 files), exit 0.
  2. test:mutation 40/40 = 100.0%.
  3. s0:gate GATE PASS, gate_sha256 exactly
     651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52
     (100/100 replays, 1 unique hash).
  4. verify:all PASSED, all 9 steps green.
  5. verify:review-pack exactly 1 problem (the verifier script's own
     hash — documented, clears at re-freeze).
  6. 46 + 7 adversarial validation probes: all script-execution
     spellings rejected; 11/11 positive controls accepted.
  7. 14 live Chromium checks: both GPT payloads rejected by the API
     (400) and non-executing inside the toggle (top-level and
     subframe); safe custom analyze/search work end to end.
  8. All user-HTML page entry points audited in code and covered by
     the toggle; fixture paths untouched; frozen evidence SHAs match
     after all runs.

BLOCKERS: NONE.
```

FIX-R2-01 may proceed to FIX-R2-02 (Run Store fingerprint + ID isolation) and then FIX-R2-03 (re-freeze + new bundle + R3 message). The four P2s above are non-blocking and may be carried into the R2 P2 register or fixed opportunistically in a later round; none of them gates R3.
