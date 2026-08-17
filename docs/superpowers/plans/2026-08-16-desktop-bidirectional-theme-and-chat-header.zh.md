# 桌面双向主题与 Chat 标题区实施计划

[English](2026-08-16-desktop-bidirectional-theme-and-chat-header.md) | 中文

> **面向 agentic worker：**必须使用 superpowers:executing-plans，按任务逐项实施本计划。步骤使用复选框（`- [ ]`）跟踪。在当前会话内以内联方式执行，不分派子代理。

**目标：**在 Harness 与 DeepSeek Chat 官网之间同步亮色、暗色和跟随系统主题偏好，同时让 Chat 官网侧栏控件可点击，并把模式选择器简化为文字加箭头。

**架构：**一个与框架无关的桌面主题协调器只接受当前模式的变化，并把变化应用到隐藏模式。Harness 通过自有 `ThemeRuntime` 连接；隔离的 Chat preload 适配官网带版本的主题存储，但不向远程页面暴露 Electron。Chat 预留未绘制的标题区，原生模式 chrome 缩到实际控件大小。

**技术栈：**Electron 43 `WebContentsView`、沙箱 CommonJS preload、Cordis 客户端插件、TypeScript 6、Vitest、Playwright Electron 测试、静态 HTML/CSS 和 Electron Builder。

## 全局约束

- 只同步 `light`、`dark` 和 `system`；当前模式拥有决定权，隐藏模式报告只作为确认。
- Harness 主题写入通过 `ThemeRuntime.setTheme()` 和 Host 支持的设置作用域完成。
- Chat 适配器只读写 `__appKit_@deepseek/chat_themePreference` 及 `{ value, __version: "0" }`，并且只观察主题 body 标记。
- Chat preload 不向远程页面暴露 `contextBridge` 对象、通用 IPC、文件系统 API、凭据、账号、草稿、会话、令牌或消息数据。
- 未知 Chat 存储版本或缺失标记会停用该渲染器的同步，但不会使 Chat 失败。
- 关闭状态选择器不显示图标、边框、背景或展开状态填充；展开时显示完整文字，紧凑时显示 `DSH` 或 `Chat` 加箭头。
- Chat 官网内容从本地标题区下方开始。标题区不绘制全宽工具栏，关闭状态原生 chrome 边界不覆盖官网控件。
- 现有 Chat 分区、导航、认证、数据清除、状态保留和故障隔离保持不变。
- 不增加运行时依赖。每个注册和监听器都随所有者释放。
- 此检出没有 `.git`；不要创建提交。通过测试和准确的产物哈希记录检查点。

---

### 任务 1：定义共享主题协议与协调器

**文件：**
- 新建：`apps/desktop/src/desktop-theme-sync.ts`
- 新建：`apps/desktop/tests/desktop-theme-sync.spec.ts`
- 修改：`apps/desktop/src/desktop-theme.ts`
- 修改：`apps/desktop/src/desktop-mode.ts`

**接口：**
- 产出：`DesktopThemePreference = 'light' | 'dark' | 'system'`。
- 产出：`DesktopThemeState = { preference: DesktopThemePreference; scheme: DesktopColorScheme }`。
- 产出：`DesktopThemedSurface extends DesktopSurface`，带有 `setThemePreference(preference): void`。
- 产出：`createDesktopThemeCoordinator(options): DesktopThemeCoordinator`，包含 `report`、`connect`、`select`、`systemChanged` 和 `snapshot`。

- [ ] **步骤 1：编写失败的协调器测试。**覆盖初始选中模式决定权、忽略隐藏模式报告、三种偏好、权威报告后连接目标、选择权交接、只在 `system` 下响应系统变化、幂等快照和释放所有权。

```text
const coordinator = createDesktopThemeCoordinator({
  initialMode: 'harness',
  initialSystemScheme: 'light',
  onChange,
})
const applyChat = vi.fn()
coordinator.connect('chat', applyChat)
coordinator.report('chat', { preference: 'dark', scheme: 'dark' })
expect(coordinator.snapshot().authoritative).toBe(false)
coordinator.report('harness', { preference: 'dark', scheme: 'dark' })
expect(applyChat).toHaveBeenLastCalledWith('dark')
coordinator.select('chat')
expect(applyChat).toHaveBeenLastCalledWith('dark')
```

- [ ] **步骤 2：运行测试并确认模块缺失。**

运行：`pnpm exec vitest run apps/desktop/tests/desktop-theme-sync.spec.ts`

预期：失败，因为 `desktop-theme-sync.ts` 不存在。

- [ ] **步骤 3：实现带验证的协议和协调器。**每种模式保留一个权威标记和一个目标回调。`connect()` 立即应用权威偏好，`report()` 只接受选中模式，`systemChanged()` 只在偏好为 `system` 时改变解析配色。

```text
export const DESKTOP_THEME_PREFERENCES = ['light', 'dark', 'system'] as const
export type DesktopThemePreference = typeof DESKTOP_THEME_PREFERENCES[number]
export interface DesktopThemeState {
  readonly preference: DesktopThemePreference
  readonly scheme: DesktopColorScheme
}
export interface DesktopThemeSnapshot extends DesktopThemeState {
  readonly authoritative: boolean
  readonly selected: DesktopMode
}

export function isDesktopThemePreference(value: unknown): value is DesktopThemePreference {
  return DESKTOP_THEME_PREFERENCES.some(candidate => candidate === value)
}

export function isDesktopThemeState(value: unknown): value is DesktopThemeState {
  if (typeof value !== 'object' || value === null) return false
  const state = value as { preference?: unknown; scheme?: unknown }
  return isDesktopThemePreference(state.preference) && isDesktopColorScheme(state.scheme)
}
```

隐藏模式报告不一致时，协调器必须重新应用当前偏好、发布脱离内部所有权的快照，并让所有返回的断开函数保持幂等。

- [ ] **步骤 4：增加带主题能力的视图契约。**

```text
export interface DesktopThemedSurface extends DesktopSurface {
  /** Apply one shared preference without transferring ownership. */
  setThemePreference: (preference: DesktopThemePreference) => void
}
```

- [ ] **步骤 5：运行聚焦测试。**

运行：`pnpm exec vitest run apps/desktop/tests/desktop-theme-sync.spec.ts apps/desktop/tests/desktop-theme.spec.ts`

预期：通过。

### 任务 2：增加自有 Harness 主题桥

**文件：**
- 新建：`apps/desktop/src/harness-theme-preload.ts`
- 新建：`packages/client/ui-theme/src/client/desktop-theme-bridge.ts`
- 新建：`packages/client/ui-theme/tests/desktop-theme-bridge.client.spec.ts`
- 修改：`apps/desktop/src/harness-surface.ts`
- 修改：`apps/desktop/tests/harness-surface.spec.ts`
- 修改：`packages/client/ui-theme/src/client/index.ts`

**接口：**
- 消费：任务 1 的 `DesktopThemePreference`、`DesktopThemeState` 及验证函数。
- 产出：仅在桌面 Harness 渲染器中存在的封闭 `window.dshDesktopTheme` API，只包含 `publish(state)` 与 `subscribe(listener)`。
- 产出：`createHarnessSurface()` 返回 `DesktopThemedSurface`，并通过 `onThemeState` 报告经过验证的状态。

- [ ] **步骤 1：编写失败的 Harness 视图测试。**要求专用 preload 路径、`dsh-desktop-embedded=1`、带发送者校验的 IPC 报告、向外发送偏好 IPC、拒绝无效载荷并释放监听器。

```text
expect(createView).toHaveBeenCalledWith({
  webPreferences: expect.objectContaining({ preload: '/app/lib/harness-theme-preload.cjs' }),
})
expect(loaded.searchParams.get('dsh-desktop-embedded')).toBe('1')
ipc.dispatch(DESKTOP_THEME_CHANNELS.report, contents, { preference: 'dark', scheme: 'dark' })
expect(onThemeState).toHaveBeenCalledWith({ preference: 'dark', scheme: 'dark' })
surface.setThemePreference('light')
expect(contents.send).toHaveBeenCalledWith(DESKTOP_THEME_CHANNELS.apply, 'light')
```

- [ ] **步骤 2：编写失败的客户端主题桥测试。**挂载嵌入式桌面标记和假主题桥，证明会发布初始 `ThemeRuntime` 快照、传入偏好会调用 `setTheme`、普通 Web 模式不执行任何操作，并且释放时取消两个方向的订阅。

- [ ] **步骤 3：运行聚焦失败测试。**

运行：`pnpm exec vitest run apps/desktop/tests/harness-surface.spec.ts packages/client/ui-theme/tests/desktop-theme-bridge.client.spec.ts`

预期：因缺失 preload、主题桥模块和带主题视图方法而失败。

- [ ] **步骤 4：实现沙箱 Harness preload。**只暴露下列 API，并在 preload 内验证传入监听器函数。

```text
contextBridge.exposeInMainWorld('dshDesktopTheme', {
  publish(value: unknown) {
    ipcRenderer.send(DESKTOP_THEME_CHANNELS.report, value)
  },
  subscribe(listener: (preference: unknown) => void) {
    const receive = (_event: IpcRendererEvent, value: unknown): void => { listener(value) }
    ipcRenderer.on(DESKTOP_THEME_CHANNELS.apply, receive)
    return () => { ipcRenderer.off(DESKTOP_THEME_CHANNELS.apply, receive) }
  },
})
```

- [ ] **步骤 5：在 `ThemeRuntime` 旁绑定主题桥。**绑定器检查 `data-dsh-desktop-embedded="true"`，发布 `{ preference, scheme: active.colorScheme }`，使用 `isThemePreference` 验证传入偏好，并通过 `ctx.effect()` 与 `ctx.on('theme/change', ...)` 释放。

```text
export function bindDesktopThemeBridge(ctx: Context, theme: ThemeRuntime): void {
  if (document.documentElement.dataset.dshDesktopEmbedded !== 'true') return
  const bridge = window.dshDesktopTheme
  if (bridge === undefined) return
  const publish = (snapshot: ThemeSnapshot): void => {
    bridge.publish({ preference: snapshot.preference, scheme: snapshot.active.colorScheme })
  }
  publish(theme.getTheme())
  ctx.on('theme/change', publish)
  ctx.effect(() => bridge.subscribe((value) => {
    if (isThemePreference(value)) theme.setTheme(value)
  }), 'ui-theme: desktop preference bridge')
}
```

- [ ] **步骤 6：连接 Harness IPC 所有权。**`createHarnessSurface()` 检查 `event.sender === contents`，返回 `setThemePreference()`，在关闭视图前移除 IPC 监听器，并只把 `did-change-theme-color` 保留为合成后备。

- [ ] **步骤 7：运行 Harness 与客户端测试。**

运行：`pnpm exec vitest run apps/desktop/tests/harness-surface.spec.ts packages/client/ui-theme/tests/desktop-theme-bridge.client.spec.ts packages/client/ui-theme/tests/theme.client.spec.ts`

预期：通过。

### 任务 3：增加隔离的 Chat 主题适配器

**文件：**
- 新建：`apps/desktop/src/chat-theme-adapter.ts`
- 新建：`apps/desktop/src/chat-theme-preload.ts`
- 新建：`apps/desktop/tests/chat-theme-adapter.spec.ts`
- 修改：`apps/desktop/src/chat-surface.ts`
- 修改：`apps/desktop/tests/chat-surface.spec.ts`

**接口：**
- 消费：任务 1 的主题类型与 `DESKTOP_THEME_CHANNELS`。
- 产出：`parseChatThemeStorage(raw)`、`serializeChatThemeStorage(preference)` 和 `schemeFromChatBody(body)`。
- 产出：一个 Chat `DesktopThemedSurface`，其 preload 报告主题状态，但不暴露主世界 API。

- [ ] **步骤 1：编写失败的纯适配器测试。**固定准确存储键、版本 `"0"`、三种可接受值、格式错误 JSON、多余或缺失字段、未知版本、互相矛盾的 body 标记及亮暗解析。

```text
expect(parseChatThemeStorage('{"value":"dark","__version":"0"}')).toBe('dark')
expect(parseChatThemeStorage('{"value":"dark","__version":"1"}')).toBeUndefined()
expect(serializeChatThemeStorage('system'))
  .toBe('{"value":"system","__version":"0"}')
expect(schemeFromChatBody({ classList: new Set(['dark']), darkAttribute: 'dark' })).toBe('dark')
```

- [ ] **步骤 2：扩展 Chat 视图测试。**要求只在主 Chat 视图使用 preload，认证窗口绝不使用；验证发送者所有权；证明 `setThemePreference()` 只发送一个封闭消息；证明适配器诊断不调用 `onFailure`。

- [ ] **步骤 3：运行聚焦失败测试。**

运行：`pnpm exec vitest run apps/desktop/tests/chat-theme-adapter.spec.ts apps/desktop/tests/chat-surface.spec.ts`

预期：失败，因为适配器、preload 选项和带主题视图方法不存在。

- [ ] **步骤 4：实现纯版本化适配器。**拒绝未知版本和含糊的 body 状态。序列化始终按 `value`、`__version` 顺序写键，使测试确定。

- [ ] **步骤 5：实现隔离 Chat preload。**DOM 就绪后，只观察 `body.class`、`body[data-ds-dark-theme]` 和准确主题存储项。存储与 body 一致时报告经过验证的状态。传入不同偏好时更新存储并调用 `location.reload()`；偏好相同时只报告而不重载。每个 document 只发送一次适配器诊断，绝不调用 `contextBridge.exposeInMainWorld()`。

```text
function reportTheme(): void {
  const preference = parseChatThemeStorage(localStorage.getItem(CHAT_THEME_STORAGE_KEY))
  const scheme = schemeFromChatDocument(document)
  if (preference === undefined || scheme === undefined) return
  ipcRenderer.send(DESKTOP_THEME_CHANNELS.report, { preference, scheme })
}
```

- [ ] **步骤 6：连接 Chat 视图 IPC。**拆分主视图与认证窗口 Web 首选项，检查发送者身份，通过 `reportError` 包含适配器诊断，并随视图释放所有 IPC 监听器。

- [ ] **步骤 7：运行 Chat 测试。**

运行：`pnpm exec vitest run apps/desktop/tests/chat-theme-adapter.spec.ts apps/desktop/tests/chat-surface.spec.ts`

预期：通过，包括现有权限、导航、认证、释放和清除分区测试。

### 任务 4：组合当前模式同步并打包 preload

**文件：**
- 修改：`apps/desktop/src/desktop-application.ts`
- 修改：`apps/desktop/src/main.ts`
- 修改：`apps/desktop/src/shell-protocol.ts`
- 修改：`apps/desktop/src/desktop-mode.ts`
- 修改：`apps/desktop/tests/main-composition.spec.ts`
- 修改：`apps/desktop/tests/shell-protocol.spec.ts`
- 修改：`apps/desktop/tsdown.config.ts`
- 修改：`apps/desktop/package.json`
- 修改：`apps/desktop/tests/packaging-config.spec.ts`
- 修改：`apps/desktop/tests/verify-packaged-runtime.spec.ts`

**接口：**
- 消费：任务 1-3 的带主题视图和协调器。
- 产出：两个打包 preload 路径及组合根中的当前模式同步。
- `DesktopHarnessSurfaceFactoryOptions` 与 `DesktopChatSurfaceFactoryOptions` 报告状态并返回 `DesktopThemedSurface`。

- [ ] **步骤 1：用失败的双向用例替换旧组合主题测试。**证明选中 Harness 驱动 Chat、选中 Chat 驱动 Harness、隐藏模式分歧被纠正、`system` 跟随 `DesktopSystemTheme`、切换时在可见前应用，以及适配器诊断不会使任一模式失败。

- [ ] **步骤 2：增加失败的打包断言。**要求 `lib/harness-theme-preload.cjs` 与 `lib/chat-theme-preload.cjs` 出现在 `asarUnpack`、打包运行时检查和两个生产路径分支中。

- [ ] **步骤 3：运行聚焦失败测试。**

运行：`pnpm exec vitest run apps/desktop/tests/main-composition.spec.ts apps/desktop/tests/packaging-config.spec.ts apps/desktop/tests/verify-packaged-runtime.spec.ts`

预期：因缺失协调器连接和 preload 产物而失败。

- [ ] **步骤 4：组合协调器。**加载初始模式后创建协调器，在发送 chrome 状态前调用 `select(snapshot.selected)`，用幂等 disposer 连接每个带主题视图，并把解析配色用于 `chromeTheme`。在收到权威主题桥报告前，现有 Harness theme-color 结果只作为后备。

```text
const themes = createDesktopThemeCoordinator({
  initialMode,
  initialSystemScheme: systemScheme,
  onChange: () => { sendChromeTheme() },
})

const connectTheme = (mode: DesktopMode, surface: DesktopThemedSurface): DesktopThemedSurface => {
  const disconnect = themes.connect(mode, preference => { surface.setThemePreference(preference) })
  return {
    ...surface,
    async dispose() { disconnect(); await surface.dispose() },
  }
}
```

- [ ] **步骤 5：增加生产 preload 路径与 bundle。**向 `tsdown.config.ts` 增加两个入口，向 `shellPaths()` 增加两个路径，向 `package.json` 增加两个 unpack 规则，并增加准确打包文件测试。

- [ ] **步骤 6：运行组合与打包测试。**

运行：`pnpm exec vitest run apps/desktop/tests/main-composition.spec.ts apps/desktop/tests/shell-protocol.spec.ts apps/desktop/tests/packaging-config.spec.ts apps/desktop/tests/verify-packaged-runtime.spec.ts`

预期：通过。

### 任务 5：预留 Chat 标题区并把原生 chrome 缩到控件范围

**文件：**
- 新建：`apps/desktop/src/desktop-chrome-layout.ts`
- 新建：`apps/desktop/tests/desktop-chrome-layout.spec.ts`
- 修改：`apps/desktop/src/desktop-application.ts`
- 修改：`apps/desktop/resources/mode-chrome.html`
- 修改：`apps/desktop/resources/mode-chrome.css`
- 修改：`apps/desktop/src/mode-chrome-preload.ts`
- 修改：`apps/desktop/resources/shell.html`
- 修改：`apps/desktop/resources/shell.css`
- 修改：`apps/desktop/tests/main-composition.spec.ts`

**接口：**
- 产出：用于关闭、模式菜单、Chat 菜单和对话框原生矩形的 `desktopChromeBounds(input)`。
- 产出：只用于 Chat 的 `insetDesktopContentBounds(bounds, top)`。
- 模式 preload 写入 `data-surface`、`data-compact` 和完整或缩写标签。

- [ ] **步骤 1：编写失败的几何测试。**固定 macOS 与 Windows 选择器原点、准确关闭宽度、48px 关闭高度、菜单扩展、全窗对话框、非负 Chat 剩余高度，以及关闭 chrome 在 Chat 内容开始前结束的不变量。

```text
expect(desktopChromeBounds({
  platform: 'darwin', mode: 'chat', compact: false, surface: 'closed', content,
})).toEqual({ x: 27, y: 44, width: 198, height: 48 })
expect(insetDesktopContentBounds(content, 98)).toEqual({
  x: 0, y: 98, width: content.width, height: content.height - 98,
})
```

- [ ] **步骤 2：更新组合测试，要求只对 Chat 应用顶部 inset。**Harness 保持 `{ x: 0, y: 0, width, height }`；Chat 使用标题 inset。关闭 chrome 不再使用 `{ x: 0, y: 0, width: 280, height: 98 }`。

- [ ] **步骤 3：运行几何失败测试。**

运行：`pnpm exec vitest run apps/desktop/tests/desktop-chrome-layout.spec.ts apps/desktop/tests/main-composition.spec.ts`

预期：因旧的完整标题边界和全高 Chat 而失败。

- [ ] **步骤 4：实现纯几何并用于组合。**把平台常量放在一个模块中。通过带主题视图包装器应用 Chat inset，使与框架无关的模式控制器保持不变。

- [ ] **步骤 5：简化选择器标记与 CSS。**移除 `.mode-mark` 和 Chat 标题伪元素。让控件相对原生视图原点布局。常驻、悬停和打开状态都不使用边框或填充；只保留前景变化和 `:focus-visible` 轮廓。紧凑标签为 `DSH` 和 `Chat`，绝不显示图标。

```css
#mode-selector {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 48px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: var(--chrome-text);
}

#mode-selector:hover,
#mode-selector[aria-expanded='true'] {
  border: 0;
  background: transparent;
  color: var(--chrome-text);
}
```

- [ ] **步骤 6：把拖拽所有权移到本地 shell。**在 Chat 后方增加透明标题拖拽位置；选择器、菜单、对话框和官网控件继续通过各自渲染器保持 `no-drag`。

- [ ] **步骤 7：运行聚焦几何与组合测试。**

运行：`pnpm exec vitest run apps/desktop/tests/desktop-chrome-layout.spec.ts apps/desktop/tests/main-composition.spec.ts`

预期：通过。

### 任务 6：在 Electron 与视觉 QA 中证明行为

**文件：**
- 修改：`apps/desktop/tests/fixtures/dual-mode-app/main.mjs`
- 修改：`apps/desktop/tests/dual-mode.electron.spec.ts`
- 修改：`design-qa.md`
- 产出：`output/playwright/desktop-theme-sync/*.png`

**接口：**
- fixture 记录 `preferences`、Chat 重载次数、可见边界、官网侧栏控件点击和带主题视图代次。
- Electron 截图在 Chat 原生顶部 inset 处合成其内容，不再假设每个内容视图都从 `y = 0` 开始。

- [ ] **步骤 1：在生产断言通过前扩展 fixture。**增加 Chat 左上侧栏按钮、两个 fixture 视图的主题报告、幂等 `setThemePreference`、隐藏 Chat 重载计数，以及点击和偏好状态字段。

- [ ] **步骤 2：编写失败的 Electron 场景。**证明 Harness 暗色 -> Chat 暗色、Chat 亮色 -> Harness 亮色、`system` 跟随 nativeTheme、隐藏分歧不能胜出、Chat 只在隐藏时重载，以及清除数据后重建采用共享偏好。

- [ ] **步骤 3：增加点击与选择器断言。**验证 Chat 控件位于关闭 chrome 矩形下方，点击控件并观察 fixture 计数。断言不存在 `.mode-mark`、边框和背景透明、展开和紧凑布局都为文字加箭头，以及菜单扩展与恢复。

- [ ] **步骤 4：运行带截图的 Electron 测试。**

运行：`DSH_DESKTOP_SCREENSHOT_DIR=output/playwright/desktop-theme-sync pnpm --filter @deepseek-ai/dsh-desktop run test:electron`

预期：通过，并产出 Harness/Chat 亮暗、展开/紧凑、打开/关闭截图。

- [ ] **步骤 5：检查每张截图。**确认没有绘制横向工具栏、不与红黄绿按钮或官网控件重叠、官网控件位于选择器下方、亮暗前景可读、菜单几何稳定且内容不空白或裁剪。在 `design-qa.md` 中记录视口、场景和结论。

### 任务 7：更新记录、运行相关检查并重建双平台

**文件：**
- 修改：`apps/desktop/README.md`
- 修改：`apps/desktop/README.zh.md`
- 修改：`apps/desktop/README.i18n.yaml`
- 修改：`packages/client/ui-theme/README.md`
- 修改：`packages/client/ui-theme/README.zh.md`
- 修改：`packages/client/ui-theme/README.i18n.yaml`
- 修改：`.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md`
- 修改：`.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.zh.md`
- 修改：`.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.i18n.yaml`
- 验证：`docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md`
- 产出：`apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip`
- 产出：`apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip`

**接口：**
- 文档说明当前模式决定权规则、私有 Chat 适配器及失败行为、自有 Harness 主题桥、未绘制标题区和不检查内容保证。
- 产物文件名保持稳定，供用户测试。

- [ ] **步骤 1：更新双语记录与 JSDoc 契约。**用现在时描述当前交付行为，更新现有 Agent Note 而不是创建第二个所有者，并记录每个已确认文档对哈希。只有实施暴露事实不一致时才更新已批准规格。

- [ ] **步骤 2：运行聚焦测试。**

运行：`pnpm exec vitest run apps/desktop/tests packages/client/ui-theme/tests/desktop-theme-bridge.client.spec.ts packages/client/ui-theme/tests/theme.client.spec.ts`

预期：通过。

- [ ] **步骤 3：对变更所有权区域运行类型检查、构建和 lint。**

```sh
pnpm --filter @deepseek-ai/dsh-desktop run typecheck
pnpm exec tsc -p packages/client/ui-theme/tsconfig.json --noEmit
pnpm --filter @deepseek-ai/dsh-desktop run build
pnpm exec tsx scripts/run-oxlint.ts apps/desktop/src apps/desktop/tests packages/client/ui-theme/src packages/client/ui-theme/tests
```

预期：每条命令退出码均为 0。

- [ ] **步骤 4：运行文档检查。**

```sh
pnpm run verify-translation-pairing apps/desktop/README.md packages/client/ui-theme/README.md .agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md docs/superpowers/plans/2026-08-16-desktop-bidirectional-theme-and-chat-header.md
pnpm run verify-md-wrap
pnpm run verify-md-links
pnpm run verify-agent-note-format
pnpm run doc-sync
```

预期：范围检查通过。如果只有 `doc-sync` 需要不可用的 Git 元数据，则报告该环境失败，但不削弱文档规则。

- [ ] **步骤 5：重建并归档 macOS arm64。**

```sh
node --import tsx apps/desktop/scripts/stage-runtime.ts --os=darwin --cpu=arm64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --mac dir --arm64 --config.mac.identity=null --config.mac.notarize=false
ditto -c -k --sequesterRsrc --keepParent apps/desktop/dist/mac-arm64 apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip
```

- [ ] **步骤 6：启动打包后的 macOS 应用。**使用隔离的用户数据目录，验证 Harness 启动，切换到 Chat fixture 或官网但不修改用户实时分区，捕获截图并干净退出。

- [ ] **步骤 7：重建并归档 Windows x64。**

```sh
node --import tsx apps/desktop/scripts/stage-runtime.ts --os=win32 --cpu=x64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --win dir --x64 --config.electronDist=/Users/zo/Library/Caches/electron/63857c95525ff62c967a319a9c3921773c3420b77c6ebce7f47c8c76e68d9e11/electron-v43.4.0-win32-x64.zip
(cd apps/desktop && zip -qr -FS dist/DeepSeek-Harness-Windows-x64.zip dist/win-unpacked)
```

- [ ] **步骤 8：验证架构、归档完整性和必要 preload。**

```sh
file "apps/desktop/dist/mac-arm64/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" "apps/desktop/dist/win-unpacked/DeepSeek Harness.exe"
unzip -tq apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip
unzip -tq apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip
find apps/desktop/dist/mac-arm64 apps/desktop/dist/win-unpacked -path '*harness-theme-preload.cjs' -o -path '*chat-theme-preload.cjs'
shasum -a 256 apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip
```

预期：Mach-O arm64、PE32+ x86-64、两个 ZIP 检查均无错误、两个包都含两个 preload，并打印两个 SHA-256 哈希。

## 自检清单

- 规格覆盖：三种主题偏好、两个同步方向、当前模式决定权、只在隐藏状态重载 Chat、适配器故障隔离、标题几何、真实官网控件点击、选择器简化、紧凑文字、文档和两个产物均映射到任务。
- 占位符扫描：不存在延后标记、未明确验证或笼统的“编写测试”步骤。
- 类型一致性：`DesktopThemePreference`、`DesktopThemeState`、`DesktopThemedSurface`、`DESKTOP_THEME_CHANNELS`、`setThemePreference` 和 `onThemeState` 只使用一种拼写和方向。
- 安全一致性：Harness 只接收封闭主题桥；Chat 不接收暴露主题桥，只读取准确主题存储项和 body 主题标记。
- 生命周期一致性：每个 IPC、Cordis、DOM observer 和协调器连接都有幂等 disposer；可见 Chat 绝不会被隐藏状态重载。
- 执行方式：用户的主线执行要求已经选择内联实施；排除子代理。
