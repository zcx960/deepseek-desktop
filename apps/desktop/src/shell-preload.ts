/** Trusted DOM behavior for the local desktop shell. */

import { ipcRenderer } from 'electron'
import { desktopTitlebarDragStart } from './desktop-chrome-layout.ts'
import type { DesktopMode, DesktopModeSnapshot } from './desktop-mode.ts'
import { isDesktopColorScheme, isDesktopThemeBackgroundColor } from './desktop-theme.ts'
import {
  DESKTOP_SHELL_CHANNELS,
  type DesktopShellCommand,
} from './shell-protocol.ts'

/** Retrieve one required shell element by id. */
function element(id: string): HTMLElement {
  const value = document.getElementById(id)
  if (value === null) throw new Error(`desktop shell element is missing: ${id}`)
  return value
}

/** Send one closed shell command to Electron main. */
function sendCommand(command: DesktopShellCommand): void {
  ipcRenderer.send(DESKTOP_SHELL_CHANNELS.command, command)
}

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.platform = process.platform
  document.documentElement.style.setProperty(
    '--shell-drag-start',
    `${String(desktopTitlebarDragStart(process.platform))}px`,
  )
  const status = element('mode-status')
  const title = element('status-title')
  const message = element('status-message')
  const retry = element('retry') as HTMLButtonElement
  const openBrowser = element('open-browser') as HTMLButtonElement
  const openExternal = element('open-external') as HTMLButtonElement

  openBrowser.addEventListener('click', () => { sendCommand('open-chat-browser') })
  openExternal.addEventListener('click', () => { sendCommand('open-pending-external') })

  let selected: DesktopMode = 'harness'
  retry.addEventListener('click', () => { sendCommand(selected === 'chat' ? 'retry-chat' : 'retry-harness') })
  ipcRenderer.on(DESKTOP_SHELL_CHANNELS.chromeTheme, (_event, value: unknown) => {
    if (isDesktopColorScheme(value)) document.documentElement.dataset.theme = value
  })
  ipcRenderer.on(DESKTOP_SHELL_CHANNELS.titlebarBackground, (_event, value: unknown) => {
    if (value === null) {
      document.documentElement.style.removeProperty('--shell-chat-background')
    } else if (isDesktopThemeBackgroundColor(value)) {
      document.documentElement.style.setProperty('--shell-chat-background', value)
    }
  })
  ipcRenderer.on(DESKTOP_SHELL_CHANNELS.snapshot, (_event, snapshot: DesktopModeSnapshot) => {
    selected = snapshot.selected
    document.documentElement.dataset.mode = selected
    const current = snapshot[selected]
    status.hidden = current.phase === 'ready'
    title.textContent = current.phase === 'loading'
      ? `Loading ${selected === 'chat' ? 'Chat' : 'Harness'}`
      : `${selected === 'chat' ? 'Chat' : 'Harness'} unavailable`
    message.textContent = current.message ?? ''
    retry.hidden = current.phase !== 'failed'
    openBrowser.hidden = selected !== 'chat' || current.phase !== 'failed'
    openExternal.hidden = !snapshot.pendingExternalUrl
  })
})
