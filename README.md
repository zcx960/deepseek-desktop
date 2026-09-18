# DeepSeek Desktop Chat

[English](README.en.md) · [下载安装包](https://github.com/zcx960/deepseek-desktop/releases) · [GitHub Actions](https://github.com/zcx960/deepseek-desktop/actions/workflows/build-chat.yml)

在同一个桌面窗口中使用 **Harness** 和 **DeepSeek 官方 Chat**。顶部切换模式，两边页面保持打开，未发送的输入不会因切换丢失。

本项目基于 [dsh-tauri/deepseek-harness-desktop](https://github.com/dsh-tauri/deepseek-harness-desktop) 的 Tauri 2 + React 桌面端重做，基础提交为 `bd4da3aee51d65061001857e4234a8942ceca6ff`。当前版本为 `0.15.4-chat.1`，应用名称为 **DeepSeek Desktop Chat**。这是社区衍生项目，并非 DeepSeek 官方桌面客户端。

## 功能

- **Harness / Chat 切换**：Harness 保留原有内核、档案、插件和会话功能；Chat 打开 `https://chat.deepseek.com/`。
- **独立登录存储**：Chat 使用独立持久化 WebView 存储，与 Harness 的 API Key、会话和设置分开。
- **恢复上次模式**：重新启动后自动回到上次选择的模式。
- **Chat 工具栏**：刷新页面、在浏览器打开、确认后清除本地 Chat 数据。
- **独立故障处理**：Chat 加载失败时可以重试或使用浏览器，仍可切回 Harness。
- **访问隔离**：Chat 页面不能调用桌面 Tauri 命令；其他网站的 HTTP(S) 链接交给系统浏览器。

清除 Chat 数据会退出所有应用窗口中的 Chat 登录并清除本地 Cookie、缓存和网站存储，不会删除官网在线对话或 Harness 数据。

## 下载与运行

到本仓库的 [Releases](https://github.com/zcx960/deepseek-desktop/releases) 下载名称为 **DeepSeek Desktop Chat**、标签以 `chat-build-` 开头的预发布版本。较早的 `v0.2.0` 属于旧 Electron 实现。

| 系统 | 安装包 | 要求 |
| --- | --- | --- |
| macOS Apple Silicon | 文件名含 `aarch64-apple-darwin` 的 `.dmg` | 内嵌 Chat 需要 macOS 14+ |
| macOS Intel | 文件名含 `x86_64-apple-darwin` 的 `.dmg` | 内嵌 Chat 需要 macOS 14+ |
| Windows x64 | `.exe`（NSIS）或 `.msi` | Windows 10+，WebView2 |
| Linux x64 | `.AppImage` 或 `.deb` | 基于 Ubuntu 22.04 构建 |

安装后启动应用，选择顶部 **Chat** 并自行登录 DeepSeek 账号。Chat 使用官网账号，不使用 Harness 的 API Key。Harness 按原有流程启动本地内核，首次准备运行环境需要网络；Chat 和远程模型调用也需要网络。

当前安装包未签名，macOS 包未经过 Apple 公证，系统可能提示无法验证开发者。桌面端采用手动更新，以避免上游安装器覆盖 Chat 功能；Harness 内核仍可在应用内更新。每次构建附带 `SHA256SUMS-*.txt` 和 `build-info-*.json`，可核对安装包校验值和源码提交。

## 使用限制

- macOS 14 以下可使用 Harness 和浏览器入口，不提供内嵌持久化 Chat。
- 跨域登录弹窗交给系统浏览器，浏览器的登录状态不会自动导入应用。官网变更或限制内嵌浏览器时可能影响登录。
- 已在 Apple Silicon 上验证模式切换、草稿保留、存储隔离、清除数据、设置弹窗和全屏，并加载官方登录页；未使用真实账号完成登录或发消息。
- GitHub Actions 的跨平台打包成功不等于各平台原生交互已实测。完整记录见 [验证说明](docs/CHAT_MODE_QA.md)。

新版使用独立应用标识 `io.github.deepseek-desktop.chat`，不会自动迁移旧 Electron 版的桌面设置或 Chat 登录数据。Harness 数据继续遵循基底项目的 `~/.dsh` 档案规则。旧版源码仍保留在 Git 历史中。

## 开发

需要 Node.js 24+、项目指定的 pnpm、Rust stable，以及相应平台的 Tauri 构建依赖。

```sh
git clone https://github.com/zcx960/deepseek-desktop.git
cd deepseek-desktop
pnpm install --frozen-lockfile
pnpm build:plugins
pnpm dev:desktop
```

```sh
pnpm typecheck
pnpm exec vitest run
node --test scripts/collect-chat-artifacts.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib
pnpm tauri build --no-sign
```

macOS 上运行完整 Vitest 测试时使用 `TMPDIR=/private/tmp pnpm exec vitest run`，避免 Git 与 Node 对系统临时目录符号链接的解析差异。Chat 架构、本地 smoke 测试和存储实现见 [Chat 开发说明](docs/CHAT_MODE.md)。

## GitHub Actions 打包

打开 [Build Chat installers](https://github.com/zcx960/deepseek-desktop/actions/workflows/build-chat.yml)，选择 **Run workflow**：

1. 选择要构建的分支，默认使用 `main`。
2. 需要发布到 Releases 时勾选 `publish_release`；仅 `main` 支持发布。
3. 流程先执行类型检查和测试，再并行打包 macOS 两种架构、Windows x64 和 Linux x64。
4. 四个平台产物全部完成后才发布预发布版本。仅打包时可从该次运行的 **Artifacts** 下载，保留 30 天。

流程不需要 Apple 或 Windows 签名密钥，使用锁定的依赖文件构建并记录源码提交。发布采用独立的 `chat-build-<运行编号>` 标签，旧版上游签名发布流程不在此仓库执行。

## 基底与许可证

Tauri 外壳、Harness 安装与进程管理、内置插件等能力来自 [deepseek-harness-desktop](https://github.com/dsh-tauri/deepseek-harness-desktop)；Agent 内核来自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。本仓库在此基础上增加 Chat 模式和独立构建发布流程。

保留上游 [MIT 许可证](LICENSE) 与 [禁止商业二次开发的附加条款](LICENSE.details)，以及原作者版权声明。
