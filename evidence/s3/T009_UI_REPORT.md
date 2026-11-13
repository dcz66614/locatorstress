# T009｜本地 Web UI 与 DOM diff — 完成报告

**TASK_ID:** T009（S3，6h）
**STATUS:** PASS（验收命令全部通过；但有一项冻结代码缺陷以 P0 登记，见 §6——UI 内已设防，未改冻结代码）
**BASE_COMMIT:** `816ff49`（S2 PASS 记录；工作树当时干净）
**DATE:** 2026-11-10 ~23:10 GMT
**BUILDER:** 全新会话（T009 施工方）

## 1. 完成定义核对

- [x] 六个视图齐全：Fixture Lab、Locator 编辑、Mutation Lab、Verdict Matrix、BFS Witness、Report
- [x] 完整流程走通（真实 Chromium E2E 验证）：选 fixture → 编辑/校验 locator → 跑变异 → 看 verdict 矩阵与 witness → 看报告/下载 JSON
- [x] DOM diff 展示（Mutation Lab 单步 + 矩阵 case 详情 + BFS 每一步），行级新增/删除高亮
- [x] 不提供自动生成、推荐或修复 Locator 的功能（E2E 负向断言：无此类按钮；UI 内明示）
- [x] UI 不重新计算 verdict：verdict 来自 `POST /api/analyze`，witness 来自 `POST /api/search`，分数由 UI 服务器调用冻结的 T005 计分模块算出（`POST /ui/scores`），浏览器只展示
- [x] 零外部请求（E2E 全程记录页面请求，全部为 `http://127.0.0.1`）
- [x] 键盘操作：Tab 可到达全部控件并用 Enter 运行分析（E2E 实测）；窄屏 390×844 无横向溢出

## 2. 验收命令（真实结果，均由本会话亲自跑过）

| 命令 | 退出码 | 计数 |
|---|---:|---|
| `npm run test:ui` | 0 | **12/12 通过**（tests/ui/ui-flow.test.ts，真实 Playwright Chromium；全程约 8–28s） |
| `npm run typecheck` | 0 | — |
| `npm run test:verdict`（回归） | 0 | 37/37 |
| `npm run test:score`（回归） | 0 | 16/16 |
| `npm run test:api`（回归） | 0 | 27/27 |
| `npm run test:export:json`（回归） | 0 | 9/9 |
| `npm run build` | 0 | — |

未跑 `s0:gate`（按任务要求，那是协调员的事）。

E2E 覆盖的关键断言（F002 为主用例，F001 为键盘用例）：24 行 fixture、Locator 校验通过 + 浏览器内匹配预览“匹配 1 个元素 / 是否命中同一元素：是”、M01 DOM diff 含 `class="wrap"`、矩阵 M01 `WRONG_TARGET` / baseline 与 M03 `STABLE`、BFS depth 1 `FOUND [M01] WRONG_TARGET` + 逐步 diff、报告分数 `37.5 (3/8)` / coverage `8/8` / 四态 `WRONG_TARGET 5` / T008 与 S0 哈希、零外部请求、390px 无溢出。

## 3. 实现方式（架构决策）

**无新增 npm 依赖。**任务只允许 package.json 增加 `test:ui` 脚本，因此 UI 是零依赖的静态 HTML/CSS/原生 JS（无 React/Vite、无 CDN、无远程字体/脚本），符合离线要求。`src/ui/` 下 6 个文件：

- `src/ui/index.html` — 六视图页面骨架（tab 导航、表单、矩阵、报告）
- `src/ui/styles.css` — 样式；verdict 永远带文字（颜色不是唯一通道）；`@media (max-width: 640px)` 窄屏适配
- `src/ui/app.js` — 前端逻辑：渲染后端数据、行级 LCS DOM diff、Locator 浏览器内匹配预览（CSS/XPath/role + framePath，不计算 verdict）
- `src/ui/server.ts` — UI 服务器（Node 内置 http）：启动**冻结的** API 服务器并在同一源下代理 `/api/*`；提供静态 UI、fixture HTML（只读）、以及三个 UI 自有只读/展示端点（均以 `/ui/` 开头，不属于冻结 `/api` 契约）
- `src/ui/snapshot.ts` — DOM 快照：用**冻结的** fixture loader + 变异注册表在独立 Playwright 页面上真实执行变异序列，逐步序列化 DOM（含 open ShadowRoot 内容，`getInnerHTML({includeShadowRoots:true})`）；只返回 HTML 文本，不返回 verdict/score
- `src/ui/node-shims.d.ts` — 按项目先例（`src/api/node-shims.d.ts`）为 UI 服务器补充最小 `process` 声明；未引入 `@types/node`

**UI 自有端点（展示用，不参与 verdict/score 计算）：**

| 端点 | 作用 |
|---|---|
| `GET /ui/fixture-html/F001.html…F024.html` | 合成 fixture HTML（公开合成数据；Oracle 私有字段从不提供） |
| `POST /ui/dom-snapshot` `{fixtureId, sequence[]}` | 真实变异后 DOM（每步一快照；序列 ≤6 步、无重复算子，与 BFS 规则一致） |
| `POST /ui/scores` `{cases}` | 服务端调用冻结 T005 `computeStabilityScores` / `computeControlMetrics` |
| `GET /ui/reports` | 只读读取 `evidence/s2/T008_API_REPORT.json` 的四个哈希与 `evidence/s0/S0_GATE.json` 的 gate 哈希 |

**启动：** `npm run build && node dist/ui/server.js --port 0`，打印 `UI_URL=http://127.0.0.1:<port>`；只绑 loopback（`assertLoopbackHost`，与 API 服务器一致）。

**Locator 编辑的诚实边界：**冻结 API 的 `/api/analyze` 只接受 `fixtureId`（不接受自定义 locator），所以分析始终使用所选 fixture 的冻结 Locator；编辑区用于 ① 后端 `/api/validate` 校验草稿语法、② 浏览器内匹配预览（匹配计数 + 是否命中同一元素）。UI 内已明示这一点。

## 4. 新增/修改文件与 SHA-256

| 文件 | SHA-256 |
|---|---|
| `src/ui/index.html` | `7c640c1822693081b72d08417c2ddedbfb57e6f85a32ffbe917c977677025142` |
| `src/ui/styles.css` | `5cd3e5d02038151de0f8a6c959dd45fc3cf622baf78f12bfbffe2a3f69a31345` |
| `src/ui/app.js` | `ea353228bcf4d26d73d50818fef782b5d4fc706170af3ed92e9ae4ba1f7f842c` |
| `src/ui/server.ts` | `ce143067cff21dbce1ec78d846b9b8644eea2fe83190c04f2d188129bbceb0c2` |
| `src/ui/snapshot.ts` | `95d7481dea0535e7960573fbcc499f8a836da1c3002fd1234a6c5b1fc8bb7160` |
| `src/ui/node-shims.d.ts` | `5afd4c231a9e11df1ea75dc08ac09b1f2a5571729b8eb3aa8e6bed2c99e570c6` |
| `tests/ui/ui-flow.test.ts` | `a8509641fbab726df412e474aff0576acbae20e005a54ecd720f2e76db266383` |
| `package.json`（仅 +1 行 `test:ui` 脚本） | `2d62da4a0796cbd4774737e23b4c34696e9aebe087782cfcccddf947c8f130eb` |

**未修改的受保护文件：**`src/verdict/`、`src/score/`、`src/oracle/`、`src/search/`、`src/canonical/`、`src/mutations/`、`src/api/`、`src/contracts/`、`src/runner/`、`src/export/`、`src/fixtures/`（含 golden）、`evidence/s0/`、`scripts/` 均未动。`git status` 只有 `package.json` 修改 + `src/ui/`、`tests/ui/`、`evidence/s3/` 新增。S0 证据未变：`evidence/s0/S0_GATE.json` SHA-256 仍为冻结值 `15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d`（gate_sha256 `651c3fd4…`）。

## 5. 截图（E2E 自动拍摄，1280×800，除窄屏外）

| 截图 | 路径 | SHA-256 |
|---|---|---|
| Verdict Matrix（F002） | `evidence/s3/screenshots/matrix-F002.png` | `d814537d961fb6d9c0e54437826f5c8090eb41d209c382229f85f2e9d3b9a7a2` |
| BFS Witness（F002） | `evidence/s3/screenshots/witness-F002.png` | `f5c84317f167c99e24ece418a8207671002dc5346a7b34a0975b9501facd60d6` |
| Report（F002） | `evidence/s3/screenshots/report-F002.png` | `a9a919851173a1ed1cc56f4659234899a3cde63699abf438502fdf7798e02fa1` |
| 窄屏 390×844 | `evidence/s3/screenshots/narrow-390.png` | `8a7e4663adffa99a11b081300548fcdf426646e319d93441119f304f4f9b7e06` |

三张主截图均已由本会话目视检查：矩阵 verdict 与后端一致（F002：baseline STABLE；M01/M02/M04/M06/M07 WRONG_TARGET；M03/M05/M08 STABLE），报告分数 37.5（3/8）、coverage 8/8，witness FOUND [M01] 深度 1。

## 6. P0：冻结 API 的 `/api/validate` 崩溃缺陷（T008 遗留，本任务未改冻结代码）

**后续：FIX-T009 已修复（2026-11-10 ~23:24 GMT，未 commit 前的树内状态）**——`service.validate()` 只在 `locator` 已定义时才包含该字段 + `server.ts` 外层 catch 查 `res.headersSent` 纵深防御，回归测试见 `tests/api/validate-http.test.ts`（3 个真实 HTTP 测试）；协调员与聚焦复审者分别亲手复现验证：无效 xpath 与合法 scenario-only 请求均返回 HTTP 200 且服务器存活。本节下文记录的是 T009 施工时的原始发现（修前状态），供追溯；“未修复 / 修复前仍可杀死服务器”的表述以本段为准作废。

**现象：** 任何使 `service.validate()` 返回 `locator: undefined` 的 `/api/validate` 调用都会让整个 API 服务器进程崩溃（连带 UI 服务器同进程死亡），随后所有请求 `ECONNREFUSED`。T009 初版 E2E 因此 9/11 失败、耗时 210s。

**最小复现（已验证两次，均直接打 API 端口，与 UI 代理无关）：**

```powershell
curl -X POST http://127.0.0.1:<api-port>/api/validate \
  -H 'content-type: application/json' \
  -d '{"locator":{"kind":"xpath","selector":"/html/body/main/form/button[1]","exact":false,"includeHidden":false}}'
# → 连接失败；服务器日志：
# Error [ERR_HTTP_HEADERS_SENT]: Cannot write headers after they are sent to the client
#     at Server.<anonymous> (dist/api/server.js:90:17)  # 外层 catch 的 res.writeHead(500)
```

**根因链（已定位，未修复——不在 T009 修改权限内）：**

1. `src/contracts/locator.ts`：`exact` / `includeHidden` 是 role-only 键；css/xpath 传入即 invalid。上面请求因此 `valid:false`。
2. `src/api/service.ts` `validate()` 恒返回 `{ valid, errors, locator }`——无效时 `locator` 为 `undefined` 自有属性；scenario-only 调用（即使 scenario 有效）同样如此。
3. `src/api/server.ts` 先 `res.writeHead(result.status)` 再 `res.end(canonicalJson(result.body))`；而 `src/canonical/canonical-json.ts` `canonicalize()` 遇到 `undefined` 值即抛错（T006 冻结行为，C4）。于是 headers 已发、body 未发；外层 catch 再 `writeHead(500)` 抛 `ERR_HTTP_HEADERS_SENT`，未捕获 → 进程退出。

**为什么 T008 没发现：** `server.test.ts` 用 fake service 且从不以 fake service 之外的方式发有效 JSON 的 validate 请求，且 fake 的 validate 从不返回含 `locator: undefined` 的对象；`routes.test.ts` 直接测 `handleApiRequest`（不走 `canonicalJson`）；service 层测试只断言返回值。

**T009 内的设防（UI 侧，不改冻结语义）：**

- 修了 UI 自身的 bug：`readLocatorForm()` 原先对 css/xpath 也发送 `exact`/`includeHidden`（正是触发崩溃的非法键）；现只按 kind 发送允许的键。
- 新增 `checkLocatorShape()` 格式守卫：空 selector/role、framePath 超 2 层、非法 index 等格式问题先在浏览器内拦下并明示“未发送给后端”；通过格式检查的草稿一律发后端校验。E2E 有回归测试：空 selector → 显示格式错误，且随后 `/api/health` 仍 200（服务器存活）。
- 守卫只覆盖表单能产生的输入；语义校验仍以后端为准。

**建议的冻结代码修复（请协调员开 FIX 任务，T009 无权改）：** 任选其一即可：(a) `service.validate()` 只在 `locator` 已定义时才包含该字段；(b) `server.ts` 外层 catch 写 500 前检查 `res.headersSent`。另建议补一个 HTTP 层测试：无效 locator 调 `/api/validate` 应返回 200 `{valid:false,…}` 且服务器存活。**在修复前，任何直接调 `/api/validate` 的客户端都可能杀死服务器——这是 T009 的 P0 遗留风险，UI 守卫只覆盖 UI 自身的调用路径。**

## 7. 本任务内修复的两个 UI bug（均有测试覆盖）

1. **Locator 表单误发 role-only 键**（见 §6）：css/xpath 草稿带上 `exact`/`includeHidden` 导致后端判定 invalid。已修：按 kind 组装字段。
2. **Tab 导航的 roving tabindex**：初版 tab 用 `tabindex="-1"`（ARIA roving 模式），导致纯 Tab 用户永远到不了非首 tab，键盘 E2E 失败。已修：全部 tab 保持默认 Tab 顺序，方向键仍可用。

## 8. P2 级别遗留问题与偏差

- **P2-1（T008 崩溃，见 §6）：** UI 守卫不能代替冻结修复；修复前 `/api/validate` 对非法输入仍是进程级崩溃向量。
- **P2-2：** Locator 匹配预览是浏览器内近似实现（role 靠隐式角色表 + accessible name 近似；iframe 需 srcdoc；Shadow DOM 内目标可能无法预览）。预览失败时 UI 明示“以后端执行为准”，不影响 verdict。
- **P2-3：** Report 视图的“四个哈希”目前展示 T008 全量报告与 S0 冻结门禁的哈希（只读读取证据文件）；单 fixture 的分析 JSON 下载是 UI 级导出（`locatorstress.ui-fixture-export/v1`），不是 T008 完整 AnalysisReport。离线 HTML 导出属 T010（`/api/export` HTML 目前返回 501，UI 内已注明）。
- **P2-4：** BFS 默认 `maxDepth=2`（UI 表单可改 0–6；深度 6 全预算搜索较慢，未在 E2E 中跑满；E2E 用 depth 1）。
- **P2-5：** E2E 用 vitest `expect.poll` 而非 `@playwright/test` 匹配器——项目未安装 `@playwright/test`，且任务不允许加依赖；12 个测试仍是真实 Chromium。
- **偏差：** 计划布局提到 `vite.config.ts` 与 React 19/Vite 7，但仓库实际无此配置与依赖，且任务限定 package.json 只加 `test:ui` 脚本，故 UI 采用零依赖静态实现；功能与验收不受影响。未使用 WorkBuddy/Copilot/agy 等模型路线——本任务由施工方直接编码，无需调用外部模型（任务书中的路线说明是为需要模型调用时准备的）。
- **未解决项：** 无其他未解决项；`npm run test:ui` 与回归全部通过。

## 9. 交接格式

```text
TASK_ID: T009
STATUS: PASS (with P0 frozen-code defect logged in §6, guarded in-UI, not fixed — needs a FIX task)
BASE_COMMIT: 816ff49
RESULT_COMMIT: (未提交；协调员验收后统一提交)
CHANGED_FILES: package.json (1 line); src/ui/ (6 new); tests/ui/ui-flow.test.ts (new); evidence/s3/T009_UI_REPORT.md + evidence/s3/screenshots/ (4 PNGs)
UNTOUCHED_PROTECTED_FILES: src/verdict src/score src/oracle src/search src/canonical src/mutations src/api src/contracts src/runner src/export src/fixtures evidence/s0 scripts
COMMANDS: npm run test:ui; npm run typecheck; npm run test:verdict; npm run test:score; npm run test:api; npm run test:export:json
EXIT_CODES: all 0
TEST_COUNTS: test:ui 12/12; test:verdict 37/37; test:score 16/16; test:api 27/27; test:export:json 9/9
EVIDENCE_PATHS: evidence/s3/T009_UI_REPORT.md; evidence/s3/screenshots/matrix-F002.png, witness-F002.png, report-F002.png, narrow-390.png
SHA256: see §4–§5
KNOWN_LIMITATIONS: §6 P0 (frozen /api/validate crash — UI-guarded, needs FIX task); §8 P2-2–P2-5
FAILED_CASES: none in final run (earlier runs failed on the §6 crash + §7 UI bugs; fixed/guarded, final run 12/12)
ROLLBACK_POINT: 816ff49 (delete src/ui/ + tests/ui/ + evidence/s3/ and revert the one package.json line)
NEXT_TASK_PREREQUISITES: T010 (HTML/JSON export) needs the §6 FIX first if it calls /api/validate with invalid input; otherwise independent
```
