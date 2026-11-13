// T010 — Offline HTML exporter for AnalysisReport
// (IMPLEMENTATION_PLAN T010; PROJECT_BOOK §7.3, §11.4).
//
// A report is valid only if it passes the SAME validation as the JSON
// export (structure + hash recomputation, see json-export.ts). The
// HTML is then built from that validated report only:
//   - every report value is rendered through escapeHtml() — input
//     text (notes, witness meanings/notes, fixture ids, selectors in
//     the embedded JSON) is always displayed as text, never parsed
//     as markup and never executed;
//   - the full canonical JSON is embedded twice, both derived from
//     the single canonicalJson(report) string: once as a
//     <script type="application/json"> block (escapeJsonForHtmlScript)
//     and once as escaped text in a <pre>. Either copy parses back to
//     exactly the report the JSON exporter writes (modulo the JSON
//     exporter's single trailing LF), so HTML and JSON exports are
//     consistent by construction;
//   - the document is self-contained: inline <style> only, no
//     external scripts, fonts, images or links (verified by
//     scanExternalResources(), which must return [] for every export).
//
// Nothing in this module computes a verdict, a score or a witness.

import { writeFileSync } from "node:fs";

import { canonicalJson } from "../canonical/canonical-json.js";
import type { AnalysisReport, VerdictCounts } from "../contracts/report.js";
import {
  escapeHtml,
  escapeJsonForHtmlScript,
  scanExternalResources,
} from "./html-escape.js";
import { validateExportedReport } from "./json-export.js";
import { renderReportHtml } from "./templates/report.html.js";

export { escapeHtml, escapeJsonForHtmlScript, scanExternalResources };

const VERDICT_ORDER = ["STABLE", "WRONG_TARGET", "AMBIGUOUS", "MISSING"] as const;

function verdictCell(verdict: string | null): string {
  if (verdict === null) return "<td>—</td>";
  return `<td><span class="verdict-${escapeHtml(verdict)}">${escapeHtml(verdict)}</span></td>`;
}

function boolCell(value: boolean | null): string {
  if (value === null) return "<td>—</td>";
  return `<td>${value ? "yes" : "no"}</td>`;
}

function countsRow(label: string, counts: VerdictCounts): string {
  const cells = VERDICT_ORDER.map(
    (v) => `<td>${escapeHtml(counts[v] ?? 0)}</td>`,
  ).join("");
  return `<tr><th scope="row">${escapeHtml(label)}</th>${cells}</tr>`;
}

/**
 * Render a validated report as a self-contained offline HTML document.
 * Throws when the report fails validation — an invalid report is never
 * exported as if it were good. Also throws if the finished document
 * fails its own external-resource scan (defence in depth: a template
 * regression must fail loudly, not ship a leaky report).
 */
export function exportReportHtml(report: unknown): string {
  const validation = validateExportedReport(report);
  if (!validation.valid) {
    throw new Error(
      `refusing to export an invalid report as HTML: ${validation.errors.join("; ")}`,
    );
  }
  const r = report as AnalysisReport;
  const canonical = canonicalJson(r);

  const headerHtml = [
    "<header>",
    `<h1>LocatorStress analysis report</h1>`,
    `<p>Schema: <code>${escapeHtml(r.schema)}</code> · Seed: <code>${escapeHtml(r.seed)}</code> · Task: <code>${escapeHtml(r.task)}</code></p>`,
    `<p>Analysis status: <span class="badge">${escapeHtml(r.analysisStatus)}</span> · Cases: ${escapeHtml(r.completedCases)} completed / ${escapeHtml(r.expectedCases)} expected · Baseline: ${escapeHtml(r.baseline.passed)}/${escapeHtml(r.baseline.total)} passed</p>`,
    `<p>External requests: ${escapeHtml(r.externalRequests)} · Blocked requests: ${escapeHtml(r.blockedRequests)} · Static offline-scan hits: ${escapeHtml(r.staticOfflineScanHits)}</p>`,
    "</header>",
  ].join("\n");

  const byKindRows = Object.entries(r.verdictCountsByKind)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([kind, counts]) => countsRow(`By kind: ${kind}`, counts))
    .join("\n");
  const summaryHtml = [
    "<section>",
    "<h2>Summary</h2>",
    "<table>",
    "<thead><tr><th scope=\"col\">Verdict</th><th scope=\"col\">STABLE</th><th scope=\"col\">WRONG_TARGET</th><th scope=\"col\">AMBIGUOUS</th><th scope=\"col\">MISSING</th></tr></thead>",
    "<tbody>",
    countsRow("All cases", r.verdictCounts),
    byKindRows,
    "</tbody>",
    "</table>",
    `<p>Stability score (overall): <strong>${escapeHtml(r.scores.overall.score ?? "—")}</strong> (${escapeHtml(r.scores.overall.stable)}/${escapeHtml(r.scores.overall.completed)} stable of completed; expected ${escapeHtml(r.scores.overall.expected)}, completed ${escapeHtml(r.scores.overall.completed)})</p>`,
    `<p>Coverage: ${escapeHtml(r.coverage.cssFixtures)} CSS / ${escapeHtml(r.coverage.xpathFixtures)} XPath / ${escapeHtml(r.coverage.roleFixtures)} role fixtures; ${escapeHtml(r.coverage.framePathFixtures)} with framePath, ${escapeHtml(r.coverage.indexFixtures)} with index.</p>`,
    `<p>Controls — stable: ${escapeHtml(r.controls.stable.pairs)} pairs, ${escapeHtml(r.controls.stable.mismatched)} mismatched; fragile: ${escapeHtml(r.controls.fragile.pairs)} pairs, ${escapeHtml(r.controls.fragile.mismatched)} mismatched.</p>`,
    `<p>Oracle parity: ${escapeHtml(r.oracleParity.matched)}/${escapeHtml(r.oracleParity.compared)} matched, ${escapeHtml(r.oracleParity.mismatched)} mismatched.</p>`,
    `<p>Witness coverage: ${escapeHtml(r.witnessCoverage.searchedFixtures)} fixtures searched — ${escapeHtml(r.witnessCoverage.found)} FOUND, ${escapeHtml(r.witnessCoverage.boundedNoWitness)} bounded-no-witness, ${escapeHtml(r.witnessCoverage.boundedIncomplete)} bounded-incomplete. BOUNDED_INCOMPLETE is never “no witness” and never “safe”.</p>`,
    "</section>",
  ].join("\n");

  const hashesHtml = [
    "<section>",
    "<h2>Hashes</h2>",
    "<table>",
    "<thead><tr><th scope=\"col\">Hash</th><th scope=\"col\">SHA-256</th></tr></thead>",
    "<tbody>",
    `<tr><th scope="row">scenario_sha256</th><td><code>${escapeHtml(r.hashes.scenario_sha256)}</code></td></tr>`,
    `<tr><th scope="row">oracle_result_sha256</th><td><code>${escapeHtml(r.hashes.oracle_result_sha256)}</code></td></tr>`,
    `<tr><th scope="row">analysis_sha256</th><td><code>${escapeHtml(r.hashes.analysis_sha256)}</code></td></tr>`,
    `<tr><th scope="row">gate_sha256</th><td><code>${escapeHtml(r.hashes.gate_sha256)}</code></td></tr>`,
    "</tbody>",
    "</table>",
    "</section>",
  ].join("\n");

  const witnessRows = Object.values(r.witnesses)
    .sort((a, b) => (a.fixtureId < b.fixtureId ? -1 : a.fixtureId > b.fixtureId ? 1 : 0))
    .map((w) => {
      const seq =
        w.witness === null
          ? "—"
          : `${escapeHtml(w.witness.sequence.join(" + "))} (${escapeHtml(w.witness.verdict)}, depth ${escapeHtml(w.witness.depth)})`;
      const budget = w.budgetNote === undefined ? "" : `<br>${escapeHtml(w.budgetNote)}`;
      return `<tr><td>${escapeHtml(w.fixtureId)}</td><td>${escapeHtml(w.status)}</td><td>${seq}</td><td>${escapeHtml(w.meaning)}${budget}</td><td>${escapeHtml(w.statesEvaluated)} evaluated / ${escapeHtml(w.statesExpanded)} expanded / ${escapeHtml(w.queueRemaining)} queued</td></tr>`;
    })
    .join("\n");
  const witnessesHtml = [
    "<section>",
    "<h2>Witnesses (shortest failing sequences)</h2>",
    "<table>",
    "<thead><tr><th scope=\"col\">Fixture</th><th scope=\"col\">Status</th><th scope=\"col\">Witness</th><th scope=\"col\">Meaning</th><th scope=\"col\">Search</th></tr></thead>",
    `<tbody>${witnessRows}</tbody>`,
    "</table>",
    "</section>",
  ].join("\n");

  const caseRows = r.cases
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.fixtureId)}</td><td>${escapeHtml(c.mutationId)}</td><td>${escapeHtml(c.locatorKind)}</td><td>${escapeHtml(c.controlGroup)}</td>${verdictCell(c.verdict)}<td>${escapeHtml(c.analysisStatus)}</td><td>${escapeHtml(c.executionStatus)}</td><td>${escapeHtml(c.matchCount)}</td>${boolCell(c.identityMatch)}<td>${escapeHtml(c.expectedVerdict)}</td></tr>`,
    )
    .join("\n");
  const casesHtml = [
    "<section>",
    "<h2>Cases</h2>",
    "<table>",
    "<thead><tr><th scope=\"col\">Fixture</th><th scope=\"col\">Mutation</th><th scope=\"col\">Kind</th><th scope=\"col\">Control</th><th scope=\"col\">Verdict</th><th scope=\"col\">Status</th><th scope=\"col\">Execution</th><th scope=\"col\">Matches</th><th scope=\"col\">Identity</th><th scope=\"col\">Expected</th></tr></thead>",
    `<tbody>${caseRows}</tbody>`,
    "</table>",
    "</section>",
  ].join("\n");

  const notesHtml = [
    "<section>",
    "<h2>Notes</h2>",
    "<ul>",
    ...r.notes.map((n) => `<li>${escapeHtml(n)}</li>`),
    "</ul>",
    "</section>",
  ].join("\n");

  const html = renderReportHtml({
    titleText: escapeHtml(`LocatorStress report — ${r.seed}`),
    headerHtml,
    summaryHtml,
    witnessesHtml,
    casesHtml,
    notesHtml,
    hashesHtml,
    embeddedJson: escapeJsonForHtmlScript(canonical),
    embeddedJsonText: escapeHtml(canonical),
  });

  const scanHits = scanExternalResources(html);
  if (scanHits.length > 0) {
    throw new Error(
      `generated HTML failed its own external-resource scan: ${scanHits.join("; ")}`,
    );
  }
  return html;
}

/** Write a validated report as offline HTML (single trailing LF, like the JSON export). */
export function writeReportHtml(filePath: string, report: unknown): string {
  const html = exportReportHtml(report);
  const text = html.endsWith("\n") ? html : `${html}\n`;
  writeFileSync(filePath, text, "utf-8");
  return text;
}

/** Extract and parse the embedded report JSON from exported HTML. Throws on malformed input. */
export function parseEmbeddedReportJson(html: string): unknown {
  const match = /<script type="application\/json" id="report-json">([\s\S]*?)<\/script>/.exec(html);
  if (match === null) {
    throw new Error("exported HTML has no embedded report JSON block");
  }
  return JSON.parse(match[1]!) as unknown;
}
