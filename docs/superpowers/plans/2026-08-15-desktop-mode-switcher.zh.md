# 桌面模式切换器实施计划

[English](2026-08-15-desktop-mode-switcher.md) | 中文

> **面向 agent worker：** REQUIRED SUB-SKILL：建议使用 superpowers:subagent-driven-development 或 superpowers:executing-plans，按任务逐项实施本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 用一个可访问的侧栏模式选择器替换全宽 Chat/Harness 模式栏，并将其叠加在两个保留的桌面内容视图上。

**架构：** 保留现有 `BrowserWindow` 作为本地状态与 IPC 外壳。为它创建一个透明的独立 `WebContentsView`，其原生边界限制在侧栏标题/选择器区域，只有打开菜单或清除数据模态对话框时才扩展。Harness 与 Chat 的 `WebContentsView` 位于其下方并占据完整内容边界。chrome 视图只负责展示和发送封闭 IPC 命令；`DesktopModeController` 仍是选择、持久化、视图生命周期和失败状态的唯一所有者。

**技术栈：** Electron 43 `BrowserWindow`/`WebContentsView`、来自 `tsdown` 且兼容 sandbox 的 CommonJS preload bundle、本地 chrome 静态 HTML/CSS、Vitest、Playwright Electron 测试和现有桌面打包校验。

## 全局约束

- 选择器位于左侧侧栏标题区；不保留全宽模式工具栏的填充、边框或高度。
- Chat 仍是未经修改的 `https://chat.deepseek.com/` 网站；不允许 DOM 注入、抓取、私有 API 调用或远程 preload。
- `DeepSeek Chat` 与 `Harness` 保持独立的凭据、存储、导航、页面状态和失败生命周期。
- 展开态模式标签为 `DeepSeek Chat` 和 `Harness`；收起态入口为 DeepSeek 图标。
- 菜单使用 `menu`/`menuitemradio`、`aria-checked`、焦点恢复、方向键移动以及 `Enter`、空格、`Escape` 行为。
- 原生标题栏为平台窗口按钮与拖动保留固定的 `DESKTOP_TITLEBAR_HEIGHT`；这不是模式工具栏高度，也不预留可见的应用栏。
- 不添加新的运行时依赖；使用现有 Electron、TypeScript、CSS 和测试栈。
- macOS 与 Windows 打包必须包含新的本地 chrome HTML/CSS 和 CommonJS preload。

---

### 任务 1：拆分本地 shell 与 mode-chrome 文档

**文件：**
- Create: `apps/desktop/resources/mode-chrome.html`
- Create: `apps/desktop/resources/mode-chrome.css`
- Create: `apps/desktop/src/mode-chrome-preload.ts`
- Modify: `apps/desktop/resources/shell.html`
- Modify: `apps/desktop/resources/shell.css`
- Modify: `apps/desktop/src/shell-preload.ts`
- Modify: `apps/desktop/src/shell-protocol.ts`
- Modify: `apps/desktop/tsdown.config.ts`
- Modify: `apps/desktop/package.json`
- Test: `apps/desktop/tests/shell-protocol.spec.ts`
- Test: `apps/desktop/tests/packaging-config.spec.ts`

**接口：**
- `mode-chrome-preload.ts` 使用 `DESKTOP_SHELL_CHANNELS.select`、`DESKTOP_SHELL_CHANNELS.command` 和 `DESKTOP_SHELL_CHANNELS.snapshot`；只产生模式选择和封闭 shell 命令消息。
- `shell-preload.ts` 使用同一个 snapshot 通道渲染状态，并在本地 shell 文档中保留重试、浏览器回退和失败展示。
- `tsdown.config.ts` 在 `lib/shell-preload.cjs` 旁生成 `lib/mode-chrome-preload.cjs`；两者都是兼容 sandbox 的 CommonJS 文件。

- [ ] **步骤 1：先扩展打包断言。** 将 `mode-chrome.html`、`mode-chrome.css` 和 `lib/mode-chrome-preload.cjs` 加入 `packaging-config.spec.ts` 的本地资源列表，并扩展 `shell-protocol.spec.ts` 覆盖未改变的封闭命令和 snapshot 通道。

```text
const REQUIRED_PACKAGED_SHELL_FILES = [
  'desktop-resources/shell.html',
  'desktop-resources/shell.css',
  'desktop-resources/mode-chrome.html',
  'desktop-resources/mode-chrome.css',
  'lib/shell-preload.cjs',
  'lib/mode-chrome-preload.cjs',
] as const
```

- [ ] **步骤 2：运行聚焦测试并记录预期失败。**

运行：`pnpm exec vitest run apps/desktop/tests/shell-protocol.spec.ts apps/desktop/tests/packaging-config.spec.ts`

预期：由于新的资源条目和协议断言尚未实现，测试失败。

- [ ] **步骤 3：将模式控件移出 `shell.html`。** 保留 shell.html 中的状态区、重试和浏览器回退。创建 `mode-chrome.html`，包含 `#mode-chrome-root`、`#mode-selector` 按钮、包含两个 `menuitemradio` 行的 `#mode-menu`、`#chat-actions`、`#chat-menu` 以及 Chat 数据确认对话框。

```html
<main id="mode-chrome-root">
  <button id="mode-selector" aria-haspopup="menu" aria-expanded="false">
    <img src="trayTemplate.png" alt="">
    <span id="mode-label"></span>
    <span aria-hidden="true" class="chevron"></span>
  </button>
  <button id="chat-actions" aria-label="Chat actions" aria-expanded="false" hidden>...</button>
  <div id="mode-menu" role="menu" hidden>
    <button role="menuitemradio" data-mode="chat" aria-checked="false">
      <strong>DeepSeek Chat</strong><span>官方网页对话</span>
    </button>
    <button role="menuitemradio" data-mode="harness" aria-checked="false">
      <strong>Harness</strong><span>构建、调试与执行</span>
    </button>
  </div>
</main>
```

mode-chrome 文档的 CSP 只允许自身样式表和 `trayTemplate.png` 图片；脚本保持禁用，因为所有行为都由 sandbox preload 提供。

- [ ] **步骤 4：实现两个 preload 职责。** `mode-chrome-preload.ts` 读取 snapshot，更新当前标签和 `aria-checked`，发送模式/命令消息，在外部点击或 `Escape` 时关闭，使用方向键移动活动行，用 `Enter` 确认，并在关闭后将焦点恢复到 `#mode-selector`。`shell-preload.ts` 不再查询模式按钮或 Chat 操作，只渲染状态控件。

- [ ] **步骤 5：增加 CJS 入口和打包规则。** 将 `lib/types/mode-chrome-preload.js` 加入 CJS `tsdown` 入口，将 `lib/mode-chrome-preload.cjs` 加入 `asarUnpack`，并继续通过现有 `resources -> desktop-resources` 复制规则包含两个本地文档。

- [ ] **步骤 6：运行聚焦测试验证文档/协议契约。**

运行：`pnpm exec vitest run apps/desktop/tests/shell-protocol.spec.ts apps/desktop/tests/packaging-config.spec.ts`

预期：两个文件中的所有测试通过。

### 任务 2：加入透明 chrome 视图和完整内容边界

**文件：**
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/desktop-application.ts`
- Modify: `apps/desktop/tests/main-composition.spec.ts`
- Modify: `apps/desktop/tests/dual-mode.electron.spec.ts`

**接口：**
- `DesktopApplicationOptions` 增加 `chromePath` 和 `chromePreloadPath`。
- `shellPaths()` 为源代码和打包布局返回 `shellPath`、`preloadPath`、`chromePath` 和 `chromePreloadPath`。
- `contentBounds()` 返回 `{ x: 0, y: 0, width, height }`；模式控制器继续为每个 surface 接收一份复制的边界对象。
- 装配层在模式控制器之外拥有 `chromeView`，并在窗口释放时移除/关闭它。

- [ ] **步骤 1：扩展装配 fixture 以模拟第四个 WebContentsView。** 为 `FakeViewContents`/`fakeView` 增加 `loadFile`、`close` 和 `setBounds` 观察，向 `applicationOptions` 传递 chrome 路径，并断言某个视图收到完整边界 `{ x: 0, y: 0, width: 1200, height: 800 }`。

```text
await vi.waitFor(() => {
  expect(harness.value.setBounds).toHaveBeenCalledWith({
    x: 0, y: 0, width: 1200, height: 800,
  })
})
```

- [ ] **步骤 2：在实现前运行装配和 Electron 测试。**

运行：`pnpm exec vitest run apps/desktop/tests/main-composition.spec.ts apps/desktop/tests/dual-mode.electron.spec.ts`

预期：现有装配仍会减去模式栏高度且没有 chrome 视图，因此测试失败。

- [ ] **步骤 3：在 `main.ts` 中解析四个本地路径。** 打包路径指向 `desktop-resources/mode-chrome.html` 和 `app.asar.unpacked/lib/mode-chrome-preload.cjs`；源代码路径指向 `apps/desktop/resources/mode-chrome.html` 和 `apps/desktop/lib/mode-chrome-preload.cjs`。将两个路径传给 `createDesktopApplication`。

- [ ] **步骤 4：在本地 shell 加载后创建并加载 chrome 视图。** 使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` 和 `webSecurity: true` 构建；添加到 `window.contentView`；为关闭的选择器状态设置边界；加载本地 chrome 文档；并在每个内容视图附加后移除再添加 chrome 子视图，使它保持在 Chat/Harness 之上。收到 `chrome-surface` 消息后，为菜单或模态对话框扩展边界。

```text
const chrome = options.createView({
  webPreferences: {
    preload: options.chromePreloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  },
})
nativeWindow.contentView.addChildView(chrome)
chrome.setBounds(fullContentBounds(nativeWindow))
await chrome.webContents.loadFile(options.chromePath)
```

- [ ] **步骤 5：将 chrome 层限制在自身原生边界内。** mode-chrome root 使用 `pointer-events: none`；选择器、溢出按钮、菜单、对话框和拖拽区显式启用指针处理。主进程根据 `chrome-surface` 消息调整视图大小，避免 WebContentsView 命中测试遮挡其余内容。透明标题栏带继续使用 `-webkit-app-region: drag`，交互元素继续使用 `no-drag`。

- [ ] **步骤 6：随窗口释放和调整大小管理 chrome 视图。** 与模式视图使用同一个 `resize` 监听器调整它。窗口 `closed` 和显式释放时，从 `contentView` 移除它；必要时关闭其 `webContents`，并在保留的模式视图停止前清除引用。

- [ ] **步骤 7：实现后运行聚焦装配测试。**

运行：`pnpm exec vitest run apps/desktop/tests/main-composition.spec.ts apps/desktop/tests/dual-mode.electron.spec.ts`

预期：完整边界、chrome 分层、模式切换、保留 Chat 状态、独立失败处理和清理覆盖均通过。

### 任务 3：实现侧栏视觉系统和交互状态

**文件：**
- Modify: `apps/desktop/resources/mode-chrome.css`
- Modify: `apps/desktop/resources/shell.css`
- Modify: `apps/desktop/resources/mode-chrome.html`
- Modify: `apps/desktop/src/mode-chrome-preload.ts`

**接口：**
- chrome 文档只接收已有序列化 snapshot，并只发送已有封闭选择/命令联合类型。
- CSS 变量复用当前 shell 的 surface、文本、次要文本、强调色、边框和危险色 token；不增加新的设计依赖或框架。

- [ ] **步骤 1：加入透明的本地层样式。** root 保持透明并可穿透，展开选择器位于原生标题栏内缩下方的 `left: 12px`，使用现有 12px 侧栏圆角，并将菜单限制为 `min(300px, calc(100vw - 24px))`，确保最长标签留在父容器内。

- [ ] **步骤 2：加入展开与收起几何。** 展开选择器显示 16px tray 标记、标签和箭头。收起状态提供稳定的 36px 图标命中区域，并将菜单放在其右侧。macOS 和 Windows 标题栏内缩使用平台 data 属性，而不是硬编码的平台 DOM 分支。

- [ ] **步骤 3：加入交互反馈和减少动画处理。** 菜单打开/关闭及行的悬停/按下状态使用 160–200ms 的透明度/变换过渡。加入清晰的 `:focus-visible` 轮廓，并在 `prefers-reduced-motion: reduce` 下禁用过渡。

- [ ] **步骤 4：保持状态展示独立。** 从 `shell.css` 移除废弃的模式栏间距；让状态内容在完整可用窗口内居中，并在选中 surface 未就绪时继续提供现有失败操作。

- [ ] **步骤 5：运行桌面类型检查和聚焦测试。**

运行：`pnpm --filter @deepseek-ai/dsh-desktop run typecheck` 和 `pnpm exec vitest run apps/desktop/tests/shell-protocol.spec.ts apps/desktop/tests/main-composition.spec.ts apps/desktop/tests/dual-mode.electron.spec.ts`

预期：通过。仓库中与本任务无关的客户端 React 类型版本冲突不应在本 UI 工作中修改。

### 任务 4：更新 fixture、打包契约和决策记录

**文件：**
- Modify: `apps/desktop/tests/dual-mode.electron.spec.ts`
- Modify: `apps/desktop/tests/verify-packaged-runtime.spec.ts`
- Modify: `apps/desktop/tests/packaging-config.spec.ts`
- Modify: `apps/desktop/scripts/verify-packaged-runtime.ts`
- Modify: `apps/desktop/README.md`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.zh.md`
- Modify: `docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md`（只有已交付路径或行为不同于批准设计时）

**接口：**
- Playwright Electron helper 发现独立的 `mode-chrome.html` 目标，并使用其 locator 操作选择器；Chat 内容继续通过 `webContents.getAllWebContents()` 检查。
- `afterPack` 在平台对应的 Resources 目录中要求两个 mode-chrome 文档和两个本地 preload。
- 现有已实现 Agent Note 仍是双模式决策的归属文档，并在两种语言中记录交付的侧栏 chrome，而不是模式栏。

- [ ] **步骤 1：更新 Electron fixture locator。** 增加等待本地 `mode-chrome.html` 目标的 helper，然后将模式选择、溢出、清除数据和菜单断言移到该页面。增加外部点击关闭、`Escape`、方向键移动、收起图标位置和保留 Chat 状态不变的场景。

- [ ] **步骤 2：扩展打包运行时检查。** 将 mode-chrome HTML/CSS 和 `mode-chrome-preload.cjs` 加入 `REQUIRED_SHELL_FILES`，创建 macOS 与 Windows 两个平台的 fixture 路径，并保留缺失资源拒绝测试。

- [ ] **步骤 3：更新 desktop README 和现有双语 Agent Note。** 说明本地 mode chrome 是位于两个保留 `WebContentsView` 子视图上方的透明侧栏覆盖层，内容视图使用完整边界，官方 Chat 页面保持不变。保留现有安全、导航、隐私和生命周期保证。

- [ ] **步骤 4：运行完整聚焦桌面验证。**

运行：`pnpm exec vitest run apps/desktop/tests`

预期：所有桌面测试文件通过，包括真实 Electron 双模式场景。

- [ ] **步骤 5：运行源码/构建和文档门禁。**

运行：`pnpm --filter @deepseek-ai/dsh-desktop run build`、`pnpm exec oxlint apps/desktop/src apps/desktop/scripts`、`pnpm run verify-md-wrap`、`pnpm run verify-md-links`、`pnpm run verify-agent-note-format` 和 `pnpm run verify-translation-pairing`。

预期：每个命令退出码为 0。如果无关的 React 类型版本冲突仍存在，不要声称仓库级聚合构建干净。

- [ ] **步骤 6：构建并检查两个桌面产物。** 重新构建 Web/Client 输出，为 `darwin/arm64` 和 `win32/x64` 暂存 runtime，运行 Electron Builder 目录目标，并确认每个产物包含两个本地 chrome 文档、两个本地 preload、状态 shell 资源、Harness Host 入口和 Web 前端。使用 `file` 确认 Mach-O arm64 与 PE32+ x64 架构，再对便携 ZIP 运行 `unzip -tq`。

此 checkout 没有 Git 元数据，因此不执行提交步骤；计划和实现文件保留在共享工作区中供直接审阅。

## 自审清单

- 规范覆盖：侧栏位置、收起入口、窗口分层、远程 DOM 隔离、键盘访问、失败行为、保留状态、打包和视觉验证分别映射到任务 1–4。
- 占位符扫描：每个任务都列出文件、接口、命令和预期证据。
- 类型一致性：`chromePath`/`chromePreloadPath`、`mode-chrome.html`、`mode-chrome-preload.cjs`、`DESKTOP_TITLEBAR_HEIGHT` 和完整 `{ x, y, width, height }` 边界在全文使用相同名称。
