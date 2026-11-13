# P022 LocatorStress — FIX 聚焦复审报告（第二轮）

- 审查员：fresh session 聚焦复审员（未参与实现、FIX 施工与第一轮复审）
- 审查对象：自 T013 以来工作树的全部改动，HEAD = `a78d765`（`a78d7653da754dcfae26615cc48838aef1e4b585`，T013 审查对象 commit）
- 审查时间：2026-11-11 ~07:42–07:50 GMT
- 审查范围：`git diff HEAD` 全文（8 个修改文件）+ 5 个新增 release 文档全文 + 2 个新增 verify 脚本全文 + 第一轮复审报告 `handoff/FIX-REVIEW.md`
- 方法：逐项读 diff 全文并对照 HEAD 证据文件 / T013 审查包 / 源码逐一核对；亲自运行任务指定的 12 条命令并记录真实退出码（未跑 `test:performance`、`test:e2e`、`npm test` 全量、`verify:all`、`s0:gate`，按任务要求留给协调员）；变异确定性与 FIX-04 数字用 python 独立重算，不只信施工方说法。

## FINAL_VERDICT: PASS

- P0：0 项
- P1：0 项
- P2：0 项

第一轮的两个 P1（P1-1、P1-2）与两个 P2（FIX-04 存根三轮断言、FIX-06 的 509）均已修复并经本轮亲自验证通过；变异确定性修复亦验证通过。本轮未发现新的 P0/P1/P2。

## 各 FIX / 修复复审结论

| # | 复审对象 | 结论 | 依据摘要 |
|---|---|---|---|
| 1 | FIX-01（verify 脚本新增） | **通过** | package.json 仅新增 2 个脚本；两脚本全文核对无误 |
| 2 | P1-1 修复（verify-review-pack 例外表 + 冻结基线） | **通过** | 例外表实为 7 条，恰覆盖 sha256.txt 覆盖范围内的全部 7 个改动文件；基线为 a78d765 完整 SHA，脚本中无 `HEAD:` 引用；接受条件严格；实测 exit 0，126/126 匹配 |
| 3 | P1-2 修复（verify-all 去 test:e2e + --exclude） | **通过** | STEPS 9 步，去掉了 test:e2e；排除清单恰为 2 个非确定性证据重写者；其余证据写者静态核查无计时字段，冻结文件当前 SHA 与冻结值一致；头部注释与实现一致 |
| 4 | 变异确定性修复（runner 去 durationMs + 证据重生成） | **通过** | runner diff 仅删 3 处 durationMs，未动逻辑/阈值/计分/退出码，控制台日志保留；HEAD 剥离 durationMs 后与现文件逐字节一致；亲自重跑 test:mutation，40/40=100%，SHA 仍为 98ff10ae… |
| 5 | FIX-02+05（注释） | **通过** | 纯注释改动，回归确认无代码变化；FIX-T009 表述仍与源码一致 |
| 6 | FIX-03（校验器 + 2 测试） | **通过** | 回归确认：校验器仍精确等于“空序列当且仅当 depth==0 且 FOUND”；2 个新测试跑通（json-export 11/11） |
| 7 | FIX-04（T012 报告数字/SHA + 第 53 行） | **通过** | 全部数字逐一与 HEAD `T012_PERF.json` / `T012_E2E_REQUESTS.json` 相符；第 53 行新句只对有记录的数字作三轮断言，存根 P95 只断言本轮 15 ms |
| 8 | FIX-06（release 五文档，509→511） | **通过** | 511 经两条独立路线确认；release/ 内仅剩 HOW_TO_REPRODUCE.md:125 一处 509 历史引用（已加注） |

## P1-1 修复逐项核对（通过）

- **例外表条目数**：`KNOWN_FIX_DELTAS` 实际为 **7 条**，不是施工方所称的“6 个文件 + 证据文件”那种含糊计数——7 条是：`package.json`、`src/canonical/canonical-json.ts`、`src/contracts/report.ts`、`src/ui/app.js`、`evidence/s4/T012_E2E_OFFLINE_PERF_REPORT.md`、`evidence/s4/T011_MUTATION_RESULTS.json`、`scripts/t011-mutation-runner.mjs`。逐一核对：这 7 个文件恰为本轮 8 个 tracked 改动文件中**在 `handoff/T013/sha256.txt` 覆盖范围内的全部文件**；第 8 个改动文件 `tests/export/json-export.test.ts` 不在 sha256.txt 中（亲自 grep 确认无该路径），也不在 COVERAGE_MATRIX.csv 的覆盖范围（矩阵只覆盖 `src/`），因此不需要例外——无遗漏、无多余。
- **每条 FIX 原因准确**：package.json（FIX-01 新增两脚本）、canonical-json.ts（FIX-02+05 头注释）、report.ts（FIX-03 校验器）、app.js（FIX-02+05 guard 注释）、T012 报告（FIX-04 数字与 SHA 修正）、T011 结果（FIX-01 后续：durationMs 移除后重生成）、mutation runner（FIX-01 后续：runner 本身的改动）。均与实际 diff 相符。仅一处文字上的不精确（见文末“观察”，非 P 项）：canonical-json.ts 与 app.js 的原因只写了“header/guard comment”，而实际 diff 还各含一处 JSDoc 改动——同属纯注释，不影响接受逻辑。
- **基线确为 a78d765 完整 SHA**：`FROZEN_COMMIT = "a78d7653da754dcfae26615cc48838aef1e4b585"`，与 `git rev-parse HEAD` / `git rev-parse a78d765` 的输出逐字符一致；脚本头注释与 `checkKnownFixDelta` 实现均使用该常量。
- **脚本中无 `HEAD:` 引用**：`grep -rn "HEAD:" scripts/verify-review-pack.mjs scripts/verify-all.mjs` 无输出。第一轮的失效模式（提交后 tip 移动导致 tip 基线失效）已消除。
- **接受条件严格**：`checkKnownFixDelta` 仅当 `git show <FROZEN_COMMIT>:<path>` 的 SHA-256 等于 review pack 记录值时才接受；非例外文件、git 不可用、commit/路径缺失、基线不匹配一律失败。两处调用点（检查 2 矩阵、检查 3 sha256.txt）共用同一函数，逻辑一致。
- **实测**：`npm run verify:review-pack` exit **0**，`verify:review-pack PASSED`——检查 1：18/18 文件存在且非空；检查 2：矩阵 155 行、磁盘 src/ 101 文件、缺失 0、sha256 不一致 0；检查 3：126 条、126 已查、126 匹配。输出的 10 条 note 恰为 7 个例外文件（3 个 src 文件在检查 2 与检查 3 各出现一次，runner 与 T012 报告等仅在检查 3 出现），每条均注明“`a78d7653…:path` 仍匹配冻结值——接受为有意的 FIX 增量”。

## P1-2 修复逐项核对（通过）

- **STEPS 10→9**：`STEPS` 数组实为 9 步：typecheck、typecheck:scripts、build、test（+exclude）、test:oracle、test:offline、test:stress、test:coverage（+exclude）、test:mutation。`test:e2e` 已去掉；`test:performance` 与 `s0:gate` 仍不在其中。去掉 test:e2e 合理：其唯一文件 `tests/e2e/e2e-main-flow.test.ts` 重写 `evidence/s4/T012_E2E_REQUESTS.json`（该文件 :356-357 `writeFileSync`），与 test:performance 对 T012_PERF.json 的重写同类，且 e2e 覆盖由 T012 冻结记录 + 协调员全量重跑承接。
- **排除清单恰为 2 个文件**：`EVIDENCE_REWRITING_TESTS = ["tests/e2e/performance.test.ts", "tests/e2e/e2e-main-flow.test.ts"]`，`--exclude` 各传一次，`test` 与 `test:coverage` 两步均附加。`test` 脚本为 `vitest run --no-file-parallelism`，无 exclude 时默认收集全部测试——亲自跑 `npx vitest list`（只收集、不执行，exit 0）证实默认收集含这两个文件（452 行中有 11 行属此二文件），因此排除是必要的；现实现已补上。
- **穷尽性核查（其余写 evidence/ 的测试是否确实逐字节再生）**：亲自 grep 全部 `tests/` 下写 `evidence/` 的位置：
  - `tests/integration/s0-mutations.test.ts` → 写 `evidence/s0/T002_MUTATION_REPORT.json`（已冻结）；`tests/integration/oracle-parity-independent.test.ts` → 写 `evidence/s4/T011_ORACLE_PARITY.json`（已冻结）；`tests/search/bfs-browser.test.ts` → 写 `evidence/s2/T007_BFS_BROWSER_SPOTCHECK.json`（已冻结）；`tests/verdict/verdict-golden.test.ts` → 写 `evidence/s1/T004_VERDICT_REPORT.json`（**不在** sha256.txt 中）；`tests/score/controls.test.ts` → 写 `evidence/s1/T005_SCORE_REPORT.json`（**不在** sha256.txt 中）；`tests/ui/ui-flow.test.ts` → 仅写截图至 `evidence/s3/screenshots/`（未冻结）。
  - 上述 5 个 JSON 写者中亲自 grep `duration|elapsed|Date.now|performance.now|toISOString|new Date`：**零命中**——报告对象只含可重算的 verdict/计数，无计时或时间戳字段，逐字节再生的宣称有静态依据。另亲自核对当前磁盘 SHA：T002 `93af9a18…`、T007 spotcheck `b7ba27aa…`、T011_ORACLE_PARITY `a8e727f3…` 均与冻结值逐字节一致（且本轮我跑 test:bfs 后复核仍一致，见“证据 SHA”一节）。
  - `test:offline` 与 `test:stress`：`grep evidence/ tests/e2e/offline.test.ts tests/e2e/stress.test.ts` 零命中，写 nothing under evidence/ 属实。
  - 结论：排除清单穷尽。完整的形式证明需实际跑一遍 `verify:all` 并重算冻结 SHA——按任务要求留给协调员；本轮的静态证据 + 当前 SHA 一致已足以支持通过。
- **头部注释与实现一致**：注释称步骤顺序与 T013 test_commands.txt 一致（除排除项外）、称 test:mutation 重生成的文件现为确定性输出（与本轮实测的 SHA 不变一致）、称退出码“首个失败步骤即以该步退出码退出”（实现为 `spawnSync("npm", ["run", step], { stdio: "inherit" })`，无管道，`process.exit(code)`），均属实。

## 变异确定性修复逐项核对（通过）

- **runner diff 只删 3 处 durationMs**：`git diff HEAD -- scripts/t011-mutation-runner.mjs` 全文核对：两处 CONFIG_ERROR 分支各删 `durationMs: 0` 一个字段（第 548、555 行附近），主结果对象删 `durationMs,` 一行（第 608 行附近）。无逻辑、阈值、计分、退出码改动；`mutationScore`、阈值 90%、退出路径原文未变。
- **控制台日志保留**：runner :497、:595 仍有 `const durationMs = Date.now() - started;`，:596 仍 `console.log(... ${durationMs}ms)`——计时只从写入文件里去掉，控制台仍可见，与任务描述一致。
- **新 T011_MUTATION_RESULTS.json 与冻结值剥离 durationMs 后完全一致**：亲自用 python 对比——`HEAD` 文件剥离全部 `durationMs` 键后与现文件逐键相等（`strip-equal: True`）；HEAD 含 40 个 `durationMs`（每 mutant 一个），现文件含 0 个；mutant 数 40，killed 40/40；顶层键集合相同（10 个键，无增减）。现文件 SHA `98ff10ae6d31ca54f0ed2bb71443d60f708c6022a673ff525c648b23eb0ce5d8`，与任务给出的 `98ff10ae…` 前缀一致。
- **亲自重跑 test:mutation**：exit **0**，`Mutation score: 40/40 = 100.0% (threshold 90%)`，`Killed: 40, Survived: 0, Inconclusive: 0, Config errors: 0`；重跑后文件 SHA 仍为 `98ff10ae6d31…ce5d8`，与跑前逐字节相同——确定性得证。
- **runner 进例外表合理**：runner 在 sha256.txt 第 129 行被冻结（亲自核对：`c10794df… scripts/t011-mutation-runner.mjs`），改它必须有例外；verify-review-pack 实测中 runner 的 note 已出现，接受路径生效。

## FIX-02+05 回归确认（通过）

- diff 仍为纯注释：canonical-json.ts 只改头注释 + `canonicalize()` JSDoc；app.js 只改 `checkLocatorShape` JSDoc + 一处 guard 内联注释。无代码改动（`git diff HEAD --stat` 中两文件合计 48 行增减全为注释行）。
- 整数型键注释仍准确：与冻结测试 `tests/canonical/canonical-boundaries.test.ts:60-70`（期望 `'{"1":3,"2":2,"10":1}'`）一致；test:canonical 36/36 通过。
- FIX-T009 表述仍准确：亲自核对 `src/api/service.ts:355`（`if (locator !== undefined)`）与 `src/api/server.ts:124`（`if (res.headersSent)`）仍在；“shape check 现为冗余纵深防御”的表述与现状一致；test:ui 12/12 通过。

## FIX-03 回归确认（通过）

- 校验器仍精确等于“空序列当且仅当 depth==0 且 FOUND”：亲自读 `src/contracts/report.ts:364-384`——仅在 `status === "FOUND"` 分支内三段式：非数组 → 报错；`seq.length === 0 && depth !== 0` → 报错（含 depth 缺失/`undefined`，因 `undefined !== 0`）；否则 `depth !== seq.length` → 报错（未变）。空序列 + depth 0 落到第三分支，`0 !== 0` 为假，不报错；depth 0 + 非空序列仍报错；`depth` 的 0..6 范围检查未变；其他校验分支未动。
- 2 个新测试跑通：`npm run test:export:json` 44/44，其中 `json-export.test.ts` 11/11（含 2 个新测试：正向 depth-0 FOUND 空序列被接受、反向 depth 1 空序列被拒绝）。HEAD 版该文件为 9 个测试，现 11 个，+2 与 FIX-03 描述一致。

## FIX-04 逐项核对（通过；第一轮 P2-1 已修复）

- **全部改后数字逐一与 HEAD 证据文件相符**：亲自用 python 读 `git show HEAD:evidence/s4/T012_PERF.json` 全文并逐项比对报告 §5.2–§5.4：
  - Chromium 首次启动 883 ms（`chromiumFirstLaunchMs: 883`）
  - 矩阵 3 样本 6760 / 5885 / 5658 ms，P95 6760 ms；per-fixture P95 703 ms；per-case P95 101 ms、均值 31.73 ms；最慢 fixture F021（1157 / 1100 / 1202 ms）
  - BFS 存根 5 样本 9 / 12 / 7 / 9 / 15 ms，P95 15 ms
  - 真实浏览器 BFS 122,507 ms，六项计数 3761 / 1024 / 2123 / 1638 / 0 / 6，状态 BOUNDED_NO_WITNESS
  - RSS 峰值 217.6 MiB
  - SHA 表新值与 HEAD 文件逐字节相符：T012_PERF.json `b1838d3f…57e589`、T012_E2E_REQUESTS.json `497de20a…06197`（亲自 `sha256sum` 磁盘文件核对一致）
  - E2E 请求数：HEAD `T012_E2E_REQUESTS.json` 为 `totalRequests 29`、`externalRequests 0`、`urls` 29 条，与报告“29 个请求，外部 0”相符
- **第 53 行新句核对**：新段落（§4 表后、“证据文件重写说明”）称“三轮运行的矩阵 P95（6760 / 6934 / 7914 ms，均 ≤ 60,000 ms）、per-fixture P95（703 / 945 / 813 ms，均 ≤ 2,000 ms）与 RSS 峰值（217.6 / 223.1 / 219.8 MiB，均 ≤ 512 MiB）均在目标内”——其中本轮值与 HEAD 文件一致，另两轮值（6934 / 7914、945 / 813、223.1 / 219.8）与报告 §5.2–§5.4 正文的交叉核对原文一致，有记录在案；“存根 BFS P95 只断言本轮（HEAD 文件对应轮，P95 15 ms，目标 ≤ 5,000 ms），另两轮的存根 P95 未记录在案，不作三轮断言”——第一轮 P2-1（“三轮存根 P95 均在目标内”缺乏另两轮记录值支撑）已按建议修复；真实浏览器 BFS 六项计数“三轮完全相同”的表述与 §5.3 正文（另两次耗时 127,149 ms 与 130,853 ms，计数相同）一致。
- **证据文件本身未被改动**：`git diff HEAD -- evidence/` 除本报告文件外为空；T012_PERF.json 与 T012_E2E_REQUESTS.json 的磁盘 SHA 与 HEAD 一致。

## FIX-06 逐项核对（通过；第一轮 P2-2 已修复）

- **511 经两条独立路线确认**：
  1. `npx vitest list`（只收集、不执行，exit 0）：452 行；其中三处循环生成用例被 list 折叠——亲自跑 `npx vitest run tests/verdict/classify.test.ts tests/canonical/forbidden-scan.test.ts tests/api/routes-boundaries.test.ts`，实测 85 个测试，而 list 中这三文件只占 26 行，差 59；452 + 59 = **511**。与协调员在 `handoff/S5_COORDINATOR_STATE.md` 中的三条路线结论一致。
  2. T013 全量 509 + FIX-03 新增 2 个测试（json-export.test.ts HEAD 9 → 现 11，亲自计数并跑通）= 511。
- **release/ 内无残留 509**：`grep -rn "509" release/` 仅剩 `HOW_TO_REPRODUCE.md:125` 一处——“（T012 冻结记录：`npm test 509/509`——该记录为 T012 冻结时的 509，FIX-03 新增 2 个测试后现为 511；……”——历史引用已加注，按第一轮建议保留，正确。`grep -c "511" release/*.md`：README 2、USER_GUIDE 1、HOW_TO_REPRODUCE 3（:119、:125、:202），共 6 处 511，与第一轮所列 6 处前瞻性位置一一对应（5 处改写 + :125 行内同时含 511 新值与 509 历史引用）。
- 5 个 release 文档均存在且非空（HOW_TO_REPRODUCE.md 9708 B、LICENSE_STATUS.md 1948 B、README.md 10818 B、THIRD_PARTY_NOTICES.md 11538 B、USER_GUIDE.md 15551 B）。第一轮已全量核对的关键断言（命令、哈希、许可证状态、依赖清单）未受本轮改动影响，不再重复。

## 亲自跑的命令与退出码

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run typecheck` | 0 | 通过 |
| `npm run typecheck:scripts` | 0 | 通过 |
| `npm run build` | 0 | 通过 |
| `npm run verify:review-pack` | 0 | **PASSED**（18/18、矩阵 0 缺失 0 不一致、sha256 126/126 匹配） |
| `npm run test:canonical` | 0 | 36/36 通过 |
| `npm run test:ui` | 0 | 12/12 通过 |
| `npm run test:export` | 0 | 11/11 通过 |
| `npm run test:api` | 0 | 65/65 通过 |
| `npm run test:export:json` | 0 | 44/44 通过（其中 json-export.test.ts 11/11，含 2 个新测试） |
| `npm run test:witness` | 0 | 27/27 通过 |
| `npm run test:bfs` | 0 | 51/51 通过 |
| `npm run test:mutation` | 0 | **40/40 = 100.0%**，重跑后 T011 文件 SHA 不变 |

另亲自跑（辅助核对，非验收命令）：`npx vitest list`（exit 0，452 行）、三循环文件实测 85 测试、python 对比 HEAD/现 T011 文件（剥离 durationMs 后完全一致）。

未跑（按任务要求，留给协调员）：`test:performance`、`test:e2e`、`npm test` 全量、`s0:gate`、`verify:all`。

跑完后核对证据文件 SHA 未变——T012_PERF.json `b1838d3f…57e589`、T012_E2E_REQUESTS.json `497de20a…06197`、S0_GATE.json `15b5c2d5…3572d`、T011_MUTATION_RESULTS.json `98ff10ae…ce5d8`、T002_MUTATION_REPORT.json `93af9a18…`、T007_BFS_BROWSER_SPOTCHECK.json `b7ba27aa…`、T011_ORACLE_PARITY.json `a8e727f3…`、S0_REPEAT_HASH.json `07cec67e…`，均与 HEAD/冻结值一致；`git status` 与开工时一致（8 个修改文件 + 既有 untracked 项，无新增改动），**无需** `git checkout -- evidence/` 恢复。

## P0 / P1 / P2 清单

### P0

无。

### P1

无。第一轮 P1-1 与 P1-2 均已修复并验证通过（见上）。

### P2

无。第一轮 P2-1（FIX-04 存根三轮断言）与 P2-2（FIX-06 的 509）均已修复并验证通过（见上）。

## 观察（非 P 项，不阻塞，供协调员酌定）

1. `KNOWN_FIX_DELTAS` 中 canonical-json.ts 与 app.js 的原因文字只写了“header/guard comment correction”，而实际 diff 还各含一处 JSDoc 改动（同属纯注释）。接受逻辑不依赖原因文字，无功能影响；如求精确可把两处原因改为“header comment + JSDoc correction”/“guard comment + JSDoc correction”。
2. `evidence/s4/T012_E2E_OFFLINE_PERF_REPORT.md:211`（§8 复现命令）仍写“`npm test` 全量 509 tests”——这是该报告所记录的 T012 当轮历史值，与同报告 :22、:166 的 509 引用一致，属历史记录而非前瞻性断言，故不记为 P 项；协调员如在 T014 冻结前重跑全量，需按 FIX-04 说明段落的裁决（以证据文件为准）决定是否同步更新。
3. `verify:all` 的穷尽性宣称（其余证据写者逐字节再生）本轮以静态证据支持（无计时字段 + 当前冻结 SHA 一致），完整的形式证明需协调员实际跑一遍 `verify:all` 并重算冻结 SHA——该命令按任务要求由协调员最后全量重跑时覆盖。

## 给协调员的后续提醒（非 P 项）

1. 本轮复审通过后即可提交 FIX；提交后 `verify:review-pack` 仍应通过（基线已钉死 a78d765 完整 SHA，不再依赖 tip），建议提交后重跑一次确认。
2. 任何一次全量 `npm test`（含协调员计划的全量重跑）都会重写 T012_PERF.json 与 T012_E2E_REQUESTS.json——FIX-04 的报告数字与 SHA 表将再次与新证据文件不一致。这是按设计的行为（FIX-04 说明段落已声明“以证据文件为准”），但在 T014 冻结前须决定顺序：最后一次全量运行后重做一次 FIX-04 式对齐，或冻结时以证据文件为准、不再重跑性能测试。
3. 本复审未改任何已有文件，未 commit，未碰 Copilot 桥、GitHub、Drive，未对外发消息。唯一新文件为本报告。

## 产出

- `handoff/FIX-REVIEW-R2.md`（本文件）
