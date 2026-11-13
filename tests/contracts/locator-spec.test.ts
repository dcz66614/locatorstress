// T011 — LocatorSpec validation boundaries (PROJECT_BOOK §3.3, §11.1).
//
// No dedicated unit test file existed for validateLocatorSpec /
// parseLocatorSpec / normalizeLocatorSpec: they were only exercised
// indirectly through API routes and golden fixtures. This file pins
// every validation rule with positive, negative and boundary cases,
// including the exact error strings the API surfaces.

import { describe, it, expect } from "vitest";

import {
  normalizeLocatorSpec,
  parseLocatorSpec,
  validateLocatorSpec,
} from "../../src/contracts/locator.js";

describe("validateLocatorSpec — valid specs", () => {
  it("accepts a minimal css spec", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "button.primary" })).toEqual([]);
  });

  it("accepts a minimal xpath spec", () => {
    expect(validateLocatorSpec({ kind: "xpath", selector: "//button[1]" })).toEqual([]);
  });

  it("accepts a minimal role spec with no name", () => {
    expect(validateLocatorSpec({ kind: "role", role: "button" })).toEqual([]);
  });

  it("accepts a full role spec: name + exact + includeHidden + framePath + index", () => {
    expect(
      validateLocatorSpec({
        kind: "role",
        role: "button",
        name: "Save",
        exact: true,
        includeHidden: false,
        framePath: ["iframe.a", "iframe.b"],
        index: 0,
      }),
    ).toEqual([]);
  });

  it("accepts index 0 (boundary: first element) and a large index", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", index: 0 })).toEqual([]);
    expect(validateLocatorSpec({ kind: "css", selector: "a", index: 999 })).toEqual([]);
  });

  it("accepts explicit null / undefined index", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", index: null })).toEqual([]);
    expect(validateLocatorSpec({ kind: "css", selector: "a", index: undefined })).toEqual([]);
  });

  it("accepts an empty framePath (boundary: 0 layers)", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", framePath: [] })).toEqual([]);
  });

  it("accepts a 2-layer framePath (boundary: maximum depth)", () => {
    expect(
      validateLocatorSpec({ kind: "css", selector: "a", framePath: ["iframe.a", "iframe.b"] }),
    ).toEqual([]);
  });
});

describe("validateLocatorSpec — kind and selector", () => {
  it("rejects a missing kind", () => {
    expect(validateLocatorSpec({ selector: "a" })).toContain(
      'kind must be one of "css", "xpath", "role"',
    );
  });

  it("rejects an unknown kind", () => {
    expect(validateLocatorSpec({ kind: "text", selector: "Save" })).toContain(
      'kind must be one of "css", "xpath", "role"',
    );
  });

  it("rejects a non-string kind", () => {
    expect(validateLocatorSpec({ kind: 42, selector: "a" }).length).toBeGreaterThan(0);
  });

  it("rejects an empty css selector", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "" })).toContain(
      'selector must be a non-empty string when kind is "css"',
    );
  });

  it("rejects a missing css selector", () => {
    expect(validateLocatorSpec({ kind: "css" })).toContain(
      'selector must be a non-empty string when kind is "css"',
    );
  });

  it("rejects an empty xpath selector", () => {
    expect(validateLocatorSpec({ kind: "xpath", selector: "" })).toContain(
      'selector must be a non-empty string when kind is "xpath"',
    );
  });

  it("rejects a missing role name", () => {
    expect(validateLocatorSpec({ kind: "role" })).toContain(
      'role must be a non-empty string when kind is "role"',
    );
  });

  it("rejects an empty role name", () => {
    expect(validateLocatorSpec({ kind: "role", role: "" })).toContain(
      'role must be a non-empty string when kind is "role"',
    );
  });

  it("rejects a selector key on a role spec", () => {
    expect(validateLocatorSpec({ kind: "role", role: "button", selector: "button" })).toContain(
      '"selector" is not allowed when kind is "role"',
    );
  });

  it("rejects role/name/exact keys on a css spec", () => {
    const errors = validateLocatorSpec({ kind: "css", selector: "a", role: "button" });
    expect(errors).toContain('"role" is not allowed when kind is "css"');
    expect(validateLocatorSpec({ kind: "css", selector: "a", name: "Save" })).toContain(
      '"name" is not allowed when kind is "css"',
    );
    expect(validateLocatorSpec({ kind: "css", selector: "a", exact: true })).toContain(
      '"exact" is not allowed when kind is "css"',
    );
  });

  it("rejects an unknown key", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", filter: "x" })).toContain(
      "unknown key: filter",
    );
  });

  it("rejects non-object specs", () => {
    expect(validateLocatorSpec(null)).toEqual(["spec must be a plain object"]);
    expect(validateLocatorSpec("css")).toEqual(["spec must be a plain object"]);
    expect(validateLocatorSpec(42)).toEqual(["spec must be a plain object"]);
    expect(validateLocatorSpec(["css"])).toEqual(["spec must be a plain object"]);
    expect(validateLocatorSpec(undefined)).toEqual(["spec must be a plain object"]);
  });
});

describe("validateLocatorSpec — framePath and index boundaries", () => {
  it("rejects a 3-layer framePath (boundary: one over the maximum)", () => {
    expect(
      validateLocatorSpec({
        kind: "css",
        selector: "a",
        framePath: ["iframe.a", "iframe.b", "iframe.c"],
      }),
    ).toContain("framePath must contain at most 2 entries");
  });

  it("rejects a non-array framePath", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", framePath: "iframe.a" })).toContain(
      "framePath must be an array of 0-2 non-empty strings",
    );
  });

  it("rejects an empty framePath entry", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", framePath: [""] })).toContain(
      "framePath[0] must be a non-empty string",
    );
    expect(
      validateLocatorSpec({ kind: "css", selector: "a", framePath: ["iframe.a", ""] }),
    ).toContain("framePath[1] must be a non-empty string");
  });

  it("rejects a non-string framePath entry", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", framePath: [7] })).toContain(
      "framePath[0] must be a non-empty string",
    );
  });

  it("rejects a negative index (boundary: -1)", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", index: -1 })).toContain(
      "index must be null/undefined or a non-negative integer",
    );
  });

  it("rejects a fractional index (boundary: 1.5)", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", index: 1.5 })).toContain(
      "index must be null/undefined or a non-negative integer",
    );
  });

  it("rejects a string index", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", index: "0" })).toContain(
      "index must be null/undefined or a non-negative integer",
    );
  });

  it("rejects an empty role name when present", () => {
    expect(validateLocatorSpec({ kind: "role", role: "button", name: "" })).toContain(
      "name must be a non-empty string if present",
    );
  });

  it("rejects a non-string role name when present", () => {
    expect(validateLocatorSpec({ kind: "role", role: "button", name: 3 })).toContain(
      "name must be a non-empty string if present",
    );
  });

  it("rejects a non-boolean exact / includeHidden", () => {
    expect(validateLocatorSpec({ kind: "role", role: "button", exact: "yes" })).toContain(
      "exact must be a boolean if present",
    );
    expect(validateLocatorSpec({ kind: "role", role: "button", includeHidden: 1 })).toContain(
      "includeHidden must be a boolean if present",
    );
  });
});

describe("parseLocatorSpec / normalizeLocatorSpec", () => {
  it("parse returns the spec unchanged when valid", () => {
    const spec = { kind: "css", selector: "a" };
    expect(parseLocatorSpec(spec)).toEqual(spec);
  });

  it("parse throws with the joined errors when invalid", () => {
    expect(() => parseLocatorSpec({ kind: "css" })).toThrow(/Invalid LocatorSpecV1/);
    expect(() => parseLocatorSpec({ kind: "css" })).toThrow(/selector must be a non-empty string/);
  });

  it("normalize fills defaults: exact/includeHidden false, framePath [], index null", () => {
    expect(normalizeLocatorSpec({ kind: "css", selector: "a" })).toEqual({
      kind: "css",
      selector: "a",
      exact: false,
      includeHidden: false,
      framePath: [],
      index: null,
    });
  });

  it("normalize keeps explicit values and drops nothing it was given", () => {
    expect(
      normalizeLocatorSpec({
        kind: "role",
        role: "button",
        name: "Save",
        exact: true,
        includeHidden: true,
        framePath: ["iframe.a"],
        index: 2,
      }),
    ).toEqual({
      kind: "role",
      role: "button",
      name: "Save",
      exact: true,
      includeHidden: true,
      framePath: ["iframe.a"],
      index: 2,
    });
  });

  it("normalize copies framePath (mutating the copy does not mutate the input)", () => {
    const input = { kind: "css" as const, selector: "a", framePath: ["iframe.a"] };
    const out = normalizeLocatorSpec(input);
    out.framePath!.push("iframe.b");
    expect(input.framePath).toEqual(["iframe.a"]);
  });
});
