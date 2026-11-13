# P022 S1 — Muse 主控亲自复核记录（2026-11-10 ~20:25 GMT）

S1 = PASS。以下全部由 Muse 本人在 VM 上真实执行并核对退出码，非转述施工方/协调员自报。

## 亲自重跑的验收命令（全部 exit 0）

| 命令 | 结果 |
|---|---|
| npm run test:verdict | 37/37 通过 |
| npm run test:oracle | exit 0（s0:locator-oracle result PASS；test:s0:fixtures 3/3；test:s0:mutations 3/3） |
| npm run test:score | 16/16 通过 |
| npm run test:controls | 2/2 通过（见下方注记） |
| npm run test:canonical | 36/36 通过 |
| npm run test:hash-contract | 11/11 通过 |
| npm run typecheck | exit 0 |
| npm run typecheck:scripts | exit 0 |
| npm run s0:gate（完整，~20:06–20:22） | exit 0，GATE PASS，gate_sha256 651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52，100 次重放 1 个唯一 hash |

## S0 冻结核对

- S0_GATE.json SHA-256：`15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d`，与冻结值字节一致。
- 四 hash 与冻结值逐字符一致（T006 报告 + 本人重算复核）。
- 工作树干净（S0_P2A.log 每次 gate 重跑被 vitest 墙钟行改写，已 git checkout 恢复，不在提交内）。

## 注记：test:controls 首次重跑失败的原因

本人第一次重跑 test:controls 时 1 failed（ENOENT，读不到 evidence/s0/S0_GATE.json），原因是当时本人自己的 s0:gate 正在运行，而 gate 脚本先删后写 S0 证据——文件在那一刻不存在。不是 T005 缺陷。gate 跑完后重跑 test:controls：2/2 通过。教训：以后验收测试不得与 gate 重跑并行。

## 任务与评审（协调员汇报，已核对提交与状态文件）

- T004 四态 Verdict：提交 5f0df94，独立评审 PASS 0/0/6。
- T005 稳定性评分：提交 7bf1e00，独立评审 PASS 0/0/2。
- T006 Canonical + 四 hash：提交 cd64e83，独立评审 PASS 0/0/4。
- C1 裁决（§6 数组排序措辞）：协调员将 builder 自定的 P1 改定为 P2（规格措辞，留待 T013）；评审独立验证 NOTES 排序后 gate hash 变为 4a07574d…，证实代码侧无不破坏冻结 hash 的 fix。本人接受该裁决。
- VM 重启 #60（~18:53–18:54 GMT）：中断协调员第一次 T005 gate 回归；S0 证据半截状态已 git checkout 恢复（字节一致）；桥由协调员 nohup 重起（pid 1766），本人复核 /health ok、token 到 20:36:11Z。

## 结论

S1 = PASS。T004–T006 全部提交，独立评审全部 PASS（P0/P1 均为 0），S0 冻结全程未变。S1 通过只解除 S1 技术阻断，不自动授权 S2。T007–T014 仍锁定，等主控授权。
