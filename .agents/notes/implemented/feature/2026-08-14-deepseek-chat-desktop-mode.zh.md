# Agent Note: 将 DeepSeek Chat 作为隔离的桌面模式

Status: implemented

[English](2026-08-14-deepseek-chat-desktop-mode.md) | 中文

## 问题

同时依赖 Harness Web profile 与 DeepSeek 官方 Chat 网站的用户，需要在一个日常桌面工作流内使用两种体验，但不能把它们当作同一个产品或同一个数据所有者。

嵌入公开网站不等于增加另一个 Harness 模型提供方。DeepSeek Chat 拥有自己的认证、对话、存储、网络请求和发布周期。若把它当作 Harness 会话，就需要使用不受支持的 DOM 自动化或私有 API 集成，混合无关的持久化模型，并让普通网站变更表现为 Harness 回归。

Chat 还必须在回环 Host 不可用时继续工作。因此，Host 就绪与意外退出不能拥有完整 Desktop 应用生命周期。

## 决策

Desktop 在一个原生窗口内提供相互独立的 **Chat** 与 **Harness** 模式。Harness 加载本地 Web Host，不改变其 agent loop（智能体循环）、工具、会话日志或模型配置。Chat 加载 `https://chat.deepseek.com/`，把认证交给 DeepSeek 自有界面，并且不向网站主世界提供 Desktop API 或控件。

两种模式共享由 Desktop 持有的本地外壳和透明侧栏模式 chrome，但不共享对话、附件、提示词、凭据、Cookie、本地存储或导航状态。切换操作只改变哪个保留的内容视图可见，绝不会在两种模式之间转换、复制或提交数据。

实现包括 Chat 持久浏览数据、切换时保留页面状态、双向主题偏好同步、显式重新加载与清除数据控制、保守的外链处理，以及相互独立的故障恢复。实现不包括消息同步、对话导入、通用 DOM 自动化、附件传递，也不会把 Chat 网站用作 Harness 模型后端。

## 产品约定

- 全新安装默认进入 Harness，后续启动恢复上次选择的模式。
- Chat 在首次选择时创建，并在隐藏时保持存活，因此当前页面、滚动位置和草稿可跨模式切换保留。
- 专用持久分区会在应用多次启动之间保留网站数据，直到用户在网站中退出登录或清除 Chat 数据。在线登录方式能否工作仍取决于发布冒烟验证。
- Harness 保持现有会话日志和工作目录行为。Chat 内容绝不会成为模型可见的 Harness 输入，也不会进入 Harness 持久化或遥测。
- Desktop 不会重设远程页面样式、向其 DOM 注入控件、抓取内容，也不承诺兼容未公开的网站行为。
- 每个新 Chat document 都以展开的官方侧栏启动。隔离 preload 会在网站初始化前，只把保留的官方 `lastSessionValue.value.siderCollapsed` 从 `true` 改为 `false`；加载完成后，用户可以收起侧栏，保留的视图会在模式切换期间维持该状态。
- 当前模式拥有共享的 `light`／`dark`／`system` 偏好。隐藏模式的报告不能替换该偏好，未知 Chat 主题存储版本只会停用主题同步。
- Desktop 不会绕过 WAF、机器人检测、认证限制，或 DeepSeek 对嵌入式客户端的阻止决定。Chat 失败时仍提供固定的系统浏览器回退。

## Desktop 架构

一个本地 `BrowserWindow` 持有本地状态外壳、边界受限的模式 chrome 视图和两个由主进程持有的 `WebContentsView` 子视图。Harness 使用完整内容边界。Chat 从操作系统已有的 44px 标题栏下方开始，关闭状态模式 chrome 只占用实际控件，因此无法拦截网站左上角控件：

```text
Electron BrowserWindow (local shell)
├── operating-system title-bar drag region
├── local mode chrome (segmented switch, Chat menu, dialog)
├── Harness WebContentsView -> loopback Host
└── Chat WebContentsView -> https://chat.deepseek.com/
```

`DesktopModeController` 持有模式选择、子视图创建、可见性、边界、状态、重试、清除与关闭行为。它独立启动 Harness，并只在首次选择 Chat 时创建 Chat。一个串行操作队列和各模式的 generation 计数器会阻止过期的创建或故障回调在清除、替换或关闭后发布状态。

兼容 sandbox 的 chrome preload 只公开封闭的模式与命令通道，主进程会校验其载荷。Harness 接收一个独立主题桥，并把写入委托给 `ThemeRuntime`。Chat 接收一个不会暴露主世界 API 的隔离 preload，也不能访问通用 IPC。

mode-chrome WebContentsView 保持透明，并缩小到操作系统标题栏内关闭状态控件的实际边界。等宽的 `Chat | Harness` 分段通过关闭状态 IPC 通道直接选择模式，不存在模式下拉菜单、箭头、产品图标、外框或紧凑缩写。只有 Chat 操作菜单会请求扩展原生边界。主进程应用这些边界并确认状态后，renderer 才显示菜单内容；关闭时则先隐藏内容，再恢复紧密边界。shell 拖拽区域从最大关闭控件范围之后开始。隔离 Chat preload 会把一个不透明的页面计算背景规范化为标准 `#rrggbb`；主进程拒绝其他 CSS 值，已有标题栏底色使用通过校验的颜色并保留解析后配色后备，不带分隔线或 vibrancy 色偏。当前模式向协调器报告偏好与解析后的配色，协调器会把偏好应用到隐藏模式，并通过 Electron 解析 `system`。如果创建某个模式前已经建立权威偏好，该模式会先收到该偏好，其缓冲的初始报告不能抢先被接受。

Harness 通过受信任桥发布 `ThemeRuntime` 快照。Chat 的隔离 preload 会读写官方零版本 envelope 中的 `__appKit_@deepseek/chat_themePreference`，并读取官方 body class 与 `data-ds-dark-theme` 标记。应用值发生变化时会重新加载 Chat，让网站继续拥有渲染行为；未知 envelope 会报告适配器错误，而 Chat 的其他功能保持可用。网站初始化前，另一个零版本适配器只把 `__appKit_@deepseek/chat_lastSessionValue.value.siderCollapsed: true` 改为 `false`，保留同一存储项中的其他设置，并拒绝写入未知表示形式。

本地外壳会在 Host 就绪前打开。Host 与 Chat 启动分别报告状态，Host 意外退出只会让 Harness 失败。所选模式会原子存储在 Electron 的 `userData` 目录下；它属于展示状态，而不是 Harness 设置或会话事件。

## 会话与安全

Chat 使用专用持久分区 `persist:dsh-deepseek-chat`；Harness 使用现有 session（会话）。Chat 分区绝不会安装为 `session.defaultSession`，因此远程 Cookie 和权限决定不会泄漏到回环 Host。

每个 Chat renderer 都使用 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true` 与 `webSecurity: true`。主 Chat renderer 只加载隔离 Chat preload；临时认证窗口不加载 preload。权限检查与权限请求默认拒绝。Desktop 不会隐式授予通知、位置、摄像头、麦克风、屏幕采集、MIDI、USB、串口设备、蓝牙或本地字体访问权限。

Desktop 绝不会读取 Chat Cookie、token、IndexedDB、Service Worker 状态、对话 DOM 或网络响应正文。隔离 preload 只访问上述带版本主题偏好、body 主题标记和保留的侧栏字段；它不会把 DeepSeek 凭据或其他存储复制到 Harness 设置。清除 Chat 数据时，会先关闭 Chat 与认证 renderer，再清除该分区的存储和缓存。

## 导航策略

初始 URL 与当前唯一受信任来源分别是 `https://chat.deepseek.com/` 和 `https://chat.deepseek.com`。代码内策略绝不会信任 `*.deepseek.com` 一类通配符。增加认证来源需要显式修改代码、增加导航测试，并让对应发布冒烟流程通过。

顶层导航、重定向和新窗口请求都经过同一个纯 URL 分类器。Chat 来源导航保留在 Chat 内。Chat 来源新窗口使用临时受限窗口，共享 `persist:dsh-deepseek-chat`，并随 Chat 模式一起释放。

无关 HTTPS 新窗口请求会在系统浏览器中打开。无关的顶层 HTTPS 跳转会被取消，并通过本地外壳提供打开选项。未受信重定向、HTTP、格式错误的 URL 和非 Web 协议会被阻止。Desktop 绝不会为了让失败登录通过而自动扩大受信任集合。

需要其他身份提供方来源的登录方式仍不受支持，直到发布版本增加并验证该精确流程。仅在系统浏览器中打开该流程不会自动在嵌入式分区中建立认证。

## 生命周期与恢复

关闭原生窗口会将其隐藏，由托盘持有应用生命周期。显式退出会等待 Chat 视图释放和有界 Host 关闭完成，再释放 Electron 退出序列；Chat 浏览数据继续持久保留。

Host 启动失败、意外退出或 Harness renderer 失败时，会把 Harness 标记为不可用，同时保持本地外壳和 Chat 可用。Harness 重试会创建新的受监管 Host，并且只在就绪 URL 通过回环校验后接受其视图。

Chat 加载失败、证书错误、renderer 无响应或 renderer 崩溃时，会把 Chat 标记为不可用而不改变 Harness。Chat 重试会在持久分区内创建新的 WebContents，本地外壳还会提供固定官方网站 URL 的系统浏览器回退。

## 隐私控制

Chat 菜单提供 **重新加载 Chat** 和 **清除 Chat 数据**。清除操作需要确认，会关闭 Chat 持有的 renderer、删除本地浏览数据与缓存，并在 Chat 被选中时重新创建它。该操作不会删除 DeepSeek 服务器保存的对话或账户数据。

控制器只在主进程中保留待打开的外部 URL，并且只向本地外壳发送是否存在待处理目标的布尔状态。Chat 加载错误会省略失败 URL，避免认证参数进入状态消息。Desktop 代码不会把 Chat 截图、页面内容、请求头、Cookie 或响应正文附加到产品遥测。

公开分发需要单独审查 DeepSeek 当前的服务条款和品牌规则。本技术决策不授予重新分发或嵌入网站的许可。

## 验证

纯单元测试覆盖持久模式恢复、串行状态转换、视图所有权、边界、精确来源分类、外链路由、受限 WebPreferences、权限拒绝、认证窗口释放、清除数据顺序、故障隔离、重试行为、关闭竞态，以及保留同一存储项其他设置的带版本侧栏存储更新。

无密钥 Electron 场景使用相互独立的本地 Harness 与 Chat HTTP 服务器启动已构建的生产装配。它会验证全新 profile 选择 Harness、跨重启恢复上次模式、用指针和键盘直接选择分段、不重叠的拖拽几何、Chat 操作菜单边界确认、Harness 全高边界、Chat 单一 44px 标题栏 inset 与可点击左上控件、匹配的 Chat 页面和标题栏背景、保留 Chat DOM 与分区状态、独立模式故障、分区清除、当前模式主题权威、隐藏分歧纠正、系统配色变化和隐藏 Chat 重载，并且不访问在线 DeepSeek 服务。打包测试要求本地外壳、CSS、四个 CommonJS sandbox preload 和暂存 Host 入口都存在。

展示测试覆盖全高 Harness URL 标记和各平台标题栏处理。在线 DeepSeek 兼容性、受支持登录方式、WAF 行为和分发许可仍属于 macOS 与 Windows 发布检查；确定性的 CI 不会声称这些结果。

## 考虑过的替代方案

**使用 renderer `<webview>`。**不予采用，因为 guest WebContents 所有权、权限处理、导航拦截和 Electron 兼容性会变成 renderer 的职责。主进程 `WebContentsView` 可以让远程内容位于 Harness React 树之外，并使用 Electron 支持的组合 API。

**在第二个 BrowserWindow 中打开 Chat。**不作为主要体验采用，因为它表现为两个应用，无法提供所需的单窗口模式切换。临时受限认证窗口仍然保留，因为它们的生命周期很窄，并且只共享 Chat 分区。

**通过 iframe 嵌入 Chat。**不予采用，因为网站通过响应头控制 frame 接纳，而且 iframe 无法提供所需的 session、导航、弹窗和权限隔离。

**调用未公开的 DeepSeek Chat API 或自动操作其 DOM。**不予采用，因为这会捕获私有实现细节、产生凭据处理义务，并让远程发布变成集成故障。Desktop 只显示官方网站，不提取其内部信息。

**在加载后点击官方侧栏控件。**不予采用，因为该控件的 DOM 结构、翻译后标签、渲染时序和动画状态都属于不稳定的私有实现。带版本存储适配器会在渲染前应用官方启动字段，并在表示形式变化时停止写入。

**统一 Chat 和 Harness 历史。**不予采用，因为两种产品具有不同的数据所有者、能力和持久化语义。将来的互操作需要受支持的 DeepSeek API 和显式、由用户控制的传输格式。

## 后果

用户获得单窗口访问、保留的 Chat 状态、显式本地数据控制和故障隔离，而 Harness 模型行为保持不变。在线服务拒绝或破坏嵌入时，浏览器回退可以限制用户影响。

保持两个 renderer 进程存活会增加内存和 GPU 使用。延迟创建 Chat 可以避免启动成本，而保留页面状态会明确地用内存换取快速切换。

即使 Desktop 从不读取，持久浏览数据仍然敏感。共享 OS 账户可能一直保留认证会话，直到用户退出登录或清除 Chat 数据；平台凭据存储还依赖宿主密钥环。

精确来源信任可能落后于合法认证变更并阻止登录。通配符信任虽然可以减少中断，但会削弱导航隔离，因此发布版本会改为更新并测试精确来源。

本地 fixture（测试前置数据）可以证明 Desktop 策略和生命周期行为，但不能证明在线服务兼容性。一次平台冒烟测试通过也无法保证后续远程部署继续兼容；在记录条款与品牌审查结果前，公开分发仍然受阻。

主题同步依赖官方零版本主题 envelope 与 body 标记，展开启动默认值则依赖官方零版本保留侧栏字段。网站发布若改变任一表示形式，Chat 会保持可用、保留未知存储，并报告对应适配器不兼容以供发布诊断。
