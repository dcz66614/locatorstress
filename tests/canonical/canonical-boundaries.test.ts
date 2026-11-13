// T011 — canonical JSON extra boundaries (PROJECT_BOOK §6).
//
// The T006 tests pin ASCII/astral key order, NFC values, array order,
// number rendering and strict rejection. These rows pin the remaining
// edges: NFC key collision (two keys that normalise to one), deep
// nesting, empty containers, hash vectors, and canonicalize purity
// (input is never mutated, including nested objects).

import { describe, it, expect } from "vitest";

import {
  canonicalJson,
  canonicalize,
  compareCodePoints,
  hashCanonical,
  sha256Hex,
} from "../../src/canonical/canonical-json.js";

describe("canonicalize — NFC key collisions and nesting", () => {
  it("keys that collide after NFC dedupe to one key (last in code-point order wins)", () => {
    // "e" + combining acute (U+0301) and precomposed "é" (U+00E9) are
    // the same key after NFC. Sorted order puts "e\u0301" first, "é"
    // second, so the precomposed value wins — matching the frozen
    // s0-gate behaviour. Keys are built with explicit escapes so the
    // source file encoding cannot silently normalise them.
    const decomposed = "é";
    const precomposed = "é";
    expect(decomposed).not.toBe(precomposed);
    expect(decomposed.normalize("NFC")).toBe(precomposed);
    const input: Record<string, number> = {};
    input[decomposed] = 1;
    input[precomposed] = 2;
    const out = canonicalize(input) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(["é"]);
    expect(out["é"]).toBe(2);
  });

  it("NFC-normalises keys at every depth", () => {
    const input: Record<string, unknown> = { outer: {} };
    (input["outer"] as Record<string, unknown>)["é"] = "café";
    const out = canonicalJson(input);
    expect(out).toBe('{"outer":{"é":"café"}}');
  });

  it("handles deep nesting without reordering arrays", () => {
    const value = { b: [{ z: 1, a: [3, 2, 1] }, { y: null }], a: {} };
    expect(canonicalJson(value)).toBe('{"a":{},"b":[{"a":[3,2,1],"z":1},{"y":null}]}');
  });

  it("empty object and empty array round-trip", () => {
    expect(canonicalJson({})).toBe("{}");
    expect(canonicalJson([])).toBe("[]");
    expect(canonicalJson({ a: {}, b: [] })).toBe('{"a":{},"b":[]}');
  });

  it("empty-string keys sort first", () => {
    expect(canonicalJson({ b: 1, "": 2, a: 3 })).toBe('{"":2,"a":3,"b":1}');
  });

  it("integer-like keys come out in numeric order (JS plain-object semantics, frozen behaviour)", () => {
    // compareCodePoints would order "1" < "10" < "2", but canonicalize
    // builds a plain JS object and JS engines always enumerate
    // integer-index keys first in ascending numeric order, before any
    // string key — so the output is "1","2","10" regardless of the
    // sorted insertion order. This is the frozen s0-gate behaviour
    // (same plain-object construction); no frozen canonical input
    // uses integer-like keys, so no frozen hash is affected. Pinned
    // here so a future "fix" that changes the output is caught.
    expect(canonicalJson({ "10": 1, "2": 2, "1": 3 })).toBe('{"1":3,"2":2,"10":1}');
    expect(canonicalJson({ "10": 1, "2": 2, a: 0 })).toBe('{"2":2,"10":1,"a":0}');
  });

  it("does not mutate its input, including nested objects and arrays", () => {
    const input = { b: [{ z: 1 }], a: "é" };
    const snapshot = JSON.stringify(input);
    canonicalize(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect((input as { a: string }).a).toBe("é");
  });

  it("canonicalJson is idempotent: canonicalising the parsed output is a fixed point", () => {
    const value = { z: [{ b: "é" }], a: [3, 1] };
    const once = canonicalJson(value);
    const twice = canonicalJson(JSON.parse(once) as unknown);
    expect(twice).toBe(once);
  });
});

describe("compareCodePoints — ordering edges", () => {
  it("empty string sorts before any non-empty string", () => {
    expect(compareCodePoints("", "a")).toBeLessThan(0);
    expect(compareCodePoints("a", "")).toBeGreaterThan(0);
    expect(compareCodePoints("", "")).toBe(0);
  });

  it("equal strings compare 0", () => {
    expect(compareCodePoints("M01", "M01")).toBe(0);
  });

  it("orders M01..M08 lexicographically (the BFS tie-break order)", () => {
    const ids = ["M08", "M02", "M10", "M01"];
    expect([...ids].sort(compareCodePoints)).toEqual(["M01", "M02", "M08", "M10"]);
  });

  it("astral-plane characters sort after the whole BMP", () => {
    expect(compareCodePoints("\u{10FFFF}", "\uFFFF")).toBeGreaterThan(0);
    expect(compareCodePoints("𐀀", "￿")).toBeGreaterThan(0);
  });
});

describe("sha256Hex / hashCanonical — vectors and determinism", () => {
  it("sha256Hex of the empty string is the known vector", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("sha256Hex of 'abc' is the known vector", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashCanonical is 64 lowercase hex chars", () => {
    expect(hashCanonical({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashCanonical differs when any field differs (avalanche spot check)", () => {
    const a = hashCanonical({ fixtureId: "F001", verdict: "STABLE" });
    const b = hashCanonical({ fixtureId: "F001", verdict: "MISSING" });
    const c = hashCanonical({ fixtureId: "F002", verdict: "STABLE" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it("hashCanonical is stable across runs (same input, same bytes)", () => {
    const value = { seed: "P022-LOCATORSTRESS-S0-2026-11-10", n: 192 };
    expect(hashCanonical(value)).toBe(hashCanonical(value));
  });

  it("hashCanonical of a nested value equals sha256Hex of its canonical text", () => {
    const value = { b: [1, { a: "é" }], a: null };
    expect(hashCanonical(value)).toBe(sha256Hex(canonicalJson(value)));
  });
});

describe("canonicalize — strict rejection edges", () => {
  it("rejects -0? no: -0 is a finite number and renders as 0 (JSON.stringify behaviour)", () => {
    expect(canonicalJson(-0)).toBe("0");
  });

  it("rejects undefined nested inside an array", () => {
    expect(() => canonicalize([1, undefined])).toThrow(/unsupported value/);
  });

  it("rejects a function nested inside an object", () => {
    expect(() => canonicalize({ f: () => 1 })).toThrow(/unsupported value/);
  });

  it("rejects NaN nested inside an object", () => {
    expect(() => canonicalize({ n: NaN })).toThrow(/non-finite number/);
  });

  it("rejects Infinity at the top level", () => {
    expect(() => canonicalize(Infinity)).toThrow(/non-finite number/);
  });
});
