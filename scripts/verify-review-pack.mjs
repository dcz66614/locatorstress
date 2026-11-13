// FIX-P022-T013-01 — verify the T013 independent-review pack (handoff/T013/).
//
// Checks, all read-only (never modifies the review pack or any other file):
//   1. Presence + non-emptiness of every review-pack file (18 files:
//      REVIEW_INDEX.md, REVIEW_PACK_01..10.md, COVERAGE_MATRIX.csv,
//      INDEPENDENT_REVIEW.md, TASK_REPORT.md, sha256.txt,
//      test_commands.txt, unresolved_items.md, hash_recompute.py).
//   2. COVERAGE_MATRIX.csv covers every file under src/ (no omissions),
//      with no duplicate paths, and the sha256 column matches disk for
//      every src/ row.
//   3. Every one of the 148 entries in sha256.txt matches the file on
//      disk (evidence + src + scripts + package.json + package-lock.json).
//
// Frozen baseline: FIX-R2-03 re-baselined the review pack at the R2
// freeze (frozen commit a834eea, full SHA below). COVERAGE_MATRIX.csv
// and sha256.txt were regenerated from that frozen tree, so the pack
// records the sha256 of every frozen file and the working tree is
// expected to match it EXACTLY — KNOWN_FIX_DELTAS is therefore empty
// at this baseline. The baseline is pinned to that exact commit, never
// to the branch tip: once the freeze commit lands, the tip moves past
// the frozen commit and the tip's copy of a file no longer equals the
// frozen value, so a tip-based check would fail after the commit. A
// mismatch for a KNOWN_FIX_DELTAS file is accepted ONLY when
// `git show <FROZEN_COMMIT>:<path>` still hashes to the frozen value
// recorded in the review pack — that proves the frozen file is
// untouched in git history and the working-tree delta is exactly this
// FIX's intentional change. Any other mismatch, a missing file, an
// empty file, or a delta git cannot prove (git unavailable, commit or
// path missing) fails.
// (History: at the T013 baseline a78d765 the deltas were the T013 FIX
// round — package.json, src/canonical/canonical-json.ts,
// src/contracts/report.ts, src/ui/app.js,
// evidence/s4/T012_E2E_OFFLINE_PERF_REPORT.md,
// evidence/s4/T011_MUTATION_RESULTS.json,
// scripts/t011-mutation-runner.mjs. Those deltas are now baked into
// the d26a3cc frozen tree. The R1 deltas (frozen commit 23a5a91) and
// the R2 deltas (FIX-R2-01's 4 files + FIX-R2-02's 4 files, plus this
// script's own KNOWN_FIX_DELTAS edits) are baked into the a834eea
// frozen tree, so they no longer appear as deltas. The script's
// own-hash problem from the R2 rounds clears at this re-baseline:
// the script's hash now matches the regenerated pack.)
//
// Usage: npm run verify:review-pack
// Exit:  0 iff all checks pass; 1 otherwise (failures printed to stderr).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(join(fileURLToPath(import.meta.url), "..", ".."));
const PACK = join(ROOT, "handoff", "T013");

// The frozen commit the review pack was built from (full SHA of
// a834eea, the R2 frozen commit). Used as the explicit baseline for the
// KNOWN_FIX_DELTAS exceptions below; never derive it from the branch tip.
const FROZEN_COMMIT = "a834eeae36f816c2f273677636127facb6902dbf";

// Re-baselined at FIX-R2-03: the pack was regenerated from the frozen
// tree itself, so there are no legitimate deltas at this baseline.
// Future FIX rounds add entries here (with the frozen baseline intact
// in git history as proof).
const KNOWN_FIX_DELTAS = {};


const REQUIRED_FILES = [
  "REVIEW_INDEX.md",
  "REVIEW_PACK_01.md",
  "REVIEW_PACK_02.md",
  "REVIEW_PACK_03.md",
  "REVIEW_PACK_04.md",
  "REVIEW_PACK_05.md",
  "REVIEW_PACK_06.md",
  "REVIEW_PACK_07.md",
  "REVIEW_PACK_08.md",
  "REVIEW_PACK_09.md",
  "REVIEW_PACK_10.md",
  "COVERAGE_MATRIX.csv",
  "INDEPENDENT_REVIEW.md",
  "TASK_REPORT.md",
  "sha256.txt",
  "test_commands.txt",
  "unresolved_items.md",
  "hash_recompute.py",
];

const failures = [];
const notes = [];

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// Accept a mismatch for a known FIX file ONLY when the frozen baseline
// is intact: `git show <FROZEN_COMMIT>:<path>` must hash to the frozen
// value recorded in the review pack. That proves the frozen file is
// untouched in git history and the working-tree delta is exactly this
// FIX's intentional change. Returns { ok: true, note } on acceptance,
// { ok: false, reason } otherwise — a path outside KNOWN_FIX_DELTAS,
// or a baseline git cannot prove, is never accepted.
function checkKnownFixDelta(path, frozenHash) {
  const delta = KNOWN_FIX_DELTAS[path];
  if (delta === undefined) {
    return { ok: false, reason: "not a known FIX delta" };
  }
  const git = spawnSync("git", ["show", `${FROZEN_COMMIT}:${path}`], {
    cwd: ROOT,
  });
  if (git.error !== undefined || git.status !== 0) {
    return {
      ok: false,
      reason:
        `git show ${FROZEN_COMMIT}:${path} failed` +
        " — cannot prove the frozen baseline",
    };
  }
  const baselineHash = createHash("sha256").update(git.stdout).digest("hex");
  if (baselineHash !== frozenHash) {
    return {
      ok: false,
      reason:
        `${FROZEN_COMMIT}:${path} no longer matches the frozen hash` +
        " — the baseline itself changed",
    };
  }
  return {
    ok: true,
    note:
      `${path}: working-tree hash differs from the frozen value, ` +
      `but ${FROZEN_COMMIT}:${path} still matches it — accepted as the ` +
      `intentional ${delta.fix} delta (${delta.reason})`,
  };
}

function listFilesRecursive(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

// --- Check 1: presence + non-emptiness -------------------------------------
let present = 0;
for (const name of REQUIRED_FILES) {
  const path = join(PACK, name);
  if (!existsSync(path)) {
    failures.push(`missing review-pack file: handoff/T013/${name}`);
    continue;
  }
  const size = statSync(path).size;
  if (size === 0) {
    failures.push(`empty review-pack file (0 bytes): handoff/T013/${name}`);
    continue;
  }
  present += 1;
}
console.log(
  `[1/3] review-pack files: ${present}/${REQUIRED_FILES.length} present and non-empty`,
);

// --- Check 2: COVERAGE_MATRIX.csv covers all of src/ -----------------------
const matrixPath = join(PACK, "COVERAGE_MATRIX.csv");
const matrixRows = new Map(); // rel path -> sha256 from the matrix
if (existsSync(matrixPath) && statSync(matrixPath).size > 0) {
  const lines = readFileSync(matrixPath, "utf8").split("\n");
  const header = lines[0].split(",");
  const pathCol = header.indexOf("path");
  const shaCol = header.indexOf("sha256");
  if (pathCol === -1 || shaCol === -1) {
    failures.push("COVERAGE_MATRIX.csv: missing 'path' or 'sha256' column");
  } else {
    for (const line of lines.slice(1)) {
      if (line.trim() === "") continue;
      const cols = line.split(",");
      const p = cols[pathCol];
      if (matrixRows.has(p)) failures.push(`COVERAGE_MATRIX.csv: duplicate path ${p}`);
      matrixRows.set(p, cols[shaCol]);
    }
  }
}
const srcFiles = listFilesRecursive(join(ROOT, "src")).map((f) =>
  relative(ROOT, f).split(sep).join("/"),
);
const missingFromMatrix = srcFiles.filter((f) => !matrixRows.has(f));
for (const f of missingFromMatrix) {
  failures.push(`COVERAGE_MATRIX.csv: missing src file ${f}`);
}
let matrixHashMismatch = 0;
for (const f of srcFiles) {
  const want = matrixRows.get(f);
  if (want === undefined) continue;
  if (want === sha256File(join(ROOT, f))) continue;
  // A mismatch is accepted only for a known FIX delta whose frozen
  // baseline is intact (see header comment).
  const verdict = checkKnownFixDelta(f, want);
  if (verdict.ok) {
    notes.push(verdict.note);
    continue;
  }
  matrixHashMismatch += 1;
  failures.push(`COVERAGE_MATRIX.csv: sha256 mismatch for ${f} (${verdict.reason})`);
}
console.log(
  `[2/3] coverage matrix: ${matrixRows.size} rows, src/ files on disk: ${srcFiles.length}, ` +
    `missing from matrix: ${missingFromMatrix.length}, sha256 mismatches: ${matrixHashMismatch}`,
);

// --- Check 3: sha256.txt (148 entries) vs disk -----------------------------
const shaPath = join(PACK, "sha256.txt");
const entries = []; // { hash, path }
if (existsSync(shaPath) && statSync(shaPath).size > 0) {
  for (const line of readFileSync(shaPath, "utf8").split("\n")) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const m = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!m) {
      failures.push(`sha256.txt: unparsable line: ${line}`);
      continue;
    }
    entries.push({ hash: m[1], path: m[2] });
  }
}
const EXPECTED_ENTRIES = 148;
if (entries.length !== EXPECTED_ENTRIES) {
  failures.push(
    `sha256.txt: expected ${EXPECTED_ENTRIES} entries, found ${entries.length}`,
  );
}
let shaChecked = 0;
let shaOk = 0;
for (const { hash, path } of entries) {
  const full = join(ROOT, path);
  if (!existsSync(full)) {
    failures.push(`sha256.txt: missing file on disk: ${path}`);
    continue;
  }
  shaChecked += 1;
  if (sha256File(full) === hash) {
    shaOk += 1;
    continue;
  }
  // A mismatch is accepted only for a known FIX delta whose frozen
  // baseline is intact (see header comment).
  const verdict = checkKnownFixDelta(path, hash);
  if (verdict.ok) {
    notes.push(verdict.note);
    shaOk += 1;
    continue;
  }
  failures.push(`sha256.txt: hash mismatch: ${path} (${verdict.reason})`);
}
console.log(
  `[3/3] sha256.txt: ${entries.length} entries, ${shaChecked} checked, ${shaOk} match`,
);
for (const note of notes) console.log(`note: ${note}`);

if (failures.length > 0) {
  console.error(`\nverify:review-pack FAILED (${failures.length} problem(s)):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nverify:review-pack PASSED");
