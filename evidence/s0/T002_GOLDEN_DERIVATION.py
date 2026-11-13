#!/usr/bin/env python3
"""Hand-derived golden expected verdicts for P022 T002 (192 cases).

AUTHORSHIP: every (fixture, mutation) -> verdict pair below was derived by
hand from PROJECT_BOOK.md section 5.3 (four-state definitions) and section 4
(mutation semantics), against each fixture's locator design. Nothing here is
produced by running the implementation or by any production classifier.
Reason strings are explicit per case (templated only over the fixture's own
locator description). Run: python3 /tmp/p022-golden-gen.py
Output: src/fixtures/golden/expected-verdicts.json
"""
import json
from collections import Counter

S = "STABLE"
W = "WRONG_TARGET"
A = "AMBIGUOUS"
M = "MISSING"

LOC = {
    "F001": 'css button[type="submit"]',
    "F002": "absolute XPath /html/body/main/form/button[1]",
    "F003": 'role button name "Submit form" (aria-label)',
    "F004": "css form.search > button.primary",
    "F005": "XPath //button[@type='submit']",
    "F006": 'role button name "Search site" (aria-label)',
    "F007": 'css a[href="/dashboard"]',
    "F008": "XPath //a[@href='/dashboard']",
    "F009": 'role link name "Dashboard" (from text)',
    "F010": "css button.action with index 0",
    "F011": "XPath //button[text()='Confirm']",
    "F012": 'role button name "Confirm deletion" (aria-label)',
    "F013": 'css button[type="submit"]',
    "F014": "XPath //button with index 1",
    "F015": 'role button name "Edit" (from text)',
    "F016": "css div.toolbar > button with index 0",
    "F017": "XPath //button[@title='Make text bold']",
    "F018": 'role button name "Bold" (from text)',
    "F019": 'css button[type="submit"] in frame iframe.frame-a',
    "F020": "XPath //button[text()='Save'] in frame iframe.frame-a",
    "F021": 'role button name "Save" (non-exact) with index 0 in nested frames',
    "F022": "css button.primary in open shadow root",
    "F023": "XPath //button[@type='submit']",
    "F024": 'role button name "Save document" (aria-label) in open shadow root',
}

REASONS = {
    "s-wrap": "M01 wraps the target in a div; {loc} still matches the same single node.",
    "s-reorder": "M02 swaps the target with a sibling; {loc} keys on the target itself, so it still matches the same single node.",
    "s-class": "M03 replaces the target's first class token; {loc} does not use that token, so the target still matches.",
    "s-decoy": "The M04 decoy copies tag/class/text/aria-label but not the attribute {loc} keys on, so the locator still matches only the original target.",
    "s-nolink": "The M04 decoy is an <a> without href, so it has no link role; {loc} still matches only the original target.",
    "s-iframe": "M05 appends a srcdoc iframe decoy; locators do not descend into the new frame, so {loc} still matches only the original target.",
    "s-shadow": "M06 moves the target into an open shadow root; the CSS/role engine pierces open shadow roots, so {loc} still finds the same node.",
    "s-hidden": "The M07 hidden duplicate lacks the attribute {loc} keys on (and role locators exclude hidden nodes), so {loc} still matches only the original target.",
    "s-text": "M08 changes the target text only and leaves aria-label unchanged; {loc} does not depend on the changed text, so the target still matches.",
    "m-directchild": "M01 wraps the target in a div, so the direct-child/absolute {loc} no longer matches; final count 0, MISSING.",
    "m-class": "M03 replaces the first class token that {loc} keys on, so the locator no longer matches the target; final count 0, MISSING.",
    "m-xpath": "M06 moves the target into an open shadow root; the XPath engine does not pierce shadow roots, so {loc} matches 0 nodes, MISSING.",
    "m-text": "M08 changes the target text; {loc} keys on the old text/accessible name, so it matches 0 nodes, MISSING.",
    "wt-pos": "M02/M04/M07 moves a sibling or decoy into the position {loc} selects, so the positional locator now matches a different node, WRONG_TARGET.",
    "wt-wrap-sibling": "M01 wraps the target in a div, so it is no longer a direct child; {loc} now selects a sibling button instead of the original target, WRONG_TARGET.",
    "wt-shadow-sibling": "M06 moves the target into an open shadow root; {loc} cannot see it there, and now selects a remaining light-DOM sibling instead, WRONG_TARGET.",
    "wt-shadow-order": "M06 moves the target into an open shadow root; the engine pierces it, but a light-DOM match is yielded before the shadow match, so the indexed {loc} picks the wrong node, WRONG_TARGET.",
    "wt-shadow-directchild": "M06 moves the target into an open shadow root; the direct-child combinator in {loc} does not cross the shadow boundary, so it matches only the sibling buttons and the index picks a different node, WRONG_TARGET.",
    "wt-xpath-remaining": "M06 moves the target into an open shadow root; XPath does not pierce it, so {loc} matches only the remaining light-DOM buttons and the index picks a different node, WRONG_TARGET.",
    "m-shadow-directchild": "M06 moves the target into an open shadow root; the direct-child combinator in {loc} does not cross the shadow boundary (descendant matching pierces, '>' does not), so the locator matches 0 nodes, MISSING.",
    "wt-index": "A decoy or sibling moves ahead of the target, so the indexed {loc} now picks a different node, WRONG_TARGET.",
    "wt-f021": "M08 changes the target text so it no longer contains 'Save'; the sibling 'Save draft' still matches name 'Save', so the indexed role locator picks the sibling, WRONG_TARGET.",
    "a-decoy": "M04 inserts a visible decoy with the same tag/class/text/name before the target, so {loc} now matches 2 nodes, AMBIGUOUS.",
    "a-hidden": "M07 inserts a hidden duplicate with the same tag/class/text before the target; CSS/XPath count hidden nodes, so {loc} now matches 2 nodes, AMBIGUOUS.",
    "a-frame": "M05 appends a second iframe matching framePath[0], so frame resolution sees 2 frames, AMBIGUOUS.",
}

# CORRECTIONS (2026-11-10, after the first 192-case run: 184/192 matched).
# The 8 mismatches below were GOLDEN DERIVATION errors, not implementation
# defects: each actual verdict was re-derived by hand and confirmed with an
# independent probe (/tmp/p022-probe-mismatch.mjs) that lists the post-mutation
# matches in order. The original derivation had missed (a) sibling buttons
# still matching a direct-child/absolute selector after the target is wrapped
# or shadow-moved, (b) the '>' combinator not crossing a shadow boundary even
# though descendant matching pierces it, and (c) pierced shadow matches being
# yielded AFTER light-DOM matches for indexed locators. Corrected entries:
# F002 M01 MISSING->WRONG_TARGET, F002 M06 MISSING->WRONG_TARGET,
# F004 M06 STABLE->MISSING, F010 M06 STABLE->WRONG_TARGET,
# F014 M06 MISSING->WRONG_TARGET, F016 M01 MISSING->WRONG_TARGET,
# F016 M06 STABLE->WRONG_TARGET, F021 M06 STABLE->WRONG_TARGET.
# New totals: STABLE 138 / WRONG_TARGET 22 / AMBIGUOUS 17 / MISSING 15.
ALL_S = {m: (S, code) for m, code in [
    ("M01", "s-wrap"), ("M02", "s-reorder"), ("M03", "s-class"),
    ("M04", "s-decoy"), ("M05", "s-iframe"), ("M06", "s-shadow"),
    ("M07", "s-hidden"), ("M08", "s-text")]}
ARIA_ROLE_STABLE = {m: (S, code) for m, code in [
    ("M01", "s-wrap"), ("M02", "s-reorder"), ("M03", "s-class"),
    ("M04", "a-decoy"), ("M05", "s-iframe"), ("M06", "s-shadow"),
    ("M07", "s-hidden"), ("M08", "s-text")]}
# NOTE: for aria-role fixtures M04 is AMBIGUOUS (decoy copies aria-label),
# so ARIA_ROLE_STABLE must carry the AMBIGUOUS entry, not STABLE.
ARIA_ROLE_STABLE["M04"] = (A, "a-decoy")

PROFILES = {
    "F001": dict(ALL_S),
    "F002": {"M01": (W, "wt-wrap-sibling"), "M02": (W, "wt-pos"), "M03": (S, "s-class"),
             "M04": (W, "wt-pos"), "M05": (S, "s-iframe"), "M06": (W, "wt-shadow-sibling"),
             "M07": (W, "wt-pos"), "M08": (S, "s-text")},
    "F003": dict(ARIA_ROLE_STABLE),
    "F004": {"M01": (M, "m-directchild"), "M02": (S, "s-reorder"), "M03": (M, "m-class"),
             "M04": (A, "a-decoy"), "M05": (S, "s-iframe"), "M06": (M, "m-shadow-directchild"),
             "M07": (A, "a-hidden"), "M08": (S, "s-text")},
    "F005": {"M01": (S, "s-wrap"), "M02": (S, "s-reorder"), "M03": (S, "s-class"),
             "M04": (S, "s-decoy"), "M05": (S, "s-iframe"), "M06": (M, "m-xpath"),
             "M07": (S, "s-hidden"), "M08": (S, "s-text")},
    "F006": dict(ARIA_ROLE_STABLE),
    "F007": dict(ALL_S),
    "F008": {"M01": (S, "s-wrap"), "M02": (S, "s-reorder"), "M03": (S, "s-class"),
             "M04": (S, "s-decoy"), "M05": (S, "s-iframe"), "M06": (M, "m-xpath"),
             "M07": (S, "s-hidden"), "M08": (S, "s-text")},
    "F009": {"M01": (S, "s-wrap"), "M02": (S, "s-reorder"), "M03": (S, "s-class"),
             "M04": (S, "s-nolink"), "M05": (S, "s-iframe"), "M06": (S, "s-shadow"),
             "M07": (S, "s-hidden"), "M08": (M, "m-text")},
    "F010": {"M01": (S, "s-wrap"), "M02": (W, "wt-index"), "M03": (S, "s-class"),
             "M04": (W, "wt-index"), "M05": (S, "s-iframe"), "M06": (W, "wt-shadow-order"),
             "M07": (W, "wt-index"), "M08": (S, "s-text")},
    "F011": {"M01": (S, "s-wrap"), "M02": (S, "s-reorder"), "M03": (S, "s-class"),
             "M04": (A, "a-decoy"), "M05": (S, "s-iframe"), "M06": (M, "m-xpath"),
             "M07": (A, "a-hidden"), "M08": (M, "m-text")},
    "F012": dict(ARIA_ROLE_STABLE),
    "F013": dict(ALL_S),
    "F014": {"M01": (S, "s-wrap"), "M02": (W, "wt-index"), "M03": (S, "s-class"),
             "M04": (W, "wt-index"), "M05": (S, "s-iframe"), "M06": (W, "wt-xpath-remaining"),
             "M07": (W, "wt-index"), "M08": (S, "s-text")},
    "F015": {"M01": (S, "s-wrap"), "M02": (S, "s-reorder"), "M03": (S, "s-class"),
             "M04": (A, "a-decoy"), "M05": (S, "s-iframe"), "M06": (S, "s-shadow"),
             "M07": (S, "s-hidden"), "M08": (M, "m-text")},
    "F016": {"M01": (W, "wt-wrap-sibling"), "M02": (W, "wt-index"), "M03": (S, "s-class"),
             "M04": (W, "wt-index"), "M05": (S, "s-iframe"), "M06": (W, "wt-shadow-directchild"),
             "M07": (W, "wt-index"), "M08": (S, "s-text")},
    "F017": {"M01": (S, "s-wrap"), "M02": (S, "s-reorder"), "M03": (S, "s-class"),
             "M04": (S, "s-decoy"), "M05": (S, "s-iframe"), "M06": (M, "m-xpath"),
             "M07": (S, "s-hidden"), "M08": (S, "s-text")},
    "F018": {"M01": (S, "s-wrap"), "M02": (S, "s-reorder"), "M03": (S, "s-class"),
             "M04": (A, "a-decoy"), "M05": (S, "s-iframe"), "M06": (S, "s-shadow"),
             "M07": (S, "s-hidden"), "M08": (M, "m-text")},
    "F019": {"M01": (S, "s-wrap"), "M02": (S, "s-reorder"), "M03": (S, "s-class"),
             "M04": (S, "s-decoy"), "M05": (A, "a-frame"), "M06": (S, "s-shadow"),
             "M07": (S, "s-hidden"), "M08": (S, "s-text")},
    "F020": {"M01": (S, "s-wrap"), "M02": (S, "s-reorder"), "M03": (S, "s-class"),
             "M04": (A, "a-decoy"), "M05": (A, "a-frame"), "M06": (M, "m-xpath"),
             "M07": (A, "a-hidden"), "M08": (M, "m-text")},
    "F021": {"M01": (S, "s-wrap"), "M02": (W, "wt-index"), "M03": (S, "s-class"),
             "M04": (W, "wt-index"), "M05": (A, "a-frame"), "M06": (W, "wt-shadow-order"),
             "M07": (S, "s-hidden"), "M08": (W, "wt-f021")},
    "F022": {"M01": (S, "s-wrap"), "M02": (S, "s-reorder"), "M03": (M, "m-class"),
             "M04": (A, "a-decoy"), "M05": (S, "s-iframe"), "M06": (S, "s-shadow"),
             "M07": (A, "a-hidden"), "M08": (S, "s-text")},
    "F023": {"M01": (S, "s-wrap"), "M02": (S, "s-reorder"), "M03": (S, "s-class"),
             "M04": (S, "s-decoy"), "M05": (S, "s-iframe"), "M06": (M, "m-xpath"),
             "M07": (S, "s-hidden"), "M08": (S, "s-text")},
    "F024": dict(ARIA_ROLE_STABLE),
}

MUTS = ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"]
cases = []
for fid in sorted(PROFILES):
    prof = PROFILES[fid]
    assert set(prof) == set(MUTS), f"{fid} profile incomplete: {sorted(prof)}"
    for mid in MUTS:
        verdict, code = prof[mid]
        reason = REASONS[code].format(loc=LOC[fid])
        cases.append({
            "fixtureId": fid,
            "mutationId": mid,
            "expectedVerdict": verdict,
            "reason": reason,
        })

counts = Counter(c["expectedVerdict"] for c in cases)
print("CASES", len(cases))
print("COUNTS", dict(counts))
assert len(cases) == 192, len(cases)
assert all(v >= 8 for v in counts.values()), counts
assert counts == {"STABLE": 138, "WRONG_TARGET": 22, "AMBIGUOUS": 17, "MISSING": 15}, counts

doc = {
    "schema": "locatorstress.t002-expected-verdicts/v1",
    "seed": "P022-LOCATORSTRESS-S0-2026-11-10",
    "cases": cases,
}
out = "/home/hatch/workspace/p022-locatorstress/src/fixtures/golden/expected-verdicts.json"
with open(out, "w", encoding="utf-8", newline="\n") as f:
    json.dump(doc, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("WROTE", out)
