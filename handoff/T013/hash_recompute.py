#!/usr/bin/env python3
"""T013 independent hash recomputation for P022 LocatorStress (S0 frozen hashes).

Written from scratch by the T013 reviewer. Does NOT import any project
code (no TS canonicaliser, no scripts/). Implements the frozen canonical
JSON rules independently from the spec text (IMPLEMENTATION_PLAN §4.5/§6):

  - UTF-8, LF, NFC normalisation of strings AND keys
  - object keys sorted by Unicode code point, EXCEPT that JS object
    property order puts canonical integer-like keys first in ascending
    numeric order (this mirrors what JSON.stringify actually emits for
    an object built by the TS canonicaliser; none of the S0 canonical
    objects contain integer-like keys, so this branch is inert here
    but is implemented for the T008 cross-check)
  - arrays keep order; numbers rendered as JSON.stringify does
    (integers plain; the S0 canonical objects contain integers only,
    scores are decimal strings)
  - no trailing newline in the hashed bytes

Inputs (read-only): src/fixtures/oracle-manifests/*.json,
src/fixtures/pages/*.html, src/fixtures/golden/expected-verdicts.json,
evidence/s0/T002_MUTATION_REPORT.json, evidence/s0/S0_GATE.json,
evidence/s2/T008_API_REPORT.json (for the embedded-canonical check).
"""
import hashlib
import json
import unicodedata
from pathlib import Path

ROOT = Path("/home/hatch/workspace/p022-locatorstress")
SEED = "P022-LOCATORSTRESS-S0-2026-11-10"


def is_array_index_key(k: str) -> bool:
    if k == "" or (len(k) > 1 and k[0] == "0"):
        return False
    if not k.isdigit():
        return False
    n = int(k)
    return 0 <= n < 2**32 - 1


def sorted_keys(keys):
    ints = sorted([k for k in keys if is_array_index_key(k)], key=int)
    rest = sorted([k for k in keys if not is_array_index_key(k)])
    return ints + rest


def canon(value) -> str:
    """Canonical JSON text, replicating JSON.stringify(canonicalize(v))."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        raise ValueError("unexpected float in canonical input: %r" % value)
    if isinstance(value, str):
        return json.dumps(unicodedata.normalize("NFC", value), ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canon(v) for v in value) + "]"
    if isinstance(value, dict):
        parts = []
        for k in sorted_keys(value.keys()):
            nk = unicodedata.normalize("NFC", k)
            parts.append(json.dumps(nk, ensure_ascii=False) + ":" + canon(value[k]))
        return "{" + ",".join(parts) + "}"
    raise ValueError("unsupported value: %r" % (value,))


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def normalize_locator(loc: dict) -> dict:
    out = {"kind": loc["kind"]}
    for f in ("selector", "role", "name"):
        if loc.get(f) is not None:
            out[f] = loc[f]
    out["exact"] = loc.get("exact", False)
    out["includeHidden"] = loc.get("includeHidden", False)
    out["framePath"] = list(loc.get("framePath", []))
    out["index"] = loc.get("index", None)
    return out


def main():
    gate = json.loads((ROOT / "evidence/s0/S0_GATE.json").read_text())
    frozen = gate["hashes"]
    print("frozen S0_GATE.json hashes:")
    for k, v in frozen.items():
        print(f"  {k} = {v}")
    print("S0_GATE.json file sha256:",
          hashlib.sha256((ROOT / "evidence/s0/S0_GATE.json").read_bytes()).hexdigest())

    # ---- scenario: rebuild from manifests + HTML ----
    fixtures = []
    for mid in [f"F{i:03d}" for i in range(1, 25)]:
        m = json.loads((ROOT / f"src/fixtures/oracle-manifests/{mid}.json").read_text())
        html = (ROOT / f"src/fixtures/pages/{mid}.html").read_text()
        fixtures.append({
            "fixtureId": m["fixtureId"],
            "family": m["family"],
            "kind": m["kind"],
            "controlGroup": m["controlGroup"],
            "locator": normalize_locator(m["locator"]),
            "html": html,
        })
    fixtures.sort(key=lambda f: f["fixtureId"])
    scenario = {
        "schema": "locatorstress.scenario-canonical/v1",
        "seed": SEED,
        "bfs": {"max_depth": 6, "max_expanded_states": 4096},
        "mutationSuite": ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"],
        "fixtures": fixtures,
    }
    s_scenario = sha(canon(scenario))
    print(f"scenario recomputed = {s_scenario}  match={s_scenario == frozen['scenario_sha256']}")

    # ---- oracle: rebuild from T002 report (actual verdicts) + golden cross-check ----
    t002 = json.loads((ROOT / "evidence/s0/T002_MUTATION_REPORT.json").read_text())
    golden = json.loads((ROOT / "src/fixtures/golden/expected-verdicts.json").read_text())
    golden_by_key = {(c["fixtureId"], c["mutationId"]): c["expectedVerdict"]
                     for c in golden["cases"]}
    oracle_cases = []
    mism = 0
    for c in t002["cases"]:
        exp = golden_by_key[(c["fixtureId"], c["mutationId"])]
        if c["actualVerdict"] != exp:
            mism += 1
        oracle_cases.append({
            "fixtureId": c["fixtureId"],
            "mutationId": c["mutationId"],
            "verdict": c["actualVerdict"],
            "matchCount": c["finalMatchCount"],
            "identityMatch": c["identityMatch"],
            "executionStatus": c["executionStatus"],
        })
    oracle_cases.sort(key=lambda c: (c["fixtureId"], c["mutationId"]))
    oracle = {"schema": "locatorstress.oracle-canonical/v1", "seed": SEED, "cases": oracle_cases}
    s_oracle = sha(canon(oracle))
    print(f"oracle recomputed   = {s_oracle}  match={s_oracle == frozen['oracle_result_sha256']}")
    print(f"  T002 actualVerdict vs golden mismatches: {mism} (expect 0)")

    # ---- analysis: rebuild from S0_GATE.json counts ----
    counts = gate["counts"]
    analysis = {
        "schema": "locatorstress.analysis-canonical/v1",
        "seed": SEED,
        "verdictCounts": counts["verdictCounts"],
        "verdictCountsByKind": counts["verdictCountsByKind"],
        "stabilityScore": counts["stabilityScore"],
        "coverage": counts["coverage"],
        "controls": {
            "stable": {"pairs": counts["stableControl"]["pairs"],
                       "mismatches": counts["stableControl"]["mismatches"]},
            "fragile": {"pairs": counts["fragileControl"]["pairs"],
                        "mismatches": counts["fragileControl"]["mismatches"]},
        },
        "analysisStatus": "COMPLETE",
        "bfs": {"status": "NOT_IMPLEMENTED_S0", "witness": None},
        "oracleParity": counts["oracleParity"],
    }
    s_analysis = sha(canon(analysis))
    print(f"analysis recomputed = {s_analysis}  match={s_analysis == frozen['analysis_sha256']}")

    # ---- gate: rebuild from S0_GATE.json fields ----
    gate_canon = {
        "schema": "locatorstress.s0-gate/v1",
        "seed": SEED,
        "result": gate["result"],
        "failureType": gate["failureType"],
        "thresholds": gate["thresholds"],
        "counts": counts,
        "hashes": {
            "scenario_sha256": s_scenario,
            "oracle_result_sha256": s_oracle,
            "analysis_sha256": s_analysis,
        },
        "notes": gate["notes"],
    }
    s_gate = sha(canon(gate_canon))
    print(f"gate recomputed     = {s_gate}  match={s_gate == frozen['gate_sha256']}")

    # ---- T008 report: recompute its four hashes from embedded canonicals ----
    t008 = json.loads((ROOT / "evidence/s2/T008_API_REPORT.json").read_text())
    ok = True
    for field, key in (("scenario_sha256", "scenario"), ("oracle_result_sha256", "oracle"),
                       ("analysis_sha256", "analysis"), ("gate_sha256", "gate")):
        r = sha(canon(t008["canonical"][key]))
        m = r == t008["hashes"][field]
        ok = ok and m
        print(f"T008 {field} recomputed={r} match={m}")
    print("T008 embedded-canonical recomputation all match:", ok)

    all_match = (s_scenario == frozen["scenario_sha256"]
                 and s_oracle == frozen["oracle_result_sha256"]
                 and s_analysis == frozen["analysis_sha256"]
                 and s_gate == frozen["gate_sha256"])
    print("S0 FOUR HASHES ALL MATCH:", all_match)
    return 0 if (all_match and ok) else 1


if __name__ == "__main__":
    raise SystemExit(main())
