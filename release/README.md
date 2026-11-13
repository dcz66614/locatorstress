# LocatorStress — 浏览器自动化定位器确定性 DOM 变异压力实验室

LocatorStress（P022）用一套固定的合成页面与变异算子，检验 Playwright
定位器在 DOM 变化后是否仍然命中同一个目标节点。它回答的不是“这个定位器
在真实网站上好不好用”，而是“在可复现、可穷举对照的合成条件下，这个定位器
在哪些变异下会失效、失效的方式是什么、最短的失败变异序列是什么”。

- 包名：`locatorstress`，版本 `0.1.0`（见 `package.json`）
- 固定 seed：`P022-LOCATORSTRESS-S0-2026-11-10`
- 冻结 S0 门禁：`GATE PASS`，`gate_sha256`
  `651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52`
 （见 `evidence/s0/S0_GATE.json`）

## 解决什么问题

写 UI 自动化的人都遇到过：定位器今天能用，页面改了一点结构、类名、文案或
嵌套后就悄悄点错了元素，或者匹配到多个元素，或者找不到了。LocatorStress
把这种“悄悄变脆弱”变成可度量的实验：

1. **24 个合成页面**（`src/fixtures/pages/F001.html` … `F024.html`），覆盖
   CSS / XPath / role 三种定位器，每种 8 个页面；12 个稳定控制（stable）与
   12 个脆弱控制（fragile），每组 96 对对照，共 192 对。
2. **8 个确定性变异算子** M01–M08（包裹目标、重排兄弟节点、改类名、插入
   同名元素、嵌套 iframe、移入 open Shadow DOM、插入隐藏副本、改文本），
   与 24 个页面组合成 **192 个单变异用例**。
3. **独立 Oracle**：每个页面在变异前用结构位置路径（例如
   `main > form > button:nth-child(2)`）私下捕获目标节点；变异后在页面内
   用 DOM 对象同一性（`===`）判定解析结果是不是同一个节点，不依赖定位器
   本身的匹配数。
4. **四态 verdict**：`STABLE`（唯一命中且是原目标）、`WRONG_TARGET`（唯一
   命中但不是原目标）、`AMBIGUOUS`（匹配到多个）、`MISSING`（匹配到 0 个
   或帧层解析失败）。无法下结论时 verdict 为 null、状态为 `INCOMPLETE`，
   绝不计入 STABLE。
5. **稳定性分数**：`100 × STABLE 用例数 / 已完成用例数`。冻结 S0 门禁的
   全集分数为 **71.875**（138 / 192）。分数只描述这套合成变异集上的表现，
   不是生产环境下的失效概率。
6. **有界 BFS 最短失败序列**：在 M01–M08 上做广度优先搜索，找使定位器首次
   失效的最短变异序列（同一算子一条序列内不重复）。上限固定为深度 6、
   最多展开 4096 个状态；结果状态为 `FOUND` / `BOUNDED_NO_WITNESS` /
   `BOUNDED_INCOMPLETE`，其中后两者都不代表“定位器对一切 DOM 变化都安全”。

## 快速开始

环境要求：Node.js ≥ 24（本机实测 `v24.22.1`），npm 10.9.4，Linux。
Chromium 由 Playwright 1.65.0 提供，版本 `158.0.8127.18`（revision 1254），
运行器只认这一个版本，无回退。**Windows 未测试**，见“适用范围与限制”。

```bash
npm ci            # 按 package-lock.json 安装依赖（离线安装需已有缓存）
npm run build     # tsc 编译到 dist/
npm run s0:gate   # S0 门禁：192/192 用例 + Oracle parity + 100 次 hash 重放
npm test          # 全部测试，预期 511/511 通过
```

启动本地 Web UI（先 `npm run build`）：

```bash
node dist/ui/server.js            # 默认绑定 127.0.0.1 的临时端口
node dist/ui/server.js --port 8080  # 指定端口（仍只绑定 loopback）
```

启动后在标准输出打印 `UI_URL=http://127.0.0.1:<port>`，用浏览器打开即可。
UI 与 API 都只绑定 loopback 地址（`127.0.0.1` 或 `::1`），不对外网暴露；
运行全程不产生外部网络请求（外部请求计数必须为 0）。

本地 API 服务（供脚本调用，无框架、仅 Node 内置 `http`）没有独立的 npm
启动脚本：它由 Web UI 服务在内部启动并通过 `/api/*` 代理出来（见
`src/ui/server.ts`），也可以在代码里用
`createBrowserAnalysisService` + `startAnalysisServer(service)` 启动
（见 `scripts/t008-api-report.ts` 的用法）。不要直接以无参方式调用
`startAnalysisServer`，它需要一个 `AnalysisService` 实例。

API 端点（见 `src/api/routes.ts`）：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 服务状态、seed、BFS 上限 |
| GET | `/api/fixtures` | 24 个合成页面（仅公开字段） |
| GET | `/api/mutations` | M01–M08 合约（固定顺序） |
| POST | `/api/validate` | 校验 LocatorSpec / 场景 |
| POST | `/api/analyze` | 某页面 baseline + 8 个单变异分析 |
| POST | `/api/search` | 某页面的有界 BFS 见证 |
| POST | `/api/export` | 导出 AnalysisReport 的 JSON |

生成一份完整的 T008 分析报告（24 个页面 × baseline + 8 变异，含真实 BFS
抽样、报告哈希重算）：

```bash
npm run report:t008   # 写入 evidence/s2/T008_API_REPORT.json
```

## 核心概念

- **LocatorSpecV1**（见 `src/contracts/locator.ts`）：`kind` 为 `css` /
  `xpath` / `role` 之一。CSS/XPath 只用 `selector`；role 用 `role` +
  可选 `name` / `exact` / `includeHidden`；三者都可带 `framePath`（0–2 层
  iframe 的 CSS 选择器）与 `index`（0-based `.nth(index)`）。不支持任意 JS、
  定位器回调、正则函数，也不生成定位器。
- **变异算子**：M01 `WRAP_TARGET`、M02 `REORDER_SIBLINGS`、M03
  `CHANGE_CLASS`、M04 `INSERT_SAME_NAME`、M05 `NESTED_IFRAME`、M06
  `MOVE_TO_OPEN_SHADOW_ROOT`、M07 `INSERT_HIDDEN_DUPLICATE`、M08
  `CHANGE_TEXT`。顺序固定为 M01–M08，BFS 的字典序 tie-break 依赖该顺序。
- **Oracle parity**：生产解析结果的每个字段都要与独立 Oracle 的期望值逐
  项一致；192/192 全对才算通过，任一字段不匹配即 FAIL。
- **对照组**：稳定控制 12 个页面 × 8 变异 = 96 对，误报 0/96；脆弱控制
  12 个页面 × 8 变异 = 96 对，全部 96 个被检出。门禁阈值见
  `evidence/s0/S0_GATE.json` 的 `thresholds`。
- **冻结哈希**：场景、Oracle 结果、分析、门禁四层哈希逐层嵌套
  （`scenario_sha256`、`oracle_result_sha256`、`analysis_sha256`、
  `gate_sha256`），全部用规范 JSON（canonical JSON，键排序）计算；重放
  100 次只产生 1 个 gate hash。

## 输出

- **JSON 报告**：`AnalysisReport`（schema `locatorstress.analysis-report/v1`，
  见 `src/contracts/report.ts`），含逐用例 verdict、稳定性分数、对照组指标、
  BFS 见证摘要、四层哈希与可重算的规范对象。导出与校验见
  `src/export/json-export.ts`（`POST /api/export`）。
- **离线 HTML 报告**：同一报告渲染成的单文件 HTML（内嵌报告 JSON，见
  `src/export/html-export.ts` 与 `src/export/templates/report.html.ts`），
  不依赖外部资源，可离线打开。
- **UI 导出**：Web UI 的“下载 JSON”按钮导出当前页面的分析结果
  （schema `locatorstress.ui-fixture-export/v1`，文件名为
  `<fixtureId>-analysis.json`），这是页面级导出，**不是** T008 完整
  AnalysisReport。
- **S0 门禁证据**：`evidence/s0/S0_GATE.json`（门禁结果与哈希）、
  `evidence/s0/S0_REPEAT_HASH.json`（100 次重放）、
  `evidence/s0/S0_GATE.log`（逐行日志）。

## 适用范围与明确限制

- **这是合成数据实验室，不是真实设备兼容认证。** 所有页面、变异、期望
  verdict 都是人工设计的合成用例；结论只对这 24 个页面 × 8 个变异成立，
  不能外推为“该定位器在真实网站 / 真实设备上稳定”。
- **无真人、无真网、无付费 API。** 运行不需要人工参与，不访问外部网络，
  不调用任何付费服务；浏览器只加载本地合成 HTML。
- **只在 Linux 上验证过**（Ubuntu 24.04.5 LTS，见 `ENVIRONMENT_REPORT.md`）。
  **Windows 未测试**，macOS 未测试；不要声称已在这些平台验证。
- **只认一个 Chromium 版本**：`158.0.8127.18`（Playwright 1.65.0 /
  revision 1254）。版本不符即失败，不回退到其他版本。
- **iframe / Shadow DOM 有明确边界**：`framePath` 最多 2 层；M05 只做一层
  嵌套 iframe，M06 只处理 open Shadow Root；超出范围的行为不在保证内，
  不做猜测。
- **BFS 有界**：深度 ≤ 6、展开 ≤ 4096 个状态。`BOUNDED_NO_WITNESS` 只表示
  “在已搜索的空间内没有失败序列”，`BOUNDED_INCOMPLETE` 表示预算耗尽、
  搜索未完成；两者都不等于安全。
- **不生成定位器**：本工具只检验你给出的定位器，不推荐、不生成、不改写
  定位器。

## 仓库布局

```text
package.json / package-lock.json   依赖与脚本（直接依赖见 THIRD_PARTY_NOTICES.md）
src/contracts/      LocatorSpecV1、AnalysisReport 等冻结契约
src/fixtures/       24 个合成页面、Oracle 清单、golden 期望 verdict
src/mutations/      M01–M08 变异算子与注册表
src/runner/         浏览器启动、帧作用域、定位器解析、执行
src/oracle/         独立 Oracle：目标捕获、同一性比较
src/verdict/        四态分类（classify.ts）
src/score/          稳定性分数与对照组指标
src/search/         有界 BFS（bfs.ts）与浏览器求值器
src/analysis/       报告组装与 BFS 见证
src/canonical/      规范 JSON 与哈希（冻结）
src/api/            loopback API 服务（server.ts / routes.ts / service.ts）
src/export/         JSON / 离线 HTML 导出
src/ui/             本地 Web UI（index.html / app.js / server.ts）
scripts/           s0-gate.ts、repeat-hash.ts、t008-api-report.ts 等
tests/             511 个测试（单元 / 集成 / 属性 / 变异 / e2e / 离线 / 性能 / 压力）
evidence/          环境、S0–S4 各阶段证据（S0 门禁文件为冻结证据）
release/           本目录：发布文档（README / 指南 / 许可清单）
```

## 许可证

项目许可证：**PENDING_SAM_DECISION**（待 Sam 决定）。仓库当前**没有**
`LICENSE` 文件；在 Sam 决定之前，不生成、不声称任何许可证。详情见
`release/LICENSE_STATUS.md`；第三方依赖的许可证见
`release/THIRD_PARTY_NOTICES.md`。

## 相关文档

- `release/USER_GUIDE.md` — 用户指南（定义定位器、运行、读结果、导出）
- `release/HOW_TO_REPRODUCE.md` — 复现指南（环境、门禁与测试的预期输出）
- `release/THIRD_PARTY_NOTICES.md` — 依赖许可清单（全部 75 个依赖包）
- `release/LICENSE_STATUS.md` — 项目许可证状态
- `P022_PROJECT_BOOK.md`、`P022_IMPLEMENTATION_PLAN.md` — 项目书与实施计划
- `ENVIRONMENT_REPORT.md` — 环境实测记录
