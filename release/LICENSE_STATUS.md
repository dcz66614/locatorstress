# LocatorStress 许可证状态

## 项目许可证：待决定（PENDING_SAM_DECISION）

本项目（`locatorstress`，版本 `0.1.0`）的许可证**尚未决定**，状态为
**`PENDING_SAM_DECISION`**，由 Sam 决定。

在 Sam 决定之前：

- **不要**为本项目生成 `LICENSE` 文件；
- **不要**声称本项目适用任何许可证（包括 MIT、Apache-2.0 或其他）；
- **不要**在 README、用户指南、复现指南、代码注释或对外材料中暗示
  本项目已有许可证；
- 任何关于许可证的提问，答案都是“待 Sam 决定”，不要自行推断或代选。

## 当前事实（已核实）

- 仓库根目录**没有 `LICENSE` 文件**（2026-11-11 核实，不存在）。
- `package.json` 中**没有 `license` 字段**。
- 本文件（`release/LICENSE_STATUS.md`）的存在本身不构成许可证；它只是
  记录“尚未决定”这一状态。
- 项目书与实施计划（`P022_PROJECT_BOOK.md` /
  `P022_IMPLEMENTATION_PLAN.md`）中记录的状态同样是
  `LICENSE PENDING_SAM_DECISION`，与本文件一致。

## 第三方依赖的许可证

第三方依赖的许可证与本项目的许可证状态无关，见
`release/THIRD_PARTY_NOTICES.md`。该清单列出 `package-lock.json` 中的
全部 75 个依赖包（直接依赖 4 个，其余为传递依赖），逐一注明版本与许可证。
使用、复制或分发本项目时，仍须遵守各第三方依赖自身的许可证条款；
在项目许可证决定之前，不得以“项目尚未定许可证”为由忽略第三方的许可要求。

## Sam 决定之后

Sam 决定许可证后，由负责发布的人员（T014 或其后续任务）在仓库根目录
添加对应的 `LICENSE` 文件，并在 `package.json` 中补 `license` 字段，
同时更新本文件：写明已选的许可证、决定日期与 `LICENSE` 文件的 SHA-256。
在那之前，本文件保持原样，不得提前填写。
