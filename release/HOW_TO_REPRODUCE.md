# LocatorStress 复现指南

本文说明如何在干净环境下复现 LocatorStress 的冻结结果。所有版本号与
哈希值均为实测值或冻结证据文件中的值；如果你的复现结果与本文不一致，
先核对环境表，再看“常见复现失败”一节，不要改代码去“凑”结果。

## 1. 环境

复现环境的实测记录见 `ENVIRONMENT_REPORT.md`。要求如下：

| 项目 | 要求值（实测） |
| --- | --- |
| 操作系统 | Ubuntu 24.04.5 LTS，Linux 7.0.0-44-generic x86_64（只在 Linux 上验证过；**Windows 未测试**） |
| CPU / 内存 | 4 vCPU 可见；内存 7934 MiB（门禁跑满 192 个浏览器用例，内存不足会失败） |
| Node.js | `v24.22.1`（`package.json` 的 `engines` 要求 `>= 24`） |
| npm | `10.9.4` |
| TypeScript | `5.9.3`（devDependency，精确锁定） |
| Vitest | `5.1.0`（devDependency，精确锁定） |
| Playwright | `1.65.0`（dependency，精确锁定） |
| Chromium | `158.0.8127.18`（Playwright revision 1254；可执行文件 `~/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`） |
| 网络 | 不需要。运行全程零外部请求；浏览器只加载本地合成 HTML |

核对命令：

```bash
node --version        # 预期 v24.22.1
npm --version         # 预期 10.9.4
npx tsc --version     # 预期 Version 5.9.3
~/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome --version
                      # 预期 Google Chrome for Testing 158.0.8127.18
```

注意：

- Chromium 只认 revision 1254（`158.0.8127.18`），运行器启动后会断言
  `browser.version()` 等于该值，不符即失败，**无回退**。本机缓存里还
  有一个旧的 `chromium-1248`（156.0.8078.4），它不会被使用。
- 启动参数固定为 headless、`--no-sandbox`、`--disable-dev-shm-usage`，
  视口 1280×800。
- 不需要执行 `npx playwright install`：复现使用已缓存的 chromium-1254；
  若缓存缺失，安装行为不在本指南保证范围内。

固定 seed：`P022-LOCATORSTRESS-S0-2026-11-10`。它写在
`evidence/s0/S0_GATE.json` 的 `seed` 字段与各 fixture 的 Oracle 清单里；
门禁与报告都使用该 seed，不要改动。

## 2. 安装与构建

```bash
git clone <仓库地址>          # 或使用已有的工作区副本
cd p022-locatorstress
npm ci                        # 严格按 package-lock.json 安装
npm run build                 # tsc 编译到 dist/，预期无错误输出
```

- `npm ci` 而不是 `npm install`：前者严格按 lockfile 安装，后者可能改动
  lockfile。复现时 lockfile 不得变化。
- `npm run build` 即 `tsc`；`npm run typecheck` 即 `tsc --noEmit`。
  两者都应 exit 0 且无错误输出。
- `node_modules/` 与 `dist/` 在 `.gitignore` 中，不进入版本控制。

## 3. 跑 S0 门禁：预期 `GATE PASS`

```bash
npm run s0:gate
```

该命令即 `npm run build && node scripts/s0-gate.ts`，依次跑：确定性分析
（24 页面 × baseline + 8 变异）、P2-A detach 回归、哈希重放。耗时几分钟，
日志按阶段输出，例如：

```text
stage environment
stage fixtures
stage offline-scan
stage baseline
baseline 24/24
stage mutations
fixture F001 8/8 done
fixture F002 8/8 done
...
fixture F024 8/8 done
GATE PASS failure_type=null gate_sha256=651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52
```

预期结果（与冻结证据 `evidence/s0/S0_GATE.json` 一致）：

| 检查项 | 预期值 |
| --- | --- |
| 门禁结果 | `GATE PASS`，`failure_type=null` |
| 用例 | 192/192 完成（24 页面 × 8 变异；baseline 24/24） |
| Oracle parity | 192/192 匹配，0 不匹配 |
| 稳定性分数 | `71.875`（STABLE 138 / 192） |
| verdict 分布 | STABLE 138、WRONG_TARGET 22、AMBIGUOUS 17、MISSING 15 |
| 对照组 | 稳定控制误报 0/96；脆弱控制检出 96/96 |
| 外部请求 | 0（`externalRequests: 0`，`blockedRequests: 0`） |
| 静态离线扫描 | 0 命中 |
| 重放 | 100 次运行，1 个 gate hash |
| `gate_sha256` | `651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52` |
| `scenario_sha256` | `1ffb5f85561c6dd9f10fc15773097691c5c07fe20c6e9a001e231a41b61c9f22` |
| `oracle_result_sha256` | `3502d81fa730605dd85548e39af6b7272015c026e65f91a2dae132c3e345a988` |
| `analysis_sha256` | `4410d5c85cf5fe8ee858c4e01822cdbc1515c39afa7ba40d833aceb00a9576a4` |

核对门禁证据文件（门禁跑完后重新生成；冻结值如下）：

```bash
sha256sum evidence/s0/S0_GATE.json
# 预期 15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d
python3 -c "import json; d=json.load(open('evidence/s0/S0_GATE.json')); print(d['result'], d['hashes']['gate_sha256'], d['replay'])"
# 预期 PASS 651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52
#       {'gate_sha256': '651c3fd4...', 'matchesMainGateHash': True, 'runs': 100, 'uniqueGateHashes': 1}
```

注意：`S0_GATE.json` 的 `notes` 里有一条冻结说明——BFS 见证在 S0 门禁
对象里是占位符 `NOT_IMPLEMENTED_S0`（T007 在 S2 才实现）；T008 完整报告
使用自己的 schema（`locatorstress.analysis-report/v1`）与真实 BFS 见证，
其 `analysis_sha256` 与 S0 的值不同是**符合设计**的，不要把两者混为一谈。

## 4. 跑全部测试：预期 511/511

```bash
npm test
```

预期：**511 个测试全部通过**（T012 冻结记录：`npm test 509/509`——该记录为 T012 冻结时的 509，FIX-03 新增 2 个测试后现为 511；
另有 `npm run build` 0 错、`test:e2e` 7/7、`test:offline` 6/6、
`test:performance` 4/4、`test:stress` 6/6、mutation 40/40 = 100%、覆盖率
70.03%）。各子集也可单独跑（脚本见 `package.json`），例如：

```bash
npm run test:verdict     # 四态分类测试
npm run test:score       # 稳定性分数测试
npm run test:bfs          # BFS 测试
npm run test:canonical   # 规范 JSON / 哈希契约测试
npm run test:export      # HTML 导出测试
npm run test:ui          # UI 流程测试（先 build）
npm run test:e2e         # 端到端主流程（先 build）
npm run test:offline     # 离线测试（先 build）
npm run test:performance # 性能测试（先 build）
npm run test:stress      # 压力测试（先 build）
```

## 5. 生成 T008 完整报告（可选复现）

```bash
npm run report:t008
```

生成 `evidence/s2/T008_API_REPORT.json`。脚本跑真实分析（24 页面 ×
baseline + 8 变异）与 BFS 抽样（F001 深度 2 为 `BOUNDED_NO_WITNESS`；
F002 深度 1 为 `FOUND [M01] WRONG_TARGET`；F003 深度 1 为
`FOUND [M04] AMBIGUOUS`；F001 深度 6、展开上限 8 为缩减预算的
`BOUNDED_INCOMPLETE` 演示），写出后重读并重算全部四层哈希自检。
该报告的 `gate_sha256` 与 S0 门禁值不同是符合设计的（见 §3 末尾）。

## 6. 验证 source.zip 与 git archive 一致（T014 冻结步骤）

以下步骤**由 T014 在冻结 commit 后执行**，本文只给出命令占位与核对方法，
不代表已经执行、也不代表结果已通过：

```bash
# 1. 在冻结 commit 上生成 git archive（T014 执行，commit 待冻结时确定）
git archive --format=zip --prefix=locatorstress/ <冻结 commit> -o /tmp/source-git.zip

# 2. 解包 source.zip 与 git archive，逐文件比较路径与字节（T014 执行）
mkdir -p /tmp/check-source /tmp/check-archive
unzip -q release/source.zip -d /tmp/check-source
unzip -q /tmp/source-git.zip -d /tmp/check-archive
diff -r /tmp/check-source /tmp/check-archive && echo "ARCHIVE MATCH"

# 3. 核对 SHA256SUMS（T014 执行；SHA256SUMS 不自指）
sha256sum -c release/SHA256SUMS.txt
```

冻结要求（IMPLEMENTATION_PLAN §12）：冻结 commit 后工作树 clean；
`source.zip` 由该 commit 的 `git archive` 生成；解包后与同 commit 的
`git archive` 逐文件路径、字节一致；`dist.zip` 只含分发物与必要文档；
manifest 列出 commit、版本、文件清单、字节数、SHA；任一文件不一致，
冻结包作废，不得通知完成。**在 T014 完成之前，`release/source.zip`、
`release/dist.zip`、`release/RELEASE_MANIFEST.json`、
`release/SHA256SUMS.txt` 均不存在，不要假设它们已生成。**

## 7. 常见复现失败

| 现象 | 可能原因与处理 |
| --- | --- |
| `GATE FAIL`，Chromium 版本不符 | 缓存的 Chromium 不是 revision 1254 / 158.0.8127.18。不要换版本“凑合”；恢复正确的缓存后重跑 |
| 门禁中途报外部请求非 0 | 运行环境有代理或页面加载了外部资源。检查 `HTTPS_PROXY` 等环境变量；本项目运行不依赖任何代理 |
| `npm ci` 改动了 lockfile 或装了不同版本 | 确认用的是 `npm ci` 而非 `npm install`；确认 Node/npm 版本与 §1 一致 |
| `npm test` 个别失败，但门禁通过 | 先确认工作树 clean、没有未提交的本地改动；再按失败的测试名跑对应子集定位。不要改 golden 或 fixtures 去迎合测试 |
| 写出的文件是 0 字节 | 本机 VM 存储偶发 EPERM 抖动所致，不是产品缺陷。删掉 0 字节文件重跑一次；重跑后用 `ls -l` 与 `sha256sum` 核对 |
| Windows 上跑不起来 | 预期内：只在 Linux 上验证过，Windows 未测试。请在 Linux 环境复现 |

## 8. 复现检查清单

- [ ] `node --version` 为 `v24.22.1`，`npm --version` 为 `10.9.4`
- [ ] Chromium 为 `158.0.8127.18`（revision 1254）
- [ ] `npm ci` 与 `npm run build` 均成功
- [ ] `npm run s0:gate` 输出 `GATE PASS`，gate hash 与 §3 一致
- [ ] `evidence/s0/S0_GATE.json` 的 SHA-256 为
      `15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d`
- [ ] `npm test` 为 511/511 通过
- [ ] 运行全程外部请求为 0
