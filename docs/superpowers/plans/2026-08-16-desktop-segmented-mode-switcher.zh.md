# 桌面分段模式切换器实现计划

[English](2026-08-16-desktop-segmented-mode-switcher.md) | 中文

> **面向智能体执行者：** 必须使用 `executing-plans` 子技能，在当前主线智能体会话中逐项实现本计划。

**目标：** 用可直接点击的 `Chat | Harness` 分段切换器替换标题栏下拉控件，消除原生拖拽拦截与 Chat 标题栏色带，并保留全新安装默认 Harness、后续恢复上次模式的行为。

**架构：** 现有本地 mode-chrome WebContentsView 继续作为唯一共享控件所有者，但其关闭边界改为稳定的双分段切换器，并移除 `mode-menu` 状态。纯几何辅助函数负责不重叠的标题栏拖拽起点；本地 shell 只绘制已有的 44px 操作系统标题栏底色，并接收与 mode chrome 相同的解析后配色。

**技术栈：** Electron 43 `BrowserWindow` 与 `WebContentsView`、TypeScript 6、本地 HTML/CSS preload、Vitest、Playwright Electron、Sharp 截图合成、Electron Builder。

## 全局约束

- 切换器固定为 164px × 32px，macOS 从 `{ x: 88, y: 6 }` 开始，Windows 从 `{ x: 12, y: 6 }` 开始；左侧始终是 `Chat`，右侧始终是 `Harness`。
- shell 拖拽区域在 macOS 从 x=300 开始，在 Windows 从 x=224 开始，并且绝不与最大的关闭状态 chrome 边界重叠。
- Chat 只保留现有 44px 操作系统标题栏 inset；Harness 继续使用完整内容边界。
- 模式切换器没有下拉菜单、箭头、产品图标、外框或应用自有全宽工具栏。
- 缺失桌面状态文件时选择 Harness；后续有效选择继续通过现有状态文件持久化并恢复。
- 主题偏好继续双向同步；Chat 标题栏底色必须在两个解析后配色中都与 fixture 页面一致。
- 不修改 `vendor/`、不增加依赖、不向 Chat main world 暴露 Electron API，也不使用子任务。
- 当前工作区没有 `.git` 目录，因此每项任务以明确的测试检查点结束，替代无法执行的提交步骤。

---

### 任务 1：收紧 chrome 协议与标题栏几何

**文件：**
- 修改：`apps/desktop/tests/desktop-chrome-layout.spec.ts`
- 修改：`apps/desktop/tests/shell-protocol.spec.ts`
- 修改：`apps/desktop/src/desktop-chrome-layout.ts`
- 修改：`apps/desktop/src/shell-protocol.ts`

**接口：**
- 产出：`desktopTitlebarDragStart(platform: NodeJS.Platform): number`。
- 产出：`DesktopChromeSurface = 'closed' | 'chat-menu' | 'dialog'`。
- Harness 的关闭状态 chrome 宽 164px，Chat 宽 200px；Chat 菜单 chrome 保持至少 200px 宽。

- [ ] **步骤 1：编写失败的几何与协议测试。** 用固定分段边界和拖拽不变量替换旧下拉控件期望。

```ts
import { expect } from 'vitest'

type Platform = 'darwin' | 'win32'
interface Bounds { x: number; y: number; width: number; height: number }
declare function desktopChromeBounds(input: {
  platform: Platform; mode: 'chat' | 'harness'; surface: 'closed'; content: Bounds
}): Bounds
declare function desktopTitlebarDragStart(platform: Platform): number
declare function isDesktopChromeSurface(value: unknown): boolean

const content = { x: 0, y: 0, width: 1200, height: 800 }

expect(desktopChromeBounds({
  platform: 'darwin', mode: 'harness', surface: 'closed', content,
})).toEqual({ x: 88, y: 6, width: 164, height: 32 })
expect(desktopChromeBounds({
  platform: 'darwin', mode: 'chat', surface: 'closed', content,
})).toEqual({ x: 88, y: 6, width: 200, height: 32 })
for (const platform of ['darwin', 'win32'] as const) {
  const chrome = desktopChromeBounds({ platform, mode: 'chat', surface: 'closed', content })
  expect(chrome.x + chrome.width).toBeLessThanOrEqual(desktopTitlebarDragStart(platform))
}
expect(isDesktopChromeSurface('mode-menu')).toBe(false)
```

- [ ] **步骤 2：运行聚焦测试并确认 RED。**

运行：`pnpm exec vitest run apps/desktop/tests/desktop-chrome-layout.spec.ts apps/desktop/tests/shell-protocol.spec.ts`

预期：旧的 88/176px 边界与仍接受 `mode-menu` 导致失败。

- [ ] **步骤 3：实现最小几何与协议。** 使用 `CHROME_TOP = 6`、`CHROME_SWITCH_WIDTH = 164`、`CHROME_CONTROL_HEIGHT = 32`，保留现有 4px/32px Chat 操作尺寸。删除两项模式菜单尺寸，并让 `desktopTitlebarDragStart()` 返回 300 或 224。

```ts
export type DesktopChromeSurface = 'closed' | 'chat-menu' | 'dialog'

export function desktopTitlebarDragStart(platform: NodeJS.Platform): number {
  return platform === 'darwin' ? 300 : 224
}
```

- [ ] **步骤 4：运行聚焦测试并确认 GREEN。**

运行：`pnpm exec vitest run apps/desktop/tests/desktop-chrome-layout.spec.ts apps/desktop/tests/shell-protocol.spec.ts`

预期：全部通过，并且所有关闭状态 chrome 都在平台拖拽起点之前结束。

### 任务 2：把解析后配色传播到 shell 标题栏底色

**文件：**
- 修改：`apps/desktop/tests/main-composition.spec.ts`
- 修改：`apps/desktop/src/desktop-application.ts`
- 修改：`apps/desktop/src/shell-preload.ts`
- 修改：`apps/desktop/resources/shell.html`
- 修改：`apps/desktop/resources/shell.css`

**接口：**
- 消费：`desktopTitlebarDragStart()` 与 `DESKTOP_SHELL_CHANNELS.chromeTheme`。
- 产出：shell 根节点属性 `data-mode`、`data-platform`、`data-theme` 与 CSS 变量 `--shell-drag-start`。
- 确定性 fixture 中，Chat 亮色标题栏底色为 `#f5f7f8`，暗色为 `#121416`。

- [ ] **步骤 1：编写失败的合成断言。** 要求每次解析后配色发布同时到达 shell WebContents 与 mode chrome，包括系统变化和模式选择变化。

```ts
import { expect, vi } from 'vitest'

const DESKTOP_SHELL_CHANNELS = { chromeTheme: 'dsh-desktop:chrome-theme' } as const
const shell = { contents: { send: vi.fn() } }
const chrome = { contents: { send: vi.fn() } }

expect(shell.contents.send).toHaveBeenCalledWith(
  DESKTOP_SHELL_CHANNELS.chromeTheme,
  'dark',
)
expect(chrome.contents.send).toHaveBeenCalledWith(
  DESKTOP_SHELL_CHANNELS.chromeTheme,
  'dark',
)
```

- [ ] **步骤 2：运行合成测试并确认 RED。**

运行：`pnpm exec vitest run apps/desktop/tests/main-composition.spec.ts`

预期：`sendChromeTheme()` 当前只发送给 mode chrome，因此失败。

- [ ] **步骤 3：实现 shell 主题传递和不重叠拖拽区域。** 把配色发送给两个可信本地 renderer。在拖拽区域前加入 `#titlebar-backdrop`，从 `desktopTitlebarDragStart(process.platform)` 设置拖拽区域的 `left`，并根据经过验证的 IPC 更新根节点主题。

```ts
interface IpcRenderer {
  on(channel: string, listener: (event: unknown, value: unknown) => void): void
}
declare const ipcRenderer: IpcRenderer
declare function desktopTitlebarDragStart(platform: NodeJS.Platform): number
declare function isDesktopColorScheme(value: unknown): value is 'light' | 'dark'
const DESKTOP_SHELL_CHANNELS = { chromeTheme: 'dsh-desktop:chrome-theme' } as const

document.documentElement.style.setProperty(
  '--shell-drag-start',
  `${desktopTitlebarDragStart(process.platform)}px`,
)
ipcRenderer.on(DESKTOP_SHELL_CHANNELS.chromeTheme, (_event, value: unknown) => {
  if (isDesktopColorScheme(value)) document.documentElement.dataset.theme = value
})
```

```css
#titlebar-backdrop {
  position: fixed;
  inset: 0 0 auto;
  height: 44px;
  background: var(--shell-titlebar-background);
  pointer-events: none;
}

#window-drag-region {
  left: var(--shell-drag-start);
  right: 0;
}
```

- [ ] **步骤 4：运行合成测试并确认 GREEN。**

运行：`pnpm exec vitest run apps/desktop/tests/main-composition.spec.ts`

预期：全部通过，两个本地 renderer 都收到每次解析后配色。

### 任务 3：用直接分段切换器替换下拉控件

**文件：**
- 修改：`apps/desktop/tests/dual-mode.electron.spec.ts`
- 修改：`apps/desktop/resources/mode-chrome.html`
- 修改：`apps/desktop/resources/mode-chrome.css`
- 修改：`apps/desktop/src/mode-chrome-preload.ts`

**接口：**
- 消费：关闭的 `select` IPC 通道和三状态 chrome surface 协议。
- 产出：`#mode-switch[role="radiogroup"]`，包含 `[data-mode="chat"]` 与 `[data-mode="harness"]` 单选按钮。
- Chat 操作继续使用需要确认的 `chat-menu`/`dialog` 展开流程。

- [ ] **步骤 1：编写失败的 Electron 断言。** 等待 `#mode-switch`，要求存在两个 radio 且不存在模式菜单或箭头，直接点击两个 radio，测试方向键／Home／End，并检查稳定的 164/200px 原生宽度。

```ts ignore-check
await chrome.locator('#mode-switch').waitFor()
expect(await chrome.locator('#mode-menu').count()).toBe(0)
expect(await chrome.locator('.chevron').count()).toBe(0)
await chrome.locator('[data-mode="chat"]').click()
await expect.poll(async () => (await fixtureState(application)).snapshot?.selected).toBe('chat')
await chrome.locator('[data-mode="harness"]').click()
await expect.poll(async () => (await fixtureState(application)).snapshot?.selected).toBe('harness')
```

- [ ] **步骤 2：构建并运行 Electron 场景以确认 RED。**

运行：`pnpm --filter @deepseek-ai/dsh-desktop run build && pnpm exec vitest run apps/desktop/tests/dual-mode.electron.spec.ts`

预期：当前 DOM 仍暴露 `#mode-selector`、`.chevron` 和 `#mode-menu`，因此失败。

- [ ] **步骤 3：实现语义化切换器。** 用两个 radio 按钮和一个不可交互高亮替换选择器／菜单。点击会立即发送 `DESKTOP_SHELL_CHANNELS.select`。方向键、Home 与 End 移动焦点并选择；snapshot 更新 `aria-checked`、`tabIndex`、根节点模式与 Chat 操作可见性。

```html
<div id="mode-switch" role="radiogroup" aria-label="Desktop mode">
  <span id="mode-highlight" aria-hidden="true"></span>
  <button type="button" role="radio" data-mode="chat" aria-checked="false">Chat</button>
  <button type="button" role="radio" data-mode="harness" aria-checked="true">Harness</button>
</div>
```

- [ ] **步骤 4：设置一个稳定的标题栏控件样式。** 使用 164px × 32px 双列网格、不超过 8px 的圆角、主题前景色、无描边轨道和可平移 82px 的高亮。只有实际控件保持 `pointer-events: auto` 与 `-webkit-app-region: no-drag`；透明根节点仍不可交互。

- [ ] **步骤 5：运行 Electron 场景并确认 GREEN。**

运行：`DSH_DESKTOP_SCREENSHOT_DIR=apps/desktop/output/playwright/desktop-segmented-mode pnpm exec vitest run apps/desktop/tests/dual-mode.electron.spec.ts`

预期：直接切换、无下拉残留、Chat 侧栏控件不受遮挡以及亮暗截图全部通过。

### 任务 4：证明全新安装默认、恢复与真实原生命中测试

**文件：**
- 修改：`apps/desktop/tests/dual-mode.electron.spec.ts`
- 修改：`apps/desktop/tests/fixtures/dual-mode-app/main.mjs`
- 修改：`design-qa.md`

**接口：**
- fixture user-data 目录在受控重启之间持有 `desktop-state.json`。
- fixture 状态暴露 shell、chrome、Chat、Harness 原生边界与现有 Chat 侧栏点击次数。

- [ ] **步骤 1：增加失败的重启场景。** 使用空临时 user-data 目录启动并断言 Harness，直接选择 Chat，关闭后使用同一目录重启，在删除目录前断言恢复 Chat。

- [ ] **步骤 2：运行 Electron 场景，确认新测试实际覆盖持久化。**

运行：`pnpm exec vitest run apps/desktop/tests/dual-mode.electron.spec.ts`

预期：调整 fixture 生命周期后，现有状态行为通过；如果仍使用下拉辅助函数或重启前删除 user data，测试必须先失败。

- [ ] **步骤 3：增加表面证据。** 断言 shell 拖拽起点不小于关闭状态 chrome 终点，在亮暗模式下比较 Chat body 与标题栏底色的计算值，并保留真实 Chat 侧栏点击断言。

- [ ] **步骤 4：运行打包后的 macOS 应用并进行一次原生指针冒烟。** 使用明确的临时 user-data 目录，通过 macOS 屏幕坐标点击 Chat 与 Harness 分段，确认选中侧每次都移动，并把截图与观察结果记录进 `design-qa.md`。该步骤用操作系统标题栏命中测试补充 Playwright 定向到 renderer 的输入。

### 任务 5：同步当前文档并验证桌面构建

**文件：**
- 修改：`apps/desktop/README.md`
- 修改：`apps/desktop/README.zh.md`
- 修改：`apps/desktop/README.i18n.yaml`
- 修改：`.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md`
- 修改：`.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.zh.md`
- 修改：`.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.i18n.yaml`
- 验证：`docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md`

**接口：**
- README 负责当前桌面行为；implemented Agent Note 负责保留视图与本地 chrome 的设计理由。
- 因仓库 Git 元数据缺失，双语对必须保持匹配结构并手动记录 `git hash-object` 值。

- [ ] **步骤 1：替换两种语言中的当前下拉控件描述。** 记录直接 `Chat | Harness` 选择、标题栏底色、不重叠拖拽几何，以及全新安装默认 Harness、后续恢复。

- [ ] **步骤 2：只重新记录并验证变更的双语对。**

运行：`pnpm run verify-translation-pairing apps/desktop/README.md .agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md docs/superpowers/plans/2026-08-16-desktop-segmented-mode-switcher.md`

预期：四个指定文档对保持一致。

- [ ] **步骤 3：运行聚焦源码验证。**

```text
pnpm exec vitest run apps/desktop/tests/*.spec.ts
pnpm --filter @deepseek-ai/dsh-desktop run typecheck
pnpm exec oxlint apps/desktop/src apps/desktop/tests
pnpm --filter @deepseek-ai/dsh-desktop run build
```

预期：全部命令以 0 退出，并且本次修改没有引入警告。

### 任务 6：重建并检查两个便携产物

**文件：**
- 替换：`apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip`
- 替换：`apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip`

**接口：**
- 便携产物名称和目标架构保持不变。
- 两个产物都包含 shell 资源和四个 CommonJS sandbox preload。

- [ ] **步骤 1：构建桌面打包使用的产品路径。**

```text
pnpm exec tsc -p packages/client/ui-theme/tsconfig.json
pnpm exec tsdown --env.DSH_BUILD_FACE client
pnpm run build:web
pnpm run build:desktop
```

- [ ] **步骤 2：依次暂存并打包 macOS arm64 与 Windows x64。**

```text
node --import tsx apps/desktop/scripts/stage-runtime.ts --os=darwin --cpu=arm64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --mac dir --arm64 --config.mac.identity=null --config.mac.notarize=false
ditto -c -k --sequesterRsrc --keepParent apps/desktop/dist/mac-arm64 apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip

node --import tsx apps/desktop/scripts/stage-runtime.ts --os=win32 --cpu=x64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --win dir --x64 --config.electronDist=/Users/zo/Library/Caches/electron/63857c95525ff62c967a319a9c3921773c3420b77c6ebce7f47c8c76e68d9e11/electron-v43.4.0-win32-x64.zip
zip -qr dist/DeepSeek-Harness-Windows-x64.zip dist/win-unpacked
```

- [ ] **步骤 3：验证发布证据。** 对两个 ZIP 运行 `unzip -tq`，对两个解包可执行文件运行 `file`，在每个应用中定位四个 preload 与更新后的 shell 资源，并记录字节数和 SHA-256。

## 自检

- 规格覆盖：任务 1-4 覆盖直接分段交互、原生命中测试、不增加工具栏、匹配 Chat 标题栏主题、全新安装 Harness、恢复、键盘使用与不受遮挡的产品控件；任务 5-6 覆盖仓库约束与两个所需产物。
- 占位扫描：每个变更步骤都指定准确文件、接口、命令与预期结果；不存在延期实现或未命名错误处理。
- 类型一致性：`desktopTitlebarDragStart`、三成员 `DesktopChromeSurface`、`DESKTOP_TITLEBAR_HEIGHT`、两个分段模式值与便携 ZIP 名称在全部任务中保持一致。
