# Desktop title-bar mode switcher implementation plan

English | [中文](2026-08-16-desktop-titlebar-mode-switcher.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Move the persistent Harness/DeepSeek Chat selector into the existing operating-system title bar, remove the application-owned header above Chat, and make pointer mode switching reliable.

**Architecture:** Retain the isolated transparent mode-chrome `WebContentsView`, but constrain its closed bounds to title-bar controls and make menu opening an acknowledged main-process geometry transition. Harness keeps full content bounds because its layout already accommodates the desktop title bar; Chat receives only `DESKTOP_TITLEBAR_HEIGHT` and otherwise keeps the official page layout.

**Tech Stack:** Electron 43 `BrowserWindow`/`WebContentsView`, TypeScript, sandbox-compatible CommonJS preloads bundled by `tsdown`, static HTML/CSS, Vitest, Playwright Electron, Sharp screenshot composition, and Electron Builder.

## Global constraints

- Execute inline in the current session; do not dispatch subagents.
- The selector uses the existing 44px operating-system title bar and never creates another full-width row.
- macOS places the selector immediately to the right of the traffic lights; Windows places it at the left while native caption buttons remain at the right.
- Closed chrome contains only the selector and optional Chat overflow control; transparent native pixels must not cover product controls.
- The selector always displays `Harness` or `DeepSeek Chat` plus a chevron; it has no icon, resting border, or resting fill.
- Harness and Chat retain independent credentials, storage, navigation, page state, and failure lifecycles; theme preference remains their only synchronized product preference.
- The remote Chat document remains untouched except for the existing isolated theme adapter; do not inject selector DOM or CSS into the website.
- No new runtime dependency is added. The checkout has no `.git`, so execution records verification without commit steps.

---

### Task 1: Fix title-bar and content geometry

**Files:**
- Modify: `apps/desktop/src/desktop-chrome-layout.ts`
- Modify: `apps/desktop/src/desktop-application.ts`
- Modify: `apps/desktop/resources/shell.css`
- Test: `apps/desktop/tests/desktop-chrome-layout.spec.ts`
- Test: `apps/desktop/tests/main-composition.spec.ts`

**Interfaces:**
- `desktopChromeBounds(input: DesktopChromeBoundsInput): DesktopContentBounds` produces tight closed/menu/dialog rectangles in BrowserWindow content coordinates.
- `insetDesktopContentBounds(bounds, DESKTOP_TITLEBAR_HEIGHT)` produces Chat bounds; Harness continues to receive the original bounds.
- `DESKTOP_TITLEBAR_HEIGHT` remains the single shared 44px title-bar constant.

- [x] **Step 1: Write failing geometry assertions.** Replace the former macOS `{ x: 27, y: 44, height: 48 }` expectations with title-bar rectangles and assert that Chat uses exactly 44px while Harness remains full-height.

```text
expect(desktopChromeBounds({
  platform: 'darwin', mode: 'harness', surface: 'closed', content,
})).toEqual({ x: 88, y: 4, width: 88, height: 36 })

expect(insetDesktopContentBounds(content, DESKTOP_TITLEBAR_HEIGHT)).toEqual({
  x: 0, y: 44, width: 1200, height: 756,
})
```

- [x] **Step 2: Run the red tests.**

Run: `pnpm exec vitest run apps/desktop/tests/desktop-chrome-layout.spec.ts apps/desktop/tests/main-composition.spec.ts`

Expected: FAIL because closed chrome still starts at `y=44` and Chat still uses the 98px/58px local header.

- [x] **Step 3: Implement the smallest geometry change.** Use one 36px control row vertically centered inside the title bar; use a macOS leading inset after the traffic lights and a Windows leading inset at the left. Remove compact-width geometry and the derived local-header height.

```text
const CHROME_TOP = 4
const CHROME_HEIGHT = 36
const CHROME_INLINE_INSET_MACOS = 88
const CHROME_INLINE_INSET_WINDOWS = 12
const CHROME_SELECTOR_WIDTH_HARNESS = 88
const CHROME_SELECTOR_WIDTH_CHAT = 140
```

- [x] **Step 4: Apply only the system title-bar inset to Chat.** Replace `desktopChromeHeaderHeight(options.platform)` with `DESKTOP_TITLEBAR_HEIGHT` in the Chat theme connection. Set the shell drag region to 44px on macOS and Windows; Harness keeps full bounds and its existing internal accommodation.

- [x] **Step 5: Run the green geometry and composition tests.**

Run: `pnpm exec vitest run apps/desktop/tests/desktop-chrome-layout.spec.ts apps/desktop/tests/main-composition.spec.ts`

Expected: PASS, including macOS and Windows title-bar positions, tight closed bounds, full Harness bounds, and 44px-only Chat bounds.

### Task 2: Acknowledge menu geometry before rendering

**Files:**
- Modify: `apps/desktop/src/shell-protocol.ts`
- Modify: `apps/desktop/src/desktop-application.ts`
- Modify: `apps/desktop/src/mode-chrome-preload.ts`
- Test: `apps/desktop/tests/shell-protocol.spec.ts`
- Test: `apps/desktop/tests/main-composition.spec.ts`

**Interfaces:**
- `DesktopChromeLayout` carries the applied `surface: DesktopChromeSurface` and `dismissMenus: boolean`; the compact flag is removed.
- The renderer sends `DESKTOP_SHELL_CHANNELS.chromeSurface` as a request and reveals a menu only after `DESKTOP_SHELL_CHANNELS.chromeLayout` acknowledges the same state.
- Main calls `setBounds()` before sending the acknowledgement.

- [x] **Step 1: Write failing protocol and ordering tests.** Assert the applied surface is included in each layout message and that the native `setBounds` call precedes `webContents.send(chromeLayout, ...)`.

```text
expect(chrome.contents.send).toHaveBeenLastCalledWith(
  DESKTOP_SHELL_CHANNELS.chromeLayout,
  { surface: 'mode-menu', dismissMenus: false },
)
expect(chrome.view.setBounds.mock.invocationCallOrder.at(-1))
  .toBeLessThan(chrome.contents.send.mock.invocationCallOrder.at(-1))
```

- [x] **Step 2: Run the red protocol tests.**

Run: `pnpm exec vitest run apps/desktop/tests/shell-protocol.spec.ts apps/desktop/tests/main-composition.spec.ts`

Expected: FAIL because the current layout payload carries `compact` and the renderer shows the menu before main applies expanded bounds.

- [x] **Step 3: Change the closed IPC payload.** Define the applied-state response without a responsive label flag.

```text
export interface DesktopChromeLayout {
  readonly surface: DesktopChromeSurface
  readonly dismissMenus: boolean
}
```

- [x] **Step 4: Implement renderer request/acknowledgement behavior.** `openModeMenu()` and the Chat overflow opener record a requested state and send it without revealing content. The `chromeLayout` listener reveals only a matching requested state. Closing hides menu content first, records `closed`, and requests tight native bounds. A dismissal or mismatched stale acknowledgement leaves every menu hidden and requests `closed` when needed.

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

- [x] **Step 5: Preserve keyboard and focus behavior.** `Enter`, `Space`, and arrow keys request menu opening; `Escape`, blur, outside input, and selection close it. Focus moves to the checked menu row only after acknowledgement and returns to the selector after keyboard dismissal.

- [x] **Step 6: Run the green protocol and composition tests.**

Run: `pnpm exec vitest run apps/desktop/tests/shell-protocol.spec.ts apps/desktop/tests/main-composition.spec.ts`

Expected: PASS with acknowledged state, bounds-before-ack ordering, dismissal, and closed-state restoration covered.

### Task 3: Integrate the selector visually and prove real pointer behavior

**Files:**
- Modify: `apps/desktop/resources/mode-chrome.css`
- Modify: `apps/desktop/src/mode-chrome-preload.ts`
- Modify: `apps/desktop/tests/dual-mode.electron.spec.ts`
- Modify: `apps/desktop/tests/fixtures/dual-mode-app/main.mjs`
- Modify: `design-qa.md`

**Interfaces:**
- Closed chrome renders one 36px title-bar row at local `{ x: 0, y: 0 }`; mode menus begin below that row inside the temporarily expanded view.
- The Electron fixture reports native bounds for Harness, Chat, and chrome and exposes a clickable Chat sidebar control at the official page's original content origin.
- Screenshot composition overlays the transparent chrome image at its native bounds without fabricating a full-width header.

- [x] **Step 1: Write failing Electron assertions for the new behavior.** Require the full labels at minimum width, assert the menu stays hidden until expanded bounds are acknowledged, select each mode with a real pointer click, and prove the Chat sidebar control receives a click while chrome is closed.

```text
await chrome.locator('#mode-selector').click()
await waitForChromeWidth(chrome, 264)
await chrome.locator('#mode-menu').waitFor()
await chrome.locator('[data-mode="chat"]').click()
await expect.poll(() => fixtureState(application)).toMatchObject({
  snapshot: { selected: 'chat' },
})
```

- [x] **Step 2: Run the red Electron scenario.**

Run: `pnpm --filter @deepseek-ai/dsh-desktop run build && pnpm exec vitest run apps/desktop/tests/dual-mode.electron.spec.ts`

Expected: FAIL on old y-position, old height, compact labels, or menu visibility ordering.

- [x] **Step 3: Restyle the closed title-bar control.** Use 14px title-bar typography, stable full labels, transparent resting/expanded button paint, no border, and a text-colored CSS chevron. Keep `pointer-events: auto` and `-webkit-app-region: no-drag` only on actual controls. Position menus below the 36px control row and keep their opaque light/dark surfaces.

- [x] **Step 4: Update fixture geometry and screenshots.** Compose Harness at full bounds, Chat at `y=44`, and chrome at its tight native rectangle. Capture Harness and Chat in light/dark states plus a menu-open state at desktop and minimum widths. Record observations in `design-qa.md`, including title-bar alignment, absence of a second horizontal row, readable theme foregrounds, and unobstructed product controls.

- [x] **Step 5: Run the green Electron scenario and inspect images.**

Run: `DSH_DESKTOP_SCREENSHOT_DIR=apps/desktop/output/playwright/desktop-titlebar-mode pnpm exec vitest run apps/desktop/tests/dual-mode.electron.spec.ts`

Expected: PASS. Every screenshot shows the selector in the native title bar, Chat beginning immediately below the 44px row, Harness retaining its original layout, and no persistent overlay above page controls.

### Task 4: Synchronize contracts, verify, and rebuild both platforms

**Files:**
- Modify: `apps/desktop/README.md`
- Modify: `apps/desktop/README.zh.md`
- Modify: `apps/desktop/README.i18n.yaml`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.zh.md`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.i18n.yaml`
- Verify: `docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md`
- Verify: `docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.zh.md`

**Interfaces:**
- The desktop README owns current user-visible desktop behavior and platform limitations.
- The existing implemented Agent Note remains the rationale owner for local chrome, remote-page isolation, and retained view lifecycles.
- Portable artifact names remain `DeepSeek-Harness-macOS-arm64.zip` and `DeepSeek-Harness-Windows-x64.zip`.

- [x] **Step 1: Update current-state documentation in both languages.** Replace the 98px/58px local-header description with the 44px operating-system title bar, tight title-bar chrome bounds, acknowledged menu expansion, full Harness bounds, and Chat's single title-bar inset. Re-record only the changed bilingual pairs.

- [x] **Step 2: Run focused source verification.**

```text
pnpm exec vitest run apps/desktop/tests/*.spec.ts
pnpm --filter @deepseek-ai/dsh-desktop run typecheck
pnpm exec oxlint apps/desktop/src apps/desktop/tests
```

Expected: all desktop tests and both desktop TypeScript programs pass; Oxlint reports no errors.

- [x] **Step 3: Run documentation verification.**

```text
pnpm run verify-translation-pairing apps/desktop/README.md .agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md docs/superpowers/plans/2026-08-16-desktop-titlebar-mode-switcher.md
pnpm run verify-md-wrap
pnpm run verify-md-links
pnpm run verify-agent-note-format
```

Expected: named pairs and Markdown checks pass. Report corpus-wide failures caused by the missing `.git` directory or unrelated existing pairs without modifying them.

- [x] **Step 4: Build the product paths used for packaging.**

```text
pnpm exec tsc -p packages/client/ui-theme/tsconfig.json
pnpm exec tsdown --env.DSH_BUILD_FACE client
pnpm run build:web
pnpm run build:desktop
```

Expected: each command exits 0. The known aggregate client-test React type split remains outside this change.

- [x] **Step 5: Rebuild macOS arm64 and Windows x64 portable ZIPs.** Stage each platform runtime immediately before its Electron Builder invocation, replace only the two named ZIPs, and preserve the unpacked directories for inspection.

```text
node --import tsx apps/desktop/scripts/stage-runtime.ts --os=darwin --cpu=arm64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --mac dir --arm64 --config.mac.identity=null --config.mac.notarize=false
ditto -c -k --sequesterRsrc --keepParent apps/desktop/dist/mac-arm64 apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip

node --import tsx apps/desktop/scripts/stage-runtime.ts --os=win32 --cpu=x64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --win dir --x64 --config.electronDist=/Users/zo/Library/Caches/electron/63857c95525ff62c967a319a9c3921773c3420b77c6ebce7f47c8c76e68d9e11/electron-v43.4.0-win32-x64.zip
zip -qr dist/DeepSeek-Harness-Windows-x64.zip dist/win-unpacked
```

- [x] **Step 6: Verify final artifact evidence.** Run `file` on both executables, `unzip -tq` on both ZIPs, locate all four preloads in both unpacked applications, and record byte sizes plus SHA-256 hashes.

## Self-review

- Spec coverage: Tasks 1–3 cover title-bar placement, no second row, unobstructed content, stable styling, acknowledged clicks, keyboard behavior, themes, and real screenshots; Task 4 covers current documentation and both requested artifacts.
- Placeholder scan: the plan contains no deferred implementation or unnamed error handling; every production change follows a named failing test and exact verification command.
- Type consistency: `DesktopChromeSurface`, `DesktopChromeLayout.surface`, `DESKTOP_TITLEBAR_HEIGHT`, `desktopChromeBounds`, and the two portable ZIP names remain identical across tasks.
