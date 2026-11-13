# FIX-R1-02 — HTML export wired into the API + Web UI

- Task: P022-R1-P1-02 — "HTML report generator exists, but the formal Web UI/API does not support HTML export."
- Work dir: `~/workspace/p022-locatorstress/` (git local, no remote). HEAD at start: `f691edd` (FIX-R1-01 committed).
- Status: **DONE, not committed** (coordinator commits). No push, no commit by this session.
- Date: 2026-11-11 (work ~14:12–14:45 GMT).

## What was built

`exportReportHtml()` (T010) is now reachable through the two user-facing paths, instead of only from tests:

### 1. API: `POST /api/export` format=html → HTTP 200 `text/html`

- `src/api/routes.ts`: the `format === "html"` branch no longer returns 501 `HTML_EXPORT_NOT_IMPLEMENTED`. It runs the **same** `validateExportedReport()` as the JSON path (422 `INVALID_REPORT` on a bad report), then `exportReportHtml(report)`. `RouteResult` gained optional `contentType` / `rawBody` fields: the HTTP layer sends the raw HTML document with `text/html; charset=utf-8`, while `body` still carries `{ format: "html", hashes }` so direct `handleApiRequest` callers can assert hashes without parsing HTML.
- `src/api/server.ts`: if `result.rawBody` is set, it is sent with the route's content type instead of `canonicalJson(result.body)`. The `headersSent` guard is unchanged.
- Unknown formats are still 400 (message updated to `expected "json" or "html"`).
- JSON/HTML consistency holds **by construction**: the HTML embeds exactly the canonical JSON the JSON export writes (same `canonicalJson(report)` string, script block + escaped `<pre>` copy), so verdicts, scores, witness and hashes are identical in both formats. Verified by test, not just by construction (see below).

### 2. UI: "下载本次分析 HTML" button for the current analysis

- `src/ui/index.html`: new `#download-html` button next to `#download-json`; the stale hint ("HTML 格式目前返回 501") is replaced with an honest scope note (page-level export, not the T008 full report; the full report goes through `POST /api/export` format=html).
- `src/ui/app.js`: new `buildPageExportPayload()` shared by both download handlers (same payload → same analysis in both formats), plus a `#download-html` handler that POSTs the payload to `/ui/export-html` and blob-downloads `<fixtureId>-analysis.html`. New `apiText()` helper for text responses (error JSON is still recovered for the message). Works for fixture runs and custom runs alike.
- `src/ui/server.ts`: new `POST /ui/export-html` endpoint (UI-owned, like `/ui/scores`): renders the page-level payload via `exportPageReportHtml()` and returns `text/html; charset=utf-8`; a malformed payload is 400.
- `src/export/ui-report-html.ts` (NEW, 273 lines): renders the page-level payload (`locatorstress.ui-fixture-export/v1`: one fixture/custom analysis + optional witness + server-side scores + controls) as a standalone offline HTML document. It **reuses the T010 document shell** (`renderReportHtml`: doctype, inline `<style>` only, one non-executable `application/json` script block, CSP `default-src 'none'`), so the offline/XSS guarantees are the same as the full-report exporter: every value through `escapeHtml()`, the full canonical JSON embedded twice, and a `scanExternalResources()` self-check that throws on any hit. It computes nothing (no verdict/score/witness) — it only renders what the backend already produced. It states its scope in the document: page-level export, not a T008 full AnalysisReport; no full-report hashes (those stay in the UI Report view via `GET /ui/reports`).

### Why custom runs export via the UI endpoint, not `/api/export`

A single custom run **cannot** be a full `AnalysisReport`: `ReportCase` requires `controlGroup: "stable" | "fragile"` and a non-null `expectedVerdict`, while custom cases carry `controlGroup: "custom"` and `expectedVerdict: null`. Setting a fake golden verdict to force it through would be fabrication, so FIX-R1-02 does not do that. Instead the UI page-level export is the HTML path for custom runs (requirement 5), and `/api/export` format=html is the HTML path for full reports. Both are covered by tests and by the live demo below.

## Files changed (git diff --stat: 10 files, +259/−35; plus 3 new files)

| File | Change |
|---|---|
| `src/api/routes.ts` | HTML branch: 501 → 200 `text/html` via `exportReportHtml()`; `RouteResult` gains `contentType`/`rawBody`; header comment updated |
| `src/api/server.ts` | Sends `rawBody` with the route's content type when present |
| `src/export/ui-report-html.ts` (NEW) | Page-level HTML renderer (`exportPageReportHtml`, `validatePageReportPayload`) reusing the T010 shell |
| `src/ui/server.ts` | New `POST /ui/export-html` endpoint |
| `src/ui/index.html` | `#download-html` button; 501 hint replaced |
| `src/ui/app.js` | Shared `buildPageExportPayload()`; `#download-html` handler; `apiText()` helper |
| `package.json` | Added `test:export:api` script (no other script changed) |
| `tests/api/routes.test.ts` | 501 test replaced by HTML-200 test + tampered-report-422-for-HTML test; imports for the new assertions |
| `tests/export/html-api.test.ts` (NEW, 5 tests) | API-path HTML export (see below) |
| `tests/export/ui-report-html.test.ts` (NEW, 5 tests) | Page-renderer unit tests (see below) |
| `tests/e2e/offline.test.ts` | 501 boundary test replaced by live-proxy HTML-export test (200 + 422) |
| `tests/e2e/custom-input.test.ts` | HTML download asserted in the CSS custom flow (filename, contents, embedded JSON == JSON download) |
| `tests/ui/ui-flow.test.ts` | HTML download asserted in the F002 report test |

NOT touched: frozen modules (`runner/`, `mutations/`, `canonical/`, `fixtures/`, `score/`, `oracle/identity-compare.ts`, `oracle/target-capture.ts`), S0 gate scripts, golden files, the CLI (FIX-R1-03 owns it), any of the 23 P2s. The only test changes to pre-existing tests are the two that encoded the old 501 behaviour (`routes.test.ts`, `offline.test.ts`) — both now assert the fixed behaviour.

## New tests (11 new, 0 removed net: 549 → 560)

- `tests/export/html-api.test.ts` (5): fixture-run report via `/api/export` format=html (200, `text/html`, embedded JSON == JSON export, all 4 hashes, `15/16`, `WRONG_TARGET`, `FOUND`, 0 external refs); the **real T008 report file** (192 real fixture-run cases) via the API (embedded JSON == file, score `71.875`, both hashes, single `</script>`); **all 7 XSS vectors through the API path** (no raw payload, escaped form present, single `</script>`, 0 external refs, round-trip intact); missing report → 422; unknown format → 400.
- `tests/export/ui-report-html.test.ts` (5): fixture-run page payload → HTML (embedded JSON == payload, `37.5`, `WRONG_TARGET`, 0 external refs); **custom-run page payload** (`P022-CUSTOM-001`, `MISSING`/`AMBIGUOUS`, `62.5`, "No golden expected verdicts" note, embedded JSON == payload); witness-less/scoreless payload renders; **XSS payloads in `note` + witness `meaning`** render as inert text (single `</script>`, 0 external refs); malformed payloads throw (null, missing schema/analysis, non-array cases, bad source).
- `tests/api/routes.test.ts` (+1 net): HTML export 200 with hashes + tampered-report 422-for-HTML; the old 501 test is gone.
- E2E assertions added inside existing tests (no new test counts): `offline.test.ts` (HTML export through the UI proxy: 200 `text/html`, gate hash present, 0 external refs, invalid report → 422); `custom-input.test.ts` (custom HTML download `P022-CUSTOM-001-analysis.html`, contents + embedded JSON deep-equal to the JSON download); `ui-flow.test.ts` (fixture HTML download `F002-analysis.html`, `WRONG_TARGET`, `37.5`, witness FOUND).

## Acceptance (all run sequentially, exit codes read from files — no piped exit codes)

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` | 0 | clean |
| `npm run build` | 0 | clean |
| `npm run test:export` | 0 | 11 passed (html-export 8 + html-safety 3) — all 7 XSS vectors still pass |
| `npm run test:html-safety` | 0 | 3 passed |
| `npm run test:export:api` (new) | 0 | 10 passed (html-api 5 + ui-report-html 5) |
| `npm run test:api` | 0 | 84 passed (7 files) |
| `npm run test:offline` | 0 | 6 passed |
| `npm run test:ui` | 0 | 12 passed |
| `npm run test:e2e:custom` | 0 | 6 passed |
| `npm test` (full suite) | 0 | **45 files, 560 passed** (baseline 511 + FIX-R1-01 38 + this fix 11) |
| `npm run s0:gate` | 0 | **GATE PASS** (see hashes below) |

### s0:gate — GATE PASS, all four hashes EXACTLY unchanged

```
GATE PASS failure_type=null gate_sha256=651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52
REPEAT_HASH runs=100/100 unique_gate_hashes=1
```

| Hash | Fresh gate run | Frozen / R1-verdict value | Match |
|---|---|---|---|
| scenario_sha256 | `1ffb5f85561c6dd9f10fc15773097691c5c07fe20c6e9a001e231a41b61c9f22` | same | ✅ |
| oracle_result_sha256 | `3502d81fa730605ddd8548e39af6b7272015c026e65f91a2dae132c3e345a988` | same | ✅ |
| analysis_sha256 | `4410d5c85cf5fe8ee858c4e01822cdbc1515c39afa7ba40d833aceb00a9576a4` | same | ✅ |
| gate_sha256 | `651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52` | same | ✅ |

Also from the fresh `evidence/s0/S0_GATE.json`: 192/192 cases, baseline 24/24, oracle parity 192/192, verdicts 138/22/17/15, score `71.875`, external requests 0, replay 100 runs / 1 unique hash. No per-field diff exists to report.

### Live demo (real UI server on `http://127.0.0.1:41363`, script `/tmp/fixr102-demo.mjs`, outputs `/tmp/fixr102-demo/`)

Fixture run — `POST /api/export` with the real `evidence/s2/T008_API_REPORT.json` (94,248 B):

```
FIXTURE /api/export html: status 200 | content-type text/html; charset=utf-8 | bytes 308017
| doctype true | gate_hash_present true | analysis_hash_present true
| has_WRONG_TARGET true | has_score_71.875 true | external_refs [] | has_https false
```

Custom run — real `POST /api/analyze` + `POST /api/search` on the `P022-CUSTOM-001` demo scenario, then `POST /ui/export-html` (the endpoint the HTML button calls):

```
CUSTOM /api/analyze: status 200 | source custom | baseline STABLE | M03 MISSING | M04 AMBIGUOUS
CUSTOM /api/search: status 200 | witness_status FOUND | sequence ["M03"]
CUSTOM /ui/export-html: status 200 | content-type text/html; charset=utf-8 | bytes 23522
| doctype true | has_scenario_id true | has_MISSING true | has_AMBIGUOUS true
| has_score_62.5 true | external_refs [] | has_https false
```

Note on the demo wording: the task asked for "`POST /api/export` format=html on a fixture run AND a custom run". A single custom run cannot be a full `AnalysisReport` (see "Why custom runs…" above), so the custom leg of the demo goes through `/ui/export-html` — the honest HTML path for a custom run — with a real custom analyze/search behind it. If the coordinator wants `/api/export` to also accept a custom run, that needs a spec decision (what a custom full report's golden/controlGroup would be), not a code shortcut here.

### Evidence hygiene

- `evidence/s0/S0_P2A.log` restored from git after the gate run (diff was only timings: `17.20s` → `44.85s`, start `17:04:32` → `14:27:34`); sha256 after restore `2a76dec117c42ee2e5bfcf44b452407222658b3665c39dc47f0e21c957e06a5d`, same as before the gate.
- Test-run byproducts restored from git after each suite: `evidence/s3/screenshots/matrix-F002.png`, `evidence/s4/T012_CUSTOM_E2E_REQUESTS.json`, `evidence/s4/T012_E2E_REQUESTS.json`, `evidence/s4/T012_PERF.json`. `git status evidence/` is clean.
- No EPERM failures hit during this session. The demo server was killed after the run (port 41363 no longer listening); no stray server processes left.
- Pre-existing untracked items left untouched: `coverage/` and `handoff/P022-FINAL-R1/` (both present before this session started).

## Open points for the coordinator

1. **Nothing blocking.** All five requirements are met; FIX-R1-01 is intact (custom analyze/search/download paths untouched except the shared payload builder, and `test:e2e:custom` is 6/6 green).
2. **For FIX-R1-04 (re-freeze):** the new files to include are `src/export/ui-report-html.ts`, `tests/export/html-api.test.ts`, `tests/export/ui-report-html.test.ts`; the `test:export:api` script in `package.json`. No new evidence files are produced by this fix (the E2E request logs are regenerated by their own tests and were restored).
3. **For R2 review:** the one judgement call to surface is the custom-run API question above — `/api/export` stays full-report-only by the frozen `ReportCase` contract, and custom runs export as HTML through the UI page-level endpoint. The report document itself states this scope in both the HTML and the UI.
4. **Not done (out of scope):** the 23 P2s (incl. P2-11 "HTML report does not show all JSON fields" — the full-report HTML is unchanged T010 output; the page-level HTML embeds the full payload JSON, so all fields are present in the embedded copy); the CLI (FIX-R1-03).
