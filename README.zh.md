# DeepSeek Harness Desktop

[English](README.md) | 中文

DeepSeek Harness Desktop 将本地 DeepSeek Harness Web UI 与 [DeepSeek Chat 官方网页](https://chat.deepseek.com/) 集成到同一个原生桌面窗口中。用户可以通过标题栏切换 `Chat` 与 `Harness`，同时保持两个模式的账户、对话、凭据和存储彼此独立。

> 本项目是基于 DeepSeek Harness 构建的社区桌面项目，并非 DeepSeek 官方产品，也不会绕过官方网站的登录、WAF 或嵌入策略。

## 截图

### Chat 模式

Chat 模式在隔离且持久的浏览器分区中打开 DeepSeek 官方网页。截图展示的是未登录入口；用户可以通过网站自身的界面完成登录。

![DeepSeek Chat 模式](assets/screenshots/chat-mode-home.png)

### Harness 模式

Harness 模式运行本地 Web UI，并提供工作区侧栏、会话列表和 agent（智能体）输入区。

![DeepSeek Harness 模式](assets/screenshots/harness-mode-home.png)

## 主要功能

- **一个窗口提供两种模式。** Chat 与 Harness 是相互独立的保留视图，通过原生标题栏直接切换。
- **嵌入官方 Chat。** Chat 直接加载 `https://chat.deepseek.com/`，认证信息保存在独立的 Electron 分区中，不会成为 Harness 模型提供方。
- **本地 Harness 运行时。** Harness 启动并监管本地 Host、Web UI、会话、工作区、工具和 agent（智能体）配置。
- **状态彼此隔离。** 两种模式不共享 Cookie、凭据、对话、附件、提示词或导航状态。
- **主题同步。** 亮色、暗色和系统主题会在两种模式之间同步，同时保留各自页面的渲染实现。
- **原生桌面行为。** macOS 与 Windows 使用适配平台的标题栏控件；macOS 侧栏几何会避开模式切换器，不发生遮挡。
- **MIT 许可证。** 仓库包含 MIT 许可证；第三方包继续保留各自的许可证声明。

## 平台支持

当前桌面组合支持：

- macOS Apple Silicon（`arm64`），已在本地验证。
- Windows（`x64`），由 Electron Builder 配置负责打包。

底层 Harness Web UI 仍可在 Linux 上运行，但原生桌面打包目前不以 Linux 为发布目标。

## 环境要求

- Node.js `^22.19.0` 或 `>=24.0.0`
- pnpm `11.7.0`
- Harness 发起模型请求时，需要根据所选 profile 提供 DeepSeek API key。
- 用于 Electron 开发或打包的受支持桌面系统。

<a id="run"></a>

## 从源码运行

```sh
pnpm install
pnpm run dev:desktop
```

开发命令会先构建所需的 Host、client、Web 和 Electron 层，然后打开桌面应用。首次选择 Chat 时会打开官方网站，用户可以按网站流程完成登录。

## 构建桌面产物

```sh
pnpm run package:desktop
```

打包命令会构建应用、暂存 Host 运行时依赖树，并为当前平台创建未签名的应用目录。macOS 签名分发所需的凭据和流程见[桌面发布指南](apps/desktop/README.md#signed-macos-dmg)。

## 仓库结构

```text
apps/desktop/       Electron 应用、原生外壳和双模式控制器
apps/web/           Harness Web 前端
packages/           Harness 与 client 插件 workspace
assets/screenshots/ README 截图资源
docs/               架构、测试和贡献文档
vendor/             固定版本的 Cordis 源码
```

Harness 的核心架构和插件约定仍由上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 项目负责。本仓库增加桌面组合和平台集成。

## 参与贡献

修改仓库前请阅读 [AGENTS.md](AGENTS.md) 和[开发指南](docs/development.md)。桌面范围的聚焦检查包括：

```sh
pnpm --filter @deepseek-ai/dsh-desktop run typecheck
pnpm --filter @deepseek-ai/dsh-desktop run test:electron
pnpm run build:desktop
```

请不要提交生成的 `lib/`、`dist/`、`runtime-host/`、`node_modules/` 或 Playwright 输出目录。

## 许可证

本项目按照 [MIT License](LICENSE) 开源。

DeepSeek 与 DeepSeek Chat 是其各自所有者的商标和服务。嵌入官方网站仍须遵守网站当前的服务条款和技术策略。
