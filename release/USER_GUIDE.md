# LocatorStress 用户指南

本文只描述本仓库已实现的能力。凡是这里没有写到的功能，都不存在——不要
假设它存在。快速上手见 `release/README.md`；一步步复现冻结结果见
`release/HOW_TO_REPRODUCE.md`。

## 1. 先理解实验对象

LocatorStress 不连接真实网站。它内置 24 个合成页面（`F001`–`F024`），
分属 8 个页面族：`form-submit`、`search-box`、`nav-link`、`dialog-confirm`、
`table-row-action`、`toolbar-menu`、`nested-iframe`、`open-shadow-dom`。
每个页面自带一个“原目标”与一个“应有定位器”：

| 定位器种类 | 页面数 | 示例（取自真实 fixture 清单） |
| --- | --- | --- |
| css | 8 | F001：`button[type="submit"]`（族 `form-submit`，稳定控制） |
| xpath | 8 | F002：`/html/body/main/form/button[1]`（族 `form-submit`，脆弱控制）；F005：`//button[@type='submit']`（稳定控制） |
| role | 8 | F003：`role=button`，`name="Submit form"`，`exact=true`（稳定控制）；F009：`role=link`，`name="Dashboard"`（脆弱控制） |

12 个页面是稳定控制（stable）：设计上期望定位器在全部 8 个单变异下都
保持 STABLE；12 个页面是脆弱控制（fragile）：设计上期望至少一个变异使
其失效；每组各 96 对对照，共 192 对。对照组用于检验整套实验装置本身有
没有系统性误报或漏检——不是用来给你的定位器打分的。

## 2. 如何定义一个定位器

定位器用 `LocatorSpecV1`（`src/contracts/locator.ts`）描述。三种写法：

```json
{ "kind": "css", "selector": "button[type=\"submit\"]" }
{ "kind": "xpath", "selector": "//button[@type='submit']" }
{ "kind": "role", "role": "button", "name": "Submit form", "exact": true }
```

规则（由 `validateLocatorSpec` 强制执行，非法即报错，不静默容忍）：

- `kind` 只能是 `css`、`xpath`、`role` 三者之一。
- `css` / `xpath`：必须有非空 `selector`；只能带 `selector`、`framePath`、
  `index` 这几个键，`role`、`name`、`exact`、`includeHidden` 会被拒绝。
- `role`：必须有非空 `role`；可带 `name`（非空字符串）、`exact`（布尔）、
  `includeHidden`（布尔）、`framePath`、`index`；`selector` 会被拒绝。
- `framePath`：0–2 个非空字符串，每个是 iframe 的 CSS 选择器（例如
  `["iframe#outer", "iframe#inner"]`）。带 `framePath` 的页面是 F019、F020、
  F021（`nested-iframe` 族）；超过 2 层不被接受。
- `index`：非负整数或 `null`，对应 Playwright 的 `.nth(index)`（0-based）；
  不填视为 `null`，即不做 `.nth()`。
- **不支持**：任意 JavaScript 表达式、定位器回调、正则函数、自动生成定位器。
  需要这些能力请换工具，本工具不会提供。

在 Web UI 里定义定位器：打开“Locator 编辑”页签，选 `kind` 后填入对应字段
（CSS/XPath 填 selector；role 填 role / name / exact / includeHidden），
可填 `framePath` 与 `index`；点“校验”会调 `POST /api/validate`，返回的
错误逐条列出；点“预览”会在浏览器内对原始页面 DOM 做匹配预览：显示你
的定位器与该页面冻结定位器各自匹配到的元素个数、首个匹配元素，以及
两者是否命中同一元素（仅预览，不计算 verdict；iframe / Shadow DOM 内的
目标可能无法在顶层 DOM 预览中解析，最终判定以 `POST /api/analyze` 的
执行结果为准）。

## 3. 如何运行一次压力测试

### 方式 A：Web UI（推荐新手）

1. `npm run build`，然后 `node dist/ui/server.js`，打开打印出的
   `UI_URL`（形如 `http://127.0.0.1:<port>`）。
2. 在“Fixture Lab”页签选一个页面（F001–F024，可按族、按 kind、按控制组
   过滤），或先在“Locator 编辑”页签写好自己的定位器。
3. 点“运行分析”：后端对该页面跑 baseline（无变异）+ 8 个单变异
   （`POST /api/analyze`），结果出现在“Verdict Matrix”页签。
4. 点“运行 BFS”：对该页面跑有界 BFS（`POST /api/search`），结果出现在
   “BFS Witness”页签。
5. 在“Report”页签看分数与导出。

UI 只做展示与调用：verdict 分类、分数计算、变异执行都在服务端用冻结模块
完成，浏览器里不算分数、不判 verdict。

### 方式 B：本地 API（供脚本调用）

UI 服务把冻结 API 服务代理在 `/api/*` 下；端点见 README 的表格。
一次分析的最小调用是 `POST /api/analyze`（参数为 fixtureId 与定位器），
一次 BFS 是 `POST /api/search`（接受 `fixtureId`，以及可选的 `maxDepth` /
`maxExpandedStates`——只能要求更小的上限，放大上限会被拒绝；
`operatorOrder` / `allowRepeat` 是仅供测试的选项，API 会直接拒绝）。
请求体超过 1 MiB 会返回 400；JSON 不合法同样返回 400，不会使服务崩溃。

### 方式 C：全量门禁与全量报告

- `npm run s0:gate`：24 个页面 × baseline + 8 变异 = 192 个用例全跑，外加
  Oracle parity 核对与 100 次 hash 重放。预期输出见
  `release/HOW_TO_REPRODUCE.md`。
- `npm run report:t008`：生成一份完整的 T008 AnalysisReport
  （`evidence/s2/T008_API_REPORT.json`），含逐用例 verdict、分数、对照组、
  BFS 抽样与四层哈希；报告写出后会重读并重算全部哈希自检。
- `npm test`：511 个测试，覆盖单元、集成、属性、变异、Oracle parity、
  e2e、离线、性能与压力。

## 4. 如何读 verdict（四态）

每个单变异用例 exactly 一个 verdict（或 null）：

| verdict | 含义 | 典型成因 |
| --- | --- | --- |
| `STABLE` | 唯一命中，且命中的就是原目标节点 | 定位器不受该变异影响 |
| `WRONG_TARGET` | 唯一命中，但命中的不是原目标 | 例如 M04 插入同名元素后定位器选中了新元素 |
| `AMBIGUOUS` | 匹配到多个节点 | 例如 M07 插入隐藏副本后 `includeHidden` 的定位器看到两个；M04 插入同名元素后、不用 `index` 限定的定位器同时命中两个 |
| `MISSING` | 匹配到 0 个，或 framePath 某层匹配到 0 个 iframe | 例如 M03 改类名后 class 定位器失效；M06 移入 Shadow DOM 后页面级定位器够不着目标；M08 改文本后依赖文本的 XPath（如 `//button[text()='Confirm']`）失效 |

判定顺序（`src/verdict/classify.ts`，按顺序执行）：执行状态非 COMPLETED →
无 verdict；计数矛盾（负数、非整数、终态数大于原始数）→ 无 verdict；
framePath 层失败（0 帧为 MISSING、多帧为 AMBIGUOUS）→ 按终态匹配数
（0 为 MISSING、>1 为 AMBIGUOUS）→ 恰好 1 个时看 Oracle 同一性
（是原目标为 STABLE、不是为 WRONG_TARGET、未知则无 verdict）。
**verdict 为 null 时状态为 `INCOMPLETE`，该用例不计入任何 verdict，
也不进入分数的分母。**

冻结 S0 门禁全集的 verdict 分布（`evidence/s0/S0_GATE.json`）：
STABLE 138、WRONG_TARGET 22、AMBIGUOUS 17、MISSING 15，共 192。
按 kind 分：css 为 46 / 9 / 5 / 4；xpath 为 42 / 9 / 5 / 8；
role 为 50 / 4 / 7 / 3（顺序均为 STABLE / WRONG_TARGET / AMBIGUOUS /
MISSING）。

## 5. 如何读稳定性分数与 BFS 见证

### 稳定性分数

公式（`src/score/stability-score.ts`）：

```text
stability_score = 100 × STABLE 用例数 / 已完成用例数
```

- 分子是 verdict 为 STABLE 的用例数；分母是“已完成”（有 verdict）的
  用例数，INCOMPLETE 的用例不进分母。
- 分数以十进制字符串报告（如全集 `"71.875"`），精确重算请用分子 /
  分母，不要用四舍五入后的字符串反推。
- 报告同时给出覆盖率 `100 × 已完成 / 应完成`，防止“分母小、分数虚高”。
- **分数只描述这套合成变异集上的表现，不是生产失效概率。** UI 与报告
  都明示这一点；不要把它解读为“该定位器在真实网站上有 71.875% 的概率
  不出问题”。
- 分数分三层报告：总体、按定位器种类（css / xpath / role）、按变异算子
  （M01–M08）。另有对照组指标：稳定控制误报 0/96，脆弱控制检出 96/96。

### BFS 见证

BFS 在 M01–M08 上搜索使定位器首次失效的最短变异序列（`src/search/bfs.ts`）：

- 上限冻结：**深度 ≤ 6，展开 ≤ 4096 个状态**。调用方只能要求更小的上限，
  要求更大上限会抛 `RangeError`。
- 同一算子在一条序列内不重复；子节点按 M01–M08 固定顺序生成，先进先出；
  找到的第一个见证就是最短的，最短之中按字典序最小。
- 状态按规范 state key 去重，首次访问者胜出。
- 三种结果状态（`status` 字段，永远与 `witness` 一起报告；`witness` 为
  null 时必须看 `status` 才知道含义）：
  - `FOUND`：找到了见证，`witness` 是最短失败序列（如 `[M01]`、
    `[M04]`）及该序列下的 verdict。
  - `BOUNDED_NO_WITNESS`：在已搜索的空间内没有失败序列。**不等于定位器
    对一切 DOM 变化都安全。**
  - `BOUNDED_INCOMPLETE`：展开预算耗尽、队列仍非空，搜索未完成；对预算
    之外的序列不做任何断言。注意：在完整 8 算子无重复树里，深度 6 的见证
    需要 8801 次展开，超过 4096 的冻结预算，所以深度 6 下出现
    `BOUNDED_INCOMPLETE` 是符合预期的正确结果，不是故障。
- **空见证绝不报告为“无见证 / 安全”**：报告里每个 null 见证旁边都有
  `status` 与一段 plain-language `meaning` 说明。

## 6. 如何导出 JSON / HTML

- **完整报告（推荐）**：`npm run report:t008` 生成
  `evidence/s2/T008_API_REPORT.json`；或调 `POST /api/export`，传入一份
  AnalysisReport，返回规范 JSON 文本。导出模块在
  `src/export/json-export.ts`：导出前会校验报告结构与四层哈希，不合法
  的报告拒绝导出。
- **离线 HTML**：`src/export/html-export.ts` 把同一份报告渲染成单文件
  HTML（内嵌报告 JSON，不引用外部资源），可离线打开；解析与安全处理见
  `src/export/html-escape.ts` 与 `src/export/templates/report.html.ts`。
- **UI 页面级导出**：在 Report 页签点“下载 JSON”，得到
  `<fixtureId>-analysis.json`（schema `locatorstress.ui-fixture-export/v1`），
  内容是当前页面的分析结果 + 见证 + 分数 + 对照组。这**不是** T008 完整
  AnalysisReport，不要把它当作全量报告提交或比对门禁哈希。
- **哈希自验**：报告内嵌四层规范对象，`hashCanonical(canonical.scenario)`
  等重算必须等于报告里的哈希值；`npm run report:t008` 写出后会自动重读
  重算一次。

## 7. UI 各面板说明

Web UI（`src/ui/index.html` / `app.js`）共 6 个页签，均为同一页面的
`tabpanel`：

| 页签 | 内容 |
| --- | --- |
| Fixture Lab — 24 个合成页面 | 页面列表（F001–F024），可按族 / kind / 控制组过滤；显示固定 seed、baseline 要求（每页 baseline 必须唯一命中原目标）、控制组数量（稳定 12 / 脆弱 12）；显示 API 健康状态 |
| Locator 编辑 | 定义当前定位器：kind、selector / role / name / exact / includeHidden、framePath、index；“校验”调 `POST /api/validate`；“预览”显示 baseline 解析结果；“重置”恢复该页面的应有定位器 |
| Mutation Lab — M01–M08 与 DOM diff | 8 个算子列表；点一个算子查看变异前后的真实 DOM diff（经 `POST /ui/dom-snapshot` 取回的 HTML 文本，仅展示，不含 verdict/score） |
| Verdict Matrix — 四态结果 | “运行分析”后，显示当前页面的 baseline + 8 个单变异 verdict 矩阵；点一个格子看该用例详情（匹配数、同一性、执行状态、期望 verdict） |
| BFS Witness — 最短失败序列 | “运行 BFS”后显示见证状态（FOUND / BOUNDED_NO_WITNESS / BOUNDED_INCOMPLETE）、见证序列、每步 verdict、搜索统计（已评估 / 已展开 / 去重 / 唯一状态 / 队列剩余）与预算说明 |
| Report — 稳定性分数与导出 | 总体 / 按 kind / 按算子的分数行、对照组指标、四层哈希（从证据文件只读读取，文件缺失时显示不存在）、“下载 JSON”页面级导出、“清空本次运行” |

补充说明：

- 顶部显示固定 seed 与 API 健康状态；API 不可用时健康状态会明示错误，
  不会用缓存结果冒充。
- `/ui/fixture-html/F001.html` … `F024.html` 以只读方式提供合成页面 HTML；
  Oracle 清单里的私有目标路径字段**不**通过 UI 提供。
- UI 服务只绑定 loopback；不要尝试把它暴露到局域网或公网——
  `startAnalysisServer` / UI 服务会拒绝非 loopback 的 host。

## 8. 常见问题

**Q：分数 71.875 是什么意思？我的定位器在生产环境有 71.875% 的概率不出问题吗？**
A：不是。71.875 = 138 / 192，是冻结 S0 全集里 STABLE 用例占已完成用例的
比例，只描述这 24 个合成页面 × 8 个变异。它不是生产概率，不要这样引用。

**Q：BFS 返回 BOUNDED_NO_WITNESS，是不是说明定位器安全了？**
A：不是。只说明在已搜索的空间（深度 ≤ 6、展开 ≤ 4096、同一算子不重复）
内没有找到失败序列。对搜索空间之外的变异组合不做任何保证。

**Q：BFS 返回 BOUNDED_INCOMPLETE，是不是出 bug 了？**
A：不是。这是预算耗尽的诚实报告。完整 8 算子树的深度 6 见证需要 8801 次
展开，超过冻结的 4096 预算；出现该状态时请缩小搜索深度或接受“未完成”
的结论，不要把它读作“无见证”。

**Q：verdict 是 null、状态 INCOMPLETE，是什么意思？**
A：该用例无法下结论（执行未完成、计数矛盾、或 Oracle 同一性未知）。
它不计入任何 verdict，也不进分数分母。不要把它当成 STABLE。

**Q：为什么我的定位器在 UI 里校验通过，跑出来却是 WRONG_TARGET？**
A：校验只检查结构合法性（字段、类型、framePath 层数），不检查它指向哪个
节点。WRONG_TARGET 是实验结果：定位器合法，但解析到了别的节点。请看
Mutation Lab 的 DOM diff 与 Verdict Matrix 的用例详情。

**Q：能在 UI 里直接测我自己的真实网站吗？**
A：不能。本工具只跑内置的 24 个合成页面，不加载外部 URL，不访问外网。
把真实 URL 贴进来不会被加载。

**Q：Chromium 版本报错 / 浏览器启动失败怎么办？**
A：运行器只认 Playwright 1.65.0 对应的 Chromium `158.0.8127.18`
（revision 1254），无回退。请确认 `~/.cache/ms-playwright/chromium-1254/`
存在且版本一致；版本不符即失败是符合设计的行为，不是偶发故障。
不要装其他版本去“凑合”。

**Q：Windows / macOS 上能用吗？**
A：只在 Linux（Ubuntu 24.04.5 LTS）上验证过。Windows 与 macOS **未测试**，
不保证可用，不要声称已验证。

**Q：跑 `npm run s0:gate` 很久没输出，是卡住了吗？**
A：门禁要跑 192 个真实浏览器用例加 100 次 hash 重放，需要几分钟；日志
按阶段输出（`stage fixtures` → `baseline` → `mutations` → 逐页面
`fixture F001 8/8 done` …）。只要日志在推进就是正常。不要中途去改
fixtures 或 golden 文件——门禁会失败，且改动会污染冻结证据。
