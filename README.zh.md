<h1 align="center">DSH Desktop</h1>

<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> 的本地优先、跨平台桌面应用。
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh.md">简体中文</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-171513.svg" /></a>
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple%20Silicon%20%7C%20Intel-171513.svg" />
  <img alt="Windows" src="https://img.shields.io/badge/Windows-x64-171513.svg" />
</p>

> [!NOTE]
> **本项目是二开版本。** 它基于
> [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop)——DeepSeek
> Harness 的社区桌面外壳——做二次开发。下文描述的桌面宿主能力**全部来自该项目**；
> 本仓库只新增了[「本版本新增」](#本版本新增)一节的 Chat 模式，并把品牌图形统一替换为
> DeepSeek 官方标识。详见[与上游的关系](#与上游的关系)。

DSH Desktop 把本地的 DeepSeek Harness 体验打包成可安装的桌面程序。它会自动启动 Harness，把配置、插件、工作区、模型设置和会话保存在应用安装目录之外，并在本地运行时就绪后立即打开完整的 Harness 界面。

> [!IMPORTANT]
> 本版本基于快速演进的 `@deepseek-ai/dsh@0.1.5-rc.2`，属于早期预览。macOS 版本已由 Apple 签名并公证。Windows x64 安装包已代码签名；随着发布者积累下载与安装信誉，Windows 安全提示可能会逐步减少。

## 与上游的关系

本仓库不是独立产品。它以
[dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop)
为底座，只改了两件事：

| 方面 | 上游 | 本仓库 |
| --- | --- | --- |
| 品牌 | 自有鲸鱼标识、侧边栏图形、启动动画与应用图标 | DeepSeek 官方标识，取自 `@deepseek-ai/dsh-client-ui-primitives` |
| 模式 | 仅 Harness | Harness + 内嵌的 DeepSeek Chat 模式 |

其余部分——运行时托管、配置与插件维护、安全模式、手机访问、PPT 运行时、预设包、更新流程——都是上游的工作，除上述品牌替换外原样保留。这些子系统的问题请反馈给上游；Chat 模式与品牌相关的请反馈到本仓库。

上游的 README、其多语言版本、截图和社群邀请已从本仓库移除，因为它们描述的是另一个产品。

## 本版本新增

**Chat 模式。** 在 Harness 之外增加第二个顶层界面，内嵌 DeepSeek 官方 Chat 网站，通过标题栏的切换器进入：

- Chat 运行在**独立的 Electron 持久化分区**中，其登录态和浏览数据不会接触 Harness 的配置。
- Chat 显示时 Harness **仍在底层运行**，所以会话、后台任务和进行中的工具调用都不会中断，切回 Harness 无需重新加载。
- 导航白名单只信任 Chat 的精确来源，其余链接交给系统浏览器打开。
- 共享主题偏好跟随**当前显示的模式**，原生窗口装饰与切换器跟随解析后的明暗方案。

**官方品牌。** 应用图标、启动动画、侧边栏标识和会话页标识全部使用 DeepSeek 官方图形，替换了上游项目自有的图形。

## 下载

安装版会在启动后不久检查更新，之后每六小时检查一次。有新版本时，DSH Desktop 会先询问是否下载；只有在你选择 **Restart and install** 之后才开始安装。你也可以从应用菜单手动检查，或跳过某个版本而不隐藏后续版本。

原版的安装包位于[上游 Releases](https://github.com/dataelement/dsh-desktop/releases)。本仓库暂不发布安装包，请按[开发指南](docs/development.md)从源码构建。上游标注 **Pre-release** 的版本紧跟官方 DeepSeek Harness 最新版本，可能与社区插件不兼容。

## DSH Desktop 补齐的能力

DeepSeek Harness 已提供 Agent 运行时与 Web UI。DSH Desktop 补齐了一个实用桌面产品所需的原生宿主能力：

- 无需单独打开 CLI 或浏览器标签页即可启停 Harness
- 使用系统原生目录选择器添加和管理项目工作区
- 支持官方 DeepSeek 模型与主流第三方模型提供方
- 把完整的自定义 Agent 预设导入导出为便携的 [`.dshpreset` 包](docs/preset-packages.md)，安装前有冲突检查与信任提示
- 通过内置 PPT 模式把素材转成可编辑的 PPTX 文稿
- 跨应用升级保留配置、插件、工作区、会话与模型设置
- 检测启动期与前端插件故障，把诊断写入 `harness.log` 并提供引导式恢复操作
- 提供非破坏性的安全模式，临时屏蔽第三方插件
- 让已配对的手机通过局域网或可选的临时公网隧道继续会话
- 检查桌面更新，下载与安装始终由用户掌控
- 针对 macOS 与 Windows 适配原生菜单、标题栏行为、窗口焦点、主题与应用品牌

## PPT 生成

启用 **PPT** 按钮，选择模板，然后描述你需要的文稿。内置目录包含 **16 个模板、192 种版式**，输出可编辑的 PPTX。预览使用英文；实际文稿可用英文或中文，并有对应字体设置。预览语言不决定输出语言。

PPT 为预装功能，其自动指令仅对启用了 PPT 按钮的会话生效。模板、校验与来源说明见 [PPT 运行时指南](packages/ppt-runtime/README.md)。

## 手机访问

从 `Harness` 菜单选择 **Connect Phone…** 并扫描配对码。手机要访问会话之前，桌面端会先要求你批准该连接。

Harness 本身仍只监听随机的 `127.0.0.1` 端口。手机访问使用独立的配对桥接，可以停留在局域网，也可以在你选择远程访问时使用临时的 Cloudflare Quick Tunnel。手机与桌面端断开后，该移动会话即失效。

如果 Cloudflare 启动失败，应用会尝试 Pinggy。如果出现了 Cloudflare 配对链接但手机打不开，选择 **Can’t open? Try another link** 切换到 Pinggy。

## 安全模式与恢复

如果第三方插件影响了启动或渲染，DSH Desktop 可以根据运行时与前端证据定位到相关插件，并打开引导式恢复界面。

从 `Harness` 菜单选择 **Restart as Safe Mode…** 会启动一个只含官方核心 bundle 的隔离配置。Agent、会话、模型设置和工作区仍然可用，而正常配置中的第三方插件保持屏蔽。你可以在安全模式横幅中移除选中的插件，或返回正常启动。

恢复界面会检查插件是否有兼容更新；有可用版本时可以升级对应插件，安全模式还支持批量升级。

如果无法进入正常界面，请带 `--safe-mode` 启动 DSH Desktop。macOS 下：

```sh
open -a "DSH Desktop" --args --safe-mode
```

## 本地数据与安全

- Harness Web UI 只在随机回环端口上提供服务。
- 渲染进程没有 Node.js 权限，并启用上下文隔离与沙箱。
- 屏蔽 Webview、不可信的应用内导航以及意外的权限请求。
- 外部网页链接交给系统浏览器打开。
- 用户配置与会话位于 Electron 的每用户应用数据目录，而不是安装目录内。
- 手机访问需要短期配对令牌和桌面端的显式批准。
- DeepSeek Chat 运行在独立的持久化分区中，与 Harness 配置相互隔离。

## 平台支持

| 平台 | 分发方式 | 状态 |
| --- | --- | --- |
| macOS Apple Silicon | 签名并公证的 DMG/ZIP | 支持 |
| macOS Intel | 签名并公证的 DMG/ZIP | 支持 |
| Windows x64 | 代码签名的 NSIS 安装包 | 支持 |
| Windows ARM64 | — | 暂不支持 |
| Linux | — | 暂不支持 |

Harness 包含目标平台的原生依赖，因此每个发布产物都在对应的操作系统与架构上构建。

## 开发与架构

请从上游继承的工程文档开始：

- [开发指南](docs/development.md) — 环境搭建、验证、补丁维护与目标平台原生打包
- [架构](docs/architecture.md) — 运行时流程、持久化数据、安全边界、恢复、移动访问与更新
- [发布手册](docs/release-runbook.md) — 签名与发布控制
- [预设包格式](docs/preset-packages.md) — 便携 Agent 预设契约

提交改动之前，请运行 `npm test`、`npm run typecheck` 与 `npm run build`，然后实测受影响的真实应用流程。切勿在 issue、日志、截图或测试数据中包含真实 API Key。

## 许可证

本版本以 [MIT 许可证](LICENSE) 开源，与其二开来源
[上游项目](https://github.com/dataelement/dsh-desktop)采用同一许可。

DeepSeek Harness 及其依赖仍受各自的上游许可与商标政策约束。用于应用品牌的
DeepSeek 标识归 DeepSeek 所有，此处仅用于标识该桌面外壳所托管的产品。
