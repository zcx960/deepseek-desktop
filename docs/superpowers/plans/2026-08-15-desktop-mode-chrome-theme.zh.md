# 桌面模式 chrome 主题集成实施计划

[English](2026-08-15-desktop-mode-chrome-theme.md) | 中文

> **供 agentic worker 使用：**必须使用 superpowers:executing-plans，逐项执行本计划。步骤使用复选框（`- [ ]`）跟踪。只在当前会话内沿主线执行，不派发 subagent。

**目标：**让侧栏模式选择器透明合成到活动页面上，并在亮色内容上渲染深色控件、在暗色内容上渲染浅色控件。

**架构：**把本地 mode-chrome WebContentsView 的原生背景设为透明，并保持其文档透明。Harness 配色从现有 `meta[name="theme-color"]` 事件解析，Chat 配色从操作系统解析，再通过一个经过校验的亮暗值发送到本地 preload。DeepSeek 模板位图使用 CSS mask 渲染，使标记与标签和箭头使用相同前景色。

**技术栈：**Electron 43 `WebContentsView`、`nativeTheme`、封闭的 main/preload IPC、静态 HTML/CSS、TypeScript、Vitest、Playwright Electron 测试和 Electron Builder。

## 全局约束

- 关闭状态的选择器没有持久衬底填充；其后方每个可见像素都由活动内容视图提供。
- 亮色主题为标记、标签、箭头、溢出控件和焦点指示器使用深色前景，暗色主题使用浅色前景。
- Harness 通过现有主题色元数据跟随其解析后的产品主题；Chat 跟随操作系统配色，因为 Desktop 不得读取其 DOM、存储、样式或像素。
- Harness 主题色缺失或无效时回退到操作系统配色，直到收到有效颜色。
- 不允许增加远程 preload、DOM 注入、截图采样、私有 Chat API 或新的运行时依赖。
- 菜单和对话框继续使用不透明主题表面；悬停与焦点反馈保持瞬时。
- 必须在相关测试、类型检查、构建、lint、文档检查和 Electron 视觉验证通过后，重新构建 macOS arm64 与 Windows x64 ZIP 产物。
- 当前 checkout 没有 `.git` 目录，因此使用验证检查点代替提交步骤。

---

### 任务 1：定义确定性的桌面主题解析

**文件：**
- 新建：`apps/desktop/src/desktop-theme.ts`
- 新建：`apps/desktop/tests/desktop-theme.spec.ts`
- 修改：`apps/desktop/src/shell-protocol.ts`
- 修改：`apps/desktop/tests/shell-protocol.spec.ts`

**接口：**
- 产出：`DesktopColorScheme = 'light' | 'dark'`。
- 产出：`schemeForThemeColor(color: string | null): DesktopColorScheme | undefined`。
- 产出：带有 `getColorScheme()` 与 `subscribe(listener)` 的 `DesktopSystemTheme`。
- 产出：`DESKTOP_SHELL_CHANNELS.chromeTheme = 'dsh-desktop:chrome-theme'`。

- [ ] **步骤 1：为解析、对比度和新通道编写失败的单元测试。**

```text
import { expect } from 'vitest'

declare function schemeForThemeColor(color: string | null): 'light' | 'dark' | undefined
declare const DESKTOP_SHELL_CHANNELS: { readonly chromeTheme: string }

expect(schemeForThemeColor('#ffffff')).toBe('light')
expect(schemeForThemeColor('#f5f7f8')).toBe('light')
expect(schemeForThemeColor('#121416')).toBe('dark')
expect(schemeForThemeColor('#000000')).toBe('dark')
expect(schemeForThemeColor(null)).toBeUndefined()
expect(schemeForThemeColor('rgb(255, 255, 255)')).toBeUndefined()
expect(DESKTOP_SHELL_CHANNELS.chromeTheme).toBe('dsh-desktop:chrome-theme')
```

- [ ] **步骤 2：运行相关测试，确认缺失模块与通道导致失败。**

运行：`pnpm exec vitest run apps/desktop/tests/desktop-theme.spec.ts apps/desktop/tests/shell-protocol.spec.ts`

预期：失败，因为 `desktop-theme.ts` 与 `chromeTheme` 尚不存在。

- [ ] **步骤 3：实现精确的主题类型与 WCAG 对比度选择。**

```text
export type DesktopColorScheme = 'light' | 'dark'

export interface DesktopSystemTheme {
  getColorScheme(): DesktopColorScheme
  subscribe(listener: () => void): () => void
}

export function isDesktopColorScheme(value: unknown): value is DesktopColorScheme {
  return value === 'light' || value === 'dark'
}

export function schemeForThemeColor(color: string | null): DesktopColorScheme | undefined {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color ?? '')
  if (match === null) return undefined
  const channels = match.slice(1).map((channel) => {
    const value = Number.parseInt(channel, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
  return luminance >= 0.179 ? 'light' : 'dark'
}
```

- [ ] **步骤 4：把封闭主题通道加入 `DESKTOP_SHELL_CHANNELS`。**

```text
export const DESKTOP_SHELL_CHANNELS = {
  select: 'dsh-desktop:select-mode',
  command: 'dsh-desktop:shell-command',
  snapshot: 'dsh-desktop:mode-snapshot',
  chromeSurface: 'dsh-desktop:chrome-surface',
  chromeLayout: 'dsh-desktop:chrome-layout',
  chromeTheme: 'dsh-desktop:chrome-theme',
} as const
```

- [ ] **步骤 5：运行相关测试。**

运行：`pnpm exec vitest run apps/desktop/tests/desktop-theme.spec.ts apps/desktop/tests/shell-protocol.spec.ts`

预期：通过。

### 任务 2：连接原生透明背景与实时主题来源

**文件：**
- 修改：`apps/desktop/src/harness-surface.ts`
- 修改：`apps/desktop/src/desktop-application.ts`
- 修改：`apps/desktop/src/main.ts`
- 修改：`apps/desktop/tests/harness-surface.spec.ts`
- 修改：`apps/desktop/tests/main-composition.spec.ts`

**接口：**
- `HarnessSurfaceOptions` 与 `DesktopHarnessSurfaceFactoryOptions` 消费 `onThemeColor(color: string | null): void`。
- `DesktopApplicationOptions` 消费 `systemTheme: DesktopSystemTheme`。
- 应用在 chrome 加载后、选中模式变化后、Harness 主题变化后与操作系统主题变化后，通过 `DESKTOP_SHELL_CHANNELS.chromeTheme` 发送一个 `DesktopColorScheme`。

- [ ] **步骤 1：扩展 fake 并编写失败的生命周期断言。**为 fake chrome 视图增加 `setBackgroundColor`，从 Harness fake 发出 `did-change-theme-color`，并提供可触发监听器的系统主题 fake。

```text
expect(chrome.value.setBackgroundColor).toHaveBeenCalledWith('#00000000')
contents.emit('did-change-theme-color', {}, '#f5f7f8')
expect(onThemeColor).toHaveBeenCalledWith('#f5f7f8')
expect(chrome.contents.send).toHaveBeenCalledWith(DESKTOP_SHELL_CHANNELS.chromeTheme, 'light')
```

- [ ] **步骤 2：运行相关测试，确认接线前会失败。**

运行：`pnpm exec vitest run apps/desktop/tests/harness-surface.spec.ts apps/desktop/tests/main-composition.spec.ts`

预期：因缺失回调、系统主题选项、原生透明背景和主题 IPC 而失败。

- [ ] **步骤 3：转发 Harness 主题色事件并释放监听器。**

```text
const onThemeColor = (_event: Event, color: string | null): void => {
  options.onThemeColor(color)
}
contents.on('did-change-theme-color', onThemeColor)
listenerDisposers.push(() => { contents.off('did-change-theme-color', onThemeColor) })
```

- [ ] **步骤 4：在桌面应用中维护选中主题状态。**保留 `systemScheme` 与 `harnessScheme`，仅在 Harness 没有有效颜色时回退到系统，并且只发送到本地 chrome 视图。

```text
let systemScheme = options.systemTheme.getColorScheme()
let harnessScheme: DesktopColorScheme | undefined

const selectedScheme = (): DesktopColorScheme =>
  selectedMode === 'harness' ? harnessScheme ?? systemScheme : systemScheme

const sendChromeTheme = (): void => {
  if (!chromeLoaded || chromeView === undefined || chromeView.webContents.isDestroyed()) return
  chromeView.webContents.send(DESKTOP_SHELL_CHANNELS.chromeTheme, selectedScheme())
}

const onHarnessThemeColor = (color: string | null): void => {
  harnessScheme = schemeForThemeColor(color)
  if (selectedMode === 'harness') sendChromeTheme()
}
```

- [ ] **步骤 5：在加载前使原生 chrome 透明，并在窗口生命周期内订阅系统变化。**

```text
chromeView = options.createView({ webPreferences: chromeWebPreferences })
chromeView.setBackgroundColor('#00000000')
const stopSystemTheme = options.systemTheme.subscribe(() => {
  systemScheme = options.systemTheme.getColorScheme()
  sendChromeTheme()
})
windowListenerDisposers.push(stopSystemTheme)
```

- [ ] **步骤 6：在生产环境中适配 Electron `nativeTheme`。**

```text
interface DesktopSystemTheme {
  getColorScheme(): 'light' | 'dark'
  subscribe(listener: () => void): () => void
}

declare const nativeTheme: {
  readonly shouldUseDarkColors: boolean
  on(event: 'updated', listener: () => void): void
  off(event: 'updated', listener: () => void): void
}

const systemTheme = {
  getColorScheme: () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
  subscribe: (listener) => {
    nativeTheme.on('updated', listener)
    return () => { nativeTheme.off('updated', listener) }
  },
} satisfies DesktopSystemTheme

void systemTheme
```

- [ ] **步骤 7：运行相关生命周期测试。**

运行：`pnpm exec vitest run apps/desktop/tests/harness-surface.spec.ts apps/desktop/tests/main-composition.spec.ts`

预期：全部通过，包括监听器释放、无效颜色回退、选中模式主题恢复和原生透明合成。

### 任务 3：渲染主题感知控件并在 Electron 中验证

**文件：**
- 修改：`apps/desktop/resources/mode-chrome.html`
- 修改：`apps/desktop/resources/mode-chrome.css`
- 修改：`apps/desktop/src/mode-chrome-preload.ts`
- 修改：`apps/desktop/tests/fixtures/dual-mode-app/main.mjs`
- 修改：`apps/desktop/tests/dual-mode.electron.spec.ts`

**接口：**
- preload 校验 `DesktopColorScheme` 值，并且只写入 `document.documentElement.dataset.theme`。
- `.mode-mark` 把 `trayTemplate.png` 作为 mask 使用，并使用 `currentColor`。
- fixture 提供确定性的 Harness 与操作系统主题切换，不访问 DeepSeek Chat。

- [ ] **步骤 1：为亮色 Harness、暗色 Harness 与系统主题 Chat 增加失败的 Electron 断言。**

```text
await setFixtureTheme(application, 'harness', 'light')
await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
await setFixtureTheme(application, 'harness', 'dark')
await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
await selectMode(chrome, 'chat')
await setFixtureTheme(application, 'system', 'dark')
await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
```

- [ ] **步骤 2：运行 Electron 测试，确认 fixture API 与主题渲染尚不存在。**

运行：`pnpm --filter @deepseek-ai/dsh-desktop run build && pnpm --filter @deepseek-ai/dsh-desktop run test:electron`

预期：失败，因为 fixture 无法切换主题，chrome preload 也未消费 `chromeTheme`。

- [ ] **步骤 3：把直接渲染的黑色位图替换为 mask 元素。**

```html
<span class="mode-mark" aria-hidden="true"></span>
```

```css
.mode-mark {
  flex: none;
  width: 18px;
  height: 18px;
  background: currentColor;
  -webkit-mask: url("trayTemplate.png") center / contain no-repeat;
  mask: url("trayTemplate.png") center / contain no-repeat;
}
```

- [ ] **步骤 4：把暗色变量从无条件媒体查询移入显式主题选择器，仅在 IPC 到达前使用媒体查询回退。**保持 `html`、`body` 与 `#mode-chrome-root` 透明，并保持关闭状态选择器背景透明。

```css
:root[data-theme='light'] { color-scheme: light; }

:root[data-theme='dark'] {
  color-scheme: dark;
  --chrome-surface: rgba(45, 49, 53, 0.94);
  --chrome-raised: #34383c;
  --chrome-border: rgba(255, 255, 255, 0.13);
  --chrome-text: #f1f3f4;
  --chrome-muted: #aeb4ba;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { color-scheme: dark; }
}
```

- [ ] **步骤 5：在本地 preload 中校验并应用主题 IPC。**

```text
ipcRenderer.on(DESKTOP_SHELL_CHANNELS.chromeTheme, (_event, value: unknown) => {
  if (!isDesktopColorScheme(value)) return
  document.documentElement.dataset.theme = value
})
```

- [ ] **步骤 6：扩展本地 fixture。**给 Harness 页面加入可变的 `meta[name="theme-color"]`，通过 `options.onThemeColor` 转发其 Electron 事件，并为 `harness` 与 `system` 暴露 `setTheme(target, scheme)`；关闭期间恢复 `nativeTheme.themeSource = 'system'`。

- [ ] **步骤 7：更新图标 locator 并运行真实 Electron 场景。**

运行：`pnpm --filter @deepseek-ai/dsh-desktop run build && pnpm --filter @deepseek-ai/dsh-desktop run test:electron`

预期：`.mode-mark` 可见，亮暗 data 属性切换、保留模式状态、菜单行为和 Chat 分区清除均通过。

- [ ] **步骤 8：捕获并检查真实窗口截图。**通过 Playwright 捕获展开的 Harness 亮色、展开的 Harness 暗色、Chat 暗色和收起的亮色状态；确认标题区像素与下方 fixture 页面一致、标记与标签持续可见，而且控件不与交通灯或侧栏内容重叠。

### 任务 4：更新记录、运行门禁并重新构建双平台产物

**文件：**
- 修改：`apps/desktop/README.md`
- 修改：`apps/desktop/README.zh.md`
- 修改：`apps/desktop/README.i18n.yaml`
- 修改：`.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md`
- 修改：`.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.zh.md`
- 修改：`.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.i18n.yaml`
- 验证：`docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md`
- 产出：`apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip`
- 产出：`apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip`

**接口：**
- Desktop README 说明用户可见的主题行为和 Chat 回退，但不承诺检测页面私有主题。
- 现有 Agent Note 继续作为桌面模式组合、透明 chrome、DOM 隔离和确定性验证的唯一所有者。
- 两个 ZIP 名称保持不变，供用户测试。

- [ ] **步骤 1：更新双语 README 与 Agent Note。**记录原生透明合成、Harness `theme-color` 观察、Chat 系统回退、CSS mask 着色，以及不检查 Chat DOM／样式／像素的负向保证。使用精确的新 blob hash 重新记录各伴随文件。

- [ ] **步骤 2：运行相关单元、组合与 Electron 测试。**

运行：`pnpm exec vitest run apps/desktop/tests`

预期：每个桌面测试文件均通过。

- [ ] **步骤 3：运行桌面类型检查、构建与 Oxlint。**

运行：`pnpm --filter @deepseek-ai/dsh-desktop run typecheck`

运行：`pnpm --filter @deepseek-ai/dsh-desktop run build`

运行：`pnpm exec tsx scripts/run-oxlint.ts apps/desktop/src apps/desktop/tests apps/desktop/tests/fixtures/dual-mode-app/main.mjs`

预期：三个命令均以 0 退出。

- [ ] **步骤 4：运行限定范围的文档检查，再尝试仓库文档门禁。**

运行：`pnpm run verify-translation-pairing apps/desktop/README.md .agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md docs/superpowers/plans/2026-08-15-desktop-mode-chrome-theme.md`

运行：`pnpm run verify-md-wrap`

运行：`pnpm run verify-md-links`

运行：`pnpm run verify-agent-note-format`

运行：`pnpm run doc-sync`

预期：限定范围的检查通过。如果 `doc-sync` 需要缺失的 Git 元数据，则如实报告环境失败，不削弱任何文档规则。

- [ ] **步骤 5：暂存并打包 macOS arm64。**

```sh
node --import tsx apps/desktop/scripts/stage-runtime.ts --os=darwin --cpu=arm64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --mac dir --arm64 --config.mac.identity=null --config.mac.notarize=false
ditto -c -k --sequesterRsrc --keepParent apps/desktop/dist/mac-arm64 apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip
```

- [ ] **步骤 6：启动打包后的 macOS 应用并验证启动。**使用隔离的 user-data 目录，等待 Harness 与模式选择器出现，捕获一张打包后截图，再干净退出。使用 `file` 确认可执行文件。

- [ ] **步骤 7：暂存并打包 Windows x64。**

```sh
node --import tsx apps/desktop/scripts/stage-runtime.ts --os=win32 --cpu=x64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --win dir --x64
(cd apps/desktop && zip -qr -FS dist/DeepSeek-Harness-Windows-x64.zip dist/win-unpacked)
```

- [ ] **步骤 8：验证两个产物。**

```sh
file "apps/desktop/dist/mac-arm64/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"
file "apps/desktop/dist/win-unpacked/DeepSeek Harness.exe"
unzip -tq apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip
unzip -tq apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip
```

预期：分别识别为 Mach-O arm64 与 PE32+ x86-64，两个 ZIP 检查均不报告错误。

## 自审清单

- 设计覆盖：原生透明、Harness 实际主题、Chat 系统回退、无效颜色回退、随当前颜色渲染图标、不透明菜单、视觉验证和两个产物都映射到具体任务。
- 占位符扫描：没有延期实现标记或未指定的测试说明。
- 类型一致性：`DesktopColorScheme`、`DesktopSystemTheme`、`schemeForThemeColor`、`onThemeColor` 与 `chromeTheme` 在全文使用同一拼写与方向。
- 安全一致性：没有任务读取或修改 DeepSeek Chat DOM、存储、样式、网络流量或像素。
- 执行方式：用户此前要求只由主线执行，因此选择 inline execution；排除 subagent。
