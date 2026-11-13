// FIX-R1-02 — Offline HTML renderer for the UI's page-level export.
//
// This renders exactly the payload the JSON download writes
// (`locatorstress.ui-fixture-export/v1`: one fixture or custom analysis
// + optional witness + server-side scores + controls), as a
// self-contained offline HTML document. It reuses the T010 document
// shell (src/export/templates/report.html.ts: doctype, inline <style>
// only, one non-executable application/json script block, CSP
// default-src 'none'), so the offline and XSS guarantees are the same
// as the full-report exporter:
//
//   - every value is rendered through escapeHtml() — never parsed as
//     markup and never executed;
//   - the full canonical JSON of the payload is embedded twice (script
//     block + escaped <pre>), both derived from the single
//     canonicalJson(payload) string, so the HTML download and the JSON
//     download of the same analysis are consistent by construction;
//   - the finished document must pass scanExternalResources() (zero
//     hits) or rendering throws.
//
// Scope (honest, same as the JSON download): this is a PAGE-LEVEL
// export of the current analysis, NOT a T008 full AnalysisReport. A
// single-fixture/custom run has no golden expected verdicts (custom
// runs) and no full-report hashes; the document says so. The full
// 24-fixture report is exported as HTML through POST /api/export
// format=html (src/export/html-export.ts). A custom run cannot be a
// full AnalysisReport at all — ReportCase requires controlGroup
// stable|fragile and a non-null expectedVerdict — so the UI page-level
// export is the only HTML path for custom runs, and FIX-R1-02 keeps
// it working for them (requirement 5).
//
// Nothing in this module computes a verdict, a score or a witness: it
// only renders a payload the backend already produced.

import { canonicalJson } from "../canonical/canonical-json.js";
import {
  escapeHtml,
  escapeJsonForHtmlScript,
  scanExternalResources,
} from "./html-escape.js";
import { renderReportHtml } from "./templates/report.html.js";

export interface PageReportPayload {
  schema: string;
  fixtureId: string;
  seed: string;
  analysis: {
    fixtureId: string;
    source: "fixture" | "custom";
    scenarioId?: string;
    baseline: Record<string, unknown>;
    cases: Array<Record<string, unknown>>;
  };
  witness: Record<string, unknown> | null;
  scores: Record<string, unknown> | null;
  controls: Record<string, unknown> | null;
  note: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return escapeHtml(String(value));
}

function verdictCell(verdict: unknown): string {
  if (verdict === null || verdict === undefined) return "<td>—</td>";
  const v = String(verdict);
  return `<td><span class="verdict-${escapeHtml(v)}">${escapeHtml(v)}</span></td>`;
}

function boolCell(value: unknown): string {
  if (value === null || value === undefined) return "<td>—</td>";
  return `<td>${value === true ? "yes" : "no"}</td>`;
}

/**
 * Validate the page-level payload shape. Throws on a malformed payload
 * — an invalid payload is never exported as if it were good. The
 * checks are structural only (presence + types); verdicts, scores and
 * witnesses are rendered as received, never recomputed.
 */
export function validatePageReportPayload(payload: unknown): PageReportPayload {
  if (!isPlainObject(payload)) {
    throw new Error("page report payload must be a JSON object");
  }
  if (typeof payload["schema"] !== "string" || payload["schema"] === "") {
    throw new Error("page report payload.schema must be a non-empty string");
  }
  if (typeof payload["fixtureId"] !== "string" || payload["fixtureId"] === "") {
    throw new Error("page report payload.fixtureId must be a non-empty string");
  }
  if (typeof payload["seed"] !== "string") {
    throw new Error("page report payload.seed must be a string");
  }
  const analysis = payload["analysis"];
  if (!isPlainObject(analysis)) {
    throw new Error("page report payload.analysis must be an object");
  }
  if (typeof analysis["fixtureId"] !== "string" || analysis["fixtureId"] === "") {
    throw new Error("page report payload.analysis.fixtureId must be a non-empty string");
  }
  if (analysis["source"] !== "fixture" && analysis["source"] !== "custom") {
    throw new Error('page report payload.analysis.source must be "fixture" or "custom"');
  }
  if (!isPlainObject(analysis["baseline"])) {
    throw new Error("page report payload.analysis.baseline must be an object");
  }
  if (!Array.isArray(analysis["cases"])) {
    throw new Error("page report payload.analysis.cases must be an array");
  }
  for (let i = 0; i < analysis["cases"].length; i += 1) {
    const c = analysis["cases"][i];
    if (!isPlainObject(c) || typeof c["mutationId"] !== "string") {
      throw new Error(`page report payload.analysis.cases[${i}].mutationId must be a string`);
    }
  }
  for (const key of ["witness", "scores", "controls"] as const) {
    const v = payload[key];
    if (v !== null && v !== undefined && !isPlainObject(v)) {
      throw new Error(`page report payload.${key} must be an object or null`);
    }
  }
  if (typeof payload["note"] !== "string") {
    throw new Error("page report payload.note must be a string");
  }
  return payload as unknown as PageReportPayload;
}

/** Render a validated page-level payload as a self-contained offline HTML document. */
export function exportPageReportHtml(payload: unknown): string {
  const p = validatePageReportPayload(payload);
  const canonical = canonicalJson(p);
  const a = p.analysis;

  const verdictCounts: Record<string, number> = {};
  let incomplete = 0;
  for (const c of a.cases) {
    const v = c["verdict"];
    if (typeof v === "string" && v !== "") {
      verdictCounts[v] = (verdictCounts[v] ?? 0) + 1;
    } else {
      incomplete += 1;
    }
  }
  const countsLine = ["STABLE", "WRONG_TARGET", "AMBIGUOUS", "MISSING"]
    .map((v) => `${v} ${verdictCounts[v] ?? 0}`)
    .join(" · ");

  const overall = isPlainObject(p.scores) ? p.scores["overall"] : null;
  const scoreLine =
    isPlainObject(overall) && overall["score"] !== null && overall["score"] !== undefined
      ? `${text(overall["score"])} (${text(overall["scoreNumerator"])}/${text(overall["scoreDenominator"])})`
      : "— (no completed cases, or scores unavailable)";
  const perOperator = isPlainObject(p.scores) ? p.scores["perOperator"] : null;
  const operatorRows =
    isPlainObject(perOperator) && Object.keys(perOperator).length > 0
      ? Object.entries(perOperator)
          .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
          .map(([id, row]) => {
            if (!isPlainObject(row)) return "";
            return `<tr><td>${escapeHtml(id)}</td><td>${text(row["stable"])}</td><td>${text(row["wrongTarget"])}</td><td>${text(row["ambiguous"])}</td><td>${text(row["missing"])}</td><td>${row["score"] === null || row["score"] === undefined ? "—" : `${text(row["score"])} (${text(row["scoreNumerator"])}/${text(row["scoreDenominator"])})`}</td></tr>`;
          })
          .join("\n")
      : "";
  const controlsLine = isPlainObject(p.controls)
    ? `<p>Controls — stable: ${text((p.controls["stable"] as Record<string, unknown> | undefined)?.["pairs"])} pairs, ${text((p.controls["stable"] as Record<string, unknown> | undefined)?.["mismatched"])} mismatched; fragile: ${text((p.controls["fragile"] as Record<string, unknown> | undefined)?.["pairs"])} pairs, ${text((p.controls["fragile"] as Record<string, unknown> | undefined)?.["mismatched"])} mismatched.</p>`
    : "<p>Controls: not available for this run (custom runs have no golden expected verdicts).</p>";

  const headerHtml = [
    "<header>",
    `<h1>LocatorStress page report</h1>`,
    `<p>Fixture: <code>${escapeHtml(a.fixtureId)}</code> · Source: <code>${escapeHtml(a.source)}</code>${a.scenarioId !== undefined ? ` · Scenario: <code>${escapeHtml(a.scenarioId)}</code>` : ""} · Seed: <code>${escapeHtml(p.seed)}</code></p>`,
    `<p>Baseline: ${verdictCell(a.baseline["verdict"]).replace(/<\/?td>/g, "")} (execution ${text(a.baseline["executionStatus"])}, matches ${text(a.baseline["matchCount"])})</p>`,
    `<p>${escapeHtml(p.note)}</p>`,
    "</header>",
  ].join("\n");

  const summaryHtml = [
    "<section>",
    "<h2>Summary</h2>",
    `<p>Stability score (overall): <strong>${scoreLine}</strong></p>`,
    `<p>Verdict distribution (mutation cases): ${escapeHtml(countsLine)} · incomplete ${escapeHtml(incomplete)}</p>`,
    controlsLine,
    operatorRows === ""
      ? ""
      : [
          "<h3>Per-operator scores</h3>",
          "<table>",
          "<thead><tr><th scope=\"col\">Operator</th><th scope=\"col\">STABLE</th><th scope=\"col\">WRONG_TARGET</th><th scope=\"col\">AMBIGUOUS</th><th scope=\"col\">MISSING</th><th scope=\"col\">Score</th></tr></thead>",
          `<tbody>${operatorRows}</tbody>`,
          "</table>",
        ].join("\n"),
    "</section>",
  ].join("\n");

  const witness = p.witness;
  const witnessesHtml = [
    "<section>",
    "<h2>Witness (shortest failing sequence)</h2>",
    witness === null || witness === undefined
      ? "<p>BFS witness not run for this analysis.</p>"
      : [
          "<table>",
          "<thead><tr><th scope=\"col\">Status</th><th scope=\"col\">Witness</th><th scope=\"col\">Meaning</th><th scope=\"col\">Search</th></tr></thead>",
          "<tbody><tr>",
          `<td>${text(witness["status"])}</td>`,
          `<td>${isPlainObject(witness["witness"]) ? `${escapeHtml(String((witness["witness"] as Record<string, unknown>)["sequence"] ?? ""))} (${text((witness["witness"] as Record<string, unknown>)["verdict"])}, depth ${text((witness["witness"] as Record<string, unknown>)["depth"])})` : "—"}</td>`,
          `<td>${text(witness["meaning"])}${witness["budgetNote"] !== undefined ? `<br>${text(witness["budgetNote"])}` : ""}</td>`,
          `<td>${text(witness["statesEvaluated"])} evaluated / ${text(witness["statesExpanded"])} expanded / ${text(witness["queueRemaining"])} queued</td>`,
          "</tr></tbody>",
          "</table>",
        ].join("\n"),
    "</section>",
  ].join("\n");

  const caseRows = [
    `<tr><td>baseline</td><td>—</td>${verdictCell(a.baseline["verdict"])}<td>${text(a.baseline["matchCount"])}</td>${boolCell(a.baseline["identityMatch"])}<td>${text(a.baseline["expectedVerdict"])}</td><td>${text(a.baseline["analysisStatus"])}</td><td>${text(a.baseline["executionStatus"])}</td></tr>`,
    ...a.cases.map(
      (c) =>
        `<tr><td>${escapeHtml(a.fixtureId)}</td><td>${escapeHtml(String(c["mutationId"]))}</td>${verdictCell(c["verdict"])}<td>${text(c["matchCount"])}</td>${boolCell(c["identityMatch"])}<td>${text(c["expectedVerdict"])}</td><td>${text(c["analysisStatus"])}</td><td>${text(c["executionStatus"])}</td></tr>`,
    ),
  ].join("\n");
  const casesHtml = [
    "<section>",
    "<h2>Cases</h2>",
    "<table>",
    "<thead><tr><th scope=\"col\">Fixture</th><th scope=\"col\">Mutation</th><th scope=\"col\">Verdict</th><th scope=\"col\">Matches</th><th scope=\"col\">Identity</th><th scope=\"col\">Expected</th><th scope=\"col\">Status</th><th scope=\"col\">Execution</th></tr></thead>",
    `<tbody>${caseRows}</tbody>`,
    "</table>",
    "</section>",
  ].join("\n");

  const notesHtml = [
    "<section>",
    "<h2>Notes</h2>",
    "<ul>",
    `<li>${escapeHtml(p.note)}</li>`,
    "<li>This is a page-level export of the current analysis, not a T008 full AnalysisReport: it covers one fixture or one custom scenario, not all 24 fixtures. Full-report hashes (scenario / oracle / analysis / gate) live in the T008 report, shown read-only in the UI Report view.</li>",
    "</ul>",
    "</section>",
  ].join("\n");

  const hashesHtml = [
    "<section>",
    "<h2>Hashes</h2>",
    "<p>This page-level export carries no full-report hashes. The four S0/T008 hashes for the frozen full report are shown read-only in the UI Report view (GET /ui/reports).</p>",
    "</section>",
  ].join("\n");

  const html = renderReportHtml({
    titleText: escapeHtml(`LocatorStress page report — ${a.fixtureId}`),
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
      `generated page HTML failed its own external-resource scan: ${scanHits.join("; ")}`,
    );
  }
  return html;
}
