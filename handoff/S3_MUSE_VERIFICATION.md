# P022 S3 — Muse 个人验证记录

时间：2026-11-11 ~00:16–01:00 GMT（协调员汇报 00:16 后亲自验证）
结论：**S3 = PASS**（T009 a404fdf + FIX-T009 501ccf2 + T010 cdd6261；协调员 PASS 记录 f0d5969 已在库中）

## 亲自重跑（最终提交上，全部通过）
- test:ui 12/12 exit 0
- test:export 11/11 exit 0
- test:html-safety 3/3 exit 0
- test:api 30/30 exit 0（S2 时 27，FIX-T009 增加 3 个真实 HTTP 回归测试）
- test:export:json 20/20 exit 0
- test:verdict 37/37 exit 0
- test:score 16/16 exit 0
- typecheck exit 0；typecheck:scripts exit 0
- git log 与汇报一致：f0d5969 / cdd6261 / a404fdf / 501ccf2；工作树干净（除协调员状态文件未提交，见下）

## S0 冻结核对（诚实记录：本人完整 gate 未跑完，见下）
- 协调员在 T009/FIX 后与 T010 后各跑一次完整 s0:gate：两次均为 GATE PASS，
  gate_sha256 651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52 不变，
  S0_GATE.json sha 15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d 与冻结值一致。
- 本人 gate 第 1 次（~00:16 启动）：全部阶段通过，重放进行到 60/100，唯一 hash 1 个，
  gate_sha256 651c3fd4… 不变；第 64 次重放时 EPERM 写失败而中断（VM 存储抖动，非产品问题）。
- 本人 gate 第 2 次：P2A 回归测试中 Chromium target crashed（"page.evaluate: Target crashed"，
  crashpad 写失败 writev EPERM），属环境抖动；同测试第 1 次跑时 P2A status=PASS exit=0。
- 本人 gate 第 3、4 次：npm 自身启动即 EPERM（写日志文件失败），无法开始。
- 每次失败后 S0 证据均出现半态（S0_GATE.json 被删或 0 字节），均已用 git 恢复并逐文件重试核对：
  S0_GATE.json 2376 B sha 15b5c2d5…、S0_GATE.log 2276 B、S0_P2A.log 595 B、
  S0_REPEAT_HASH.json 6955 B，全部与 HEAD 一致。证据文件本身未损坏，冻结内容安全地存在于 git 对象中。
- VM 存储 EPERM 抖动自 2026-11-07 已有记录（写操作间歇性 EPERM 或静默 0 字节），本次 00:17–01:00 持续发作，
  大写操作（python 2000 字节写、git checkout、npm 启动）多次失败，小写 echo 时好时坏。
- 因此：本人完整 gate 重跑因环境原因未完成，S3 PASS 的 gate 依据为协调员两次完整 PASS +
  本人第 1 次跑的部分通过（60/100 重放同 hash）+ 全部验收命令亲自通过。S4 协调员须在 S4 回归中
  重新跑完整 s0:gate；若存储仍抖动，先恢复证据再重试，不得把 EPERM 当产品缺陷。

## 接受的非阻断 P2（转 T013/后续）
- T009：浏览器内匹配预览为近似实现、单 fixture 导出非 T008 完整报告、BFS 默认 maxDepth=2、
  vitest expect.poll 而非 @playwright/test；施工方报告 §6 一处措辞误差已在 FIX 时修正。
- T010：P2-1～P2-3 为施工方披露且属实；P2-4 新发现：可见渲染是 JSON 的子集
  （perLocator/perOperator 分数、witness limits/perDepth、verification、canonical 对象只在内嵌 JSON，
  建议 T013 决定是否列入可见汇总表）。

## 后续
- S4（T011–T012）待派发。S3 PASS 已核定，Sam 睡眠中，醒后一并报 S2 + S3 PASS。
