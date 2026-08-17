# DeepSeek Harness 桌面端

[English](README.md) | 中文

桌面应用在一个原生窗口内提供相互独立的 Chat 与 Harness 模式。窗口关闭后，系统托盘继续持有两种模式的应用生命周期。

## 开发

安装依赖后，使用单一桌面开发命令。该命令会先构建 Host 与客户端包、Web 前端和 Electron main 进程，再启动应用：

```sh
pnpm run dev:desktop
```

关闭窗口会隐藏窗口。通过托盘菜单恢复窗口或退出应用。显式退出会等待 Host 进程停止，并在 Host 的有界宽限期结束后升级终止行为。

桌面应用只接受 `dsh web` 为 `127.0.0.1` 或 `localhost` 输出的就绪 URL。页面导航限制在该来源；HTTP 和 HTTPS 链接交给系统浏览器打开。

运行无密钥 Electron 场景前需先构建 Desktop 产物。该场景使用本地 Harness 与 Chat 服务器，绝不会访问在线 DeepSeek 网站：

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build
pnpm --filter @deepseek-ai/dsh-desktop run test:electron
```

## 模式与数据

全新安装默认选择 Harness。后续启动会恢复用户通过本地标题栏切换器选择的上一个模式。Harness 保持完整内容边界；Chat 从操作系统已有的 44px 标题栏下方开始，因此官方网站保持原有布局，左上角控件仍可点击。关闭状态本地 chrome 只紧密包围分段切换器与可选 Chat 操作控件。只有主进程扩展这些边界并确认已应用布局后，Chat 操作菜单或确认对话框才会显示。Harness 独立启动，Chat 只在首次选择后创建；切换模式会保留两个健康视图，而不会重新加载它们。

chrome 视图保持透明。164px 分段切换器渲染等宽的 `Chat` 与 `Harness` 选项；点击任一分段都会直接选择对应模式，不存在模式菜单、箭头、产品图标、外框或紧凑缩写。当前模式拥有共享的 `light`／`dark`／`system` 偏好，Desktop 会把该偏好应用到隐藏模式。Harness 使用自身的 `ThemeRuntime` 桥，Chat 使用带版本的官方主题偏好；只有应用到隐藏 Chat 的偏好改变了存储值时才会重新加载 Chat。本地控件通过 Electron 解析 `system`，在亮色内容上显示深色文字，在暗色内容上显示浅色文字。隔离 Chat preload 还只会上报规范化的不透明计算背景色；已有标题栏底色使用该颜色并保留配色后备，未支持的 CSS 值会被拒绝，Chat 菜单和对话框继续使用不透明主题表面。

Harness 保留现有会话、工作区、agent（智能体）配置和回环 Host。Chat 显示 `https://chat.deepseek.com/` 上的官方网站，不会成为 Harness 模型提供方。一个启用沙箱且上下文隔离的 preload 会访问两个经过校验的官方零版本存储项：它同步 `__appKit_@deepseek/chat_themePreference`，并在每个 Chat document 初始化前，只把保留的 `__appKit_@deepseek/chat_lastSessionValue.value.siderCollapsed` 从 `true` 改为 `false`。因此，Chat 创建或重新加载后会以展开侧栏启动；如果用户随后收起侧栏，保留的 Chat 视图会在模式切换期间维持该状态。缺失或未知的侧栏存储不会被修改，同一存储项中的其他页面设置会被保留，preload 也不会向主世界暴露 API 或注入 DOM 控件。Desktop 不会读取 Chat Cookie、凭据、对话、网络响应或网站的其他存储。遇到未知主题存储版本时，主题同步会停用，但 Chat 仍保持可用。

Chat 使用专用的 Electron 持久分区 `persist:dsh-deepseek-chat`。Chromium 会在应用多次启动之间保留该分区，包括在线网站接受的登录状态。Chat 与 Harness 不共享 Cookie、存储、提示词、附件、对话、凭据或导航状态。

**清除 Chat 数据**需要确认；该操作会关闭 Chat 视图及其认证窗口，清除该分区的本地存储与缓存，并在 Chat 被选中时重新创建它。当嵌入网站的认证依赖这些本地数据时，此操作会退出登录，但不会删除 DeepSeek 服务器保存的对话或账户数据。用户也可以通过网站本身退出嵌入登录。

### 导航与故障

目前只有精确的 HTTPS 来源 `https://chat.deepseek.com` 在 Chat 内受信任。同源新窗口使用同一个受限分区。无关 HTTPS 新窗口请求会在系统浏览器中打开；顶层跳转会被取消，并通过本地外壳提供打开选项；无关重定向、格式错误的 URL、HTTP 和非 Web 协议会被阻止。Chat 视图失败时还会提供固定官方网站 URL 的系统浏览器回退。需要其他来源的认证方式仍不受支持，直到该精确来源及其流程通过发布审查与测试。

Harness 仍限制在经过验证的回环来源。用户导航和新窗口请求如果指向其他 HTTP 或 HTTPS 来源，会在系统浏览器中打开；外部重定向和其他协议则会被阻止。

Host 启动失败、Host 意外退出或 Harness renderer 失败时，只会把 Harness 标记为不可用并提供 Harness 重试。Chat 加载失败、renderer 失败或无响应时，只会把 Chat 标记为不可用，并提供 Chat 重试和浏览器回退。清除或重试任一模式都不会清除或重启另一个模式。

原生窗口外观按宿主平台区分。macOS 使用无边框内嵌标题栏、交通灯和侧栏 vibrancy；切换器位于该标题栏的交通灯右侧。Windows 保留系统边框、阴影、缩放与 Snap 行为以及 Windows 11 圆角，隐藏标题栏把切换器放在左侧，并把原生窗口按钮留在最右侧。Harness 内容延伸到窗口顶部，Chat 则从同一条 44px 标题栏下方开始。关闭状态本地 chrome 仅延伸到实际控件边缘，shell 拖拽区域从最大关闭控件范围之后开始，因此原生拖拽命中测试和透明像素都不会拦截模式或网站控件。Windows acrylic 和 macOS vibrancy 只透过侧栏，会话区与详情区保持不透明。Linux 使用无边框标题栏和不透明侧栏降级样式。

## 打包

本地打包命令会执行完整的仓库构建，为 Host 暂存封闭的生产依赖树，并为当前平台生成未封装应用。无需另行手动构建：

```sh
pnpm run package:desktop
```

打包后的应用通过 Electron 的 Node 模式，在独立进程内运行已暂存的 `@deepseek-ai/dsh` CLI。应用因此保留受 supervisor 管理的 Host 生命周期，无需携带第二个 Node 可执行文件。如果暂存的 CLI 入口或 Web 前端入口缺失，`afterPack` 检查会在签名前拒绝该产物。macOS 和 Windows 都使用受跟踪的 `apps/desktop/build/icon.png` 原始文件；仓库不预处理图标，也不提交平台专用图标变体。

### 已签名的 macOS DMG

macOS 发布命令要求构建用户的 Keychain 中安装有效的 `Developer ID Application` 身份，且证书与私钥必须同时存在。它还需要一组完整的公证凭据。Keychain profile 可以避免应用专用密码进入仓库或 shell 历史记录：

```sh
xcrun notarytool store-credentials "dsh-notary" --apple-id "<Apple ID>" --team-id "<Team ID>"
```

`notarytool` 会交互式请求秘密。使用已存储的 profile 构建已签名、开启 hardened runtime 且已公证的 DMG：

```sh
APPLE_KEYCHAIN_PROFILE=dsh-notary pnpm run dist:mac:desktop
```

现有秘密文件可以提供 `MAC_CERT_P12_BASE64`、`MACOS_SIGN_IDENTITY`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 和 `APPLE_TEAM_ID`，无需把证书导入持久 Keychain：

```sh
node --env-file=/absolute/path/to/macos-signing-secrets.env --import tsx apps/desktop/scripts/release-mac.ts
```

Electron Builder 会把该 Base64 PKCS#12 证书导入临时 Keychain，并在构建结束时删除。wrapper 不会把签名和公证变量传给仓库构建与运行时暂存子进程，只会将其传给 Electron Builder。秘密文件及其路径都不会受版本控制。

发布预检查会在仓库构建前运行。如果宿主不是 macOS、所提供身份不是 `Developer ID Application` 身份、签名凭据不完整、签名发现被禁用，或公证凭据缺失或不完整，预检查都会失败。未提供 PKCS#12 凭据组时，Keychain 中必须存在带私钥的可用 `Developer ID Application` 身份。除 Keychain profile 外，该命令也接受完整的 Apple ID 凭据组（`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 和 `APPLE_TEAM_ID`），或 App Store Connect API 密钥组（`APPLE_API_KEY`、`APPLE_API_KEY_ID` 和 `APPLE_API_ISSUER`）。

构建成功后，挂载生成的 DMG，再验证其中应用的签名、Gatekeeper 评估和已装订的公证票据：

```sh
DMG_PATH="$(find apps/desktop/dist -maxdepth 1 -type f -name '*.dmg' -print -quit)"
MOUNT_POINT="$(mktemp -d)"
hdiutil attach "$DMG_PATH" -mountpoint "$MOUNT_POINT" -nobrowse -readonly
APP_PATH="$MOUNT_POINT/DeepSeek Harness.app"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
spctl --assess --type execute --verbose=4 "$APP_PATH"
xcrun stapler validate "$APP_PATH"
hdiutil detach "$MOUNT_POINT"
rmdir "$MOUNT_POINT"
```

## 已知限制

首个桌面装配使用回环 HTTP Host。renderer 和 Host 协议保持不变，因此后续可替换为 GUI 架构预留的 IPC carrier，而无需改动产品功能。

已签名安装包的发布路径目前只面向 macOS。Windows 和 Linux 打包会生成未封装应用；它们的安装包格式与发布签名仍属于发布工作。

本地 Electron 场景验证 Desktop 生命周期与存储策略，不验证在线 DeepSeek 网站的兼容性。DeepSeek 可以独立改变认证来源、WAF 行为、页面要求或嵌入策略。任何登录方式只有在 macOS 和 Windows 上都通过以下冒烟流程后，才具备发布资格：

1. 在嵌入式 Chat 中完成该登录方式，并记录每个顶层认证来源。
2. 重启 Desktop 并验证登录仍然存在；切换到 Harness 再返回，验证 Chat 页面状态得到保留。
3. 验证同源认证窗口、外部 HTTPS 链接、显式重新加载 Chat 和浏览器回退。
4. 清除 Chat 数据，验证嵌入登录已移除且 Harness 数据没有变化。
5. 触发 Chat 加载或 WAF 故障以及 Host 故障，验证另一个模式仍然可用。

公开分发还需要单独审查 DeepSeek 当前的服务条款与品牌规则。本仓库未记录重新分发或嵌入该网站的许可。

## 模型体验

桌面壳和已选模式状态不会增加模型可见输入。复用的 Web profile 继续持有现有的 Web 运行时上下文，Chat 内容绝不会进入 Harness 提示词、会话事件或遥测。
