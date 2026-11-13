// T006 — Forbidden-field scan for canonical bytes (PROJECT_BOOK §6).
//
// Canonical results must not contain: wall-clock time, createdAt,
// random UUIDs, PIDs, machine absolute paths, usernames, hostnames, CDP
// temporary object IDs, environment variable values, or real personal
// data. This scanner checks the actual canonical bytes against an
// explicit, listed rule set; every rule is a real test on the bytes, and
// the rule list itself is asserted non-empty by the tests (no silent
// "scan" that checks nothing).
//
// Deliberate limits (see T006_HASH_REPORT.json limitations):
//   - Environment variable VALUES cannot be scanned without knowing
//     them. They are excluded structurally instead: no builder in
//     src/canonical/ reads process.env, and the literal values that
//     would leak (repo root, $HOME, tmpdir, hostname) are scanned.
//   - The username is only matched in a path/identifier context
//     ("/root/", "root@", '"root":' ...), never as a bare substring:
//     the frozen fixtures legitimately contain the word "root" inside
//     "shadowrootmode" (F022–F024), and a bare-substring rule would
//     false-positive on frozen data. The current user ("root") is
//     therefore only flagged when it appears as a path component or
//     identifier, which is how a leaked username would actually look.
//   - The fixed seed contains the date "2026-11-10" (no time). The
//     wall-clock rule requires a time component, so the seed does not
//     trip it; a date alone is not a wall clock.
//   - A generic "any absolute Unix path" rule is NOT included: fixture
//     HTML legitimately contains "/" (tags, XPath, URLs in selectors),
//     so such a rule would false-positive. Absolute paths are covered
//     by the exact literals that could leak (repoRoot, homeDir, tmpDir)
//     plus the Windows drive-letter rule.

import { hostname, tmpdir, userInfo } from "node:os";

export interface ForbiddenScanContext {
  /** Repo root, e.g. /home/hatch/workspace/p022-locatorstress. */
  repoRoot: string;
  /** $HOME, e.g. /home/hatch. */
  homeDir: string;
  /** os.tmpdir(), defaults to the live value. */
  tmpDir: string;
  /** os.hostname(), defaults to the live value. */
  hostname: string;
  /** os.userInfo().username, defaults to the live value. */
  username: string;
}

export function defaultForbiddenScanContext(
  repoRoot: string,
  homeDir: string,
): ForbiddenScanContext {
  let username = "";
  try {
    username = userInfo().username;
  } catch {
    username = "";
  }
  return {
    repoRoot,
    homeDir,
    tmpDir: tmpdir(),
    hostname: hostname(),
    username,
  };
}

export interface ForbiddenScanRule {
  id: string;
  description: string;
  /** All matching excerpts (each truncated to 40 chars). */
  find: (text: string) => string[];
}

export interface ForbiddenScanHit {
  ruleId: string;
  count: number;
  /** First match excerpt (truncated), or null when there is no hit. */
  sample: string | null;
}

export interface ForbiddenScanResult {
  /** Rule ids that were run, in order. */
  rulesRun: string[];
  hits: ForbiddenScanHit[];
  totalHits: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regexRule(
  id: string,
  description: string,
  pattern: RegExp,
): ForbiddenScanRule {
  return {
    id,
    description,
    find: (text: string) => {
      const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
      const out: string[] = [];
      for (const m of text.matchAll(re)) {
        out.push(m[0].slice(0, 40));
        if (out.length >= 5) break;
      }
      return out;
    },
  };
}

function literalRule(
  id: string,
  description: string,
  literals: string[],
): ForbiddenScanRule {
  const needles = literals.filter((s) => s.length > 0);
  return {
    id,
    description,
    find: (text: string) => {
      const out: string[] = [];
      for (const n of needles) {
        if (text.includes(n)) out.push(n.slice(0, 40));
      }
      return out;
    },
  };
}

/** The full rule set. Every id below is listed in the T006 report. */
export function buildForbiddenScanRules(
  ctx: ForbiddenScanContext,
): ForbiddenScanRule[] {
  const rules: ForbiddenScanRule[] = [
    regexRule(
      "created-at",
      "Literal createdAt / created_at keys (wall-clock metadata)",
      /createdAt|created_at/,
    ),
    regexRule(
      "wall-clock-iso",
      "ISO-8601 timestamp with a time component (YYYY-MM-DDTHH:MM...); a bare date such as the fixed seed does not match",
      /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?/,
    ),
    regexRule(
      "epoch-millis",
      "13-digit millisecond epoch timestamp starting 16/17",
      /\b1[67]\d{11}\b/,
    ),
    regexRule(
      "uuid",
      "UUID (8-4-4-4-12 hex, either case)",
      /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
    ),
    regexRule(
      "cdp-object-id",
      "CDP temporary object id keys (objectId / remoteObjectId)",
      /objectId\s*["':=]|remoteObjectId/,
    ),
    regexRule(
      "cdp-dotted-id",
      "CDP-style dotted numeric id (≥6 digits . digits . digits)",
      /\b\d{6,}\.\d+\.\d+\b/,
    ),
    regexRule(
      "pid",
      "Process id (JSON \"pid\": key, pid:/pid=, processId, process.pid)",
      /"pid"\s*:\s*\d+|\bpid\s*[:=]\s*\d+|\bprocessId\b|process\.pid/i,
    ),
    regexRule(
      "windows-absolute-path",
      "Windows absolute path (drive letter + backslash)",
      /[A-Za-z]:\\[\w.-]+/,
    ),
    literalRule(
      "absolute-path-literal",
      "Machine absolute path literals: repo root, $HOME, tmpdir",
      [ctx.repoRoot, ctx.homeDir, ctx.tmpDir],
    ),
    literalRule(
      "hostname-literal",
      "Machine hostname literal",
      [ctx.hostname],
    ),
  ];
  if (ctx.username.length > 0) {
    rules.push(
      regexRule(
        "username-in-path",
        "Username as a path component or identifier (not a bare substring; fixture HTML contains 'shadowrootmode')",
        new RegExp(
          `(^|[/\\\\@"':=])${escapeRegExp(ctx.username)}([/\\\\@"':]|$)`,
        ),
      ),
    );
  }
  return rules;
}

/** Scan canonical JSON text (or any text) against every rule. */
export function scanForbiddenFields(
  text: string,
  ctx: ForbiddenScanContext,
): ForbiddenScanResult {
  const rules = buildForbiddenScanRules(ctx);
  const hits: ForbiddenScanHit[] = [];
  let totalHits = 0;
  for (const rule of rules) {
    const matches = rule.find(text);
    if (matches.length > 0) {
      totalHits += matches.length;
      hits.push({
        ruleId: rule.id,
        count: matches.length,
        sample: matches[0] ?? null,
      });
    }
  }
  return { rulesRun: rules.map((r) => r.id), hits, totalHits };
}
