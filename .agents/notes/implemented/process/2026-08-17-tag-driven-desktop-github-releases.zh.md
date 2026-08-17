# Agent Note: 标签驱动的桌面 GitHub 发布

Status: implemented

[English](2026-08-17-tag-driven-desktop-github-releases.md) | 中文

## 问题

桌面应用已有本地打包命令，但仓库没有生成可下载 macOS 和 Windows 应用的工作流。既有发布工作流分别发布 NPM、Python、vendored 和 native 包族；扩展其中任何一个都会把桌面产物与另一条版本线和发布目的地绑定在一起。

桌面发布还需要在目标平台原生暂存运行时。单一宿主可以交叉打包部分 Electron shell，但不能证明已暂存的 Host 依赖树与目标操作系统和架构一致。

## 决策

`.github/workflows/desktop-release.yml` 负责桌面 GitHub Releases。推送 `vX.Y.Z` 标签会启动一个原生 macOS Apple Silicon 任务和一个原生 Windows x64 任务。每个任务都会执行不可变安装、确认标签与 `apps/desktop/package.json` 一致、确认 runner 架构、构建仓库、暂存 Host 运行时，并让 Electron Builder 生成可分发文件。

macOS 任务生成未签名的 DMG 和 ZIP 文件。Windows 任务生成未签名的 NSIS 和 ZIP 文件。每个任务只上传这些可分发格式；未封装目录和更新元数据不会进入 Release。Release 任务获得 `contents: write`，构建任务保持只读仓库权限；它等待两端构建完成后创建带标签的 GitHub Release。重新运行时会用 `--clobber` 上传同名文件，而不会创建另一个 Release。

桌面包携带独立的 `1.0.0` 应用版本。它不会改变 Harness NPM 包族共享的预发布版本；该包族的 `dsh-v*` 标签和注册表发布仍然独立。

公开仓库没有分发凭据，因此工作流显式关闭 macOS 签名和公证。经过凭据校验的本地 macOS 命令仍负责生成已签名且经过公证的 DMG。

## 曾考虑的替代方案

**在一个 runner 上构建两个平台。** Electron Builder 可以交叉打包部分目标，但已暂存运行时包含按平台选择的依赖。原生 runner 让安装、暂存和打包处在同一操作系统和架构上。

**只发布未封装的应用目录。** 目录适合本地验证，但不便作为 GitHub Release 下载。DMG、NSIS 和 ZIP 同时覆盖安装与便携检查，又无需提交生成输出。

**首次公开发布前必须完成签名。** 当前未配置 Apple 或 Windows 签名凭据。在凭据存在前让工作流始终失败不会提供任何可下载版本；静默尝试签名则可能生成不一致结果。产物被明确标记为未签名，文档也说明了这一限制。

## 后果

任一平台开始构建前，标签必须与桌面包版本一致。任一平台失败都会阻止创建 Release，因此已发布的 Release 总是包含两个受支持桌面目标。由于产物未签名，用户可能遇到操作系统警告。增加 Windows 签名或自动 Apple 签名需要单独决定凭据与信任方案，而不是扩大构建任务权限。
