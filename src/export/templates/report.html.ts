// T010 — Offline HTML report template (IMPLEMENTATION_PLAN T010).
//
// This module owns ONLY the document shell: doctype, head, inline
// <style>, and the section slots. It performs no escaping itself —
// every fragment it receives is already escaped HTML produced by
// src/export/html-export.ts (escapeHtml for text, escapeJsonForHtmlScript
// for the embedded JSON block). The shell contains:
//   - no <link>, <img>, <iframe>, <video>, <audio>, <embed>, <object>,
//     <source> or <track>;
//   - exactly one <script>, of type="application/json" (data, never
//     executed), carrying the full canonical report JSON so the HTML
//     and JSON exports are byte-consistent by construction;
//   - a CSP meta tag (default-src 'none'; script-src 'none') as
//     defence in depth: even a payload that slipped through escaping
//     could not load or run anything.
//   - inline <style> only, no url() / @import; verdicts always carry
//     text, never colour alone (same convention as src/ui/styles.css).

export interface ReportHtmlParts {
  /** Escaped <title> text (no tags). */
  titleText: string;
  /** Escaped HTML for the header block (already-built markup). */
  headerHtml: string;
  /** Escaped HTML for the summary tables block. */
  summaryHtml: string;
  /** Escaped HTML for the witness table block. */
  witnessesHtml: string;
  /** Escaped HTML for the cases table block. */
  casesHtml: string;
  /** Escaped HTML for the notes list block. */
  notesHtml: string;
  /** Escaped HTML for the hashes table block. */
  hashesHtml: string;
  /** Canonical report JSON, escaped for a <script type="application/json"> block. */
  embeddedJson: string;
  /** Same canonical JSON, HTML-escaped for display in a <pre>. */
  embeddedJsonText: string;
}

const INLINE_CSS = [
  "body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;margin:2rem auto;max-width:1100px;padding:0 1rem;color:#111;background:#fff;line-height:1.5}",
  "h1{font-size:1.5rem}h2{font-size:1.2rem;margin-top:2rem;border-bottom:1px solid #ccc;padding-bottom:.25rem}",
  "table{border-collapse:collapse;width:100%;margin:.5rem 0}",
  "th,td{border:1px solid #bbb;padding:.35rem .5rem;text-align:left;vertical-align:top;font-size:.9rem}",
  "th{background:#eee}code{font-family:ui-monospace,monospace;font-size:.85rem;word-break:break-all}",
  ".verdict-STABLE{color:#0a6b1a}.verdict-WRONG_TARGET{color:#9a3b00}.verdict-AMBIGUOUS{color:#7a5200}.verdict-MISSING{color:#a00}",
  ".badge{display:inline-block;border:1px solid #666;border-radius:3px;padding:0 .4rem;font-size:.8rem}",
  "pre.json{white-space:pre-wrap;word-break:break-all;background:#f6f6f6;border:1px solid #ccc;padding:.75rem;font-size:.8rem;max-height:24rem;overflow:auto}",
  "details{margin-top:1rem}",
].join("\n");

/** Assemble the complete self-contained HTML document. */
export function renderReportHtml(parts: ReportHtmlParts): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; form-action \'none\'; img-src \'none\'; font-src \'none\'; connect-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'">',
    `<title>${parts.titleText}</title>`,
    `<style>\n${INLINE_CSS}\n</style>`,
    "</head>",
    "<body>",
    parts.headerHtml,
    parts.summaryHtml,
    parts.hashesHtml,
    parts.witnessesHtml,
    parts.casesHtml,
    parts.notesHtml,
    "<details>",
    "<summary>Embedded report JSON (identical to the JSON export)</summary>",
    `<script type="application/json" id="report-json">${parts.embeddedJson}</script>`,
    `<pre class="json" id="report-json-text">${parts.embeddedJsonText}</pre>`,
    "</details>",
    "<noscript><p>The embedded report JSON is in the page source (script type=\"application/json\").</p></noscript>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
