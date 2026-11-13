// T011 — HTML escaping + external-resource scan boundaries (T010).
//
// The existing html-safety tests cover the exporter end to end with a
// few payloads. These unit tests pin the two primitives directly:
// every escape character, the JSON-script escaping, and the full scan
// matrix (each forbidden shape on its own, plus the negative controls
// that must NOT be flagged: escaped payload text and plain-text URLs).

import { describe, it, expect } from "vitest";

import {
  escapeHtml,
  escapeJsonForHtmlScript,
  scanExternalResources,
} from "../../src/export/html-escape.js";

describe("escapeHtml — every character", () => {
  it("escapes & < > \" ' and `", () => {
    expect(escapeHtml(`&<>"'\``)).toBe("&amp;&lt;&gt;&quot;&#39;&#96;");
  });

  it("escapes each character in isolation", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
    expect(escapeHtml("`")).toBe("&#96;");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeHtml("Save 100% — M01: WRAP_TARGET")).toBe("Save 100% — M01: WRAP_TARGET");
    expect(escapeHtml("")).toBe("");
  });

  it("escapes & first: no double-escaping of the entities it inserts", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("stringifies non-strings", () => {
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml(null)).toBe("null");
    expect(escapeHtml(undefined)).toBe("undefined");
    expect(escapeHtml(true)).toBe("true");
  });

  it("escapes a full XSS payload into inert text", () => {
    const payload = `<img src=x onerror=alert(1)>`;
    const out = escapeHtml(payload);
    expect(out).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(out).not.toContain("<img");
  });

  it("escapes attribute-breaking payloads", () => {
    expect(escapeHtml(`" onmouseover="alert(1)`)).toBe("&quot; onmouseover=&quot;alert(1)");
  });
});

describe("escapeJsonForHtmlScript — the JSON block can never break out", () => {
  it("rewrites </script> so the block cannot be terminated", () => {
    const out = escapeJsonForHtmlScript(`{"x":"</script><script>alert(1)</script>"}`);
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c/script\\u003e");
    expect(JSON.parse(out)).toEqual({ x: "</script><script>alert(1)</script>" });
  });

  it("rewrites < and > everywhere, keeping the JSON value identical", () => {
    const json = `{"a":"<b> & </b>"}`;
    const out = escapeJsonForHtmlScript(json);
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(JSON.parse(out)).toEqual({ a: "<b> & </b>" });
  });

  it("rewrites U+2028 / U+2029 line separators", () => {
    const json = `{"a":"x y z"}`;
    const out = escapeJsonForHtmlScript(json);
    expect(out).not.toContain(" ");
    expect(out).not.toContain(" ");
    expect(JSON.parse(out)).toEqual({ a: "x y z" });
  });

  it("leaves plain JSON untouched", () => {
    expect(escapeJsonForHtmlScript(`{"a":1,"b":"x"}`)).toBe(`{"a":1,"b":"x"}`);
  });
});

describe("scanExternalResources — forbidden shapes", () => {
  it("flags each forbidden resource tag", () => {
    for (const tag of ["link", "img", "iframe", "video", "audio", "embed", "object", "source", "track"]) {
      const hits = scanExternalResources(`<${tag} src="x">`);
      expect(hits.length, tag).toBeGreaterThan(0);
    }
  });

  it("flags a script with a src attribute", () => {
    expect(scanExternalResources(`<script src="https://example.com/x.js"></script>`).length).toBeGreaterThan(0);
  });

  it("flags an executable script tag but allows the JSON data block", () => {
    expect(scanExternalResources(`<script>alert(1)</script>`).length).toBeGreaterThan(0);
    expect(scanExternalResources(`<script type="application/json">{"a":1}</script>`)).toEqual([]);
    expect(scanExternalResources(`<script type="text/javascript">x</script>`).length).toBeGreaterThan(0);
  });

  it("flags event-handler attributes (case-insensitive, any tag)", () => {
    expect(scanExternalResources(`<div onclick="x()">t</div>`).length).toBeGreaterThan(0);
    expect(scanExternalResources(`<BUTTON ONCLICK="x()">t</BUTTON>`).length).toBeGreaterThan(0);
    expect(scanExternalResources(`<svg onload="x()">`).length).toBeGreaterThan(0);
  });

  it("flags dangerous URL schemes", () => {
    expect(scanExternalResources(`<a href="javascript:alert(1)">x</a>`).length).toBeGreaterThan(0);
    expect(scanExternalResources(`<a href="data:text/html,<script>">x</a>`).length).toBeGreaterThan(0);
    expect(scanExternalResources(`<a href="vbscript:msgbox">x</a>`).length).toBeGreaterThan(0);
  });

  it("flags absolute external URLs", () => {
    expect(scanExternalResources(`<a href="https://example.com/">x</a>`).length).toBeGreaterThan(0);
    expect(scanExternalResources(`<a href="//example.com/x">x</a>`).length).toBeGreaterThan(0);
  });

  it("flags CSS @import and url() inside <style>", () => {
    expect(scanExternalResources(`<style>@import url("https://example.com/x.css");</style>`).length).toBeGreaterThan(0);
    expect(scanExternalResources(`<style>.a{background:url(https://example.com/x.png)}</style>`).length).toBeGreaterThan(0);
  });

  it("does NOT flag escaped payload text (no real tag exists)", () => {
    const escaped = `&lt;img src=x onerror=alert(1)&gt; &lt;script src="https://example.com/x.js"&gt;`;
    expect(scanExternalResources(escaped)).toEqual([]);
  });

  it("does NOT flag a plain-text URL mention", () => {
    expect(scanExternalResources(`<p>see https://example.com/ for details</p>`)).toEqual([]);
  });

  it("does NOT flag relative links or plain markup", () => {
    expect(scanExternalResources(`<a href="/report.json">download</a>`)).toEqual([]);
    expect(scanExternalResources(`<div class="row"><span>STABLE</span></div>`)).toEqual([]);
  });

  it("does NOT flag an inline <style> with no @import/url()", () => {
    expect(scanExternalResources(`<style>.a{color:red}</style>`)).toEqual([]);
  });
});
