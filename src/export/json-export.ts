// T008 — JSON exporter for AnalysisReport (PROJECT_BOOK §7.3, §11.4).
//
// Export bytes are canonical JSON (T006 canonicaliser: UTF-8, LF,
// NFC, keys sorted by code point, arrays in stable order) plus one
// trailing LF. The LF is a file convention, not part of the hashed
// bytes — exactly as the T006 evidence files do it.
//
// Validation is two-layer and both layers must pass:
//   1. structural (validateReportStructure in contracts/report.ts):
//      schema, seed, counts, score consistency, witness-status rules;
//   2. hash recomputation (recomputeReportHashes in analysis/witness.ts):
//      all four hashes recompute from the report's embedded canonical
//      objects. A report whose counts were edited after hashing fails
//      here, even if it is structurally self-consistent.
//
// Nothing in this module computes a verdict, a score or a witness: it
// only serialises and verifies a report built by analysis/witness.ts.

import { readFileSync, writeFileSync } from "node:fs";
import { canonicalJson } from "../canonical/canonical-json.js";
import {
  validateReportStructure,
} from "../contracts/report.js";
import type { AnalysisReport } from "../contracts/report.js";
import { recomputeReportHashes } from "../analysis/witness.js";

export interface ReportValidation {
  valid: boolean;
  errors: string[];
  recomputed: {
    scenario_sha256: string;
    oracle_result_sha256: string;
    analysis_sha256: string;
    gate_sha256: string;
  } | null;
}

/**
 * Validate a parsed report value: structure first, then hash
 * recomputation. Never throws for a bad report — it returns the errors.
 */
export function validateExportedReport(report: unknown): ReportValidation {
  const errors = validateReportStructure(report);
  if (errors.length > 0) {
    return { valid: false, errors, recomputed: null };
  }
  try {
    const { recomputed, errors: hashErrors } = recomputeReportHashes(
      report as AnalysisReport,
    );
    if (hashErrors.length > 0) {
      return { valid: false, errors: hashErrors, recomputed };
    }
    return { valid: true, errors: [], recomputed };
  } catch (err) {
    return {
      valid: false,
      errors: [
        `hash recomputation failed: ${err instanceof Error ? err.message : String(err)}`,
      ],
      recomputed: null,
    };
  }
}

/**
 * Serialise a report to its export bytes. Throws when the report fails
 * validation (structure or hash recomputation) — an invalid report is
 * never written out as if it were good.
 */
export function exportReportJson(report: unknown): string {
  const validation = validateExportedReport(report);
  if (!validation.valid) {
    throw new Error(
      `refusing to export an invalid report: ${validation.errors.join("; ")}`,
    );
  }
  return `${canonicalJson(report)}\n`;
}

/** Write a validated report to a file (canonical bytes + trailing LF). */
export function writeReportJson(filePath: string, report: unknown): string {
  const text = exportReportJson(report);
  writeFileSync(filePath, text, "utf-8");
  return text;
}

/**
 * Read a report file, parse it, and validate it (structure + hash
 * recomputation). Returns the parsed report and the validation result;
 * the caller decides whether to accept it.
 */
export function readAndValidateReportJson(filePath: string): {
  report: unknown;
  validation: ReportValidation;
} {
  const text = readFileSync(filePath, "utf-8");
  return validateExportedJsonText(text);
}

/** Validate exported report text (as produced by exportReportJson). */
export function validateExportedJsonText(text: string): {
  report: unknown;
  validation: ReportValidation;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    return {
      report: null,
      validation: {
        valid: false,
        errors: [
          `exported text is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        ],
        recomputed: null,
      },
    };
  }
  return { report: parsed, validation: validateExportedReport(parsed) };
}
