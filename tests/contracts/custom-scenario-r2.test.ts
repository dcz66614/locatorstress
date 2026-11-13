// FIX-R2-01 — regression tests for P022-R2-P1-01 (custom HTML safety
// bypass: <script/> self-closing, SVG script, iframe srcdoc, unquoted
// external URLs / event handlers).
//
// Pure validation: no browser, no server. The execution-layer proof
// (javaScriptEnabled:false + live Chromium repro) lives in
// tests/api/custom-scenario-r2-browser.test.ts.
//
// These tests FAIL on the pre-fix regex-only validator and PASS after
// the structured-parser fix. See handoff/FIX-R2-01/REPORT.md.

import { describe, it, expect } from "vitest";

import { validateCustomHtmlSafety } from "../../src/contracts/custom-scenario.js";

const SCRIPT_REASON = "script elements are not allowed in custom HTML";
const EXTERNAL_REASON =
  "external URLs are not allowed in custom HTML (synthetic HTML only)";
const HANDLER_REASON =
  "inline event-handler attributes are not allowed in custom HTML";
const JS_URI_REASON = "javascript: URIs are not allowed in custom HTML";

// GPT's exact payloads from the R2 verdict (P022-R2-P1-01).
const GPT_PROBE = "<script/>window.__pwned=1</script>";
const GPT_PAYLOAD =
  '<main>\n  <button class="primary">Save</button>\n  <script/>document.querySelector("button").classList.remove("primary")</script>\n</main>';
const GPT_UNQUOTED_URL = "<img src=https://example.invalid/a.png>";

describe("validateCustomHtmlSafety — FIX-R2-01 structured parsing", () => {
  it("rejects the exact GPT <script/> probe and full payload", () => {
    expect(validateCustomHtmlSafety(GPT_PROBE)).toContain(SCRIPT_REASON);
    expect(validateCustomHtmlSafety(GPT_PAYLOAD)).toContain(SCRIPT_REASON);
  });

  it("rejects <script> in any form, case and whitespace", () => {
    for (const html of [
      "<script>alert(1)</script>",
      "<SCRIPT>alert(1)</SCRIPT>",
      "<ScRiPt/>alert(1)</ScRiPt>",
      "<script\n>alert(1)</script>",
      "<script\tsrc=x></script>",
      "<script >alert(1)</script>",
      '<script src="https://example.com/x.js"></script>',
      "<script/>",
    ]) {
      expect(validateCustomHtmlSafety(html)).toContain(SCRIPT_REASON);
    }
  });

  it("rejects script elements nested inside SVG / MathML foreign content", () => {
    expect(
      validateCustomHtmlSafety("<svg><script>alert(1)</script></svg>"),
    ).toContain(SCRIPT_REASON);
    expect(
      validateCustomHtmlSafety(
        '<svg><circle cx="5" cy="5" r="4"/><script>alert(1)</script></svg>',
      ),
    ).toContain(SCRIPT_REASON);
    expect(
      validateCustomHtmlSafety(
        "<math><mi><script>alert(1)</script></mi></math>",
      ),
    ).toContain(SCRIPT_REASON);
  });

  it("rejects <iframe srcdoc> carrying a script (quoted and self-closing)", () => {
    expect(
      validateCustomHtmlSafety(
        '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
      ),
    ).toContain(SCRIPT_REASON);
    expect(
      validateCustomHtmlSafety(
        '<iframe srcdoc="<script/>alert(1)</script>"></iframe>',
      ),
    ).toContain(SCRIPT_REASON);
    expect(
      validateCustomHtmlSafety(
        "<iframe srcdoc=\"<svg><script>alert(1)</script></svg>\"></iframe>",
      ),
    ).toContain(SCRIPT_REASON);
  });

  it("rejects external resource URLs in any attribute quoting", () => {
    expect(validateCustomHtmlSafety(GPT_UNQUOTED_URL)).toContain(
      EXTERNAL_REASON,
    );
    expect(
      validateCustomHtmlSafety("<img src=//example.invalid/a.png>"),
    ).toContain(EXTERNAL_REASON);
    expect(
      validateCustomHtmlSafety('<a href=https://example.com>x</a>'),
    ).toContain(EXTERNAL_REASON);
    expect(
      validateCustomHtmlSafety("<form action=https://example.com/x></form>"),
    ).toContain(EXTERNAL_REASON);
    expect(
      validateCustomHtmlSafety(
        '<img srcset="https://example.com/a.png 1x">',
      ),
    ).toContain(EXTERNAL_REASON);
    expect(
      validateCustomHtmlSafety("<img srcset=https://example.com/a.png 1x>"),
    ).toContain(EXTERNAL_REASON);
    // Quoted forms were already rejected pre-fix (no regression).
    expect(
      validateCustomHtmlSafety('<img src="https://example.com/x.png">'),
    ).toContain(EXTERNAL_REASON);
  });

  it("rejects event-handler attributes in any quoting (incl. unquoted and no-space)", () => {
    expect(
      validateCustomHtmlSafety("<img src=x onerror=alert(1)>"),
    ).toContain(HANDLER_REASON);
    expect(validateCustomHtmlSafety("<svg onload=alert(1)>")).toContain(
      HANDLER_REASON,
    );
    expect(
      validateCustomHtmlSafety('<img src="x"onerror="alert(1)">'),
    ).toContain(HANDLER_REASON);
    expect(
      validateCustomHtmlSafety('<div ONCLICK="go()">x</div>'),
    ).toContain(HANDLER_REASON);
    // Quoted forms were already rejected pre-fix (no regression).
    expect(
      validateCustomHtmlSafety('<button onclick="go()">x</button>'),
    ).toContain(HANDLER_REASON);
  });

  it("rejects javascript: URIs incl. entity-obfuscated schemes", () => {
    expect(
      validateCustomHtmlSafety('<a href="javascript:go()">x</a>'),
    ).toContain(JS_URI_REASON);
    expect(
      validateCustomHtmlSafety('<a href="JaVaScRiPt:go()">x</a>'),
    ).toContain(JS_URI_REASON);
    expect(
      validateCustomHtmlSafety('<a href="java&#115;cript:go()">x</a>'),
    ).toContain(JS_URI_REASON);
    expect(
      validateCustomHtmlSafety('<a href="java&#x73;cript:go()">x</a>'),
    ).toContain(JS_URI_REASON);
    expect(
      validateCustomHtmlSafety('<button formaction="javascript:go()">x</button>'),
    ).toContain(JS_URI_REASON);
  });

  it("rejects forbidden elements and refresh meta in any quoting", () => {
    expect(
      validateCustomHtmlSafety('<link rel=stylesheet href=a.css>'),
    ).toContain("link elements are not allowed in custom HTML");
    expect(
      validateCustomHtmlSafety("<base href=https://example.com>"),
    ).toContain("base elements are not allowed in custom HTML");
    expect(
      validateCustomHtmlSafety("<object data=https://example.com/x>"),
    ).toContain("object elements are not allowed in custom HTML");
    expect(
      validateCustomHtmlSafety("<embed src=https://example.com/x>"),
    ).toContain("embed elements are not allowed in custom HTML");
    expect(
      validateCustomHtmlSafety('<meta http-equiv=refresh content="0">'),
    ).toContain("refresh meta elements are not allowed in custom HTML");
    expect(
      validateCustomHtmlSafety(
        '<meta http-equiv="REFRESH" content="0;url=https://example.com">',
      ),
    ).toContain("refresh meta elements are not allowed in custom HTML");
    expect(
      validateCustomHtmlSafety('<iframe src=https://example.com></iframe>'),
    ).toContain(
      "iframe src= is not allowed in custom HTML (use srcdoc only)",
    );
  });

  it("still accepts valid synthetic HTML (positive controls)", () => {
    for (const html of [
      '<main><button class="primary">Save</button></main>',
      '<iframe srcdoc="<button>Decoy</button>"></iframe>',
      '<svg><circle cx="5" cy="5" r="4"/></svg>',
      '<main><a href="#frag">x</a><img src="pic.png"><img src=pic.png></main>',
      "<style>.a{color:red}</style>",
      '<div data-x="https://example.com">x</div>',
      "<p>see https://example.com for details</p>",
      '<input type="text" value="onload">',
      '<main><form><button type="submit" class="primary">Save</button><button type="button" class="secondary">Cancel</button></form></main>',
    ]) {
      expect(validateCustomHtmlSafety(html)).toEqual([]);
    }
  });
});
