# P022 S1 协调员状态（2026-11-10 ~18:02 GMT）

- 工作目录：/home/hatch/workspace/p022-locatorstress/，git 本地，无 remote，禁止 push。
- S0 已冻结：提交 ebe5ef4，gate_sha256 651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52，工作树干净。
- 主控亲自复核 S0 gate 已完成（2026-11-10 ~17:2x GMT）：`npm run s0:gate` exit 0，GATE PASS，100 次重放 1 个唯一 hash 651c3fd4…（/tmp/p022-s0-gate-muse.log）。
- 路线：Sam 电脑已关机（2026-11-10 17:29 GMT 通知），WorkBuddy 反代（5390）与 Qoder 代理（8790）均断开，不可用。只用 Copilot 桥 / Copilot CLI / agy。
- 桥已核实：2026-11-10 ~18:02 GMT，/health ok:true，token 有效至 18:42:43Z，实测 /v1/chat/completions（Gpt_5_6_Chat）返回 OK（约 4.4 秒）。
- S1 任务：T004（5h）→ T005（4h，依赖 T004 PASS）→ T006（4h，依赖 T004、T005 PASS）。T007–T014 仍锁定，等 S1 授权。
- 验收脚本现状：package.json 只有 typecheck / typecheck:scripts / build / s0:locator-oracle / test:s0:fixtures / test:s0:mutations / s0:gate；test:verdict、test:oracle、test:score、test:controls、test:canonical、test:hash-contract 均不存在，由各任务施工方按规格添加，审查者核对新增脚本确实跑对应测试。

## T004 派发（2026-11-10 ~18:03 GMT）

- T004 builder 已派发（新会话）：四态 Verdict 分类。验收：npm run test:verdict && npm run test:oracle；另须 typecheck 通过、s0:gate 回归 hash 仍为 651c3fd4…。
- 输入：S0 冻结 commit ebe5ef4；PROJECT_BOOK §5.2 解析顺序、§5.3 唯一四态、§5.4 baseline；IMPLEMENTATION_PLAN T004 任务卡；现有 src/oracle/oracle-runner.ts、src/oracle/identity-compare.ts、src/runner/locator-resolver.ts、src/fixtures/golden/expected-verdicts.json、evidence/s0/T002_MUTATION_REPORT.json。
- 允许改：verdict 模块和专属测试。禁止改：fixtures/golden、Oracle、mutations、canonical、UI。
- 完成定义：四态有正/负/边界例；执行错误不伪装 verdict（executionStatus 独立，verdict 为空，分析为 INCOMPLETE，不得算 STABLE）。
- 补充（MEMORY.md 同步）：主控亲自复核 S0 gate 完成于 ~17:41 GMT（GATE PASS，hash 651c3fd4…，100 次重放 1 hash）；FACTORY_INDEX 已更新并同步（60,051 B）；Sam 电脑关机确认于 ~17:46 GMT（WorkBuddy + Qoder 均不可达，3130 隧道当时亦抖动）。

## T004 builder 汇报（2026-11-10 ~18:10 GMT）— PASS（自报）

- 验收：test:verdict exit 0（37/37：单元 34 + 集成 3，含 192 golden）；test:oracle exit 0（s0:locator-oracle PASS、test:s0:fixtures 3/3、test:s0:mutations 3/3）；typecheck exit 0。
- 文件 SHA-256（自报）：classify.ts d591f24b…、classify.test.ts a22d378f…、verdict-golden.test.ts 4dfc9432…、T004_VERDICT_REPORT.json 6ba8e55b…、package.json 49419449…；新增脚本 test:verdict=`vitest run tests/verdict/`、test:oracle=`npm run s0:locator-oracle && npm run test:s0:fixtures && npm run test:s0:mutations`。
- 一致性：vs expected-verdicts.json 192/192；vs T002_MUTATION_REPORT.json 192/192（六字段逐 case）；四态 138/22/17/15 与 T002 相同；externalRequests 0。
- 诚实偏差：TIMEOUT 仅合成单元覆盖，无 live 触发；防御性超规检查（矛盾计数→INCOMPLETE）；S0 helper deriveVerdict 仍并存未统一（留待 T011）；s0:gate 未重跑，留待协调员。

## 我亲自核验（2026-11-10 ~18:11–18:14 GMT）

- git status：仅 package.json 改动（+2 行，两脚本原文与自报一致）+ src/verdict/、tests/verdict/、evidence/s1/ 新增 + 本状态文件；fixtures/golden、Oracle、mutations、canonical、UI 均未动。
- 5 个文件 SHA-256 逐个复算，全部与 builder 自报一致。
- test:verdict 我重跑：exit 0，37/37 通过（34 单元 + 3 集成，192/192 golden）。
- test:oracle 我重跑：exit 0（s0:locator-oracle PASS，fixtures 3/3，mutations 3/3）；typecheck exit 0。
- 读过 classify.ts 全文：顺序与 §5.2 一致（executionStatus → 计数合法性 → frameFailure → finalMatchCount → identity）；frameFailure 字段与 execution.ts 冻结类型一致（FRAME_MISSING | FRAME_AMBIGUOUS）。
- 读过 T004_VERDICT_REPORT.json（除 cases 明细）：192/192、192/192，计数 138/22/17/15，limitations 如实记录（TIMEOUT 无 live；矛盾计数→INCOMPLETE）。
- s0:gate 回归我重跑中（2026-11-10 ~18:14 GMT 起，日志 /tmp/p022-s0-gate-t004.log，pid 67162；约 17 分钟；hash 须仍为 651c3fd4…）。
- s0:gate 回归完成（2026-11-10 ~18:31 GMT，耗时约 17 分钟）：exit 0，GATE PASS，gate_sha256 651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52（与 S0 冻结一致），100 次重放 1 个唯一 hash；S0_GATE.json 复核 result PASS + 同一 hash。S0 冻结未变。
- 桥复核（~18:31 GMT）：/health ok，token 到 18:42:43Z（剩 695 秒），实测调用返回 OK。

## T004 独立评审结论（2026-11-10 ~18:37 GMT）— STATUS PASS，P0=0，P1=0，P2=6

- 评审亲自重跑：test:verdict exit 0（37/37）、test:oracle exit 0、typecheck exit 0；重跑后 T004 报告字节不变（6ba8e55b…）；重跑前后 git status 相同，未引入改动。
- 独立复算：python3 全量比对（非抽查）golden/T002/T004 三方 192/192，六字段逐 case 差异 0；报告内 golden/T002 sha 与文件实算一致；边界抽查（F019–F021 M05、26 例 indexed、14 例 final>1、18 例 final==0）全部一致。
- P2-1：TIMEOUT 仅合成单元（与 ERROR/INVALID_FIXTURE 共用 classify.ts:88 同一分支，后两者有 live 探针；冻结集内无法 live 触发）— 可接受。
- P2-2：防御性超规检查属实可接受（只在 resolver 不可能发出的输入上触发，结果为 INCOMPLETE 而非 verdict）。
- P2-3：deriveVerdict 与 classifyVerdict 并存属实可接受，留待 T011 统一（192 live 输入上六字段 0 差异；唯一分歧是 resolver 发不出的矛盾计数输入）。
- P2-4：S0_P2A.log 被改动 4 行计时，非 T004 所致，系协调员 s0:gate 回归重跑时 runP2a() 重写（日志含墙钟/耗时，非 canonical）。我已用 git checkout 恢复为冻结版本（diff 0 行）；后续处理（移出冻结证据或接受每次重写）留待 T013/T014。
- P2-5：FRAME_MISSING / index 越界 / identity null 三条子路径仅合成单元覆盖（192 冻结集内 0 例），可接受。
- P2-6：classify.ts:113-127 frameFailure else 分支把非 FRAME_AMBIGUOUS 当 MISSING；在冻结联合类型下穷尽，可接受；未来新增 kind 会静默归 MISSING，记为健壮性记录。

## 协调员裁决（2026-11-10 ~18:38 GMT）

- P2-1～P2-6 全部非阻塞，接受为记录；无 FIX-T004。T004 提交。
- 提交内容：package.json（+2 脚本）、src/verdict/、tests/verdict/、evidence/s1/T004_VERDICT_REPORT.json、本状态文件。S0_P2A.log 已恢复，不在提交内；S0_GATE.json、T002 报告、golden 均与 HEAD 字节一致。
- T004 已提交：5f0df94（6 文件，3926 行，工作树干净）。注：首次 commit 因本会话 git identity 未设而失败（Author identity unknown）；已按 S0 提交的作者身份设 repo-local user.name=Muse、user.email=muse@local 后提交成功。
- 桥复核（~18:38 GMT）：/health ok，token 已自动续至 19:47:10Z，实测调用返回 OK。

## T005 builder 汇报（2026-11-10 ~18:49 GMT）— PASS（自报）

- 验收：test:score exit 0（16/16）、test:controls exit 0（2/2）、typecheck exit 0。
- 文件 SHA-256（自报）：stability-score.ts de82b8a3…、stability-score.test.ts 160e6f23…、controls.test.ts a1bfcc78…、T005_SCORE_REPORT.json 733e65ad…、package.json 94a1d70b…；新增脚本 test:score=`vitest run tests/score/stability-score.test.ts`、test:controls=`vitest run tests/score/controls.test.ts`。
- 公式：overall 100×138/192=71.875；per-locator css 46/64=71.875、xpath 42/64=65.625、role 50/64=78.125；per-operator M01 21/24=87.5、M02 19/24=79.167、M03 22/24=91.667、M04 9/24=37.5、M05 21/24=87.5、M06 12/24=50、M07 16/24=66.667、M08 18/24=75。
- 控制组：稳定组 12 fixtures / 96 pairs / 误报 0/96；脆弱组 96/96 检出，planted 子集 45/45；稳定组 planted 子集 9/9。
- incomplete：合成 worked example 8 例（1 incomplete）→ 分母 7、分数 71.429、coverage 7/8=87.5、INCOMPLETE；live ERROR 探针（非法 CSS）+ 1 STABLE → 分数 100（1/1）、coverage 50、INCOMPLETE。
- 诚实偏差：未调用外部模型；s0:gate 未跑留待协调员；test:verdict 未重跑留待协调员；192 冻结集内无真实 incomplete；空组语义（score/coverage null，analysisStatus COMPLETE）；分数为合成集比例。

## 我亲自核验（2026-11-10 ~18:50–18:52 GMT）

- git status：仅 package.json 改动（+2 行，两脚本原文与自报一致）+ src/score/、tests/score/、evidence/s1/T005_SCORE_REPORT.json 新增 + 本状态文件（我自己的改动）；verdict 定义、Oracle、golden、fixtures、mutations、hash core 均未动。
- 5 个文件 SHA-256 逐个复算，全部与 builder 自报一致。
- test:score 我重跑：exit 0，16/16；test:controls 我重跑：exit 0，2/2；typecheck exit 0；test:verdict 回归我重跑：exit 0，37/37。
- 读过 stability-score.ts 全文：纯函数；分母仅 completed；incomplete 不计分、不进分母、只降 coverage；矛盾输入抛错；BigInt 半入 3 位小数（公式验算正确：scaled=(200000n·n+d)/(2n·d)）；无硬编码 S0 数值；控制组定义与 S0 gate 一致（matched=与 golden 一致；planted 子集单独报告）。
- python3 独立复算：从 T002_MUTATION_REPORT.json 逐 case 统计 per-operator 八行全部与 builder 表一致（M01 21/2/0/1、M02 19/5、M03 22/2、M04 9/5/10、M05 21/3、M06 12/5/7、M07 16/4/4、M08 18/1/5）；R5 报告 overall 138/192=71.875、控制组稳定 0/96（planted 9/9）、脆弱 96/96（planted 45/45），与 S0_GATE.json 一致。
- s0:gate 回归我重跑中（2026-11-10 ~18:52 GMT 起，日志 /tmp/p022-s0-gate-t005.log，pid 90244；约 17 分钟；hash 须仍为 651c3fd4…）。
- **事故：VM 重启 #60（~18:53–18:54 GMT，uptime 1 分钟）**：第一次 gate 回归（pid 90244）随重启死亡，/tmp 被清空（日志丢失）；桥亦掉线。重启瞬间 gate 正在清理/重写 S0 证据：git status 显示 evidence/s0/S0_GATE.json 与 S0_GATE.log 被删（D）、S0_P2A.log 被改（M）。
- **恢复（2026-11-10 ~18:55 GMT，我亲自操作）**：`git checkout -- evidence/s0/` 恢复三文件；S0_GATE.json sha 15b5c2d5… 与冻结值完全一致，T002 报告 93af9a18… 未变；git status 只剩 T005 改动 + 本状态文件。T005 文件本身未受损（新文件与 package.json 改动均在）。
- 桥我亲自用 nohup 重起（pid 1766）：/health ok，token 到 19:47:10Z（token 文件随重启保留），实测调用返回 OK。
- s0:gate 回归重跑（第二次，2026-11-10 ~18:56 GMT 起，日志 /tmp/p022-s0-gate-t005b.log，pid 1864；约 17 分钟；hash 须仍为 651c3fd4…）。教训：gate 脚本先删后写 S0 证据，VM 重启会留半截状态；以后 gate 重跑前先确认工作树干净、重跑后立即核对 S0_GATE.json sha，半截状态一律 git checkout 恢复（已验证可行）。
- s0:gate 回归完成（第二次，2026-11-10 ~19:11 GMT，耗时约 15 分钟）：exit 0，GATE PASS，gate_sha256 651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52（与 S0 冻结一致），100 次重放 1 个唯一 hash；S0_GATE.json sha 15b5c2d5… 与冻结值字节一致。S0 冻结未变。
- S0_P2A.log 又被本次 gate 重跑改写（墙钟行），已用 git checkout 恢复为冻结版本（diff 0 行），不在 T005 提交内。
- 桥复核（~19:11 GMT）：/health ok，token 到 19:47:10Z（剩 2135 秒），实测调用返回 OK。

## T005 独立评审结论（2026-11-10 ~19:16 GMT）— STATUS PASS，P0=0，P1=0，P2=2

- 评审亲自重跑：test:score exit 0（16/16）、test:controls exit 0（2/2，live 192 例重算）、typecheck exit 0、test:verdict 回归 exit 0（37/37）；重跑后 T005 报告 SHA 仍为 733e65ad…（字节一致）；git status 重跑前后不变。
- 独立复算：python3 从 T002 报告逐 case 重算 overall 138/192=71.875、per-locator 三行、per-operator 八行及分项四态计数，全部与 T005 报告一致；报告 192 cases 与 T002 actual/expected 逐条 0 差异；舍入正确（M02 79.167、M03 91.667、M07 66.667）；formatPercent BigInt 公式无浮点路径。
- 控制组非硬编码：grep 138/192/96/45 仅在注释与 JSDoc 示例；计算全来自输入；与 scripts/s0-gate.ts:857-867 的 gate 定义一致。
- incomplete：合成 8 例算对（分母 7、71.429、coverage 7/8、INCOMPLETE，含错误分母 62.5 的反断言）；live ERROR 探针重跑通过；矛盾输入抛错合理。
- P2-1：controls.test.ts:303-323 workedExample 分项字符串为手写字面量（值经评审独立复算全部正确，但模块若变测试不会失败）— 非阻塞，建议后续改为由模块输出拼接。
- P2-2：空组 analysisStatus 取 COMPLETE（§5.5 未定义；空虚为真且 null 阻止虚假断言；expected=0 与 coverage null 已区分）— 非阻塞，仅记录。
- 禁改范围干净：git diff 仅 package.json（+2 行）与本状态文件；T002/S0_GATE/T004/golden 与 HEAD 字节一致；5 个 T005 文件 SHA 与自报逐个一致。

## 协调员裁决（2026-11-10 ~19:17 GMT）

- P2-1、P2-2 全部非阻塞，接受为记录；无 FIX-T005。T005 提交。
- 提交内容：package.json（+2 脚本）、src/score/、tests/score/、evidence/s1/T005_SCORE_REPORT.json、本状态文件。
- T005 已提交：7bf1e00（6 文件，5043 行，工作树干净）。
- 桥复核（~19:16 GMT）：/health ok，实测调用返回 OK（token 到 19:47:10Z）。

## T006 builder 汇报（2026-11-10 ~19:39 GMT）— PASS（自报）

- 验收：test:canonical exit 0（36/36）、test:hash-contract exit 0（11/11）、typecheck exit 0、typecheck:scripts exit 0；回归 test:verdict 37/37、test:score 16/16、test:controls 2/2。
- 文件 SHA-256（自报）：canonical-json.ts 8e1d72f3…、hashes.ts bf567d61…、forbidden-scan.ts bba33d77…、index.ts 83b849ee…、node-shims.d.ts aa06b9e9…、canonical-json.test.ts d61da1d0…、forbidden-scan.test.ts 1cfbbfd0…、hash-contract.test.ts 1d84f16e…、T006_HASH_REPORT.json f6b1a664…、package.json 85fe1b27…；新增脚本 test:canonical=`vitest run tests/canonical/canonical-json.test.ts tests/canonical/forbidden-scan.test.ts`、test:hash-contract=`vitest run tests/canonical/hash-contract.test.ts`。
- 四 hash 逐字符复现冻结值：scenario 1ffb5f85…、oracle 3502d81f…、analysis 4410d5c8…、gate 651c3fd4…；canonical 字节长度 13502/24318/848/2012；与 S0 脚本 canonicalJson、测试内独立序列化器、Python stdlib 三方逐字节一致。
- 自指：四对象均不含自身 hash；gate 对象无 gate_sha256 字段，含前三 hash。禁字段扫描：11 条规则，0 命中。
- §6 冲突 C1（自定 P1，需协调员裁决）：§6“数组稳定排序” vs 冻结实现不排序数组（调用方按 §5.7 显式排序；NOTES 数组本身未排序，通用排序会改 gate hash）。C2–C5 均为 P2（数值透传、非有限数、undefined、NFC 碰撞键），对冻结 hash 无影响。
- 诚实偏差：test:canonical 开发中 2/36 失败已修（pid 规则、Windows 路径转义，均为测试/规则缺陷）；新增 src/canonical/node-shims.d.ts（共享 node-builtins.d.ts 未动）；s0:gate 未重跑留待协调员；未调用模型。

## 我亲自核验（2026-11-10 ~19:40–19:42 GMT）

- git status：仅 package.json 改动（+2 行，两脚本原文与自报一致）+ src/canonical/、tests/canonical/、evidence/s1/T006_HASH_REPORT.json 新增 + 本状态文件；fixtures/golden、mutations、verdict、UI、scripts/ 均未动。
- 10 个文件 SHA-256 逐个复算，全部与 builder 自报一致。
- test:canonical 我重跑：exit 0，36/36；test:hash-contract 我重跑：exit 0，11/11；typecheck exit 0；typecheck:scripts exit 0。
- 读过 canonical-json.ts 全文：与冻结 scripts/s0-gate.ts canonicalize 逻辑一致（NFC、键按码点排序、数组保序、无尾换行；C1–C5 均在文件头注释中写明）；读过 hash-contract.test.ts 关键段：每 hash 断言双重（运行期读 S0_GATE.json + 字面冻结值）——builder“未硬编码”的说法不精确，字面值以第二断言形式存在；这是更强的契约测试设计（冻结值被钉死，S0_GATE.json 被改也无法悄悄移动目标），不记为缺陷，仅作观察记录。
- 读过 T006_HASH_REPORT.json：四 hash 全等、字节长度一致、三方比对一致、自指全否、禁扫 0 命中；C1–C5 与 builder 汇报一致；NOTES 数组确未排序（M08、Oracle、BFS 顺序），通用排序必改 gate hash——模块保序的选择是被冻结值强制的，我已独立确认。
- s0:gate 回归我重跑中（2026-11-10 ~19:42 GMT 起，日志 /tmp/p022-s0-gate-t006.log，pid 21875；约 17 分钟；hash 须仍为 651c3fd4…）。
- s0:gate 回归完成（2026-11-10 ~19:57 GMT，耗时约 15 分钟）：exit 0，GATE PASS，gate_sha256 651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52（与 S0 冻结一致），100 次重放 1 个唯一 hash；S0_GATE.json sha 15b5c2d5… 与冻结值字节一致。S0 冻结未变。
- S0_P2A.log 又被本次 gate 重跑改写（墙钟行），已用 git checkout 恢复为冻结版本（diff 0 行），不在 T006 提交内。
- 桥复核（~19:57 GMT）：/health ok，token 已自动续至 20:36:11Z，实测调用返回 OK。

## T006 独立评审结论（2026-11-10 ~20:05 GMT）— STATUS PASS，P0=0，P1=0，P2=4

- 评审亲自重跑：test:canonical exit 0（36/36）、test:hash-contract exit 0（11/11）、typecheck exit 0、typecheck:scripts exit 0、test:verdict 37/37、test:score 16/16、test:controls 2/2；跑后 git status 无新增改动。
- 独立复现：评审自写 Python stdlib 脚本（/tmp/p022-t006-review-repro.py，零共享代码）从冻结证据重建四对象，字节长度 13502/24318/848/2012，四 hash 逐字符一致；tallies 与冻结一致；crafted 样本 hash 1abba10e… 与报告相符。诚实说明：baselinePassed 等四个运行期标量无法从 T002 推导，取自冻结 counts（属输入而非待证 hash）。
- P2-1 C1：评审同意改定 P2，并独立验证——将 NOTES 排序后 gate hash 变为 4a07574d…（≠冻结 651c3fd4…），证实任何通用排序都破坏冻结 hash；规格侧 fix 属于 T013；风险已受控（§5.7 + 100 次重放 + hash-contract 钉死）。
- P2-2 C2–C5：如报告所述，对冻结 hash 无影响；模块选抛错侧合理。
- P2-3：“未硬编码”说法不精确（字面冻结值以第二断言存在）— 仅文档措辞，双重断言本身更强。
- P2-4：测试内“独立序列化器”独立性有限（与模块同构，共享整数型键盲区；冻结键无整数型故无影响）— 真正独立性由 Python 重算提供，仅作观察记录。
- 禁扫：评审自写正则逐条抽查，8 植入正例全触发、3 近 miss 不误报、四对象 0 命中；src/canonical/ 内无 process.env 读取。
- 禁改范围干净：7 个文件与 HEAD 字节一致（T004/T005/T002 报告、S0_GATE.json 15b5c2d5…、golden fa80e27a…、s0-gate.ts dfe87bcf…、repeat-hash.ts 6e2a6cd1…）；8 个新建文件 + package.json SHA 与报告逐个相符。

## 协调员裁决（2026-11-10 ~20:06 GMT）

- P2-1～P2-4 全部非阻塞，接受为记录；无 FIX-T006。T006 提交。
- 提交内容：package.json（+2 脚本）、src/canonical/、tests/canonical/、evidence/s1/T006_HASH_REPORT.json、本状态文件。

## S1 = PASS（2026-11-10 ~20:06 GMT）

- T004 提交 5f0df94（评审 PASS 0/0/6）；T005 提交 7bf1e00（评审 PASS 0/0/2）；T006 提交见下。
- S1 通过只解除 S1 技术阻断，不自动授权 S2。T007–T014 仍锁定，等 S1 授权（主控决定）。
- S1 遗留 P2 记录汇总（留待后续阶段）：T004 P2-1～P2-6（TIMEOUT 仅合成单元；防御超规检查；deriveVerdict 并存留待 T011；S0_P2A.log 每次 gate 重跑改写，留待 T013/T014；三条子路径仅单元覆盖；frameFailure else 分支健壮性）；T005 P2-1（workedExample 分项字符串手写字面量）、P2-2（空组 analysisStatus COMPLETE）；T006 P2-1（C1 §6 数组排序措辞，留待 T013）、P2-2（C2–C5）、P2-3（“未硬编码”措辞）、P2-4（测试内序列化器独立性有限）。
- 事故记录：VM 重启 #60（~18:53–18:54 GMT）中断第一次 T005 gate 回归；S0 证据半截状态已 git checkout 恢复（字节一致）；桥由协调员 nohup 重起（pid 1766，后 token 自动续至 20:36:11Z）。

## 协调员裁决：C1（2026-11-10 ~19:42 GMT）

- builder 将 C1 定为 P1；我改定为 **P2（规格措辞记录，留待 T013）**，理由如下，写明备查：
  1. 代码侧无可修的 fix：任何把数组通用排序写进 canonicalize 的改动都会改变冻结 gate hash（NOTES 未排序已证实），而复现冻结 hash 是 T006 的硬要求；FIX-T006 在代码侧不存在。
  2. 规格侧的 fix 属于 T013（独立评审 + 规格修订），不在 T006 任务内：建议措辞为“数组顺序由 builder 按 §5.7 固定顺序显式确定，canonical 化本身保序”。
  3. 实质风险已受控：冻结行为是确定性的（模块、测试内序列化器、Python 三方逐字节一致）；顺序由 §5.7 固定顺序保证；hash-contract 测试把四个冻结 hash 钉死，未来任何排序滑移都会让测试失败，不会静默通过。
  4. 因此 C1 不阻塞 T006 提交；独立评审若不同意，可在评审中重新定级。
- C2–C5 接受为 P2 记录。无 FIX-T006。
