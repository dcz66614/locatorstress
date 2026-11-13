# FIX-R2-02 — CLI Run Store 场景指纹 + ID 隔离（关闭 P1-02）

- 终审：P022 R2 = FAIL（0/2/28），本任务关闭 P1-02（裁决原文 `~/workspace/P022_R2_VERDICT.md` §四 P1-02；核实与 live 复现见 `~/workspace/p022-R2-verification-2026-11-12.md`）。
- 基线：HEAD `5316e54`（FIX-R2-01 已提交并独立复审 PASS 0/0/4）。本任务未改动 FIX-R2-01 的任何文件（`src/contracts/custom-scenario.ts`、`src/runner/browser.ts`、`src/ui/snapshot.ts`、`src/api/service.ts` 均未碰）。
- 状态：实现 + 回归测试 + 全部验收亲自跑完。**未提交**（主 Muse 亲自验收后统一提交）。未发消息给 GPT。未碰 28 个 P2。

## 1. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/cli/run-store.ts` | 新增 `scenario_sha256` 信封字段、`scenarioFingerprint()`、`RESERVED_RUN_IDS` / `isReservedRunId()`、`assertNoStoredReport()`；`parseRunEnvelope` 校验指纹格式（64-hex，否则 `INVALID_RUN`） |
| `src/cli/commands/input.ts` | `resolveRunInput` 在启动浏览器前拒绝保留 ID 的自定义 `scenario_id`（`RESERVED_RUN_ID`）；新增 `runIdForInput()`（与 service 同一套 runId 推导，供 analyze/search 预检） |
| `src/cli/commands/analyze.ts` | 启动浏览器前预检已存完整报告（`REPORT_OVERWRITE_REFUSED`）；保存时写 `scenario_sha256` |
| `src/cli/commands/search.ts` | 启动浏览器前预检已存完整报告；**仅当已存指纹与当前场景指纹一致时才保留旧 analysis**，否则丢弃并重存新 witness + 新指纹 |
| `scripts/verify-review-pack.mjs` | `KNOWN_FIX_DELTAS` 新增 4 条 FIX-R2-02 登记（4 个源码文件） |
| `tests/cli/cli.test.ts` | 新增 describe `CLI run-store identity (FIX-R2-02)`，7 个 CLI 层测试（+246 行） |
| `tests/cli/run-store.test.ts` | 新增，14 个 run-store 单元测试 |

## 2. 设计决策

- **指纹算法**：复用冻结 §6 的 `hashCanonical`（规范化 JSON 哈希，与 S0 门禁同一哈希原语），不对场景内容另起一套哈希。`scenarioFingerprint({kind, …})`：
  - fixture 场景：`{kind:"fixture", fixtureId}` —— fixture 内容冻结，id 即身份；
  - 自定义场景：`{kind:"custom", scenario}` —— 整个 scenario 文档（html + locator + target + suite + bfs + seed），键序无关、任何内容变化都改变指纹；**不用场景文件路径**，同一场景换路径仍匹配。
  - 运行选项（`--mutations`、`--max-depth`）**不属于身份**：它们只是同一场景的子集/界，与 fixture 场景已存 analysis 可被后续 search 保留的语义一致。
- **场景变化的语义：丢弃并重新分析，不报错**。`search` 读到已存 analysis 时，仅当 `existing.scenario_sha256 === 当前指纹` 才保留；指纹不匹配、或已存 run 无指纹（FIX 之前写的文件，即 legacy）时，旧 analysis 被丢弃，新 witness 与新指纹一起保存。选择丢弃而非报错：search 的本意就是对当前场景做一次新的 BFS，旧 analysis 属于另一个场景，报错会把一次合法的换场景搜索变成死路；丢弃后导出的 run 永远自洽（scenario + analysis + witness 同属一个场景）。
- **ID 隔离（两层）**：
  - 保留 ID：`demo`、`t008`、`F001`–`F024`（共 26 个），精确大小写匹配。自定义 `scenario_id` 撞上保留 ID 时，`resolveRunInput` 在启动浏览器**之前**就以 `RESERVED_RUN_ID` 拒绝（exit 1 + 明确错误信息，提示改 scenario_id），所以自定义 run 永远写不到 demo / T008 / fixture 的 run 文件上。
  - 完整报告保护：`assertNoStoredReport()`——任何已存 run 只要带 `report` 字段，analyze/search 在浏览器启动前就以 `REPORT_OVERWRITE_REFUSED` 拒绝。CLI 不提供 `--force`，拒绝是无条件的。demo 报告只能由 `demo` 命令重建。
  - 纵深防御：analyze/search 的预检与 input 层的拒绝是两道独立检查（input 层只覆盖自定义场景；预检覆盖所有 run id，包括 fixture id 与 demo 命令写出的 run）。
- **其余语义不变**：同场景重复 analyze 仍整体替换 run（witness 不跨分析保留）；无已存 analysis 的 search 仍保存 witness-only run；导出路径不变。

## 3. 回归测试

### CLI 层（`tests/cli/cli.test.ts`，新 describe，真实浏览器子进程）

1. `search with changed HTML drops the stale analysis (GPT P1-02 repro)` —— 同 scenario_id，先 analyze 场景 A（STABLE），再换 HTML 搜同一 id：新 witness 存下，旧 analysis 被丢弃，导出的 run 不再自相矛盾。
2. `search with changed locator drops the stale analysis` —— 同 id 换 locator，旧 analysis 被丢弃。
3. `search with the unchanged scenario keeps the analysis` —— 场景不变时 analysis 保留（正向控制：修复没有把“保留”逻辑一刀切掉）。
4. `analyze/search with scenario_id demo are refused; the demo report is untouched` —— `scenario_id "demo"` 的 analyze/search 均被拒绝，demo 报告文件内容不变。
5. `analyze with scenario_id F001 is refused before any browser work` —— 保留 ID 在浏览器启动前即拒绝。
6. `analyze/search refuse a stored complete report on a non-reserved id` —— 非保留 id 上已存完整报告时 analyze/search 均拒绝覆盖。
7. `fixture analyze/search keep the analysis under the fixture fingerprint` —— fixture F003 的 analyze/search 保留 analysis，且信封指纹等于 `hashCanonical({kind:"fixture", fixtureId:"F003"})`。

### run-store 单元层（`tests/cli/run-store.test.ts`，14 项，临时目录，不碰真实 runs/）

指纹：键序无关的确定性；HTML / locator / target / mutation suite 任一变化都改变指纹；fixture 与 custom 身份互不相同；fixture 指纹只依赖 fixture id。保留 ID：`demo`、`t008`、`F001`–`F024` 全保留，普通 id 不保留。信封：合法 `scenario_sha256` 往返通过；畸形指纹报 `INVALID_RUN`；无指纹的 legacy 信封仍可读（search 侧按“不匹配”处理，即丢弃旧 analysis）。`assertNoStoredReport`：有 report 时抛 `REPORT_OVERWRITE_REFUSED`，无已存 run / 无 report 时通过。

### 前后对比（亲自重跑，见 §4）

| | 修复前代码（src/cli 暂存 + 重建 dist） | 修复后代码（恢复 + 重建 dist） |
|---|---|---|
| 新 describe 7 项 CLI 测试 | **7 failed**（30 skipped），exit 1 | **7 passed**（30 skipped），exit 0 |

全套件：修复前 609 测试 → 修复后 **630 测试**（+14 单元 +7 CLI）。

## 4. 验收（全部亲自跑）

接受链第一次跑时被 VM/运行时重启打断：`npm test`、`test:mutation`、`s0:gate` 三段已完成并写入 `handoff/FIX-R2-02/ACCEPTANCE.log`（exec 会话 `proc_9039a49b6fa8` 的保存输出），`verify:all` 刚开始即中断，无结果记录。本次恢复后从已验证的检查点继续：**未重复已完成的三段**（结果见下），`verify:all` 与 `verify:review-pack` 重新完整跑出。

- `npm test`：**630/630 通过**（49 个文件），332.86s，exit 0。
- `npm run test:mutation`：**40/40 = 100.0%**（阈值 90%），Killed 40 / Survived 0，exit 0。
- `npm run s0:gate`：**GATE PASS**，`gate_sha256=651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52`（与冻结值逐字相同），重放 100/100、1 个 hash，exit 0。
- `npm run verify:all`：**PASSED — 9/9 步骤全绿**，492.7s，exit 0（恢复后重跑）。
- `npm run verify:review-pack`：**147/148 匹配，1 个已知问题**（恢复后重跑，证据已从 git 恢复后跑的）。4 个 FIX-R2-02 源码文件均被 `KNOWN_FIX_DELTAS` 接受为有意的 FIX 增量；唯一的问题是脚本自身的 hash（`scripts/verify-review-pack.mjs` not a known FIX delta）——与 FIX-R2-01 同款已知问题，脚本无法自我登记，**在 FIX-R2-03 重冻结时清掉**。
- 前后对比（本次恢复后亲自重跑）：见 §3 表格。预修复 7 failed / exit 1；修复后 7 passed / exit 0；`git stash pop` 后 `git diff --stat` 与修复前完全一致（6 文件，465 insertions，27 deletions）。

每次跑完均已 `git checkout -- evidence/` 恢复证据副产物（本次被改写的是 `evidence/s3/screenshots/matrix-F002.png` 与 `evidence/s4/T012_CUSTOM_E2E_REQUESTS.json`，已恢复；恢复后 `git status` 只剩 FIX-R2-02 本身的改动）。验收期间未与 s0:gate 并发跑其他验收命令。未做 GPT payload 复现之外的破坏性操作。

## 5. 已知例外与注意事项

- `verify:review-pack` 的 1 个问题（脚本自身 hash）如上，是已知、预期内的，留给 FIX-R2-03 重冻结。
- `runs/demo.json` **当前不存在**：它在 R2 核实复现的清理步骤中被主 Muse 删除（见核实报告），本次工作未重建它；保留 ID 测试用的是临时 run 与“拒绝写入”的断言，不依赖 demo.json 是否存在。FIX-R2-03 / R3 前如需 demo 报告，用 `npm run demo` 重建即可（重建后 analyze/search 仍受 `REPORT_OVERWRITE_REFUSED` 保护）。
- `runs/` 内现存 7 个文件均为 2026-11-11 的旧实验态（`P022-CLI-LIVE.*`、`P022-CLI-REVIEW.*`），本次测试未留下新 runs 文件（CLI 测试自带清理；单元测试用系统临时目录）。
- `/tmp` 在接受链开始时 89%（455M/512M），gate 按既定做法用了工作区内 `TMPDIR`；运行时重启后 `/tmp` 已清空（0%）。
- EPERM 存储抖动：本次未遇到写入失败；`git stash` / `stash pop` 各一次，均核对过 diff 完整。
- 28 个 P2 未动；FIX-R2-01 的 4 个新 P2（复审报告）未动，均留待 R3/后续处理。

## 6. 下一步（给主 Muse）

1. 亲自验收本 FIX（建议重跑 §4 链）后提交；
2. 派 fresh-session 复审员独立复审 FIX-R2-02（要求 PASS 0/0）；
3. FIX-R2-03：重冻结 + 独立复审 + 新 bundle + `handoff/P022-FINAL-R3/message.txt` 草稿；
4. 主 Muse 在同一立项对话发送 R3。
