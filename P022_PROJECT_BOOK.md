# P022 LocatorStress｜定位器压力台
## PROJECT_BOOK.md｜项目书

**PROJECT_ID:** `P022`  
**SPEC_VERSION:** `1.0.0`  
**SPEC_STATUS:** `SPEC_FROZEN / NOT_IMPLEMENTED`  
**PLAN_STATUS:** `READY_FOR_S0_ONLY`  
**GO_STATUS:** `GO NOT DECLARED`  
**LICENSE:** `PENDING_SAM_DECISION`  
**FIXED_SEED:** `P022-LOCATORSTRESS-S0-2026-11-10`  
**参与政策:** `ZERO_HUMAN_PARTICIPANTS`  
**用户价值:** `USER_VALUE_NOT_MEASURED`

> 本文件是施工规格，不是实现、运行或验收通过的证明。`READY_FOR_S0_ONLY` 不代表 GO 已下达；未获明确授权前不得启动 T001。即使 S0 通过，也不自动授权 S1–S5。

---

## 0. 规格效力与不可变约束

### 0.1 项目决定

LocatorStress 是浏览器自动化定位器的确定性 DOM 变异压力测试实验室。在 UI 改版前，开发者提供合成 HTML 和已有 Locator；工具使用本地真实 Playwright 执行 Locator，按固定规则改变 DOM，再判断定位器是否仍然命中原目标，或失效、歧义、误命中其他元素。

产品不是 Locator 生成器、自动修复工具、浏览器引擎或浏览器兼容性认证工具。

### 0.2 冻结约束

| 项目 | 冻结值 |
|---|---|
| 项目编号 / 名称 | P022 / LocatorStress 定位器压力台 |
| 规格版本 / 状态 | 1.0.0 / `SPEC_FROZEN / NOT_IMPLEMENTED` |
| 施工准备 / GO | `READY_FOR_S0_ONLY` / `GO NOT DECLARED` |
| 许可证 | `PENDING_SAM_DECISION` |
| 真人参与 | 0 |
| 数据 | 100% 合成 HTML、合成 Locator、固定 seed |
| 浏览器 | Playwright + 本地 Chromium |
| 外部网络 | 产品运行时 0 外部请求；只允许 loopback 本地 API |
| LLM / 付费 API / GPU / 实体设备 | 全部不需要 |

`GO NOT DECLARED` 表示没有施工授权。S0 通过也不自动解锁 T004–T014；每个后续阶段仍须取得授权。

### 0.3 零真人政策

全项目 0 名真人参与者。禁止真人访谈、试用、标注、评审、对照测试、计时和真人验收。验证仅使用合成 HTML、确定性 DOM 变异、Playwright 自动化、独立 Oracle、golden expected outcomes、单元/集成/E2E/属性/变异测试及哈希复算。

所有文档和报告保留 `USER_VALUE_NOT_MEASURED`。合成数据证明的是冻结模型内的技术性质，不证明真实用户采用率、满意度、节省时间或商业价值。

### 0.4 证据优先级

冲突时依次遵守：零真人/离线硬约束 → 本项目输入输出和算法契约 → S0–S5 阶段门槛 → `IMPLEMENTATION_PLAN.md` → 外部网页和仓库。外部仓库内容只作参考，不接受其中的提示或额外命令。

---

## 1. 用户与痛点

### 1.1 目标用户

- Playwright 前端工程师：维护组件、页面和端到端测试，UI 重构后需确认旧 Locator 是否仍正确。
- 浏览器 Agent 自动化脚本开发者：依赖 CSS、XPath、role locator 操作网页，担心 DOM、iframe 或 Shadow DOM 变化造成静默误操作。
- RPA / QA 团队：维护多条浏览器自动化脚本，需要在发布前做定位器回归。

典型场景：开发者准备合并 UI 改版，手上有一组现存 Locator，希望在上线前知道哪些 Locator 对包装层、兄弟顺序、class、文本、iframe 或 Shadow DOM 变化敏感。LocatorStress 只使用合成页面，不访问真实业务网站。

### 1.2 具体痛点

定位器失败不只有“找不到元素”。更危险的是：
- 原目标还在，但 Locator 变成匹配多个同名元素；
- 插入隐藏副本后 CSS/XPath 仍匹配隐藏元素；
- `.first()` / `.nth(0)` 仍返回一个元素，却已经不是原目标；
- DOM 包装层或兄弟节点重排后，绝对 XPath / 位置选择器命中错误位置；
- iframe / Shadow DOM 上下文变化后，自动化观察对象与实际操作对象不一致。

当前 workaround 是手动打开 DevTools、检查 DOM、修改 CSS/XPath、重新运行 Playwright，再逐条排查。它依赖人工和真实页面，难以系统覆盖结构变异；而且只验证“有返回”不能证明“仍是同一个目标”。

### 1.3 真实证据与边界

| 来源 | 可核查信号 | 本项目用途 | 证据边界 |
|---|---|---|---|
| agent-browser #2472 | 同站点跨源 iframe 的 refs 报告 “outside the viewport”，frame selector 找不到内容 | iframe/frame scope 合成案例 | 单个项目 Issue，不代表所有版本或 Playwright 同样失败 |
| agent-browser #2246 | 交互元素扫描只遍历 `document.body.querySelectorAll('*')`，未进入 Shadow Roots；部分 shadow 内可点击元素拿不到 ref | Shadow DOM 变异案例 | 讨论 agent-browser 扫描路径，不等同于 Playwright Locator 行为 |
| Playwright Locators 官方文档 | 建议优先面向用户的定位方式和显式契约，例如 `getByRole()` | role locator 接口与对照依据 | 官方建议不保证任意 DOM 变异下必然稳定 |
| Playwright FrameLocator 文档 | 提供 iframe 内部定位能力 | `framePath` 解析方式 | 不代表跨浏览器认证 |

公开 Issue 证明故障模式曾被报告，不能推算发生率、平均损失或市场规模。`WRONG_TARGET` 通过本项目合成 decoy / index 场景确定性构造，不声称这些 Issue 已报告同一事故。

### 1.4 痛点量化

频率、强度、单次排查时间均为 `NOT_MEASURED`。20–40 分钟只是初始工程估计，不是用户研究结果。常见绕路是 DevTools 检查、改 selector、手工重跑、增加等待或重写定位器；不足是不能批量枚举 DOM 变化，也不能确认单元素命中是否仍为原目标。

---

## 2. 差异化与历史项目去重

### 2.1 核心差异

LocatorStress 不帮用户“找一个更好的 selector”，而是：
1. 接收已有 Locator；
2. 生成可复现的 DOM 结构变异；
3. 使用真实 Playwright 执行 Locator；
4. 用不暴露给 Locator 的 Node-side 目标身份 Oracle 判断命中对象；
5. 分类四态结果；
6. 计算稳定性分数；
7. 用有界 BFS 找出最短失败变异序列；
8. 输出 JSON 和离线 HTML 报告。

不生成、改写或自动修复 Locator。Smart Locators 是相邻方向，不在本项目范围。

### 2.2 开源先例

| 先例 | 借鉴 | 不复制 |
|---|---|---|
| Playwright Locators | CSS/XPath/role 的真实执行语义 | 不重写 Playwright |
| Playwright FrameLocator | iframe scope 链式定位 | 不做跨浏览器认证 |
| agent-browser #2472 | iframe ref/frame selector 失败线索 | 不复制 agent-browser ref 系统 |
| agent-browser #2246 | Shadow Root 遍历遗漏线索 | 不复制 DOM snapshot 扫描器 |
| Smart Locators 类项目 | 定位器生成/自愈的竞品边界 | 不生成、排序、修复 selector |

不声称全球首创。独立价值主张是“固定变异语料 + Playwright 实际执行 + 元素对象身份 Oracle + 最短失败变异序列”的组合。

### 2.3 P016–P021 去重

| 项目 | 核心机制 | LocatorStress 不同点 |
|---|---|---|
| P016 AskBridge | 五字段求助卡、确定性完整度检查 | 不组织求助文本 |
| P017 FrameShift | 帧率/时间码假设枚举、最短漂移见证 | 不处理媒体时间码 |
| P018 DualChannel | MCP 结果与 Provider 请求字段对照 | 不检查 MCP 数据链路 |
| P019 ResumeMatrix | Agent checkpoint 跨版本恢复兼容性 | 不处理 Agent 状态恢复 |
| P020 CheckPath | GitHub Actions required-check 覆盖模拟 | 不分析 CI 触发和门禁 |
| P021 ViewportShift | 软键盘视口状态机、几何遮挡和最短失败序列 | 不模拟视口、键盘或布局几何 |

本项目的场景是浏览器自动化 Locator 的 DOM 鲁棒性；机制是 DOM 变异 + Playwright 执行；验证方式是元素身份 Oracle + 四态分类。与 P016–P021 至少在场景、机制、验证方式中的两项不同。

---

## 3. MVP 目标、非目标与边界

### 3.1 目标

- 输入合成 HTML + Locator 定义；
- 支持 CSS、XPath、role 三类 Locator；
- 使用本地真实 Playwright 执行；
- 至少 8 种确定性 DOM 变异；
- 使用 Node-side ElementHandle identity 作为独立 Oracle；
- 输出 `STABLE`、`WRONG_TARGET`、`AMBIGUOUS`、`MISSING`；
- 输出稳定性分数、最多 6 步 BFS 最短失败序列、JSON 和离线 HTML；
- 提供本地 Web UI；
- 固定 seed 和四个 SHA-256；
- 0 真人、0 外部请求、无 LLM/API/GPU/硬件。

### 3.2 非目标

不做 Locator 生成/自动修复；不抓取真实网站；不读取真实浏览器 profile、cookies、账号或业务数据；不做 Firefox/WebKit/Safari 认证；不实现浏览器引擎；不执行用户 JS；不做 SaaS、遥测、云存储或 LLM 功能。

### 3.3 Locator 输入

仅支持：
- `css`：Playwright CSS selector；
- `xpath`：Playwright XPath selector；
- `role`：`getByRole(role, { name, exact, includeHidden })` 的受限 JSON 表达。

可选字段：
- `framePath`: 0–2 层 iframe CSS selector 数组；
- `index`: 可选 0-based `.nth(index)`；
- role `name` 只支持字符串，不支持正则或函数。

不支持任意 Locator 链、`.filter()` 回调、`evaluate()`、自定义 JS selector engine 或动态正则。

### 3.4 24 个合成页面

S0 固定 24 个页面：CSS 8、XPath 8、role 8；稳定控制 12、脆弱控制 12；每种 Locator 类型各 4 稳定 + 4 脆弱。8 个页面家族：表单提交、搜索框、导航链接、对话框确认、表格行操作、工具栏菜单、嵌套 iframe、open Shadow DOM 组件。每页执行 M01–M08，形成 `24 × 8 = 192` 个单变异测试。变异前 baseline 必须唯一命中原目标。

---

## 4. 八种确定性 DOM 变异算子

| ID | 算子 | 操作 | 主要风险 |
|---|---|---|---|
| M01 | `WRAP_TARGET` | 在目标外增加包装节点 | 直接子节点 XPath |
| M02 | `REORDER_SIBLINGS` | 按固定索引交换目标与兄弟节点 | nth-child、位置 XPath |
| M03 | `CHANGE_CLASS` | 替换目标一个 class token | class CSS/XPath |
| M04 | `INSERT_SAME_NAME` | 在目标前插入同 tag/name 或同 accessible-name decoy | 重复匹配、first 误命中 |
| M05 | `NESTED_IFRAME` | 插入嵌套 iframe decoy；frame fixture 可复制 frame selector | frame scope 歧义 |
| M06 | `MOVE_TO_OPEN_SHADOW_ROOT` | 将目标移入同一 document 的 open ShadowRoot，保持节点身份 | XPath 不穿透 ShadowRoot |
| M07 | `INSERT_HIDDEN_DUPLICATE` | 插入 display:none / aria-hidden 重复节点，不复制 Oracle 身份 | CSS/XPath 隐藏匹配 |
| M08 | `CHANGE_TEXT` | 修改目标文本；按 fixture 决定是否同步 aria-label | role accessible-name 变化 |

所有算子固定参数、固定顺序，在新页面副本执行。M04/M07 decoy 不是 Oracle 目标。M05 只用 `srcdoc` 或合成 frame，不加载远程 URL。M06 只支持 open ShadowRoot；不模拟 closed ShadowRoot。不插入脚本或外部资源。

---

## 5. Oracle、四态 Verdict 与稳定性分数

### 5.1 Oracle：元素对象身份

不得在 HTML 中加入 `data-oracle-id` / `data-target-id` 等可被 selector 查询的标识。Oracle 使用 Node-side 对象身份：

1. 加载合成 HTML；
2. 变异前根据 fixture 私有结构路径取得原目标 `ElementHandle`；
3. 将 handle 保存在 Node 进程，不暴露给页面或 LocatorSpec；
4. 应用 DOM 变异；
5. 执行被测 Locator；
6. 对唯一命中元素执行 `actualElement === originalTargetElement` 比较；
7. 只输出 match count 和 identity boolean，不输出 CDP 临时对象 ID。

fixture 的私有目标路径只存在于测试 manifest，不写入页面 DOM，不传给 LocatorResolver。M01–M08 不跨浏览上下文移动目标节点；M05 插入 frame decoy，保持原目标句柄有效。

### 5.2 解析顺序

1. 校验 LocatorSpec；
2. 对 `framePath` 逐层计数：0 个为 MISSING，多于 1 个为 AMBIGUOUS，恰好 1 个才进入下一层；
3. 执行 CSS / XPath / role Locator；
4. 记录原始匹配数；
5. 如有 `index`，执行 `.nth(index)`；越界为 MISSING；
6. 计算最终匹配数和目标身份；
7. 浏览器异常/超时使用独立 execution status，不伪造 verdict。

### 5.3 唯一四态

| Verdict | 定义 |
|---|---|
| `STABLE` | 最终匹配恰好 1 个，且与原目标为同一 DOM 对象 |
| `WRONG_TARGET` | 最终匹配恰好 1 个，但不是原目标 |
| `AMBIGUOUS` | 最终匹配大于 1，或 framePath 某层匹配多个 frame |
| `MISSING` | 最终匹配为 0，或 framePath 某层无匹配 frame |

浏览器异常、超时、fixture 无效用独立 `executionStatus`：`COMPLETED` / `ERROR` / `TIMEOUT` / `INVALID_FIXTURE`。此时 verdict 为空，分析为 `INCOMPLETE`，不得算作 STABLE。

### 5.4 Baseline

每个 fixture 变异前必须恰好命中原目标一次。不满足时标记 `INVALID_FIXTURE`，不得计分。

### 5.5 稳定性分数

`stability_score = 100 × stable_case_count / completed_mutation_case_count`

- 分母只包括已完成且有 verdict 的变异用例；
- incomplete 不计分，但必须降低 coverage 并使 analysisStatus 为 INCOMPLETE；
- WRONG_TARGET / AMBIGUOUS / MISSING 分开计数；
- 分数是合成变异集比例，不是生产失败概率；
- 同时显示 completed / expected，防止高分掩盖低覆盖率。

总体分数和每 Locator、每 mutation operator 分项分数都必须可复算。

### 5.6 有界 BFS

- 起点为 baseline 通过的原始合成页面；
- 搜索动作是 M01–M08；
- 最大深度 6；
- 默认每个 Locator 最大扩展状态 4096；
- 同一算子一条序列最多一次，除非 fixture 显式允许重复；
- BFS 按序列长度递增，首个非 STABLE 为最短失败序列；
- 同深度按 mutation ID 字典序和固定参数顺序 tie-break；
- 状态去重使用 canonical mutation plan hash；
- 输出 mutation IDs、参数、首个失败 verdict 和 fixture 引用；
- 未找到时输出 `BOUNDED_NO_WITNESS`，只表示有限搜索内未找到；
- 达到状态上限且仍有队列时输出 `BOUNDED_INCOMPLETE`。

### 5.7 固定顺序

M01 → M02 → M03 → M04 → M05 → M06 → M07 → M08；fixture 按 ID 排序；case 按 fixture ID / mutation ID 排序；BFS 相同深度按 mutation ID 序列字典序。

---

## 6. 哈希契约

| 字段 | 哈希对象 |
|---|---|
| `scenario_sha256` | canonical scenario：HTML、LocatorSpec、seed、mutation suite、BFS 限制 |
| `oracle_result_sha256` | 独立 Oracle 的规范化逐 case 结果 |
| `analysis_sha256` | verdict、分数、coverage、BFS witness、analysis status |
| `gate_sha256` | S0 gate 规范报告，含前三个 hash、计数、阈值和结果 |

Canonical JSON：UTF-8、LF、Unicode NFC、对象键排序、数组稳定排序；数值只用整数或明确十进制字符串，不用浮点判定真值；哈希小写 hex；不自指。

规范结果不得包含墙上时钟、createdAt、随机 UUID、PID、机器绝对路径、用户名、主机名、CDP 临时对象 ID、环境变量值或真实个人数据。环境版本可写入独立 `ENVIRONMENT_REPORT.md`，但不得混入规范哈希。固定 seed：`P022-LOCATORSTRESS-S0-2026-11-10`。

---

## 7. 用户流程、功能需求与接口

### 7.1 用户流程

1. 打开本地 Web UI；
2. 选择内置合成页面或导入合成 fixture；
3. 选择 CSS / XPath / role Locator，可选 framePath / index；
4. 运行 baseline；
5. 运行 M01–M08；
6. 查看四态 verdict、目标身份、分数和 coverage；
7. 对选定 Locator 运行 ≤6 步 BFS；
8. 查看最短失败序列和每步 DOM 差异；
9. 导出 JSON / 离线 HTML；
10. 清空本地运行数据。

### 7.2 功能需求

| ID | 功能 | 优先级 |
|---|---|---|
| FR01 | 合成 HTML 输入 | P0 |
| FR02 | CSS / XPath / role LocatorSpec | P0 |
| FR03 | 0–2 层 framePath | P0 |
| FR04 | 可选 nth(index) | P0 |
| FR05 | 本地 Playwright + Chromium | P0 |
| FR06 | M01–M08 确定性变异 | P0 |
| FR07 | Node-side identity Oracle | P0 |
| FR08 | 四态 verdict | P0 |
| FR09 | 稳定性分数与 coverage | P0 |
| FR10 | ≤6 步 BFS witness | P0 |
| FR11 | JSON 导入导出和四个 hash | P0 |
| FR12 | 离线 HTML 报告 | P0 |
| FR13 | 本地 Web UI | P0 |
| FR14 | 固定 seed | P0 |
| FR15 | 清空工作区 | P1 |
| FR16 | 键盘操作和窄屏可用 | P1 |

### 7.3 API

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | 本地健康状态 |
| GET | `/api/fixtures` | 合成 fixture 列表 |
| GET | `/api/mutations` | M01–M08 契约 |
| POST | `/api/validate` | 校验 scenario / LocatorSpec |
| POST | `/api/analyze` | baseline + 单变异分析 |
| POST | `/api/search` | 有界 BFS |
| POST | `/api/export` | JSON / HTML |

CLI 命令：
```powershell
npm run dev
npm run demo
npm run analyze -- --scenario <file>
npm run search -- --scenario <file>
npm run export -- --run <id> --format json
npm run export -- --run <id> --format html
npm run s0:gate
```

本地 API 只绑定 `127.0.0.1`。

---

## 8. UI / 交互设计

1. **Fixture Lab：** 24 个页面、固定 seed、页面家族、Locator 类型和控制组。
2. **Locator 编辑区：** 合成 HTML 预览 + LocatorSpec 表单；无自动生成按钮。
3. **Mutation Lab：** M01–M08 固定算子；显示原 DOM 与变异 DOM。
4. **Verdict Matrix：** fixture 行、M01–M08 列；点击查看 match count、framePath、identity match。
5. **BFS Witness：** 显示深度、扩展状态数、最短序列和每一步 DOM diff。
6. **Report：** 稳定性分数、四态分布、coverage、四个 SHA-256、JSON/HTML 导出。

视觉原则：突出 DOM diff、Locator 结果和 Oracle 证据；WRONG_TARGET 明确说明“返回了一个元素，但不是原目标”；AMBIGUOUS 显示匹配数量；MISSING 显示首个失败边界。颜色不能成为唯一状态通道。主视口 1280×800，窄屏 390×844。所有控件可键盘操作。

---

## 9. 技术栈与版本策略

| 组件 | 选择 | 策略 |
|---|---|---|
| Runtime | Node.js 24 LTS | T001 实测精确版本 |
| Language | TypeScript 5.x | 锁定 patch |
| UI | React 19.x | 锁定 patch |
| Build | Vite 7.x | 锁定 patch |
| Browser automation | Playwright | T001 选择并锁定稳定版本 |
| Browser | 本地 Chromium | 使用 VM 已缓存版本，不在运行时下载 |
| HTTP | Node built-in http | 只提供本地 API |
| Tests | Vitest + Playwright API | 精确锁定 |
| Hash | Node crypto SHA-256 | 标准库 |

不使用 latest / 浮动依赖。T001 记录 OS、CPU、内存、Node、npm、Playwright、Chromium。默认 Windows VM 兼容；若 Muse 实测环境不是 Windows，先记录实际 OS 并适配，不得虚报 Windows 已测。产品运行时不下载浏览器、不访问外网。

---

## 10. 架构与模块

```text
React UI
  -> Local API / CLI
    -> Scenario Validator
    -> 24 Synthetic Fixtures
    -> Mutation Engine M01-M08
    -> Playwright Runner (local Chromium)
       -> CSS/XPath/role Resolver
       -> framePath Resolver
       -> match count / ElementHandle
    -> Node-side Identity Oracle
    -> Verdict + Stability Score
    -> Bounded BFS
    -> Canonical JSON + SHA-256
    -> JSON / Offline HTML
```

| 模块 | 职责 |
|---|---|
| `contracts/` | scenario、LocatorSpec、fixture、report schema |
| `fixtures/` | 24 合成页面、私有 Oracle manifest、golden |
| `mutations/` | M01–M08 纯变异函数 |
| `runner/` | Chromium、frame scope、LocatorResolver |
| `oracle/` | 原目标 handle 捕获和身份比较 |
| `verdict/` | 四态分类、稳定性评分 |
| `search/` | BFS、状态 key、witness |
| `canonical/` | canonical JSON 和 SHA |
| `api/` / `cli/` | 本地接口和命令 |
| `ui/` | Fixture Lab、Matrix、Witness、Report |
| `export/` | JSON / HTML |

架构不变量：Playwright 是唯一浏览器执行引擎；Oracle 不注入 DOM marker；golden expected 不由生产分类器生成；每个变异用新页面副本；外部请求一律阻断；UI 不计算 verdict；随机/时间/绝对路径不进入规范结果。

---

## 11. 数据结构与样例

### 11.1 LocatorSpec

```ts
interface LocatorSpecV1 {
  kind: "css" | "xpath" | "role";
  selector?: string;
  role?: string;
  name?: string;
  exact?: boolean;
  includeHidden?: boolean;
  framePath?: string[]; // 0–2 CSS iframe selectors
  index?: number | null;
}
```

### 11.2 Scenario

```json
{
  "schema": "locatorstress.scenario/v1",
  "scenario_id": "P022-DEMO-CSS-001",
  "seed": "P022-LOCATORSTRESS-S0-2026-11-10",
  "html": "<main><button class=\"primary\" data-testid=\"save\">Save</button></main>",
  "locator": {"kind": "css", "selector": "button.primary"},
  "mutation_suite": ["M01","M02","M03","M04","M05","M06","M07","M08"],
  "bfs": {"max_depth": 6, "max_expanded_states": 4096}
}
```

### 11.3 Oracle manifest

`privateTargetPath` 只供 fixture loader 在变异前捕获目标 ElementHandle；不写入 HTML，不导出给 Locator，不进入 Web UI。`expectedVerdicts` 由独立 fixture 定义冻结，不得由生产实现反向生成。

### 11.4 输出

AnalysisReport 必须含 `analysisStatus`、expected/completed counts、四态计数、稳定性分数分子/分母、最短 witness 和四个 SHA。示例哈希只能在真实运行后填入；规格阶段不得伪造 hash。

---

## 12. S0 固定实验与验收

### 12.1 固定实验

- 24 合成 HTML 页面；
- CSS 8 / XPath 8 / role 8；
- 稳定控制 12 / 脆弱控制 12；
- M01–M08；
- 192 单变异用例；
- seed `P022-LOCATORSTRESS-S0-2026-11-10`；
- BFS depth ≤6，4096 states / Locator。

### 12.2 S0 门槛

| 指标 | 门槛 |
|---|---:|
| baseline 唯一命中 Oracle | 24/24 |
| 单变异测试 | 192/192 |
| 预植入确定性失败检出 | 100% |
| 稳定控制 false-alarm | ≤2% |
| 四态覆盖 | 每态至少 8 个 golden case |
| Oracle parity | 100% 逐字段一致 |
| 固定 seed 重放 | 完全一致 |
| 100 次完整 gate | 1 个唯一 gate_sha256 |
| 外部网络 | 0 |
| 真人参与 | 0 |
| 一键命令 | 退出码 0 |

稳定控制误报率 = 稳定控制 expected pairs 中实际 verdict 与 golden 不一致数 / 稳定控制 expected pairs。若分母至少 92，最多容许 1 个误报，目标为 0。

### 12.3 一键门禁

```powershell
npm run s0:gate
```

该命令串行执行环境检查、fixtures、baseline、192 用例、Oracle parity、控制组指标、四态覆盖、离线检查、100 次重放和 hash 生成。只有全部通过才退出 0；任何失败必须非零退出。

---

## 13. 隐私、安全与许可证

- 只处理合成 HTML，不访问真实站点或真实 profile。
- 不读取 cookies、localStorage、账号、业务数据。
- 不调用 LLM、付费 API、云服务、遥测、CDN 或远程字体。
- iframe 使用 `srcdoc` 或本地合成内容；外部请求一律 abort。
- 本地 API 只绑定 `127.0.0.1`。
- HTML 作为文本处理，不执行用户脚本；限制 HTML 大小、DOM 节点、iframe/ShadowRoot 深度和 BFS 状态数。
- 项目许可证 `PENDING_SAM_DECISION`。T001 盘点依赖许可，T013 独立复核；不得自行添加项目 LICENSE。

---

## 14. 风险与停止条件

| 风险 | 级别 | 处理 |
|---|---|---|
| Oracle 身份泄漏给 Locator | P0 | 不注入 DOM marker，只用 Node-side ElementHandle |
| baseline 本身不正确 | P0 | fixture invalid，不能计分 |
| Oracle 与生产分类器共用逻辑 | P0 | 独立实现和 golden |
| WRONG_TARGET 被误判 STABLE | P0 | 必须对象身份比较 |
| iframe 多匹配被误判 MISSING | P0 | 逐层 frame selector 先计数 |
| Oracle parity mismatch | P0 | 任一字段 mismatch = FAIL |
| 192 用例不全 | P0 | S0 gate 阻断 |
| hash 100 次不一致 | P0 | S0 gate 阻断 |
| 外部网络请求 | P0 | 任何一次即 FAIL |
| BFS 超上限 | P1 | 输出 bounded status |
| 分数被理解为生产概率 | P1 | UI 明示合成集指标 |
| 退化为 Locator 生成器 | P0 | STOP |
| 退化为普通 DOM diff | P0 | STOP，必须保留 Playwright + identity Oracle + BFS |
| 需要真人/真网/付费 API | P0 | STOP |

S0 失败即停工，T004–T014 锁定；不得通过真人、真实网站、在线 API 或人工豁免补救。

---

## 15. S0–S5 阶段定义

| 阶段 | 任务 | 内容 | 阶段门 |
|---|---|---|---|
| S0 | T001–T003 | Locator 解析与 Oracle、八种变异、S0 gate | 全部硬门通过，否则 STOP |
| S1 | T004–T006 | 四态、评分、canonical hash | 边界和 hash 测试全过 |
| S2 | T007–T008 | BFS、witness、API/JSON | 最短性和 Oracle parity |
| S3 | T009–T010 | Web UI、HTML/JSON 导出 | UI 主流程完整 |
| S4 | T011–T012 | 自动化、E2E、离线、性能 | 全部测试通过 |
| S5 | T013–T014 | 独立评审、正式冻结 | P0/P1=0，冻结闭合 |

当前仅 `READY_FOR_S0_ONLY / GO NOT DECLARED`。未获得明确授权不得开始 T001；S0 PASS 也不自动解锁 S1。

---

## 16. 最终交付物

规格阶段：
- PROJECT_BOOK.md / .docx
- IMPLEMENTATION_PLAN.md / .docx
- P022_SPEC_BUNDLE.zip（仅含上述四份规格）
- P022_SPEC_SHA256SUMS.txt（列出四文件和 bundle 共 5 项，不自指）

施工发布阶段：
- TypeScript/React/Playwright 本地应用；
- 24 合成 HTML + 24 LocatorSpec + Oracle manifest；
- M01–M08 变异引擎；
- Node-side identity Oracle；
- 四态、稳定性分数、≤6 步 BFS；
- JSON / 离线 HTML；
- 自动化证据、环境报告、依赖许可清单；
- REVIEW_INDEX.md、REVIEW_PACK_XX.md、独立评审；
- source.zip、dist.zip、RELEASE_MANIFEST.json、SHA256SUMS.txt。

---

## 17. 参考资料

1. Playwright Locators: https://playwright.dev/docs/locators  
   借鉴 CSS/role Locator 使用方式及面向用户的定位建议；不复制 Playwright 引擎。
2. Playwright FrameLocator: https://playwright.dev/docs/api/class-framelocator  
   借鉴 iframe 定位链；不做跨浏览器认证。
3. Playwright Other Locators: https://playwright.dev/docs/other-locators  
   借鉴 XPath selector 语法与边界；不自行实现 XPath 引擎。
4. agent-browser #2472: https://github.com/vercel-labs/agent-browser/issues/2472  
   iframe refs/frame selector 的公开故障线索；不推断 Playwright 同样有缺陷。
5. agent-browser #2246: https://github.com/vercel-labs/agent-browser/issues/2246  
   Shadow Root 扫描遗漏案例；不复制其 snapshot 实现。
6. Playwright GitHub: https://github.com/microsoft/playwright  
   核对版本和官方源码；不复制浏览器执行实现。

---

## 18. 诚实限制

- 无真人研究；`USER_VALUE_NOT_MEASURED`。
- 24×8、Oracle parity、误报率、四态覆盖和 100 次 hash 是未来验收门槛，尚未运行。
- Playwright/Chromium/Node 精确版本由 T001 实测后冻结；规格不声称已安装。
- 仅在指定 Playwright + Chromium 版本执行，不代表 Firefox/WebKit/Safari。
- CSS/XPath/role 是受限 JSON 合同，不是任意 Playwright API 序列化。
- 只支持 open ShadowRoot；closed ShadowRoot 不支持。
- iframe 深度上限 2；更深层拒绝或标 unsupported。
- stabilityScore 是合成变异集通过比例，不是生产失败概率。
- `BOUNDED_NO_WITNESS` 不证明所有 DOM 变化都安全。
- 许可证仍为 `PENDING_SAM_DECISION`。
- 当前状态 `SPEC_FROZEN / NOT_IMPLEMENTED / READY_FOR_S0_ONLY / GO NOT DECLARED`；无代码施工或测试通过声明。
