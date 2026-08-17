# DeepSeek Chat Desktop Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated, persistent DeepSeek Chat website mode beside the existing Harness mode in one Electron desktop window.

**Architecture:** A local BrowserWindow shell owns the mode bar while two main-process `WebContentsView` children own Harness and Chat. A framework-neutral controller coordinates selection, view state, recovery, clearing, and shutdown; Electron adapters own the loopback Host and the dedicated `persist:dsh-deepseek-chat` session.

**Tech Stack:** TypeScript 6, Electron 43 `WebContentsView`, Vitest 4, Playwright Electron automation, pnpm 11, existing `@deepseek-ai/dsh-atomic-write`, HTML/CSS shell resources.

## Global Constraints

- Node remains `^22.19.0 || >=24.0.0`; Electron remains `43.4.0`; do not add a browser-automation or credential dependency to production.
- Harness and Chat never share conversations, prompts, credentials, cookies, storage, navigation state, Session events, or telemetry content.
- Chat starts at the fixed URL `https://chat.deepseek.com/` and uses `persist:dsh-deepseek-chat`.
- Chat uses `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and no application preload.
- Trusted remote navigation uses exact HTTPS origins only; never accept a `*.deepseek.com` wildcard.
- Do not inject scripts into Chat, inspect its DOM, read its cookies or storage, call undocumented APIs, or bypass WAF and bot checks.
- CI uses local fixture servers only. Live DeepSeek compatibility is a macOS and Windows release-smoke responsibility.
- Every production registration, event listener, IPC handler, view, window, and Host process has one disposer.
- Keep changes outside `vendor/`. Update the Desktop README pair and the approved Agent Note pair with the implementation.
- The extracted workspace currently has no `.git`; run commit steps only in a real Git checkout and do not create replacement Git metadata.

## File Map

- `apps/desktop/src/desktop-mode.ts`: shared mode, phase, snapshot, bounds, surface, and controller interfaces.
- `apps/desktop/src/desktop-state.ts`: validated, atomically written last-mode state.
- `apps/desktop/src/chat-navigation.ts`: pure exact-origin URL classification and navigation decisions.
- `apps/desktop/src/desktop-mode-controller.ts`: framework-neutral state machine and operation ordering.
- `apps/desktop/src/shell-protocol.ts`: fixed IPC channels and command payloads shared by main and preload.
- `apps/desktop/src/shell-preload.ts`: local shell DOM binding and narrow IPC client.
- `apps/desktop/resources/shell.html` and `shell.css`: trusted mode bar, status, menu, and confirmation UI.
- `apps/desktop/src/chat-surface.ts`: dedicated session, Chat WebContents, auth window, navigation, crashes, and clearing.
- `apps/desktop/src/harness-surface.ts`: supervised Host plus loopback WebContents ownership and restart behavior.
- `apps/desktop/src/desktop-application.ts`: injectable native window, IPC/controller composition, tray, and independent startup.
- `apps/desktop/src/main.ts`: production paths and Electron application-event entrypoint only.
- `apps/web/src/desktop-marker.ts` plus client CSS: embedded-Harness marker that preserves native material without a second title-bar inset.
- `apps/desktop/tests/**`: unit, adapter, packaging, and Electron fixture coverage.
- `apps/desktop/README.md`, `README.zh.md`, and `README.i18n.yaml`: user and maintainer behavior.
- `.agents/notes/{proposed,implemented}/feature/2026-08-14-deepseek-chat-desktop-mode.*`: lifecycle move and shipped decision.

---

### Task 1: Mode Types and Atomic Desktop State

**Files:**
- Create: `apps/desktop/src/desktop-mode.ts`
- Create: `apps/desktop/src/desktop-state.ts`
- Create: `apps/desktop/tests/desktop-state.spec.ts`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Produces: `DesktopMode`, `DesktopModePhase`, `DesktopModeSnapshot`, `DesktopContentBounds`, `DesktopSurface`, `loadDesktopMode(filename)`, and `saveDesktopMode(filename, mode)`.
- Consumes: `writeFileAtomic(filename, content, { mode: 0o600, dirMode: 0o700 })` from `@deepseek-ai/dsh-atomic-write`.

- [ ] **Step 1: Write failing durable-state tests**

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadDesktopMode, saveDesktopMode } from '../src/desktop-state.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function stateFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-state-'))
  roots.push(root)
  return join(root, 'nested', 'desktop-state.json')
}

describe('desktop mode persistence', () => {
  it('defaults a missing file to Harness', async () => {
    await expect(loadDesktopMode(await stateFile())).resolves.toBe('harness')
  })

  it('round-trips a validated versioned mode with owner-only permissions', async () => {
    const filename = await stateFile()
    await saveDesktopMode(filename, 'chat')
    expect(await readFile(filename, 'utf8')).toBe('{"version":1,"mode":"chat"}\n')
    await expect(loadDesktopMode(filename)).resolves.toBe('chat')
  })

  it('rejects malformed or unknown durable state', async () => {
    const filename = await stateFile()
    await writeFile(filename, '{"version":2,"mode":"chat"}\n')
    await expect(loadDesktopMode(filename)).rejects.toThrow('desktop state is invalid')
  })
})
```

- [ ] **Step 2: Verify the tests fail before the modules exist**

Run: `pnpm exec vitest run apps/desktop/tests/desktop-state.spec.ts`

Expected: FAIL because `../src/desktop-state.ts` cannot be resolved.

- [ ] **Step 3: Add the shared types and minimal state implementation**

```ts
// apps/desktop/src/desktop-mode.ts
export type DesktopMode = 'chat' | 'harness'
export type DesktopModePhase = 'idle' | 'loading' | 'ready' | 'failed'

export interface DesktopModeStatus {
  readonly phase: DesktopModePhase
  readonly message?: string
}

export interface DesktopModeSnapshot {
  readonly selected: DesktopMode
  readonly chat: DesktopModeStatus
  readonly harness: DesktopModeStatus
  readonly pendingExternalUrl: boolean
}

export interface DesktopContentBounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export interface DesktopSurface {
  setBounds(bounds: DesktopContentBounds): void
  setVisible(visible: boolean): void
  reload(): void
  dispose(): Promise<void>
}
```

```ts
// apps/desktop/src/desktop-state.ts
import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { DesktopMode } from './desktop-mode.ts'

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

export async function loadDesktopMode(filename: string): Promise<DesktopMode> {
  let text: string
  try { text = await readFile(filename, 'utf8') } catch (error) {
    if (isMissing(error)) return 'harness'
    throw error
  }
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('desktop state is invalid') }
  if (typeof value !== 'object' || value === null || !('version' in value) || !('mode' in value)
    || value.version !== 1 || (value.mode !== 'chat' && value.mode !== 'harness')) {
    throw new Error('desktop state is invalid')
  }
  return value.mode
}

export async function saveDesktopMode(filename: string, mode: DesktopMode): Promise<void> {
  await writeFileAtomic(filename, `${JSON.stringify({ version: 1, mode })}\n`, { mode: 0o600, dirMode: 0o700 })
}
```

Add `"@deepseek-ai/dsh-atomic-write": "workspace:^"` to `apps/desktop/package.json` dependencies.

- [ ] **Step 4: Run focused tests and Desktop typecheck**

Run: `pnpm exec vitest run apps/desktop/tests/desktop-state.spec.ts && pnpm --filter @deepseek-ai/dsh-desktop run typecheck`

Expected: all state tests pass and both Desktop TypeScript programs exit 0.

- [ ] **Step 5: Commit the state unit**

```bash
git add apps/desktop/package.json apps/desktop/src/desktop-mode.ts apps/desktop/src/desktop-state.ts apps/desktop/tests/desktop-state.spec.ts pnpm-lock.yaml
git commit -m "feat(desktop): persist the selected desktop mode"
```

### Task 2: Exact-Origin Chat Navigation Policy

**Files:**
- Create: `apps/desktop/src/chat-navigation.ts`
- Create: `apps/desktop/tests/chat-navigation.spec.ts`

**Interfaces:**
- Produces: `CHAT_URL`, `CHAT_PARTITION`, `ChatUrlClass`, `classifyChatUrl(raw)`, and `decideChatNavigation(source, raw)`.
- Consumes: no Electron APIs; this module stays pure so every navigation source uses one decision table.

- [ ] **Step 1: Write the failing URL decision table**

```ts
import { describe, expect, it } from 'vitest'
import { classifyChatUrl, decideChatNavigation } from '../src/chat-navigation.ts'

describe('Chat navigation policy', () => {
  it.each([
    ['https://chat.deepseek.com/', 'chat'],
    ['https://chat.deepseek.com/a/b?x=1#y', 'chat'],
    ['https://example.com/', 'external-web'],
    ['mailto:test@example.com', 'blocked'],
    ['not a url', 'blocked'],
  ] as const)('classifies %s as %s', (url, expected) => {
    expect(classifyChatUrl(url)).toBe(expected)
  })

  it('opens untrusted new-window web links externally but offers top-level escapes for confirmation', () => {
    expect(decideChatNavigation('new-window', 'https://example.com/')).toBe('open-external')
    expect(decideChatNavigation('top-level', 'https://example.com/')).toBe('offer-external')
    expect(decideChatNavigation('redirect', 'https://example.com/')).toBe('block')
  })

  it('allows trusted Chat navigation from every source', () => {
    for (const source of ['new-window', 'top-level', 'redirect'] as const) {
      expect(decideChatNavigation(source, 'https://chat.deepseek.com/sign_in')).toBe('allow')
    }
  })
})
```

- [ ] **Step 2: Verify the policy test fails**

Run: `pnpm exec vitest run apps/desktop/tests/chat-navigation.spec.ts`

Expected: FAIL because `chat-navigation.ts` does not exist.

- [ ] **Step 3: Implement the exact-origin classifier**

```ts
export const CHAT_URL = 'https://chat.deepseek.com/'
export const CHAT_PARTITION = 'persist:dsh-deepseek-chat'

const CHAT_ORIGINS = new Set([new URL(CHAT_URL).origin])
const AUTH_ORIGINS = new Set<string>()

export type ChatUrlClass = 'chat' | 'auth' | 'external-web' | 'blocked'
export type ChatNavigationSource = 'new-window' | 'top-level' | 'redirect'
export type ChatNavigationDecision = 'allow' | 'open-external' | 'offer-external' | 'block'

export function classifyChatUrl(raw: string): ChatUrlClass {
  let url: URL
  try { url = new URL(raw) } catch { return 'blocked' }
  if (url.protocol !== 'https:') return 'blocked'
  if (CHAT_ORIGINS.has(url.origin)) return 'chat'
  if (AUTH_ORIGINS.has(url.origin)) return 'auth'
  return 'external-web'
}

export function decideChatNavigation(source: ChatNavigationSource, raw: string): ChatNavigationDecision {
  const kind = classifyChatUrl(raw)
  if (kind === 'chat' || kind === 'auth') return 'allow'
  if (kind === 'external-web' && source === 'new-window') return 'open-external'
  if (kind === 'external-web' && source === 'top-level') return 'offer-external'
  return 'block'
}
```

Keep the initial trusted set limited to `https://chat.deepseek.com`. Add an exact authentication origin only when a real release-smoke login proves it is required, with a new failing table row first.

- [ ] **Step 4: Run the focused policy tests**

Run: `pnpm exec vitest run apps/desktop/tests/chat-navigation.spec.ts`

Expected: all navigation cases pass.

- [ ] **Step 5: Commit the policy unit**

```bash
git add apps/desktop/src/chat-navigation.ts apps/desktop/tests/chat-navigation.spec.ts
git commit -m "feat(desktop): define Chat navigation policy"
```

### Task 3: Framework-Neutral Mode Controller

**Files:**
- Create: `apps/desktop/src/desktop-mode-controller.ts`
- Create: `apps/desktop/tests/desktop-mode-controller.spec.ts`
- Modify: `apps/desktop/src/desktop-mode.ts`

**Interfaces:**
- Consumes: `DesktopMode`, `DesktopModeSnapshot`, `DesktopContentBounds`, and `DesktopSurface` from Task 1.
- Produces: `createDesktopModeController(options)` with `select`, `retry`, `resize`, `reloadChat`, `clearChatData`, `offerExternalUrl`, `openPendingExternal`, `fail`, `snapshot`, and `shutdown`.

- [ ] **Step 1: Write failing controller ownership tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import { createDesktopModeController } from '../src/desktop-mode-controller.ts'
import type { DesktopSurface } from '../src/desktop-mode.ts'

function surface(): DesktopSurface & { visible: boolean } {
  return {
    visible: false,
    setBounds: vi.fn(),
    setVisible(value) { this.visible = value },
    reload: vi.fn(),
    dispose: vi.fn(() => Promise.resolve()),
  }
}

describe('desktop mode controller', () => {
  it('lazy-creates Chat once and retains it across switches', async () => {
    const harness = surface()
    const chat = surface()
    const createChat = vi.fn(() => Promise.resolve(chat))
    const controller = createDesktopModeController({
      initialMode: 'harness', createHarness: () => Promise.resolve(harness), createChat,
      clearChatStorage: () => Promise.resolve(), openExternal: () => Promise.resolve(), saveMode: () => Promise.resolve(), onChange: vi.fn(),
    })
    await controller.start()
    await controller.select('chat')
    await controller.select('harness')
    await controller.select('chat')
    expect(createChat).toHaveBeenCalledOnce()
    expect(chat.visible).toBe(true)
    expect(harness.visible).toBe(false)
  })

  it('keeps Chat usable when Harness fails and retries only Harness', async () => {
    const chat = surface()
    const createHarness = vi.fn().mockRejectedValueOnce(new Error('host failed')).mockResolvedValueOnce(surface())
    const controller = createDesktopModeController({
      initialMode: 'chat', createHarness, createChat: () => Promise.resolve(chat),
      clearChatStorage: () => Promise.resolve(), openExternal: () => Promise.resolve(), saveMode: () => Promise.resolve(), onChange: vi.fn(),
    })
    await controller.start()
    expect(controller.snapshot().harness.phase).toBe('failed')
    expect(controller.snapshot().chat.phase).toBe('ready')
    await controller.retry('harness')
    expect(createHarness).toHaveBeenCalledTimes(2)
    expect(controller.snapshot().harness.phase).toBe('ready')
  })

  it('disposes Chat before clearing its partition and recreates it when selected', async () => {
    const order: string[] = []
    const chat = surface()
    chat.dispose = vi.fn(async () => { order.push('dispose') })
    const controller = createDesktopModeController({
      initialMode: 'chat', createHarness: () => Promise.resolve(surface()), createChat: () => Promise.resolve(chat),
      clearChatStorage: async () => { order.push('clear') }, openExternal: () => Promise.resolve(), saveMode: () => Promise.resolve(), onChange: vi.fn(),
    })
    await controller.start()
    await controller.clearChatData()
    expect(order).toEqual(['dispose', 'clear'])
    expect(controller.snapshot().chat.phase).toBe('ready')
  })
})
```

- [ ] **Step 2: Run the controller tests and observe the missing module failure**

Run: `pnpm exec vitest run apps/desktop/tests/desktop-mode-controller.spec.ts`

Expected: FAIL resolving `desktop-mode-controller.ts`.

- [ ] **Step 3: Implement one serialized controller queue**

```ts
export interface DesktopModeControllerOptions {
  readonly initialMode: DesktopMode
  readonly createHarness: (onFailure: (error: Error) => void) => Promise<DesktopSurface>
  readonly createChat: (onFailure: (error: Error) => void) => Promise<DesktopSurface>
  readonly clearChatStorage: () => Promise<void>
  readonly openExternal: (url: string) => Promise<void>
  readonly saveMode: (mode: DesktopMode) => Promise<void>
  readonly onChange: (snapshot: DesktopModeSnapshot) => void
}

export interface DesktopModeController {
  start(): Promise<void>
  select(mode: DesktopMode): Promise<void>
  retry(mode: DesktopMode): Promise<void>
  resize(bounds: DesktopContentBounds): void
  reloadChat(): void
  clearChatData(): Promise<void>
  offerExternalUrl(url: string): void
  openPendingExternal(): Promise<void>
  fail(mode: DesktopMode, error: Error): Promise<void>
  snapshot(): DesktopModeSnapshot
  shutdown(): Promise<void>
}
```

Implement `start()` so Harness starts eagerly while Chat starts only when initially selected. Serialize every mutating async method through one tail promise; set the requested phase before awaiting; dispose a failed or cleared surface before replacement; publish a detached snapshot after every transition; ignore create completions after shutdown; and show only the selected ready surface. Keep the pending external URL only in the controller, expose only its presence in snapshots, clear it after `openPendingExternal`, and never log it.

- [ ] **Step 4: Add race cases and make the complete controller test pass**

Add cases proving concurrent selections coalesce, `resize` reaches both retained surfaces, `shutdown` waits for both disposers once, and a create resolving after shutdown is immediately disposed.

Run: `pnpm exec vitest run apps/desktop/tests/desktop-mode-controller.spec.ts apps/desktop/tests/desktop-state.spec.ts`

Expected: all controller and state tests pass with no unhandled rejection.

- [ ] **Step 5: Commit the controller unit**

```bash
git add apps/desktop/src/desktop-mode.ts apps/desktop/src/desktop-mode-controller.ts apps/desktop/tests/desktop-mode-controller.spec.ts
git commit -m "feat(desktop): coordinate independent desktop modes"
```

### Task 4: Local Shell, IPC, and Packaged Resources

**Files:**
- Create: `apps/desktop/src/shell-protocol.ts`
- Create: `apps/desktop/src/shell-preload.ts`
- Create: `apps/desktop/resources/shell.html`
- Create: `apps/desktop/resources/shell.css`
- Create: `apps/desktop/tests/shell-protocol.spec.ts`
- Modify: `apps/desktop/tsdown.config.ts`
- Modify: `apps/desktop/tests/packaging-config.spec.ts`
- Modify: `apps/desktop/tests/verify-packaged-runtime.spec.ts`
- Modify: `apps/desktop/scripts/verify-packaged-runtime.ts`

**Interfaces:**
- Consumes: `DesktopMode` and `DesktopModeSnapshot`.
- Produces: `DESKTOP_SHELL_CHANNELS`, `DesktopShellCommand`, the 44px shell header, and preload-to-main messages with no generic IPC escape.

- [ ] **Step 1: Write failing protocol and packaging assertions**

```ts
import { describe, expect, it } from 'vitest'
import { DESKTOP_SHELL_CHANNELS, isDesktopShellCommand } from '../src/shell-protocol.ts'

describe('desktop shell protocol', () => {
  it('accepts only the closed command union', () => {
    expect(DESKTOP_SHELL_CHANNELS.command).toBe('dsh-desktop:shell-command')
    for (const value of ['retry-chat', 'retry-harness', 'reload-chat', 'clear-chat-data', 'open-chat-browser', 'open-pending-external']) {
      expect(isDesktopShellCommand(value)).toBe(true)
    }
    expect(isDesktopShellCommand('open-arbitrary-url')).toBe(false)
  })
})
```

Extend packaging tests to require `desktop-resources/shell.html`, `desktop-resources/shell.css`, and `lib/shell-preload.js` in the packaged app.

- [ ] **Step 2: Run the protocol and packaging tests to verify failure**

Run: `pnpm exec vitest run apps/desktop/tests/shell-protocol.spec.ts apps/desktop/tests/packaging-config.spec.ts apps/desktop/tests/verify-packaged-runtime.spec.ts`

Expected: FAIL for missing protocol and shell artifacts.

- [ ] **Step 3: Add the closed IPC protocol and preload behavior**

```ts
export const DESKTOP_MODE_BAR_HEIGHT = 44
export const DESKTOP_SHELL_CHANNELS = {
  select: 'dsh-desktop:select-mode',
  command: 'dsh-desktop:shell-command',
  snapshot: 'dsh-desktop:mode-snapshot',
} as const

export type DesktopShellCommand = 'retry-chat' | 'retry-harness' | 'reload-chat' | 'clear-chat-data' | 'open-chat-browser' | 'open-pending-external'
const COMMANDS = new Set<DesktopShellCommand>(['retry-chat', 'retry-harness', 'reload-chat', 'clear-chat-data', 'open-chat-browser', 'open-pending-external'])
export function isDesktopShellCommand(value: unknown): value is DesktopShellCommand {
  return typeof value === 'string' && COMMANDS.has(value as DesktopShellCommand)
}
```

Use the following preload structure; it sends only closed protocol values and exposes no JavaScript global to page content:

```ts
import { ipcRenderer } from 'electron'
import type { DesktopMode, DesktopModeSnapshot } from './desktop-mode.ts'
import { DESKTOP_MODE_BAR_HEIGHT, DESKTOP_SHELL_CHANNELS, type DesktopShellCommand } from './shell-protocol.ts'

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id)
  if (value === null) throw new Error(`desktop shell element is missing: ${id}`)
  return value as T
}

function sendCommand(command: DesktopShellCommand): void {
  ipcRenderer.send(DESKTOP_SHELL_CHANNELS.command, command)
}

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.style.setProperty('--desktop-mode-bar-height', `${DESKTOP_MODE_BAR_HEIGHT}px`)
  const chat = element<HTMLButtonElement>('mode-chat')
  const harness = element<HTMLButtonElement>('mode-harness')
  const actions = element<HTMLButtonElement>('chat-actions')
  const menu = element<HTMLElement>('chat-menu')
  const status = element<HTMLElement>('mode-status')
  const title = element<HTMLElement>('status-title')
  const message = element<HTMLElement>('status-message')
  const retry = element<HTMLButtonElement>('retry')
  const openBrowser = element<HTMLButtonElement>('open-browser')
  const openExternal = element<HTMLButtonElement>('open-external')
  const dialog = element<HTMLDialogElement>('clear-chat-confirm')

  const select = (mode: DesktopMode): void => { ipcRenderer.send(DESKTOP_SHELL_CHANNELS.select, mode) }
  chat.addEventListener('click', () => { select('chat') })
  harness.addEventListener('click', () => { select('harness') })
  actions.addEventListener('click', () => { menu.hidden = !menu.hidden })
  element('reload-chat').addEventListener('click', () => { menu.hidden = true; sendCommand('reload-chat') })
  element('clear-chat-data').addEventListener('click', () => { menu.hidden = true; dialog.showModal() })
  element('confirm-clear').addEventListener('click', () => { sendCommand('clear-chat-data') })
  openBrowser.addEventListener('click', () => { sendCommand('open-chat-browser') })
  openExternal.addEventListener('click', () => { sendCommand('open-pending-external') })

  let selected: DesktopMode = 'harness'
  retry.addEventListener('click', () => { sendCommand(selected === 'chat' ? 'retry-chat' : 'retry-harness') })
  ipcRenderer.on(DESKTOP_SHELL_CHANNELS.snapshot, (_event, snapshot: DesktopModeSnapshot) => {
    selected = snapshot.selected
    chat.setAttribute('aria-pressed', String(selected === 'chat'))
    harness.setAttribute('aria-pressed', String(selected === 'harness'))
    actions.hidden = selected !== 'chat'
    const current = snapshot[selected]
    status.hidden = current.phase === 'ready'
    title.textContent = current.phase === 'loading' ? `Loading ${selected === 'chat' ? 'Chat' : 'Harness'}` : `${selected === 'chat' ? 'Chat' : 'Harness'} unavailable`
    message.textContent = current.message ?? ''
    retry.hidden = current.phase !== 'failed'
    openBrowser.hidden = selected !== 'chat' || current.phase !== 'failed'
    openExternal.hidden = !snapshot.pendingExternalUrl
  })
})
```

- [ ] **Step 4: Add the trusted shell resources and bundle preload**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="shell.css">
  <title>DeepSeek Harness</title>
</head>
<body>
  <header id="mode-bar">
    <div role="group" aria-label="Desktop mode" class="segmented">
      <button id="mode-chat" type="button" aria-pressed="false">Chat</button>
      <button id="mode-harness" type="button" aria-pressed="true">Harness</button>
    </div>
    <button id="chat-actions" type="button" aria-label="Chat actions">...</button>
    <button id="open-external" type="button" hidden>Open link in browser</button>
    <div id="chat-menu" role="menu" hidden><button id="reload-chat" role="menuitem" type="button">Reload Chat</button><button id="clear-chat-data" role="menuitem" type="button">Clear Chat Data</button></div>
  </header>
  <main id="mode-status" hidden><h1 id="status-title"></h1><p id="status-message"></p><div id="status-actions"><button id="retry" type="button">Retry</button><button id="open-browser" type="button">Open in browser</button></div></main>
  <dialog id="clear-chat-confirm"><p>Clear the embedded Chat login and local browsing data?</p><form method="dialog"><button value="cancel">Cancel</button><button id="confirm-clear" value="confirm">Clear data</button></form></dialog>
</body>
</html>
```

Add restrained CSS for a stable 44px draggable bar, macOS traffic-light inset, Windows caption-control inset, segmented mode buttons, visible focus, dark/light themes, reduced motion, and a centered unframed error state. Keep every interactive element `-webkit-app-region: no-drag`.

Change `apps/desktop/tsdown.config.ts` entry to `['lib/types/main.js', 'lib/types/shell-preload.js']` and extend `verify-packaged-runtime.ts` with the exact shell paths.

- [ ] **Step 5: Run shell, packaging, and type checks**

Run: `pnpm exec vitest run apps/desktop/tests/shell-protocol.spec.ts apps/desktop/tests/packaging-config.spec.ts apps/desktop/tests/verify-packaged-runtime.spec.ts && pnpm --filter @deepseek-ai/dsh-desktop run typecheck && pnpm --filter @deepseek-ai/dsh-desktop run build`

Expected: focused tests pass; `apps/desktop/lib/shell-preload.js` exists; typecheck and build exit 0.

- [ ] **Step 6: Commit the shell unit**

```bash
git add apps/desktop/src/shell-protocol.ts apps/desktop/src/shell-preload.ts apps/desktop/resources/shell.html apps/desktop/resources/shell.css apps/desktop/tsdown.config.ts apps/desktop/tests apps/desktop/scripts/verify-packaged-runtime.ts
git commit -m "feat(desktop): add the dual-mode shell"
```

### Task 5: Electron Chat and Harness Surface Adapters

**Files:**
- Create: `apps/desktop/src/chat-surface.ts`
- Create: `apps/desktop/src/harness-surface.ts`
- Create: `apps/desktop/tests/chat-surface.spec.ts`
- Create: `apps/desktop/tests/harness-surface.spec.ts`
- Modify: `apps/desktop/src/host-supervisor.ts`

**Interfaces:**
- Consumes: `DesktopSurface`, `CHAT_URL`, `CHAT_PARTITION`, `decideChatNavigation`, and the existing Host supervisor.
- Produces: `createChatSurface(options)`, `clearChatPartition(session)`, and `createHarnessSurface(options)`.

- [ ] **Step 1: Write failing adapter tests with injected Electron fakes**

```ts
it('creates Chat with the persistent partition and restricted WebPreferences', async () => {
  const createView = vi.fn(() => fakeView())
  await createChatSurface({ createView, chatSession: fakeSession(), openExternal: vi.fn(), createAuthWindow: vi.fn(), onFailure: vi.fn() })
  expect(createView).toHaveBeenCalledWith({
    webPreferences: { partition: 'persist:dsh-deepseek-chat', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  })
})

it('stops the Host when Harness load fails and reports later Host exit through onFailure', async () => {
  const host = fakeHostSupervisor()
  const view = fakeView({ loadFailure: new Error('load failed') })
  await expect(createHarnessSurface({ host, createView: () => view, onFailure: vi.fn(), platform: 'darwin' })).rejects.toThrow('load failed')
  expect(host.shutdown).toHaveBeenCalledOnce()
})
```

Add cases for permission denial, trusted navigation, external new windows, offered top-level external navigation, blocked redirects, load errors, renderer crash, auth-window partition sharing, clear ordering, same-origin Harness navigation, and one-time disposal.

- [ ] **Step 2: Verify adapter tests fail before implementation**

Run: `pnpm exec vitest run apps/desktop/tests/chat-surface.spec.ts apps/desktop/tests/harness-surface.spec.ts`

Expected: FAIL because both surface modules are absent.

- [ ] **Step 3: Implement Chat ownership and clearing**

`createChatSurface` must configure the dedicated session permission handlers before the first load, create one restricted view, install `will-navigate`, `will-redirect`, `setWindowOpenHandler`, `did-fail-load`, `render-process-gone`, and `unresponsive` handling, then load `CHAT_URL`. Allowed authentication windows use the same session and identical WebPreferences; no remote view receives a preload. An `offer-external` decision calls the injected `onExternalNavigation(url)` without exposing or logging the URL in Chat.

`clearChatPartition` must close all Chat-owned views before calling `clearStorageData()` and `clearCache()`. It must not clear `session.defaultSession`.

- [ ] **Step 4: Implement restartable Harness ownership**

`createHarnessSurface` starts one fresh Host supervisor, validates readiness through the existing parser, creates a restricted WebContentsView, appends `dsh-desktop-platform` and `dsh-desktop-embedded=1`, and loads the loopback URL. Its disposer closes the view and joins Host shutdown. An unexpected exit calls `onFailure` instead of quitting Electron.

Keep `HostSupervisor` single-start semantics unchanged; each retry creates a new supervisor instance rather than restarting an already shut-down instance.

- [ ] **Step 5: Run adapter, supervisor, and type tests**

Run: `pnpm exec vitest run apps/desktop/tests/chat-surface.spec.ts apps/desktop/tests/harness-surface.spec.ts apps/desktop/tests/host-supervisor.spec.ts && pnpm --filter @deepseek-ai/dsh-desktop run typecheck`

Expected: all adapter and existing supervisor tests pass; typecheck exits 0.

- [ ] **Step 6: Commit the adapter unit**

```bash
git add apps/desktop/src/chat-surface.ts apps/desktop/src/harness-surface.ts apps/desktop/src/host-supervisor.ts apps/desktop/tests/chat-surface.spec.ts apps/desktop/tests/harness-surface.spec.ts
git commit -m "feat(desktop): isolate Chat and Harness surfaces"
```

### Task 6: Compose the Independent Application Lifecycle

**Files:**
- Create: `apps/desktop/src/desktop-application.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/tsdown.config.ts`
- Modify: `apps/desktop/src/window-lifecycle.ts`
- Modify: `apps/desktop/tests/window-lifecycle.spec.ts`
- Create: `apps/desktop/tests/main-composition.spec.ts`

**Interfaces:**
- Consumes: controller, shell protocol, state store, Chat/Harness factories, existing tray/window lifecycle, and `DESKTOP_MODE_BAR_HEIGHT`.
- Produces: a shell-first boot that keeps Chat alive when the Host fails and joins all resources on quit.

- [ ] **Step 1: Add failing composition and lifecycle tests**

Test that `createMainWindow()` loads `resources/shell.html` before starting Harness, binds only the closed IPC channels, gives child views bounds `{ x: 0, y: 44, width, height: height - 44 }`, persists selection, and does not call `requestAppQuit()` on Host failure. Extend window-lifecycle tests so its disposer represents the complete controller rather than only the Host.

- [ ] **Step 2: Run the tests and verify the old fatal-Host behavior fails them**

Run: `pnpm exec vitest run apps/desktop/tests/main-composition.spec.ts apps/desktop/tests/window-lifecycle.spec.ts`

Expected: FAIL because the current boot waits for Host readiness and quits on unexpected exit.

- [ ] **Step 3: Refactor main into shell-first composition**

Export `createDesktopApplication(options)` from `desktop-application.ts`. Create the BrowserWindow with the existing platform chrome and `preload: join(DESKTOP_DIR, 'lib/shell-preload.js')`; load the development or packaged shell path; show it after the local file reaches ready-to-show; attach controller snapshot delivery to the shell WebContents; bind exact IPC handlers; and start the controller without blocking window creation. Production `main.ts` supplies `join(app.getPath('userData'), 'desktop-state.json')`, fixed Chat configuration, real Host spawning, tray resources, dialogs, and `shell.openExternal`.

Add `lib/types/desktop-application.js` to the tsdown entry array so the Electron fixture can import `lib/desktop-application.js` without importing the side-effecting production entrypoint.

Derive content bounds from `window.getContentBounds()` and `DESKTOP_MODE_BAR_HEIGHT`, updating them on resize. Keep tray restore, single-instance focus, external quit, and bounded Host termination. Replace the Host-only `disposeHost` dependency with `disposeApplication: () => controller.shutdown()` in `window-lifecycle.ts` and its tests.

- [ ] **Step 4: Add invalid durable-state and IPC failure containment**

When `loadDesktopMode` rejects, log the invalid state, start in Harness, and overwrite the mode only after a user selection. Reject malformed IPC payloads without changing the snapshot. A command failure updates the selected mode status and remains in the shell; it never becomes an unhandled rejection.

- [ ] **Step 5: Run every Desktop unit test and build**

Run: `pnpm exec vitest run apps/desktop/tests && pnpm --filter @deepseek-ai/dsh-desktop run typecheck && pnpm --filter @deepseek-ai/dsh-desktop run build`

Expected: all Desktop tests pass; typecheck and build exit 0.

- [ ] **Step 6: Commit the composed application**

```bash
git add apps/desktop/src/desktop-application.ts apps/desktop/src/main.ts apps/desktop/src/window-lifecycle.ts apps/desktop/tsdown.config.ts apps/desktop/tests/window-lifecycle.spec.ts apps/desktop/tests/main-composition.spec.ts
git commit -m "feat(desktop): decouple Chat from Harness lifecycle"
```

### Task 7: Embedded Harness Presentation

**Files:**
- Modify: `apps/web/src/desktop-marker.ts`
- Modify: `apps/web/tests/desktop-marker.spec.ts`
- Modify: `packages/client/ui-layout/src/client/AppFrame.tsx`
- Modify: `packages/client/ui-layout/src/client/AppFrame.module.css`
- Modify: `packages/client/ui-layout/tests/desktop-surfaces.client.spec.ts`
- Modify: `packages/client/ui-layout/tests/app-frame.client.spec.tsx`
- Modify: `packages/client/ui-sidebar/src/client/SidebarRoot.module.css`
- Modify: `packages/client/ui-sidebar/tests/sidebar-styles.client.spec.ts`
- Modify: `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css`
- Modify: `packages/client/ui-conversation/tests/desktop-header-styles.client.spec.ts`

**Interfaces:**
- Consumes: Harness URL query `dsh-desktop-embedded=1` from Task 5.
- Produces: `data-dsh-desktop-embedded="true"` and presentation rules that retain transparent native material while removing renderer-owned title-bar geometry.

- [ ] **Step 1: Write failing embedded-marker and CSS contract tests**

```ts
it('marks a child view as embedded inside the Desktop shell', () => {
  const root = document.createElement('html')
  applyDesktopPresentationMarker('http://127.0.0.1:4173/?dsh-desktop-platform=darwin&dsh-desktop-embedded=1', root)
  expect(root.dataset.dshDesktop).toBe('true')
  expect(root.dataset.dshDesktopPlatform).toBe('darwin')
  expect(root.dataset.dshDesktopEmbedded).toBe('true')
})
```

Add CSS assertions that the embedded marker hides sidebar/conversation drag regions, restores normal sidebar top padding, removes Windows caption-control padding, removes Linux child-view inset, and uses `SIDEBAR_COLLAPSED` rather than `SIDEBAR_COLLAPSED_MACOS`.

- [ ] **Step 2: Run focused Web presentation tests and verify failure**

Run: `pnpm exec vitest run apps/web/tests/desktop-marker.spec.ts packages/client/ui-layout/tests/desktop-surfaces.client.spec.ts packages/client/ui-layout/tests/app-frame.client.spec.tsx packages/client/ui-sidebar/tests/sidebar-styles.client.spec.ts packages/client/ui-conversation/tests/desktop-header-styles.client.spec.ts`

Expected: new embedded-marker and override assertions fail.

- [ ] **Step 3: Add the embedded presentation marker**

Extend `applyDesktopPresentationMarker` so it sets `dshDesktopEmbedded = 'true'` only when the platform is valid and the query value equals `1`. Ordinary Web and the existing full-window Desktop marker remain unchanged.

- [ ] **Step 4: Add exact embedded overrides**

Under `html[data-dsh-desktop-embedded='true']`, hide renderer drag bands, restore the Web header/sidebar vertical geometry, remove caption-button reservation, and skip Linux title-bar padding. Update AppFrame's collapsed-width choice to require macOS and not embedded before selecting `SIDEBAR_COLLAPSED_MACOS`. Preserve existing transparent-background selectors so native sidebar material still renders.

- [ ] **Step 5: Run presentation tests, Web typecheck, and Desktop surface tests**

Run: `pnpm exec vitest run apps/web/tests/desktop-marker.spec.ts packages/client/ui-layout/tests packages/client/ui-sidebar/tests packages/client/ui-conversation/tests/desktop-header-styles.client.spec.ts && pnpm run typecheck:contracts-ready`

Expected: all selected client tests pass and the client TypeScript face exits 0.

- [ ] **Step 6: Commit the embedded presentation unit**

```bash
git add apps/web/src/desktop-marker.ts apps/web/tests/desktop-marker.spec.ts packages/client/ui-layout packages/client/ui-sidebar packages/client/ui-conversation
git commit -m "feat(web): present Harness inside the desktop mode shell"
```

### Task 8: Keyless Electron Scenario, Documentation, and Proposal Promotion

**Files:**
- Create: `apps/desktop/tests/fixtures/dual-mode-app/package.json`
- Create: `apps/desktop/tests/fixtures/dual-mode-app/main.mjs`
- Create: `apps/desktop/tests/dual-mode.electron.spec.ts`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/README.md`
- Modify: `apps/desktop/README.zh.md`
- Modify: `apps/desktop/README.i18n.yaml`
- Move: `.agents/notes/proposed/feature/2026-08-14-deepseek-chat-desktop-mode.md` to `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md`
- Move: `.agents/notes/proposed/feature/2026-08-14-deepseek-chat-desktop-mode.zh.md` to `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.zh.md`
- Move: `.agents/notes/proposed/feature/2026-08-14-deepseek-chat-desktop-mode.i18n.yaml` to `.agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.i18n.yaml`

**Interfaces:**
- Consumes: the complete packaged-mode behavior from Tasks 1-7.
- Produces: a local fixture-backed Electron scenario, current Desktop documentation, and an implemented Agent Note describing shipped reality.

- [ ] **Step 1: Add a failing Electron smoke scenario**

Use Vitest plus Playwright's `_electron` to start a fixture entry that composes the production shell/controller with local Harness and Chat HTTP servers. Assert that the mode control switches views, Chat state survives a round trip, a simulated Host crash leaves Chat visible, a simulated Chat crash leaves Harness visible, and clear-data recreates the Chat fixture without its stored login marker.

Add `playwright` to the Desktop devDependencies and add `test:electron` as `vitest run tests/dual-mode.electron.spec.ts`.

- [ ] **Step 2: Run the Electron scenario and verify the missing fixture failure**

Run: `pnpm --filter @deepseek-ai/dsh-desktop run build && pnpm --filter @deepseek-ai/dsh-desktop run test:electron`

Expected: FAIL until the fixture entry and production test composition exist.

- [ ] **Step 3: Implement the local fixture entry and pass the scenario**

The fixture imports the built production composition, injects only local fixture URLs and fake external opening, and never changes production `CHAT_URL`. It records external-open requests in fixture-owned state and exposes no test API in the packaged production entry.

Run: `pnpm --filter @deepseek-ai/dsh-desktop run build && pnpm --filter @deepseek-ai/dsh-desktop run test:electron`

Expected: the keyless Electron scenario passes on the current platform.

- [ ] **Step 4: Update the Desktop README pair**

Document mode semantics, persistent login, independent data ownership, exact external-link behavior, clear-data limits, browser fallback, Host/Chat failure isolation, live-site compatibility limits, and the macOS/Windows release-smoke procedure. Keep model experience explicit: the shell adds no Harness model-visible input.

Run: `pnpm run verify-translation-pairing --write apps/desktop/README.md`

Expected: the README pair and consistency record are current.

- [ ] **Step 5: Promote and rewrite the Agent Note**

Move the triplet to `implemented/feature`, change both status lines to `Status: implemented`, rewrite `## Proposal` as `## Decision`, replace proposal-only acceptance language with present-tense verification and consequences, preserve alternatives and risks, then re-record the moved pair.

Run: `pnpm run verify-translation-pairing --write .agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.md && pnpm run verify-agent-note-format`

Expected: the moved pair is consistent and every Agent Note passes the lifecycle format check.

- [ ] **Step 6: Run the complete relevant verification set**

Run: `pnpm exec vitest run apps/desktop/tests apps/web/tests/desktop-marker.spec.ts packages/client/ui-layout/tests packages/client/ui-sidebar/tests packages/client/ui-conversation/tests/desktop-header-styles.client.spec.ts`

Run: `pnpm --filter @deepseek-ai/dsh-desktop run typecheck && pnpm --filter @deepseek-ai/dsh-desktop run build && pnpm --filter @deepseek-ai/dsh-desktop run test:electron`

Run: `pnpm run lint && pnpm run doc-sync && git diff --check`

Expected: all focused behavior tests, Desktop build/typecheck, keyless Electron scenario, lint, documentation gates, and whitespace checks pass.

- [ ] **Step 7: Perform release smoke tests before claiming live-site support**

On macOS and Windows, verify real DeepSeek login, restart persistence, Chat draft preservation, mode switching, approved authentication navigation, external links, clear-data logout, WAF/error fallback, and independent Host failure. Record the exact supported login methods in the Desktop README; do not weaken the origin or sandbox policy to make a failing method pass.

- [ ] **Step 8: Commit the verified feature**

```bash
git add apps/desktop apps/web/src/desktop-marker.ts apps/web/tests/desktop-marker.spec.ts packages/client/ui-layout packages/client/ui-sidebar packages/client/ui-conversation .agents/notes/implemented/feature/2026-08-14-deepseek-chat-desktop-mode.* pnpm-lock.yaml
git commit -m "feat(desktop): add isolated DeepSeek Chat mode"
```
