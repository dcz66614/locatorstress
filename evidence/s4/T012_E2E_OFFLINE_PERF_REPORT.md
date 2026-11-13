# T012 E2E、离线、性能与压力报告 — P022 LocatorStress（S4）

- 任务：T012 浏览器 E2E、离线、性能与压力
- 日期：2026-11-11（UTC；施工 03:48–04:26 GMT）
- 执行人：T012 施工方（Muse 子代理，fresh session，只做 T012）
- 工作目录：`~/workspace/p022-locatorstress/`（本地 git，无远程；本任务不 commit、不 push）
- BASE_COMMIT：`35366d3`（T011 已提交）
- 结论：见 §1。生产代码零修改（§9 核对）。

## 1. 验收结论

| 验收命令 | 退出码 | 结果 |
|---|---|---|
| `npm run test:e2e` | 0 | 7/7 通过，测试耗时 11,361 ms（另有 `build` 约 3 s） |
| `npm run test:offline` | 0 | 6/6 通过，测试耗时 6,563 ms |
| `npm run test:performance` | 0 | 4/4 通过，测试耗时约 149 s（ dominated by 真实浏览器 BFS，见 §5） |
| `npm run test:stress` | 0 | 6/6 通过，测试耗时 6,587 ms |
| `npm run build` | 0 | `tsc` 通过（最后确认 04:26 GMT） |

**STATUS：PASS。** 五条验收命令全部 exit 0。

回归：`npm test` 全量 **509/509 通过**（39 个文件，281.08 s，2026-11-11 04:19:44 GMT 开始）——T011 基线 486 个 + 本任务新增 23 个，0 失败，0 跳过。其中包含加固后的 P2-A detach 回归测试 2/2（见 §7）。

## 2. 新增 / 修改文件

### 新增测试文件（4 个，23 个测试）

| 文件 | 内容 | 测试数 |
|---|---|---|
| `tests/e2e/e2e-helpers.ts` | 共享 helpers：UI 服务器 spawn、Chromium 启动、expectText/Count/Visible、键盘 tabTo、P95 计算、外部 URL 判定 | 0（helpers） |
| `tests/e2e/e2e-main-flow.test.ts` | 真实 Chromium 全流程：F002 选择→校验/预览→M01 diff→矩阵→BFS 见证→报告→下载 JSON 与后端逐字段比对；F001 全 STABLE；键盘-only 全流程（Tab/Enter/ArrowRight/ArrowLeft/Shift+Tab）；无效草稿守卫；全程请求录音 | 7 |
| `tests/e2e/offline.test.ts` | 静态外部 URL 扫描；在线 UI 会话 0 外部请求；导出 HTML 在离线 context 下 file:// 打开 0 请求/0 对话框；敌意页面外部 img+fetch 被拦截；API 只绑 loopback；`/api/export` HTML 为 501 | 6 |
| `tests/e2e/performance.test.ts` | 192 矩阵 ×3 采样 P95；BFS 存根评估器 4096 ×5 采样；真实浏览器 BFS 4096（F001）一次；Node RSS 采样；写 `evidence/s4/T012_PERF.json` | 4 |
| `tests/e2e/stress.test.ts` | F002 verdict 向量 5 次重复一致；3 context 并发 3 fixture 全矩阵；5,000 节点大 DOM；200 层深 DOM；BFS 越限 RangeError 与深度上限；UI 服务器并行 analyze 与重复调用字节一致 | 6 |

### 修改的文件

| 文件 | 改动 |
|---|---|
| `package.json` | 新增脚本 `test:e2e` / `test:offline` / `test:performance` / `test:stress`（均为 `npm run build && vitest run tests/e2e/<file>`） |
| `tests/integration/p2a-detach-regression.test.ts` | P2-1 加固（见 §7）：detach 扫窗 38–80 ms → 30–120 ms（步长 2 ms），重试 3 pass → 5 pass；只改测试，不改生产代码 |

### 新增证据

| 文件 | 内容 | SHA-256 |
|---|---|---|
| `evidence/s4/T012_PERF.json` | 性能实测全部数字 + 环境（由 performance 测试生成） | `b1838d3ff1c0a20d9f3961f58a7469bc451352d4c7c4ca01602101ba6f57e589` |
| `evidence/s4/T012_E2E_REQUESTS.json` | E2E 全程请求录音：29 个请求，外部 0（由 e2e 测试生成） | `497de20a8405aadf8af3e689708e764c1f300d3e0afe36f539cc19779b206197` |
| `evidence/s4/T012_E2E_OFFLINE_PERF_REPORT.md` | 本报告 | （见提交时核对） |

### 证据文件重写说明（FIX-P022-T013-04，2026-11-11，修复 T013 P2-18）

本报告 §5 的性能数字与上表 SHA 已按 HEAD 提交的证据文件（`T012_PERF.json`、`T012_E2E_REQUESTS.json`）复核并修正为准。性能/e2e 证据文件按设计每次运行都会重写：本报告初稿写成后，后续全量运行改写了这两个文件，导致初稿数字与 HEAD 文件不一致（原报告矩阵 P95 6832 ms、存根 P95 14 ms、RSS 216.4 MiB、真实 BFS 133,801 ms，均为初稿运行的实测值）。本报告数字现对应冻结前最后一次全量运行的 HEAD 文件；此后任何一次运行都会产生新的耗时/RSS 数字与新的文件 SHA，但三轮运行的矩阵 P95（6760 / 6934 / 7914 ms，均 ≤ 60,000 ms 目标）、per-fixture P95（703 / 945 / 813 ms，均 ≤ 2,000 ms 目标）与 RSS 峰值（217.6 / 223.1 / 219.8 MiB，均 ≤ 512 MiB 目标）均在目标内；存根 BFS P95 只断言本轮（HEAD 文件对应轮，P95 15 ms，目标 ≤ 5,000 ms），另两轮的存根 P95 未记录在案，不作三轮断言，且真实浏览器 BFS 的六项计数（statesEvaluated 3761、statesExpanded 1024、statesDeduplicated 2123、uniqueStates 1638、queueRemaining 0、maxDepthReached 6）三轮完全相同；结论不受影响。如报告数字与证据文件再次出现偏差，以证据文件为准。§5.2–§5.4 中“交叉核对 / 另两次运行”所列数字为本任务期间另外两轮独立运行的历史实测值，不随 HEAD 文件改写。

### 未修改

生产源码（`src/`，`git diff -- src/` 为空）、golden expected outcomes、fixtures、hash contract、release freeze——全部未动，见 §9。

## 3. E2E 主流程（`test:e2e`，7/7）

真实 Chromium（158.0.8127.18）+ 真实 UI 服务器（`node dist/ui/server.js --port 0`，loopback 临时端口）。

| 用例 | 结果（实测） |
|---|---|
| F002 全流程 | 选择 F002（xpath, fragile）→ 冻结 locator `/html/body/main/form/button[1]` 校验通过、预览匹配 1 个元素且命中同一元素 → M01 diff 出现 `class="wrap"` → 矩阵 M01 WRONG_TARGET、baseline STABLE → BFS depth 1 FOUND [M01] → 报告分数 **37.5（3/8）**、WRONG_TARGET 5、coverage 8/8、含 T008 与 S0 哈希 |
| 下载 JSON 与后端逐字段比对 | 下载 `F002-analysis.json`；analysis 9 个 case（baseline + M01–M08）的 verdict / analysisStatus / executionStatus / matchCount / identityMatch / expectedVerdict / matchesGolden 与直接 `POST /api/analyze` 的响应逐字段一致，且全部 `matchesGolden: true`；witness 与 `POST /api/search`（depth 1）一致：status FOUND、sequence [M01]、verdict WRONG_TARGET；scores.overall.score 37.5 |
| F001 全流程 | 8 个变异全部 STABLE；报告分数 **100（8/8）**；API 侧 8 case 全部 STABLE 且 matchesGolden |
| 键盘-only 全流程 | 仅用 Tab / Enter / ArrowRight：Tab 到 F003 行、Enter 选中 → ArrowRight 切过 Locator/Mutation 到 Matrix → Tab 到“运行分析”、Enter 运行（baseline STABLE、M04 AMBIGUOUS、M01 STABLE）→ ArrowRight 到 Witness、Enter 运行 BFS（FOUND [M04]）→ ArrowRight 到 Report（分数 **87.5**，7/8）→ Tab 到“下载本次分析 JSON”、Enter 触发下载 `F003-analysis.json` |
| 键盘 ArrowLeft/Shift+Tab | Fixture Lab 标签上 ArrowLeft 回绕到 Report 视图；ArrowRight 回到 Fixture Lab；Shift+Tab 焦点后移一位（不等于原焦点） |
| 无效草稿守卫 | 选 F002（xpath）后清空 selector 再校验 → “格式检查未通过 / selector must be a non-empty string”；随后 `/api/health` 仍 200，服务器存活；恢复冻结 locator |
| 全程请求 | 29 个请求，**外部请求 0**，全部 `http://127.0.0.1`（明细见 `T012_E2E_REQUESTS.json`；含 `/app.js`、`/api/health`、`/api/analyze`、`/api/search` 等） |

Chromium tracing：E2E 套件全程开启 tracing（screenshots + snapshots）；失败时由 `afterEach` 把 trace 存到 `evidence/s4/traces/e2e-main-flow-<用例>.zip`。**本次全部通过，无失败，因此没有生成 trace 文件**（`evidence/s4/traces/` 不存在）。调试期间一次失败（witness 结构问题，见 §8 F-2）曾生成一个 trace zip，已随当时的 `traces/` 目录清理删除，不作为证据保留。

## 4. 离线（`test:offline`，6/6）

| 检查 | 结果（实测） |
|---|---|
| 静态扫描 | `src/ui/index.html`、`src/ui/app.js`、`src/ui/styles.css`、`src/export/templates/report.html.ts`、`src/export/html-export.ts` 五个文件：非 loopback 的 `http(s)://` 引用 **0 处**；真实报告导出 HTML 的 `scanExternalResources` 为空，且不含 `src="http` / `href="http` |
| 在线 UI 会话 | goto + 选 F002 + 矩阵分析全程：记录到的请求全部 `http://127.0.0.1`，**外部请求 0**；另一次直接 `/api/analyze` 调用同样 loopback |
| 导出 HTML 离线打开 | 真实报告（含 `<script>alert(1)</script>` 等 payload）在 `offline: true` 的浏览器 context 下以 `file://` 打开：非 `file:` 请求 **0**，对话框 **0**，`<script>` 仅 1 个 `application/json`，资源标签（img/iframe/link/video/…）0 个，`on*` 属性 0 个；payload 仅以文本显示；内嵌 JSON 与 canonical JSON 相等 |
| 敌意页面拦截（正向验证） | 含 `<img src="https://example.invalid/x.png">` 的页面 + `fetch("https://example.invalid/")`：route handler 拦截到 **≥2 次外部尝试，全部 abort**（`blocked == external`，计数器证明拦截确实触发，不是“什么都没发生”）；页面随后仍可正常求值（按钮文本、表达式均正常） |
| 服务器绑定 | `startAnalysisServer` 对 `0.0.0.0` 与 `192.168.1.1` 均抛 `loopback` 错误；`127.0.0.1` 可正常启动并报告该地址 |
| API 导出边界 | `POST /api/export {format: "html"}` 返回 **501** `HTML_EXPORT_NOT_IMPLEMENTED`：HTML 导出只是本地文件操作，不经过 API |

## 5. 性能（`test:performance`，4/4）

### 5.1 环境（实测，非抄录）

| 项 | 值 |
|---|---|
| Node.js | v24.22.1 |
| npm | 10.9.4 |
| Playwright | 1.65.0 |
| Chromium | 158.0.8127.18（`browser.version()` 断言通过；首次启动 883 ms，本轮） |
| CPU | AMD EPYC 9D25 126-Core Processor，4 vCPU 可见 |
| 内存 | 7934 MiB 总量 |
| OS | linux x64（Ubuntu 24.04.5 LTS，见 ENVIRONMENT_REPORT.md） |
| Seed | P022-LOCATORSTRESS-S0-2026-11-10 |

### 5.2 192 单变异矩阵（3 次采样，全部 192 verdict 与 golden 比对，0 mismatch）

采样方法：同一浏览器、同一页面，24 fixtures × 8 变异全量跑 3 遍；每 case 计时、每 fixture（8 变异）计时；P95 用 nearest-rank；Chromium 首次启动时间单独计量并**排除**在 per-fixture P95 之外。

| 指标 | 实测 | 目标（IMPLEMENTATION_PLAN §9，建议目标） | 结论 |
|---|---|---|---|
| 192 例总耗时（3 样本） | 6760 / 5885 / 5658 ms；**P95 6760 ms** | P95 ≤ 60,000 ms | 通过（约目标的 11%） |
| 单 fixture 8 变异（72 样本） | **P95 703 ms** | P95 ≤ 2,000 ms | 通过 |
| 单 case（576 样本） | P95 101 ms，均值 31.73 ms | —（无目标） | 记录 |
| 最慢 fixture | F021，每轮 1100–1202 ms（1157 / 1100 / 1202） | — | 记录 |

交叉核对：同一套件在本任务期间还独立跑过两次（非验收轮），总耗时 P95 分别为 6934 ms（样本 6934/6599/6746）与 7914 ms（样本 7914/6127/6424），per-fixture P95 945 / 813 ms。三轮 P95 为 6760 / 6934 / 7914 ms（6.8–7.9 s 区间），目标裕量大。

### 5.3 BFS 4096 状态

| 检查 | 实测 | 目标 | 结论 |
|---|---|---|---|
| BFS 算法本身（存根评估器：每序列唯一 state key、verdict 恒 STABLE，迫使搜索跑满预算；5 样本） | 耗时 9 / 12 / 7 / 9 / 15 ms；**P95 15 ms**；5 次均为 BOUNDED_INCOMPLETE，statesExpanded 恰为 4096，queueRemaining > 0 | P95 ≤ 5,000 ms | 通过 |
| 真实浏览器 BFS（F001，depth 6，maxExpandedStates 4096，1 次） | 耗时 **122,507 ms**；状态 **BOUNDED_NO_WITNESS**；statesEvaluated 3761、statesExpanded 1024、statesDeduplicated 2123、uniqueStates 1638、queueRemaining 0、maxDepthReached 6 | ≤ 5,000 ms（见 ADR-T012-1） | **未按 5 s 断言；实测值如实记录** |

真实浏览器 BFS 的计数（3761 / 1024 / 2123 / 1638 / 0 / 6）在本任务的三次运行中**完全一致**（另两次耗时 127,149 ms 与 130,853 ms），符合 BFS 确定性。

### 5.4 内存峰值

| 指标 | 实测 | 目标 | 结论 |
|---|---|---|---|
| Node（vitest worker）RSS 峰值 | **217.6 MiB**（矩阵运行期间每 200 ms 采样） | ≤ 512 MiB | 通过 |
| 交叉核对 | 另两次运行峰值 223.1 / 219.8 MiB | — | 一致 |

局限：Chromium 子进程 RSS 未单独归因（见 §10）。

### ADR-T012-1：BFS “4096 状态 P95 ≤5s”目标的适用范围

**决定：** 该 5 s 目标按 BFS 搜索算法本身的开销考核（存根评估器，P95 15 ms，通过）；不按“4096 次真实浏览器评估 ≤5 s”考核。

**理由（实测）：**
1. 一次真实浏览器评估约 20–50 ms Playwright round-trip（setContent → 捕获原目标 → 应用变异 → resolve → identity compare），4096 次评估光 round-trip 就约 100–200 s；122,507 ms 的实测与此一致。任何机器都无法让 4096 次真实浏览器评估塞进 5 s，目标若按字面用于浏览器 BFS 则在构造上不可达。
2. 更重要的是，4096 扩展预算在当前 8 算子语料上**根本跑不到**：F001 真实 BFS 在 depth 6、去重后只有 1,638 个不同 DOM 状态（28,961 条序列经 state-key 去重后坍缩），搜索扩展 1,024 个状态后队列排空，状态为 BOUNDED_NO_WITNESS。预算从未成为约束。
3. 预算本身的正确性由存根评估器证明：唯一 state key 下搜索恰好在 statesExpanded == 4096 时停下并报告 BOUNDED_INCOMPLETE（5/5 次）。

**未改动门槛。** 本任务没有修改 IMPLEMENTATION_PLAN §9 的任何数字；真实浏览器 BFS 的耗时与状态如实记录在上表与 `T012_PERF.json` 中，供 T013/T014 复核。若后续算子集扩大使可达状态超过 4096，届时应重测真实浏览器 BFS 并重新评估该目标。

### ADR-T012-2：内存度量范围

内存峰值只度量 Node（vitest worker）RSS，不含 Chromium 子进程 RSS。Chromium 由 Playwright 以子进程启动，本 harness 未做跨进程归因；217.6 MiB 是 Node 侧的峰值，不是整机峰值。VM 总内存 7934 MiB，运行期间未见 OOM 或交换压力。

### ADR-T012-3：P95 采样数

192 矩阵只采 3 个样本（每样本 192 case、24 fixture，总计 576 case / 72 fixture 样本）。P95 用 nearest-rank，在 n=3 的总耗时样本上等于最大值；这是小样本的保守取法。BFS 存根采 5 个样本。三轮独立运行的总耗时 P95（6760 / 6934 / 7914 ms）互相印证，结论不依赖单轮。

## 6. 压力（`test:stress`，6/6）

| 检查 | 结果（实测） |
|---|---|
| 重复确定性 | F002 的 8 变异 verdict 向量连续跑 5 次完全相同：[WRONG_TARGET, WRONG_TARGET, STABLE, WRONG_TARGET, STABLE, WRONG_TARGET, WRONG_TARGET, STABLE]，与 golden 一致 |
| 并发 | 同一浏览器内 3 个 context 并行跑 F001 / F010 / F024 各自 8 变异全矩阵：全部 verdict 与 golden 一致，无交叉干扰 |
| 大 DOM | 5,000 个同级 filler 节点 + 目标按钮：`runBaselineOracle`（css `button#t`）COMPLETED、finalMatchCount 1、identity true、originalCaptured true（30 s 宽松 bound 内完成；精确耗时未单独记录，见 §10） |
| 深 DOM | 目标嵌套 200 层 div：resolve COMPLETED、finalMatchCount 1、originalCaptured true（private path 指向最外层 div，identity 按预期为 false——该用例只断言遍历不失败，不主张 identity） |
| BFS 上限 | maxDepth 7、maxExpandedStates 4097、maxExpandedStates 0 均为 RangeError；maxDepth 0 且 root 失败时报告 depth-0 witness（sequence []、WRONG_TARGET）；全 STABLE 存根在 maxDepth 2 下为 BOUNDED_NO_WITNESS 且 maxDepthReached ≤ 2 |
| UI 服务器并行负载 | 3 个并发 `POST /api/analyze`（F001/F002/F003）全部 200、每 fixture 8 case 且 matchesGolden 全 true；同一 fixture 重复 3 次调用返回**字节相同的 canonical JSON** |

## 7. P2-1 加固（T011 审查遗留，可选做，已做）

- 问题：`tests/integration/p2a-detach-regression.test.ts` 间歇失败（时序竞态：detach 在 oracle 的 elementHandle→compare 间约 1 个 round-trip 的窗口内才生效；T011 全量 4 次中 1 次 485/486，单独重跑 2/2 通过）。
- 改动（只改测试，不改生产代码）：detach 扫窗从 38–80 ms（步长 2 ms）拓宽到 **30–120 ms**，重试从 3 pass 提到 **5 pass**；注释写明拓宽原因。扫窗在首次命中 ERROR 即停，常见情况不增加耗时；只有扫空才付出更宽的窗口。
- 验证：本任务全量 `npm test`（509/509）中该文件 2/2 通过，耗时 27,345 ms。**但只有一次全量观测**，建议协调员在后续全量中继续观察；若再次出现间歇失败，应按报告 §8 的 Findings 处理，不应再无声拓宽窗口。

## 8. Findings（测试侧问题，已修复；生产代码缺陷：无）

施工中发现并修复的 5 个问题**全部在测试代码侧**，生产代码未发现缺陷、未做任何修改。逐条记录如下，供审查者复核测试改动是否正确：

| # | 问题 | 根因 | 修复 | 严重度（若未修复） |
|---|---|---|---|---|
| F-1 | 键盘测试 tabTo 误判：`tabTo("F003")` 立即返回，Enter 后仍选中默认 F001 | `document.activeElement` 在页面加载后是 BODY，其 innerText 包含全页文本，于是任何 label 都“匹配” | `tabTo` 只采纳 BUTTON/TR/SELECT/INPUT/TEXTAREA/A 的焦点文本；fixture 行按 `data-fixture-id` 精确匹配；BODY 等容器不再匹配（`tests/e2e/e2e-helpers.ts`） | 测试假通过风险；已修复并重跑通过 |
| F-2 | 下载 JSON 的 witness 比对失败：`exported.witness.sequence` 为 undefined | UI 存的是 `/api/search` 返回的完整 WitnessSummary `{status, witness: {sequence…}}`，不是裸 witness 对象 | 测试按双层结构比对 status 与内层 witness 的 sequence/verdict/depth | 测试错误；已修复 |
| F-3 | 无效草稿测试报“校验通过”而非“格式检查未通过” | 前一键盘测试留下 role 定位器（F003）被选中；selector 输入框只对 css/xpath 生效，role 校验不读它 | 测试先重选 F002（xpath）再清空 selector（`tests/e2e/e2e-main-flow.test.ts`） | 测试错误；已修复 |
| F-4 | 离线测试两处调用错误：模板文件不存在（ENOENT）；`startAnalysisServer` 未拒绝 0.0.0.0 | 模板实为 `report.html.ts` 而非 `report.html.js`；`startAnalysisServer(service, options)` 的第一个参数是 service，测试把 options 对象当 service 传，导致 host 默认回落到 loopback | 修正模板路径；用最小 fake service 正确调用，另加 `192.168.1.1` 拒绝与 `127.0.0.1` 正常启动的正反检查 | 测试错误；已修复。注：生产侧的 loopback 拒绝逻辑本身正确（`tests/api/server.test.ts` 已有覆盖） |
| F-5 | 真实浏览器 BFS（F001）期望 BOUNDED_INCOMPLETE，实测 BOUNDED_NO_WITNESS | 测试假设错误：去重后可达状态只有 1,638 个，队列在预算内排空；生产行为符合 bfs.ts 规则 3（首次访问获胜、重复剪枝）与规则 5（队列排空即 BOUNDED_NO_WITNESS） | 测试改为断言 BOUNDED_NO_WITNESS + 计数；成因写入 ADR-T012-1 | 测试期望错误；已修复。**不是生产缺陷** |

**生产代码缺陷 Findings：无。** E2E/离线/性能/压力四条线均未发现生产代码缺陷，因此没有向协调员提交 FIX 任务的需求。若 T013 独立审查发现问题，另行处理。

## 9. 冻结核对

- `git diff -- src/` 为空（生产源码零改动）。
- `evidence/s0/S0_GATE.json`：2376 B，SHA-256 `15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d`，与 HEAD 一致；其中 `gate_sha256` = `651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52`，**未变**；result PASS。
- golden expected outcomes、fixtures、hash contract 未动（`git status` 只列出 §2 的文件；`evidence/s0/T002_MUTATION_REPORT.json` 与 `evidence/s4/T011_ORACLE_PARITY.json` 在全量测试中被测试本身按设计重写，但内容与 HEAD 一致，未出现在 `git status` 的修改列表中）。
- 工作树（除本任务文件外）：`handoff/S4_COORDINATOR_STATE.md` 有一处修改，**不是本任务改的**（协调员在 T012 施工期间并发更新了该文件，diff 显示为 T011 提交记录的补记）；本任务未碰该文件，提交时请协调员自行处理。
- EPERM：本任务期间未遇到写失败（04:00 GMT 后抖动已缓解）；所有写出文件均已按大小核对（`T012_PERF.json` 由测试生成后经 SHA 核对；`T012_E2E_REQUESTS.json` 同上）。

## 10. 未覆盖项与已知局限

1. **无 Windows 测试。** 全部在 Linux（Ubuntu 24.04.5 LTS）上运行；PROJECT_BOOK §9 要求如实记录，不声称 Windows 已测。
2. **无真实网络。** 按设计：全部合成 fixture + loopback；离线结论只覆盖“本产品不发起外部请求”，不覆盖真实网站行为。
3. **真实浏览器 BFS 只跑了 F001。** 其它 fixture 的可达状态数未逐一测量；F001 的结论（1,638 个不同状态、BOUNDED_NO_WITNESS）不自动推广到全部 fixture，但去重坍缩的机理相同。
4. **大 DOM / 深 DOM 只断言正确性，未精确计时。** 5,000 节点用例只断言 30 s 宽松 bound 内完成；未记录精确毫秒数。
5. **Chromium 子进程内存未单独归因**（ADR-T012-2）；Node RSS 217.6 MiB 只是进程侧峰值。
6. **P95 采样数小**（ADR-T012-3）；矩阵 3 样本、BFS 存根 5 样本。
7. **P2-1 加固只有一次全量观测**（§7）；间歇性竞态需多次全量才能确认根除。
8. **Chromium trace 只在失败时保留**（§3）；本次无失败，故无 trace 产物。
9. **键盘覆盖限于主流程。** 方向键只覆盖了 tabs 容器（ArrowLeft/Right）与行选择（Enter/Space）；未覆盖 Mutation Lab 内方向键等次要路径（实现本身未提供）。
10. **性能数字与本 VM 绑定。** CPU/内存/负载不同时数字会变；报告中的 P95 是本机实测，不承诺其它环境。

## 11. 复现方法

```powershell
npm run build
npm run test:e2e        # 7 tests, ~15 s（含 build）
npm run test:offline    # 6 tests, ~10 s（含 build）
npm run test:performance # 4 tests, ~150 s（含 build；含一次约 123 s 的真实浏览器 BFS）
npm run test:stress     # 6 tests, ~10 s（含 build）
npm test                # 全量 509 tests, ~281 s
```

性能套件每次运行都会重写 `evidence/s4/T012_PERF.json`（内容除耗时外应确定性一致：BFS 计数 3761/1024/2123/1638 在三次运行中完全相同）；E2E 套件每次运行重写 `evidence/s4/T012_E2E_REQUESTS.json`（29 请求、外部 0；端口号为临时端口，每次不同）。
