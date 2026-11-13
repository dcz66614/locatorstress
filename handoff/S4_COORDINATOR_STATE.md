# P022 S4 协调员状态

## S4 进度
- T011：施工 PASS + 独立审查 PASS（0/0/2）+ 协调员亲自重跑验收命令全部通过；已提交 `35366d3`。
- T012：施工 PASS + 独立审查 PASS（0/0/0）+ 协调员亲自重跑验收命令全部通过；已提交 `5f075f3`。
- S4 = PASS（协调员核定，待 Muse 亲自复核后才算最终 PASS）。

## T011 全量单元、属性、Mutation 与 Oracle Parity
- 施工方：npm test 486/486（35 文件）；test:coverage 486/486，lines 69.16%（1016/1469）、statements 69.11%、branches 66.6%、functions 73.44%（@vitest/coverage-v8@5.1.0）；test:mutation 40/40 = 100.0%（门槛 90% 自定）；test:oracle exit 0；Oracle parity 192/192 三方一致。
- 独立审查：FINAL_VERDICT: PASS，P0 0 / P1 0 / P2 2。P2-1：既存 P2A detach 回归测试间歇失败（时序竞态，4 次全量中 1 次 485/486，单独重跑 2/2 通过，gate P2A PASS；建议 S4 后续加固，不阻塞）。P2-2：src/canonical/canonical-json.ts:14 头部注释表述不精确（整数型键按数值序，注释称码点序；行为已冻结且有测试钉死，可选修正）。
- 协调员本人重跑：npm test 486/486 exit 0；test:coverage 486/486、lines 69.16%（1016/1469）exit 0；test:mutation 40/40 = 100.0% exit 0；test:oracle exit 0（oracle 脚本 PASS + fixtures 3/3 + mutations 3/3）。
- s0:gate：施工方完整跑 PASS（02:11–02:26 GMT）；审查者完整跑 PASS（约 15.2 分钟）。协调员本人三次尝试均被 VM 存储 EPERM 中断（第 1 次：全部阶段通过，重放到 20/100 同 hash，第 27 次 EPERM 写失败；第 2 次：P2A 阶段进程丢失、日志 0 字节；第 3 次：npm 启动即 EPERM）。EPERM 不是产品缺陷。每次中断后 S0 证据均已恢复并逐文件 SHA 核对（S0_GATE.json 2376 B sha 15b5c2d5…、S0_GATE.log 2276 B sha 56de50e1…、S0_P2A.log 595 B sha 2a76dec1…、S0_REPEAT_HASH.json 6955 B sha 07cec67e…，全部与 HEAD blob 一致；其中 S0_GATE.json/S0_GATE.log/S0_REPEAT_HASH.json 用 muse.write 逐字节恢复并 SHA 核对，S0_P2A.log 按 od -c 逐字节恢复并 SHA 核对）。
- 冻结核对：gate_sha256 651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52 未变；src/ 生产源码零改动（git diff f0d5969 -- src/ 为空）；classify.ts SHA 与 HEAD blob 一致；golden/fixtures/hash contract 未动。
- 证据：evidence/s4/T011_FULL_TEST_REPORT.md（sha 4c0077c2…）、T011_ORACLE_PARITY.json（sha a8e727f3…）、T011_MUTATION_RESULTS.json（每次 mutation 运行按设计重新生成，仅 durationMs 字段不同，内容等价：40/40、passed true）。
- coverage/ 目录为覆盖运行生成物，不入仓（数字已记入报告 §4，审查者已独立复算）。
- 提交：`35366d3`（T011，21 文件，7619 插入 / 1 删除；因 EPERM 导致 git commit 无法写 .git/index.lock，改用 mktree + commit-tree + update-ref 绕过 index 提交，提交后 git read-tree 重建 index，工作树干净）。

## T012 浏览器 E2E、离线、性能与压力
- 施工方：test:e2e 7/7、test:offline 6/6、test:performance 4/4（约 149 s）、test:stress 6/6、build exit 0；npm test 509/509（39 文件）。P95：192 总耗时 6832 ms（目标 ≤60,000）、单 fixture 848 ms（目标 ≤2,000）、BFS 存根 14 ms（目标 ≤5,000）、Node RSS 216.4 MiB（目标 ≤512）。真实浏览器 BFS F001：133,801 ms、BOUNDED_NO_WITNESS（计数 3761/1024/2123/1638/0/6），未按 5 s 断言，ADR-T012-1 已写。外部请求 0；键盘路径可用；24×8 矩阵 192/192；P2-1 加固（扫窗 30–120 ms、5 pass）。
- 独立审查：FINAL_VERDICT: PASS，P0 0 / P1 0 / P2 0。五条验收命令 + 全量回归全部重跑通过（e2e 7/7、offline 6/6、performance 4/4、stress 6/6、npm test 509/509）；性能重跑 P95 7219 ms、per-fixture 729 ms、BFS 存根 20 ms、真实 BFS 120,892 ms（计数逐数相同）、RSS 220.8 MiB；SHA-256 重跑前全部复算相符；ADR-T012-1 裁决成立（规格原文为“建议性能目标”，偏离机制正是提交 ADR；真实浏览器 4096 评估在构造上不可达；预算跑不到属实；预算正确性由存根证明）；P2-1 加固 4/4 通过；5 个测试侧修复均属实；s0:gate 完整 PASS（04:42–04:57 GMT），hash 未变，无 EPERM。
- 协调员本人重跑：build exit 0；test:e2e 7/7 exit 0；test:offline 6/6 exit 0；test:stress 6/6 exit 0；test:performance 4/4 exit 0（我方 P95：192 总耗时 7206 ms、单 fixture 798 ms、单 case 111 ms、BFS 存根 29 ms、真实 BFS 126,903 ms BOUNDED_NO_WITNESS 计数 3761/1024/2123/1638/0/6 与施工方逐数相同、Node RSS 220 MiB）；npm test 509/509（39 文件，267.99 s）exit 0；完整 s0:gate GATE PASS（100/100 重放 1 hash，gate_sha256 651c3fd4…不变，S0_GATE.json sha 15b5c2d5…不变）。
- 提交：`5f075f3`（10 文件，1752 插入 / 4 删除；plain git commit 一次成功，EPERM 已缓解）。
- 证据 SHAs（协调员重跑后、提交前核对）：T012_E2E_OFFLINE_PERF_REPORT.md c54b0d04…81c729（未被测试改写）；T012_PERF.json 8bfa6819…（我方运行数字）；T012_E2E_REQUESTS.json 2ee71607…（我方运行：29 请求、外部 0）。PERF/REQUESTS 按设计每次运行重写，SHA 随运行而变，内容等价。
- 已披露局限（报告 §10，供 T013 携带）：真实浏览器 BFS 只测 F001；内存仅 Node RSS；大/深 DOM 未精确计时；P95 总耗时样本 n=3；无 Windows 测试；键盘覆盖限于主流程。

## 环境备注
- VM 存储 EPERM 抖动持续发作（2026-11-11 00:17 起，03:00 后仍间歇发作）：写操作间歇性 EPERM 或静默 0 字节；npm/git 启动都可能失败。muse.write/muse.edit 写入可靠；exec 写入须核对大小/SHA、失败删了重试；0 字节文件绝不能提交。EPERM 绝不是产品缺陷。
