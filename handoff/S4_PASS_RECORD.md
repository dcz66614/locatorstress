# P022 S4: PASS 记录（协调员）

时间：2026-11-11 ~05:30 GMT。S4（T011–T012）全部通过并提交，S0 冻结全程未变。
S4 通过只解除 S4 技术阻断，不自动授权 S5；T013–T014 仍锁定，待 Muse 亲自复核后才算 S4 PASS。

## T011 全量单元、属性、Mutation 与 Oracle Parity — 提交 `35366d3`
- 施工方：npm test 486/486（35 文件）；test:coverage 486/486，lines 69.16%（1016/1469）；test:mutation 40/40 = 100.0%（门槛 90% 自定）；test:oracle exit 0；Oracle parity 192/192 三方一致。
- 独立审查：FINAL_VERDICT: PASS，P0 0 / P1 0 / P2 2（P2-1：既存 P2A detach 测试间歇竞态；P2-2：canonical-json.ts:14 注释表述不精确；均非阻塞）。
- 协调员本人重跑：npm test 486/486、test:coverage 486/486（lines 69.16%）、test:mutation 40/40 = 100.0%、test:oracle exit 0，全部 exit 0。
- s0:gate：施工方完整跑 PASS；审查者完整跑 PASS（约 15.2 分钟）。协调员本人三次尝试均被 VM 存储 EPERM 中断（重放 20/100 同 hash 后 EPERM；P2A 阶段进程丢失；npm 启动即 EPERM），后用 muse.write 按 od -c 逐字节恢复 S0 证据并 SHA 核对（S0_GATE.json 15b5c2d5…、S0_GATE.log 56de50e1…、S0_P2A.log 2a76dec1…、S0_REPEAT_HASH.json 07cec67e…，全部与 HEAD blob 一致）。EPERM 不是产品缺陷。
- 提交方式：因 git commit 无法写 .git/index.lock，改用 mktree + commit-tree + update-ref 绕过 index 提交，提交后 git read-tree 重建 index，工作树干净。

## T012 浏览器 E2E、离线、性能与压力 — 提交 `5f075f3`
- 施工方：test:e2e 7/7、test:offline 6/6、test:performance 4/4、test:stress 6/6、build exit 0；npm test 509/509（39 文件）。P95：192 总耗时 6832 ms、单 fixture 848 ms、BFS 存根 14 ms、Node RSS 216.4 MiB（目标全部通过）；真实浏览器 BFS F001 133,801 ms BOUNDED_NO_WITNESS，ADR-T012-1 已写；外部请求 0；键盘路径可用；24×8 矩阵 192/192；P2-1 加固完成。
- 独立审查：FINAL_VERDICT: PASS，P0 0 / P1 0 / P2 0。五条验收命令 + 全量回归全部重跑通过；性能重跑 P95 7219 ms、BFS 存根 20 ms、真实 BFS 120,892 ms（计数逐数相同）；ADR-T012-1 裁决成立；P2-1 加固 4/4 通过；s0:gate 完整 PASS（04:42–04:57 GMT），无 EPERM。
- 协调员本人重跑：build 0；test:e2e 7/7；test:offline 6/6；test:stress 6/6；test:performance 4/4（我方 P95：192 总耗时 7206 ms、单 fixture 798 ms、BFS 存根 29 ms、真实 BFS 126,903 ms BOUNDED_NO_WITNESS 计数 3761/1024/2123/1638/0/6、RSS 220 MiB）；npm test 509/509（39 文件）；完整 s0:gate GATE PASS（100/100 重放 1 hash）。
- 提交：plain git commit 一次成功（EPERM 已缓解）。

## S0 冻结核对（协调员本人，T012 后完整 gate）
- s0:gate：GATE PASS，gate_sha256 `651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52` 不变，重放 100 次 1 个唯一 hash；S0_GATE.json 2376 B sha `15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d` 与冻结值一致；S0_P2A.log 跑完后 git checkout 恢复。
- src/ 生产源码在 T011/T012 均零改动；golden、fixtures、hash contract 未动。

## 提交记录（git log）
- `35366d3` T011（21 文件，7619 插入 / 1 删除）
- `5f075f3` T012（10 文件，1752 插入 / 4 删除）
- 本记录 + 更新后的 handoff/S4_COORDINATOR_STATE.md 随 S4 PASS 记录提交。工作树干净。

## 诚实记录的偏差与未解决项
- T011 协调员完整 gate 因 EPERM 未跑完（见上；施工方与审查者各完整跑 PASS 一次为依据）。
- T011 P2-1（P2A 间歇竞态）：T012 已加固（扫窗 30–120 ms、5 pass），审查者观测 4/4 通过；竞态本质上无法用采样证明根除，后续全量继续观察。
- T011 P2-2（canonical 注释表述）：未改，建议 T013 时在注释或 PROJECT_BOOK 中加一句限定。
- ADR-T012-1（BFS 5 s 目标仅考核算法本身）：审查者裁决成立；建议 T013 将适用范围与 F001-only 的真实浏览器 BFS 结论记入规格说明；若后续算子集扩大，按 ADR 要求重测。
- ADR-T012-2（内存仅 Node RSS）、ADR-T012-3（P95 样本 n=3）：已披露，供 T013 携带。
- 报告 §10 已披露局限：无 Windows 测试；真实浏览器 BFS 只测 F001；大/深 DOM 未精确计时；键盘覆盖限于主流程；性能数字与本 VM 绑定。
- 本阶段未用外部模型路线做任何事（T011/T012 施工与审查均为直接编码/本地验证）。
