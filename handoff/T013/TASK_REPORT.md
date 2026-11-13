# T013 任务报告 — 亲自执行的命令与实测结果

- 审查者：T013 独立审查员（全新会话，未参与实现）
- 审查对象：commit `a78d765`（`git rev-parse HEAD` 核对一致）
- 时间：2026-11-11 ~06:10–06:40 GMT
- 工作目录：`~/workspace/p022-locatorstress/`
- 原始日志：`handoff/T013/test_logs/`（01–10）；本文件为摘要，所有退出码均为
  命令真实退出码（重定向到文件后读 `$?`，未用管道取输出）。

## 1. 命令总表

| # | 命令 | 退出码 | 结果摘要 | 日志 |
|---|---|---|---|---|
| 01 | `npm run typecheck` | 0 | 通过 | `01-typecheck.log` |
| 02 | `npm run typecheck:scripts` | 0 | 通过 | `02-typecheck-scripts.log` |
| 03 | `npm run build` | 0 | 通过 | `03-build.log` |
| 04 | `npm test` | 0 | 39 文件，509/509 通过，270.46 s | `04-npm-test.log` |
| 05 | `npm run test:oracle` | 0 | 见 §2（3/3 + oracle 脚本 PASS） | `05-test-oracle.log` |
| 06 | `npm run test:e2e` | 0 | 7/7 通过 | `06-test-e2e.log` |
| 07 | `npm run test:offline` | 0 | 6/6 通过 | `07-test-offline.log` |
| 08 | `npm run test:stress` | 0 | 6/6 通过 | `08-test-stress.log` |
| 09 | 独立四哈希重算（`python3 handoff/T013/hash_recompute.py`） | 0 | 四哈希全部 MATCH；T008 内嵌 hash 全部 MATCH | `09-hash-recompute.log` |
| 10 | `npm run s0:gate`（完整） | 0 | GATE PASS；192/192；Oracle parity 192/192；baseline 24/24；重放 100/100、1 个唯一 hash；gate_sha256 `651c3fd4…` 不变；P2A PASS（exit 0）；外部请求 0；约 15 分钟 | `10-s0-gate.log` |

## 2. 逐条实测

### 01–03 typecheck / typecheck:scripts / build

三条全部 exit 0，输出为空（tsc 无报错）。`build` 生成 `dist/`（gitignored，未入仓）。

### 04 npm test（全量）

- 39 个测试文件，509/509 通过，0 失败，0 跳过；耗时 270.46 s（测试占 96%）。
- 其中含 `performance.test.ts` 4/4（真实浏览器 BFS 124,330 ms，
  BOUNDED_NO_WITNESS，计数 3761/1024/2123/1638——与 T012 三轮计数完全一致）与
  `p2a-detach-regression.test.ts` 2/2（23,006 ms）。
- 按设计重写了 evidence 文件（T012_PERF.json、T012_E2E_REQUESTS.json、
  T011_MUTATION_RESULTS.json、T011_ORACLE_PARITY.json 等），跑完后已
  `git checkout -- evidence/` 恢复并核对 SHA 与 HEAD 一致。

### 05 test:oracle

- `s0-locator-oracle`：baseline rawMatchCount=1、finalMatchCount=1、
  executionStatus=COMPLETED、identityMatch=true；identity probe
  nodeIdentity=true、wrapperIdentity=false；second run 相同；frame identity
  probe sameTarget=true、decoy=false、passed=true；offline probe 2/2 拦截；
  checks 全部 true；result PASS。
- `test:s0:fixtures`：3/3 通过（baseline 24/24 唯一命中原目标）。
- `test:s0:mutations` + p2a：3/3 通过（192 单变异用例与 golden 一致）。
- 证据文件无改动残留（`git status evidence/` 干净）。

### 06 test:e2e — 7/7，exit 0

真实 Chromium + 真实 UI 服务器全流程（F002/F001/键盘-only/无效草稿守卫/
全程请求录音 29 个、外部 0）。跑完后 `T012_E2E_REQUESTS.json` 被按设计重写，
已 `git checkout` 恢复。

### 07 test:offline — 6/6，exit 0

静态扫描、在线 UI 会话 0 外部请求、导出 HTML 离线打开 0 请求/0 对话框、
敌意页面拦截、loopback 绑定、`/api/export` HTML 501。

### 08 test:stress — 6/6，exit 0

重复确定性、3 context 并发、大 DOM（5,000 节点）、深 DOM（200 层）、BFS 上限、
UI 服务器并行负载。

### 09 独立四哈希重算

自写 Python canonicaliser（`handoff/T013/hash_recompute.py`，不 import 项目代码），
从 manifests + HTML + T002 报告 + golden + S0_GATE.json counts 重建 canonical 对象：

- scenario `1ffb5f85…c9f22` MATCH
- oracle `3502d81f…45a988` MATCH（T002 actualVerdict vs golden 0 不一致）
- analysis `4410d5c8…57a4` MATCH
- gate `651c3fd4…a62c52` MATCH
- S0_GATE.json 文件 SHA `15b5c2d5…3572d` 与冻结值一致
- T008 报告内嵌 canonical 对象的四个 hash 全部重算一致

### 10 s0:gate（完整）

- 退出码 0；耗时约 15 分钟（2026-11-11 ~06:19–06:34 GMT）。
- `GATE PASS failure_type=null gate_sha256=651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52`。
- baseline 24/24；192/192 用例完成；Oracle parity 192/192、0 不一致；
  稳定控制误报 0/96；脆弱控制检出 96/96；四态各 ≥8（STABLE 138 /
  WRONG_TARGET 22 / AMBIGUOUS 17 / MISSING 15）；外部请求 0、拦截 0。
- P2A 回归：status PASS，exitCode 0（本次审查第二次观测，未复发）。
- 重放：100/100 完成，1 个唯一 hash，与主 gate hash 一致
  （`matchesMainGateHash: true`）。
- 门禁重写了 `S0_GATE.json`（内容与 HEAD 字节一致，SHA `15b5c2d5…`）、
  `S0_GATE.log`、`S0_REPEAT_HASH.json`（SHA `07cec67e…`，与 S4 记录一致）、
  `S0_REPEAT_HASH.log`、`S0_P2A.log`；按任务要求，`S0_P2A.log` 已
  `git checkout` 恢复（SHA `2a76dec1…`，与 S4 记录一致），其余文件与 HEAD
  字节一致，`git status evidence/` 干净。

## 3. 未执行的命令

- `npm run test:performance`：按任务要求未单独跑（会重写 evidence/s4 性能证据）。
  性能结论以 S4 已验证数字为准；但本次 `npm test` 内含 performance 套件 4/4
  （见 §2.04），其数字已核对进 P2-18。
- `npm run verify:review-pack` / `npm run verify:all`：package.json 中不存在
  （T013 验收命令缺口，见 INDEPENDENT_REVIEW.md P2-01）；未编造脚本去跑。
- `npm run test:coverage`：不在本次任务验收命令清单内，未重跑；覆盖率 70.03%
  引用 S4 已验证数字（T011 时 69.16%，T012 新增测试后上升）。

## 4. 证据恢复记录

每次跑完按设计重写 evidence 的命令后，均执行 `git checkout -- evidence/` 并核对：

| 命令后 | 恢复结果 |
|---|---|
| 04 npm test | 恢复后 `git status evidence/` 干净；S0_GATE.json SHA `15b5c2d5…` |
| 05 test:oracle | 无改动残留 |
| 06 test:e2e | `T012_E2E_REQUESTS.json` 已恢复（SHA `497de20a…`，与 HEAD 一致） |
| 07/08 offline/stress | 无改动残留 |
| 10 s0:gate | S0_P2A.log 已 `git checkout` 恢复（SHA `2a76dec1…`）；其余文件与 HEAD 字节一致，`git status evidence/` 干净 |

## 5. 环境

- Node v24.22.1；npm 10.9.4；Playwright 1.65.0；Chromium 158.0.8127.18；
  Linux x64（Ubuntu 24.04.5 LTS）；seed `P022-LOCATORSTRESS-S0-2026-11-10`。
- 审查期间未遇 VM 存储 EPERM 写失败；全部写出文件均按大小与 SHA 核对，无 0 字节产出。
