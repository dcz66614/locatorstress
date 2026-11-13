// T010 — HTML escaping + external-resource scanning for the offline
// HTML exporter (IMPLEMENTATION_PLAN T010; PROJECT_BOOK §7.3, §11.4).
//
// Rules:
//   - Every piece of report text rendered into the HTML goes through
//     escapeHtml(). There is no innerHTML-style interpolation of raw
//     report data anywhere in the exporter.
//   - The full report JSON is embedded in a single
//     <script type="application/json"> block, escaped with
//     escapeJsonForHtmlScript() so a payload can never break out of
//     the block (notably `</script>` becomes \u003c/script\u003e).
//     The block is data, not code: browsers never execute it, and the
//     report's CSP meta tag sets script-src 'none' as defence in depth.
//   - scanExternalResources() inspects only REAL markup (tags and
//     <style> bodies). Escaped payload text such as
//     `&lt;img src=x onerror=...&gt;` contains no `<...>` tag, so it
//     is never mistaken for a resource. Conversely any real <img>,
//     <script src>, <link>, <iframe>, event-handler attribute,
//     javascript:/data: URL or CSS @import/url() is reported.

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

/** Escape text for insertion into HTML text nodes or double-quoted attributes. */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"'`]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * Escape a JSON string for safe embedding inside a
 * <script type="application/json"> block. The result still parses as
 * the same JSON value; only the characters that could terminate the
 * block or start markup are rewritten as \uXXXX escapes.
 */
export function escapeJsonForHtmlScript(json: string): string {
  return json
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const FORBIDDEN_TAGS = new Set([
  "link",
  "img",
  "iframe",
  "video",
  "audio",
  "embed",
  "object",
  "source",
  "track",
]);

/**
 * Scan HTML for anything that could fetch an external (or any
 * non-inline) resource, or execute code. Returns a list of human
 * readable hits; empty means the document is self-contained.
 *
 * Checks, per real tag: forbidden resource tags, <script> with a src
 * or with any type other than application/json, event-handler
 * attributes (on*), javascript:/data:/vbscript: URLs, and absolute
 * http(s) href/src values. <style> bodies are checked for @import
 * and url(). Plain text that merely mentions a URL is NOT a hit —
 * text never fetches.
 */
export function scanExternalResources(html: string): string[] {
  const hits: string[] = [];

  for (const match of html.matchAll(/<([a-zA-Z][^>]{0,4000})>/g)) {
    const tagInner = match[1]!;
    const tagName = tagInner.split(/[\s/>]/, 1)[0]!.toLowerCase();
    const tagText = match[0]!;
    if (FORBIDDEN_TAGS.has(tagName)) {
      hits.push(`forbidden resource tag <${tagName}>: ${truncate(tagText)}`);
      continue;
    }
    if (tagName === "script") {
      const typeMatch = /type\s*=\s*["']([^"']*)["']/i.exec(tagInner);
      const type = typeMatch?.[1]?.trim().toLowerCase() ?? "";
      if (/\ssrc\s*=/i.test(tagInner)) {
        hits.push(`script with src attribute: ${truncate(tagText)}`);
      } else if (type !== "application/json") {
        hits.push(`executable script tag (type=${JSON.stringify(type)}): ${truncate(tagText)}`);
      }
      continue;
    }
    if (/\son[a-z]+\s*=/i.test(tagInner)) {
      hits.push(`event-handler attribute in <${tagName}>: ${truncate(tagText)}`);
    }
    if (/\s(?:href|src|action|formaction|poster|background)\s*=\s*["']\s*(?:javascript|data|vbscript):/i.test(tagInner)) {
      hits.push(`dangerous URL scheme in <${tagName}>: ${truncate(tagText)}`);
    }
    if (/\s(?:href|src|action|formaction|poster|background)\s*=\s*["']\s*(?:https?:)?\/\//i.test(tagInner)) {
      hits.push(`absolute external URL in <${tagName}>: ${truncate(tagText)}`);
    }
  }

  for (const styleMatch of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const body = styleMatch[1] ?? "";
    if (/@import/i.test(body)) {
      hits.push("CSS @import in <style>");
    }
    if (/url\s*\(/i.test(body)) {
      hits.push("CSS url() in <style>");
    }
  }

  return hits;
}

function truncate(text: string): string {
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}
