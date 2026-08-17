# Desktop mode chrome theme integration Implementation Plan

English | [中文](2026-08-15-desktop-mode-chrome-theme.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline in the current session; do not dispatch subagents.

**Goal:** Make the sidebar mode selector composite transparently over the active page and render dark controls on light content or light controls on dark content.

**Architecture:** Set the local mode-chrome WebContentsView's native background to transparent and keep its document transparent. Resolve Harness colors from its existing `meta[name="theme-color"]` event, resolve Chat from the operating-system scheme, and send one validated light/dark value to the local preload. Render the DeepSeek template bitmap as a CSS mask so the mark uses the same foreground color as the label and chevron.

**Tech Stack:** Electron 43 `WebContentsView`, `nativeTheme`, closed main/preload IPC, static HTML/CSS, TypeScript, Vitest, Playwright Electron tests, and Electron Builder.

## Global Constraints

- The closed selector has no persistent backing fill; the active content view supplies every visible pixel behind it.
- A light theme uses a dark foreground, and a dark theme uses a light foreground for the mark, label, chevron, overflow control, and focus indicator.
- Harness follows its resolved product theme through its existing theme-color metadata; Chat follows the operating-system scheme because Desktop must not read its DOM, storage, styles, or pixels.
- Missing or invalid Harness theme colors fall back to the operating-system scheme until a valid color arrives.
- No remote preload, DOM injection, screenshot sampling, private Chat API, or new runtime dependency is allowed.
- Menus and dialogs remain opaque themed surfaces; hover and focus feedback remains transient.
- macOS arm64 and Windows x64 ZIP artifacts must be rebuilt after focused tests, typecheck, build, lint, documentation checks, and Electron visual verification pass.
- This checkout has no `.git` directory, so verification checkpoints replace commit steps.

---

### Task 1: Define deterministic desktop theme resolution

**Files:**
- Create: `apps/desktop/src/desktop-theme.ts`
- Create: `apps/desktop/tests/desktop-theme.spec.ts`
- Modify: `apps/desktop/src/shell-protocol.ts`
- Modify: `apps/desktop/tests/shell-protocol.spec.ts`

**Interfaces:**
- Produces: `DesktopColorScheme = 'light' | 'dark'`.
- Produces: `schemeForThemeColor(color: string | null): DesktopColorScheme | undefined`.
- Produces: `DesktopSystemTheme` with `getColorScheme()` and `subscribe(listener)`.
- Produces: `DESKTOP_SHELL_CHANNELS.chromeTheme = 'dsh-desktop:chrome-theme'`.

- [ ] **Step 1: Write failing unit tests for parsing, contrast, and the new channel.**

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

- [ ] **Step 2: Run the focused tests and confirm the missing module/channel failure.**

Run: `pnpm exec vitest run apps/desktop/tests/desktop-theme.spec.ts apps/desktop/tests/shell-protocol.spec.ts`

Expected: FAIL because `desktop-theme.ts` and `chromeTheme` do not exist.

- [ ] **Step 3: Implement the exact theme types and WCAG contrast choice.**

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

- [ ] **Step 4: Add the closed theme channel to `DESKTOP_SHELL_CHANNELS`.**

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

- [ ] **Step 5: Run the focused tests.**

Run: `pnpm exec vitest run apps/desktop/tests/desktop-theme.spec.ts apps/desktop/tests/shell-protocol.spec.ts`

Expected: PASS.

### Task 2: Connect native transparency and live theme sources

**Files:**
- Modify: `apps/desktop/src/harness-surface.ts`
- Modify: `apps/desktop/src/desktop-application.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/tests/harness-surface.spec.ts`
- Modify: `apps/desktop/tests/main-composition.spec.ts`

**Interfaces:**
- `HarnessSurfaceOptions` and `DesktopHarnessSurfaceFactoryOptions` consume `onThemeColor(color: string | null): void`.
- `DesktopApplicationOptions` consumes `systemTheme: DesktopSystemTheme`.
- The application sends one `DesktopColorScheme` on `DESKTOP_SHELL_CHANNELS.chromeTheme` after chrome load, selected-mode changes, Harness theme changes, and operating-system theme changes.

- [ ] **Step 1: Extend fakes and write failing lifecycle assertions.** Add `setBackgroundColor` to the fake chrome view, emit `did-change-theme-color` from the Harness fake, and provide a system-theme fake whose listener can be triggered.

```text
expect(chrome.value.setBackgroundColor).toHaveBeenCalledWith('#00000000')
contents.emit('did-change-theme-color', {}, '#f5f7f8')
expect(onThemeColor).toHaveBeenCalledWith('#f5f7f8')
expect(chrome.contents.send).toHaveBeenCalledWith(DESKTOP_SHELL_CHANNELS.chromeTheme, 'light')
```

- [ ] **Step 2: Run the focused tests and confirm they fail before wiring exists.**

Run: `pnpm exec vitest run apps/desktop/tests/harness-surface.spec.ts apps/desktop/tests/main-composition.spec.ts`

Expected: FAIL on the missing callback, system-theme option, transparent native background, and theme IPC.

- [ ] **Step 3: Forward Harness theme-color events and dispose the listener.**

```text
const onThemeColor = (_event: Event, color: string | null): void => {
  options.onThemeColor(color)
}
contents.on('did-change-theme-color', onThemeColor)
listenerDisposers.push(() => { contents.off('did-change-theme-color', onThemeColor) })
```

- [ ] **Step 4: Maintain selected theme state in the desktop application.** Keep `systemScheme` and `harnessScheme`, fall back to the system only when Harness has no valid color, and send only to the local chrome view.

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

- [ ] **Step 5: Make the native chrome transparent before loading it and subscribe to system changes for the window lifecycle.**

```text
chromeView = options.createView({ webPreferences: chromeWebPreferences })
chromeView.setBackgroundColor('#00000000')
const stopSystemTheme = options.systemTheme.subscribe(() => {
  systemScheme = options.systemTheme.getColorScheme()
  sendChromeTheme()
})
windowListenerDisposers.push(stopSystemTheme)
```

- [ ] **Step 6: Adapt Electron `nativeTheme` in production.**

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

- [ ] **Step 7: Run the focused lifecycle tests.**

Run: `pnpm exec vitest run apps/desktop/tests/harness-surface.spec.ts apps/desktop/tests/main-composition.spec.ts`

Expected: PASS, including listener disposal, invalid-color fallback, selected-mode restoration, and transparent native composition.

### Task 3: Render theme-aware controls and verify them in Electron

**Files:**
- Modify: `apps/desktop/resources/mode-chrome.html`
- Modify: `apps/desktop/resources/mode-chrome.css`
- Modify: `apps/desktop/src/mode-chrome-preload.ts`
- Modify: `apps/desktop/tests/fixtures/dual-mode-app/main.mjs`
- Modify: `apps/desktop/tests/dual-mode.electron.spec.ts`

**Interfaces:**
- The preload validates `DesktopColorScheme` values and writes only `document.documentElement.dataset.theme`.
- `.mode-mark` consumes `trayTemplate.png` as a mask and uses `currentColor`.
- The fixture exposes deterministic Harness and operating-system theme switches without contacting DeepSeek Chat.

- [ ] **Step 1: Add failing Electron assertions for light Harness, dark Harness, and system-themed Chat.**

```text
await setFixtureTheme(application, 'harness', 'light')
await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
await setFixtureTheme(application, 'harness', 'dark')
await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
await selectMode(chrome, 'chat')
await setFixtureTheme(application, 'system', 'dark')
await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
```

- [ ] **Step 2: Run the Electron test and confirm the fixture API and theme rendering are absent.**

Run: `pnpm --filter @deepseek-ai/dsh-desktop run build && pnpm --filter @deepseek-ai/dsh-desktop run test:electron`

Expected: FAIL because the fixture cannot change themes and the chrome preload does not consume `chromeTheme`.

- [ ] **Step 3: Replace the directly rendered black bitmap with a mask element.**

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

- [ ] **Step 4: Move dark variables from an unconditional media query to explicit theme selectors with a media fallback only before IPC arrives.** Keep `html`, `body`, and `#mode-chrome-root` transparent and keep the closed selector background transparent.

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

- [ ] **Step 5: Validate and apply theme IPC in the local preload.**

```text
ipcRenderer.on(DESKTOP_SHELL_CHANNELS.chromeTheme, (_event, value: unknown) => {
  if (!isDesktopColorScheme(value)) return
  document.documentElement.dataset.theme = value
})
```

- [ ] **Step 6: Extend the local fixture.** Give the Harness page a mutable `meta[name="theme-color"]`, forward its Electron event through `options.onThemeColor`, and expose `setTheme(target, scheme)` for `harness` and `system`; restore `nativeTheme.themeSource = 'system'` during shutdown.

- [ ] **Step 7: Update icon locators and run the real Electron scenario.**

Run: `pnpm --filter @deepseek-ai/dsh-desktop run build && pnpm --filter @deepseek-ai/dsh-desktop run test:electron`

Expected: PASS with `.mode-mark` visible, light/dark data attributes switching, retained mode state, menu behavior, and Chat partition clearing.

- [ ] **Step 8: Capture and inspect real window screenshots.** Capture expanded Harness light, expanded Harness dark, Chat dark, and collapsed light states through Playwright; verify the title area pixels match the underlying fixture page, the mark and label remain visible, and controls do not overlap traffic lights or sidebar content.

### Task 4: Update records, run gates, and rebuild both platform artifacts

**Files:**
- Modify: `apps/desktop/README.md`
- Modify: `apps/desktop/README.zh.md`
- Modify: `apps/desktop/README.i18n.yaml`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.zh.md`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.i18n.yaml`
- Verify: `docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md`
- Produce: `apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip`
- Produce: `apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip`

**Interfaces:**
- The desktop README states the user-visible theme behavior and Chat fallback without promising private-page theme detection.
- The existing Agent Note remains the single owner of desktop mode composition, transparent chrome, DOM isolation, and deterministic verification.
- The two ZIP names remain stable for user testing.

- [ ] **Step 1: Update the bilingual README and Agent Note.** Record native transparent composition, Harness `theme-color` observation, Chat system fallback, CSS-mask coloring, and the negative guarantee against Chat DOM/style/pixel inspection. Re-record each sidecar with the exact new blob hashes.

- [ ] **Step 2: Run focused unit, composition, and Electron tests.**

Run: `pnpm exec vitest run apps/desktop/tests`

Expected: every desktop test file passes.

- [ ] **Step 3: Run desktop typecheck, build, and Oxlint.**

Run: `pnpm --filter @deepseek-ai/dsh-desktop run typecheck`

Run: `pnpm --filter @deepseek-ai/dsh-desktop run build`

Run: `pnpm exec tsx scripts/run-oxlint.ts apps/desktop/src apps/desktop/tests apps/desktop/tests/fixtures/dual-mode-app/main.mjs`

Expected: all three commands exit 0.

- [ ] **Step 4: Run scoped documentation checks, then attempt the repository doc gate.**

Run: `pnpm run verify-translation-pairing apps/desktop/README.md .agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md docs/superpowers/plans/2026-08-15-desktop-mode-chrome-theme.md`

Run: `pnpm run verify-md-wrap`

Run: `pnpm run verify-md-links`

Run: `pnpm run verify-agent-note-format`

Run: `pnpm run doc-sync`

Expected: scoped checks pass. If `doc-sync` requires missing Git metadata, report that environmental failure without weakening any document rule.

- [ ] **Step 5: Stage and package macOS arm64.**

```sh
node --import tsx apps/desktop/scripts/stage-runtime.ts --os=darwin --cpu=arm64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --mac dir --arm64 --config.mac.identity=null --config.mac.notarize=false
ditto -c -k --sequesterRsrc --keepParent apps/desktop/dist/mac-arm64 apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip
```

- [ ] **Step 6: Launch the packaged macOS application and verify startup.** Use an isolated user-data directory, wait for Harness and the mode selector, capture one packaged screenshot, then quit cleanly. Confirm the executable with `file`.

- [ ] **Step 7: Stage and package Windows x64.**

```sh
node --import tsx apps/desktop/scripts/stage-runtime.ts --os=win32 --cpu=x64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --win dir --x64
(cd apps/desktop && zip -qr -FS dist/DeepSeek-Harness-Windows-x64.zip dist/win-unpacked)
```

- [ ] **Step 8: Verify both artifacts.**

```sh
file "apps/desktop/dist/mac-arm64/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"
file "apps/desktop/dist/win-unpacked/DeepSeek Harness.exe"
unzip -tq apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip
unzip -tq apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip
```

Expected: Mach-O arm64, PE32+ x86-64, and both ZIP tests report no errors.

## Self-review checklist

- Spec coverage: native transparency, actual Harness theme, system Chat fallback, invalid-color fallback, current-color icon rendering, opaque menus, visual verification, and both artifacts each map to a task.
- Placeholder scan: no deferred implementation marker or unspecified test instruction remains.
- Type consistency: `DesktopColorScheme`, `DesktopSystemTheme`, `schemeForThemeColor`, `onThemeColor`, and `chromeTheme` use one spelling and direction throughout.
- Security consistency: no task reads or modifies DeepSeek Chat DOM, storage, styles, network traffic, or pixels.
- Execution choice: the user's earlier mainline-only instruction selects inline execution; subagents are excluded.
