# Agent Note: DeepSeek Desktop 产品身份

Status: implemented

[English](2026-08-17-deepseek-desktop-product-identity.md) | 中文

## 问题

原生应用同时整合 DeepSeek 官方 Chat 网站和本地 Harness 工作区，因此用 Harness 模式的名称命名整个桌面产品会产生误导。

## 决策

公开桌面产品名称统一为 **DeepSeek Desktop**。Electron 窗口和托盘标题、外壳文档标题、打包产品名、README 标题、发布标题和 GitHub 仓库都使用该名称。**Chat** 与 **Harness** 仍然是两种模式的名称，Harness 仍然表示上游运行时和技术架构。

现有 Electron `appId` `ai.deepseek.harness.desktop` 保持不变，使已安装的发布版本在产品改名后继续保留应用身份。内部包名、协议通道、文件系统键和上游 Harness 文档保持不变。

## 考虑过的替代方案

**继续使用 DeepSeek Harness Desktop 作为公开名称。**不采用，因为它描述的是本地模式，而不是 Chat 与 Harness 组合后的产品。

**重命名所有 Harness 包和协议标识符。**不采用，因为这些标识符描述上游运行时，重命名会带来兼容性变更，却不会改善用户看到的产品名称。

**修改 Electron `appId` 并移除 `harness`。**不采用，因为该标识符对用户不可见，修改后可能让已安装版本在更新时被系统视为另一个应用。

## 后果

用户会在原生窗口、托盘、安装包、README 和 GitHub Releases 中看到 DeepSeek Desktop，同时仍能清楚识别 Harness 本地智能体模式。macOS 应用目录和可执行文件名改为 `DeepSeek Desktop.app` 与 `DeepSeek Desktop`；打包和进程测试会固定这些名称。稳定的 `appId` 保留现有应用身份，但截图、链接和发布文案仍须把改名后的产品作为新的公开品牌处理。
