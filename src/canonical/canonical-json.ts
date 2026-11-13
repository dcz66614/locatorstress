// T006 — Canonical JSON (PROJECT_BOOK §6; IMPLEMENTATION_PLAN T006).
//
// This is the production canonicaliser. It reproduces, byte for byte, the
// canonicalisation that the frozen S0 gate already performed in
// scripts/s0-gate.ts (canonicalize / canonicalJson / sha256Hex) and
// scripts/repeat-hash.ts (serialize), so that the four frozen S0 hashes
// recompute exactly. DO NOT "improve" the serialisation shape here: any
// change to key order, string normalisation, number rendering or array
// handling changes every downstream hash.
//
// Frozen behaviour reproduced exactly:
//   - UTF-8 bytes of the JSON text are hashed (sha256Hex updates "utf8").
//   - Strings (values AND object keys) are Unicode NFC normalised.
//   - Object keys are sorted by Unicode code point (NOT by UTF-16 code
//     unit, which is what JS default sort does; astral-plane keys sort
//     after the whole BMP, not among the surrogates) — EXCEPT
//     integer-like keys, which JS plain-object enumeration always hoists
//     to the front in ascending numeric order ("2" before "10"),
//     regardless of the sorted insertion order. That reordering is frozen
//     behaviour too (see canonical-boundaries.test.ts); the code-point
//     sort applies to the remaining, non-integer-like keys.
//   - Arrays keep their order. §6 says "数组稳定排序" but the frozen
//     implementation does NOT sort arrays inside canonicalise(): ordering
//     is imposed explicitly by the builders in hashes.ts (fixtures by
//     fixtureId, cases by fixtureId/mutationId, §5.7 fixed order).
//     Sorting arrays generically here would CHANGE the frozen gate hash
//     (the gate NOTES array is not in sorted order), so arrays are
//     preserved. See T006_HASH_REPORT.json conflict C1 (P1, coordinator
//     to adjudicate); on this point the module follows the frozen
//     implementation, per the T006 brief (reproduce frozen hash first).
//   - Numbers are rendered by JSON.stringify, exactly as s0-gate does.
//     §6 says numbers should be integers or explicit decimal strings;
//     that rule is enforced by the builders' types (counts are validated
//     integers, scores are decimal strings), not by rejecting floats
//     here, because s0-gate accepts any finite number. See conflict C2.
//   - No trailing newline: canonicalJson returns the bare JSON text.
//     Evidence files append a single LF when writing; the LF is not
//     part of the hashed bytes.
//
// Deliberate strictness where the two frozen scripts disagree (no frozen
// input ever triggers these paths, so no frozen hash is affected):
//   - Non-finite numbers (NaN/Infinity): s0-gate silently coerces them
//     to null via JSON.stringify; repeat-hash throws. This module throws
//     (repeat-hash side). See conflict C3.
//   - undefined / function / symbol / bigint values: s0-gate passes them
//     through and lets JSON.stringify drop or null them; repeat-hash
//     throws. This module throws (repeat-hash side). See conflict C4.
//   - Object keys that collide after NFC normalisation: s0-gate dedupes
//     (last in sorted order wins, because it builds a plain object);
//     repeat-hash emits duplicate keys. This module follows s0-gate.
//     See conflict C5.
//   - A Date or other class instance is treated as a plain object via
//     Object.keys, exactly as both frozen scripts do (a Date hashes as
//     "{}"). Callers must pass plain JSON values; canonical inputs are
//     never Dates, PIDs, or live objects.

import { createHash } from "node:crypto";

/** Compare two strings by Unicode code point (not UTF-16 code unit). */
export function compareCodePoints(a: string, b: string): number {
  const aa = Array.from(a);
  const bb = Array.from(b);
  const n = Math.min(aa.length, bb.length);
  for (let i = 0; i < n; i++) {
    const ca = aa[i].codePointAt(0)!;
    const cb = bb[i].codePointAt(0)!;
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
  return aa.length - bb.length;
}

/**
 * Canonicalise a plain JSON value: NFC-normalise strings and keys, sort
 * object keys by code point — except integer-like keys, which JS
 * plain-object enumeration always hoists to the front in ascending
 * numeric order ("2" before "10") regardless of the sorted insertion
 * order (frozen behaviour, see the header comment) — and preserve array
 * order. Throws on values that are not JSON values (non-finite numbers,
 * undefined, functions, symbols, bigints) instead of silently dropping
 * or nulling them.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("non-finite number in canonical JSON");
    }
    return value;
  }
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(compareCodePoints);
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k.normalize("NFC")] = canonicalize(obj[k]);
    }
    return out;
  }
  throw new Error(`unsupported value in canonical JSON: ${typeof value}`);
}

/**
 * Canonical JSON text: JSON.stringify of the canonicalised value, no
 * spaces, no trailing newline, LF only (there are no line breaks at all
 * in the output; a file writer may append one LF, which is not hashed).
 */
export function canonicalJson(value: unknown): string {
  const text = JSON.stringify(canonicalize(value));
  if (text === undefined) {
    throw new Error("canonical JSON is undefined for this input");
  }
  return text;
}

/** UTF-8 bytes of the canonical JSON text (exactly the hashed bytes). */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

/** Lowercase hex SHA-256 of a UTF-8 string. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Lowercase hex SHA-256 of raw bytes. */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** SHA-256 of the canonical JSON bytes of a value (the §6 hash). */
export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
