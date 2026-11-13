// FIX-R1-04 — verify the frozen release package against disk (read-only).
//
// Checks (never modifies any file):
//   1. All five release files exist and are non-empty:
//      source.zip, dist.zip, RELEASE_MANIFEST.json, SHA256SUMS.txt,
//      R2_FREEZE_REPORT.md.
//   2. The manifest's frozen_commit is the pinned FROZEN_COMMIT and
//      its spec_version is 1.0.0.
//   3. The manifest's recorded source.zip / dist.zip sizes and SHA-256
//      values match the files on disk.
//   4. The manifest's source file count matches the source.zip entry
//      count; the manifest's dist file list matches the dist.zip
//      entries exactly (same set, same order, same count).
//   5. The manifest's four S0 hashes and S0_GATE.json SHA match
//      evidence/s0/S0_GATE.json on disk, and that file's SHA still
//      equals the frozen value below.
//   6. The SHA-256 values listed for the four artifacts in
//      R2_FREEZE_REPORT.md match the files on disk.
//
// Usage: npm run release:verify
// Exit:  0 iff every check passes; 1 otherwise (failures to stderr).

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readZip } from "./release-zip.mjs";

const ROOT = resolve(join(fileURLToPath(import.meta.url), "..", ".."));
const RELEASE_DIR = join(ROOT, "release");

// The frozen commit (full SHA of a834eea). Hard-coded on purpose:
// never derive it from HEAD or the branch tip.
const FROZEN_COMMIT = "a834eeae36f816c2f273677636127facb6902dbf";
const EXPECTED_S0_GATE_SHA256 =
  "15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d";

const failures = [];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function check(cond, msg) {
  if (!cond) failures.push(msg);
  return cond;
}

function readNonEmpty(rel) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) {
    failures.push(`missing file: ${rel}`);
    return null;
  }
  const buf = readFileSync(path);
  if (buf.length === 0) failures.push(`empty file (0 bytes): ${rel}`);
  return buf;
}

// --- Check 1: presence + non-emptiness -------------------------------------
const sourceZip = readNonEmpty("release/source.zip");
const distZip = readNonEmpty("release/dist.zip");
const manifestBuf = readNonEmpty("release/RELEASE_MANIFEST.json");
const sumsBuf = readNonEmpty("release/SHA256SUMS.txt");
const reportBuf = readNonEmpty("release/R2_FREEZE_REPORT.md");
console.log(
  `[1/6] release files present and non-empty: ` +
    `${[sourceZip, distZip, manifestBuf, sumsBuf, reportBuf].filter((b) => b !== null && b.length > 0).length}/5`,
);

// --- Check 2: manifest commit + version ------------------------------------
let manifest = null;
if (manifestBuf !== null && manifestBuf.length > 0) {
  try {
    manifest = JSON.parse(manifestBuf.toString("utf8"));
  } catch (err) {
    failures.push(`RELEASE_MANIFEST.json is not valid JSON: ${err.message}`);
  }
}
if (manifest !== null) {
  check(
    manifest.frozen_commit === FROZEN_COMMIT,
    `manifest frozen_commit ${manifest.frozen_commit} != ${FROZEN_COMMIT}`,
  );
  check(
    manifest.spec_version === "1.0.0",
    `manifest spec_version ${manifest.spec_version} != 1.0.0`,
  );
  console.log(
    `[2/6] manifest frozen_commit ${manifest.frozen_commit === FROZEN_COMMIT ? "OK" : "MISMATCH"}, ` +
      `spec_version ${manifest.spec_version}`,
  );
}

// --- Check 3: manifest sizes + SHAs vs disk --------------------------------
if (manifest !== null && sourceZip !== null && distZip !== null) {
  const pairs = [
    ["source_zip", sourceZip, "source.zip"],
    ["dist_zip", distZip, "dist.zip"],
  ];
  for (const [key, diskBuf, label] of pairs) {
    const rec = manifest[key];
    if (rec === undefined) {
      failures.push(`manifest is missing the ${key} record`);
      continue;
    }
    check(
      rec.bytes === diskBuf.length,
      `manifest ${key}.bytes ${rec.bytes} != disk ${diskBuf.length} (${label})`,
    );
    check(
      rec.sha256 === sha256(diskBuf),
      `manifest ${key}.sha256 ${rec.sha256} != disk ${sha256(diskBuf)} (${label})`,
    );
  }
  console.log(
    `[3/6] manifest source.zip/dist.zip bytes + SHA-256 vs disk: ` +
      `${failures.length === 0 ? "OK" : "see failures"}`,
  );
}

// --- Check 4: zip entry counts / dist file list vs manifest ----------------
if (manifest !== null && sourceZip !== null && distZip !== null) {
  let sourceEntries = null;
  let distEntries = null;
  try {
    sourceEntries = readZip(sourceZip);
  } catch (err) {
    failures.push(`source.zip unreadable: ${err.message}`);
  }
  try {
    distEntries = readZip(distZip);
  } catch (err) {
    failures.push(`dist.zip unreadable: ${err.message}`);
  }
  if (sourceEntries !== null) {
    // git archive zip also emits explicit directory entries (trailing
    // "/"); only file entries count toward the frozen file total.
    const sourceFileCount = [...sourceEntries.keys()].filter((p) => !p.endsWith("/")).length;
    check(
      manifest.source_zip?.file_count === sourceFileCount,
      `manifest source_zip.file_count ${manifest.source_zip?.file_count} != source.zip files ${sourceFileCount}`,
    );
  }
  if (distEntries !== null) {
    const diskList = [...distEntries.keys()].sort();
    const manifestList = manifest.dist_zip?.files;
    check(
      manifest.dist_zip?.file_count === diskList.length,
      `manifest dist_zip.file_count ${manifest.dist_zip?.file_count} != dist.zip entries ${diskList.length}`,
    );
    check(
      Array.isArray(manifestList) &&
        manifestList.length === diskList.length &&
        manifestList.every((f, i) => f === diskList[i]),
      "manifest dist_zip.files does not exactly match the dist.zip entries",
    );
  }
  console.log(
    `[4/6] zip entries vs manifest: source.zip ${sourceEntries === null ? "?" : [...sourceEntries.keys()].filter((p) => !p.endsWith("/")).length} files, ` +
      `dist.zip ${distEntries?.size ?? "?"} files`,
  );
}

// --- Check 5: S0 hashes + S0_GATE.json SHA vs disk --------------------------
const s0GateBuf = readNonEmpty("evidence/s0/S0_GATE.json");
if (s0GateBuf !== null && s0GateBuf.length > 0 && manifest !== null) {
  const diskS0Sha = sha256(s0GateBuf);
  check(
    diskS0Sha === EXPECTED_S0_GATE_SHA256,
    `evidence/s0/S0_GATE.json SHA ${diskS0Sha} != frozen ${EXPECTED_S0_GATE_SHA256}`,
  );
  check(
    manifest.s0?.s0_gate_json_sha256 === diskS0Sha,
    `manifest s0.s0_gate_json_sha256 ${manifest.s0?.s0_gate_json_sha256} != disk ${diskS0Sha}`,
  );
  let s0Gate = null;
  try {
    s0Gate = JSON.parse(s0GateBuf.toString("utf8"));
  } catch (err) {
    failures.push(`evidence/s0/S0_GATE.json is not valid JSON: ${err.message}`);
  }
  if (s0Gate !== null) {
    for (const key of ["scenario_sha256", "oracle_result_sha256", "analysis_sha256", "gate_sha256"]) {
      check(
        manifest.s0?.[key] === s0Gate.hashes?.[key],
        `manifest s0.${key} ${manifest.s0?.[key]} != S0_GATE.json ${s0Gate.hashes?.[key]}`,
      );
    }
  }
  console.log(
    `[5/6] S0_GATE.json SHA ${diskS0Sha === EXPECTED_S0_GATE_SHA256 ? "matches frozen value" : "MISMATCH"}, ` +
      `four S0 hashes vs manifest: ${failures.length === 0 ? "OK" : "see failures"}`,
  );
}

// --- Check 6: R2_FREEZE_REPORT.md listed SHAs vs disk --------------------
if (reportBuf !== null && sourceZip !== null && distZip !== null && manifestBuf !== null && sumsBuf !== null) {
  const report = reportBuf.toString("utf8");
  const diskSha = {
    "source.zip": sha256(sourceZip),
    "dist.zip": sha256(distZip),
    "RELEASE_MANIFEST.json": sha256(manifestBuf),
    "SHA256SUMS.txt": sha256(sumsBuf),
  };
  let rowsFound = 0;
  for (const [name, want] of Object.entries(diskSha)) {
    // Rows are written by release:freeze as:
    // | `name` | <bytes> | `<sha256>` |
    const m = new RegExp(`^\\| \`${name.replace(".", "\\.")}\` \\| \\d+ \\| \`([0-9a-f]{64})\` \\|$`, "m").exec(report);
    if (m === null) {
      failures.push(`R2_FREEZE_REPORT.md has no artifact row for ${name}`);
      continue;
    }
    rowsFound += 1;
    check(
      m[1] === want,
      `R2_FREEZE_REPORT.md lists ${name} SHA ${m[1]} != disk ${want}`,
    );
  }
  console.log(`[6/6] freeze-report artifact SHA rows: ${rowsFound}/4 found and checked`);
}

if (failures.length > 0) {
  console.error(`\nrelease:verify FAILED (${failures.length} problem(s)):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nrelease:verify PASSED");
