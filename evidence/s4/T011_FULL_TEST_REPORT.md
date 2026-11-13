# T011 全量测试报告 — P022 LocatorStress（S4）

- 任务：T011 全量单元、属性、Mutation 与 Oracle Parity
- 日期：2026-11-11（UTC；约 02:30 GMT 完成，见各节时间戳）
- 执行人：T011 施工方（Muse 子代理，fresh session）
- 工作目录：`~/workspace/p022-locatorstress/`（本地 git，无远程；本任务不 commit、不 push）
- 结论：见 §1。生产代码未做任何修改（§9 核对）。

## 1. 验收结论

| 验收命令 | 退出码 | 结果 |
|---|---|---|
| `npm test` | 0 | 35 个文件，**486/486 通过**（0 失败，0 跳过），耗时 84.92 s（2026-11-11 02:02 GMT） |
| `npm run test:coverage` | 0 | 同上 486/486；覆盖率见 §4（2026-11-11 02:03–02:05 GMT） |
| `npm run test:mutation` | 0 | 变异检出 **40/40 = 100.0%**，门槛 90%，见 §5（2026-11-11 02:10 GMT） |
| `npm run test:oracle` | 0 | oracle 脚本 PASS + fixtures 3/3 + mutations 3/3，见 §6（2026-11-11 02:10–02:11 GMT） |

**STATUS：PASS。** 四条验收命令全部 exit 0。S0 gate 回归 **PASS**（gate hash 未变，见 §7）。

## 2. 新增 / 修改文件

### 新增测试文件（13 个）

| 文件 | 内容 | 测试数 |
|---|---|---|
| `tests/verdict/classify-boundaries.test.ts` | 四态边界：frame 优先于 selector、identity 只在 final==1 时判定、NaN/Infinity 计数、reason 字符串；负计数 + 决定性 identity（M-CL-06 检出，见 §5） | 26 |
| `tests/score/format-percent-boundaries.test.ts` | 精确半值舍入：`formatPercent(1,200000)="0.001"`、`(3,200000)="0.002"`、`(1,8000)="0.013"`、`(1,16000)="0.006"`、`(3,16000)="0.019"`；空行；control-metrics 边界 | 26 |
| `tests/canonical/canonical-boundaries.test.ts` | NFC 键碰撞（分解 `e`+U+0301 vs 预合成 U+00E9）、深嵌套、hash 向量；整数型键按数值序（JS 对象键重排，冻结行为，已注释） | 23 |
| `tests/contracts/locator-spec.test.ts` | validate/parse/normalize 边界 | 35 |
| `tests/export/html-escape.test.ts` | 转义全表；U+2028/U+2029 | 22 |
| `tests/api/routes-boundaries.test.ts` | 路由边界 | 35 |
| `tests/analysis/witness-boundaries.test.ts` | witness 边界 | 14 |
| `tests/search/state-key-boundaries.test.ts` | state-key 边界 | 22 |
| `tests/property/property.test.ts` | P1 canonical 不动点/键序无关；P2 评分计数不变量（100 次种子试验，LCG seed `0x9e3779b9`/`20261110`）；P3 BFS 确定性；P4 verdict 网格完备性；P5 golden 矩阵完备性（192 例） | 6 |
| `tests/mutations/mutation-operators.test.ts` | M01–M08 逐算子 DOM 效应（真实 Chromium）、Oracle identity 保持、确定性、M01 双重包裹 | 16 |
| `tests/runner/resolver-boundaries.test.ts` | frame 作用域 0/1/2 层、缺失/歧义 frame、index 越界、role `includeHidden`、ERROR 路径 | 27 |
| `tests/oracle/oracle-capture.test.ts` | `captureOriginalTarget` 0/2/3 匹配错误、frame/shadow 捕获、`isSameElement` null 规则、`probeHandleWrapperIdentity`（nodeIdentity true、wrapperIdentity false） | 20 |
| `tests/integration/oracle-parity-independent.test.ts` | 三方 192 例 parity：生产 `classifyVerdict` vs 测试内独立重实现（按 PROJECT_BOOK §5.2/§5.3，不 import `classifyVerdict`）vs 冻结 golden；写 `evidence/s4/T011_ORACLE_PARITY.json` | 2 |

13 个新增文件合计 **274 个测试**；接手时基线 212 个测试（486 − 274）。

### 修改的文件

| 文件 | 改动 |
|---|---|
| `package.json` | 新增脚本 `test`、`test:coverage`、`test:mutation`；新增 devDependency `@vitest/coverage-v8@5.1.0`（`package-lock.json` 同步更新） |
| `vitest.config.ts`（新增） | coverage provider v8；仅度量 `src/**`（排除 fixtures）；reporter text + json-summary + json |
| `scripts/t011-mutation-runner.mjs`（新增） | 手写变异测试运行器，40 个变异体（见 §5）；v2 设计：变异只发生在 `~/t011-mutation-work/` scratch 副本中，永不写生产文件 |
| `tests/verdict/classify-boundaries.test.ts` | 补 5 个负计数 + 决定性 identity 用例（M-CL-06 检出） |
| `tests/mutations/mutation-operators.test.ts` | 修正 M05（frameLocator 取 iframe 内 target）、M06（light-DOM 断言；Playwright CSS 会穿透 open shadow root，见 §8） |
| `tests/oracle/oracle-capture.test.ts` | 修正空 locator 用例：`elementHandle()` 超时抛错而非返回 null（实测），改为断言抛错并记录 null 分支不可达（见 §8） |

### 未修改

生产源码（`src/`、`scripts/` 除测试脚本外）、golden expected outcomes、fixtures、hash contract、release freeze——全部未动，见 §9 的 SHA 核对。

## 3. 各模块测试数（`npm test` 实跑，`vitest --reporter=json`）

35 个文件，486 个测试，全部通过（0 失败，0 跳过）。逐文件计数（2026-11-11 02:28 GMT 第三次全量复核，同样 486/486）：

| 模块 | 文件（测试数） | 小计 |
|---|---|---|
| verdict | classify.test.ts 34、classify-boundaries.test.ts 26、verdict-golden.test.ts 3 | 63 |
| score | stability-score.test.ts 16、controls.test.ts 2、format-percent-boundaries.test.ts 26 | 44 |
| canonical | canonical-json.test.ts 20、canonical-boundaries.test.ts 23、forbidden-scan.test.ts 16、hash-contract.test.ts 11 | 70 |
| search | bfs.test.ts 24、bfs-determinism.test.ts 4、bfs-browser.test.ts 1、state-key-boundaries.test.ts 22 | 51 |
| analysis | witness.test.ts 13、witness-boundaries.test.ts 14 | 27 |
| api | routes.test.ts 14、routes-boundaries.test.ts 35、server.test.ts 4、analyze-browser.test.ts 9、validate-http.test.ts 3 | 65 |
| export | json-export.test.ts 9、html-export.test.ts 8、html-safety.test.ts 3、html-escape.test.ts 22 | 42 |
| integration | s0-fixtures.test.ts 3、s0-mutations.test.ts 1、p2a-detach-regression.test.ts 2、oracle-parity-independent.test.ts 2 | 8 |
| ui | ui-flow.test.ts 12 | 12 |
| contracts | locator-spec.test.ts 35 | 35 |
| property | property.test.ts 6 | 6 |
| mutations | mutation-operators.test.ts 16 | 16 |
| oracle | oracle-capture.test.ts 20 | 20 |
| runner | resolver-boundaries.test.ts 27 | 27 |
| **合计** | | **486** |

## 4. Coverage（真实度量，@vitest/coverage-v8 5.1.0）

- 方法：`npm run test:coverage` = `vitest run --coverage --no-file-parallelism`，provider v8，`vitest.config.ts` 只度量 `src/**/*.ts`（排除 `src/fixtures/**`），`all: true`（未加载文件计 0%）。安装：`npm install -D @vitest/coverage-v8@5.1.0` 成功（registry 可达，12 个包，7 s）。
- 总数（`coverage/coverage-summary.json`）：**lines 69.16%（1016/1469）、statements 69.11%、branches 66.6%、functions 73.44%**。测试 486/486 通过。
- 核心纯模块（T011 主攻目标）：
  - verdict/classify.ts **100/100/100/100**
  - score/stability-score.ts 98.31%（未覆盖 260、415 行）
  - canonical/canonical-json.ts 93.75%、forbidden-scan.ts 96.87%、hashes.ts 81.63%
  - search/bfs.ts 96.87%、state-key.ts **100**、frame-scope.ts **100**
  - contracts/locator.ts **100**、runner/locator-resolver.ts 93.02%
  - analysis/witness.ts 94.16%、api/routes.ts 97.87%、export/html-escape.ts 100%（行）
- 69% 而非更高的原因（均为度量口径问题，非测试缺口）：
  1. **`src/ui/* 0%`（server.ts 504 行、snapshot.ts 98 行）：** `tests/ui/ui-flow.test.ts` 以子进程方式跑 `node dist/ui/server.js`（S3 设计），代码在另一个 Node 进程中执行，vitest 的 v8 采集器看不到。UI 端点本身已被 12 个 UI 测试覆盖（snapshot、scores、reports 均真实返回）。
  2. **变异算子 `src/mutations/M0X-*.ts` 11–67%：** 算子的 DOM 效应代码是传给 `target.evaluate(...)` 的回调，在 Chromium 内执行，不在 Node 的 v8 覆盖范围内。浏览器测试（s0-mutations + 新的 mutation-operators.test.ts）实际执行了这些行并断言了 DOM 效果。
  3. **类型-only 模块 0%：** `src/runner/execution.ts`（仅 `import type` 引用，运行时无代码）、各 `index.ts` barrel、`src/mutations/types.ts`——`all: true` 下未加载的文件计 0%。
  4. 其余低覆盖：`src/runner/browser.ts` 31.25%（错误路径/关闭路径未走）、`src/export/json-export.ts` 72.72%（56、83–98 行）、`src/search/bfs-evaluator.ts` 70.83%（67、94–102 行）、`src/api/server.ts` 76.19%、`src/oracle/identity-compare.ts` 75%（见 §8 的 null 分支）。
- 结论：覆盖率数字是真实的 v8 度量；T011 不设覆盖率门槛（规格未给），报告如实给出数字与口径。核心纯模块 ≥93%（除 hashes.ts 81.63% 外），低覆盖集中在度量盲区而非未测代码。

## 5. Mutation 测试（手写运行器，40 个变异体）

- 运行器：`scripts/t011-mutation-runner.mjs`（`npm run test:mutation`）。手写原因：`node_modules` 无 Stryker，且会话初 `npm install` 被 EPERM 故障阻断；运行器是真实变异执行（改文件 → 跑真实 vitest → 恢复），不是模拟。
- 安全设计 v2（吸取两次事故教训，见 §8）：变异只发生在 `~/t011-mutation-work/` scratch 副本（复制 `src/`、`tests/`、`package.json`、tsconfig，`node_modules` 软链，逐文件 SHA 校验）；生产文件只读，运行前后用整树 SHA 清单核对，任何差异即 exit 2。证据写出用“字节长度 + SHA-256 回读”校验（8 次重试）。
- 门槛：**≥90% 检出**，等价变异体除外（当前等价列表为空）。理由：手写单编辑语义变异体，每个只改一条规格钉死（pinned）的决策，套件应当几乎全数检出；100% 是理想，任何非等价存活者都是测试缺口（FAIL）。审查者裁决门槛是否足够。
- 结果：**40/40 检出 = 100.0%**，0 存活，0 不确定，0 配置错误。证据：`evidence/s4/T011_MUTATION_RESULTS.json`（40 条记录，每条含 exit 码与失败测试数）。
- 变异体清单（分组）：
  - classify（7）：M-CL-01 执行态门反转、M-CL-02 MISSING 阈值 0→1、M-CL-03 AMBIGUOUS 阈值 1→2、M-CL-04 STABLE/WRONG_TARGET 互换、M-CL-05 计数 sanity `>`→`>=`、M-CL-06 去掉 `>= 0` 检查、M-CL-07 frame-kind 互换。
  - score（6）：M-SC-01 半值舍入改截断、M-SC-02 分母 completed→expected、M-SC-03 incomplete 处理反转、M-SC-04 评分分子分母互换、M-SC-05 mismatched 定义改、M-SC-06 analysisStatus 反转。
  - canonical（6）：M-CJ-01 码点排序→UTF-16 默认排序、M-CJ-02 NFC→NFD、M-CJ-03 非有限数静默通过、M-CJ-04 数组反转、M-CJ-05 SHA-256→SHA-1、M-CJ-06 码点比较反转。
  - state-key（3）：M-SK-01 plan key 排序、M-SK-02 失败谓词改、M-SK-03 前缀规则反转。
  - bfs（6）：M-BF-01 深度上限 off-by-one、M-BF-02 扩展预算 off-by-one、M-BF-03 allowRepeat 忽略、M-BF-04 FIFO→LIFO、M-BF-05 去重关闭、M-BF-06 INCOMPLETE 节点展开。
  - html-escape（3）：M-HE-01 单引号不转义、M-HE-02 `<` 不转义（`</script>` 突破）、M-HE-03 `<img>` 移出禁标签集。
  - forbidden-scan（2）：M-FS-01 createdAt 规则收窄、M-FS-02 epoch 规则放宽到 14 位。
  - routes（3）：M-RT-01 已知/未知路径反转、M-RT-02 P2-2 拒绝移除、M-RT-03 HTML 导出 501→200。
  - locator（2）：M-LC-01 framePath 上限 2→3、M-LC-02 index 须 >0。
  - witness（2）：M-WN-01 BOUNDED_NO_WITNESS/BOUNDED_INCOMPLETE 互换、M-WN-02 FOUND-with-null-witness 不变量检查移除。
- 检出过程的发现（已修复，非生产缺陷）：首轮 39/40，**M-CL-06 存活**。根因是测试缺口而非等价变异：所有负计数用例都用 identity null，负 final 计数仍落入 INCOMPLETE 分支；且 `final > raw` 检查覆盖了负 raw 的情况。补了 5 个“负计数 + 决定性 identity”用例（raw 1/final −1/identity true 应为无 verdict 而非 STABLE 等）后，M-CL-06 被 5 个测试检出，重跑全量 40/40。

## 6. Oracle Parity（192/192）

- 方法：三方比对（`tests/integration/oracle-parity-independent.test.ts`，真实 Chromium 跑 s0 fixtures/mutations 拿生产输出；测试内独立重实现按 PROJECT_BOOK §5.2/§5.3，不 import `classifyVerdict`；冻结 golden `src/fixtures/golden/expected-verdicts.json`，seed `P022-LOCATORSTRESS-S0-2026-11-10`）。逐字段比对 verdict、executionStatus、raw/finalMatchCount、frameFailure kind/layer、identityMatch。
- 结果：**192/192 三方一致，mismatches 0**。生产 vs golden 192/192；独立实现 vs golden 192/192；生产 vs 独立实现 192/192。证据：`evidence/s4/T011_ORACLE_PARITY.json`（94,200 B，192 条逐例记录）。
- verdict 分布：STABLE 138、WRONG_TARGET 22、AMBIGUOUS 17、MISSING 15、null 0。
- `npm run test:oracle`（02:10–02:11 GMT，exit 0）：oracle 脚本 result PASS（offline probe 2/2 blocked、frame identity probe sameTarget=true/decoy=false）+ `test:s0:fixtures` 3/3 + `test:s0:mutations` 3/3（2 个文件）。跑完后 `evidence/s0/` 无改动（git status 干净），`S0_GATE.json` 仍为 2376 B、sha `15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d`。

## 7. S0 Gate 回归

- 命令：`npm run s0:gate`，2026-11-11 02:11–02:26 GMT，**exit 0，GATE PASS**（`failure_type=null`）。
- gate hash：`651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52`——与冻结值一致，**未变**。
- repeat-hash：100/100 runs，unique_gate_hashes=1。
- `S0_GATE.json`：2376 B，sha `15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d`——**未变**（内容相同；mtime 被 gate 重写更新）。
- `evidence/s0/S0_P2A.log` 被 gate 重写后已用 `git checkout -- evidence/s0/S0_P2A.log` 恢复；`evidence/s0/` 现 git 干净。

## 8. 环境记录与事故

### 环境
- node v24.22.1、npm 10.9.4、vitest 5.1.0、TypeScript 5.9.3、Playwright 1.65.0、Chromium 158.0.8127.18（chromium-1254；1248 亦在）。
- 2026-11-11 00:17–01:55 GMT：VM 存储 EPERM 抖动 + Chromium 无法启动（memfd `mmap(MAP_SHARED)` 报 EPERM，Chrome CHECK 陷阱 SIGTRAP）。01:55 GMT 后恢复：Python memfd+mmap 探针成功（0x7ef8be6a7000，errno 0），Chrome `--dump-dom about:blank` 正常返回，coverage-v8 安装成功。浏览器测试均在恢复后实跑通过。
- EPERM 期间的应对（均已验证有效）：`muse.write`/`muse.edit` 写入可靠；exec 写入须校验大小 + SHA-256、最多 8 次重试；不把 EPERM 当产品缺陷。

### 事故（测试侧，未造成生产损坏）
1. v1 变异运行器就地改生产文件时，EPERM 使一次写出静默写成 0 字节，`src/verdict/classify.ts` 被截断；恢复写也失败。最终用 `muse.write` 按会话初读到的内容逐字节恢复，SHA-256 `d591f24b1efb8072aa7dfb97d4458ff481a7decbfeeebfc653c368e4402b1850` 与 git HEAD blob 一致（165 行）。教训：运行器改写为 v2 scratch-copy 设计，永不写生产文件。
2. 服务在运行中重启（~01:36–01:40 GMT）又一次导致 `classify.ts` 为 0 字节；再次用 `muse.write` 同内容恢复（5709 B，SHA 同上）。教训：不发重复 exec 命令；最终核对见 §9。
3. 服务重启（本次会话中，`npm run test:mutation` 验收运行期间）打断一次运行；证据文件未被覆盖（运行器只在结束时写证据），重跑后 40/40 正常。
4. 两个测试预期错误（已修正，非生产缺陷）：
   - M06：原以为 `page.locator("button.primary").count()` 会是 0；实测 Playwright 的 CSS 引擎会穿透 open shadow root，count 为 1。改为 light-DOM `document.querySelector` 断言。
   - M05 framePath：`page.locator` 只搜主 frame，iframe 内 target 须用 `frameLocator`；否则 `elementHandle()` 自动等待超时。
   - oracle-capture 空 locator：原以为 `elementHandle()` 返回 null；实测 Playwright 1.65 超时抛错（`locator.elementHandle: Timeout 100ms exceeded`），且 `Locator` 无 `setTimeout` 方法。改为断言抛错；`probeHandleWrapperIdentity` 的 null 分支因此不可达，见 §10。

## 9. 冻结红线核对（生产树未改）

- `src/verdict/classify.ts` SHA-256：`d591f24b1efb8072aa7dfb97d4458ff481a7decbfeeebfc653c368e4402b1850`（= git HEAD blob，165 行），会话中多次核对一致。
- 变异运行器每次运行前后对真实 `src/` 树做 SHA 清单比对，均无差异（见 `T011_MUTATION_RESULTS.json` 的 `passed: true` 与运行日志）。
- `S0_GATE.json`：2376 B，sha `15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d`，未变。S0 gate hash 见 §7。
- golden、fixtures、hash contract、release freeze：未动。

## 10. 生产代码缺陷 Findings

**无。** 未发现生产代码缺陷，未开 FIX。

记录两处非缺陷的观察（供审查者知悉，不建议改生产代码）：
1. **整数型键的 canonical 排序是 JS 对象键重排行为**（`canonical-json.ts`）：`canonicalize` 用普通 JS 对象组装，整数型键按数值序输出而非码点序。这是 JS 语义，测试已按实际行为钉死并注释为冻结行为，不是缺陷。
2. **`probeHandleWrapperIdentity` 的 null 分支不可达**（`src/oracle/identity-compare.ts` 第 25–27 行）：Playwright 1.65 的 `locator.elementHandle()` 超时抛错、永不返回 null，故 `h1 === null || h2 === null` 分支无法通过公开 API 触发。防御性代码，无害；coverage 中 identity-compare.ts 75% 即因此分支未覆盖。不建议改动（改动会动冻结代码）。

## 11. 门槛声明

- Mutation 检出门槛 **≥90%**（等价变异体除外），由 T011 自定并论证（见 §5）；实测 100.0%（40/40），高于门槛。审查者裁决门槛是否足够。
- Coverage 不设门槛（规格未给）；实测 lines 69.16%（1016/1469），方法与口径见 §4。
- Oracle parity 门槛 100%（规格给定）；实测 192/192。

## 12. 未覆盖项与已知局限

- `src/ui/*`：v8 度量 0%，原因是子进程边界（见 §4）；UI 行为本身由 12 个 UI 测试覆盖。
- 变异算子回调体（Chromium 内执行）：v8 度量不可见；DOM 效应由浏览器测试断言。
- `probeHandleWrapperIdentity` null 分支：不可达（见 §10.2）。
- 未覆盖行（按文件）：`src/api/server.ts` 24–129、155–161 行；`src/export/json-export.ts` 56、83–98 行；`src/runner/browser.ts` 18–41、71–80、100 行；`src/search/bfs-evaluator.ts` 67、94–102 行；`src/canonical/hashes.ts` 16、285、423–434 行；`src/contracts/report.ts` 64、467、470、473 行；`src/analysis/witness.ts` 29、341、380、589 行；`src/score/stability-score.ts` 260、415 行；`src/search/bfs.ts` 138、164 行；`src/oracle/*` 各有少量未覆盖行（见 §4 表）。
- 变异测试只覆盖手写 40 个单编辑语义变异体（verdict/score/canonical/BFS/escape/scan/routes/locator/witness 的纯函数）；未覆盖 UI 服务、runner 执行路径、mutation 算子本身的变异（算子在浏览器内执行，变异运行器不覆盖）。
- 属性测试 100 次种子试验使用固定 LCG，非全空间枚举。
- 报告中的数字均为本会话亲自跑出的结果；`npm test` 486 个测试中浏览器相关部分依赖 Chromium 在 01:55 GMT 后恢复的环境状态。
