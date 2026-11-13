# T013 未解决项（P2 登记）

审查 commit：`a78d765`（S4 PASS 后完整状态）。P0 0 项，P1 0 项，P2 25 项，全部非阻塞。
每一项均已在 `INDEPENDENT_REVIEW.md` 中说明依据与裁决；修复由独立 FIX 任务执行，
T013 审查者不直接改业务源码。建议处理时机：标 “T014” 的在冻结前处理或由 T014
确认接受；标 “终审” 的留待最终评审时作为已知局限记录。

| 编号 | 遗留项 | 来源 | 建议时机 |
|---|---|---|---|
| T013-P2-01 | T013 验收命令 `verify:review-pack` / `verify:all` 在 package.json 中不存在（规格与实现缺口） | T013 任务卡 §5 | T014 |
| T013-P2-02 | canonical-json.ts:14 注释表述不精确（整数型键按数值序，注释称码点序） | T011 P2-2 | T014（注释修正） |
| T013-P2-03 | T008 报告 gate_sha256 复用 S0 schema 字符串 `locatorstress.s0-gate/v1` | S2 遗留 | T014（冻结决策） |
| T013-P2-04 | validateReportStructure 只交叉核对 overall 分数，不核对 perLocator/perOperator 分数、coverage、controls | S2 遗留 | T014 |
| T013-P2-05 | T008 canonical analysis 的 BFS witness 条目丢 `meaning` 与 `budgetNote` | S2 遗留 | T014 |
| T013-P2-06 | 全量 8 算子无剪枝树中 depth-6 见证需 8801 扩展 > 4096 预算（BOUNDED_INCOMPLETE 为正确结果）；F001 真实 DOM 去重后可达 depth 6 | S2 遗留 | 终审（已知局限） |
| T013-P2-07 | 真实浏览器 BFS 覆盖：T007 仅 depth ≤2；T012 仅 F001 跑过 depth 6；其余 23 fixture 未逐一测量 | S2 遗留 | 终审（已知局限） |
| T013-P2-08 | T009 浏览器内匹配预览为近似值（仅 10 种 role、近似 hidden 判定、srcdoc-only iframe） | S3 遗留 | 终审（已知局限） |
| T013-P2-09 | UI 单 fixture JSON 导出不是 T008 完整报告（文件内已注明） | S3 遗留 | 终审（已知局限） |
| T013-P2-10 | UI BFS 默认 maxDepth=2，与 API 默认 6 不一致 | S3 遗留 | T014 |
| T013-P2-11 | T010 P2-4：离线 HTML 可见渲染是 JSON 子集 | S3 遗留 | T014（决定是否补表） |
| T013-P2-12 | ADR-T012-1：真实浏览器 BFS 5 s 目标仅考核算法本身，4096 次真实评估构造上不可达 | ADR | 终审（记入规格说明） |
| T013-P2-13 | ADR-T012-2：内存仅 Node RSS，Chromium 子进程未归因 | ADR | 终审（已知局限） |
| T013-P2-14 | ADR-T012-3：P95 样本 n=3（矩阵）/ n=5（BFS 存根） | ADR | 终审（已知局限） |
| T013-P2-15 | P2A detach 间歇竞态已加固，本次未复发，但需更多全量观测确认根除 | T011 P2-1 | 继续观察 |
| T013-P2-16 | 无 Windows 测试（全部 Linux） | T012 §10 | 终审（已知局限） |
| T013-P2-17 | 真实浏览器 BFS 只测 F001；大/深 DOM 未精确计时；键盘覆盖限于主流程 | T012 §10 | 终审（已知局限） |
| T013-P2-18 | T012 报告证据 SHA 与数字与 HEAD 提交文件不一致（报告写成后文件又被后续运行重写） | T013 新发现 | T014（冻结前复核） |
| T013-P2-19 | app.js 中 FIX-T009 相关注释已过时（称后端仍会崩溃，实际已修复） | T013 新发现 | T014（注释修正） |
| T013-P2-20 | 缺少 README / USER_GUIDE / HOW_TO_REPRODUCE / THIRD_PARTY_NOTICES / LICENSE_STATUS；无依赖许可清单 | T013 新发现 | T014（发布前补齐） |
| T013-P2-21 | 变异测试只覆盖 10 个纯函数模块（40 手工变异），未覆盖 runner/Oracle/mutations/API service/UI | T013 新发现 | 终审（范围说明） |
| T013-P2-22 | s0-gate.ts deriveVerdict 与 formatScore 为重复实现（缺非法计数守卫；浮点 toFixed vs BigInt）；已证明定义域内无分叉 | T013 新发现 | 终审（冻结决策） |
| T013-P2-23 | S0 gate 静态离线扫描只覆盖 fixture HTML，不扫描 UI/export 模板 | T013 新发现 | 终审（范围说明） |
| T013-P2-24 | gate 与 oracle 脚本先删后写证据，中途失败留半态（须从 git 恢复） | T013 新发现 | T014（健壮性） |
| T013-P2-25 | validateReportStructure 拒绝合法的 depth-0 见证（空序列），与 BFS/stress 测试的约定矛盾 | T013 新发现 | T014（校验器修正） |

## 已关闭（本次审查裁决属实/已修，不列入未解决项）

- T011 P2-1（P2A detach 竞态）：已加固属实（扫窗 30–120 ms 步长 2 ms，重试 5 pass；
  本次全量 509/509 与 gate 内 P2A 均一次通过）。残留观察义务见 P2-15。
- T012 施工期 5 项测试侧修复（F-1 tabTo 误判、F-2 witness 双层结构、F-3 无效草稿前置状态、
  F-4 离线模板路径与 fake service、F-5 真实 BFS 期望状态）：代码抽查全部属实，修复在位。
- S3 期间 EPERM 导致 S0 证据半态：本次审查未遇 EPERM；证据文件 SHA 与 HEAD 一致。
- T008 gate_sha256 / analysis_sha256 与 S0 冻结值不同：属实但为设计如此（T008 用自有
  schema `locatorstress.analysis/v1` 与真实 BFS 图谱），报告 notes 已披露；S0 冻结哈希未变。
