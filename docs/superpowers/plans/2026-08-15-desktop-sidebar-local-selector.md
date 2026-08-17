# Desktop Sidebar-local Mode Selector Implementation Plan

English | [中文](2026-08-15-desktop-sidebar-local-selector.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the apparent horizontal mode row with one compact top-left sidebar selector while both Chat and Harness content fill the window height.

**Architecture:** Keep the trusted mode-chrome WebContentsView above the retained content views, but separate content bounds from chrome bounds. Content uses the complete window rectangle; closed chrome owns only the sidebar header and expands only for menus or the confirmation dialog. Harness reuses its full-height Desktop sidebar header, while Chat accepts a theme-backed local overlay over its top-left rectangle without DOM access.

**Tech Stack:** TypeScript 6, Electron 43 `WebContentsView`, HTML/CSS, Vitest 4, Playwright Electron, Sharp, Electron Builder.

## Global Constraints

- Execute inline in the primary session; do not dispatch subagents.
- Do not inject scripts into, read, or rearrange the official DeepSeek Chat DOM.
- The closed selector chrome stays inside the sidebar width; no native view or visible fill spans the conversation column.
- Chat and Harness content bounds use `x: 0`, `y: 0`, and the complete content width and height on macOS, Windows, and Linux.
- Expanded selection is a content-sized button in the leading sidebar header; compact selection remains a fixed icon target.
- Preserve keyboard navigation, Chat storage isolation, mode persistence, failure isolation, theme behavior, menus, and the clear-data dialog.
- Use the screenshot in the design specification as visual truth; no horizontal mode row may remain.
- The extracted workspace has no `.git` directory. Skip commit commands here, but keep each task's tests as its review checkpoint.
- Update English and Chinese documentation pairs and their `.i18n.yaml` records together.

## File Structure

- `apps/desktop/src/desktop-application.ts`: owns independent content and local-chrome native bounds.
- `apps/desktop/src/harness-surface.ts`: loads Harness with full-height Desktop layout markers.
- `apps/desktop/src/mode-chrome-preload.ts`: projects selected mode and layout state into trusted chrome DOM data attributes.
- `apps/desktop/resources/mode-chrome.css`: sizes the compact selector and paints only the Chat sidebar-header backing.
- `apps/desktop/tests/main-composition.spec.ts`: pins platform content and closed-chrome rectangles.
- `apps/desktop/tests/harness-surface.spec.ts`: pins the Harness URL markers.
- `apps/desktop/tests/dual-mode.electron.spec.ts`: pins real Electron geometry, theme state, interaction, and screenshot composition.
- `apps/desktop/README.md` and `apps/desktop/README.zh.md`: document the product-visible layout and remote-page limitation.
- `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md` and its Chinese pair: record the durable local-overlay decision.
- `design-qa.md`: records reference-versus-production visual evidence and the blocking result.

---

### Task 1: Pin Full-height Content and Sidebar-only Chrome

**Files:**
- Modify: `apps/desktop/tests/main-composition.spec.ts`
- Modify: `apps/desktop/tests/harness-surface.spec.ts`
- Modify: `apps/desktop/tests/dual-mode.electron.spec.ts`

**Interfaces:**
- Consumes: existing `DesktopSurface.setBounds(bounds: DesktopContentBounds): void` and `DesktopChromeLayout` IPC.
- Produces: executable expectations for full content bounds, platform header heights, selector width, and Harness URL markers.

- [ ] **Step 1: Write the failing native composition assertions**

Replace the content-offset case with the following geometry:

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

- [ ] **Step 2: Pin the full-height Harness URL contract**

Change the Harness URL assertion to:

```text
expect(loaded.searchParams.get('dsh-desktop-platform')).toBe('darwin')
expect(loaded.searchParams.has('dsh-desktop-embedded')).toBe(false)
```

- [ ] **Step 3: Pin real Electron geometry and selector locality**

After resolving the shell, chrome, and selected content pages, assert:

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

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```sh
pnpm exec vitest run --root . apps/desktop/tests/main-composition.spec.ts apps/desktop/tests/harness-surface.spec.ts
pnpm --dir apps/desktop run test:electron
```

Expected: composition fails because content still starts at `98/58`; Harness URL still contains `dsh-desktop-embedded=1`; Electron content height remains `shellHeight - chromeHeight`; selector width is `224px`.

### Task 2: Separate Content Bounds from Chrome Bounds

**Files:**
- Modify: `apps/desktop/src/desktop-application.ts`
- Modify: `apps/desktop/src/harness-surface.ts`
- Test: `apps/desktop/tests/main-composition.spec.ts`
- Test: `apps/desktop/tests/harness-surface.spec.ts`

**Interfaces:**
- Consumes: `BrowserWindow.getContentBounds()` and existing `DesktopModeController.resize(bounds)`.
- Produces: `contentBounds(window): DesktopContentBounds` for full content and `chromeHeaderHeight(platform): number` for local chrome only.

- [ ] **Step 1: Make content bounds platform-independent and full-height**

Use these helpers:

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

Update every caller to `contentBounds(nativeWindow)` and keep platform input only where chrome height is calculated.

- [ ] **Step 2: Calculate chrome bounds independently**

Inside `setChromeBounds`, use the window rectangle and platform header height:

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

- [ ] **Step 3: Restore Harness full-height Desktop presentation**

Keep the platform marker and remove only the below-bar marker:

```text
const rendererUrl = new URL(origin)
rendererUrl.searchParams.set('dsh-desktop-platform', options.platform)
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```sh
pnpm exec vitest run --root . apps/desktop/tests/main-composition.spec.ts apps/desktop/tests/harness-surface.spec.ts
pnpm --dir apps/desktop run typecheck
```

Expected: both test files pass and Desktop typecheck exits `0`.

### Task 3: Render a Content-sized Selector and Chat-local Backing

**Files:**
- Modify: `apps/desktop/src/mode-chrome-preload.ts`
- Modify: `apps/desktop/resources/mode-chrome.css`
- Modify: `apps/desktop/tests/dual-mode.electron.spec.ts`

**Interfaces:**
- Consumes: existing `DesktopModeSnapshot.selected` and `data-compact` layout state.
- Produces: `document.documentElement.dataset.mode` with `chat | harness`, plus CSS that never paints outside the sidebar header.

- [ ] **Step 1: Add failing mode and background assertions**

After Harness and Chat selections, assert the trusted chrome state:

```text
await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.mode)).toBe('harness')
await selectMode(chrome, 'chat')
await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.mode)).toBe('chat')
expect(await chrome.locator('#mode-chrome-root').evaluate((root) =>
  getComputedStyle(root, '::before').display,
)).toBe('block')
```

- [ ] **Step 2: Project selected mode to the chrome document**

Extend the snapshot listener:

```text
ipcRenderer.on(DESKTOP_SHELL_CHANNELS.snapshot, (_event, snapshot: DesktopModeSnapshot) => {
  selected = snapshot.selected
  document.documentElement.dataset.mode = selected
  label.textContent = selected === 'chat' ? 'DeepSeek Chat' : 'Harness'
  // Preserve the existing checked-state and Chat-action updates.
})
```

- [ ] **Step 3: Limit selector and backing geometry to the sidebar**

Add and update these complete CSS rules:

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

Keep the existing compact `48px` selector, menu geometry, focus state, mask icon, and reduced-motion rules.

- [ ] **Step 4: Run the Electron scenario and verify GREEN**

Run:

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build
pnpm --dir apps/desktop run test:electron
```

Expected: `1` Electron test passes; the selector remains under `210px`; Harness content matches shell height; Chat exposes the local backing only after selection.

### Task 4: Capture Overlay Screenshots and Update Product Documentation

**Files:**
- Modify: `apps/desktop/tests/dual-mode.electron.spec.ts`
- Modify: `apps/desktop/README.md`
- Modify: `apps/desktop/README.zh.md`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.zh.md`
- Modify: matching `.i18n.yaml` records
- Modify: `design-qa.md`

**Interfaces:**
- Consumes: content screenshot at full window size and transparent chrome screenshot at sidebar width.
- Produces: same-size composite evidence with chrome overlaid at `(0, 0)` and current-state documentation.

- [ ] **Step 1: Composite chrome over content instead of stacking it**

Replace the screenshot canvas with:

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

- [ ] **Step 2: Update current-state Desktop documentation**

Document these exact facts in both languages:

- Content views fill the window.
- Closed local chrome owns only the sidebar header.
- Harness reuses its hidden wordmark row.
- Chat's top-left rectangle is intentionally covered without DOM access.
- Menus expand outside the closed rectangle only while open.

- [ ] **Step 3: Update the implemented Agent Note**

Replace the below-selector content-offset mechanism with the full-height content and sidebar-local overlay decision. Preserve authentication, storage, navigation, theme, failure, and packaging rationale that remains true. Recompute both Git blob hashes with `git hash-object` and update the pair record.

- [ ] **Step 4: Capture all visual states**

Run:

```sh
DSH_DESKTOP_SCREENSHOT_DIR=/tmp/dsh-sidebar-local-selector pnpm --dir apps/desktop run test:electron
```

Expected files: `harness-light-expanded.png`, `harness-dark-expanded.png`, `chat-dark-expanded.png`, and `chat-light-collapsed.png`, each with the conversation content at image row `0` and chrome confined to the left edge.

- [ ] **Step 5: Complete blocking design QA**

Compare the Codex screenshot and the expanded dark Harness screenshot at matching top-left/sidebar state. Update `design-qa.md`; fix all P0/P1/P2 findings and repeat capture until the last line is exactly:

```text
final result: passed
```

### Task 5: Verify and Package Both Platforms

**Files:**
- Verify: `apps/desktop/src/**`
- Verify: `apps/desktop/tests/**`
- Produce: `apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip`
- Produce: `apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip`

**Interfaces:**
- Consumes: built Desktop JavaScript, staged Host runtime, and Electron 43 platform distributions.
- Produces: integrity-checked unsigned test ZIPs for macOS arm64 and Windows x64.

- [ ] **Step 1: Run scoped code and documentation checks**

Run:

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

Expected: every command exits `0`.

- [ ] **Step 2: Package macOS arm64**

Run:

```sh
node --import tsx apps/desktop/scripts/stage-runtime.ts --os=darwin --cpu=arm64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --mac dir --arm64 --config.mac.identity=null --config.mac.notarize=false
ditto -c -k --sequesterRsrc --keepParent apps/desktop/dist/mac-arm64 apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip
```

Expected: Electron Builder exits `0` and the ZIP timestamp is newer than the source changes.

- [ ] **Step 3: Smoke the packaged macOS app**

Launch the packaged executable through Playwright with an explicit `mktemp -d` user-data directory. Wait for `shell.html` and `mode-chrome.html`, assert both pages exist, then close Electron and delete only the created temporary directory.

- [ ] **Step 4: Package Windows x64**

Run:

```sh
node --import tsx apps/desktop/scripts/stage-runtime.ts --os=win32 --cpu=x64
pnpm --dir apps/desktop exec electron-builder --win dir --x64 --config.electronDist=/Users/zo/Library/Caches/electron/63857c95525ff62c967a319a9c3921773c3420b77c6ebce7f47c8c76e68d9e11/electron-v43.4.0-win32-x64.zip
ditto -c -k --sequesterRsrc --keepParent apps/desktop/dist/win-unpacked apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip
```

Expected: Electron Builder and ZIP creation exit `0`.

- [ ] **Step 5: Verify architecture, contents, integrity, and hashes**

Run:

```sh
file "apps/desktop/dist/mac-arm64/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" "apps/desktop/dist/win-unpacked/DeepSeek Harness.exe"
unzip -tq apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip
unzip -tq apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip
shasum -a 256 apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip
```

Expected: Mach-O arm64, PE32+ x86-64, no ZIP errors, and two SHA-256 values.
