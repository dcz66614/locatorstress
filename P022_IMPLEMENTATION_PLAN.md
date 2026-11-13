# P022 LocatorStress｜定位器压力台
## IMPLEMENTATION_PLAN.md｜施工计划

**PROJECT_ID:** `P022`  
**SPEC_VERSION:** `1.0.0`  
**SPEC_STATUS:** `SPEC_FROZEN / NOT_IMPLEMENTED`  
**PLAN_STATUS:** `READY_FOR_S0_ONLY`  
**GO_STATUS:** `GO NOT DECLARED`  
**LICENSE:** `PENDING_SAM_DECISION`  
**FIXED_SEED:** `P022-LOCATORSTRESS-S0-2026-11-10`  
**工时:** 72h + 16h 缓冲 = 88h

> Muse 是项目 Owner 代理、调度员、进度追踪员和质量门禁，不编写业务代码。所有编码、修复、测试脚本、集成和文档排版由 Muse 调度的既有免费模型平台执行。每项任务使用全新模型会话。

---

## 0. 执行规则与授权边界

### 0.1 当前授权

- `READY_FOR_S0_ONLY`：只准备到 S0 的任务范围。
- `GO NOT DECLARED`：Sam 尚未授权施工；未明确授权前不得派发 T001。
- S0 失败立即 STOP，T004–T014 锁定。
- S0 通过只解除 S0 技术阻断，不自动授权 S1–S5。
- 许可证保持 `PENDING_SAM_DECISION`，不得自行添加项目 LICENSE。

### 0.2 任务执行硬规则

1. 每项任务有唯一 `TASK_ID`，对应模型平台开全新会话。
2. 任务包包含目标、输入、输出路径、禁止修改文件、验收命令、预期证据、完成定义和失败回退。
3. 构建者与独立审查者尽可能使用不同模型/不同会话。
4. 任务先验收后合并；Muse 只协调、运行门禁、核验证据和归档。
5. 不并发修改相同文件；确需并行时使用独立 worktree 和文件所有权。
6. 每次交接附 commit、diff 文件清单、命令、退出码、测试计数、日志路径和 SHA-256。
7. 失败日志保留；修复在新会话、新任务 ID 或 FIX 子任务执行，不覆盖失败证据。
8. 不允许人工豁免 Oracle mismatch；任何字段不匹配即 FAIL。
9. 未由 Muse 在 VM 真实执行并核对退出码的命令，不得写成 PASS。

---

## 1. 阶段门槛与工时总览

| 阶段 | 任务 | 主要交付 | 工时 |
|---|---|---|---:|
| S0 | T001–T003 | Locator 解析与 Oracle、八种变异、192 用例、一键 S0 gate | 18h |
| S1 | T004–T006 | 四态 verdict、稳定性分数、canonical JSON 和四个 hash | 13h |
| S2 | T007–T008 | 有界 BFS、最短失败见证、分析 API / JSON | 10h |
| S3 | T009–T010 | 本地 Web UI、DOM diff、离线 HTML / JSON | 10h |
| S4 | T011–T012 | 全量自动化、E2E、离线、性能与压力证据 | 11h |
| S5 | T013–T014 | 独立评审、修复复审、正式冻结和发布包 | 10h |
| **任务工时合计** | T001–T014 |  | **72h** |
| 预留缓冲 | 不分配给任务 | 可复现 P0/P1 修复和 VM 环境差异 | 16h |
| **总容量** |  |  | **88h** |

### 1.1 阶段通过规则

- S0：`npm run s0:gate` 退出码 0；192/192 完成；Oracle parity 100%；预植入失败全部检出；稳定控制误报率 ≤2%；四态覆盖；100 次运行一个唯一 gate hash；外部网络 0。
- S0 FAIL：STOP；T004–T014 BLOCKED；Muse 提交复现证据和修复建议，等待 Sam 决策。
- S1：四态边界、分数分母、canonical JSON 和 hash 全部通过独立测试。
- S2：BFS 最短性、深度/状态上限、tie-break 和 witness parity 全通过。
- S3：UI 主流程、键盘操作、DOM diff、报告和导出完整。
- S4：全量测试、离线网络、E2E、性能/压力、确定性和依赖审查通过。
- S5：独立评审无 P0/P1；冻结包与 Git archive 逐文件一致；哈希可复算。

---

## 2. 任务依赖图与集成顺序

```text
T001 环境 + LocatorSpec + Playwright baseline + Node-side Oracle
  |
  v
T002 24 合成页面 + M01-M08 + 192 单变异用例
  |
  v
T003 S0 gate 编排 + 100 次 hash 重放 + S0 报告
  |
  +---- S0 PASS 且获得 S1 授权 ----+
                                   |
                                   v
T004 四态 Verdict
  |
  v
T005 稳定性评分与控制组指标
  |
  v
T006 Canonical JSON + SHA-256
  |
  v
T007 有界 BFS
  |
  v
T008 最短 witness + Analysis API / JSON
  |
  v
T009 Web UI / DOM diff / Verdict Matrix
  |
  v
T010 HTML / JSON 导出与离线报告
  |
  v
T011 全量单元、属性、变异、Oracle parity
  |
  v
T012 E2E、离线、性能、压力、键盘可访问性
  |
  v
T013 独立评审 + 修复复审
  |
  v
T014 正式冻结 source.zip / dist.zip / manifest / hashes
```

默认串行集成。只有 Muse 确认文件归属完全分离、接口已冻结时才允许独立 worktree 并行；不得并发修改 contracts、fixtures/golden 或 canonical。

---

## 3. 工作区布局与文件归属

```text
P022-locatorstress/
  package.json
  package-lock.json
  tsconfig.json
  vite.config.ts
  README.md
  USER_GUIDE.md
  HOW_TO_REPRODUCE.md
  THIRD_PARTY_NOTICES.md
  LICENSE_STATUS.md

  src/
    contracts/
      locator.ts
      scenario.ts
      fixture.ts
      report.ts
    fixtures/
      fixture-loader.ts
      fixture-manifest.ts
      pages/F001.html ... F024.html
      oracle-manifests/F001.json ... F024.json
      golden/expected-verdicts.json
    mutations/
      types.ts
      M01-wrap-target.ts
      M02-reorder-siblings.ts
      M03-change-class.ts
      M04-insert-same-name.ts
      M05-nested-iframe.ts
      M06-open-shadow-root.ts
      M07-hidden-duplicate.ts
      M08-change-text.ts
      registry.ts
    runner/
      browser.ts
      frame-scope.ts
      locator-resolver.ts
      execution.ts
    oracle/
      target-capture.ts
      identity-compare.ts
      oracle-runner.ts
    verdict/
      classify.ts
      stability-score.ts
    search/
      bfs.ts
      state-key.ts
      witness.ts
    canonical/
      normalize.ts
      canonical-json.ts
      sha256.ts
      hash-contract.ts
    api/
      server.ts
      routes.ts
    cli/
      index.ts
      commands/
    export/
      json-export.ts
      html-export.ts
      templates/
    ui/
      App.tsx
      pages/
      components/
      styles/

  tests/
    unit/
    integration/
    e2e/
    property/
    mutation/
    offline/
    performance/
    fixtures/
    golden/

  scripts/
    s0-gate.ts
    repeat-hash.ts
    verify-oracle.ts
    verify-release.ts

  evidence/
    environment/
    s0/
    s1/
    s2/
    s3/
    s4/
    review/
    release/

  handoff/
  review/
    REVIEW_INDEX.md
    REVIEW_PACK_01.md
    REVIEW_PACK_02.md
```

### 3.1 文件所有权

- T001：contracts/locator 初始版、runner、oracle 初始版、environment evidence。
- T002：fixtures、mutations、golden expected matrix。
- T003：S0 gate scripts、S0 gate config、evidence/s0。
- T004–T006：verdict、score、canonical。
- T007–T008：search、analysis API、JSON report。
- T009–T010：ui、export。
- T011–T012：tests 和证据；不直接修改生产算法。
- T013：只审查和提出问题；修复另开 FIX 任务。
- T014：只在冻结 commit 后生成 release artifacts，不修改业务源码。

---

## 4. 冻结接口与实现要求

### 4.1 LocatorSpec

```ts
type LocatorKind = "css" | "xpath" | "role";

interface LocatorSpecV1 {
  kind: LocatorKind;
  selector?: string;
  role?: string;
  name?: string;
  exact?: boolean;
  includeHidden?: boolean;
  framePath?: string[]; // 0–2 CSS iframe selectors
  index?: number | null; // optional .nth(index)
}
```

不支持 arbitrary JS、Locator callback、正则函数或自动生成 Locator。`index` 是 0-based `.nth(index)`。

### 4.2 四态 verdict

- STABLE：最终匹配恰好 1 个，且与原目标 ElementHandle 同一对象。
- WRONG_TARGET：最终匹配恰好 1 个，但不是原目标。
- AMBIGUOUS：最终匹配大于 1，或 framePath 某层多个 frame。
- MISSING：最终匹配为 0，或 framePath 某层无匹配 frame。

Playwright error / timeout / invalid fixture 使用独立 `executionStatus`，不得新增第五个 verdict，也不得伪装为 MISSING。

### 4.3 Oracle identity

- baseline 前捕获原目标 ElementHandle；
- Oracle target path 只在私有 fixture manifest；
- 不向 DOM 注入 oracle 标记；
- 变异后比较 actual / original handle 的 JS 对象身份；
- CDP 临时对象 ID 不进入报告或 hash；
- Oracle、生产分类器和 golden expected outcomes 独立。

### 4.4 S0 固定样本

24 合成页面；CSS/XPath/role 各 8；稳定控制 12、脆弱控制 12；M01–M08；至少 192 单变异案例；每个 fixture baseline 唯一命中；四态各至少 8 个 golden case；expected matrix 独立冻结。

### 4.5 Hash 契约

- `scenario_sha256`
- `oracle_result_sha256`
- `analysis_sha256`
- `gate_sha256`

Canonical JSON：UTF-8、LF、NFC、对象键排序、数组稳定排序；不包含墙上时钟、随机 UUID、PID、机器绝对路径或 CDP 临时对象 ID。固定 seed 为 `P022-LOCATORSTRESS-S0-2026-11-10`。

---

## 5. 原子任务卡 T001–T014

### T001｜环境盘点、LocatorSpec 与 Playwright Oracle baseline

**阶段/工时：** S0 / 6h  
**目标：** 记录 VM 环境；固定 Node/Playwright/Chromium；建立 TypeScript 工程；实现 CSS/XPath/role schema；用本地 Chromium 跑最小 baseline；验证 Node-side ElementHandle identity；拦截外部请求。  
**输入：** 项目书 §3、§5、§9、§11；固定 seed；空工作区。  
**输出：** `ENVIRONMENT_REPORT.md`、package/lock/tsconfig、`src/contracts/locator.ts`、`src/runner/`、`src/oracle/`、`T001_BASELINE.json`。  
**允许修改：** 工程骨架、contracts/locator、runner、oracle、environment evidence。  
**禁止修改：** fixtures/golden、mutations、verdict、score、search、UI、release。  
**验收命令：**
```powershell
npm ci
npm run typecheck
npm run s0:locator-oracle
```
**预期证据：** 精确环境版本；baseline 1/1 唯一命中原目标；handle identity 可复现；外部请求 0。  
**完成定义：** 命令退出 0、lockfile 固定、日志可读、identity probe 通过。  
**失败回退：** 保留日志；若 Chromium 或 identity 不可靠，S0 STOP，不得用模拟浏览器替代。

### T002｜24 合成页面、M01–M08 与 192 单变异

**阶段/工时：** S0 / 8h  
**依赖：** T001 PASS  
**目标：** 生成 F001–F024；CSS/XPath/role 各 8；稳定控制 12、脆弱控制 12；实现八算子；每页跑八个单变异；独立冻结 expected verdict matrix；decoy 不携带 Oracle 身份。  
**输入：** T001 工程/Oracle；项目书 §4、§5、§12；固定 seed。  
**输出：** 24 HTML、Oracle manifests、`expected-verdicts.json`、M01–M08、集成测试、192 用例日志和 `T002_MUTATION_REPORT.json`。  
**允许修改：** fixtures、mutations、对应集成测试和证据。  
**禁止修改：** T001 schema、Oracle 核心、S0 gate、UI/API、hash 核心。  
**验收命令：**
```powershell
npm run test:s0:fixtures
npm run test:s0:mutations
```
**预期证据：** fixture 24/24 有效；baseline 24/24；192 用例运行；四态各 ≥8；golden expected 独立编写。  
**完成定义：** 所有 fixture/算子/expected matrix/日志齐全；不使用生产分类器生成 golden。  
**失败回退：** 不修改 expected 迎合实现；保留失败样本，开 FIX-T002 新会话。

### T003｜S0 一键 Gate、Oracle parity 与 100 次重放

**阶段/工时：** S0 / 4h  
**依赖：** T001、T002 PASS  
**目标：** 实现唯一入口 `npm run s0:gate`，串行执行 baseline、192 mutations、Oracle parity、控制组误报率、四态覆盖、离线检查和 100 次 hash 重放。  
**输入：** T001/T002 全部实现、fixtures、golden、项目书 §6、§12。  
**输出：** `scripts/s0-gate.ts`、`scripts/repeat-hash.ts`、S0 gate report/log/hash replay/oracle parity。  
**允许修改：** S0 gate scripts、S0 evidence、package scripts。  
**禁止修改：** fixture truth、LocatorSpec、M01–M08；缺陷须开 FIX 子任务。  
**验收命令：**
```powershell
npm run s0:gate
```
**硬门：** 24/24 baseline；192/192 完成；预植入失败 100% 检出；稳定控制误报 ≤2%；Oracle parity 100%；四态各 ≥8；100 次运行一个唯一 gate hash；外部网络 0；退出码 0。  
**完成定义：** 一键命令在干净工作区执行成功，Muse 亲自重跑并归档全部证据。  
**失败回退：** S0 FAIL / STOP；T004–T014 BLOCKED；不允许人工豁免。

### T004｜四态 Verdict 分类

**阶段/工时：** S1 / 5h  
**依赖：** S0 PASS + S1 授权  
**目标：** 实现唯一四态分类；区分 framePath 多匹配、selector 多匹配、唯一错误对象和零匹配。  
**输入：** S0 冻结 commit、LocatorSpec、Oracle contract。  
**输出：** `src/verdict/classify.ts`、verdict tests、`T004_VERDICT_REPORT.json`。  
**允许修改：** verdict 模块和专属测试。  
**禁止修改：** fixtures/golden、Oracle、mutations、canonical、UI。  
**验收命令：** `npm run test:verdict && npm run test:oracle`  
**完成定义：** 四态有正/负/边界例；执行错误不伪装 verdict。  
**失败回退：** 保留 failing case，新开 FIX-T004；不改 golden truth。

### T005｜稳定性评分与控制组指标

**阶段/工时：** S1 / 4h  
**依赖：** T004 PASS  
**目标：** 实现 per-locator、per-operator、overall score；明确分子分母；incomplete 不计分但降低 coverage。  
**输入：** CaseResult、control class、golden matrix。  
**输出：** `stability-score.ts`、score tests、`T005_SCORE_REPORT.json`。  
**允许修改：** score 模块和测试。  
**禁止修改：** verdict 定义、Oracle、golden matrix、hash core。  
**验收命令：** `npm run test:score && npm run test:controls`  
**完成定义：** 公式、分母、coverage、误报率可复算；不完整用例不算 STABLE。  
**失败回退：** 独立重算；不通过排除失败案例提高分数。

### T006｜Canonical JSON 与四个 SHA-256

**阶段/工时：** S1 / 4h  
**依赖：** T004、T005 PASS  
**目标：** 实现 NFC、UTF-8、LF、键排序、数组稳定排序和四个 hash；排除时间、UUID、PID、绝对路径、CDP object ID。  
**输入：** scenario、oracle、analysis、gate schemas。  
**输出：** `src/canonical/`、canonical tests、`T006_HASH_REPORT.json`。  
**允许修改：** canonical 模块与专属测试。  
**禁止修改：** fixtures/golden、mutations、verdict semantics、UI。  
**验收命令：** `npm run test:canonical && npm run test:hash-contract`  
**完成定义：** 同输入规范化字节一致；hash 不自指；禁止字段扫描 0 命中。  
**失败回退：** 保留不一致字节样本，修复 canonical，不忽略字段。

### T007｜有界 BFS 最短失败序列

**阶段/工时：** S2 / 6h  
**依赖：** S1 PASS + S2 授权  
**目标：** 实现深度 ≤6、状态数 ≤4096 BFS；固定算子顺序、tie-break、状态去重；失败谓词为 verdict != STABLE。  
**输入：** mutation registry、verdict classifier、canonical state key。  
**输出：** `src/search/bfs.ts`、state-key、BFS tests、`T007_BFS_REPORT.json`。  
**允许修改：** search 模块和测试。  
**禁止修改：** mutations、verdict、Oracle、canonical 基础算法。  
**验收命令：** `npm run test:bfs && npm run test:bfs:determinism`  
**完成定义：** 已知深度 1–6 witness 按最短长度/tie-break 返回；上限如实 bounded。  
**失败回退：** 保存状态队列和最小复现；不把 bounded incomplete 写成 no witness。

### T008｜Witness、分析 API 与 JSON 报告

**阶段/工时：** S2 / 4h  
**依赖：** T007 PASS  
**目标：** 整合 witness、verdict、score、coverage、hash；实现本地 API 和 JSON export。  
**输入：** CaseResult、BFS witness、report schema。  
**输出：** `witness.ts`、`api/`、JSON exporter、`T008_API_REPORT.json`。  
**允许修改：** witness、API、JSON exporter。  
**禁止修改：** Oracle、变异算法、UI。  
**验收命令：** `npm run test:witness && npm run test:api && npm run test:export:json`  
**完成定义：** JSON schema 有效、hash 可复算、API 只监听 loopback。  
**失败回退：** API 不完整标 FAIL；不允许 UI 侧计算补后端字段。

### T009｜本地 Web UI 与 DOM diff

**阶段/工时：** S3 / 6h  
**依赖：** S2 PASS + S3 授权  
**目标：** Fixture Lab、Locator 编辑、Mutation Lab、Verdict Matrix、BFS Witness、Report。  
**输入：** 冻结 API、schema、report examples。  
**输出：** `src/ui/`、UI E2E、`T009_UI_REPORT.md` 和截图。  
**允许修改：** UI、样式、UI E2E。  
**禁止修改：** verdict、score、Oracle、BFS、canonical。  
**验收命令：** `npm run test:ui && npm run typecheck`  
**完成定义：** 从选择 fixture 到查看 verdict/witness 完整；不提供自动生成或修复 Locator。  
**失败回退：** UI 独立分支修复；不改变 API 语义绕过测试。

### T010｜离线 HTML / JSON 导出与安全转义

**阶段/工时：** S3 / 4h  
**依赖：** T008、T009 PASS  
**目标：** 生成自包含 HTML/JSON；无 CDN/远程脚本/字体/图片；转义输入文本。  
**输入：** AnalysisReport schema、UI report design。  
**输出：** HTML exporter、templates、export tests、`T010_EXPORT_REPORT.json`。  
**允许修改：** export 模块和测试。  
**禁止修改：** core analysis、Oracle、UI 主结构。  
**验收命令：** `npm run test:export && npm run test:html-safety`  
**完成定义：** HTML 离线打开；内容与 JSON 一致；无外部资源；XSS payload 作为文本显示。  
**失败回退：** 保留 JSON；不把外部依赖加进 HTML。

### T011｜全量单元、属性、Mutation 与 Oracle Parity

**阶段/工时：** S4 / 6h  
**依赖：** S3 PASS + S4 授权  
**目标：** 补齐边界、属性、变异和 golden 覆盖；独立 Oracle 与生产实现逐字段一致。  
**输入：** S0–S3 冻结实现、24×8 golden、hash contract。  
**输出：** unit/property/mutation tests、`T011_FULL_TEST_REPORT.md`。  
**允许修改：** tests 和证据；生产代码须经独立 FIX 任务。  
**禁止修改：** golden expected outcomes（除非经独立证明规格 fixture 错误并 ADR 批准）、release freeze。  
**验收命令：**
```powershell
npm test
npm run test:coverage
npm run test:mutation
npm run test:oracle
```
**完成定义：** 支持项有正/负/边界测试；Oracle parity 100%；变异测试检出率达门槛。  
**失败回退：** mismatch 开 FIX；不得加忽略清单放行。

### T012｜浏览器 E2E、离线、性能与压力

**阶段/工时：** S4 / 5h  
**依赖：** T011 PASS  
**目标：** 验证 Chromium E2E、UI 键盘路径、0 外部网络、24×8 矩阵、BFS 上限、性能和资源限制。  
**输入：** S0–S3 冻结实现、seed、环境报告。  
**输出：** E2E/offline/performance tests、`T012_E2E_OFFLINE_PERF_REPORT.md`。  
**允许修改：** 测试、性能脚本和证据。  
**禁止修改：** 生产算法、fixtures/golden、hash contract。  
**验收命令：**
```powershell
npm run test:e2e
npm run test:offline
npm run test:performance
npm run test:stress
npm run build
```
**完成定义：** 主流程 E2E 通过；外部请求 0；键盘主流程可用；P95 和环境真实记录。  
**失败回退：** 保留 Chromium trace；不以任意加长 timeout 掩盖不稳定。

### T013｜独立代码与规格评审

**阶段/工时：** S5 / 6h  
**依赖：** S4 PASS + S5 授权  
**目标：** 未参与实现的独立新会话审查源码、配置、fixtures、Oracle、测试、报告、离线边界和许可证。  
**输入：** 候选 commit、REVIEW_INDEX、REVIEW_PACK_XX、全量日志和规格。  
**输出：** `INDEPENDENT_REVIEW.md`、问题清单、修复任务包、复审结论。  
**允许修改：** review/evidence；修复由独立 FIX 任务执行。  
**禁止修改：** 审查者不得直接改业务源码；Muse 不直接写修复。  
**验收命令：** `npm run verify:review-pack && npm run verify:all`  
**完成定义：** 关键文件覆盖完整；P0/P1 全部关闭；P2 登记；审查者独立。  
**失败回退：** 问题拆 FIX-P022-XX，新会话修复后独立复审；未通过不得冻结。

### T014｜正式冻结、发布包与逐文件核验

**阶段/工时：** S5 / 4h  
**依赖：** T013 PASS  
**目标：** 冻结 commit；生成 source.zip、dist.zip、RELEASE_MANIFEST.json、SHA256SUMS.txt；核对 source.zip 与 `git archive` 逐文件一致。  
**输入：** T013 PASS commit、测试证据、环境和许可证报告。  
**输出：** 四项 release artifacts、T014_FREEZE_REPORT.md、最终 REVIEW_INDEX。  
**允许修改：** release scripts、manifest、release evidence；不改冻结源码。  
**禁止修改：** 已冻结源码、fixtures/golden、review verdict。  
**验收命令：**
```powershell
npm run release:verify
npm run release:compare-source
npm run release:verify-hashes
```
**完成定义：** source.zip 由冻结 commit `git archive` 生成；逐文件路径/字节一致；dist/manifest/SHA 可复算；工作树 clean；Drive 回读大小和 SHA 匹配。  
**失败回退：** 冻结包作废并保留记录；重新从冻结 commit 生成，不覆盖旧证据。

---

## 6. S0 硬门细则

### 6.1 一键命令

```powershell
npm run s0:gate
```

唯一成功退出码为 0。非零码必须区分失败类型并写入日志；不得出现测试失败但 shell 仍返回 0。

### 6.2 S0 验收表

| 检查项 | 门槛 |
|---|---:|
| 合成页面 | 24/24 |
| Locator 类型 | CSS 8 / XPath 8 / role 8 |
| 控制组 | 稳定 12 / 脆弱 12 |
| 变异算子 | M01–M08 |
| 单变异用例 | 192/192 |
| baseline 唯一命中 | 24/24 |
| 预植入确定性失败检出 | 100% |
| 稳定控制误报率 | ≤2% |
| 四态覆盖 | 每态 ≥8 |
| Oracle parity | 100% 逐字段一致 |
| 重复运行 | 100 次 1 个 gate hash |
| 固定 seed | 结果完全一致 |
| 外部网络 | 0 |
| 真人参与 | 0 |
| 一键 gate | 退出码 0 |

S0 失败后 T004–T014 全部 BLOCKED；不得通过真人、真实网站、在线 API 或人工解释补救。

---

## 7. 模型工种分配建议

Muse 按已测试可用的免费模型平台安排，不臆造模型名称、额度或新账号。

| 工种 | 任务 | 独立性要求 |
|---|---|---|
| TypeScript / Playwright 构建者 | T001–T010 | 每项任务新会话，按文件归属 |
| Oracle / 测试构建者 | T001–T003、T011 | 不用生产分类器生成 expected truth |
| UI 构建者 | T009–T010 | 依赖冻结 API，不在前端算 verdict |
| 测试审查者 | T011–T012 | 尽可能不同于构建者 |
| 独立代码审查者 | T013 | 未参与实现的新会话 |
| 发布执行者 | T014 | Muse 协调，Agent 执行打包 |

---

## 8. 交接格式与集成规则

每个任务交接必须包含：

```text
TASK_ID:
STATUS: PASS | FAIL | BLOCKED
BASE_COMMIT:
RESULT_COMMIT:
CHANGED_FILES:
UNTOUCHED_PROTECTED_FILES:
COMMANDS:
EXIT_CODES:
TEST_COUNTS:
EVIDENCE_PATHS:
SHA256:
KNOWN_LIMITATIONS:
FAILED_CASES:
ROLLBACK_POINT:
NEXT_TASK_PREREQUISITES:
```

失败交接必须附最小复现输入、预期/实际结果、原始 stdout/stderr、失败 commit、文件范围、污染情况、建议修复点和回退 commit。

合并顺序：Agent 独立 worktree 完成 → Muse 核对 diff 和命令 → 验收 → 独立审查（如需）→ 集成 Agent 合并 → 重跑受影响门禁 → 更新 REVIEW_INDEX 和 SHA。

---

## 9. 测试与审查策略

测试层级：
- Unit：LocatorSpec、四态、评分、canonical JSON、SHA、BFS tie-break；
- Integration：真实 Playwright + Chromium + 24 fixtures + M01–M08；
- Golden：192 个冻结 expected verdict cases；
- Oracle parity：逐字段比较，0 mismatch；
- Property：固定 seed、状态去重、分数分母不变量；
- Mutation testing：注入错误 verdict、丢失 identity、改变 mutation 参数；
- E2E：选择 fixture、运行、查看 verdict、BFS、导出；
- Offline：外部请求 0；
- Performance/stress：192 用例、BFS 上限、HTML 导出和批量分析。

建议性能目标（实测前仅为目标）：192 个单变异用例总耗时 P95 ≤60s；单 fixture 8 个变异 P95 ≤2s（不含 Chromium 首次启动）；BFS 4096 状态 P95 ≤5s；内存峰值目标 ≤512 MiB。若 VM 资源不同，先提交 ADR，不得直接改门槛。

### 9.1 REVIEW_INDEX 与 REVIEW_PACK

`REVIEW_INDEX.md` 必须列项目版本、commit、工作树、源码文件清单/大小/SHA、规格到实现映射、任务状态、测试命令/退出码、四个 hash、Oracle 独立性、许可证、未解决项。

`REVIEW_PACK_XX.md` 分批提供核心源码全文，覆盖 Oracle、mutations、BFS、canonical hash、API/UI、tests、配置和构建脚本。不得只给 README 或测试摘要。

---

## 10. 隐私、离线与供应链

- 运行时不连接外网，不调用 LLM 或商业 API；
- 全部测试数据合成；
- Playwright route 拦截非 loopback 请求；
- 不读取真实浏览器 profile、cookies、localStorage 或用户网页；
- 不执行输入脚本或外部资源；
- npm lockfile 精确固定；
- T001 生成依赖许可清单，T013 独立复核；
- 项目许可证由 Sam 决定，未决定前不生成 LICENSE。

---

## 11. 风险分级

| 风险 | 级别 | 控制 |
|---|---|---|
| Oracle 身份泄漏给 Locator | P0 | 无 DOM marker；Node-side ElementHandle |
| WRONG_TARGET 漏检 | P0 | identity compare + `.nth()` decoy golden |
| Oracle 与生产共用算法 | P0 | 独立实现 + 独立 expected matrix |
| 192 用例未全跑 | P0 | S0 gate 阻断 |
| Oracle parity mismatch | P0 | 任一字段 mismatch = FAIL |
| 100 次 hash 不一致 | P0 | S0 gate 阻断 |
| 外部请求泄漏 | P0 | 任何一次即 FAIL |
| iframe/ShadowRoot 超范围 | P1 | 明确限制，不猜测 |
| BFS 超上限 | P1 | 输出 bounded status |
| 分数被误解为生产概率 | P1 | UI 明示合成集指标 |
| 退化为 Locator 生成器/普通 DOM diff | P0 | STOP |
| 需要真人/真网/付费 API | P0 | STOP |

---

## 12. 发布结构与冻结清单

```text
release/
  source.zip
  dist.zip
  RELEASE_MANIFEST.json
  SHA256SUMS.txt
  README.md
  USER_GUIDE.md
  HOW_TO_REPRODUCE.md
  THIRD_PARTY_NOTICES.md
  LICENSE_STATUS.md
  evidence/
  review/
    REVIEW_INDEX.md
    REVIEW_PACK_01.md
    REVIEW_PACK_02.md
    INDEPENDENT_REVIEW.md
```

T014 冻结要求：
- 冻结 commit 后工作树 clean；
- source.zip 由该 commit 的 `git archive` 生成；
- 解包 source.zip 与同 commit git archive 逐文件路径、字节一致；
- dist.zip 只含分发物和必要文档；
- manifest 列 commit、版本、文件清单、字节数、SHA；
- SHA256SUMS 不自指；
- Drive 下载回读后重新算 SHA，必须匹配；
- 任一文件不一致，冻结包作废，不得通知完成。

发布前清单：
- [ ] S0–S5 全部通过且有日志；
- [ ] 192 golden 用例核对；
- [ ] Oracle parity 100%，无忽略清单；
- [ ] 100 次 gate hash 一致；
- [ ] 四态、score、BFS 与实现一致；
- [ ] 外部请求 0，真人 0；
- [ ] README、用户指南、复现指南齐全；
- [ ] 依赖许可清单齐全，项目许可证按 Sam 决定；
- [ ] REVIEW_INDEX / REVIEW_PACK 覆盖源码；
- [ ] T013 独立评审 PASS；
- [ ] source.zip 与 git archive 逐文件一致；
- [ ] dist、manifest、SHA256SUMS 可复算；
- [ ] Drive 回读哈希一致。

---

## 13. 最终交付与当前状态

本轮规格文件：PROJECT_BOOK.md、PROJECT_BOOK.docx、IMPLEMENTATION_PLAN.md、IMPLEMENTATION_PLAN.docx、P022_SPEC_BUNDLE.zip、P022_SPEC_SHA256SUMS.txt。

未来施工产物：本地 Web UI/CLI、24 合成页面、M01–M08、Node-side identity Oracle、四态 verdict、稳定性分数、≤6 步 BFS、JSON/离线 HTML、自动化证据、审查包和冻结发布包。

**当前状态：** `SPEC_VERSION 1.0.0 / SPEC_FROZEN / NOT_IMPLEMENTED / READY_FOR_S0_ONLY / GO NOT DECLARED / LICENSE PENDING_SAM_DECISION`。规格齐备不等于 GO，不等于代码已施工，也不等于 S0 已通过。
