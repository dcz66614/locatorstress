// FIX-R1-04 — re-compute the SHA-256 of source.zip, dist.zip and
// RELEASE_MANIFEST.json and compare each against SHA256SUMS.txt.
//
// SHA256SUMS.txt must list exactly those three items (in that order),
// never itself and never R2_FREEZE_REPORT.md — a sums file must not
// self-reference. Read-only: nothing is modified.
//
// Usage: npm run release:verify-hashes
// Exit:  0 iff all three hashes match (3/3); 1 otherwise.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(join(fileURLToPath(import.meta.url), "..", ".."));
const RELEASE_DIR = join(ROOT, "release");

// The frozen commit (full SHA of a834eea). Hard-coded on purpose:
// never derive it from HEAD or the branch tip. This script does not
// shell out to git, but the constant pins the release it verifies to
// the same frozen commit as the other three release scripts.
const FROZEN_COMMIT = "a834eeae36f816c2f273677636127facb6902dbf";

const EXPECTED_FILES = ["source.zip", "dist.zip", "RELEASE_MANIFEST.json"];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

const failures = [];

const sumsPath = join(RELEASE_DIR, "SHA256SUMS.txt");
if (!existsSync(sumsPath)) {
  console.error("release:verify-hashes FAILED: missing release/SHA256SUMS.txt");
  process.exit(1);
}
const sumsText = readFileSync(sumsPath, "utf8");
const entries = [];
for (const line of sumsText.split("\n")) {
  if (line.trim() === "") continue;
  const m = /^([0-9a-f]{64})  (.+)$/.exec(line);
  if (m === null) {
    failures.push(`SHA256SUMS.txt: unparsable line: ${line}`);
    continue;
  }
  entries.push({ hash: m[1], file: m[2] });
}

if (entries.length !== EXPECTED_FILES.length) {
  failures.push(
    `SHA256SUMS.txt: expected ${EXPECTED_FILES.length} entries, found ${entries.length}`,
  );
}
for (let i = 0; i < EXPECTED_FILES.length; i += 1) {
  const entry = entries[i];
  if (entry === undefined) continue;
  if (entry.file !== EXPECTED_FILES[i]) {
    failures.push(
      `SHA256SUMS.txt: entry ${i + 1} is ${entry.file}, expected ${EXPECTED_FILES[i]}`,
    );
  }
}
for (const entry of entries) {
  if (entry.file === "SHA256SUMS.txt") {
    failures.push("SHA256SUMS.txt: must not list itself");
  }
  if (entry.file === "R2_FREEZE_REPORT.md") {
    failures.push("SHA256SUMS.txt: must not list R2_FREEZE_REPORT.md");
  }
}

let matched = 0;
for (const name of EXPECTED_FILES) {
  const path = join(RELEASE_DIR, name);
  if (!existsSync(path)) {
    failures.push(`missing file: release/${name}`);
    continue;
  }
  const diskSha = sha256(readFileSync(path));
  const entry = entries.find((e) => e.file === name);
  if (entry === undefined) {
    failures.push(`SHA256SUMS.txt: no entry for ${name}`);
    continue;
  }
  if (entry.hash === diskSha) {
    matched += 1;
    console.log(`OK  ${name}  ${diskSha}`);
  } else {
    failures.push(`${name}: SHA256SUMS.txt ${entry.hash} != disk ${diskSha}`);
  }
}
console.log(`\nrelease:verify-hashes: ${matched}/${EXPECTED_FILES.length} hashes match`);

if (failures.length > 0) {
  console.error(`\nrelease:verify-hashes FAILED (${failures.length} problem(s)):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("release:verify-hashes PASSED");
