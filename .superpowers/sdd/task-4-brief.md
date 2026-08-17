# Task 4: Local Shell, IPC, and Packaged Resources

## Context

This task adds the trusted local HTML shell and its narrow preload protocol. The shell owns only the desktop mode bar, state presentation, Chat actions, and confirmations. It must not create Electron views, start the Host, or add generic IPC access.

## Global constraints

- Node remains `^22.19.0 || >=24.0.0`; Electron remains `43.4.0`; do not add a production dependency.
- Harness and Chat never share conversations, prompts, credentials, cookies, storage, navigation state, Session events, or telemetry content.
- Do not inject scripts into Chat, inspect its DOM, read its cookies or storage, call undocumented APIs, or bypass WAF and bot checks.
- Every production event listener has one disposer in the later composition task; this preload owns only page-lifetime DOM listeners.
- Keep changes outside `vendor/` and preserve strict ESM TypeScript and JSDoc conventions.
- The workspace has no `.git`; do not initialize Git or attempt a commit.
- Existing Vite path warnings and unsupported-platform notices are baseline noise.
- You are not alone in the codebase. Do not revert edits made by other workers; adjust to existing changes.

## Files owned by this task

- Create: `apps/desktop/src/shell-protocol.ts`
- Create: `apps/desktop/src/shell-preload.ts`
- Create: `apps/desktop/resources/shell.html`
- Create: `apps/desktop/resources/shell.css`
- Create: `apps/desktop/tests/shell-protocol.spec.ts`
- Modify: `apps/desktop/tsdown.config.ts`
- Modify: `apps/desktop/tests/packaging-config.spec.ts`
- Modify: `apps/desktop/tests/verify-packaged-runtime.spec.ts`
- Modify: `apps/desktop/scripts/verify-packaged-runtime.ts`

Do not edit other files.

## Interfaces

- Consumes: `DesktopMode` and `DesktopModeSnapshot`.
- Produces: `DESKTOP_SHELL_CHANNELS`, `DesktopShellCommand`, the 44px shell header, and preload-to-main messages with no generic IPC escape.

## Step 1: Write failing protocol and packaging assertions

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

## Step 2: Verify the protocol and packaging tests fail

Run: `pnpm exec vitest run apps/desktop/tests/shell-protocol.spec.ts apps/desktop/tests/packaging-config.spec.ts apps/desktop/tests/verify-packaged-runtime.spec.ts`

Expected: FAIL for missing protocol and shell artifacts.

## Step 3: Add the closed IPC protocol and preload behavior

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

Use the following preload behavior. It sends only closed protocol values and exposes no JavaScript global to page content:

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

Do not add `contextBridge`, an ambient global, a generic `send(channel, payload)` helper, or any page-content API.

## Step 4: Add the trusted shell resources and bundle preload

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

Add restrained CSS for a stable 44px draggable bar, macOS traffic-light inset, Windows caption-control inset, segmented mode buttons, visible focus, dark/light themes, reduced motion, and a centered unframed error state. Keep every interactive element `-webkit-app-region: no-drag`. This is a dense desktop tool surface: use system UI typography, square-to-compact geometry, CSS variables, and no decorative gradients, orbs, illustrations, nested cards, or marketing copy. Ensure long error messages wrap without overlapping controls and every fixed-format control retains stable dimensions.

Change `apps/desktop/tsdown.config.ts` entry to `['lib/types/main.js', 'lib/types/shell-preload.js']` and extend `verify-packaged-runtime.ts` with the exact shell paths.

## Step 5: Run shell, packaging, type, and build checks

Run: `pnpm exec vitest run apps/desktop/tests/shell-protocol.spec.ts apps/desktop/tests/packaging-config.spec.ts apps/desktop/tests/verify-packaged-runtime.spec.ts`

Run: `pnpm --filter @deepseek-ai/dsh-desktop run typecheck`

Run: `pnpm --filter @deepseek-ai/dsh-desktop run build`

Expected: focused tests pass; `apps/desktop/lib/shell-preload.js` exists; typecheck and build exit 0.

## Report

Write `.superpowers/sdd/task-4-report.md` with RED/GREEN evidence, changed files, self-review, visible-string review, and concerns. Return only status, test summary, concerns, and report path. Do not claim a Git commit.
