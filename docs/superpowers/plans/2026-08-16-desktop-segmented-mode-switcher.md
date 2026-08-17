# Desktop segmented mode switcher implementation plan

English | [中文](2026-08-16-desktop-segmented-mode-switcher.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task by task in the current main-agent session.

**Goal:** Replace the title-bar dropdown with a directly clickable `Chat | Harness` segmented switch, remove native drag interception and the visible Chat title-bar color band, and retain Harness-first fresh-install behavior with later mode restoration.

**Architecture:** The existing local mode-chrome WebContentsView remains the only shared control owner, but its closed bounds become a stable two-segment switch and the `mode-menu` state is removed. A pure geometry helper owns the non-overlapping title-bar drag start, while the local shell paints only the existing 44px operating-system title-bar backdrop and receives the same resolved scheme as mode chrome.

**Tech stack:** Electron 43 `BrowserWindow` and `WebContentsView`, TypeScript 6, local HTML/CSS preloads, Vitest, Playwright Electron, Sharp screenshot composition, Electron Builder.

## Global constraints

- The switch is 164px by 32px, begins at `{ x: 88, y: 6 }` on macOS and `{ x: 12, y: 6 }` on Windows, and keeps `Chat` on the left and `Harness` on the right.
- The shell drag region starts at x=300 on macOS and x=224 on Windows and never overlaps the largest closed chrome bounds.
- Chat remains inset by only the existing 44px operating-system title bar; Harness continues to use full content bounds.
- The mode switch has no dropdown, chevron, product mark, outer border, or application-owned full-width toolbar.
- A missing desktop-state file selects Harness; valid later selections remain persisted and restored through the existing state file.
- Theme preference remains bidirectionally synchronized; the Chat title-bar backdrop must match the fixture page in both resolved schemes.
- Do not modify `vendor/`, add a dependency, expose Electron APIs to the Chat main world, or use subagents.
- This workspace has no `.git` directory, so each task ends with an explicit test checkpoint instead of an impossible commit.

---

### Task 1: Close the chrome protocol and title-bar geometry

**Files:**
- Modify: `apps/desktop/tests/desktop-chrome-layout.spec.ts`
- Modify: `apps/desktop/tests/shell-protocol.spec.ts`
- Modify: `apps/desktop/src/desktop-chrome-layout.ts`
- Modify: `apps/desktop/src/shell-protocol.ts`

**Interfaces:**
- Produces: `desktopTitlebarDragStart(platform: NodeJS.Platform): number`.
- Produces: `DesktopChromeSurface = 'closed' | 'chat-menu' | 'dialog'`.
- Closed chrome is 164px wide in Harness and 200px wide in Chat; Chat-menu chrome remains at least 200px wide.

- [ ] **Step 1: Write failing geometry and protocol tests.** Replace old dropdown expectations with the fixed segment bounds and the drag invariant.

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

- [ ] **Step 2: Run the focused tests and confirm RED.**

Run: `pnpm exec vitest run apps/desktop/tests/desktop-chrome-layout.spec.ts apps/desktop/tests/shell-protocol.spec.ts`

Expected: FAIL on the old 88/176px bounds and acceptance of `mode-menu`.

- [ ] **Step 3: Implement the minimal geometry and protocol.** Use `CHROME_TOP = 6`, `CHROME_SWITCH_WIDTH = 164`, `CHROME_CONTROL_HEIGHT = 32`, and the existing 4px/32px Chat action sizes. Remove both mode-menu dimensions and return 300 or 224 from `desktopTitlebarDragStart()`.

```ts
export type DesktopChromeSurface = 'closed' | 'chat-menu' | 'dialog'

export function desktopTitlebarDragStart(platform: NodeJS.Platform): number {
  return platform === 'darwin' ? 300 : 224
}
```

- [ ] **Step 4: Run the focused tests and confirm GREEN.**

Run: `pnpm exec vitest run apps/desktop/tests/desktop-chrome-layout.spec.ts apps/desktop/tests/shell-protocol.spec.ts`

Expected: PASS with all closed chrome ending before the platform drag start.

### Task 2: Propagate the resolved scheme to the shell backdrop

**Files:**
- Modify: `apps/desktop/tests/main-composition.spec.ts`
- Modify: `apps/desktop/src/desktop-application.ts`
- Modify: `apps/desktop/src/shell-preload.ts`
- Modify: `apps/desktop/resources/shell.html`
- Modify: `apps/desktop/resources/shell.css`

**Interfaces:**
- Consumes: `desktopTitlebarDragStart()` and `DESKTOP_SHELL_CHANNELS.chromeTheme`.
- Produces: shell root attributes `data-mode`, `data-platform`, and `data-theme` plus CSS variable `--shell-drag-start`.
- The title-bar backdrop uses `#f5f7f8` for Chat light and `#121416` for Chat dark in the deterministic fixture.

- [ ] **Step 1: Write failing composition assertions.** Require every resolved-scheme publication to reach the shell WebContents as well as mode chrome, including system changes and selected-mode changes.

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

- [ ] **Step 2: Run the composition test and confirm RED.**

Run: `pnpm exec vitest run apps/desktop/tests/main-composition.spec.ts`

Expected: FAIL because `sendChromeTheme()` currently sends only to mode chrome.

- [ ] **Step 3: Implement shell theme delivery and the non-overlapping drag region.** Send the scheme to both trusted local renderers. Add `#titlebar-backdrop` before the drag region, set the drag region's `left` from `desktopTitlebarDragStart(process.platform)`, and update the root theme from validated IPC.

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

- [ ] **Step 4: Run the composition test and confirm GREEN.**

Run: `pnpm exec vitest run apps/desktop/tests/main-composition.spec.ts`

Expected: PASS with both local renderers receiving each resolved scheme.

### Task 3: Replace the dropdown with the direct segmented switch

**Files:**
- Modify: `apps/desktop/tests/dual-mode.electron.spec.ts`
- Modify: `apps/desktop/resources/mode-chrome.html`
- Modify: `apps/desktop/resources/mode-chrome.css`
- Modify: `apps/desktop/src/mode-chrome-preload.ts`

**Interfaces:**
- Consumes: the closed `select` IPC channel and the three-state chrome-surface protocol.
- Produces: `#mode-switch[role="radiogroup"]` containing `[data-mode="chat"]` and `[data-mode="harness"]` radio buttons.
- Chat actions retain the acknowledged `chat-menu`/`dialog` expansion flow.

- [ ] **Step 1: Write failing Electron assertions.** Wait for `#mode-switch`, require two radios and no mode menu or chevron, click both radios directly, exercise arrow/Home/End selection, and check stable 164/200px native widths.

```ts ignore-check
await chrome.locator('#mode-switch').waitFor()
expect(await chrome.locator('#mode-menu').count()).toBe(0)
expect(await chrome.locator('.chevron').count()).toBe(0)
await chrome.locator('[data-mode="chat"]').click()
await expect.poll(async () => (await fixtureState(application)).snapshot?.selected).toBe('chat')
await chrome.locator('[data-mode="harness"]').click()
await expect.poll(async () => (await fixtureState(application)).snapshot?.selected).toBe('harness')
```

- [ ] **Step 2: Build and run the Electron scenario to confirm RED.**

Run: `pnpm --filter @deepseek-ai/dsh-desktop run build && pnpm exec vitest run apps/desktop/tests/dual-mode.electron.spec.ts`

Expected: FAIL because the current DOM exposes `#mode-selector`, `.chevron`, and `#mode-menu`.

- [ ] **Step 3: Implement the semantic switch.** Replace the selector/menu with two radio buttons and a non-interactive highlight. A click sends `DESKTOP_SHELL_CHANNELS.select` immediately. Arrow, Home, and End keys move focus and select; snapshots update `aria-checked`, `tabIndex`, root mode, and Chat-action visibility.

```html
<div id="mode-switch" role="radiogroup" aria-label="Desktop mode">
  <span id="mode-highlight" aria-hidden="true"></span>
  <button type="button" role="radio" data-mode="chat" aria-checked="false">Chat</button>
  <button type="button" role="radio" data-mode="harness" aria-checked="true">Harness</button>
</div>
```

- [ ] **Step 4: Style one stable title-bar control.** Use a 164px by 32px two-column grid, an 8px-or-smaller radius, theme-derived foregrounds, a borderless track, and a translated 82px highlight. Keep only actual controls `pointer-events: auto` and `-webkit-app-region: no-drag`; the transparent root remains non-interactive.

- [ ] **Step 5: Run the Electron scenario and confirm GREEN.**

Run: `DSH_DESKTOP_SCREENSHOT_DIR=apps/desktop/output/playwright/desktop-segmented-mode pnpm exec vitest run apps/desktop/tests/dual-mode.electron.spec.ts`

Expected: PASS with direct switching, no dropdown artifacts, an unobstructed Chat sidebar control, and light/dark screenshots.

### Task 4: Prove fresh-install default, restoration, and real native hit testing

**Files:**
- Modify: `apps/desktop/tests/dual-mode.electron.spec.ts`
- Modify: `apps/desktop/tests/fixtures/dual-mode-app/main.mjs`
- Modify: `design-qa.md`

**Interfaces:**
- The fixture user-data directory owns `desktop-state.json` across controlled relaunches.
- Fixture state exposes shell, chrome, Chat, and Harness native bounds plus the existing Chat sidebar click count.

- [ ] **Step 1: Add a failing relaunch scenario.** Launch with an empty temporary user-data directory and assert Harness, select Chat directly, close, relaunch with the same directory, and assert Chat is restored before deleting the directory.

- [ ] **Step 2: Run the Electron scenario and confirm that the new test exercises persistence.**

Run: `pnpm exec vitest run apps/desktop/tests/dual-mode.electron.spec.ts`

Expected: PASS for existing state behavior after any fixture lifecycle adjustments; the test must fail first if it still uses the dropdown helper or removes user data before relaunch.

- [ ] **Step 3: Add surface evidence.** Assert the shell drag start is not left of the closed chrome end, compare computed Chat body and title-bar backdrop colors in light and dark, and keep the real Chat sidebar click assertion.

- [ ] **Step 4: Run the packaged macOS app and perform one native pointer smoke.** Use an explicit temporary user-data directory, click the Chat and Harness segments through macOS screen coordinates, verify the selected side moves each time, and record the screenshot and observation in `design-qa.md`. This complements Playwright's renderer-directed input with operating-system title-bar hit testing.

### Task 5: Synchronize current documentation and verify the desktop build

**Files:**
- Modify: `apps/desktop/README.md`
- Modify: `apps/desktop/README.zh.md`
- Modify: `apps/desktop/README.i18n.yaml`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.zh.md`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.i18n.yaml`
- Verify: `docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md`

**Interfaces:**
- README owns current desktop behavior; the implemented Agent Note owns the retained-view and local-chrome rationale.
- Bilingual pairs must carry matching structure and manually recorded `git hash-object` values because repository Git metadata is absent.

- [ ] **Step 1: Replace current dropdown descriptions in both languages.** Document direct `Chat | Harness` selection, the title-bar backdrop, non-overlapping drag geometry, and Harness-first fresh installations with later restoration.

- [ ] **Step 2: Re-record and verify only changed bilingual pairs.**

Run: `pnpm run verify-translation-pairing apps/desktop/README.md .agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md docs/superpowers/plans/2026-08-16-desktop-segmented-mode-switcher.md`

Expected: all four named pairs consistent.

- [ ] **Step 3: Run focused source verification.**

```text
pnpm exec vitest run apps/desktop/tests/*.spec.ts
pnpm --filter @deepseek-ai/dsh-desktop run typecheck
pnpm exec oxlint apps/desktop/src apps/desktop/tests
pnpm --filter @deepseek-ai/dsh-desktop run build
```

Expected: every command exits 0 without warnings introduced by this change.

### Task 6: Rebuild and inspect both portable artifacts

**Files:**
- Replace: `apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip`
- Replace: `apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip`

**Interfaces:**
- Portable artifact names and target architectures remain unchanged.
- Both artifacts contain the shell resources and all four CommonJS sandbox preloads.

- [ ] **Step 1: Build the product paths used by Desktop packaging.**

```text
pnpm exec tsc -p packages/client/ui-theme/tsconfig.json
pnpm exec tsdown --env.DSH_BUILD_FACE client
pnpm run build:web
pnpm run build:desktop
```

- [ ] **Step 2: Stage and package macOS arm64, then Windows x64.**

```text
node --import tsx apps/desktop/scripts/stage-runtime.ts --os=darwin --cpu=arm64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --mac dir --arm64 --config.mac.identity=null --config.mac.notarize=false
ditto -c -k --sequesterRsrc --keepParent apps/desktop/dist/mac-arm64 apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip

node --import tsx apps/desktop/scripts/stage-runtime.ts --os=win32 --cpu=x64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --win dir --x64 --config.electronDist=/Users/zo/Library/Caches/electron/63857c95525ff62c967a319a9c3921773c3420b77c6ebce7f47c8c76e68d9e11/electron-v43.4.0-win32-x64.zip
zip -qr dist/DeepSeek-Harness-Windows-x64.zip dist/win-unpacked
```

- [ ] **Step 3: Verify release evidence.** Run `unzip -tq` on both ZIPs, `file` on both unpacked executables, locate the four preloads and the updated shell resources in each application, and record byte sizes plus SHA-256 hashes.

## Self-review

- Spec coverage: Tasks 1-4 cover the direct segmented interaction, native hit testing, absence of a new toolbar, matching Chat title-bar themes, fresh-install Harness, restoration, keyboard use, and unobstructed product controls; Tasks 5-6 cover repository contracts and both requested artifacts.
- Placeholder scan: every change step names exact files, interfaces, commands, and expected results; no deferred implementation or unnamed error handling remains.
- Type consistency: `desktopTitlebarDragStart`, the three-member `DesktopChromeSurface`, `DESKTOP_TITLEBAR_HEIGHT`, the two segment mode values, and the portable ZIP names are consistent across all tasks.
