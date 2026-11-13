# P022 LocatorStress — S5 亲自验证记录（T013 + FIX 轮；T014 尚未进行）

- 验证者：Muse（主控），亲自重跑全部验收命令
- 验证时间：2026-11-11 ~08:11–08:33 GMT
- 基线：S4 PASS commit `a78d765`；T013 审查对象即该 commit
- 结论：**T013 独立审查 + FIX 轮全部验证通过**。S5 的剩余部分是 T014 正式冻结，待派发；S5 PASS 待 T014 验证后宣告。

## 1. T013 独立审查（审查员 fresh session，~06:10–06:40 GMT）

- 报告：`handoff/T013/INDEPENDENT_REVIEW.md`（24,507 B）
- **FINAL_VERDICT: PASS — P0 0 / P1 0 / P2 25（全部非阻塞，登记在 `unresolved_items.md`）**
- 审查员通读 `src/` 全部 101 个文件（7,906 行），亲自重跑 typecheck、typecheck:scripts、build、npm test 509/509、test:oracle、test:e2e 7/7、test:offline 6/6、test:stress 6/6、完整 s0:gate GATE PASS；用自写 Python canonicaliser 独立重算四个 hash，全部与冻结值一致。
- 未跑 test:performance（按任务要求，性能结论以 S4 已验证数字为准）。

## 2. FIX 轮

### FIX 聚焦复审第一轮（~07:13–07:20 GMT）：FINAL_VERDICT: FAIL — P0 0 / P1 2 / P2 2

- 报告：`handoff/FIX-REVIEW.md`
- P1-1：`verify:review-pack` 在交付工作树上退出 1（7 个问题，源于本轮 FIX 自身的合法改动，只给 package.json 写了例外）。
- P1-2：`verify:all` 的“排除 test:performance、不重写性能证据”宣称不成立（其 `test` 步骤仍会跑到性能测试并重写证据）。
- FIX-02+05、FIX-03 通过；FIX-04、FIX-06 通过各附 1 个非阻塞 P2。

### FIX-01 / P2 返工与协调员核实（~07:34–07:40 GMT）

- P2 修复核实通过：4 个文件 SHA/大小逐字节一致；511 计数三条路线收敛（vitest list 452 + 循环生成用例 59 = 511；json-export.test.ts `it(` 11 处，HEAD 9 + 2；T013 日志求和 509 + 2 = 511）。
- P1 修复核实通过：verify:review-pack 例外表 5 文件 + 冻结基线显式改为 commit a78d765 完整 SHA；verify-all STEPS 10→9（去掉 test:e2e），test 与 test:coverage 步骤加 `--exclude`；亲自跑 verify:review-pack exit 0。
- 新发现并裁决：test:mutation 会重写已冻结的 `evidence/s4/T011_MUTATION_RESULTS.json`（runner 把非确定性的 per-mutant durationMs 写进 payload）。裁决：runner 改为确定性输出（payload 去掉 durationMs，控制台日志保留），重跑一次重新生成，剥离 durationMs 后与冻结文件 diff 必须为空。

### 变异确定性修复核实通过（~07:45 GMT）

- runner diff 恰为 2 插 3 删；新文件与冻结值剥离 durationMs 后完全相等；两边均为 40 条结果、mutationScore 1、passed true；新文件全文 grep durationMs = 0。
- verify:review-pack exit 0 PASSED（note 10 条——runner 本身在 sha256.txt 第 129 行被冻结，改它必须进例外表）。

### FIX 聚焦复审第二轮（~07:49 GMT）：FINAL_VERDICT: PASS — P0 0 / P1 0 / P2 0

- 报告：`handoff/FIX-REVIEW-R2.md`（19,715 B，SHA-256 `2569e59a…`，已核对）
- 第一轮的两个 P1 与两个 P2 均已修复并经本轮亲自验证通过；变异确定性修复亦验证通过；本轮未发现新的 P0/P1/P2。
- 复审员亲自跑的命令（全部 exit 0）：typecheck、typecheck:scripts、build、verify:review-pack、test:canonical 36/36、test:ui 12/12、test:export 11/11、test:api 65/65、test:export:json 44/44、test:witness 27/27、test:bfs 51/51、test:mutation 40/40=100%（重跑生成 SHA 仍为 `98ff10ae…`）。
- 关键核对：例外表实为 7 条，恰覆盖 sha256.txt 范围内的全部 7 个改动文件；基线为 a78d765 完整 SHA，脚本中无 `HEAD:` 引用；511 经两条独立路线确认；跑完后证据 SHA 均与冻结值一致。

## 3. 协调员全量重跑第一阶段（~08:04 完成，日志 /tmp/s5-stage1.log）

本人核对日志确认，11 条命令全部 exit 0：

- typecheck、typecheck:scripts、build、npm test、test:oracle、test:e2e 7/7、test:offline 6/6、test:stress 6/6、test:performance 4/4、test:coverage、test:mutation
- npm test 511/511；coverage lines 70.15%（S4 为 70.03%，FIX-03 新增 2 测试所致）；mutation 40/40=100%
- 证据已恢复为冻结值（RESTORE_EXIT=0）。

## 4. 本人第二阶段亲自重跑（日志 /tmp/s5-stage2-muse.log，547 行）

- `npm run verify:all`：**PASSED — 9 步全绿，363.8s，EXIT=0**。其中 test 步骤 500/500（37 文件）：按 P1 修复，test 与 test:coverage 步骤 `--exclude` 两个非确定性证据重写文件（performance.test.ts 4 测试 + e2e-main-flow.test.ts 7 测试），511 − 11 = 500；完整 511 已在第一阶段 npm test / test:coverage 中验证。
- `npm run verify:review-pack`：**PASSED，EXIT=0**。
- `npm run s0:gate`（完整）：**GATE PASS，gate_sha256 `651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52` 不变，REPEAT_HASH unique_gate_hashes=1，EXIT=0**。
- 证据核对（跑完后 + 恢复后均一致）：
  - `evidence/s0/S0_GATE.json` SHA-256 `15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d`（冻结值）
  - `evidence/s4/T011_MUTATION_RESULTS.json` SHA-256 `98ff10ae6d31ca54f0ed2bb71443d60f708c6022a673ff525c648b23eb0ce5d8`（新的确定性值）
  - `evidence/s4/T012_PERF.json` / `T012_E2E_REQUESTS.json` 已恢复为冻结 HEAD 值（RESTORE_EXIT=0）
  - `evidence/s0/S0_P2A.log` 已恢复为 HEAD 值

## 5. 本次提交的改动（相对 a78d765）

修改 8 个文件：`package.json`、`scripts/t011-mutation-runner.mjs`、`src/canonical/canonical-json.ts`、`src/contracts/report.ts`、`src/ui/app.js`、`tests/export/json-export.test.ts`、`evidence/s4/T011_MUTATION_RESULTS.json`、`evidence/s4/T012_E2E_OFFLINE_PERF_REPORT.md`。

新增：`scripts/verify-all.mjs`、`scripts/verify-review-pack.mjs`、`release/`（5 个文档，FIX-06）、`handoff/T013/`（审查报告 + 10 个 REVIEW_PACK + COVERAGE_MATRIX + sha256.txt + TASK_REPORT + unresolved_items）、`handoff/FIX-REVIEW.md`、`handoff/FIX-REVIEW-R2.md`、`handoff/S5_COORDINATOR_STATE.md`、本记录。

未提交：`coverage/`（生成目录，永不提交）。生产代码 `src/` 除上述 3 个文件（2 处纯注释 + 1 处校验器精确改动）外零改动；S0 门禁证据完好。

## 6. 下一步

- 派发 T014（正式冻结、发布包与逐文件核验）。注意 P021 教训：`release:freeze` 不可重复运行——跑后若重跑会重写 release/，须用 `git checkout -- release/` 恢复并重新核对哈希。
- T014 冻结后：归档 `04_release` 到 Drive，准备 GPT 终审包（GPT-6 + Extra High，立项对话，消息末尾加 Drive 插件尾巴），交付需 FINAL_VERDICT: PASS。
- P022 license 仍为 PENDING_SAM_DECISION——Sam 决定前不公开、不上传 GitHub。

---

## 7. T014 正式冻结 — 亲自验证通过（2026-11-11 ~10:01–10:40 GMT）

- 协调员汇报：T014 PASS，冻结 commit `3fc5dbb`（完整 SHA `3fc5dbb56fcfc777990ce019deea22654f2a8455`），冻结对象 afcc2d1；独立审查 FINAL_VERDICT: PASS（P0 0 / P1 0 / P2 4，全部非阻塞，见 `handoff/T014_REVIEW.md`）。
- 冻结产物（本人逐项核对大小 + SHA，与协调员表完全一致）：
  - `release/source.zip` 1,278,357 B，SHA-256 `2b355d37f47bca03fe50e5d0c08e91d79e7a87057e633745f9ba9b8dcbdfabfc`
  - `release/dist.zip` 253,503 B，SHA-256 `c3f083234be856f4fe6b23d3f1f22d5e286e695e418ae8f9f01713e06ec7d02c`
  - `release/RELEASE_MANIFEST.json` 3,421 B，SHA-256 `d4afdc54987519c2fa0ea2eea65d2b5e86cb81c330c83792c7c90184c04c2e38`
  - `release/SHA256SUMS.txt` 240 B，SHA-256 `b1e3ffb0a1b7d6dc090e5c03c05189f7e34c98afdf4d04454d0384b4958ca4cd`
  - `release/T014_FREEZE_REPORT.md` 6,594 B，SHA-256 `29280c185a47f763b93e163c109a2fb8356c36b338d2fd872639732dd04b4cd7`
- 本人亲自重跑（日志 /tmp/s5-t014-muse-verify.log，全部 exit 0）：
  - `npm run release:verify` PASSED
  - `npm run release:compare-source` PASSED — 238/238 文件逐字节一致，0 路径差异，0 字节差异
  - `npm run release:verify-hashes` PASSED
  - 完整 `npm run s0:gate` GATE PASS，gate_sha256 `651c3fd4…` 不变，重放 100/100，1 唯一 hash
  - 跑后 S0_P2A.log 已恢复（RESTORE_EXIT=0）；工作树干净（仅未入仓的 `coverage/`）
- 协调员全量回归（日志 `handoff/T014_REGRESSION.log`，57,427 B，已入仓）：因 VM 重启 #68/#69 分三段完成，全部 exit 0（npm test 511/511、verify:all PASSED、verify:review-pack PASSED、完整 s0:gate GATE PASS、release 三项验收 PASSED）。
- 协调员注记：MEMORY.md 里“回归运行随 #68 中断、须重跑”一处不准确——第一轮回归实际已于 09:18:35 GMT 完成，重启清空的只是 /tmp 日志文件；已重跑并补跑完整回归，证据链完整。此处以协调员的纠正为准。
- T014 接受的 4 个非阻塞 P2（登记在案，终审包中如实记录）：P2-1 dist.zip 不可独立运行且无文档明说；P2-2 release:freeze 不校验工作树 clean；P2-3 release:verify Check 6 不校验报告字节列、Check 4 不比对 dist.zip 条目字节（审查员已独立核实）；P2-4 冻结报告验收章节手动补填、重跑 freeze 会重置回 PENDING。

## 8. S5 PASS 结论

**S5 = PASS。** T013 独立审查 PASS（0/0/25）+ FIX 轮复审 PASS（0/0/0）+ T014 正式冻结 PASS（0/0/4，全部非阻塞），全部经 Muse 亲自重跑验证。冻结 commit `3fc5dbb`，冻结对象 afcc2d1。下一步：归档 `04_release` 到 Drive，送 GPT 终审（GPT-6 + Extra High，立项对话，消息末尾加 Drive 插件尾巴；交付需 FINAL_VERDICT: PASS；license PENDING_SAM_DECISION）。
