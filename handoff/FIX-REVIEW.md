# P022 LocatorStress — FIX 聚焦复审报告

- 审查员：fresh session 聚焦复审员（未参与实现与 FIX 施工）
- 审查对象：工作树 FIX diff，HEAD = `a78d765`（T013 审查对象 commit）
- 审查时间：2026-11-11 ~07:13–07:20 GMT
- 审查范围：`git diff HEAD` 全文（6 个修改文件）+ 5 个新增 release 文档全文 + 2 个新增 verify 脚本全文
- 方法：逐项读 diff 全文并对照 HEAD 证据文件 / T013 审查报告 / 源码实测依据逐一核对；亲自运行任务指定的 11 条命令并记录真实退出码（未跑 `test:performance`、`test:e2e`、`npm test` 全量、`s0:gate`、`verify:all`，按任务要求留给协调员）。

## FINAL_VERDICT: FAIL

- P0：0 项
- P1：2 项（均在 FIX-01）
- P2：2 项（FIX-04、FIX-06 各 1 项，均非阻塞）

FAIL 的原因：FIX-01 交付的两个新验收脚本在交付状态下不能成立——`npm run verify:review-pack` 在当前工作树直接退出 1（7 个问题，全部源于本轮 FIX 自身的合法改动）；`npm run verify:all` 的“排除 test:performance、不重写性能证据”设计宣称在效果上不成立（其 `test` 步骤仍会跑性能测试并重写证据）。其余 FIX（02+05、03、04、06）本身正确，附带的两个 P2 不阻塞。

## 各 FIX 复审结论

| FIX | 结论 | 依据摘要 |
|---|---|---|
| FIX-01（P2-01，verify 脚本） | **不通过** | P1-1：`verify:review-pack` 退出 1；P1-2：`verify:all` 的排除宣称不成立。见下。 |
| FIX-02+05（P2-02/P2-19，注释） | **通过** | 两处注释改动均为纯文本，与实测依据一致；无代码改动。 |
| FIX-03（P2-25，校验器 + 2 测试） | **通过** | 校验器改动精确等于“空序列当且仅当 depth==0 且 FOUND 时合法”；2 个新测试真实覆盖正反情形且已跑通；BFS、verdict 分类及其他校验规则未动。 |
| FIX-04（P2-18，T012 报告数字/SHA） | **通过（附 P2-1）** | 报告中全部改后 SHA 与数字逐一与 HEAD 证据文件相符；证据文件本身未被改动；新增说明段落基本准确，唯“三轮存根 P95 均在目标内”一句缺乏另两轮的记录值支撑（P2）。 |
| FIX-06（P2-20，release 五文档） | **通过（附 P2-2）** | 关键断言逐项核对属实（命令、哈希、许可证状态、依赖清单全量核对无误）；唯“509 个测试”在 6 处已过时，实为 511（P2）。 |

## FIX-01 逐项核对

### package.json diff

- 只有两行新增（`verify:review-pack`、`verify:all`），无其他改动。属实。
- `verify:review-pack` / `verify:all` 两个命令均真实存在且可运行。属实。

### verify-review-pack.mjs（三项检查的逻辑）

- 检查 1（18 个文件存在 + 非空）：逻辑正确；实测 18/18 通过。
- 检查 2（COVERAGE_MATRIX.csv 覆盖全部 src/、无重复路径、sha256 与磁盘一致）：逻辑正确；实测 155 行、磁盘 src/ 101 个文件、缺失 0。**它正确地发现了 3 处 sha256 不一致**——证明检查本身能发现不一致。
- 检查 3（sha256.txt 126 条逐一与磁盘比对）：逻辑正确；实测 126 条、126 已查、122 匹配。package.json 例外分支逻辑正确：`git show HEAD:package.json` 的哈希与 sha256.txt 冻结值一致时才接受（实测该分支生效，打印了 note）。
- **缺陷（P1-1）**：例外只覆盖了 package.json。本轮 FIX 自身合法改动的另外 4 个文件同样在 sha256.txt / COVERAGE_MATRIX.csv 的覆盖范围内，却没有任何例外：
  - `src/canonical/canonical-json.ts`（FIX-02 注释）
  - `src/contracts/report.ts`（FIX-03 校验器）
  - `src/ui/app.js`（FIX-05 注释）
  - `evidence/s4/T012_E2E_OFFLINE_PERF_REPORT.md`（FIX-04 报告）
  
  因此脚本在交付的工作树上必然失败。实测 `npm run verify:review-pack` 退出 **1**，7 个问题：
  - COVERAGE_MATRIX.csv sha256 mismatch × 3（上述 3 个 src 文件）
  - sha256.txt hash mismatch × 4（上述 3 个 src 文件 + T012 报告）
  
  脚本头注释称其意图是在 FIX 后工作树上运行（正因如此才为 package.json 写了例外分支），却只预见了自身的改动。且该失败在 FIX 提交后仍会持续：handoff/T013/ 为 untracked，sha256.txt 的冻结值不会随 FIX 提交而更新。修复建议：把同样的“HEAD 基线仍匹配冻结值即接受”例外模式扩展到上述 4 个已知 FIX 文件（或对冻结文件一律用 `git show HEAD:` 比对）。

### verify-all.mjs（步骤与退出码传递）

- 步骤列表共 10 步：typecheck、typecheck:scripts、build、test、test:oracle、test:e2e、test:offline、test:stress、test:coverage、test:mutation。确实**没有** `test:performance` 与 `s0:gate` 这两个脚本名。属实。
- 退出码传递正确：每步 `spawnSync("npm", ["run", step], { stdio: "inherit" })`，无管道；首个失败步骤即以该步退出码退出；全部通过才 exit 0。属实（代码审查；按任务要求**未实际运行** `verify:all`）。
- **缺陷（P1-2）**：头注释称“NOT run here, by design: test:performance — rewrites evidence/s4 performance evidence”。该宣称在效果上不成立：
  - `test` 脚本是 `vitest run --no-file-parallelism`（package.json），vitest.config 无 test exclude，默认收集全部 `tests/**/*.test.ts`。
  - 亲自跑 `npx vitest list`（只收集、不执行，exit 0）证实默认收集包含 `tests/e2e/performance.test.ts`（4 个测试，其中一个写 `evidence/s4/T012_PERF.json`，performance.test.ts:342 `writeFileSync`）与 `tests/e2e/e2e-main-flow.test.ts`（7 个测试，写 `evidence/s4/T012_E2E_REQUESTS.json`，e2e-main-flow.test.ts:356-357）。
  - 因此 `verify:all` 的 `test` 步骤本身就会重写性能/E2E 证据——正是 FIX-04 刚对齐的文件。只排除 `test:performance` 这个脚本名，并未排除性能测试。修复建议：把 `test` 步骤改为排除两个写证据的文件（例如 vitest `--exclude`），或删除“不重写证据”的宣称并注明运行后须重做 FIX-04。

## FIX-02+05 逐项核对（通过）

- diff 确认为纯注释改动：canonical-json.ts 只改头注释 + `canonicalize()` JSDoc；app.js 只改 `checkLocatorShape` JSDoc + 一处 guard 内联注释。无代码改动。
- 整数型键注释准确性：新注释称整数型键由 JS plain-object 枚举“始终提到前面、按数值升序（"2" 在 "10" 前），与排序后的插入顺序无关”。与冻结测试 `tests/canonical/canonical-boundaries.test.ts:60-70` 一致：`canonicalJson({ "10": 1, "2": 2, "1": 3 })` 期望 `'{"1":3,"2":2,"10":1}'`，注释称“frozen behaviour”。属实。
- FIX-T009 已修复注释准确性：新注释称“service.ts only returns `locator` when defined, and server.ts guards on headersSent”。亲自核对源码属实：`src/api/service.ts:345-356`（FIX-T009 注释 + `if (locator !== undefined) { result.locator = locator; }`）、`src/api/server.ts:124`（`if (res.headersSent)`）。“shape check 现为冗余纵深防御、保留以快速失败”的表述与现状一致。

## FIX-03 逐项核对（通过）

- 校验器改动位置：仅 `src/contracts/report.ts` 的 `status === "FOUND"` 分支内（约 373 行附近）。改动前：`if (!Array.isArray(seq) || seq.length === 0)` 报错；改动后三段式：
  1. 非数组 → 报错“must be an array”；
  2. `seq.length === 0 && witness["depth"] !== 0` → 报错“must be a non-empty array”；
  3. 否则 `witness["depth"] !== seq.length` → 报错 depth 必须等于序列长度（未变）。
  
  精确等于“空序列当且仅当 depth==0 且 FOUND 时合法”：空序列 + depth 0 → 通过第一、二分支落到第三分支，`0 !== 0` 为假，不报错；空序列 + depth≠0（含 depth 缺失/`undefined`，`undefined !== 0` 为真）→ 报错；非数组仍报错；depth 与长度一致检查未变。
- 与 BFS 约定一致：`src/search/bfs.ts:177-181` 注释 + `runBoundedBfs` 在根节点失败时返回 depth-0 见证（空序列）；`tests/search/bfs.test.ts:175` 有对应测试。改动后校验器不再与之矛盾。
- 未动其他规则：`git diff HEAD --stat` 显示改动文件只有 6 个，`src/search/`、`src/verdict/`、report.ts 其他校验分支均未动；depth 上限 0..6 检查、verdict 必须为失败四态等规则原文未变。
- 2 个新测试真实覆盖正反情形：
  - 正向：经 builder 诚实构造 FOUND + depth-0 + 空序列 + WRONG_TARGET 的报告，断言 `validateReportStructure(report)` 为 `[]`、导出 JSON 校验通过。亲自跑 `test:export:json`：json-export.test.ts 11/11 通过（含该测试；HEAD 版为 9 个）。
  - 反向：篡改报告使 sequence 为空而 depth 保持 1，断言校验失败且错误含 “witness.sequence must be a non-empty array”。亲自跑通。
- JSDoc 部分：canonicalize() 与 checkLocatorShape 的注释改动为纯文本，与 FIX-02+05 的核对结论相同。

## FIX-04 逐项核对（通过，附 P2-1）

- SHA 表：新 SHA `b1838d3f…57e589`（T012_PERF.json）与 `497de20a…06197`（T012_E2E_REQUESTS.json）亲自用 `git show HEAD:<文件> | sha256sum` 核对，与 HEAD 提交文件逐字节相符；磁盘现值亦相同。旧 SHA（`70d942ff…` / `2e8e747e…`）确为初稿值，已替换。
- 全部改后数字逐一与 HEAD `T012_PERF.json` 相符（亲自读 JSON 全文核对）：
  - Chromium 首次启动 883 ms（`chromiumFirstLaunchMs: 883`）
  - 矩阵 3 样本 6760 / 5885 / 5658 ms，P95 6760 ms；per-fixture P95 703 ms；per-case P95 101 ms、均值 31.73 ms；最慢 fixture F021（1157 / 1100 / 1202 ms）
  - BFS 存根 5 样本 9 / 12 / 7 / 9 / 15 ms，P95 15 ms
  - 真实浏览器 BFS 122,507 ms，六项计数 3761 / 1024 / 2123 / 1638 / 0 / 6
  - RSS 峰值 217.6 MiB
  - “6.8–7.9 s 区间”修正正确（三轮 P95 6760 / 6934 / 7914 ms；旧文“6.1–7.9 s”有误）
  - §5.4 / §6 / §7 / ADR / §10 中 216.4→217.6、14→15、133,801→122,507、6832→6760 等全部引用处已同步改动，无遗漏（diff 全文核对）
- E2E 请求数：HEAD `T012_E2E_REQUESTS.json` 为 `totalRequests 29`、`externalRequests 0`、`urls` 29 条，与报告“29 个请求，外部 0”相符。
- 新增说明段落准确：称初稿数字为初稿运行实测值、称 HEAD 文件为冻结前最后一次全量运行、称“此后任何一次运行都会产生新的耗时/RSS 数字与新的文件 SHA”、称“§5.2–§5.4 交叉核对数字为另外两轮历史实测值”——与报告正文（6934 / 7914、945 / 813、127,149 / 130,853、223.1 / 219.8 均仍为未改动的原文）一致；“以证据文件为准”的裁决明确。
- 证据文件本身未被改动：`git diff HEAD -- evidence/` 除本报告文件外为空；`git status` 中 evidence/ 只有本报告为 M；T012_PERF.json 与 T012_E2E_REQUESTS.json 的磁盘 SHA 与 HEAD 一致。
- P2-1（FIX-04 附带）：新增段落称“三轮运行的数字均在目标内（矩阵 P95 ≤ 60,000 ms、per-fixture P95 ≤ 2,000 ms、**存根 P95 ≤ 5,000 ms**、RSS ≤ 512 MiB）”。其中另两轮的矩阵 P95（6934 / 7914）、per-fixture P95（945 / 813）、RSS（223.1 / 219.8）均有记录在案；但另两轮的**存根 BFS P95 值在报告与证据中均无记录**，该枚举中的存根一项缺乏出处。影响极小（存根 P95 实测约 14–15 ms，目标 5,000 ms，裕量 300 倍以上），建议改为只列有记录的三项，或补记另两轮存根 P95 值。

## FIX-06 逐项核对（通过，附 P2-2）

抽查方法：5 份文档全文通读；命令逐一对照 package.json；哈希逐一对照冻结证据；依赖清单用脚本全量比对 lockfile + node_modules。

- 命令真实存在（package.json 核对，全部存在）：`npm ci`、`npm run build`、`npm run s0:gate`、`npm test`、`test:verdict`、`test:score`、`test:bfs`、`test:canonical`、`test:export`、`test:ui`、`test:e2e`、`test:offline`、`test:performance`、`test:stress`、`report:t008`、`verify:review-pack`、`verify:all`（后两者为 FIX-01 新增；HOW_TO_REPRODUCE §6 的 source.zip / SHA256SUMS 步骤已明确标注“由 T014 在冻结 commit 后执行”“在 T014 完成之前均不存在”，未虚构已完成状态）。
- 哈希与冻结值一致（逐一对照 `evidence/s0/S0_GATE.json` 原文与磁盘 SHA）：
  - gate_sha256 `651c3fd4…a62c52`、scenario `1ffb5f85…c9f22`、oracle_result `3502d81f…a988`、analysis `4410d5c8…76a4`，全部相符
  - S0_GATE.json SHA-256 `15b5c2d5…3572d`，与磁盘及 HEAD 一致
  - seed `P022-LOCATORSTRESS-S0-2026-11-10` 相符
- 门禁数字与 S0_GATE.json 一致：GATE PASS、192/192、Oracle parity 192/192、分数 71.875（138/192）、verdict 分布 STABLE 138 / WRONG_TARGET 22 / AMBIGUOUS 17 / MISSING 15、按 kind 分布 css 46/9/5/4、xpath 42/9/5/8、role 50/4/7/3、对照组误报 0/96、检出 96/96、外部请求 0、重放 100 次 1 个 hash、Chromium 158.0.8127.18（`scripts/s0-gate.ts:49`  pin 值一致）。
- Fixture 示例与 oracle-manifests 一致：F001 css `button[type="submit"]` 稳定；F002 xpath `/html/body/main/form/button[1]` 脆弱；F003 role button / Submit form / exact 稳定；F005 xpath `//button[@type='submit']` 稳定；F009 role link / Dashboard 脆弱；带 framePath 的页面确为 F019、F020、F021。
- BFS/报告断言与 T008 报告及脚本一致：F001 depth 2 BOUNDED_NO_WITNESS、F002 depth 1 FOUND [M01] WRONG_TARGET、F003 depth 1 FOUND [M04] AMBIGUOUS（`evidence/s2/T008_API_REPORT.json` witnesses 原文）；F001 depth-6 缩减预算（maxExpandedStates 8）BOUNDED_INCOMPLETE 演示见 `scripts/t008-api-report.ts:159-163,182`（有意不计入 witnesses，见 notes）；“深度 6 见证需 8801 次展开”= 1+8+56+336+1680+6720，算术正确；NOT_IMPLEMENTED_S0 占位符见 S0_GATE.json notes 原文。
- UI/API 断言属实：6 个页签（`src/ui/index.html` 6 个 tabpanel / 6 个 role="tab"）；`node dist/ui/server.js [--port N]` 与 `UI_URL=` 打印见 `src/ui/server.ts:27-28,519-544`；1 MiB 请求体上限见 `src/api/server.ts:12`；`operatorOrder` / `allowRepeat` 被 API 拒绝见 `src/api/routes.ts:23-24,112-114`；M05 为单层 srcdoc iframe 见 `src/mutations/M05-nested-iframe.ts:1`。
- LICENSE_STATUS.md 未声称任何许可证：明确 PENDING_SAM_DECISION、仓库无 LICENSE 文件（亲自核对：根目录无 LICENSE 文件）、package.json 无 license 字段（`node -e` 核对为 undefined）。属实。
- Windows 未测试 / 无真实设备兼容认证：README、USER_GUIDE、HOW_TO_REPRODUCE 多处明确“Windows 未测试”“macOS 未测试”“这是合成数据实验室，不是真实设备兼容认证”。属实，无相反声称。
- THIRD_PARTY_NOTICES.md 全量核对无误（脚本比对）：
  - lockfile `packages` 共 76 条，根项目 1 条，依赖包 **75 个**，与清单 75 行一一对应、无遗漏无重复；许可证分布 MIT 56 / Apache-2.0 5 / MPL-2.0 12 / ISC 1 / BSD-3-Clause 1，与清单一致；无缺失 license 字段的包
  - 75 行的版本与许可证与 lockfile **零不一致**
  - 已安装 52 个包的 license 与 node_modules/package.json **零不一致**；未安装 23 个均正确标注为 lockfile 来源（rolldown / lightningcss 非 linux-x64 目标 + fsevents）
  - 无 LICENSE 文件的 4 个已安装包（`@rolldown/binding-linux-x64-gnu`、`@rolldown/binding-linux-x64-musl`、`std-env`、`tinyrainbow`）与清单所列完全一致
  - 直接依赖 4 个（playwright 1.65.0、typescript 5.9.3、vitest 5.1.0、@vitest/coverage-v8 ^5.1.0→5.1.0）与 package.json 一致
- 未发现虚构功能：文档所述能力均有源码/测试对应；未声称不存在的功能。
- P2-2（FIX-06 附带）：“509 个测试”在 6 处已过时——README 2 处（快速开始注释、`tests/` 布局行）、USER_GUIDE §3 1 处、HOW_TO_REPRODUCE §4 2 处（标题与正文）及 §8 清单 1 处。HEAD 全量为 509（S4/T013 记录），FIX-03 新增 2 个测试（json-export.test.ts 亲自计数：HEAD 9 个 → 现 11 个，且 11 个已跑通），现全量应为 **511**。其余计数（test:e2e 7/7、test:offline 6/6、test:performance 4/4、test:stress 6/6、mutation 40/40、覆盖率 70.03%）未受 FIX 影响，仍有效。

## 亲自跑的命令与退出码

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run typecheck` | 0 | 通过 |
| `npm run typecheck:scripts` | 0 | 通过 |
| `npm run build` | 0 | 通过 |
| `npm run verify:review-pack` | **1** | **FAILED（7 个问题，见 P1-1）** |
| `npm run test:canonical` | 0 | 36/36 通过 |
| `npm run test:ui` | 0 | 12/12 通过 |
| `npm run test:export` | 0 | 11/11 通过 |
| `npm run test:api` | 0 | 65/65 通过 |
| `npm run test:export:json` | 0 | 44/44 通过（其中 json-export.test.ts 11/11，含 2 个新测试） |
| `npm run test:witness` | 0 | 27/27 通过 |
| `npm run test:bfs` | 0 | 51/51 通过 |

未跑（按任务要求，留给协调员）：`test:performance`、`test:e2e`、`npm test` 全量、`s0:gate`、`verify:all`。另用 `npx vitest list`（只收集、不执行，exit 0）证实默认 `vitest run` 收集 performance.test.ts 与 e2e-main-flow.test.ts（P1-2 的依据）。

跑完后核对：`git status` 与开工时一致（6 个修改文件 + 既有 untracked 项，无新增改动）；证据文件 SHA 未变——T012_PERF.json `b1838d3f…57e589`、T012_E2E_REQUESTS.json `497de20a…06197`、S0_GATE.json `15b5c2d5…3572d`，均与 HEAD 一致，**无需** `git checkout -- evidence/` 恢复。

## P0 / P1 / P2 清单

### P1（2 项，均在 FIX-01；任一成立即 FAIL）

- **FIX01-P1-1**：`verify:review-pack` 在交付的工作树上退出 1（7 个问题）。脚本只为 package.json 写了 HEAD 基线例外，未覆盖本轮 FIX 合法改动的 canonical-json.ts、report.ts、app.js、T012_E2E_OFFLINE_PERF_REPORT.md。T013 任务卡 §5 的验收命令 `npm run verify:review-pack && npm run verify:all` 因此无法通过；且因 handoff/T013/ 为 untracked，提交 FIX 后仍会失败。修复：把同样的 HEAD 基线例外扩展到 4 个已知 FIX 文件。
- **FIX01-P1-2**：`verify:all` 的“排除 test:performance、不重写性能证据”设计宣称在效果上不成立。其 `test` 步骤为全量 `vitest run`，默认收集并运行 performance.test.ts（写 T012_PERF.json）与 e2e-main-flow.test.ts（写 T012_E2E_REQUESTS.json），即会重写 FIX-04 刚对齐的证据、重新制造 P2-18 式的不一致。修复：`test` 步骤排除两个写证据的文件，或删除该宣称并注明运行后须重做 FIX-04。

### P2（2 项，均非阻塞）

- **FIX04-P2-1**：FIX-04 新增说明段落中“三轮运行的数字均在目标内”枚举含“存根 P95 ≤ 5,000 ms”，但另两轮的存根 P95 值在报告与证据中无记录。建议只列有记录的三项或补记数值。
- **FIX06-P2-2**：release 三份文档 6 处“509 个测试”已过时，现全量为 511（FIX-03 新增 2 个测试）。建议全局改为 511（以协调员全量重跑为准）。

### P0

无。

## 给协调员的后续提醒（非 P 项）

1. FIX-01 的两处 P1 修复量小但必须在提交 FIX 之前完成，否则 T013 验收命令无法成立；修完后须重跑 `npm run verify:review-pack`（应为 exit 0）并复核 `verify:all` 的步骤定义。
2. 任何一次全量 `npm test`（含协调员计划的全量重跑）都会重写 T012_PERF.json 与 T012_E2E_REQUESTS.json——FIX-04 的报告数字与 SHA 表将再次与新证据文件不一致。这是按设计的行为（FIX-04 说明段落已声明“以证据文件为准”），但在 T014 冻结前须决定顺序：最后一次全量运行后重做一次 FIX-04 式对齐，或冻结时以证据文件为准、不再重跑性能测试。
3. 本复审未改任何已有文件，未 commit，未碰 Copilot 桥、GitHub、Drive，未对外发消息。唯一新文件为本报告。

## 产出

- `handoff/FIX-REVIEW.md`（本文件）
