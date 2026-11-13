# LocatorStress 第三方依赖许可清单（THIRD_PARTY_NOTICES）

本清单列出 `locatorstress` 0.1.0 的全部第三方依赖包，逐一注明版本与
许可证。许可证名称以各包 `package.json` 的 `license` 字段为准；
已安装的包逐一核对了 `node_modules` 内 `package.json` 的 `license`
字段与 lockfile 的一致性，并记录了包内是否存在 LICENSE 文件。
本清单不构成法律意见；分发时请以各包自带的许可文本为准。

## 计数说明

- `package-lock.json`（lockfileVersion 3）的 `packages` 对象共 76 条，
  其中 1 条是根项目本身（键为空字符串，`locatorstress` 0.1.0），
  其余 **75 条为依赖包**，本清单列出全部 75 个，无遗漏、无重复。
- 直接依赖 **4 个**：`playwright` 1.65.0（生产依赖）；`typescript` 5.9.3、
  `vitest` 5.1.0、`@vitest/coverage-v8` ^5.1.0（开发依赖，lockfile 解析为
  5.1.0）。其余 71 个为传递依赖。
- 许可证分布：MIT 56 个、Apache-2.0 5 个、MPL-2.0 12 个、ISC 1 个、
  BSD-3-Clause 1 个，共 75 个。**没有任何一个包缺失 `license` 字段，
  因此本清单中没有“未声明”的条目。**
- 生成依据：`package.json`、`package-lock.json`（2026-11-11 读取），以及
  当时 `node_modules` 的实际安装状态。

## 核对方法与注记

1. **已安装的包（52 个）**：逐一读取 `node_modules/<包>/package.json` 的
   `license` 字段，与 lockfile 的 `license` 字段比对，**52 个全部一致，
   零不一致**。其中 48 个包内有 LICENSE 文件；以下 4 个已安装的包内
   没有 LICENSE 文件（其许可证仍以 `package.json` 的 `license` 字段为准）：
   `@rolldown/binding-linux-x64-gnu`、`@rolldown/binding-linux-x64-musl`、
   `std-env`、`tinyrainbow`。
2. **许可证文本**：本清单只记录许可证名称（SPDX 标识），不全文转载各包
   的许可文本；需要文本时请到对应包的安装目录或上游仓库取用。
3. **未安装的包（23 个）**：均为其他平台的原生绑定包（rolldown /
   lightningcss 的非 linux-x64 目标）或 macOS 专用的 `fsevents`，在
   本机 Linux x64 环境下 `npm ci` 不安装它们。其许可证取自 lockfile 的
   `license` 字段（npm 在生成 lockfile 时写入，与上游包的 `package.json`
   一致），表中“许可来源”栏已逐一标注。
4. 本项目自身的许可证状态不在此列，见 `release/LICENSE_STATUS.md`
  （PENDING_SAM_DECISION，仓库无 LICENSE 文件）。

## 清单

| 包名 | 版本 | 许可证 | 依赖关系 | 许可来源 |
| --- | --- | --- | --- | --- |
| `@babel/helper-string-parser` | 7.29.13 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `@babel/helper-validator-identifier` | 7.29.7 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `@babel/parser` | 7.29.13 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `@babel/types` | 7.29.11 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `@bcoe/v8-coverage` | 1.0.2 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `@jridgewell/resolve-uri` | 3.1.2 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `@jridgewell/sourcemap-codec` | 1.6.0 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `@jridgewell/trace-mapping` | 0.3.31 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `@oxc-project/types` | 0.156.0 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `@rolldown/binding-android-arm-eabi` | 1.2.18 | MIT | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `@rolldown/binding-android-arm64` | 1.2.18 | MIT | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `@rolldown/binding-darwin-arm64` | 1.2.18 | MIT | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `@rolldown/binding-darwin-x64` | 1.2.18 | MIT | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `@rolldown/binding-freebsd-x64` | 1.2.18 | MIT | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `@rolldown/binding-linux-arm-gnueabihf` | 1.2.18 | MIT | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `@rolldown/binding-linux-arm64-gnu` | 1.2.18 | MIT | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `@rolldown/binding-linux-arm64-musl` | 1.2.18 | MIT | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `@rolldown/binding-linux-ppc64-gnu` | 1.2.18 | MIT | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `@rolldown/binding-linux-s390x-gnu` | 1.2.18 | MIT | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `@rolldown/binding-linux-x64-gnu` | 1.2.18 | MIT | 传递依赖（dev） | package.json（该包无 LICENSE 文件） |
| `@rolldown/binding-linux-x64-musl` | 1.2.18 | MIT | 传递依赖（dev） | package.json（该包无 LICENSE 文件） |
| `@rolldown/binding-openharmony-arm64` | 1.2.18 | MIT | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `@rolldown/binding-win32-arm64-msvc` | 1.2.18 | MIT | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `@rolldown/binding-win32-x64-msvc` | 1.2.18 | MIT | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `@rolldown/pluginutils` | 1.1.0 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `@types/chai` | 5.2.3 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `@types/deep-eql` | 4.0.2 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `@types/estree` | 1.0.10 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `@vitest/coverage-v8` | 5.1.0 | MIT | 直接依赖（dev，package.json 锁定 ^5.1.0） | package.json + LICENSE 文件 |
| `@vitest/istanbul-lib-coverage` | 2.1.0 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `@vitest/istanbul-lib-report` | 2.1.0 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `@vitest/mocker` | 5.1.0 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `@vitest/spy` | 5.1.0 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `assertion-error` | 2.0.1 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `ast-v8-to-istanbul` | 1.0.8 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `chai` | 6.3.0 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `detect-libc` | 2.1.2 | Apache-2.0 | 传递依赖（dev） | package.json + LICENSE 文件 |
| `es-module-lexer` | 2.3.2 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `estree-walker` | 3.0.3 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `expect-type` | 1.4.0 | Apache-2.0 | 传递依赖（dev） | package.json + LICENSE 文件 |
| `fdir` | 6.5.0 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `fsevents` | 2.3.3 | MIT | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `js-tokens` | 10.0.0 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `lightningcss` | 1.33.0 | MPL-2.0 | 传递依赖（dev） | package.json + LICENSE 文件 |
| `lightningcss-android-arm64` | 1.33.0 | MPL-2.0 | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `lightningcss-darwin-arm64` | 1.33.0 | MPL-2.0 | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `lightningcss-darwin-x64` | 1.33.0 | MPL-2.0 | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `lightningcss-freebsd-x64` | 1.33.0 | MPL-2.0 | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `lightningcss-linux-arm-gnueabihf` | 1.33.0 | MPL-2.0 | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `lightningcss-linux-arm64-gnu` | 1.33.0 | MPL-2.0 | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `lightningcss-linux-arm64-musl` | 1.33.0 | MPL-2.0 | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `lightningcss-linux-x64-gnu` | 1.33.0 | MPL-2.0 | 传递依赖（dev） | package.json + LICENSE 文件 |
| `lightningcss-linux-x64-musl` | 1.33.0 | MPL-2.0 | 传递依赖（dev） | package.json + LICENSE 文件 |
| `lightningcss-win32-arm64-msvc` | 1.33.0 | MPL-2.0 | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `lightningcss-win32-x64-msvc` | 1.33.0 | MPL-2.0 | 传递依赖（dev） | lockfile（未安装于本机 node_modules，见注 3） |
| `magic-string` | 1.4.5 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `magicast` | 0.5.5 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `nanoid` | 3.3.20 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `obug` | 3.0.0 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `picocolors` | 1.1.1 | ISC | 传递依赖（dev） | package.json + LICENSE 文件 |
| `picomatch` | 4.0.7 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `playwright` | 1.65.0 | Apache-2.0 | 直接依赖（prod，package.json 锁定 1.65.0） | package.json + LICENSE 文件 |
| `playwright-core` | 1.65.0 | Apache-2.0 | 传递依赖 | package.json + LICENSE 文件 |
| `postcss` | 8.5.32 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `rolldown` | 1.2.18 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `source-map-js` | 1.2.2 | BSD-3-Clause | 传递依赖（dev） | package.json + LICENSE 文件 |
| `std-env` | 4.3.0 | MIT | 传递依赖（dev） | package.json（该包无 LICENSE 文件） |
| `tinybench` | 6.2.3 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `tinyexec` | 1.3.1 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `tinyglobby` | 0.2.17 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `tinyrainbow` | 3.2.0 | MIT | 传递依赖（dev） | package.json（该包无 LICENSE 文件） |
| `typescript` | 5.9.3 | Apache-2.0 | 直接依赖（dev，package.json 锁定 5.9.3） | package.json + LICENSE 文件 |
| `vite` | 8.3.7 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |
| `vitest` | 5.1.0 | MIT | 直接依赖（dev，package.json 锁定 5.1.0） | package.json + LICENSE 文件 |
| `why-is-node-running` | 3.2.1 | MIT | 传递依赖（dev） | package.json + LICENSE 文件 |

合计：75 个依赖包（直接依赖 4 个，传递依赖 71 个）。

## 许可证分布汇总

- MIT：56 个
- MPL-2.0：12 个
- Apache-2.0：5 个
- BSD-3-Clause：1 个
- ISC：1 个

## 直接依赖说明

- `playwright` 1.65.0（Apache-2.0，生产依赖）：浏览器自动化，运行
  定位器解析与变异实验；另带 `playwright-core` 1.65.0（Apache-2.0）
  作为其唯一直接依赖。
- `typescript` 5.9.3（Apache-2.0，开发依赖）：编译（`npm run build` /
  `npm run typecheck`）。
- `vitest` 5.1.0（MIT，开发依赖）：测试运行器（`npm test`）。
- `@vitest/coverage-v8` ^5.1.0 → 解析为 5.1.0（MIT，开发依赖）：
  覆盖率（`npm run test:coverage`）。
