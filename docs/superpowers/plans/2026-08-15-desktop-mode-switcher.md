# Desktop mode switcher Implementation Plan

English | [中文](2026-08-15-desktop-mode-switcher.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-width Chat/Harness mode bar with one accessible sidebar mode selector layered above both retained desktop content views.

**Architecture:** Keep the existing `BrowserWindow` as the local status and IPC shell. Give it a separate transparent `WebContentsView` whose native bounds are limited to the sidebar title/selector area and expand only for menus or the modal clear-data dialog. Keep Harness and Chat `WebContentsView` instances underneath it at full content bounds. The chrome view owns only presentation and closed IPC commands; `DesktopModeController` remains the sole owner of selection, persistence, view lifecycles, and failure state.

**Tech Stack:** Electron 43 `BrowserWindow`/`WebContentsView`, sandbox-compatible CommonJS preload bundles from `tsdown`, static HTML/CSS for local chrome, Vitest, Playwright Electron tests, and existing desktop packaging verification.

## Global Constraints

- The selector is located in the left sidebar header; no full-width mode-toolbar fill, border, or reserved mode-toolbar height remains.
- Chat remains the unmodified `https://chat.deepseek.com/` website; no DOM injection, scraping, private API calls, or remote preload is allowed.
- `DeepSeek Chat` and `Harness` keep separate credentials, storage, navigation, page state, and failure lifecycles.
- Expanded mode labels are `DeepSeek Chat` and `Harness`; collapsed mode entry is a DeepSeek icon.
- The menu uses `menu`/`menuitemradio`, `aria-checked`, focus restoration, arrow-key movement, `Enter`, `Space`, and `Escape` behavior.
- The native titlebar keeps a fixed `DESKTOP_TITLEBAR_HEIGHT` for platform window controls and dragging; this is not a mode-toolbar height and does not reserve a visible application bar.
- No new runtime dependency is added; use the existing Electron, TypeScript, CSS, and test stack.
- Packaging must include the new local chrome HTML/CSS and CommonJS preload on macOS and Windows.

---

### Task 1: Split the local shell and mode-chrome documents

**Files:**
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

**Interfaces:**
- `mode-chrome-preload.ts` consumes `DESKTOP_SHELL_CHANNELS.select`, `DESKTOP_SHELL_CHANNELS.command`, and `DESKTOP_SHELL_CHANNELS.snapshot`; it produces mode selection and closed shell-command messages only.
- `shell-preload.ts` consumes the same snapshot channel for status rendering and keeps retry, browser fallback, and failure presentation in the local shell document.
- `tsdown.config.ts` produces `lib/mode-chrome-preload.cjs` beside `lib/shell-preload.cjs`; both are sandbox-safe CommonJS files.

- [ ] **Step 1: Extend packaging assertions before implementation.** Add `mode-chrome.html`, `mode-chrome.css`, and `lib/mode-chrome-preload.cjs` to the required local asset list in `packaging-config.spec.ts`, and extend `shell-protocol.spec.ts` to cover the unchanged closed command and snapshot channels.

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

- [ ] **Step 2: Run the focused tests and record the expected failure.**

Run: `pnpm exec vitest run apps/desktop/tests/shell-protocol.spec.ts apps/desktop/tests/packaging-config.spec.ts`

Expected: FAIL because the new asset entries and protocol assertion are not implemented.

- [ ] **Step 3: Move mode controls out of `shell.html`.** Leave `shell.html` with the status region, retry, and browser fallback only. Create `mode-chrome.html` with a `#mode-chrome-root`, a `#mode-selector` button, `#mode-menu` containing two `menuitemradio` rows, `#chat-actions`, `#chat-menu`, and the Chat-data confirmation dialog.

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

The mode-chrome document CSP allows only its own stylesheet and `trayTemplate.png` image; it keeps scripts disabled because all behavior is supplied by the sandbox preload.

- [ ] **Step 4: Implement the two preload responsibilities.** `mode-chrome-preload.ts` reads the snapshot, updates the active label and `aria-checked`, sends mode/command messages, closes on outside click or `Escape`, moves the active row with arrow keys, confirms with `Enter`, and restores focus to `#mode-selector`. `shell-preload.ts` no longer queries mode buttons or Chat actions; it only renders status controls.

- [ ] **Step 5: Add the CJS entry and package rules.** Add `lib/types/mode-chrome-preload.js` to the CJS `tsdown` entry, add `lib/mode-chrome-preload.cjs` to `asarUnpack`, and keep both local documents under the existing `resources -> desktop-resources` copy rule.

- [ ] **Step 6: Run the focused tests to verify the document/protocol contract.**

Run: `pnpm exec vitest run apps/desktop/tests/shell-protocol.spec.ts apps/desktop/tests/packaging-config.spec.ts`

Expected: PASS with all tests in both files passing.

### Task 2: Add the transparent chrome view and full-content bounds

**Files:**
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/desktop-application.ts`
- Modify: `apps/desktop/tests/main-composition.spec.ts`
- Modify: `apps/desktop/tests/dual-mode.electron.spec.ts`

**Interfaces:**
- `DesktopApplicationOptions` gains `chromePath: string` and `chromePreloadPath: string`.
- `shellPaths()` returns `shellPath`, `preloadPath`, `chromePath`, and `chromePreloadPath` for source and packaged layouts.
- `contentBounds()` returns `{ x: 0, y: 0, width, height }`; the mode controller continues to receive one copied bounds object for each surface.
- The composition owns a `chromeView` outside the mode controller and removes/closes it during window disposal.

- [ ] **Step 1: Extend the composition fixture to model a fourth WebContentsView.** Add `loadFile`, `close`, and `setBounds` observations to `FakeViewContents`/`fakeView`, pass chrome paths through `applicationOptions`, and assert a view receives full bounds `{ x: 0, y: 0, width: 1200, height: 800 }`.

```text
await vi.waitFor(() => {
  expect(harness.value.setBounds).toHaveBeenCalledWith({
    x: 0, y: 0, width: 1200, height: 800,
  })
})
```

- [ ] **Step 2: Run the composition and Electron tests before implementation.**

Run: `pnpm exec vitest run apps/desktop/tests/main-composition.spec.ts apps/desktop/tests/dual-mode.electron.spec.ts`

Expected: FAIL because the existing composition still subtracts the mode-bar height and no chrome view exists.

- [ ] **Step 3: Resolve the four local paths in `main.ts`.** Packaged paths point to `desktop-resources/mode-chrome.html` and `app.asar.unpacked/lib/mode-chrome-preload.cjs`; source paths point to `apps/desktop/resources/mode-chrome.html` and `apps/desktop/lib/mode-chrome-preload.cjs`. Pass both paths into `createDesktopApplication`.

- [ ] **Step 4: Create and load the chrome view after the local shell loads.** Build it with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true`; add it to `window.contentView`; set bounds for the closed selector state; load the local chrome document; and keep it above later Chat/Harness views by removing and re-adding the chrome child after each content view is attached. A closed `chrome-surface` message expands the bounds for menus or the modal dialog.

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

- [ ] **Step 5: Keep the chrome layer local to its native bounds.** The mode-chrome root uses `pointer-events: none`; selector, overflow, menu, dialog, and drag-region elements explicitly opt into pointer handling. Main resizes the view on `chrome-surface` messages so WebContentsView hit testing cannot mask the rest of the content. `-webkit-app-region: drag` remains on the transparent titlebar strip and `no-drag` remains on every interactive element.

- [ ] **Step 6: Dispose and resize the chrome view with the window.** Resize it on the same `resize` listener as the mode surfaces. On `closed` and explicit disposal, remove it from `contentView`, close its `webContents` if needed, and clear the reference before the retained mode surfaces shut down.

- [ ] **Step 7: Run the focused composition tests after implementation.**

Run: `pnpm exec vitest run apps/desktop/tests/main-composition.spec.ts apps/desktop/tests/dual-mode.electron.spec.ts`

Expected: PASS with full bounds, chrome layering, mode switching, retained Chat state, independent failure handling, and cleanup covered.

### Task 3: Implement the sidebar visual system and interaction states

**Files:**
- Modify: `apps/desktop/resources/mode-chrome.css`
- Modify: `apps/desktop/resources/shell.css`
- Modify: `apps/desktop/resources/mode-chrome.html`
- Modify: `apps/desktop/src/mode-chrome-preload.ts`

**Interfaces:**
- The chrome document receives only the existing serialized snapshot and sends only the existing closed selection/command unions.
- CSS variables reuse the current shell surface, text, muted, accent, border, and danger tokens; no new design dependency or framework is introduced.

- [ ] **Step 1: Add the transparent local layer styles.** Keep the root transparent and click-through, position the expanded selector below the native titlebar inset at `left: 12px`, use the existing 12px sidebar radius, and constrain the menu to `min(300px, calc(100vw - 24px))` so the longest label remains inside its parent.

- [ ] **Step 2: Add expanded and collapsed geometry.** The expanded selector displays the 16px tray mark, label, and chevron. The collapsed state exposes a stable 36px icon hit target and places the menu immediately to its right. macOS and Windows titlebar insets follow the existing platform data attributes rather than hardcoded platform-specific DOM branches.

- [ ] **Step 3: Add interaction feedback and reduced-motion handling.** Use 160–200ms opacity/transform transitions for menu open/close and row hover/pressed states. Add visible `:focus-visible` outlines and disable transitions under `prefers-reduced-motion: reduce`.

- [ ] **Step 4: Keep status presentation independent.** Remove obsolete mode-bar spacing from `shell.css`; keep status content centered over the full available window and keep the existing failure actions available when the selected surface is not ready.

- [ ] **Step 5: Run the desktop typecheck and focused tests.**

Run: `pnpm --filter @deepseek-ai/dsh-desktop run typecheck` and `pnpm exec vitest run apps/desktop/tests/shell-protocol.spec.ts apps/desktop/tests/main-composition.spec.ts apps/desktop/tests/dual-mode.electron.spec.ts`

Expected: PASS. The repository's known React type-version conflict in unrelated client tests is outside this task and must not be changed as part of this UI work.

### Task 4: Update fixtures, packaging contracts, and decision records

**Files:**
- Modify: `apps/desktop/tests/dual-mode.electron.spec.ts`
- Modify: `apps/desktop/tests/verify-packaged-runtime.spec.ts`
- Modify: `apps/desktop/tests/packaging-config.spec.ts`
- Modify: `apps/desktop/scripts/verify-packaged-runtime.ts`
- Modify: `apps/desktop/README.md`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md`
- Modify: `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.zh.md`
- Modify: `docs/superpowers/specs/2026-08-15-desktop-mode-switcher-design.md` only if shipped paths or behavior differ from the approved design

**Interfaces:**
- Playwright Electron helpers discover the separate mode-chrome page among `application.windows()`/WebContents targets and use its locators for selector interactions; Chat content continues to be inspected through `webContents.getAllWebContents()`.
- `afterPack` requires both mode-chrome documents and both local preloads in the platform-specific Resources directory.
- The existing implemented Agent Note remains the owner of the two-mode decision and records the shipped sidebar chrome instead of a mode bar in both languages.

- [ ] **Step 1: Update the Electron fixture locators.** Add a helper that waits for the local `mode-chrome.html` target, then move mode selection, overflow, clear-data, and menu assertions to that page. Add cases for outside-click dismissal, `Escape`, arrow-key movement, collapsed icon placement, and unchanged retained Chat state.

- [ ] **Step 2: Extend packaged-runtime checks.** Add mode-chrome HTML/CSS and `mode-chrome-preload.cjs` to `REQUIRED_SHELL_FILES`, create both macOS and Windows fixture paths, and keep the missing-asset rejection test.

- [ ] **Step 3: Update the desktop README and existing bilingual Agent Note.** State that the local mode chrome is a transparent sidebar overlay above two retained `WebContentsView` children, that the content views use full bounds, and that the official Chat page remains untouched. Preserve the existing security, navigation, privacy, and lifecycle guarantees.

- [ ] **Step 4: Run the complete focused desktop verification.**

Run: `pnpm exec vitest run apps/desktop/tests`

Expected: all desktop test files pass, including the real Electron dual-mode scenario.

- [ ] **Step 5: Run source/build and documentation gates.**

Run: `pnpm --filter @deepseek-ai/dsh-desktop run build`, `pnpm exec oxlint apps/desktop/src apps/desktop/scripts`, `pnpm run verify-md-wrap`, `pnpm run verify-md-links`, `pnpm run verify-agent-note-format`, and `pnpm run verify-translation-pairing`.

Expected: each command exits 0. Do not claim the repository-wide aggregate build is clean if its unrelated React type-version conflict remains.

- [ ] **Step 6: Build and inspect both desktop artifacts.** Rebuild Web/Client outputs, stage the runtime for `darwin/arm64` and `win32/x64`, run Electron Builder directory targets, and verify each artifact contains the two local chrome documents, two local preloads, status shell assets, Harness Host entrypoint, and Web frontend. Confirm Mach-O arm64 and PE32+ x64 architecture with `file`, then run `unzip -tq` on the portable ZIPs.

This checkout has no Git metadata, so no commit step is performed; the plan and implementation files remain directly reviewable in the shared workspace.

## Self-review checklist

- Spec coverage: sidebar placement, collapsed entry, full-window layering, remote-DOM isolation, keyboard access, failure behavior, retained state, packaging, and visual verification each map to Tasks 1–4.
- Placeholder scan: every task names its files, interfaces, commands, and expected evidence.
- Type consistency: `chromePath`/`chromePreloadPath`, `mode-chrome.html`, `mode-chrome-preload.cjs`, `DESKTOP_TITLEBAR_HEIGHT`, and full `{ x, y, width, height }` bounds use the same names throughout.
