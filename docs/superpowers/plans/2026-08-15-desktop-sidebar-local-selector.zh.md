# 桌面侧栏局部模式选择器实施计划

[English](2026-08-15-desktop-sidebar-local-selector.md) | 中文

> **供智能体执行者使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务实施本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 用左上侧栏内的紧凑切换按钮替代横向模式行，同时让 Chat 与 Harness 内容占满窗口高度。

**架构：** 保留位于内容视图上方的可信 mode-chrome WebContentsView，但分离内容边界与 chrome 边界。内容使用完整窗口矩形；关闭状态 chrome 只拥有侧栏标题区，仅在菜单或确认对话框打开时扩展。Harness 复用全高桌面侧栏标题区，Chat 接受本地主题衬底覆盖其左上角矩形，不访问 DOM。

**技术栈：** TypeScript 6、Electron 43 `WebContentsView`、HTML/CSS、Vitest 4、Playwright Electron、Sharp、Electron Builder。

## 全局约束

- 在主会话内联执行，不分派子智能体。
- 不向 DeepSeek Chat 官方 DOM 注入脚本，也不读取或重排 DOM。
- 关闭状态选择器 chrome 留在侧栏宽度内；任何原生视图或可见填充都不能横跨对话列。
- macOS、Windows 与 Linux 上的 Chat 与 Harness 内容边界都使用 `x: 0`、`y: 0` 以及完整内容宽高。
- 展开状态选择器是侧栏标题区前部随内容收缩的按钮；收起状态保持固定图标命中区域。
- 保留键盘导航、Chat 存储隔离、模式持久化、失败隔离、主题行为、菜单和清除数据对话框。
- 以设计说明中的截图为视觉真值；不得残留横向模式行。
- 当前解压工作区没有 `.git` 目录，因此跳过提交命令，以每项任务的测试结果作为审查检查点。
- 中英文文档及其 `.i18n.yaml` 记录必须同步更新。

## 文件结构

- `apps/desktop/src/desktop-application.ts`：分别管理内容与本地 chrome 的原生边界。
- `apps/desktop/src/harness-surface.ts`：使用全高桌面布局标记加载 Harness。
- `apps/desktop/src/mode-chrome-preload.ts`：把选中模式与布局状态投射到可信 chrome DOM 数据属性。
- `apps/desktop/resources/mode-chrome.css`：设置紧凑选择器尺寸，只绘制 Chat 侧栏标题区衬底。
- `apps/desktop/tests/main-composition.spec.ts`：固定平台内容矩形与关闭状态 chrome 矩形。
- `apps/desktop/tests/harness-surface.spec.ts`：固定 Harness URL 标记。
- `apps/desktop/tests/dual-mode.electron.spec.ts`：固定真实 Electron 几何、主题状态、交互和截图合成。
- `apps/desktop/README.md` 与 `apps/desktop/README.zh.md`：记录产品可见布局及远程页面限制。
- `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md` 与中文配对文件：记录持久的本地覆盖决策。
- `design-qa.md`：记录参考图与生产界面的视觉证据及阻断结果。

---

### 任务 1：固定全高内容与侧栏局部 chrome

**文件：**
- 修改：`apps/desktop/tests/main-composition.spec.ts`
- 修改：`apps/desktop/tests/harness-surface.spec.ts`
- 修改：`apps/desktop/tests/dual-mode.electron.spec.ts`

**接口：**
- 使用：现有 `DesktopSurface.setBounds(bounds: DesktopContentBounds): void` 与 `DesktopChromeLayout` IPC。
- 产出：全高内容边界、平台标题区高度、选择器宽度和 Harness URL 标记的可执行断言。

- [ ] **步骤 1：编写失败的原生组合断言**

用以下几何替换内容偏移用例：

```text
it.each([
  { platform: 'darwin' as const, chromeHeight: 98 },
  { platform: 'win32' as const, chromeHeight: 58 },
])('keeps $platform content full-height and chrome inside the sidebar header', async ({ platform, chromeHeight }) => {
  // Retain the existing fixture setup and startup sequence.
  expect(harness.value.setBounds).toHaveBeenCalledWith({
    x: 0,
    y: 0,
    width: 1200,
    height: 800,
  })
  expect(chrome.value.setBounds).toHaveBeenCalledWith({
    x: 0,
    y: 0,
    width: 280,
    height: chromeHeight,
  })
})
```

- [ ] **步骤 2：固定全高 Harness URL 约束**

把 Harness URL 断言改为：

```text
expect(loaded.searchParams.get('dsh-desktop-platform')).toBe('darwin')
expect(loaded.searchParams.has('dsh-desktop-embedded')).toBe(false)
```

- [ ] **步骤 3：固定真实 Electron 几何和选择器局部位置**

解析 shell、chrome 与选中内容页面后断言：

```text
const [shellHeight, chromeHeight, contentHeight, selectorBox] = await Promise.all([
  shell.evaluate(() => innerHeight),
  chrome.evaluate(() => innerHeight),
  harnessContent.evaluate(() => innerHeight),
  chrome.locator('#mode-selector').boundingBox(),
])
expect(contentHeight).toBe(shellHeight)
expect(chromeHeight).toBe(98)
expect(selectorBox).not.toBeNull()
expect(selectorBox!.width).toBeLessThan(210)
expect(selectorBox!.x + selectorBox!.width).toBeLessThan(240)
```

- [ ] **步骤 4：运行聚焦测试并确认 RED**

运行：

```sh
pnpm exec vitest run --root . apps/desktop/tests/main-composition.spec.ts apps/desktop/tests/harness-surface.spec.ts
pnpm --dir apps/desktop run test:electron
```

预期：组合测试因内容仍从 `98/58` 开始而失败；Harness URL 仍含 `dsh-desktop-embedded=1`；Electron 内容高度仍是 `shellHeight - chromeHeight`；选择器宽度仍为 `224px`。

### 任务 2：分离内容边界与 chrome 边界

**文件：**
- 修改：`apps/desktop/src/desktop-application.ts`
- 修改：`apps/desktop/src/harness-surface.ts`
- 测试：`apps/desktop/tests/main-composition.spec.ts`
- 测试：`apps/desktop/tests/harness-surface.spec.ts`

**接口：**
- 使用：`BrowserWindow.getContentBounds()` 与现有 `DesktopModeController.resize(bounds)`。
- 产出：全高内容的 `contentBounds(window): DesktopContentBounds` 与仅供本地 chrome 使用的 `chromeHeaderHeight(platform): number`。

- [ ] **步骤 1：让内容边界脱离平台并占满高度**

使用以下辅助函数：

```text
function chromeHeaderHeight(platform: NodeJS.Platform): number {
  return chromeTopInset(platform) + CHROME_SELECTOR_ROW_HEIGHT
}

function contentBounds(window: BrowserWindow): DesktopContentBounds {
  const { width, height } = window.getContentBounds()
  return {
    x: 0,
    y: 0,
    width: Math.max(0, width),
    height: Math.max(0, height),
  }
}
```

把所有调用方改为 `contentBounds(nativeWindow)`，仅在计算 chrome 高度时保留平台输入。

- [ ] **步骤 2：独立计算 chrome 边界**

在 `setChromeBounds` 内使用窗口矩形与平台标题区高度：

```text
const content = contentBounds(currentWindow)
const headerHeight = chromeHeaderHeight(options.platform)
const menuHeight = chromeSurface === 'mode-menu' ? 164 : chromeSurface === 'chat-menu' ? 90 : 0
const height = chromeSurface === 'dialog'
  ? content.height
  : chromeSurface === 'closed'
    ? headerHeight
    : compact
      ? Math.max(166, menuHeight + 8)
      : headerHeight + menuHeight
currentChrome.setBounds({ x: 0, y: 0, width, height: Math.min(content.height, height) })
```

- [ ] **步骤 3：恢复 Harness 全高桌面表现**

保留平台标记，仅移除栏下嵌入标记：

```text
const rendererUrl = new URL(origin)
rendererUrl.searchParams.set('dsh-desktop-platform', options.platform)
```

- [ ] **步骤 4：运行聚焦测试并确认 GREEN**

运行：

```sh
pnpm exec vitest run --root . apps/desktop/tests/main-composition.spec.ts apps/desktop/tests/harness-surface.spec.ts
pnpm --dir apps/desktop run typecheck
```

预期：两个测试文件通过，桌面端类型检查退出 `0`。

### 任务 3：渲染随内容收缩的选择器与 Chat 局部衬底

**文件：**
- 修改：`apps/desktop/src/mode-chrome-preload.ts`
- 修改：`apps/desktop/resources/mode-chrome.css`
- 修改：`apps/desktop/tests/dual-mode.electron.spec.ts`

**接口：**
- 使用：现有 `DesktopModeSnapshot.selected` 与 `data-compact` 布局状态。
- 产出：值为 `chat | harness` 的 `document.documentElement.dataset.mode`，以及绝不绘制到侧栏标题区之外的 CSS。

- [ ] **步骤 1：添加失败的模式与背景断言**

选择 Harness 与 Chat 后断言可信 chrome 状态：

```text
await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.mode)).toBe('harness')
await selectMode(chrome, 'chat')
await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.mode)).toBe('chat')
expect(await chrome.locator('#mode-chrome-root').evaluate((root) =>
  getComputedStyle(root, '::before').display,
)).toBe('block')
```

- [ ] **步骤 2：把选中模式投射到 chrome 文档**

扩展快照监听器：

```text
ipcRenderer.on(DESKTOP_SHELL_CHANNELS.snapshot, (_event, snapshot: DesktopModeSnapshot) => {
  selected = snapshot.selected
  document.documentElement.dataset.mode = selected
  label.textContent = selected === 'chat' ? 'DeepSeek Chat' : 'Harness'
  // Preserve the existing checked-state and Chat-action updates.
})
```

- [ ] **步骤 3：把选择器与衬底几何限制在侧栏内**

添加并更新以下完整 CSS 规则：

```css
:root {
  --chrome-sidebar-width: 280px;
}

#mode-chrome-root::before {
  content: "";
  display: none;
  position: fixed;
  inset: 0 auto auto 0;
  width: var(--chrome-sidebar-width);
  height: calc(var(--chrome-top-inset) + 58px);
  background: var(--chrome-background);
  pointer-events: none;
}

:root[data-mode='chat'] #mode-chrome-root::before {
  display: block;
}

#chrome-controls {
  right: auto;
  width: calc(var(--chrome-sidebar-width) - var(--chrome-inline-inset) - 4px);
}

#mode-selector {
  width: auto;
  max-width: min(196px, calc(100vw - 56px));
  border-color: var(--chrome-border);
  background: var(--chrome-surface);
}

:root[data-compact='true'] {
  --chrome-sidebar-width: var(--chrome-rail-width);
}
```

保留现有紧凑状态 `48px` 选择器、菜单几何、焦点状态、mask 图标和减少动画规则。

- [ ] **步骤 4：运行 Electron 场景并确认 GREEN**

运行：

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build
pnpm --dir apps/desktop run test:electron
```

预期：`1` 个 Electron 测试通过；选择器宽度小于 `210px`；Harness 内容高度与 shell 一致；Chat 仅在被选中后显示局部衬底。

### 任务 4：捕获覆盖式截图并更新产品文档

**文件：**
- 修改：`apps/desktop/tests/dual-mode.electron.spec.ts`
- 修改：`apps/desktop/README.md`
- 修改：`apps/desktop/README.zh.md`
- 修改：`.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md`
- 修改：`.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.zh.md`
- 修改：匹配的 `.i18n.yaml` 记录
- 修改：`design-qa.md`

**接口：**
- 使用：完整窗口大小的内容截图与侧栏宽度的透明 chrome 截图。
- 产出：chrome 在 `(0, 0)` 覆盖、与内容同尺寸的证据图，以及当前状态文档。

- [ ] **步骤 1：把 chrome 覆盖到内容上，而不是纵向堆叠**

把截图画布替换为：

```text
await sharp({
  create: {
    width,
    height: contentHeight,
    channels: 4,
    background: theme === 'dark' ? '#121416' : '#f5f7f8',
  },
})
  .composite([
    { input: contentImage, left: 0, top: 0 },
    { input: chromeImage, left: 0, top: 0 },
  ])
  .png()
  .toFile(join(directory, `${name}.png`))
```

- [ ] **步骤 2：更新当前状态桌面文档**

在两种语言中记录以下事实：

- 内容视图占满窗口。
- 关闭状态本地 chrome 只拥有侧栏标题区。
- Harness 复用隐藏字标行。
- Chat 左上角矩形被有意覆盖，不访问 DOM。
- 菜单只在打开期间扩展到关闭状态矩形之外。

- [ ] **步骤 3：更新已实施 Agent Note**

用全高内容与侧栏局部覆盖决策替换选择器下方内容偏移机制。保留仍然成立的认证、存储、导航、主题、失败与打包依据。使用 `git hash-object` 重新计算两侧 blob 哈希并更新配对记录。

- [ ] **步骤 4：捕获全部视觉状态**

运行：

```sh
DSH_DESKTOP_SCREENSHOT_DIR=/tmp/dsh-sidebar-local-selector pnpm --dir apps/desktop run test:electron
```

预期文件：`harness-light-expanded.png`、`harness-dark-expanded.png`、`chat-dark-expanded.png` 与 `chat-light-collapsed.png`；每张图的对话内容都从第 `0` 行开始，chrome 仅位于左边缘。

- [ ] **步骤 5：完成阻断式设计 QA**

在相同左上角/侧栏状态下比较 Codex 截图与展开暗色 Harness 截图。更新 `design-qa.md`，修复全部 P0/P1/P2 发现并重复捕获，直到最后一行严格为：

```text
final result: passed
```

### 任务 5：验证并打包双平台产物

**文件：**
- 验证：`apps/desktop/src/**`
- 验证：`apps/desktop/tests/**`
- 产出：`apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip`
- 产出：`apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip`

**接口：**
- 使用：已构建桌面 JavaScript、暂存 Host 运行时与 Electron 43 平台分发包。
- 产出：经过完整性检查的 macOS arm64 与 Windows x64 未签名测试 ZIP。

- [ ] **步骤 1：运行限定范围代码与文档检查**

运行：

```sh
pnpm exec vitest run --root . apps/desktop/tests
pnpm --dir apps/desktop run test:electron
pnpm --dir apps/desktop run typecheck
pnpm --dir apps/desktop run build
pnpm exec tsx scripts/run-oxlint.ts apps/desktop/src apps/desktop/tests apps/desktop/tests/fixtures/dual-mode-app/main.mjs
pnpm run verify-translation-pairing apps/desktop/README.md .agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md docs/superpowers/plans/2026-08-15-desktop-sidebar-local-selector.md
pnpm run verify-md-wrap
pnpm run verify-md-links
pnpm run verify-agent-note-format
```

预期：所有命令退出 `0`。

- [ ] **步骤 2：打包 macOS arm64**

运行：

```sh
node --import tsx apps/desktop/scripts/stage-runtime.ts --os=darwin --cpu=arm64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --mac dir --arm64 --config.mac.identity=null --config.mac.notarize=false
ditto -c -k --sequesterRsrc --keepParent apps/desktop/dist/mac-arm64 apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip
```

预期：Electron Builder 退出 `0`，ZIP 时间戳晚于源代码变更。

- [ ] **步骤 3：冒烟启动已打包 macOS 应用**

通过 Playwright 启动已打包可执行文件，使用明确的 `mktemp -d` 用户数据目录。等待 `shell.html` 与 `mode-chrome.html`，断言两个页面都存在，然后关闭 Electron，只删除创建的临时目录。

- [ ] **步骤 4：打包 Windows x64**

运行：

```sh
node --import tsx apps/desktop/scripts/stage-runtime.ts --os=win32 --cpu=x64
pnpm --dir apps/desktop exec electron-builder --win dir --x64 --config.electronDist=/Users/zo/Library/Caches/electron/63857c95525ff62c967a319a9c3921773c3420b77c6ebce7f47c8c76e68d9e11/electron-v43.4.0-win32-x64.zip
ditto -c -k --sequesterRsrc --keepParent apps/desktop/dist/win-unpacked apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip
```

预期：Electron Builder 与 ZIP 创建都退出 `0`。

- [ ] **步骤 5：验证架构、内容、完整性和哈希**

运行：

```sh
file "apps/desktop/dist/mac-arm64/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" "apps/desktop/dist/win-unpacked/DeepSeek Harness.exe"
unzip -tq apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip
unzip -tq apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip
shasum -a 256 apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip
```

预期：Mach-O arm64、PE32+ x86-64、两个 ZIP 无错误，并输出两个 SHA-256 值。
