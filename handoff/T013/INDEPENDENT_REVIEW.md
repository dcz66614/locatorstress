# P022 LocatorStress — T013 独立审查结论

- 审查者：T013 独立审查员（全新会话，未参与本项目任何实现工作）
- 审查对象：commit `a78d765`（S4 PASS 后的完整状态；S0–S4 全部 PASS）
- 审查时间：2026-11-11 ~06:10–06:40 GMT
- 工作目录：`~/workspace/p022-locatorstress/`（本地 git，无远程；未 commit、未 push、
  未修改任何已有文件；全部产出只在 `handoff/T013/` 下新建）
- 依据：`~/workspace/P022_IMPLEMENTATION_PLAN.md` T013 任务卡（§5）、§9.1、§10、§11；
  规格 `P022_PROJECT_BOOK.md`；S0–S4 全部 PASS 记录与证据。

## FINAL_VERDICT: PASS

**P0：0 项；P1：0 项；P2：25 项（全部登记在 `unresolved_items.md`，非阻塞）。**

按 T013 完成定义（关键文件覆盖完整；P0/P1 全部关闭；P2 登记；审查者独立），
审查通过。25 项 P2 均为文档、注释、校验器边界、覆盖范围或已知局限类问题，
无一涉及 verdict 错误、Oracle 泄漏、哈希失配、外部请求或门禁失效；
其中最强的两项新发现（P2-25 校验器拒绝合法 depth-0 见证；P2-18 T012 报告
证据 SHA 失配）均为 fail-closed 或证据卫生类问题，不影响已冻结的 S0 门禁
与 192 例 golden 结论。修复由独立 FIX 任务执行，不阻塞 T014 冻结；
P2-18、P2-20、P2-25 建议 T014 冻结前处理或确认接受，其余留待终审作为已知局限记录。

## 1. 审查方法

1. **全文通读生产源码**：`src/` 下 101 个文件全部逐字读完（7,906 行，含 24 fixture
   页面、24 Oracle 清单、golden 矩阵），记录在 `COVERAGE_MATRIX.csv`（READ 101/101）。
   另通读 `scripts/` 全部 6 个文件（3,196 行：s0-gate、repeat-hash、s0-locator-oracle、
   t008-api-report、t011-mutation-runner）与 `tests/` 关键夹具（抽查，见 §2）。
   源码全文见 `REVIEW_PACK_01.md`–`REVIEW_PACK_10.md`（机械拼接，未改写）。
2. **亲自逐条重跑验收命令**（结果见 `TASK_REPORT.md`，原始日志见 `test_logs/`）：
   typecheck、typecheck:scripts、build、npm test（509/509）、test:oracle、test:e2e（7/7）、
   test:offline（6/6）、test:stress（6/6）、s0:gate（完整）。未跑 test:performance
   （按任务要求：会重写 evidence/s4 性能证据；性能结论以 S4 已验证数字为准，
   本审查只核对 T012 报告与 HEAD 证据文件的一致性——见 P2-18）。
   每条命令均记录真实退出码（无管道掩盖）；跑完后所有被按设计重写的 evidence 文件
   均已 `git checkout` 恢复并核对 SHA。
3. **独立重算四个 hash**：用自写 Python canonicaliser（`hash_recompute.py`，不 import
   任何项目代码）从 manifests + HTML + T002 报告 + golden + S0_GATE.json counts
   出发重建四个 canonical 对象并重算：scenario / oracle / analysis / gate 全部与
   冻结值一致；另重算 T008 报告内嵌 canonical 对象的四个 hash，全部一致。
4. **独立核对**：Oracle 独立性（实现、golden、fixture 三方）、S0 门禁证据与 git HEAD
   一致性、外部请求计数、许可证状态、S2/S3/S4 全部遗留项逐项裁决（见 §5）。
5. **约束遵守**：未修改任何业务源码、fixtures、golden、证据、配置；未碰 Copilot 桥、
   GitHub、Drive；未对外发消息。审查期间未遇 EPERM 写失败（全部写出文件均已按大小与
   SHA 核对；`sha256.txt` 因门禁运行中途删除 S0_GATE.json 而在门禁完成后再生成）。

## 2. 覆盖情况

| 范围 | 文件数 | 状态 |
|---|---:|---|
| `src/` 生产源码 + fixture 数据 | 101 | READ 100%（全文） |
| `scripts/` 门禁与报告脚本 | 6 | READ 100%（全文） |
| `tests/` | 43（含 4 个 helpers） | SPOT：关键夹具逐项核对（见下）；全部 39 个测试文件在本次 `npm test` 中执行通过 |
| 工程配置（package.json、tsconfigs、vitest.config.ts） | 4 | READ（package-lock.json 只核对结构与版本） |

测试抽查明细（已读全文或关键段落并与生产代码逐项比对）：
`oracle-parity-independent.test.ts`（三方 parity 的独立重实现）、
`p2a-detach-regression.test.ts`（扫窗 30–120 ms、重试 5 pass）、
`e2e-main-flow.test.ts` / `e2e-helpers.ts`（F-1/F-2/F-3 修复在位）、
`offline.test.ts`（F-4 修复在位）、`performance.test.ts`（F-5 修复在位，BOUNDED_NO_WITNESS 断言）、
`stress.test.ts`（depth-0 见证断言）、`s0-mutations.test.ts`、`s0-fixtures.test.ts`、
`hash-contract.test.ts`（四哈希向量与 forbidden 扫描）。
其余测试文件以“执行通过 + 抽查断言”覆盖；测试全文收录于 REVIEW_PACK_09/10。

## 3. 亲自重跑结果（摘要；详见 TASK_REPORT.md）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run typecheck` | 0 | 通过 |
| `npm run typecheck:scripts` | 0 | 通过 |
| `npm run build` | 0 | 通过 |
| `npm test` | 0 | 39 文件，509/509 通过，270.46 s |
| `npm run test:oracle` | 0 | baseline 1/1、identity 可复现、offline probe 通过、frame probe 通过；fixtures 3/3 + mutations 3/3 |
| `npm run test:e2e` | 0 | 7/7 通过 |
| `npm run test:offline` | 0 | 6/6 通过 |
| `npm run test:stress` | 0 | 6/6 通过 |
| `npm run s0:gate`（完整） | 0 | GATE PASS；192/192；Oracle parity 192/192、0 不一致；baseline 24/24；重放 100/100、1 个唯一 hash；gate_sha256 `651c3fd4…` 不变；P2A PASS（exit 0）；外部请求 0 | `10-s0-gate.log` |

## 4. 独立核对结果

### 4.1 四个 hash（自写 Python 重算，与冻结值逐字节比对）

| Hash | 冻结值 | 独立重算 | 结论 |
|---|---|---|---|
| scenario_sha256 | `1ffb5f85…c9f22` | 一致 | MATCH |
| oracle_result_sha256 | `3502d81f…45a988` | 一致 | MATCH |
| analysis_sha256 | `4410d5c8…57a4` | 一致 | MATCH |
| gate_sha256 | `651c3fd4…a62c52` | 一致 | MATCH |
| S0_GATE.json 文件 SHA | `15b5c2d5…3572d` | 一致 | 与 HEAD 一致 |

T008 报告（evidence/s2/T008_API_REPORT.json）内嵌 canonical 对象的四个 hash
也全部重算一致（其中 scenario/oracle 与 S0 冻结值相同；analysis/gate 按设计不同，
因 T008 用自有 schema `locatorstress.analysis/v1` 与真实 BFS 图谱）。

### 4.2 Oracle 独立性 — 成立，无泄漏

- **实现独立**：Oracle（`target-capture` + `identity-compare` + `oracle-runner`）
  只做一件事：用 manifest 私有路径捕获原目标 ElementHandle，在页内比较 DOM
  对象身份（`a === b`）。不读 golden、不读生产分类器、不向 DOM 注入任何 marker。
  生产分类器 `classifyVerdict` 是纯函数，只读 resolver 结果 + identity 布尔值。
  三方 parity 测试（`oracle-parity-independent.test.ts`）用测试内独立重实现
  （不 import classifyVerdict）逐字段比对 192 例：production 192/192、
  independent 192/192、三方一致 192/192、mismatches 0（证据
  `T011_ORACLE_PARITY.json` 已核对）。
- **Golden 独立**：`T002_GOLDEN_DERIVATION.py` 为手写推导（逐 fixture 按 §5.3/§4
  推理，附 reason 串），不运行实现；其中 8 处修正均有手写重推导与独立 probe 记录，
  过程已披露。192 例分布 STABLE 138 / WRONG_TARGET 22 / AMBIGUOUS 17 / MISSING 15，
  与 S0_GATE.json verdictCounts 一致；T002 实际 verdict 与 golden 0 不一致。
- **无 marker 泄漏**：24 个 `privateTargetPath` 字符串无一出现在对应 fixture HTML 中；
  `data-testid` / `data-target` / `data-oracle` 在全部页面与清单中 0 命中；
  M04/M07 decoy 只复制 tag/class/text/aria-label（新节点，无身份）；M03 token
  为目标固有 class，非注入标记。API 只暴露公开字段（`publicFixtureSummary` 显式
  排除私有字段）。
- **门禁侧的重复实现**：s0-gate.ts 自带 `deriveVerdict`（未 import classifyVerdict），
  属于有意的独立复现而非共享算法；其与生产分类器的差异见 P2-22（无定义域内影响）。

### 4.3 S0 门禁证据与 git HEAD — 一致

- 审查前后 `git status`（除 `coverage/` 生成物、`handoff/S5_COORDINATOR_STATE.md`、
  `handoff/T013/` 外）干净；`git diff c47af65 HEAD -- src/` 在 S4 已核为空，
  本次审查未修改任何已跟踪文件。
- S0_GATE.json：2,376 B，SHA `15b5c2d5…`，与冻结值一致；其中 gate_sha256
  `651c3fd4…` 不变，result PASS，replay 100/100、1 个唯一 hash。
- 本次审查重跑按设计改写的文件（T012_PERF.json、T012_E2E_REQUESTS.json、
  T011_MUTATION_RESULTS.json、T011_ORACLE_PARITY.json、S0_P2A.log、
  S0_REPEAT_HASH.json、T001_BASELINE.*）均已 `git checkout -- evidence/` 恢复，
  恢复后 SHA 与 HEAD 一致。
- `coverage/` 未入仓（生成物）；`dist/`、`node_modules/` 在 .gitignore 中。

### 4.4 外部请求 — 0

- S0 门禁：externalRequests 0、blockedRequests 0（本次 gate 重跑结果见 §3）。
- E2E 请求录音（HEAD 文件）：29 个请求，external 0，全部 `http://127.0.0.1`。
- 静态扫描：fixture HTML、UI 文件、导出模板均 0 外部引用（test:offline 6/6 通过；
  gate 静态扫描范围见 P2-23）。
- 服务器绑定：API 与 UI 均只接受 loopback（`assertLoopbackHost`，0.0.0.0 与
  192.168.1.1 均被拒绝，测试覆盖）。

### 4.5 许可证 — PENDING_SAM_DECISION，无擅自声称

- 仓库中无 LICENSE 文件；无任何文件声称项目许可证（grep：仅 IMPLEMENTATION_PLAN /
  PROJECT_BOOK / ENVIRONMENT_REPORT 记载 `PENDING_SAM_DECISION`，与 Sam 的决定一致）。
- package.json 无 license 字段声明。
- 缺口见 P2-20：计划要求的 README / USER_GUIDE / HOW_TO_REPRODUCE /
  THIRD_PARTY_NOTICES / LICENSE_STATUS 均不存在，依赖许可清单无处可查。

### 4.6 规格符合性（抽查要点）

- LocatorSpec：kind/selector/role/name/exact/includeHidden/framePath（0–2）/index
  校验与 §4.1 一致；不支持 JS/正则/回调。
- 四态：执行错误用独立 executionStatus，绝不伪装 verdict；frameFailure 优先于
  selector 计数；identity 只在 final==1 时判定；非法计数（负数、final>raw）返回
  INCOMPLETE——与 §4.2/§5.2 一致。
- 分数：100×stable/completed，BigInt 精确半入 3 位小数；incomplete 不计分但降
  coverage；控制组 falseAlarm/detected 与 S0 gate 定义一致；UI 明示“合成集比例，
  不是生产失败概率”。
- BFS：深度 ≤6、状态 ≤4096（超限 RangeError）；固定算子顺序 M01–M08、FIFO、
  首次访问去重、INCOMPLETE 不扩展不作见证、BOUNDED_INCOMPLETE 绝不报成无见证；
  witness 深度等于序列长度；API 拒绝 operatorOrder/allowRepeat。
- Canonical：UTF-8、LF、NFC、键码点序、数组保序、禁时间/UUID/PID/绝对路径/CDP ID；
  四 hash 不自指；forbidden 扫描 11 条规则 0 命中。
- 离线/隐私：全部合成数据；不读真实 profile/cookie/localStorage；不执行输入脚本。

## 5. 遗留项逐项裁决

### 5.1 S2 遗留

| 项 | 裁决 |
|---|---|
| T008 gate_sha256 复用 S0 schema | **属实，登记为 P2**（P2-03）。`buildGateCanonical` 用 `SCHEMA_GATE = "locatorstress.s0-gate/v1"` 为 T008 报告算 gate hash；报告 notes 已披露分析对象不同。冻结模块不得擅改，留 T014 决策。 |
| validateReportStructure 未交叉核对分数 | **属实，登记为 P2**（P2-04）。只核对 overall 的 scoreNumerator/scoreDenominator/completed/expected；perLocator/perOperator 分数、coverage、controls 未交叉核对。hash 重算仍能抓住事后篡改，但一致构造的错误报告可通过结构校验。 |
| canonical analysis BFS witness 条目丢 meaning | **属实，登记为 P2**（P2-05）。`buildAnalysisCanonicalT008` 的 witness 条目不含 `meaning` 与 `budgetNote`；meaning 可由 status/witness/limits/queueRemaining 确定性重建，无信息丢失，但展示文本不在 analysis_sha256 覆盖内。 |
| depth-6 witness 在全量 8 算子无剪枝树中不可达 | **属实（算术成立），登记为 P2**（P2-06）。1+8+56+336+1680+6720=8801 > 4096，BOUNDED_INCOMPLETE 为正确结果；但 T012 F001 真实浏览器 BFS 证明 DOM 去重可使 depth 6 可达（1,638 唯一状态，maxDepthReached 6）。表述应限定为“无剪枝树”，已在 `depth6BudgetNote` 中写明。 |
| 浏览器覆盖只到 depth 2 | **部分解决，登记为 P2**（P2-07）。T007 spotcheck 确为 4 runs、max depth 2；T012 将真实浏览器 BFS 扩展到 F001 depth 6，但其余 23 fixture 未逐一测量。 |

### 5.2 S3 遗留

| 项 | 裁决 |
|---|---|
| T009 浏览器内匹配预览为近似值 | **属实，登记为 P2**（P2-08）。仅 10 种 role、近似 hidden 判定、srcdoc-only iframe、shadow 经 template 近似；UI 明确标注“仅预览，不计算 verdict”，最终判定以后端为准。 |
| 单 fixture 导出非完整报告 | **属实，登记为 P2**（P2-09）。`download-json` 导出 schema `locatorstress.ui-fixture-export/v1`，文件内已注明不是 T008 完整报告。 |
| BFS 默认 maxDepth=2 | **属实，登记为 P2**（P2-10）。`index.html` 中 `bfs-depth` 默认值 2，API 默认 6；用户须手动改大。 |
| T010 P2-4（可见渲染为 JSON 子集） | **属实，登记为 P2**（P2-11）。HTML 导出可见部分只有 overall 分数；perLocator/perOperator 分数、witness limits/perDepth、verification、canonical 对象只在内嵌 JSON 中。 |

### 5.3 T011 P2-2

**属实，登记为 P2**（P2-02）。`src/canonical/canonical-json.ts:14` 注释称“Object keys
are sorted by Unicode code point”，但 JS 对象键枚举会把整数型键按数值序前置。
实测：`canonicalJson({"10":1,"2":2,"a":3})` 得 `{"2":2,"10":1,"a":3}`（码点序应为
`"10"` 在前）。仅注释不精确；行为本身是冻结行为且有测试覆盖
（`canonical-boundaries.test.ts` 明确记载“整数型键按数值序（JS 对象键重排，冻结行为）”），
对 S0 四哈希无影响（S0 canonical 对象不含整数型键）。

### 5.4 ADR-T012-1/2/3

| 项 | 裁决 |
|---|---|
| ADR-T012-1（真实浏览器 BFS 5 s 目标仅考核算法本身；F001 4096 评估构造上不可达） | **成立，接受，登记为 P2**（P2-12）。实测三轮：133,801 ms（T012 报告）、122,507 ms（HEAD 证据文件）、124,330 ms（本次 npm test 内 performance 套件）；计数 3761/1024/2123/1638/0/6 三轮完全相同；存根评估器 P95 14–15 ms ≤ 5 s。适用范围应记入规格说明 §9。 |
| ADR-T012-2（内存仅 Node RSS） | **成立，接受，登记为 P2**（P2-13）。HEAD 文件：Node RSS 峰值 217.6 MiB ≤ 512 MiB；Chromium 子进程未归因，文件内已注明。 |
| ADR-T012-3（P95 样本 n=3） | **成立，接受，登记为 P2**（P2-14）。矩阵 3 样本（P95=最大值，保守取法）、BFS 存根 5 样本；三轮独立运行 P95（6832/6934/7914 ms，另见 P2-18）互相印证，结论不依赖单轮。 |

### 5.5 P2A detach 间歇竞态

**已加固属实；本次未复发；继续观察（P2-15）。** `p2a-detach-regression.test.ts`
扫窗 30–120 ms（步长 2 ms）、重试 5 pass，与 T012 报告一致；本次全量 509/509
（p2a 2/2，23 s）与本次 gate 内 P2A（exit 0）均一次通过。间歇性竞态的根除需
多次全量观测，本次只有 2 次观测，仍登记为 P2 观察项。

### 5.6 其他遗留（无 Windows 测试等）

- 无 Windows 测试：属实（P2-16），全部 Linux（Ubuntu 24.04.5 LTS）。
- 真实浏览器 BFS 只测 F001、大/深 DOM 未精确计时、键盘覆盖限于主流程：属实（P2-17）。
- T011 P2-1 已加固：属实（见 §5.5）。
- T012 的 5 个测试侧修复：抽查代码全部属实——F-1（`e2e-helpers.ts` tabTo 只采纳
  BUTTON/TR/SELECT/INPUT/TEXTAREA/A 焦点）、F-2（`e2e-main-flow.test.ts:200` 按
  `{status, witness:{…}}` 双层结构比对）、F-3（无效草稿测试先重选 F002 xpath）、
  F-4（`offline.test.ts` 模板路径 `report.html.ts`、fake service 正确调用、
  0.0.0.0/192.168.1.1 拒绝与 127.0.0.1 正常启动）、F-5（`performance.test.ts`
  断言 BOUNDED_NO_WITNESS + 计数，成因写入 ADR-T012-1）。全部在位。

## 6. 本次审查的新发现

### P2-25（最强新发现）：`validateReportStructure` 拒绝合法的 depth-0 见证

- 位置：`src/contracts/report.ts:374`——FOUND 状态要求
  `witness.sequence` 为非空数组。
- 矛盾：BFS 明确支持 depth-0 见证（baseline 本身失败时 `sequence: []`，
  `bfs.ts` 注释与实现）；`tests/e2e/stress.test.ts:207–217` 与
  `tests/analysis/witness-boundaries.test.ts:33` 均断言 depth-0 见证合法
  （`{sequence: [], depth: 0, verdict: "WRONG_TARGET"}`）。
- 后果：含 depth-0 见证的报告无法通过导出校验（`exportReportJson` 抛错、
  `/api/export` 422）。Fail-closed（拒绝导出而非误报），且 24 个冻结 fixture
  的 baseline 全部 STABLE，冻结集内不可达。登记为 P2，建议 T014 修正校验器
  （允许空序列当且仅当 depth==0 且 status==FOUND）。

### P2-18：T012 报告证据 SHA 与数字与 HEAD 提交文件不一致

- 报告 §2 声称 `T012_PERF.json` SHA `70d942ff…`、`T012_E2E_REQUESTS.json` SHA
  `2e8e747e…`；HEAD 文件实为 `b1838d3f…` / `497de20a…`。
- 报告正文数字（矩阵 P95 6832 ms、存根 P95 14 ms、RSS 216.4 MiB、真实 BFS 133,801 ms）
  与 HEAD 文件数字（6760 / 15 / 217.6 / 122,507 ms）不一致；提交信息数字
  （7206 / 29 / 220）为第三组。原因：报告写成后文件又被后续全量运行重写
  （performance/e2e 套件按设计每次运行重写证据文件）。
- 实质：三组数字均在目标内（P95 ≤ 60,000；per-fixture ≤ 2,000；存根 ≤ 5,000；
  RSS ≤ 512）；BFS 计数 3761/1024/2123/1638/0/6 三轮完全相同；请求录音 29 个、
  外部 0。结论不受影响，属证据卫生问题。建议 T014 冻结前以 HEAD 文件为准
  复核报告数字，或在报告中注明“性能文件随运行重写，以文件为准”。

### P2-19：`src/ui/app.js` 中 FIX-T009 相关注释已过时

- `checkLocatorShape` 注释仍称冻结服务端“cannot answer invalid draft without
  dying”；实际上 `service.ts` 已在 FIX-T009 中修复（`locator` 仅在 defined 时返回），
  `server.ts` 另有 `headersSent` 防御。客户端 shape guard 现为冗余但无害。
  注释修正（文档级 FIX）。

### P2-20：文档缺口——计划要求的 5 个文件不存在，无依赖许可清单

- `README.md`、`USER_GUIDE.md`、`HOW_TO_REPRODUCE.md`、`THIRD_PARTY_NOTICES.md`、
  `LICENSE_STATUS.md` 在仓库中均不存在（IMPLEMENTATION_PLAN §3/§12 要求）；
  §10 要求的依赖许可清单（T001 生成、T013 复核）无处可查。
  直接依赖仅 4 个（playwright 1.65.0、typescript 5.9.3、vitest 5.1.0、
  @vitest/coverage-v8 ^5.1.0；lockfile 共 76 个包）。建议 T014 发布前补齐。

### P2-21：变异测试覆盖范围局限

- 40 个手工变异只覆盖 10 个纯函数模块（classify/score/canonical/state-key/bfs/
  html-escape/forbidden-scan/routes/locator/witness），40/40=100% 检出
  （证据 `T011_MUTATION_RESULTS.json` 已核对：total 40、killed 40、survived 0、
  inconclusive 0、equivalent 0）；未覆盖 runner、Oracle、mutations、api service、
  UI、fixtures。100% 仅适用于该范围，终审时应如实说明范围。

### P2-22：门禁脚本与生产实现存在重复实现（已证明定义域内无分叉）

- `s0-gate.ts` 的 `deriveVerdict` 未复用 T004 `classifyVerdict`，且缺少后者的
  非法计数守卫（final>raw、负数）；`formatScore` 用浮点 `toFixed(3)`，
  而 T005 `formatPercent` 用 BigInt 精确半入。
- 已证明：在实际定义域内（分母 ≤192）两者不可能分叉——最近舍入边界距离
  ≥ 1/(2000×192) ≈ 2.6e-6，远大于双精度浮点误差；且 T011 三方 parity 192/192
  一致。冻结门禁不得擅改；是否让 gate 复用生产实现由 T014/后续冻结决策。

### P2-23：S0 gate 静态离线扫描只覆盖 fixture HTML

- `s0-gate.ts` stage c 只统计 fixture HTML 中的 `http://` 出现次数；
  UI/export 模板的离线结论由 `test:offline` 覆盖。`staticOfflineScanHits=0`
  应理解为 fixture 范围。记录为范围说明。

### P2-24：gate 与 oracle 脚本先删后写证据

- `runMainGate` 开头即 `rm` S0_GATE.json/S0_GATE.log；`s0-locator-oracle.mjs`
  同样先删 T001 证据。中途失败会留下证据缺失的半态（S3 已观测到），须从 git
  恢复。建议 T014 考虑先写临时文件再原子替换。

### P2-01：T013 验收命令缺口（规格与实现不一致）

- T013 任务卡 §5 验收命令为 `npm run verify:review-pack && npm run verify:all`，
  但 `package.json` 中不存在这两个脚本（已逐项核对全部 30 个 scripts 字段）。
  本审查改以任务书列出的逐条验收命令 + 本审查包本身作为验收依据。
  建议 T014 补脚本或修订计划。

### P2-02：见 §5.3（T011 P2-2 属实）

### P2-15/16/17：见 §5.5/§5.6

### P2-03/04/05/06/07/08/09/10/11/12/13/14：见 §5.1/§5.2/§5.4

## 7. 未发现的问题（明确记录，以防误读）

- 无 P0：Oracle 无泄漏、无 marker；WRONG_TARGET 无漏检（192/192）；
  Oracle 与生产分类器无共享算法（独立重实现 + 独立 golden）；
  192 用例全跑（gate 阻断）；parity 0 mismatch；100 次 hash 唯一；
  外部请求 0；未退化为 Locator 生成器；无需真人/真网/付费 API。
- 无 P1：iframe/ShadowRoot 均在明确限制内（framePath 0–2 层、open shadow
  root；closed shadow 不在范围）；BFS 超上限如实报 BOUNDED_INCOMPLETE；
  分数在 UI 与报告中均明示为合成集比例。
- EPERM：本次审查全程未遇 VM 存储 EPERM 写失败；全部写出文件均已按大小与
  SHA 核对，无 0 字节产出。EPERM 不记为产品缺陷。
- `handoff/S5_COORDINATOR_STATE.md` 在审查期间出现在工作树（未跟踪文件，
  非本次审查创建）；本次审查未碰该文件。

## 8. 建议的 FIX 任务包（只提任务，不自己修）

| FIX | 内容 | 来源 |
|---|---|---|
| FIX-P022-T013-01 | 补 `verify:review-pack` / `verify:all` 脚本，或修订 T013 验收命令 | P2-01 |
| FIX-P022-T013-02 | 修正 canonical-json.ts:14 注释（整数型键数值序） | P2-02 |
| FIX-P022-T013-03 | 校验器允许合法 depth-0 见证（空序列当且仅当 depth==0 且 FOUND） | P2-25 |
| FIX-P022-T013-04 | 以 HEAD 证据文件为准复核 T012 报告数字与 SHA | P2-18 |
| FIX-P022-T013-05 | 修正 app.js 过时的 FIX-T009 注释 | P2-19 |
| FIX-P022-T013-06 | 补 README / USER_GUIDE / HOW_TO_REPRODUCE / THIRD_PARTY_NOTICES / LICENSE_STATUS 与依赖许可清单 | P2-20 |
| FIX-P022-T013-07 | T008 gate hash schema 自述问题与 canonical witness meaning 缺失的冻结决策（改或接受并记录） | P2-03/05 |
| FIX-P022-T013-08 | validateReportStructure 扩展交叉核对（per-kind 分数、coverage、controls） | P2-04 |
| FIX-P022-T013-09 | UI BFS 默认 maxDepth 与 API 默认对齐（或明确标注） | P2-10 |
| FIX-P022-T013-10 | 离线 HTML 可见汇总补 per-kind 分数等，或确认接受子集渲染 | P2-11 |

其余 P2（P2-06/07/08/09/12/13/14/15/16/17/21/22/23/24）为已知局限/范围说明，
无需代码修复，留待终审记录。

## 9. 产出清单

全部在 `handoff/T013/`（未 commit）：

| 文件 | 内容 |
|---|---|
| `INDEPENDENT_REVIEW.md` | 本文件 |
| `REVIEW_INDEX.md` | 版本、commit、工作树、文件清单/大小/SHA、映射、测试结果、hash、Oracle 独立性、许可证、未解决项 |
| `REVIEW_PACK_01.md`–`REVIEW_PACK_10.md` | 源码全文（src/scripts/tests/配置） |
| `COVERAGE_MATRIX.csv` | 每个源文件的 READ 状态（src 101/101 READ，scripts 6/6 READ，tests 43 SPOT） |
| `TASK_REPORT.md` | 亲自跑的每条命令、退出码、实测结果 |
| `sha256.txt` | 核对过的关键文件 SHA-256 |
| `test_commands.txt` | 命令清单 |
| `test_logs/` | 逐条命令原始日志（01–10） |
| `unresolved_items.md` | 全部 25 项 P2 与遗留项 |
| `hash_recompute.py` | 独立四哈希重算脚本（自写 Python canonicaliser） |
