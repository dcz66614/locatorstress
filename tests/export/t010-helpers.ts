// T010 test helpers — XSS payloads and a payload-carrying report
// input. Pure builders only; no browser, no I/O. (Kept out of the
// *.test.ts files so importing it does not re-run their tests.)

import { fakeWitnessSummary, smallReportInput } from "../t008-helpers.js";
import type { BuildAnalysisReportInput } from "../../src/analysis/witness.js";

/** XSS / markup payloads that must render as inert text, never as markup. */
export const XSS_PAYLOADS = [
  "<script>alert(1)</script>",
  "\"><img src=x onerror=alert(1)>",
  "<svg onload=alert(1)>",
  "<iframe srcdoc=\"<script>alert(1)</script>\">",
  "<math><mtext><script>alert(1)</script></mtext></math>",
  "'--><script>alert(1)</script>",
  "&lt;script&gt;alert(1)&lt;/script&gt;",
];

/** A report whose notes and witness notes carry the payloads. */
export function payloadReportInput(): BuildAnalysisReportInput {
  const input = smallReportInput();
  input.notes = [...XSS_PAYLOADS, "javascript:alert(1)", "https://example.com/evil.png"];
  input.witnesses["F002"] = fakeWitnessSummary({
    fixtureId: "F002",
    status: "FOUND",
    witness: { sequence: ["M01"], depth: 1, verdict: "WRONG_TARGET" },
    notes: ["<script>alert(1)</script> in witness notes"],
  });
  return input;
}
