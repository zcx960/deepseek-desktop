# Desktop bidirectional theme and Chat header Implementation Plan

English | [中文](2026-08-16-desktop-bidirectional-theme-and-chat-header.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline in the current session; do not dispatch subagents.

**Goal:** Synchronize light, dark, and system theme preferences between Harness and official DeepSeek Chat while making the official Chat sidebar controls clickable and reducing the mode selector to text plus a chevron.

**Architecture:** A framework-neutral desktop theme coordinator accepts changes only from the active mode and applies them to the hidden mode. Harness connects through its owned `ThemeRuntime`; an isolated Chat preload adapts the official versioned theme storage without exposing Electron to the remote page. Chat reserves an unpainted header, and the native mode chrome shrinks to its actual controls.

**Tech Stack:** Electron 43 `WebContentsView`, sandboxed CommonJS preloads, Cordis client plugins, TypeScript 6, Vitest, Playwright Electron tests, static HTML/CSS, and Electron Builder.

## Global Constraints

- Synchronize exactly `light`, `dark`, and `system`; the active mode is authoritative and hidden-mode reports are acknowledgements.
- Harness theme writes go through `ThemeRuntime.setTheme()` and the Host-backed settings scope.
- Chat adaptation reads or writes only `__appKit_@deepseek/chat_themePreference` with `{ value, __version: "0" }` and observes only theme body markers.
- The Chat preload exposes no `contextBridge` object, generic IPC, filesystem API, credential, account, draft, conversation, token, or message data to the remote page.
- An unknown Chat storage version or missing marker disables synchronization for that renderer without failing Chat.
- The closed selector has no mark, border, background, or open-state fill; it renders full text when expanded and `DSH` or `Chat` plus a chevron when compact.
- Official Chat content begins below the local header. The header has no painted full-width toolbar, and closed native chrome bounds do not cover official controls.
- Existing Chat partition, navigation, authentication, data clearing, retained state, and failure isolation remain unchanged.
- No new runtime dependency is added. Every registration and listener is disposed with its owner.
- The checkout has no `.git`; do not create commits. Record checkpoints through tests and exact artifact hashes.

---

### Task 1: Define the shared theme protocol and coordinator

**Files:**
- Create: `apps/desktop/src/desktop-theme-sync.ts`
- Create: `apps/desktop/tests/desktop-theme-sync.spec.ts`
- Modify: `apps/desktop/src/desktop-theme.ts`
- Modify: `apps/desktop/src/desktop-mode.ts`

**Interfaces:**
- Produces: `DesktopThemePreference = 'light' | 'dark' | 'system'`.
- Produces: `DesktopThemeState = { preference: DesktopThemePreference; scheme: DesktopColorScheme }`.
- Produces: `DesktopThemedSurface extends DesktopSurface` with `setThemePreference(preference): void`.
- Produces: `createDesktopThemeCoordinator(options): DesktopThemeCoordinator` with `report`, `connect`, `select`, `systemChanged`, and `snapshot`.

- [ ] **Step 1: Write failing coordinator tests.** Cover initial selected-mode authority, ignored hidden reports, all three preferences, target connection after an authoritative report, selection handoff, system updates only under `system`, idempotent snapshots, and disposer ownership.

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

- [ ] **Step 2: Run the test and confirm the module is missing.**

Run: `pnpm exec vitest run apps/desktop/tests/desktop-theme-sync.spec.ts`

Expected: FAIL because `desktop-theme-sync.ts` does not exist.

- [ ] **Step 3: Implement the validated protocol and coordinator.** Use one authoritative flag and one target callback per mode. `connect()` immediately applies an authoritative preference, `report()` accepts only the selected mode, and `systemChanged()` changes only the resolved scheme while the preference is `system`.

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

The coordinator must reapply the current preference when a hidden report disagrees, publish detached snapshots, and make every returned disconnect idempotent.

- [ ] **Step 4: Add the themed-surface contract.**

```text
export interface DesktopThemedSurface extends DesktopSurface {
  /** Apply one shared preference without transferring ownership. */
  setThemePreference: (preference: DesktopThemePreference) => void
}
```

- [ ] **Step 5: Run the focused tests.**

Run: `pnpm exec vitest run apps/desktop/tests/desktop-theme-sync.spec.ts apps/desktop/tests/desktop-theme.spec.ts`

Expected: PASS.

### Task 2: Add the owned Harness theme bridge

**Files:**
- Create: `apps/desktop/src/harness-theme-preload.ts`
- Create: `packages/client/ui-theme/src/client/desktop-theme-bridge.ts`
- Create: `packages/client/ui-theme/tests/desktop-theme-bridge.client.spec.ts`
- Modify: `apps/desktop/src/harness-surface.ts`
- Modify: `apps/desktop/tests/harness-surface.spec.ts`
- Modify: `packages/client/ui-theme/src/client/index.ts`

**Interfaces:**
- Consumes: `DesktopThemePreference`, `DesktopThemeState`, and their validators from Task 1.
- Produces: a closed `window.dshDesktopTheme` API with `publish(state)` and `subscribe(listener)` only in the desktop Harness renderer.
- Produces: `createHarnessSurface()` returning `DesktopThemedSurface` and reporting validated state through `onThemeState`.

- [ ] **Step 1: Write failing Harness surface tests.** Require the dedicated preload path, `dsh-desktop-embedded=1`, sender-checked IPC reports, outbound preference IPC, invalid-payload rejection, and listener disposal.

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

- [ ] **Step 2: Write failing client bridge tests.** Mount an embedded desktop marker and a fake bridge, prove the initial `ThemeRuntime` snapshot is published, incoming preferences call `setTheme`, ordinary Web mode does nothing, and disposal unsubscribes both directions.

- [ ] **Step 3: Run the focused failures.**

Run: `pnpm exec vitest run apps/desktop/tests/harness-surface.spec.ts packages/client/ui-theme/tests/desktop-theme-bridge.client.spec.ts`

Expected: FAIL on the missing preload, bridge module, and themed surface methods.

- [ ] **Step 4: Implement the sandboxed Harness preload.** Expose only this API and validate incoming listener functions inside the preload.

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

- [ ] **Step 5: Bind the bridge beside `ThemeRuntime`.** The binder checks `data-dsh-desktop-embedded="true"`, publishes `{ preference, scheme: active.colorScheme }`, validates incoming preferences with `isThemePreference`, and uses `ctx.effect()` plus `ctx.on('theme/change', ...)` for disposal.

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

- [ ] **Step 6: Wire Harness IPC ownership.** `createHarnessSurface()` checks `event.sender === contents`, returns `setThemePreference()`, removes IPC listeners before closing the view, and keeps `did-change-theme-color` as compositing fallback only.

- [ ] **Step 7: Run the Harness and client tests.**

Run: `pnpm exec vitest run apps/desktop/tests/harness-surface.spec.ts packages/client/ui-theme/tests/desktop-theme-bridge.client.spec.ts packages/client/ui-theme/tests/theme.client.spec.ts`

Expected: PASS.

### Task 3: Add the isolated Chat theme adapter

**Files:**
- Create: `apps/desktop/src/chat-theme-adapter.ts`
- Create: `apps/desktop/src/chat-theme-preload.ts`
- Create: `apps/desktop/tests/chat-theme-adapter.spec.ts`
- Modify: `apps/desktop/src/chat-surface.ts`
- Modify: `apps/desktop/tests/chat-surface.spec.ts`

**Interfaces:**
- Consumes: Task 1 theme types and `DESKTOP_THEME_CHANNELS`.
- Produces: `parseChatThemeStorage(raw)`, `serializeChatThemeStorage(preference)`, and `schemeFromChatBody(body)`.
- Produces: a Chat `DesktopThemedSurface` whose preload reports theme state but exposes no main-world API.

- [ ] **Step 1: Write failing pure adapter tests.** Pin the exact key, version `"0"`, three accepted values, malformed JSON, extra or missing fields, unknown versions, contradictory body markers, and light/dark resolution.

```text
expect(parseChatThemeStorage('{"value":"dark","__version":"0"}')).toBe('dark')
expect(parseChatThemeStorage('{"value":"dark","__version":"1"}')).toBeUndefined()
expect(serializeChatThemeStorage('system'))
  .toBe('{"value":"system","__version":"0"}')
expect(schemeFromChatBody({ classList: new Set(['dark']), darkAttribute: 'dark' })).toBe('dark')
```

- [ ] **Step 2: Extend Chat surface tests.** Require the preload only on the main Chat view, never authentication windows; validate sender ownership; prove `setThemePreference()` sends only one closed message; and prove adapter diagnostics do not call `onFailure`.

- [ ] **Step 3: Run the focused failures.**

Run: `pnpm exec vitest run apps/desktop/tests/chat-theme-adapter.spec.ts apps/desktop/tests/chat-surface.spec.ts`

Expected: FAIL because the adapter, preload option, and themed surface methods do not exist.

- [ ] **Step 4: Implement the pure versioned adapter.** Reject unknown versions and ambiguous body state. Serialization always writes keys in `value`, `__version` order for deterministic tests.

- [ ] **Step 5: Implement the isolated Chat preload.** On DOM readiness, observe only `body.class`, `body[data-ds-dark-theme]`, and the exact theme storage entry. Report a validated state when storage and body agree. On an incoming different preference, update storage and call `location.reload()`; on the same preference, report without reloading. Send one adapter diagnostic per document and never call `contextBridge.exposeInMainWorld()`.

```text
function reportTheme(): void {
  const preference = parseChatThemeStorage(localStorage.getItem(CHAT_THEME_STORAGE_KEY))
  const scheme = schemeFromChatDocument(document)
  if (preference === undefined || scheme === undefined) return
  ipcRenderer.send(DESKTOP_THEME_CHANNELS.report, { preference, scheme })
}
```

- [ ] **Step 6: Wire Chat surface IPC.** Split main-view and authentication-window web preferences, check sender identity, contain adapter diagnostics through `reportError`, and dispose all IPC listeners with the view.

- [ ] **Step 7: Run Chat tests.**

Run: `pnpm exec vitest run apps/desktop/tests/chat-theme-adapter.spec.ts apps/desktop/tests/chat-surface.spec.ts`

Expected: PASS, including the existing permission, navigation, authentication, disposal, and clear-partition tests.

### Task 4: Compose active-mode synchronization and package the preloads

**Files:**
- Modify: `apps/desktop/src/desktop-application.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/shell-protocol.ts`
- Modify: `apps/desktop/src/desktop-mode.ts`
- Modify: `apps/desktop/tests/main-composition.spec.ts`
- Modify: `apps/desktop/tests/shell-protocol.spec.ts`
- Modify: `apps/desktop/tsdown.config.ts`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/tests/packaging-config.spec.ts`
- Modify: `apps/desktop/tests/verify-packaged-runtime.spec.ts`

**Interfaces:**
- Consumes: themed surfaces and coordinator from Tasks 1-3.
- Produces: two packaged preload paths and active-mode synchronization in the composition root.
- `DesktopHarnessSurfaceFactoryOptions` and `DesktopChatSurfaceFactoryOptions` report state and return `DesktopThemedSurface`.

- [ ] **Step 1: Replace the old composition theme test with failing bidirectional cases.** Prove selected Harness drives Chat, selected Chat drives Harness, hidden disagreement is corrected, `system` follows `DesktopSystemTheme`, switching applies before visibility, and adapter diagnostics do not fail either mode.

- [ ] **Step 2: Add failing packaging assertions.** Require `lib/harness-theme-preload.cjs` and `lib/chat-theme-preload.cjs` in `asarUnpack`, packaged runtime checks, and both production path branches.

- [ ] **Step 3: Run the focused failures.**

Run: `pnpm exec vitest run apps/desktop/tests/main-composition.spec.ts apps/desktop/tests/packaging-config.spec.ts apps/desktop/tests/verify-packaged-runtime.spec.ts`

Expected: FAIL on missing coordinator wiring and preload artifacts.

- [ ] **Step 4: Compose the coordinator.** Create it after loading the initial mode, call `select(snapshot.selected)` before sending chrome state, connect each themed surface with an idempotent disposer, and use its resolved scheme for `chromeTheme`. The existing Harness theme-color result is only a fallback until an authoritative bridge report arrives.

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

- [ ] **Step 5: Add production preload paths and bundles.** Add both entries to `tsdown.config.ts`, both paths to `shellPaths()`, both unpack rules to `package.json`, and exact packaged-file tests.

- [ ] **Step 6: Run composition and packaging tests.**

Run: `pnpm exec vitest run apps/desktop/tests/main-composition.spec.ts apps/desktop/tests/shell-protocol.spec.ts apps/desktop/tests/packaging-config.spec.ts apps/desktop/tests/verify-packaged-runtime.spec.ts`

Expected: PASS.

### Task 5: Reserve the Chat header and reduce native chrome to its controls

**Files:**
- Create: `apps/desktop/src/desktop-chrome-layout.ts`
- Create: `apps/desktop/tests/desktop-chrome-layout.spec.ts`
- Modify: `apps/desktop/src/desktop-application.ts`
- Modify: `apps/desktop/resources/mode-chrome.html`
- Modify: `apps/desktop/resources/mode-chrome.css`
- Modify: `apps/desktop/src/mode-chrome-preload.ts`
- Modify: `apps/desktop/resources/shell.html`
- Modify: `apps/desktop/resources/shell.css`
- Modify: `apps/desktop/tests/main-composition.spec.ts`

**Interfaces:**
- Produces: `desktopChromeBounds(input)` for closed, mode-menu, chat-menu, and dialog native rectangles.
- Produces: `insetDesktopContentBounds(bounds, top)` for Chat only.
- The mode preload writes `data-surface`, `data-compact`, and the full or abbreviated label.

- [ ] **Step 1: Write failing geometry tests.** Pin macOS and Windows selector origins, actual closed widths, a 48px closed height, menu expansion, full-window dialogs, non-negative Chat remaining height, and the invariant that closed chrome ends before Chat content begins.

```text
expect(desktopChromeBounds({
  platform: 'darwin', mode: 'chat', compact: false, surface: 'closed', content,
})).toEqual({ x: 27, y: 44, width: 198, height: 48 })
expect(insetDesktopContentBounds(content, 98)).toEqual({
  x: 0, y: 98, width: content.width, height: content.height - 98,
})
```

- [ ] **Step 2: Update composition tests to require Chat-only top inset.** Harness remains `{ x: 0, y: 0, width, height }`; Chat uses the header inset. Closed chrome no longer uses `{ x: 0, y: 0, width: 280, height: 98 }`.

- [ ] **Step 3: Run the geometry failures.**

Run: `pnpm exec vitest run apps/desktop/tests/desktop-chrome-layout.spec.ts apps/desktop/tests/main-composition.spec.ts`

Expected: FAIL on old full-header bounds and full-height Chat.

- [ ] **Step 4: Implement pure geometry and use it in composition.** Keep platform constants in one module. Apply the Chat inset through a themed-surface wrapper so the framework-neutral mode controller remains unchanged.

- [ ] **Step 5: Simplify the selector markup and CSS.** Remove `.mode-mark` and the Chat header pseudo-element. Make controls local to the native view origin. Use no border or fill at rest, hover, or open; keep only foreground change and `:focus-visible` outline. Compact labels are `DSH` and `Chat`, never an icon.

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

- [ ] **Step 6: Move drag ownership to the local shell.** Add a transparent header drag seat behind Chat; all selector, menu, dialog, and official page controls remain `no-drag` through their own renderers.

- [ ] **Step 7: Run focused geometry and composition tests.**

Run: `pnpm exec vitest run apps/desktop/tests/desktop-chrome-layout.spec.ts apps/desktop/tests/main-composition.spec.ts`

Expected: PASS.

### Task 6: Prove the behavior in Electron and visual QA

**Files:**
- Modify: `apps/desktop/tests/fixtures/dual-mode-app/main.mjs`
- Modify: `apps/desktop/tests/dual-mode.electron.spec.ts`
- Modify: `design-qa.md`
- Produce: `output/playwright/desktop-theme-sync/*.png`

**Interfaces:**
- The fixture records `preferences`, Chat reload count, visible bounds, official sidebar-control clicks, and themed-surface generations.
- Electron screenshots composite Chat content at its native top inset rather than assuming every content view starts at `y = 0`.

- [ ] **Step 1: Extend the fixture before production assertions pass.** Add a Chat top-left sidebar button, theme reports from both fixture surfaces, idempotent `setThemePreference`, hidden Chat reload accounting, and state fields for clicks and preferences.

- [ ] **Step 2: Write failing Electron scenarios.** Prove Harness dark -> Chat dark, Chat light -> Harness light, `system` follows nativeTheme, a hidden disagreement cannot win, Chat reloads only while hidden, and clear-data recreation adopts the shared preference.

- [ ] **Step 3: Add the click and selector assertions.** Verify the Chat control lies below the closed chrome rectangle, click it through the Chat page, and observe the fixture counter. Assert no `.mode-mark`, transparent border/background, text plus chevron in expanded and compact layouts, and menu expansion/restoration.

- [ ] **Step 4: Run the Electron test with screenshots.**

Run: `DSH_DESKTOP_SCREENSHOT_DIR=output/playwright/desktop-theme-sync pnpm --filter @deepseek-ai/dsh-desktop run test:electron`

Expected: PASS and produce Harness/Chat light/dark, expanded/compact, open/closed screenshots.

- [ ] **Step 5: Inspect every screenshot.** Confirm no horizontal painted toolbar, no overlap with traffic lights or official controls, official controls below the selector, readable light/dark foreground, stable menu geometry, and no blank or clipped content. Record viewport, scenario, and verdict in `design-qa.md`.

### Task 7: Update records, run relevant gates, and rebuild both platforms

**Files:**
- Modify: `apps/desktop/README.md`
- Modify: `apps/desktop/README.zh.md`
- Modify: `apps/desktop/README.i18n.yaml`
- Modify: `packages/client/ui-theme/README.md`
- Modify: `packages/client/ui-theme/README.zh.md`
- Modify: `packages/client/ui-theme/README.i18n.yaml`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.zh.md`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.i18n.yaml`
- Verify: `docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md`
- Produce: `apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip`
- Produce: `apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip`

**Interfaces:**
- Documentation states the active-mode authority rule, the private Chat adapter and failure behavior, the owned Harness bridge, the unpainted header, and the no-content-inspection guarantee.
- Artifact filenames remain stable for user testing.

- [ ] **Step 1: Update bilingual records and JSDoc contracts.** Describe current shipped behavior in present tense, update the existing Agent Note rather than creating a second owner, and record each confirmed pair hash. Update the approved spec only if implementation exposes a factual mismatch.

- [ ] **Step 2: Run focused tests.**

Run: `pnpm exec vitest run apps/desktop/tests packages/client/ui-theme/tests/desktop-theme-bridge.client.spec.ts packages/client/ui-theme/tests/theme.client.spec.ts`

Expected: PASS.

- [ ] **Step 3: Run typecheck, build, and lint on changed ownership areas.**

```sh
pnpm --filter @deepseek-ai/dsh-desktop run typecheck
pnpm exec tsc -p packages/client/ui-theme/tsconfig.json --noEmit
pnpm --filter @deepseek-ai/dsh-desktop run build
pnpm exec tsx scripts/run-oxlint.ts apps/desktop/src apps/desktop/tests packages/client/ui-theme/src packages/client/ui-theme/tests
```

Expected: every command exits 0.

- [ ] **Step 4: Run documentation checks.**

```sh
pnpm run verify-translation-pairing apps/desktop/README.md packages/client/ui-theme/README.md .agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md docs/superpowers/plans/2026-08-16-desktop-bidirectional-theme-and-chat-header.md
pnpm run verify-md-wrap
pnpm run verify-md-links
pnpm run verify-agent-note-format
pnpm run doc-sync
```

Expected: scoped checks pass. If `doc-sync` alone requires unavailable Git metadata, report that environmental failure without weakening document rules.

- [ ] **Step 5: Rebuild and archive macOS arm64.**

```sh
node --import tsx apps/desktop/scripts/stage-runtime.ts --os=darwin --cpu=arm64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --mac dir --arm64 --config.mac.identity=null --config.mac.notarize=false
ditto -c -k --sequesterRsrc --keepParent apps/desktop/dist/mac-arm64 apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip
```

- [ ] **Step 6: Launch the packaged macOS application.** Use an isolated user-data directory, verify Harness startup, switch to the Chat fixture or official page without modifying the user's live partition, capture a screenshot, and quit cleanly.

- [ ] **Step 7: Rebuild and archive Windows x64.**

```sh
node --import tsx apps/desktop/scripts/stage-runtime.ts --os=win32 --cpu=x64
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --win dir --x64 --config.electronDist=/Users/zo/Library/Caches/electron/63857c95525ff62c967a319a9c3921773c3420b77c6ebce7f47c8c76e68d9e11/electron-v43.4.0-win32-x64.zip
(cd apps/desktop && zip -qr -FS dist/DeepSeek-Harness-Windows-x64.zip dist/win-unpacked)
```

- [ ] **Step 8: Verify architecture, archive integrity, and required preloads.**

```sh
file "apps/desktop/dist/mac-arm64/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" "apps/desktop/dist/win-unpacked/DeepSeek Harness.exe"
unzip -tq apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip
unzip -tq apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip
find apps/desktop/dist/mac-arm64 apps/desktop/dist/win-unpacked -path '*harness-theme-preload.cjs' -o -path '*chat-theme-preload.cjs'
shasum -a 256 apps/desktop/dist/DeepSeek-Harness-macOS-arm64.zip apps/desktop/dist/DeepSeek-Harness-Windows-x64.zip
```

Expected: Mach-O arm64, PE32+ x86-64, both ZIP tests report no errors, both packages contain both preloads, and two SHA-256 hashes are printed.

## Self-review checklist

- Spec coverage: all three theme preferences, both synchronization directions, active-mode authority, hidden-only Chat reload, adapter failure isolation, header geometry, real official-control click, selector reduction, compact text, documentation, and both artifacts each map to a task.
- Placeholder scan: no deferred marker, unspecified validation, or generic “write tests” step remains.
- Type consistency: `DesktopThemePreference`, `DesktopThemeState`, `DesktopThemedSurface`, `DESKTOP_THEME_CHANNELS`, `setThemePreference`, and `onThemeState` keep one spelling and direction.
- Security consistency: Harness receives only a closed bridge; Chat receives no exposed bridge and reads only the exact theme storage entry plus body theme markers.
- Lifecycle consistency: every IPC, Cordis, DOM observer, and coordinator connection has an idempotent disposer; visible Chat is never reloaded by hidden state.
- Execution choice: the user's mainline-only instruction selects inline execution; subagents are excluded.
