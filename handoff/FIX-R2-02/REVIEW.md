# FIX-R2-02 独立复审 — REVIEW

- **基线：** HEAD `a834eea`（FIX-R2-02：CLI Run Store 场景指纹 + ID 隔离，关闭 P1-02）
- **复审员：** 全新会话，此前未碰过这份代码；上一位复审员（ea80e196，08:38 派出）的日志停在 09:44、REVIEW.md 未落地，已判定停滞——本复审不采信其任何数字，全部亲自重跑
- **范围：** 只读产品代码与测试；只写本文件与 `REVIEW-ACCEPTANCE-4.log`；未改任何产品代码、测试或证据；复现文件事后全部清理，`runs/` 与 `evidence/` 恢复为复审前状态
- **接受日志：** `handoff/FIX-R2-02/REVIEW-ACCEPTANCE-4.log`（每步命令与结果逐条记录）

## FINAL_VERDICT: PASS

**P0 0 / P1 0 / P2 0（新增）。** P1-02 已关闭；无新缺陷。28 个 R2 P2 与 FIX-R2-01 的 4 个 P2 均未动（按范围留待 R3/后续处理）；`verify:review-pack` 的 1 个已知问题（校验脚本自身的哈希）为既有、预期内，留给 FIX-R2-03 重冻结时清除，不计为新 P2。

## 1. 接受链（全部亲自重跑）

| 检查 | 结果 |
|---|---|
| `npm run build`（tsc） | exit 0 |
| `npm test` | **630/630 通过**（49 个文件），359.70s，exit 0 |
| `npm run test:mutation` | **40/40 = 100.0%**（阈值 90%），Killed 40 / Survived 0，exit 0 |
| `npm run s0:gate` | **GATE PASS**，`gate_sha256=651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52`（与冻结值逐字相同），重放 100/100、1 个哈希，P2A PASS，exit 0（~956s） |
| `npm run verify:all` | **PASSED — 9/9 步骤全绿**（573.9s），exit 0 |
| `npm run verify:review-pack` | **恰好 1 个已知问题**：`scripts/verify-review-pack.mjs` 自身的哈希（not a known FIX delta）；4 个 FIX-R2-02 文件与 3 个 FIX-R2-01 文件均被接受为有意的 FIX 增量 |

每次跑完均 `git checkout -- evidence/` 恢复被测试改写的证据副产物（S0_P2A.log、matrix-F002.png、T012_PERF.json、T012_E2E_REQUESTS.json、T012_CUSTOM_E2E_REQUESTS.json），并核对冻结 SHA：S0_GATE.json `15b5c2d5b4f995ffa…`、T012_PERF.json `b1838d3ff1c0a20d…`、T012_E2E_REQUESTS.json `497de20a8405aadf…`、S0_P2A.log `2a76dec117c42ee2…` 全部 MATCH。未遇到 0 字节 EPERM 文件；验收测试与 gate 未并发跑；`/tmp` 全程充足（1%）。

## 2. GPT 的 P1-02 原样活体复现（全部通过）

场景格式与 R2 核实报告/测试套件一致（seed `P022-LOCATORSTRESS-S0-2026-11-10`）。指纹期望值用 `dist/canonical/canonical-json.js` 的 `hashCanonical` 独立算出并逐字比对。

**(a) 同 scenario_id、先 analyze 场景 A 再换 HTML 做 search（GPT 原复现）：**

- analyze A（两按钮 HTML，locator `button.primary`）：exit 0，baseline verdict **STABLE**；导出文件含 analysis；`scenario_sha256 = 7278bd73…` == `hashCanonical({kind:"custom", scenario:A})` 逐字相同。
- search B（同 id，单 secondary 按钮 HTML）：exit 0，witness 为 **depth-0 MISSING**（与 GPT 原复现的 witness 一致）；导出文件 keys 为 `runId,scenario,scenario_sha256,schema,witness`——**analysis 字段已不存在（旧分析丢弃）**；stored scenario == B；`scenario_sha256 = 5a2c1c66…` == `hashCanonical({kind:"custom", scenario:B})` 逐字相同。
- `export --run … --format json`：exit 0，413 bytes，witness-only run，自洽，无 analysis。
- → GPT 原缺陷（场景 B + 分析 A + witness B 的自相矛盾导出）已消除。

**(c) 同 ID 换 Locator：** analyze（`button.primary`）exit 0 → search（`button.secondary`，同 HTML）exit 0；导出文件无 analysis；witness status FOUND、verdict **WRONG_TARGET**；stored locator == 新 locator；指纹与新场景逐字相同。

**(b) scenario_id `"demo"`：** 先 `npm run demo` 重建 `runs/demo.json`（含 report，sha256 `e33d8d4c…`）；analyze 与 search 均 **exit 1，`RESERVED_RUN_ID`**（"demo"、"t008" 与 F001–F024 归 demo 命令与冻结 fixture 所有）；两次拒绝后 `demo.json` sha256 仍为 `e33d8d4c…`（字节未变）。

**第二道防线 `REPORT_OVERWRITE_REFUSED`（非保留 id 上已存完整报告）：** 预置含 report 的 run（sha256 `a0d13e77…`）；analyze 与 search 均 exit 1、`REPORT_OVERWRITE_REFUSED`；预置文件两次拒绝后 sha256 仍为 `a0d13e77…`（字节未变）。

**正向控制（同场景重搜保留分析）：** analyze 后用同一场景 search：analysis 保留（baseline STABLE），witness 存在，指纹匹配。修复没有把“保留”逻辑一刀切掉。

## 3. 代码审读（只读）

- `src/cli/run-store.ts`：指纹复用冻结 §6 的 `hashCanonical`（与 S0 门禁同一哈希原语）；fixture 身份 = fixture id（内容冻结），custom 身份 = 整个 scenario 文档（键序无关，任何内容变化都改变指纹；不用文件路径）；运行选项（`--mutations`/`--max-depth`）不属于身份，与 fixture 语义一致。`RESERVED_RUN_IDS` = demo、t008、F001–F024（26 个，精确大小写匹配）。`parseRunEnvelope` 校验指纹格式（非 64-hex 報 `INVALID_RUN`，fail-closed）。`assertNoStoredReport` 对含 report 的 run 无条件拒绝（CLI 无 `--force`）。
- `src/cli/commands/input.ts`：自定义 `scenario_id` 撞保留 ID 时在启动浏览器前以 `RESERVED_RUN_ID` 拒绝；`runIdForInput` 与 service 的 runId 推导一致（fixture id / 自定义 scenario_id / 缺省 `"custom"`）。
- `src/cli/commands/analyze.ts`：浏览器启动前预检已存完整报告；保存时写 `scenario_sha256`。
- `src/cli/commands/search.ts`：浏览器启动前预检已存完整报告；仅当已存指纹与当前场景指纹一致时保留旧 analysis，否则丢弃并重存新 witness + 新指纹；信封每次重打当前指纹。
- `scripts/verify-review-pack.mjs`：`KNOWN_FIX_DELTAS` 新增 4 条 FIX-R2-02 登记，与实际改动的 4 个源码文件一一对应；脚本自身哈希问题为自指涉（无法自我登记），与 FIX-R2-01 同款。
- 新增测试：`tests/cli/cli.test.ts` 的 `CLI run-store identity (FIX-R2-02)` describe（7 项，含 GPT 原复现、换 locator、正向控制、demo/F001 拒绝、完整报告拒绝、fixture 指纹）与 `tests/cli/run-store.test.ts`（14 项单元测试），均在 630 内通过；测试自带清理（afterAll 删除复现 run 与临时目录）。

以上设计与 GPT 在 R2 裁决中要求的修复一致：场景指纹 + 身份校验、丢弃过期分析、保留 ID、完整报告永不静默覆盖。

## 4. 结转项（非阻塞，不计入本轮 P2）

- `verify:review-pack` 的 1 个已知问题：`scripts/verify-review-pack.mjs` 自身哈希（脚本无法自我登记），FIX-R2-03 重冻结时清除。
- 28 个 R2 P2：未动，GPT 已明确无需在 R3 前清掉。
- FIX-R2-01 复审的 4 个 P2（P2-R2-01-1～4）：未动。

## 5. 收尾状态

- 未提交任何内容；HEAD 仍为 `a834eea`；工作树 tracked 无改动（仅 untracked：`coverage/`、`.tmp-gate-r2/`、既往 REVIEW-ACCEPTANCE*.log、`handoff/P022-FINAL-R2/`）。
- `runs/` 恢复为复审前状态（7 个 2026-11-11 旧文件，无 `demo.json`——复审为做 (b) 用 `npm run demo` 重建后又删除）；`evidence/` 全部恢复并核对冻结 SHA。
- 下一步（给主 Muse）：提交本复审文件后可派 FIX-R2-03（重冻结 + 独立复审 + 新 bundle + R3 消息草稿）。
