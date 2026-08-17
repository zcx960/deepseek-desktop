# 桌面标题栏模式切换器实施计划

[English](2026-08-16-desktop-titlebar-mode-switcher.md) | 中文

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**目标：** 把常驻的 Harness／DeepSeek Chat 选择器移入操作系统已有标题栏，移除 Chat 上方的应用自有标题区，并让指针模式切换保持可靠。

**架构：** 保留隔离的透明 mode-chrome `WebContentsView`，但把关闭状态边界限制在标题栏控件，并把菜单打开改为由主进程确认的几何状态转换。Harness 保持完整内容边界，因为其布局已经适配桌面标题栏；Chat 只接收 `DESKTOP_TITLEBAR_HEIGHT`，其余部分保持官网页面布局。

**技术栈：** Electron 43 `BrowserWindow`／`WebContentsView`、TypeScript、由 `tsdown` 打包且兼容沙箱的 CommonJS preload、静态 HTML/CSS、Vitest、Playwright Electron、Sharp 截图合成和 Electron Builder。

## 全局约束

- 在当前会话中使用主线执行；不得调度 subagent。
- 选择器使用操作系统已有的 44px 标题栏，绝不创建另一条全宽行。
- macOS 把选择器放在红黄绿按钮右侧；Windows 把它放在左侧，原生标题按钮仍位于右侧。
- 关闭状态 chrome 只包含选择器和可选 Chat 溢出控件；透明原生像素不得覆盖产品控件。
- 选择器始终显示 `Harness` 或 `DeepSeek Chat` 及箭头；它没有图标、常驻边框或常驻填充。
- Harness 与 Chat 保留独立的凭据、存储、导航、页面状态和失败生命周期；主题偏好仍是两者之间唯一同步的产品偏好。
- 除已有隔离主题适配器外，远程 Chat document 保持不变；不得向官网注入选择器 DOM 或 CSS。
- 不增加运行时依赖。当前 checkout 没有 `.git`，因此执行过程只记录验证，不包含提交步骤。

---

### 任务 1：修正标题栏与内容几何

**文件：**
- 修改：`apps/desktop/src/desktop-chrome-layout.ts`
- 修改：`apps/desktop/src/desktop-application.ts`
- 修改：`apps/desktop/resources/shell.css`
- 测试：`apps/desktop/tests/desktop-chrome-layout.spec.ts`
- 测试：`apps/desktop/tests/main-composition.spec.ts`

**接口：**
- `desktopChromeBounds(input: DesktopChromeBoundsInput): DesktopContentBounds` 在 BrowserWindow 内容坐标中生成紧密的关闭／菜单／对话框矩形。
- `insetDesktopContentBounds(bounds, DESKTOP_TITLEBAR_HEIGHT)` 生成 Chat 边界；Harness 继续接收原始边界。
- `DESKTOP_TITLEBAR_HEIGHT` 仍是唯一共享的 44px 标题栏常量。

- [x] **步骤 1：编写失败的几何断言。** 用标题栏矩形替换原先的 macOS `{ x: 27, y: 44, height: 48 }` 预期，并断言 Chat 只使用 44px，而 Harness 保持全高。

```text
expect(desktopChromeBounds({
  platform: 'darwin', mode: 'harness', surface: 'closed', content,
})).toEqual({ x: 88, y: 4, width: 88, height: 36 })

expect(insetDesktopContentBounds(content, DESKTOP_TITLEBAR_HEIGHT)).toEqual({
  x: 0, y: 44, width: 1200, height: 756,
})
```

- [x] **步骤 2：运行红色测试。**

运行：`pnpm exec vitest run apps/desktop/tests/desktop-chrome-layout.spec.ts apps/desktop/tests/main-composition.spec.ts`

预期：FAIL，因为关闭状态 chrome 仍从 `y=44` 开始，Chat 仍使用 98px／58px 本地标题区。

- [x] **步骤 3：实现最小几何修改。** 在标题栏内使用一条垂直居中的 36px 控件行；macOS 使用红黄绿按钮之后的前导 inset，Windows 使用左侧前导 inset。删除紧凑宽度几何和派生本地标题区高度。

```text
const CHROME_TOP = 4
const CHROME_HEIGHT = 36
const CHROME_INLINE_INSET_MACOS = 88
const CHROME_INLINE_INSET_WINDOWS = 12
const CHROME_SELECTOR_WIDTH_HARNESS = 88
const CHROME_SELECTOR_WIDTH_CHAT = 140
```

- [x] **步骤 4：只向 Chat 应用系统标题栏 inset。** 在 Chat 主题连接中用 `DESKTOP_TITLEBAR_HEIGHT` 替换 `desktopChromeHeaderHeight(options.platform)`。把 macOS 与 Windows 的 shell 拖拽区域设为 44px；Harness 保持完整边界和已有内部适配。

- [x] **步骤 5：运行绿色几何与组合测试。**

运行：`pnpm exec vitest run apps/desktop/tests/desktop-chrome-layout.spec.ts apps/desktop/tests/main-composition.spec.ts`

预期：PASS，覆盖 macOS 与 Windows 标题栏位置、紧密关闭边界、完整 Harness 边界和仅 44px 的 Chat 边界。

### 任务 2：渲染菜单前确认几何状态

**文件：**
- 修改：`apps/desktop/src/shell-protocol.ts`
- 修改：`apps/desktop/src/desktop-application.ts`
- 修改：`apps/desktop/src/mode-chrome-preload.ts`
- 测试：`apps/desktop/tests/shell-protocol.spec.ts`
- 测试：`apps/desktop/tests/main-composition.spec.ts`

**接口：**
- `DesktopChromeLayout` 携带已应用的 `surface: DesktopChromeSurface` 和 `dismissMenus: boolean`；删除 compact 标记。
- renderer 把 `DESKTOP_SHELL_CHANNELS.chromeSurface` 作为请求发送，并且只在 `DESKTOP_SHELL_CHANNELS.chromeLayout` 确认相同状态后显示菜单。
- 主进程在发送确认前调用 `setBounds()`。

- [x] **步骤 1：编写失败的协议与顺序测试。** 断言每条布局消息都包含已应用状态，并且原生 `setBounds` 调用早于 `webContents.send(chromeLayout, ...)`。

```text
expect(chrome.contents.send).toHaveBeenLastCalledWith(
  DESKTOP_SHELL_CHANNELS.chromeLayout,
  { surface: 'mode-menu', dismissMenus: false },
)
expect(chrome.view.setBounds.mock.invocationCallOrder.at(-1))
  .toBeLessThan(chrome.contents.send.mock.invocationCallOrder.at(-1))
```

- [x] **步骤 2：运行红色协议测试。**

运行：`pnpm exec vitest run apps/desktop/tests/shell-protocol.spec.ts apps/desktop/tests/main-composition.spec.ts`

预期：FAIL，因为当前布局载荷携带 `compact`，renderer 会在主进程应用扩展边界前显示菜单。

- [x] **步骤 3：修改封闭 IPC 载荷。** 定义不含响应式标签标记的已应用状态响应。

```text
export interface DesktopChromeLayout {
  readonly surface: DesktopChromeSurface
  readonly dismissMenus: boolean
}
```

- [x] **步骤 4：实现 renderer 请求／确认行为。** `openModeMenu()` 与 Chat 溢出菜单打开器只记录请求状态并发送消息，不立即显示内容。`chromeLayout` listener 只显示与请求相符的状态。关闭时先隐藏菜单内容，再记录 `closed` 并请求紧密原生边界。dismiss 或不匹配的陈旧确认会让所有菜单保持隐藏，并在需要时请求 `closed`。

```text
const requestOpen = (next: DesktopChromeSurface): void => {
  requestedSurface = next
  ipcRenderer.send(DESKTOP_SHELL_CHANNELS.chromeSurface, next)
}

const applyLayout = (layout: DesktopChromeLayout): void => {
  if (layout.dismissMenus || layout.surface !== requestedSurface) {
    hideMenus()
    return
  }
  reveal(layout.surface)
}
```

- [x] **步骤 5：保留键盘与焦点行为。** `Enter`、空格键和方向键请求打开菜单；`Escape`、失去焦点、外部输入和完成选择会关闭菜单。只有收到确认后，焦点才移至已选菜单行；通过键盘关闭后，焦点返回选择器。

- [x] **步骤 6：运行绿色协议与组合测试。**

运行：`pnpm exec vitest run apps/desktop/tests/shell-protocol.spec.ts apps/desktop/tests/main-composition.spec.ts`

预期：PASS，覆盖已确认状态、边界早于确认的顺序、dismiss 和关闭状态恢复。

### 任务 3：让选择器在视觉上融入标题栏，并证明真实指针行为

**文件：**
- 修改：`apps/desktop/resources/mode-chrome.css`
- 修改：`apps/desktop/src/mode-chrome-preload.ts`
- 修改：`apps/desktop/tests/dual-mode.electron.spec.ts`
- 修改：`apps/desktop/tests/fixtures/dual-mode-app/main.mjs`
- 修改：`design-qa.md`

**接口：**
- 关闭状态 chrome 在局部 `{ x: 0, y: 0 }` 渲染一条 36px 标题栏控件行；模式菜单在临时扩展视图内从该行下方开始。
- Electron fixture 报告 Harness、Chat 与 chrome 的原生边界，并在官网页面原始内容原点提供一个可点击的 Chat 侧栏控件。
- 截图合成在透明 chrome 的原生边界叠加图像，不虚构全宽标题区。

- [x] **步骤 1：为新行为编写失败的 Electron 断言。** 在最小宽度下要求完整标签，断言菜单在扩展边界确认前保持隐藏，使用真实指针点击选择每种模式，并证明 chrome 关闭时 Chat 侧栏控件能收到点击。

```text
await chrome.locator('#mode-selector').click()
await waitForChromeWidth(chrome, 264)
await chrome.locator('#mode-menu').waitFor()
await chrome.locator('[data-mode="chat"]').click()
await expect.poll(() => fixtureState(application)).toMatchObject({
  snapshot: { selected: 'chat' },
})
```

- [x] **步骤 2：运行红色 Electron 场景。**

运行：`pnpm --filter @deepseek-ai/dsh-desktop run build && pnpm exec vitest run apps/desktop/tests/dual-mode.electron.spec.ts`

预期：在旧 y 位置、旧高度、紧凑标签或菜单显示顺序上 FAIL。

- [x] **步骤 3：重新设置关闭状态标题栏控件样式。** 使用 14px 标题栏字体、稳定完整标签、透明常驻／展开按钮绘制、无边框和按文字颜色显示的 CSS 箭头。只在实际控件上保留 `pointer-events: auto` 与 `-webkit-app-region: no-drag`。把菜单放在 36px 控件行下方，并保留其不透明亮／暗主题表面。

- [x] **步骤 4：更新 fixture 几何与截图。** 在完整边界合成 Harness，在 `y=44` 合成 Chat，并在紧密原生矩形合成 chrome。以桌面和最小宽度捕获 Harness／Chat 亮暗状态以及菜单打开状态。在 `design-qa.md` 中记录标题栏对齐、不存在第二条横栏、主题前景可读和产品控件未被遮挡等观察结果。

- [x] **步骤 5：运行绿色 Electron 场景并检查图片。**

运行：`DSH_DESKTOP_SCREENSHOT_DIR=apps/desktop/output/playwright/desktop-titlebar-mode pnpm exec vitest run apps/desktop/tests/dual-mode.electron.spec.ts`

预期：PASS。每张截图都显示选择器位于原生标题栏，Chat 紧接 44px 行开始，Harness 保持原始布局，并且页面控件上方不存在常驻覆盖层。

### 任务 4：同步约定、验证并重建两个平台

**文件：**
- 修改：`apps/desktop/README.md`
- 修改：`apps/desktop/README.zh.md`
- 修改：`apps/desktop/README.i18n.yaml`
- 修改：`.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md`
- 修改：`.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.zh.md`
- 修改：`.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.i18n.yaml`
- 验证：`docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md`
- 验证：`docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.zh.md`

**接口：**
- 桌面 README 负责当前用户可见桌面行为和平台限制。
- 现有 implemented Agent Note 仍负责本地 chrome、远程页面隔离和保留视图生命周期的决策依据。
- 便携产物名称仍是 `DeepSeek-Harness-macOS-arm64.zip` 和 `DeepSeek-Harness-Windows-x64.zip`。

- [x] **步骤 1：同时更新两种语言的当前状态文档。** 用 44px 操作系统标题栏、紧密标题栏 chrome 边界、确认后的菜单扩展、完整 Harness 边界和 Chat 单一标题栏 inset 替换 98px／58px 本地标题区说明。只重新记录发生变化的双语配对。

- [x] **步骤 2：运行聚焦源码验证。**

```text
pnpm exec vitest run apps/desktop/tests/*.spec.ts
pnpm --filter @deepseek-ai/dsh-desktop run typecheck
pnpm exec oxlint apps/desktop/src apps/desktop/tests
```

预期：所有桌面测试和两个桌面 TypeScript 程序通过；Oxlint 不报告错误。

- [x] **步骤 3：运行文档验证。**

```text
pnpm run verify-translation-pairing apps/desktop/README.md .agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md docs/superpowers/plans/2026-08-16-desktop-titlebar-mode-switcher.md
pnpm run verify-md-wrap
pnpm run verify-md-links
pnpm run verify-agent-note-format
```

预期：指定配对和 Markdown 检查通过。报告由缺少 `.git` 目录或无关既有配对导致的全量语料库失败，不得修改它们。

- [x] **步骤 4：构建打包使用的产品路径。**

```text
pnpm exec tsc -p packages/client/ui-theme/tsconfig.json
pnpm exec tsdown --env.DSH_BUILD_FACE client
pnpm run build:web
pnpm run build:desktop
```

预期：每条命令都以 0 退出。已知的聚合客户端测试 React 类型分裂不属于本次修改。

- [x] **步骤 5：重新构建 macOS arm64 与 Windows x64 便携 ZIP。** 每个平台都在调用 Electron Builder 前立即暂存对应运行时，只替换两个指定 ZIP，并保留解包目录供检查。

```text
node --import tsx apps/desktop/scripts/stage-runtime.ts --os=darwin --cpu=arm64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --mac dir --arm64 --config.mac.identity=null --config.mac.notarize=false
ditto -c -k --sequesterRsrc --keepParent apps/desktop/dist/mac-arm64 apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip

node --import tsx apps/desktop/scripts/stage-runtime.ts --os=win32 --cpu=x64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --win dir --x64 --config.electronDist=/Users/zo/Library/Caches/electron/63857c95525ff62c967a319a9c3921773c3420b77c6ebce7f47c8c76e68d9e11/electron-v43.4.0-win32-x64.zip
zip -qr dist/DeepSeek-Harness-Windows-x64.zip dist/win-unpacked
```

- [x] **步骤 6：验证最终产物证据。** 对两个可执行文件运行 `file`，对两个 ZIP 运行 `unzip -tq`，在两个解包应用内定位全部 4 个 preload，并记录字节大小与 SHA-256 hash。

## 自审

- 规格覆盖：任务 1–3 覆盖标题栏位置、不存在第二条横栏、内容未被遮挡、稳定样式、确认后的点击、键盘行为、主题和真实截图；任务 4 覆盖当前文档与两个所需产物。
- 占位符扫描：计划没有延后实现或未命名错误处理；每项生产代码修改之前都有具名失败测试和精确验证命令。
- 类型一致性：`DesktopChromeSurface`、`DesktopChromeLayout.surface`、`DESKTOP_TITLEBAR_HEIGHT`、`desktopChromeBounds` 和两个便携 ZIP 名称在各任务中保持一致。
