# P022 LocatorStress — T014 正式冻结：协调员 PASS 记录

- 协调员：S5 阶段协调员（未写业务代码）
- 冻结对象 commit：`afcc2d1d6edf0cc45ce693bbd9839c42f4cf2aa1`（简称 afcc2d1）
- 结论：**T014 PASS**。冻结包完整、逐文件核验通过、独立审查 PASS（P0 0 / P1 0 / P2 4 非阻塞）。
- 本记录提交即为 T014 冻结提交；S5 的剩余工作是主控的 Drive 归档与 GPT 终审。

## 1. 冻结产物（协调员亲自逐项重算，与施工方、审查员三方一致）

| file | bytes | SHA-256 |
| --- | ---: | --- |
| `release/source.zip` | 1,278,357 | `2b355d37f47bca03fe50e5d0c08e91d79e7a87057e633745f9ba9b8dcbdfabfc` |
| `release/dist.zip` | 253,503 | `c3f083234be856f4fe6b23d3f1f22d5e286e695e418ae8f9f01713e06ec7d02c` |
| `release/RELEASE_MANIFEST.json` | 3,421 | `d4afdc54987519c2fa0ea2eea65d2b5e86cb81c330c83792c7c90184c04c2e38` |
| `release/SHA256SUMS.txt` | 240 | `b1e3ffb0a1b7d6dc090e5c03c05189f7e34c98afdf4d04454d0384b4958ca4cd` |
| `release/T014_FREEZE_REPORT.md` | 6,594 | `29280c185a47f763b93e163c109a2fb8356c36b338d2fd872639732dd04b4cd7` |

- `source.zip`：238 个文件，与新鲜 `git archive afcc2d1` 整个 zip 字节相同，238/238 逐字节一致，0 差异（审查员独立方法验证）。
- `dist.zip`：49 条目（44 个新鲜 `npm run build` 输出 + 5 份 release 文档），与新鲜构建逐字节比对 49/49 一致。
- `SHA256SUMS.txt`：3 项，不自指；`sha256sum -c` 3/3 OK。
- S0 冻结证据：`evidence/s0/S0_GATE.json` SHA-256 `15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d`；四项 S0 hash（scenario `1ffb5f85…`、oracle_result `3502d81f…`、analysis `4410d5c8…`、gate `651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52`）与 manifest 逐字段一致。
- 许可证：`PENDING_SAM_DECISION`，未添加 LICENSE 文件。

## 2. 协调员亲自重跑的验收命令（全部 exit 0）

- `npm run release:verify` — PASSED（6/6 步）
- `npm run release:compare-source` — PASSED（238/238 逐字节一致）
- `npm run release:verify-hashes` — PASSED（3/3）
- 三项命令在冻结后共跑过三轮（施工方、协调员第一轮、审查员、协调员重跑后），结果一致。

## 3. 协调员亲自重跑的完整回归（日志 `handoff/T014_REGRESSION.log`，随本提交入仓）

因 VM 重启 #68 清空 /tmp 日志、重启 #69 中断重跑，回归分三段完成，全部 exit 0：

- 第一轮（2026-11-11 08:53–09:18 GMT，/tmp 日志，重启前已逐行核对）：typecheck 0、typecheck:scripts 0、build 0、npm test 511/511、verify:all PASSED（9 步，370.5s）、verify:review-pack PASSED、完整 s0:gate GATE PASS（gate_sha256 不变）。
- 重跑（09:27:52 GMT 起，被 #69 于 09:44 中断于 s0:gate replay 30/100）：typecheck 0、typecheck:scripts 0、build 0、npm test 511/511、verify:all PASSED（9 步，356.1s，coverage lines 70.15%）、verify:review-pack PASSED。
- 补跑（#69 后，恢复 S0 半态证据后完整重跑 s0:gate）：GATE PASS，192/192、Oracle parity 192/192、replay 100/100、1 唯一 hash、gate_sha256 `651c3fd4…` 不变；跑后三项 release 验收重跑全部 PASSED。
- 每轮跑后证据均恢复为冻结 HEAD 值并逐项核对 SHA：S0_GATE.json `15b5c2d5…`、S0_GATE.log `56de50e1…`、S0_P2A.log `2a76dec1…`、S0_REPEAT_HASH.json `07cec67e…`、T011_MUTATION_RESULTS.json `98ff10ae…`、T012_PERF.json / T012_E2E_REQUESTS.json 均为冻结 HEAD 值；最终 `git status` 仅预期文件。

## 4. 独立审查（报告 `handoff/T014_REVIEW.md`）

- 审查员 fresh session，2026-11-11 09:20–09:45 GMT。
- **FINAL_VERDICT: PASS — P0 0 / P1 0 / P2 4（全部非阻塞）**。
- 审查员独立重算四项产物 SHA、独立比对 source.zip（与新鲜 git archive 整个 zip 字节相同）与 dist.zip（与新鲜构建 49/49），通读 5 个 release 脚本全文（FROZEN_COMMIT 四处写死常量，无 HEAD 逻辑），亲自跑 typecheck:scripts、build 与三项验收命令全部 exit 0。

## 5. P2 清单（登记在案，非阻塞；冻结后不解冻返工）

- **P2-1**：dist.zip 不可独立运行（无 package.json/node_modules；UI 静态文件与 fixture 依赖 src/），且无文档明说。§12 从未要求 dist.zip 独立可运行，source.zip 才是完整可运行产物。建议后续文档补一句话（README 注明 dist.zip 仅为构建输出 + 文档包，运行须用 source.zip + `npm ci`）。终审包中如实记录。
- **P2-2**：release:freeze 在 build 前不校验工作树 clean。本次 src/ clean，审查员新鲜构建逐字节复现 49 条目，无影响。
- **P2-3**：release:verify Check 6 不校验报告字节列；Check 4 不把 dist.zip 条目字节与磁盘 dist/ 比对。两项事实审查员已独立核实无误。
- **P2-4**：冻结报告验收章节手动补填、重跑 freeze 会重置回 PENDING。接受现状（报告不在 SHA256SUMS/manifest 内，补填未改变已哈希产物）。

## 6. 本次提交内容

- 新增：`scripts/release-freeze.mjs`、`scripts/release-verify.mjs`、`scripts/release-compare-source.mjs`、`scripts/release-verify-hashes.mjs`、`scripts/release-zip.mjs`；`release/source.zip`、`release/dist.zip`、`release/RELEASE_MANIFEST.json`、`release/SHA256SUMS.txt`、`release/T014_FREEZE_REPORT.md`；`handoff/T014_REVIEW.md`、`handoff/T014_REGRESSION.log`、本记录。
- 修改：`package.json`（仅加 4 条 release:* 脚本）、`handoff/S5_COORDINATOR_STATE.md`（协调员状态日志）。
- 未提交：`coverage/`（生成目录，永不提交）。src/、tests/、fixtures/、evidence/ 零改动。
- 未做：未 push（本地 git，无远程）、未上传 Drive（Drive 归档由主控在汇报后做，归档后须回读核对大小与 SHA）、未动 LICENSE。
