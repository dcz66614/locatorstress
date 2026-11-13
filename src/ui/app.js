// T009 — LocatorStress Web UI (vanilla ES module, no build step, no CDN).
//
// RULE (PROJECT_BOOK §10 architecture invariant): the UI never computes
// a verdict and never computes a score. Verdicts come from POST
// /api/analyze, witnesses from POST /api/search, scores from POST
// /ui/scores (server-side, frozen T005 scorer), hashes from GET
// /ui/reports (read from the backend report files). The browser only
// renders backend data, plus two explicitly-labelled previews that do
// NOT feed any verdict:
//   (a) the Locator edit preview resolves a draft LocatorSpec against
//       the fixture DOM in this browser (match count + same-element
//       check only);
//   (b) the DOM diff shows original vs mutated HTML; the mutated HTML
//       is produced server-side by the frozen mutation registry
//       (POST /ui/dom-snapshot), never by re-implementing mutations here.

const $ = (id) => document.getElementById(id);

const MUTATION_NAMES = {
  M01: "WRAP_TARGET",
  M02: "REORDER_SIBLINGS",
  M03: "CHANGE_CLASS",
  M04: "INSERT_SAME_NAME",
  M05: "NESTED_IFRAME",
  M06: "MOVE_TO_OPEN_SHADOW_ROOT",
  M07: "INSERT_HIDDEN_DUPLICATE",
  M08: "CHANGE_TEXT",
};
const MUTATION_ORDER = ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"];

const VERDICT_TEXT = {
  STABLE: "STABLE",
  WRONG_TARGET: "WRONG_TARGET",
  AMBIGUOUS: "AMBIGUOUS",
  MISSING: "MISSING",
};
const VERDICT_EXPLAIN = {
  STABLE: "最终匹配恰好 1 个，且与原目标为同一 DOM 对象。",
  WRONG_TARGET: "返回了一个元素，但不是原目标。",
  AMBIGUOUS: "最终匹配多于 1 个（或 framePath 某层匹配多个 frame）。",
  MISSING: "最终匹配为 0（或 framePath 某层无匹配 frame）。",
};

const state = {
  fixtures: [],
  mutations: [],
  seed: "",
  selectedFixtureId: null,
  selectedFixture: null,
  fixtureHtml: null,
  analysis: null,
  scores: null,
  controls: null,
  witness: null,
  snapshotCache: new Map(), // key: sequence.join("+") -> DomSnapshot
  selectedMutation: null,
  selectedCase: null,
  // FIX-R1-01: "fixture" = analyse the selected frozen fixture;
  // "custom" = analyse the user-supplied scenario from the Locator
  // edit page (custom HTML + edited LocatorSpec + private target).
  inputMode: "fixture",
  // Last custom scenario sent to the backend (for diffs / download).
  customScenario: null,
};

// FIX-R1-01 demo custom input (same shape as the §11.2 example).
const CUSTOM_DEMO_HTML =
  '<main><form><button type="submit" class="primary">Save</button><button type="button" class="secondary">Cancel</button></form></main>';
const CUSTOM_DEMO_TARGET_CSS = "main > form > button:nth-child(1)";
const CUSTOM_DEMO_SCENARIO_ID = "P022-CUSTOM-001";

function isCustomMode() {
  return state.inputMode === "custom";
}

/** Build the custom scenario object from the Locator edit form. */
function buildCustomScenario() {
  const scenario = {
    schema: "locatorstress.scenario/v1",
    seed: state.seed,
    html: $("custom-html").value,
    locator: readLocatorForm(),
    target: { css: $("custom-target-css").value.trim() },
  };
  const scenarioId = $("custom-scenario-id").value.trim();
  if (scenarioId !== "") scenario.scenario_id = scenarioId;
  const targetFrameLines = $("custom-target-framepath").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (targetFrameLines.length > 0) scenario.target.framePath = targetFrameLines;
  const shadowHost = $("custom-target-shadow").value.trim();
  if (shadowHost !== "") scenario.target.shadowHost = shadowHost;
  return scenario;
}

function resetCustomFields() {
  $("custom-scenario-id").value = CUSTOM_DEMO_SCENARIO_ID;
  $("custom-html").value = CUSTOM_DEMO_HTML;
  $("custom-target-css").value = CUSTOM_DEMO_TARGET_CSS;
  $("custom-target-framepath").value = "";
  $("custom-target-shadow").value = "";
  $("custom-validate-result").innerHTML = "";
}

function setInputMode(mode) {
  state.inputMode = mode;
  $("mode-fixture").checked = mode === "fixture";
  $("mode-custom").checked = mode === "custom";
  $("custom-fields").hidden = mode !== "custom";
  updateLocatorNote();
  setStatus("");
}

function updateLocatorNote() {
  if (isCustomMode()) {
    $("loc-fixture-note").textContent =
      "自定义输入模式：分析使用下方自定义 HTML、Locator 表单与私有目标描述（目标描述只供 Oracle 定位原目标）。先校验场景，再去 Verdict Matrix 运行分析或去 BFS Witness 运行搜索。";
    return;
  }
  $("loc-fixture-note").textContent = state.selectedFixture
    ? `当前 fixture：${state.selectedFixture.fixtureId}（${locatorSummary(state.selectedFixture.locator)}）。表单已载入该冻结 Locator；内置模式下分析使用它，编辑仅用于校验与匹配预览。`
    : "先在 Fixture Lab 选择一个 fixture。";
}

function setStatus(msg) {
  $("run-status").textContent = msg || "";
}

async function apiJson(path, options) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body && body.error ? body.error : {};
    throw new Error(`${path} -> HTTP ${res.status} ${err.code || ""} ${err.message || ""}`.trim());
  }
  return body;
}

// FIX-R1-02: like apiJson, but for endpoints that return text (the
// HTML export). On error the server still answers JSON, so the message
// is recovered from the error body when possible.
async function apiText(path, options) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const text = await res.text();
  if (!res.ok) {
    let message = "";
    try {
      const err = JSON.parse(text).error || {};
      message = `${err.code || ""} ${err.message || ""}`.trim();
    } catch {
      message = text.slice(0, 200);
    }
    throw new Error(`${path} -> HTTP ${res.status} ${message}`.trim());
  }
  return text;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function locatorSummary(loc) {
  if (!loc) return "—";
  if (loc.kind === "css" || loc.kind === "xpath") return `${loc.kind}: ${loc.selector || ""}`;
  const parts = [`role: ${loc.role || ""}`];
  if (loc.name !== undefined && loc.name !== "") parts.push(`name=${JSON.stringify(loc.name)}`);
  if (loc.exact) parts.push("exact");
  if (loc.includeHidden) parts.push("includeHidden");
  return parts.join(" ");
}

function framePathText(loc) {
  return (loc && loc.framePath && loc.framePath.length > 0 ? loc.framePath.join(" › ") : "—");
}

// ---------------------------------------------------------------- tabs
const VIEWS = ["fixtures", "locator", "mutations", "matrix", "witness", "report"];
function showView(name) {
  for (const v of VIEWS) {
    const tab = document.querySelector(`[data-view="${v}"]`);
    const panel = $(`view-${v}`);
    const active = v === name;
    tab.setAttribute("aria-selected", active ? "true" : "false");
    panel.hidden = !active;
  }
}
document.querySelectorAll("[data-view]").forEach((tab) => {
  tab.addEventListener("click", () => showView(tab.dataset.view));
});
document.querySelector(".tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const current = VIEWS.indexOf(document.querySelector('[aria-selected="true"]').dataset.view);
  const next = (current + (e.key === "ArrowRight" ? 1 : VIEWS.length - 1)) % VIEWS.length;
  showView(VIEWS[next]);
  document.querySelector(`[data-view="${VIEWS[next]}"]`).focus();
  e.preventDefault();
});

// ---------------------------------------------------------------- Fixture Lab
function renderFixtureRows() {
  const kind = $("fixture-filter-kind").value;
  const control = $("fixture-filter-control").value;
  const family = $("fixture-filter-family").value;
  const rows = state.fixtures.filter(
    (f) =>
      (!kind || f.kind === kind) &&
      (!control || f.controlGroup === control) &&
      (!family || f.family === family),
  );
  $("fixture-count").textContent = `显示 ${rows.length} / 24 个 fixture。`;
  $("fixture-rows").innerHTML = rows
    .map(
      (f) => `<tr data-fixture-id="${escHtml(f.fixtureId)}" data-selected="${f.fixtureId === state.selectedFixtureId}" tabindex="0">
        <td class="mono">${escHtml(f.fixtureId)}</td>
        <td>${escHtml(f.family)}</td>
        <td>${escHtml(f.kind)}</td>
        <td>${escHtml(f.controlGroup)}</td>
        <td class="mono">${escHtml(locatorSummary(f.locator))}</td>
      </tr>`,
    )
    .join("");
}

async function selectFixture(fixtureId) {
  const fixture = state.fixtures.find((f) => f.fixtureId === fixtureId);
  if (!fixture) return;
  state.selectedFixtureId = fixtureId;
  state.selectedFixture = fixture;
  state.analysis = null;
  state.scores = null;
  state.controls = null;
  state.witness = null;
  state.snapshotCache.clear();
  state.selectedMutation = null;
  state.selectedCase = null;
  state.fixtureHtml = null;
  $("selected-fixture").textContent =
    `已选 ${fixture.fixtureId}（${fixture.family} · ${fixture.kind} · ${fixture.controlGroup}）— Locator：${locatorSummary(fixture.locator)}${fixture.locator.framePath && fixture.locator.framePath.length ? `；framePath：${framePathText(fixture.locator)}` : ""}${fixture.locator.index !== null && fixture.locator.index !== undefined ? `；index：${fixture.locator.index}` : ""}`;
  // FIX-R1-01: selecting a fixture must not clobber a custom
  // scenario the user is editing; only reload the locator form in
  // fixture mode.
  if (!isCustomMode()) loadLocatorForm(fixture.locator);
  updateLocatorNote();
  renderFixtureRows();
  renderMatrixEmpty();
  renderWitnessEmpty();
  renderReport();
  setStatus("");
}

$("fixture-rows").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-fixture-id]");
  if (tr) void selectFixture(tr.dataset.fixtureId);
});
$("fixture-rows").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const tr = e.target.closest("tr[data-fixture-id]");
  if (tr) {
    void selectFixture(tr.dataset.fixtureId);
    e.preventDefault();
  }
});
for (const id of ["fixture-filter-kind", "fixture-filter-control", "fixture-filter-family"]) {
  $(id).addEventListener("change", renderFixtureRows);
}

// ---------------------------------------------------------------- Locator edit
function readLocatorForm() {
  const kind = $("loc-kind").value;
  const loc = { kind };
  if (kind === "css" || kind === "xpath") {
    // exact / includeHidden / role / name are role-only keys per the
    // LocatorSpec contract (T001); sending them for css/xpath makes the
    // spec invalid.
    loc.selector = $("loc-selector").value;
  } else {
    loc.role = $("loc-role").value;
    const name = $("loc-name").value;
    if (name !== "") loc.name = name;
    loc.exact = $("loc-exact").checked;
    loc.includeHidden = $("loc-include-hidden").checked;
  }
  const frameLines = $("loc-framepath").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (frameLines.length > 0) loc.framePath = frameLines;
  const idx = $("loc-index").value.trim();
  if (idx !== "") loc.index = Number(idx);
  return loc;
}

/**
 * Client-side SHAPE check for a draft LocatorSpec, mirroring the shape
 * rules of validateLocatorSpec (non-empty selector/role, framePath 0–2,
 * non-negative integer index). This is a guard, not a re-implementation
 * of validation: the backend (/api/validate) remains authoritative for
 * everything actually sent.
 *
 * WHY the guard exists (frozen T008 defect, since FIXED server-side
 * by FIX-T009): service.validate() used to return `{ valid, errors,
 * locator }` with `locator: undefined` whenever the spec was invalid,
 * and the frozen API server serialised the response with canonicalJson,
 * which throws on an `undefined` property — after writeHead already
 * sent headers — so the outer 500 handler threw ERR_HTTP_HEADERS_SENT
 * and the whole API/UI server process died. Any invalid draft sent to
 * /api/validate therefore killed the server. FIX-T009 fixed this
 * server-side (service.ts only returns `locator` when defined, and
 * server.ts guards on headersSent), so the shape check is now redundant
 * defence in depth, kept to fail fast with a clear message; see
 * T009_UI_REPORT.md for the minimal repro of the original defect.
 */
function checkLocatorShape(loc) {
  const errors = [];
  if (loc.kind !== "css" && loc.kind !== "xpath" && loc.kind !== "role") {
    errors.push('kind must be one of "css", "xpath", "role"');
    return errors;
  }
  if ((loc.kind === "css" || loc.kind === "xpath") && (typeof loc.selector !== "string" || loc.selector.length === 0)) {
    errors.push(`selector must be a non-empty string when kind is "${loc.kind}"`);
  }
  if (loc.kind === "role" && (typeof loc.role !== "string" || loc.role.length === 0)) {
    errors.push('role must be a non-empty string when kind is "role"');
  }
  if (loc.framePath !== undefined) {
    if (!Array.isArray(loc.framePath) || loc.framePath.length > 2 || loc.framePath.some((s) => typeof s !== "string" || s.length === 0)) {
      errors.push("framePath must contain 0–2 non-empty strings");
    }
  }
  if (loc.index !== undefined && loc.index !== null && (!Number.isInteger(loc.index) || loc.index < 0)) {
    errors.push("index must be null or a non-negative integer");
  }
  return errors;
}

function loadLocatorForm(loc) {
  $("loc-kind").value = loc.kind;
  $("loc-selector").value = loc.kind === "css" || loc.kind === "xpath" ? loc.selector || "" : "";
  $("loc-role").value = loc.kind === "role" ? loc.role || "" : "";
  $("loc-name").value = loc.kind === "role" ? loc.name || "" : "";
  $("loc-exact").checked = !!loc.exact;
  $("loc-include-hidden").checked = !!loc.includeHidden;
  $("loc-framepath").value = (loc.framePath || []).join("\n");
  $("loc-index").value = loc.index === null || loc.index === undefined ? "" : String(loc.index);
  syncLocatorKindRows();
  updateLocatorNote();
  $("loc-validate-result").innerHTML = "";
  $("loc-preview-result").innerHTML = "";
}

function syncLocatorKindRows() {
  const kind = $("loc-kind").value;
  $("row-selector").hidden = kind === "role";
  $("row-role").hidden = kind !== "role";
  $("row-name").hidden = kind !== "role";
}
$("loc-kind").addEventListener("change", syncLocatorKindRows);

// FIX-R1-01: input-mode switch (fixture vs custom).
$("mode-fixture").addEventListener("change", () => setInputMode("fixture"));
$("mode-custom").addEventListener("change", () => setInputMode("custom"));
resetCustomFields();

$("custom-validate").addEventListener("click", async () => {
  const scenario = buildCustomScenario();
  try {
    const result = await apiJson("/api/validate", {
      method: "POST",
      body: JSON.stringify({ scenario }),
    });
    if (result.valid) {
      $("custom-validate-result").innerHTML =
        `<p><strong>自定义场景校验通过（后端 /api/validate）。</strong>目标描述与 LocatorSpec 语法合法；目标是否恰好命中一个元素在运行分析/搜索时由 Oracle 核对。</p>`;
    } else {
      $("custom-validate-result").innerHTML =
        `<p><strong>自定义场景校验未通过。</strong></p><ul>${(result.errors || []).map((e) => `<li>${escHtml(e)}</li>`).join("")}</ul>`;
    }
  } catch (err) {
    setStatus(`自定义场景校验失败：${err.message}`);
  }
});

$("custom-reset").addEventListener("click", () => {
  resetCustomFields();
  if (state.selectedFixture) loadLocatorForm(state.selectedFixture.locator);
  // Demo locator for the demo HTML: css button.primary.
  $("loc-kind").value = "css";
  $("loc-selector").value = "button.primary";
  syncLocatorKindRows();
});

$("loc-reset").addEventListener("click", () => {
  if (state.selectedFixture) loadLocatorForm(state.selectedFixture.locator);
});

$("loc-validate").addEventListener("click", async () => {
  // FIX-R1-01: in custom mode the same button validates the whole
  // custom scenario (HTML + locator + target descriptor) instead of
  // just the LocatorSpec; the dedicated custom-validate button does
  // the same and writes to its own result box.
  if (isCustomMode()) {
    $("custom-validate").click();
    return;
  }
  const loc = readLocatorForm();
  const shapeErrors = checkLocatorShape(loc);
  if (shapeErrors.length > 0) {
    // Guard (see checkLocatorShape): do not send a shape-invalid draft
    // to /api/validate. The frozen server used to die on such a draft,
    // but FIX-T009 has since fixed it server-side — service.ts only
    // returns `locator` when defined, and server.ts guards on
    // headersSent — so this client-side shape guard is now redundant
    // defence in depth, kept to fail fast with a clear message.
    // These are format errors only; semantic validation still happens
    // on the backend for every draft that is sent.
    $("loc-validate-result").innerHTML =
      `<p><strong>格式检查未通过（未发送给后端）。</strong></p><ul>${shapeErrors.map((e) => `<li>${escHtml(e)}</li>`).join("")}</ul>`;
    return;
  }
  try {
    const result = await apiJson("/api/validate", {
      method: "POST",
      body: JSON.stringify({ locator: loc }),
    });
    if (result.valid) {
      $("loc-validate-result").innerHTML =
        `<p><strong>校验通过（后端 /api/validate）。</strong>规范化 Locator：<code>${escHtml(JSON.stringify(result.locator))}</code></p>`;
    } else {
      $("loc-validate-result").innerHTML =
        `<p><strong>校验未通过。</strong></p><ul>${(result.errors || []).map((e) => `<li>${escHtml(e)}</li>`).join("")}</ul>`;
    }
  } catch (err) {
    setStatus(`校验失败：${err.message}`);
  }
});

// ---- Client-side locator preview (match count + same-element check only).
// This runs entirely in this browser against the fixture DOM. It never
// produces a verdict and never reaches the Oracle.
const IMPLICIT_ROLE = {
  button: (el) =>
    el.tagName === "BUTTON" ||
    (el.tagName === "INPUT" && ["button", "submit", "reset", "image"].includes((el.getAttribute("type") || "").toLowerCase())) ||
    el.getAttribute("role") === "button",
  link: (el) => (el.tagName === "A" && el.hasAttribute("href")) || el.getAttribute("role") === "link",
  textbox: (el) =>
    (el.tagName === "INPUT" && !["button", "submit", "reset", "image", "checkbox", "radio", "hidden", "file"].includes((el.getAttribute("type") || "text").toLowerCase())) ||
    el.tagName === "TEXTAREA" || el.getAttribute("role") === "textbox",
  checkbox: (el) => (el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "checkbox") || el.getAttribute("role") === "checkbox",
  radio: (el) => (el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "radio") || el.getAttribute("role") === "radio",
  heading: (el) => /^H[1-6]$/.test(el.tagName) || el.getAttribute("role") === "heading",
  navigation: (el) => el.tagName === "NAV" || el.getAttribute("role") === "navigation",
  main: (el) => el.tagName === "MAIN" || el.getAttribute("role") === "main",
  dialog: (el) => el.getAttribute("role") === "dialog",
  img: (el) => el.tagName === "IMG" || el.getAttribute("role") === "img",
};

function accessibleName(el, doc) {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((id) => {
      const target = doc.getElementById(id);
      return target ? target.textContent : "";
    });
    const joined = parts.join(" ").replace(/\s+/g, " ").trim();
    if (joined) return joined;
  }
  const label = el.getAttribute("aria-label");
  if (label) return label;
  if (el.tagName === "INPUT") return el.getAttribute("value") || el.getAttribute("placeholder") || "";
  if (el.tagName === "IMG") return el.getAttribute("alt") || "";
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

function normName(s) {
  return String(s).replace(/\s+/g, " ").trim().toLowerCase();
}

function allElementsWithShadow(doc) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children || []) {
      out.push(child);
      if (child.tagName === "TEMPLATE" && child.content) walk(child.content);
      else walk(child);
    }
  };
  walk(doc.documentElement || doc);
  return out;
}

function isHiddenApprox(el) {
  if (el.hasAttribute("hidden")) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  const style = el.getAttribute("style") || "";
  if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) return true;
  return false;
}

/** Resolve a LocatorSpec inside a parsed fixture document (preview only). */
function resolveLocatorPreview(doc, loc) {
  let currentDocs = [doc];
  const framePath = loc.framePath || [];
  for (const sel of framePath) {
    const next = [];
    let foundFrame = false;
    for (const d of currentDocs) {
      const frames = [...d.querySelectorAll("iframe")].filter((f) => {
        try { return f.matches(sel); } catch { return false; }
      });
      for (const f of frames) {
        foundFrame = true;
        const srcdoc = f.getAttribute("srcdoc");
        if (srcdoc !== null) {
          next.push(new DOMParser().parseFromString(srcdoc, "text/html"));
        }
      }
    }
    if (!foundFrame) return { matches: [], error: `framePath 在原始 DOM 中无匹配的 iframe：${sel}` };
    if (next.length === 0) return { matches: [], error: "framePath 指向的 iframe 没有 srcdoc 内容，预览无法进入（后端执行时解析）" };
    currentDocs = next;
  }

  let matches = [];
  if (loc.kind === "css") {
    try {
      for (const d of currentDocs) {
        matches.push(...allElementsWithShadow(d).filter((el) => {
          try { return el.matches(loc.selector); } catch { return false; }
        }));
      }
    } catch {
      return { matches: [], error: `CSS selector 无法解析：${loc.selector}` };
    }
  } else if (loc.kind === "xpath") {
    for (const d of currentDocs) {
      const scopes = [d, ...allElementsWithShadow(d).filter((el) => el.tagName === "TEMPLATE").map((t) => t.content)];
      for (const scope of scopes) {
        try {
          const result = d.evaluate(loc.selector, scope, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          for (let i = 0; i < result.snapshotLength; i += 1) {
            const node = result.snapshotItem(i);
            if (node && node.nodeType === 1) matches.push(node);
          }
        } catch {
          return { matches: [], error: `XPath 无法解析：${loc.selector}` };
        }
      }
    }
  } else if (loc.kind === "role") {
    const test = IMPLICIT_ROLE[loc.role];
    if (!test) return { matches: [], error: `预览不支持的 role：${loc.role}（仅支持 button/link/textbox/checkbox/radio/heading/navigation/main/dialog/img）` };
    for (const d of currentDocs) {
      for (const el of allElementsWithShadow(d)) {
        if (!test(el)) continue;
        if (loc.name !== undefined && loc.name !== "") {
          const name = normName(accessibleName(el, d));
          const want = normName(loc.name);
          if (loc.exact ? name !== want : !name.includes(want)) continue;
        }
        matches.push(el);
      }
    }
  } else {
    return { matches: [], error: `未知 kind：${loc.kind}` };
  }

  if (!loc.includeHidden) matches = matches.filter((el) => !isHiddenApprox(el));
  if (loc.index !== null && loc.index !== undefined) {
    if (loc.index < 0 || loc.index >= matches.length) {
      return { matches: [], error: `.nth(${loc.index}) 越界：原始匹配 ${matches.length} 个` };
    }
    matches = [matches[loc.index]];
  }
  return { matches, error: null };
}

async function fetchFixtureHtml() {
  if (state.fixtureHtml !== null) return state.fixtureHtml;
  const res = await fetch(`/ui/fixture-html/${state.selectedFixtureId}.html`);
  if (!res.ok) throw new Error(`fixture HTML 加载失败：HTTP ${res.status}`);
  state.fixtureHtml = await res.text();
  return state.fixtureHtml;
}

$("loc-preview").addEventListener("click", async () => {
  // FIX-R1-01: in custom mode the preview parses the user's own HTML
  // and compares the edited locator against the private target
  // descriptor (same-element check only — never a verdict).
  if (isCustomMode()) {
    const draft = readLocatorForm();
    const scenario = buildCustomScenario();
    if (scenario.html.trim() === "" || scenario.target.css === "") {
      setStatus("自定义预览需要先填写合成 HTML 与目标选择器 target.css。");
      return;
    }
    try {
      const doc = new DOMParser().parseFromString(scenario.html, "text/html");
      const draftRes = resolveLocatorPreview(doc, draft);
      const targetRes = resolveLocatorPreview(doc, { kind: "css", selector: scenario.target.css });
      const draftEl = draftRes.matches[0] || null;
      const targetEl = targetRes.matches[0] || null;
      const same = draftEl !== null && targetEl !== null && draftEl === targetEl;
      const describe = (el) => (el ? `<code>${escHtml(el.outerHTML.slice(0, 160))}</code>` : "—");
      $("loc-preview-result").innerHTML = `
      <p><strong>浏览器内匹配预览（自定义 HTML，仅预览，不计算 verdict；隐藏元素按近似规则过滤）。</strong></p>
      <ul>
        <li>编辑的 Locator 在自定义 HTML 上匹配 <strong>${draftRes.matches.length}</strong> 个元素${draftRes.error ? `；注意：${escHtml(draftRes.error)}` : ""}。${draftEl ? `首个匹配：${describe(draftEl)}` : ""}</li>
        <li>目标描述 target.css 在自定义 HTML 上匹配 <strong>${targetRes.matches.length}</strong> 个元素${targetRes.error ? `；注意：${escHtml(targetRes.error)}` : ""}。${targetEl ? `目标元素：${describe(targetEl)}` : ""}</li>
        <li>是否命中同一元素（原目标）：<strong>${same ? "是" : draftEl && targetEl ? "否（不同元素）" : "无法判断（至少一方未命中）"}</strong>${targetRes.matches.length !== 1 ? "；注意：目标描述必须恰好命中 1 个元素，否则分析拒绝运行。" : ""}</li>
      </ul>
      <p class="hint">最终判定以后端 /api/analyze 的执行结果为准；目标身份由 Node 侧 Oracle 比较，不依赖本预览。</p>`;
    } catch (err) {
      setStatus(`匹配预览失败：${err.message}`);
    }
    return;
  }
  if (!state.selectedFixture) {
    setStatus("请先在 Fixture Lab 选择一个 fixture。");
    return;
  }
  const draft = readLocatorForm();
  try {
    const html = await fetchFixtureHtml();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const draftRes = resolveLocatorPreview(doc, draft);
    const frozenRes = resolveLocatorPreview(doc, state.selectedFixture.locator);
    const draftEl = draftRes.matches[0] || null;
    const frozenEl = frozenRes.matches[0] || null;
    const same = draftEl !== null && frozenEl !== null && draftEl === frozenEl;
    const describe = (el) => (el ? `<code>${escHtml(el.outerHTML.slice(0, 160))}</code>` : "—");
    $("loc-preview-result").innerHTML = `
      <p><strong>浏览器内匹配预览（仅预览，不计算 verdict；隐藏元素按近似规则过滤）。</strong></p>
      <ul>
        <li>编辑的 Locator 在原始 DOM 上匹配 <strong>${draftRes.matches.length}</strong> 个元素${draftRes.error ? `；注意：${escHtml(draftRes.error)}` : ""}。${draftEl ? `首个匹配：${describe(draftEl)}` : ""}</li>
        <li>fixture 冻结 Locator 在原始 DOM 上匹配 <strong>${frozenRes.matches.length}</strong> 个元素${frozenRes.error ? `；注意：${escHtml(frozenRes.error)}` : ""}。</li>
        <li>是否命中同一元素：<strong>${same ? "是" : draftEl && frozenEl ? "否（不同元素）" : "无法判断（至少一方未命中）"}</strong></li>
      </ul>
      <p class="hint">iframe / Shadow DOM 内的目标可能无法在顶层 DOM 预览中解析；最终判定以后端 /api/analyze 的执行结果为准。</p>`;
  } catch (err) {
    setStatus(`匹配预览失败：${err.message}`);
  }
});

// ---------------------------------------------------------------- DOM diff
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

function prettyPrintHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const lines = [];
  const attrText = (el) => {
    let s = "";
    for (const name of el.getAttributeNames()) {
      s += ` ${name}="${String(el.getAttribute(name)).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
    }
    return s;
  };
  const walk = (node, depth) => {
    const pad = "  ".repeat(depth);
    if (node.nodeType === 3) {
      const text = node.textContent.replace(/\s+/g, " ").trim();
      if (text) lines.push(`${pad}${text}`);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node;
    const tag = el.tagName.toLowerCase();
    if (tag === "template" && el.content) {
      lines.push(`${pad}<template${attrText(el)}>`);
      for (const child of el.content.childNodes) walk(child, depth + 1);
      lines.push(`${pad}</template>`);
      return;
    }
    const children = [...el.childNodes].filter(
      (n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim() !== ""),
    );
    if (children.length === 0 || VOID_TAGS.has(tag)) {
      lines.push(`${pad}<${tag}${attrText(el)}>${VOID_TAGS.has(tag) ? "" : `</${tag}>`}`);
      return;
    }
    lines.push(`${pad}<${tag}${attrText(el)}>`);
    for (const child of children) walk(child, depth + 1);
    lines.push(`${pad}</${tag}>`);
  };
  lines.push("<!doctype html>");
  walk(doc.documentElement, 0);
  return lines;
}

/** LCS line diff: [{type: "same"|"add"|"del", text, oldNo, newNo}]. */
function lineDiff(oldLines, newLines) {
  const n = oldLines.length;
  const m = newLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      rows.push({ type: "same", text: oldLines[i], oldNo: i + 1, newNo: j + 1 });
      i += 1; j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "del", text: oldLines[i], oldNo: i + 1, newNo: null });
      i += 1;
    } else {
      rows.push({ type: "add", text: newLines[j], oldNo: null, newNo: j + 1 });
      j += 1;
    }
  }
  while (i < n) { rows.push({ type: "del", text: oldLines[i], oldNo: i + 1, newNo: null }); i += 1; }
  while (j < m) { rows.push({ type: "add", text: newLines[j], oldNo: null, newNo: j + 1 }); j += 1; }
  return rows;
}

function renderDiff(container, oldHtml, newHtml, label) {
  const oldLines = prettyPrintHtml(oldHtml);
  const newLines = prettyPrintHtml(newHtml);
  const rows = lineDiff(oldLines, newLines);
  const adds = rows.filter((r) => r.type === "add").length;
  const dels = rows.filter((r) => r.type === "del").length;
  const summary = adds === 0 && dels === 0
    ? `${label}：DOM 无行级差异。`
    : `${label}：新增 ${adds} 行，删除 ${dels} 行（绿色 = 变异后新增，红色 = 原 DOM 删除）。`;
  container.innerHTML = `<table aria-label="DOM diff"><tbody>${rows
    .map((r) => `<tr class="diff-${r.type}"><td class="ln">${r.oldNo ?? ""}</td><td class="ln">${r.newNo ?? ""}</td><td class="sign">${r.type === "add" ? "+" : r.type === "del" ? "−" : " "}</td><td>${escHtml(r.text)}</td></tr>`)
    .join("")}</tbody></table>`;
  return summary;
}

async function fetchSnapshot(sequence) {
  // FIX-R1-01: in custom mode the diff is produced from the user's
  // own scenario (same frozen mutations, same Oracle target capture).
  // The cache key includes the scenario JSON: editing the custom HTML
  // must not reuse a diff from an earlier scenario.
  const scenarioJson = isCustomMode()
    ? JSON.stringify(state.customScenario ?? buildCustomScenario())
    : "";
  const key = `${isCustomMode() ? `custom:${scenarioJson}:` : ""}${sequence.join("+")}`;
  if (state.snapshotCache.has(key)) return state.snapshotCache.get(key);
  const body = isCustomMode()
    ? { scenario: state.customScenario ?? buildCustomScenario(), sequence }
    : { fixtureId: state.selectedFixtureId, sequence };
  const snap = await apiJson("/ui/dom-snapshot", {
    method: "POST",
    body: JSON.stringify(body),
  });
  state.snapshotCache.set(key, snap);
  return snap;
}

// ---------------------------------------------------------------- Mutation Lab
function renderMutationList() {
  $("mutation-list").innerHTML = MUTATION_ORDER.map(
    (id) => `<button type="button" data-mutation="${id}" aria-pressed="${state.selectedMutation === id}">${id} ${MUTATION_NAMES[id]}</button>`,
  ).join("");
  if (!state.selectedMutation) {
    $("diff-view").innerHTML = `<p class="diff-empty">选择一个算子查看 DOM diff。</p>`;
    $("diff-summary").textContent = "";
  }
}

$("mutation-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-mutation]");
  if (!btn || !state.selectedFixture) {
    if (!state.selectedFixture) setStatus("请先在 Fixture Lab 选择一个 fixture。");
    return;
  }
  const id = btn.dataset.mutation;
  state.selectedMutation = id;
  renderMutationList();
  try {
    const snap = await fetchSnapshot([id]);
    const summary = renderDiff($("diff-view"), snap.steps[0].html, snap.steps[1].html, `${id} ${MUTATION_NAMES[id]} 之后`);
    $("diff-summary").textContent = summary;
  } catch (err) {
    setStatus(`DOM 快照失败：${err.message}`);
  }
});

// ---------------------------------------------------------------- Verdict Matrix
function renderMatrixEmpty() {
  $("matrix-grid").innerHTML = `<p class="diff-empty">尚未运行分析。选择 fixture 后点击「运行分析」。</p>`;
  $("case-detail").innerHTML = "";
  $("analysis-status").textContent = "";
}

function verdictChip(v) {
  if (v === null || v === undefined) return `<span class="verdict verdict-none">（无 verdict）</span>`;
  return `<span class="verdict verdict-${v}">${VERDICT_TEXT[v]}</span>`;
}

function renderMatrix() {
  const a = state.analysis;
  if (!a) { renderMatrixEmpty(); return; }
  const cells = [{ id: null, label: "baseline", c: a.baseline }, ...a.cases.map((c) => ({ id: c.mutationId, label: c.mutationId, c }))];
  $("matrix-grid").innerHTML = cells
    .map(({ id, label, c }) => `<button type="button" class="matrix-cell" data-mutation="${id ?? "baseline"}" aria-pressed="${state.selectedCase === (id ?? "baseline")}">
      <span class="cell-id">${label}${id ? ` ${MUTATION_NAMES[id]}` : ""}</span><br>
      <span class="cell-verdict">${verdictChip(c.verdict)}</span>
      <span class="cell-detail">匹配 ${c.matchCount} 个 · ${c.identityMatch === null ? "身份未知" : c.identityMatch ? "同一目标 ✓" : "非原目标 ✕"}</span>
    </button>`)
    .join("");
  $("analysis-status").textContent =
    `分析完成：baseline ${a.baseline.verdict ?? "（无 verdict）"}；${a.cases.length} 个变异用例中 ${a.cases.filter((c) => c.verdict !== null).length} 个已完成。`;
}

$("matrix-grid").addEventListener("click", async (e) => {
  const btn = e.target.closest(".matrix-cell[data-mutation]");
  if (!btn || !state.analysis) return;
  const key = btn.dataset.mutation;
  state.selectedCase = key;
  const c = key === "baseline" ? state.analysis.baseline : state.analysis.cases.find((x) => x.mutationId === key);
  if (!c) return;
  renderMatrix();
  const verdictLine = c.verdict
    ? `${verdictChip(c.verdict)}<span class="verdict-note">${escHtml(VERDICT_EXPLAIN[c.verdict])}</span>`
    : `<span class="verdict verdict-none">（无 verdict）</span><span class="verdict-note">执行未完成，见 executionStatus；不得计为 STABLE。</span>`;
  let diffHtml = "";
  if (key !== "baseline") {
    try {
      const snap = await fetchSnapshot([key]);
      const tmp = document.createElement("div");
      const summary = renderDiff(tmp, snap.steps[0].html, snap.steps[1].html, `${key} 之后`);
      diffHtml = `<h3>DOM diff（${key} ${MUTATION_NAMES[key]}）</h3><p>${escHtml(summary)}</p>${tmp.innerHTML}`;
    } catch (err) {
      diffHtml = `<p>DOM diff 加载失败：${escHtml(err.message)}</p>`;
    }
  }
  $("case-detail").innerHTML = `
    <h3>${key === "baseline" ? "baseline" : `${key} ${MUTATION_NAMES[key]}`}</h3>
    <p>${verdictLine}</p>
    <dl>
      <dt>matchCount</dt><dd>${c.matchCount}</dd>
      <dt>identityMatch</dt><dd>${c.identityMatch === null ? "null（无唯一命中可比较）" : c.identityMatch ? "true（同一 DOM 对象）" : "false（不是原目标）"}</dd>
      <dt>expectedVerdict（golden）</dt><dd>${c.expectedVerdict ?? "—"}</dd>
      <dt>matchesGolden</dt><dd>${c.matchesGolden === null ? "null" : String(c.matchesGolden)}</dd>
      <dt>executionStatus</dt><dd>${escHtml(c.executionStatus)}</dd>
      <dt>analysisStatus</dt><dd>${escHtml(c.analysisStatus)}</dd>
      <dt>framePath</dt><dd>${escHtml(framePathText(isCustomMode() && state.customScenario ? state.customScenario.locator : state.selectedFixture.locator))}</dd>
    </dl>
    ${diffHtml}`;
});

$("run-analysis").addEventListener("click", async () => {
  // FIX-R1-01: in custom mode the analysis runs on the user's own
  // scenario — not on the selected fixture's frozen locator.
  let requestBody;
  if (isCustomMode()) {
    const scenario = buildCustomScenario();
    if (scenario.html.trim() === "" || scenario.target.css === "") {
      setStatus("自定义分析需要先填写合成 HTML 与目标选择器 target.css。");
      return;
    }
    state.customScenario = scenario;
    requestBody = { scenario };
  } else {
    if (!state.selectedFixture) {
      setStatus("请先在 Fixture Lab 选择一个 fixture。");
      return;
    }
    state.customScenario = null;
    requestBody = { fixtureId: state.selectedFixtureId };
  }
  const btn = $("run-analysis");
  btn.disabled = true;
  $("analysis-status").textContent = "运行中：后端正在 Chromium 上执行 baseline + M01–M08…";
  setStatus("");
  try {
    const analysis = await apiJson("/api/analyze", {
      method: "POST",
      body: JSON.stringify(requestBody),
    });
    state.analysis = analysis;
    state.selectedCase = null;
    renderMatrix();
    try {
      const scored = await apiJson("/ui/scores", {
        method: "POST",
        body: JSON.stringify({ cases: analysis.cases }),
      });
      state.scores = scored.scores;
      state.controls = scored.controls;
    } catch (err) {
      setStatus(`分数计算失败（后端 /ui/scores）：${err.message}`);
      state.scores = null;
      state.controls = null;
    }
    renderReport();
  } catch (err) {
    setStatus(`分析失败：${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------- BFS Witness
function renderWitnessEmpty() {
  $("witness-summary").innerHTML = "";
  $("witness-steps").innerHTML = "";
  $("witness-status").textContent = "";
}

function renderWitness() {
  const w = state.witness;
  if (!w) { renderWitnessEmpty(); return; }
  const statusText = {
    FOUND: "FOUND — 已找到最短失败序列",
    BOUNDED_NO_WITNESS: "BOUNDED_NO_WITNESS — 有限搜索内未找到失败序列（不证明安全）",
    BOUNDED_INCOMPLETE: "BOUNDED_INCOMPLETE — 预算耗尽，搜索未完成（不是“无见证”）",
  }[w.status] || w.status;
  $("witness-status").textContent = statusText;
  $("witness-summary").innerHTML = `
    <dl class="report-facts">
      <div><dt>状态</dt><dd>${escHtml(w.status)}</dd></div>
      <div><dt>含义</dt><dd style="font-size:14px">${escHtml(w.meaning)}</dd></div>
      <div><dt>见证序列</dt><dd>${w.witness ? escHtml(w.witness.sequence.join(" → ")) + `（深度 ${w.witness.depth}，失败 verdict ${w.witness.verdict}）` : "—"}</dd></div>
      <div><dt>已评估 / 已扩展 / 去重</dt><dd>${w.statesEvaluated} / ${w.statesExpanded} / ${w.statesDeduplicated}</dd></div>
      <div><dt>唯一状态 / 队列剩余</dt><dd>${w.uniqueStates} / ${w.queueRemaining}</dd></div>
      <div><dt>到达的最大深度</dt><dd>${w.maxDepthReached}（上限 ${w.limits.maxDepth}，预算 ${w.limits.maxExpandedStates}）</dd></div>
    </dl>
    ${w.budgetNote ? `<p class="hint">${escHtml(w.budgetNote)}</p>` : ""}
    <p class="hint">按深度评估：${escHtml(JSON.stringify(w.perDepthEvaluated))}</p>`;
}

$("run-bfs").addEventListener("click", async () => {
  // FIX-R1-01: in custom mode the BFS runs on the user's own scenario.
  let requestBody;
  if (isCustomMode()) {
    const scenario = buildCustomScenario();
    if (scenario.html.trim() === "" || scenario.target.css === "") {
      setStatus("自定义 BFS 需要先填写合成 HTML 与目标选择器 target.css。");
      return;
    }
    state.customScenario = scenario;
    requestBody = { scenario };
  } else {
    if (!state.selectedFixture) {
      setStatus("请先在 Fixture Lab 选择一个 fixture。");
      return;
    }
    state.customScenario = null;
    requestBody = { fixtureId: state.selectedFixtureId };
  }
  const depth = Number($("bfs-depth").value);
  const budget = Number($("bfs-budget").value);
  if (!Number.isInteger(depth) || depth < 0 || depth > 6) {
    setStatus("maxDepth 必须是 0–6 的整数。");
    return;
  }
  if (!Number.isInteger(budget) || budget < 1 || budget > 4096) {
    setStatus("maxExpandedStates 必须是 1–4096 的整数。");
    return;
  }
  const btn = $("run-bfs");
  btn.disabled = true;
  $("witness-status").textContent = "BFS 运行中（后端有界搜索，深度越大越慢）…";
  setStatus("");
  try {
    const witness = await apiJson("/api/search", {
      method: "POST",
      body: JSON.stringify({ ...requestBody, maxDepth: depth, maxExpandedStates: budget }),
    });
    state.witness = witness;
    renderWitness();
    renderReport();
    if (witness.witness) {
      const seq = witness.witness.sequence;
      const snap = await fetchSnapshot(seq);
      const stepsDiv = $("witness-steps");
      stepsDiv.innerHTML = "<h3>每一步 DOM diff</h3>";
      for (let i = 0; i < seq.length; i += 1) {
        const holder = document.createElement("div");
        const summary = renderDiff(holder, snap.steps[i].html, snap.steps[i + 1].html, `第 ${i + 1} 步：${seq[i]} ${MUTATION_NAMES[seq[i]]} 之后`);
        const block = document.createElement("div");
        block.innerHTML = `<p>${escHtml(summary)}</p>`;
        block.appendChild(holder);
        stepsDiv.appendChild(block);
      }
    }
  } catch (err) {
    setStatus(`BFS 失败：${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------- Report
async function renderReport() {
  const body = $("report-body");
  const empty = $("report-empty");
  if (!state.analysis || !state.scores) {
    body.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  body.hidden = false;
  const overall = state.scores.overall;
  const a = state.analysis;
  $("report-score").textContent =
    overall.score === null ? "—（无已完成用例）" : `${overall.score}（${overall.scoreNumerator}/${overall.scoreDenominator}）`;
  const counts = a.cases.reduce((acc, c) => {
    if (c.verdict) acc[c.verdict] = (acc[c.verdict] || 0) + 1;
    return acc;
  }, {});
  $("report-counts").textContent =
    `STABLE ${counts.STABLE || 0} · WRONG_TARGET ${counts.WRONG_TARGET || 0} · AMBIGUOUS ${counts.AMBIGUOUS || 0} · MISSING ${counts.MISSING || 0} · incomplete ${overall.incomplete}`;
  $("report-coverage").textContent =
    `${overall.coverageNumerator}/${overall.coverageDenominator}${overall.coverage === null ? "" : `（${overall.coverage}）`} · analysisStatus ${overall.analysisStatus}`;
  $("report-baseline").textContent =
    `${a.baseline.verdict ?? "（无 verdict）"}（executionStatus ${a.baseline.executionStatus}，matchCount ${a.baseline.matchCount}）`;
  $("report-witness").textContent = state.witness
    ? `${state.witness.status}${state.witness.witness ? `：${state.witness.witness.sequence.join(" → ")}（${state.witness.witness.verdict}）` : ""}`
    : "未运行 BFS";
  $("report-operator-rows").innerHTML = MUTATION_ORDER.map((id) => {
    const row = state.scores.perOperator[id];
    if (!row) return "";
    return `<tr><td>${id} ${MUTATION_NAMES[id]}</td><td>${row.stable}</td><td>${row.wrongTarget}</td><td>${row.ambiguous}</td><td>${row.missing}</td><td>${row.score === null ? "—" : `${row.score}（${row.scoreNumerator}/${row.scoreDenominator}）`}</td></tr>`;
  }).join("");
  try {
    const reports = await apiJson("/ui/reports", {});
    let html = "";
    if (reports.t008.present) {
      const h = reports.t008.hashes;
      html += `<p><strong>T008 全量分析报告</strong>（24 fixtures / ${reports.t008.expectedCases} cases，已完成 ${reports.t008.completedCases}；总体分数 ${reports.t008.score ?? "—"}，coverage ${reports.t008.coverage ?? "—"}）：</p>
        <dl class="hash-list">
          <dt>scenario_sha256</dt><dd>${escHtml(h.scenario_sha256)}</dd>
          <dt>oracle_result_sha256</dt><dd>${escHtml(h.oracle_result_sha256)}</dd>
          <dt>analysis_sha256</dt><dd>${escHtml(h.analysis_sha256)}</dd>
          <dt>gate_sha256</dt><dd>${escHtml(h.gate_sha256)}</dd>
        </dl>`;
    } else {
      html += `<p>T008 全量分析报告文件不存在（evidence/s2/T008_API_REPORT.json）；可运行 <code>npm run report:t008</code> 生成。</p>`;
    }
    if (reports.s0.present) {
      html += `<p><strong>S0 冻结门禁哈希</strong>（evidence/s0/S0_GATE.json，只读展示）：<code>${escHtml(reports.s0.gateSha256)}</code></p>`;
    } else {
      html += `<p>S0 门禁文件不存在。</p>`;
    }
    $("report-hashes").innerHTML = html;
  } catch (err) {
    $("report-hashes").innerHTML = `<p>哈希加载失败：${escHtml(err.message)}</p>`;
  }
}

// FIX-R1-02: the page-level export payload, shared by the JSON and
// HTML downloads so both formats describe the same analysis.
function buildPageExportPayload() {
  return {
    schema: "locatorstress.ui-fixture-export/v1",
    fixtureId: state.analysis.fixtureId,
    seed: state.seed,
    analysis: state.analysis,
    witness: state.witness,
    scores: state.scores,
    controls: state.controls,
    // FIX-R1-01: custom runs export the same shape; the analysis
    // itself carries source: "custom" and no golden expectations.
    note: state.analysis.source === "custom"
      ? "Custom-scenario export from the T009 UI: verdicts/witness from the frozen API for a user-supplied scenario, scores computed server-side by the frozen T005 scorer. No golden expected verdicts exist for custom input. Not a T008 full AnalysisReport."
      : "Fixture-level export from the T009 UI: verdicts/witness from the frozen API, scores computed server-side by the frozen T005 scorer. Not a T008 full AnalysisReport.",
  };
}

$("download-json").addEventListener("click", () => {
  if (!state.analysis) return;
  const payload = buildPageExportPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.analysis.fixtureId}-analysis.json`;
  link.click();
  URL.revokeObjectURL(url);
});

// FIX-R1-02: HTML download for the current analysis — same payload as
// the JSON download, rendered server-side as a standalone offline HTML
// document (POST /ui/export-html). Works for fixture runs and custom
// runs alike; the full 24-fixture report is a different export
// (POST /api/export format=html).
$("download-html").addEventListener("click", async () => {
  if (!state.analysis) return;
  const btn = $("download-html");
  btn.disabled = true;
  try {
    const html = await apiText("/ui/export-html", {
      method: "POST",
      body: JSON.stringify(buildPageExportPayload()),
    });
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.analysis.fixtureId}-analysis.html`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    setStatus(`HTML 导出失败：${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

$("clear-run").addEventListener("click", () => {
  state.analysis = null;
  state.scores = null;
  state.controls = null;
  state.witness = null;
  state.customScenario = null;
  state.snapshotCache.clear();
  state.selectedCase = null;
  renderMatrixEmpty();
  renderWitnessEmpty();
  renderReport();
  setStatus("本地运行数据已清空（后端无持久化状态）。");
});

// ---------------------------------------------------------------- init
async function init() {
  try {
    const health = await apiJson("/api/health", {});
    state.seed = health.seed || "";
    $("seed-text").textContent = state.seed;
    $("health-status").textContent =
      `API ok · 服务 locatorstress v${health.version} · seed ${health.seed} · BFS 上限 depth ${health.bfsLimits.maxDepth} / ${health.bfsLimits.maxExpandedStates} 扩展 · 变异顺序 ${health.mutationOrder.join(" ")}`;
  } catch (err) {
    $("health-status").textContent = `API 不可用：${err.message}`;
    setStatus(`无法连接本地 API：${err.message}`);
    return;
  }
  try {
    const [fixturesBody, mutationsBody] = await Promise.all([
      apiJson("/api/fixtures", {}),
      apiJson("/api/mutations", {}),
    ]);
    state.fixtures = fixturesBody.fixtures || [];
    state.mutations = mutationsBody.mutations || [];
    const families = [...new Set(state.fixtures.map((f) => f.family))].sort();
    $("fixture-filter-family").innerHTML =
      `<option value="">全部</option>` + families.map((f) => `<option value="${escHtml(f)}">${escHtml(f)}</option>`).join("");
    renderFixtureRows();
    renderMutationList();
    if (state.fixtures.length > 0) {
      await selectFixture(state.fixtures[0].fixtureId);
    }
  } catch (err) {
    setStatus(`fixture 列表加载失败：${err.message}`);
  }
}

void init();
