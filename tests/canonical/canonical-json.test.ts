// T006 unit tests — canonical JSON core (PROJECT_BOOK §6).
// Pure functions, no browser, no fixture reads. The frozen-hash
// reproduction itself lives in hash-contract.test.ts; these tests pin
// the canonicalisation rules (NFC, code-point key order, array order,
// number rendering, strict rejection) that the frozen hashes depend on.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

import {
  compareCodePoints,
  canonicalize,
  canonicalJson,
  canonicalBytes,
  sha256Hex,
  hashCanonical,
} from "../../src/canonical/canonical-json.js";

describe("compareCodePoints", () => {
  it("sorts ASCII by code point", () => {
    expect(["b", "A", "a", "Z"].sort(compareCodePoints)).toEqual([
      "A",
      "Z",
      "a",
      "b",
    ]);
  });
  it("sorts astral-plane keys AFTER the whole BMP (unlike JS default sort, which orders by UTF-16 code unit)", () => {
    // U+E000 (57344) < U+10000 (65536) by code point, so E000 comes first.
    expect(["\u{10000}", "\uE000"].sort(compareCodePoints)).toEqual([
      "\uE000",
      "\u{10000}",
    ]);
    // JS default sort would give the opposite order here.
    expect(["\u{10000}", "\uE000"].sort()).toEqual([
      "\u{10000}",
      "\uE000",
    ]);
  });
  it("orders by length when one string is a prefix of the other", () => {
    expect(compareCodePoints("ab", "abc")).toBeLessThan(0);
    expect(compareCodePoints("abc", "ab")).toBeGreaterThan(0);
    expect(compareCodePoints("abc", "abc")).toBe(0);
  });
});

describe("canonicalJson — NFC and key order", () => {
  it("NFC-normalises string values: e + combining acute becomes é", () => {
    expect(canonicalJson({ s: "e\u0301" })).toBe('{"s":"é"}');
  });
  it("NFC-normalises object keys", () => {
    expect(canonicalJson({ "e\u0301": 1 })).toBe('{"é":1}');
  });
  it("sorts keys by code point regardless of insertion order", () => {
    expect(canonicalJson({ b: 1, A: 2, a: 3 })).toBe('{"A":2,"a":3,"b":1}');
    expect(canonicalJson({ z: { d: 1, c: 2 }, a: 0 })).toBe(
      '{"a":0,"z":{"c":2,"d":1}}',
    );
  });
  it("is independent of input key order, nested too", () => {
    const one = canonicalJson({ b: { y: 1, x: 2 }, a: [3, 2, 1] });
    const two = canonicalJson({ a: [3, 2, 1], b: { x: 2, y: 1 } });
    expect(one).toBe(two);
  });
  it("preserves array order (frozen behaviour: builders sort explicitly; canonicalise does NOT sort arrays)", () => {
    expect(canonicalJson({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
    expect(canonicalJson(["M08", "M01"])).toBe('["M08","M01"]');
  });
  it("produces compact JSON with no trailing newline and no CR", () => {
    const text = canonicalJson({ a: 1, b: "x\ny" });
    expect(text.endsWith("\n")).toBe(false);
    expect(text.includes("\r")).toBe(false);
    expect(text).toBe('{"a":1,"b":"x\\ny"}');
  });
  it("is deterministic: same input twice gives identical bytes", () => {
    const value = { s: "café", n: 192, arr: [{ k: "v" }, null, true] };
    expect(canonicalJson(value)).toBe(canonicalJson(value));
    expect(canonicalBytes(value)).toEqual(canonicalBytes(value));
  });
  it("canonicalBytes are the UTF-8 bytes of the canonical text", () => {
    const text = canonicalJson({ s: "é" });
    expect(new TextDecoder().decode(canonicalBytes({ s: "é" }))).toBe(text);
    expect(canonicalBytes({ s: "é" }).length).toBe(
      Buffer.byteLength(text, "utf8"),
    );
    expect(canonicalBytes({ s: "é" }).length).toBeGreaterThan(text.length); // multibyte é
  });
});

describe("canonicalJson — numbers (§6: integers or decimal strings)", () => {
  it("renders integers plainly", () => {
    expect(canonicalJson({ n: 192 })).toBe('{"n":192}');
    expect(canonicalJson({ n: 0 })).toBe('{"n":0}');
    expect(canonicalJson({ n: -7 })).toBe('{"n":-7}');
  });
  it("renders finite floats exactly as JSON.stringify does (frozen s0-gate behaviour; builders must pass scores as strings instead)", () => {
    expect(canonicalJson({ n: 1.5 })).toBe('{"n":1.5}');
    expect(canonicalJson({ n: 71.875 })).toBe('{"n":71.875}');
  });
  it("keeps scores as strings — the frozen analysis hash uses \"71.875\", not 71.875", () => {
    expect(canonicalJson({ score: "71.875" })).toBe('{"score":"71.875"}');
    expect(canonicalJson({ score: "71.875" })).not.toBe('{"score":71.875}');
  });
  it("rejects non-finite numbers instead of silently nulling them (repeat-hash side of the frozen disagreement)", () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ n: Number.POSITIVE_INFINITY })).toThrow(
      /non-finite/,
    );
    expect(() => canonicalJson([Number.NEGATIVE_INFINITY])).toThrow(
      /non-finite/,
    );
  });
});

describe("canonicalJson — strict rejection of non-JSON values", () => {
  it("rejects undefined, functions, symbols and bigints anywhere", () => {
    expect(() => canonicalJson(undefined)).toThrow(/unsupported/);
    expect(() => canonicalJson({ a: undefined })).toThrow(/unsupported/);
    expect(() => canonicalJson([undefined])).toThrow(/unsupported/);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(/unsupported/);
    expect(() => canonicalJson(Symbol("x"))).toThrow(/unsupported/);
    expect(() => canonicalJson(10n)).toThrow(/unsupported/);
  });
  it("passes null, booleans and empty containers through", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson({})).toBe("{}");
    expect(canonicalJson([])).toBe("[]");
    expect(canonicalJson({ a: null, b: [null] })).toBe('{"a":null,"b":[null]}');
  });
});

describe("sha256Hex / hashCanonical — independent oracle via node:crypto", () => {
  it("sha256Hex matches node:crypto on a known vector", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
  it("hashCanonical equals an independent sha256 over the canonical bytes", () => {
    const value = { b: "e\u0301", a: [3, 1, 2], z: { y: 1 } };
    const bytes = Buffer.from(canonicalJson(value), "utf8");
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(hashCanonical(value)).toBe(expected);
    expect(hashCanonical(value)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("canonicalize does not mutate its input", () => {
    const value = { b: 1, a: { d: 2, c: 3 } };
    const before = JSON.stringify(value);
    canonicalJson(value);
    expect(JSON.stringify(value)).toBe(before);
  });
});
