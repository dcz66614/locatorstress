# FIX-R1-02 — Independent review (fresh session)

- Reviewer: independent reviewer, fresh session (not the builder).
- Work dir: `~/workspace/p022-locatorstress/` (git local, no remote). HEAD `f691edd`.
- Date: 2026-11-11 (review ~15:05–16:05 GMT).
- Builder report reviewed: `handoff/FIX-R1-02/REPORT.md`.
- Verdict basis: R1 verdict `~/workspace/P022_R1_VERDICT.md` §五 FIX-R1-02,
  `~/workspace/p022-R1-verification-2026-11-11.md`,
  spec `~/workspace/P022_PROJECT_BOOK.md` §7.3 + FR12.

## FINAL_VERDICT: PASS

**P0 × 0 · P1 × 0 · P2 × 1** (P2-1 below is non-blocking polish; it does not
gate the commit.)

P1-02 ("HTML report generator exists, but the formal Web UI/API does not
support HTML export") is closed. Every claim in the builder's report that
I could re-check was reproduced independently: the API serves a full report
as HTML 200, the UI button downloads HTML for fixture runs and custom runs,
the HTML is offline-openable with zero external resources, JSON/HTML are
semantically identical, all 7 XSS vectors pass through the API path,
FIX-R1-01 is intact, the full suite is 560/560, and `s0:gate` is a fresh
GATE PASS with all four hashes exactly unchanged.

## 1. What was reviewed (read-only except tests + live-demo servers)

Changed files (uncommitted working tree; `git diff --stat`: 11 files
+260/−36, plus 3 new files):

| File | Review |
|---|---|
| `src/api/routes.ts` | HTML branch 501 → 200 via `exportReportHtml()` (lines 163–180); validation runs first, same as JSON; unknown format still 400 |
| `src/api/server.ts` | `rawBody` sent with route content type (lines 121–126); `headersSent` guard untouched |
| `src/export/ui-report-html.ts` (NEW) | Page-level renderer reusing the T010 shell; all values through `escapeHtml()`; self-scan throws on any external ref (lines 266–271) |
| `src/ui/server.ts` | `POST /ui/export-html` (lines 462–492); malformed payload → 400 |
| `src/ui/index.html` | `#download-html` button (line 202); 501 hint replaced with honest scope note |
| `src/ui/app.js` | Shared `buildPageExportPayload()` (line 1058); `#download-html` handler (lines 1092–1111); `apiText()` (line 143) |
| `package.json` | Only addition: `test:export:api` script |
| `tests/export/html-api.test.ts` (NEW) | 5 tests, incl. real T008 report + 7 XSS vectors through the API |
| `tests/export/ui-report-html.test.ts` (NEW) | 5 tests, incl. custom-run payload + XSS in note/witness |
| `tests/api/routes.test.ts`, `tests/e2e/offline.test.ts`, `tests/e2e/custom-input.test.ts`, `tests/ui/ui-flow.test.ts` | Old 501 assertions replaced by 200 assertions with content checks (strengthened, not weakened — verified in the diff) |

NOT touched (confirmed by diff): frozen modules (`runner/`, `mutations/`,
`canonical/`, `fixtures/`, `score/`, `oracle/identity-compare.ts`,
`oracle/target-capture.ts`), S0 gate scripts, golden files, CLI (FIX-R1-03),
any of the 23 P2s. The `handoff/R1_COORDINATOR_STATE.md` modification is
the coordinator's own status line (claims a prior verification), not
builder code; it does not affect this review.

## 2. Commands run (all by the reviewer, sequential, exit codes read directly)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npm run build` | 0 | clean |
| 2 | `npm run test:export:api` | 0 | 2 files, **10 passed** (html-api 5 + ui-report-html 5) |
| 3 | `npm run test:export` | 0 | 2 files, **11 passed** (html-export 8 + html-safety 3) |
| 4 | `npm run test:html-safety` | 0 | 1 file, **3 passed** — all 7 XSS vectors |
| 5 | `npm run test:api` | 0 | 7 files, **84 passed** |
| 6 | `npm run test:e2e:custom` | 0 | 1 file, **6 passed** (real Chromium; incl. custom HTML download: filename `P022-CUSTOM-001-analysis.html`, contents + embedded JSON == JSON download) |
| 7 | `npm run test:ui` | 0 | 1 file, **12 passed** (real Chromium; incl. fixture HTML download `F002-analysis.html`, `WRONG_TARGET`, `37.5`, witness FOUND) |
| 8 | `npm run test:offline` | 0 | 1 file, **6 passed** (incl. live-proxy `/api/export` HTML 200 + 422) |
| 9 | `npm test` (full suite) | 0 | **45 files, 560 passed** (300.59 s) |
| 10 | `npm run s0:gate` (attempt 1) | 1 | **Environment kill, not a product failure** — see §6. Got through all deterministic stages (baseline 24/24, mutations 24×8, oracle-parity, controls, coverage, stability, offline-runtime, hashes, P2A PASS) and replay progress 70/100, all with gate hash `651c3fd4…` |
| 11 | `npm run s0:gate` (attempts 2–3) + `node scripts/s0-gate.ts --single-analysis` | 1 | Died at `stage offline-scan` — Chromium itself was crashing (see §6) |
| 12 | Chromium probes (direct binary + Playwright) | 1 | Both Chromium builds dying on launch (SIGTRAP/SIGILL, zygote broken pipe) — environment breakage, transient |
| 13 | Chromium probe after recovery | 0 | `LAUNCH_OK 2394ms version=158.0.8127.18`, `PAGE_OK hi`, `CLOSE_OK` |
| 14 | `npm run s0:gate` (attempt 4) | 0 | **GATE PASS** — see §5 |

No test was run concurrently with another test. `dist/` was rebuilt by
`npm run build` / the test scripts as usual (tracked-tree status unchanged
afterwards except the FIX-R1-02 files).

## 3. Live demo (reviewer's own script, real UI server `http://127.0.0.1:41871`)

Server: `node dist/ui/server.js --port 41871`, killed after the run.
No port left listening afterwards.

**Fixture run — `POST /api/export` with the real
`evidence/s2/T008_API_REPORT.json` (192 real fixture-run cases):**

```
FIXTURE_EXPORT_HTML 200 text/html; charset=utf-8 bytes 308017
  doctype true | gate_hash true | analysis_hash true
  scenario_hash true | oracle_hash true
  has_71.875 true | has_WRONG_TARGET true | has_FOUND true
  ext_refs []
FIXTURE_EXPORT_JSON 200 application/json
  embedded JSON == report file: true (deep-equal, all 23 top-level keys)
  embedded JSON vs JSON-export string: identical except a trailing "\n"
  (exportReportJson appends one newline; parsed content is identical)
```

Byte count 308,017 matches the builder's demo exactly. The HTML embeds the
full canonical JSON (script `application/json` block + escaped `<pre>`),
so verdicts, scores, witness and all four hashes are the same as the JSON
export — verified by parsing, not just by substring checks.

**Custom run — real `POST /api/analyze` + `POST /api/search` on the
`P022-CUSTOM-001` demo scenario, then `POST /ui/export-html`:**

```
CUSTOM_ANALYZE 200 source custom baseline STABLE M03 MISSING M04 AMBIGUOUS M07 AMBIGUOUS
CUSTOM_SEARCH 200 status FOUND seq ["M03"]
CUSTOM_UI_EXPORT_HTML 200 text/html; charset=utf-8 bytes 24170
  doctype true | has_id true | has_MISSING true | has_AMBIGUOUS true
  has_62.5 true | ext_refs [] | embedded JSON == payload: true
```

(The builder's custom HTML was 23,522 bytes; mine is 24,170 because my
payload carries the full live `/ui/scores` + search response objects.
Content checks are identical; byte equality across different payload
compositions is not a requirement.)

**UI page:** `GET /` 200, contains `id="download-html"`.

**Error paths (all honest, no crash):**

```
CUSTOM_SHAPED_EXPORT_HTML (T008 report with cases[0].controlGroup="custom",
  expectedVerdict=null) -> 422 application/json
  {"code":"INVALID_REPORT","message":"report failed validation:
   cases[0]: expectedVerdict must be a four-state verdict"}
UI_EXPORT_HTML_BAD_PAYLOAD ({schema:"bogus"}) -> 400 BAD_REQUEST
EXPORT_UNKNOWN_FORMAT (format "xml") -> 400 BAD_REQUEST
```

## 4. The builder's one judgement call — ACCEPTED (not a gap)

**Call:** custom runs export as HTML through the UI page-level endpoint
(`POST /ui/export-html`), while `/api/export` stays full-report-only,
because `ReportCase` requires `controlGroup: "stable" | "fragile"` and a
non-null `expectedVerdict`, and faking a golden verdict would be fabrication.

**Independent check of the contract evidence:**

- `src/contracts/report.ts:54` — `controlGroup: "stable" | "fragile"`.
- `src/contracts/report.ts:60` — `expectedVerdict: Verdict` (non-null).
- `src/contracts/report.ts:286-289` (validator) — `expectedVerdict` must be
  a four-state verdict string; `null` is rejected.
- Live proof (§3): a custom-shaped report through `/api/export` format=html
  returns **422 `INVALID_REPORT`** naming exactly that violation — an
  honest rejection, not a crash, not a fabricated report, not a silent
  wrong output.

**Why this satisfies GPT's requirement rather than violating it:**

1. GPT requires "对当前分析结果可从 UI 和 API 导出离线 HTML" +
   "完整报告 JSON/HTML 语义一致". Every analysis result the product can
   produce now has an HTML export path: a full 24-fixture report through
   `POST /api/export` format=html, and the current analysis (fixture or
   custom) through the UI button + `POST /ui/export-html`. `/ui/export-html`
   is itself a server API endpoint (JSON in, `text/html` out); the
   UI/API split is by artifact (current analysis vs full report), not by
   "custom runs get no HTML".
2. There is no "完整报告" for a single custom run under the frozen
   contract — a full `AnalysisReport` is defined over golden fixtures with
   control groups and expected verdicts. Forcing one through would require
   inventing golden data, which would be fabrication and would corrupt the
   S0 hashes if it ever leaked into a report. The honest 422 is the
   correct behaviour.
3. The scope is stated honestly in three places: the HTML document itself
   ("page-level export … not a T008 full AnalysisReport"), the UI hint
   (`src/ui/index.html:203`), and `src/export/ui-report-html.ts:27-31`.
4. JSON/HTML semantic consistency holds on **both** paths by the same
   mechanism (one canonical JSON string embedded in the HTML, equal to
   the JSON export): verified for the full report (§3, embedded ==
   report file) and for the custom page payload (§3, embedded == payload).

**Therefore: no P1.** The judgement call is the correct engineering
decision, and the only follow-up is the non-blocking P2-1 below.

## 5. S0 gate — fresh GATE PASS (attempt 4), all four hashes exact

Attempt 4 (after Chromium recovered): exit 0, 876 s.

```
GATE PASS failure_type=null gate_sha256=651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52
REPEAT_HASH progress runs=100/100 unique_gate_hashes=1 gate_sha256=651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52
REPEAT_HASH unique_gate_hashes=1 gate_sha256=651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52
```

Fresh `evidence/s0/S0_GATE.json` (regenerated by this run; sha256
`15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d`,
byte-identical to the frozen file):

| Hash | Fresh gate run | Frozen / R1-verdict value | Match |
|---|---|---|---|
| scenario_sha256 | `1ffb5f85561c6dd9f10fc15773097691c5c07fe20c6e9a001e231a41b61c9f22` | same | ✅ |
| oracle_result_sha256 | `3502d81fa730605ddd8548e39af6b7272015c026e65f91a2dae132c3e345a988` | same | ✅ |
| analysis_sha256 | `4410d5c85cf5fe8ee858c4e01822cdbc1515c39afa7ba40d833aceb00a9576a4` | same | ✅ |
| gate_sha256 | `651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52` | same | ✅ |

Counts from the fresh gate: baseline 24/24, cases 192/192 completed,
oracle parity 192/192, verdicts 138 STABLE / 22 WRONG_TARGET / 17
AMBIGUOUS / 15 MISSING, score `71.875`, external requests 0, replay
100 runs / 1 unique hash, `matchesMainGateHash: true`. No per-field
diff exists to report.

## 6. Gate attempts 1–3 failed on the environment, not the product (recorded honestly)

- Attempt 1 (~15:19–15:30 GMT): completed every deterministic stage
  (baseline 24/24, all 24 fixtures × 8 mutations, oracle-parity,
  controls, coverage, stability, offline-runtime, hashes, P2A PASS),
  then died during replay at 70/100 progress. All 7 progress lines
  showed the same gate hash `651c3fd4…` with 1 unique hash. No error
  line; the process was killed silently and `S0_REPEAT_HASH.json` was
  left truncated to 0 bytes.
- Attempts 2–3 + a `--single-analysis` run (~15:32–15:36): died in
  ~1–5 s right after `stage offline-scan`, exit 1, no `Fatal:` line.
- Diagnosis (reviewer's probes, not the builder's): Chromium itself was
  broken on this VM at that time. `chromium.launch()` succeeded but the
  browser process died instantly (`newPage`: "browser has been closed");
  direct binary runs exited 132 (SIGILL, chromium-1254) and 133
  (SIGTRAP, chromium-1248); crashpad stderr showed
  `Operation not permitted (1)` / `WriteEverything failed` and a
  zygote `write: Broken pipe`. Both cached Chromium builds were
  affected; the breakage started after ~15:30, about an hour after the
  same binaries had run the full test suite cleanly.
- Recovery (~15:47): a fresh probe passed (`LAUNCH_OK`, `PAGE_OK`,
  `CLOSE_OK`), and gate attempt 4 then passed in full (§5).
- Why this is not a product defect: the failing code path
  (`launchBaselineBrowser` → `chromium.launch` → `newPage`) contains
  none of the FIX-R1-02 code; the crash is inside the Chromium binary,
  below the product; and the same gate passed on this exact tree once
  the environment recovered. Per the task instructions, EPERM/storage
  jitter is never treated as a product defect — and neither is a
  transient Chromium SIGTRAP/SIGILL. The 0-byte truncations
  (`S0_REPEAT_HASH.json`, `S0_GATE.json`) were restored from git (see §8).

## 7. Findings

### P0 — none.

### P1 — none.

### P2 — 1 (non-blocking)

- **P2-1 — `/api/export` 422 message does not point custom-run callers
  at the working path.** A caller that posts a custom-shaped report gets
  `cases[0]: expectedVerdict must be a four-state verdict` (accurate,
  honest), but nothing tells them the custom run is exportable as HTML
  through `POST /ui/export-html`. Suggested polish (optional, not
  required before R2): append a hint to that validation error, e.g.
  "custom runs export as HTML via POST /ui/export-html". No code change
  required for the commit; the UI and the HTML document already state
  the scope.

### Checks that passed with no finding

- JSON/HTML consistency on both export paths (parsed-JSON equality, §3).
- Offline: `scanExternalResources()` returns `[]` on both HTML outputs;
  no `https://`, no `<link`, no `src=`, no `url(`, no `@import`
  (reviewer's own scan of the live-demo outputs).
- XSS: all 7 vectors inert through the API path (new test) and through
  the page renderer (note + witness `meaning`); single `</script>`;
  round-trip intact. `test:html-safety` 3/3 and `test:export:api` 10/10
  re-run by the reviewer.
- FIX-R1-01 intact: real custom analyze/search in the live demo
  (STABLE baseline, M03 MISSING, M04/M07 AMBIGUOUS, witness `[M03]`);
  `test:e2e:custom` 6/6; full suite 560/560.
- The two pre-existing tests that encoded the old 501 behaviour were
  updated to assert the fixed behaviour with content checks, not deleted
  or weakened.

## 8. Evidence hygiene

- Test-run byproducts restored from git after the runs (with retry loop;
  sha verified after restore): `evidence/s0/S0_P2A.log` (sha256
  `2a76dec117c42ee2e5bfcf44b452407222658b3665c39dc47f0e21c957e06a5d`,
  same as HEAD; diff was timings only),
  `evidence/s3/screenshots/matrix-F002.png`,
  `evidence/s4/T012_CUSTOM_E2E_REQUESTS.json`,
  `evidence/s4/T012_E2E_REQUESTS.json`,
  `evidence/s4/T012_PERF.json`. `git status evidence/` is clean.
- `evidence/s0/S0_GATE.json` / `S0_GATE.log` / `S0_REPEAT_HASH.json` /
  `S0_REPEAT_HASH.log` were truncated to 0 bytes by the environment
  kills in gate attempts 1–3; restored from git mid-review, then
  regenerated byte-identically by gate attempt 4 (S0_GATE.json sha
  `15b5c2d5…`, unchanged from frozen).
- Pre-existing untracked items left untouched: `coverage/`,
  `handoff/P022-FINAL-R1/`.
- No EPERM failure was treated as a product defect. No source or test
  file was modified by the reviewer; no commit, no push.
- Reviewer scratch files in `/tmp` (`r102-*.log`, demo script/outputs)
  were lost to a `/tmp` cleanup during the review; all numbers above
  are transcribed from the live tool outputs in this session, and the
  durable evidence (fresh `evidence/s0/S0_GATE.json`, the test suite,
  the demo's recorded outputs) survives in the repo and in this report.
  The live-demo server on port 41871 was killed; nothing is listening.

## 9. Recommendation to the coordinator

Commit FIX-R1-02. P1-02 is closed with P0 0 / P1 0. The one P2 is
optional polish for later (or for FIX-R1-04 to consider); it does not
block R2. For FIX-R1-04 (re-freeze): new files to include are
`src/export/ui-report-html.ts`, `tests/export/html-api.test.ts`,
`tests/export/ui-report-html.test.ts`, plus the `test:export:api`
script in `package.json`. For R2: the custom-run API question is
answered in §4 — `/api/export` stays full-report-only by the frozen
`ReportCase` contract, `/ui/export-html` is the HTML path for custom
runs, and the 422 for a custom-shaped full report is honest and
precise. Note for the re-freeze run: Chromium on this VM was
transiently broken ~15:30–15:45 GMT (SIGTRAP/SIGILL on launch) and
recovered on its own; if the re-freeze gate dies the same way, re-probe
Chromium and retry rather than treating it as a product failure.
