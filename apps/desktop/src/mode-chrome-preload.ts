/** Trusted DOM behavior for the title-bar mode chrome. */

import { ipcRenderer } from 'electron'
import type { DesktopMode, DesktopModeSnapshot } from './desktop-mode.ts'
import { isDesktopColorScheme } from './desktop-theme.ts'
import {
  DESKTOP_SHELL_CHANNELS,
  type DesktopChromeLayout,
  type DesktopChromeSurface,
  type DesktopShellCommand,
} from './shell-protocol.ts'

function element(id: string): HTMLElement {
  const value = document.getElementById(id)
  if (value === null) throw new Error(`desktop mode chrome element is missing: ${id}`)
  return value
}

function isDesktopMode(value: string | null | undefined): value is DesktopMode {
  return value === 'chat' || value === 'harness'
}

function sendCommand(command: DesktopShellCommand): void {
  ipcRenderer.send(DESKTOP_SHELL_CHANNELS.command, command)
}

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.platform = process.platform
  const modeSwitch = element('mode-switch')
  const modeButtons = [...modeSwitch.querySelectorAll<HTMLButtonElement>('[data-mode]')]
  const actions = element('chat-actions') as HTMLButtonElement
  const chatMenu = element('chat-menu')
  const dialog = element('clear-chat-confirm') as HTMLDialogElement
  const confirmClear = element('confirm-clear') as HTMLButtonElement
  let selected: DesktopMode = 'harness'
  let requestedSurface: DesktopChromeSurface = 'closed'
  let appliedSurface: DesktopChromeSurface = 'closed'

  const requestSurface = (next: DesktopChromeSurface): void => {
    requestedSurface = next
    ipcRenderer.send(DESKTOP_SHELL_CHANNELS.chromeSurface, next)
  }
  const hideChatMenu = (): void => {
    chatMenu.hidden = true
    actions.setAttribute('aria-expanded', 'false')
  }
  const closeChatMenu = (): void => {
    const wasOpen = requestedSurface === 'chat-menu' || appliedSurface === 'chat-menu'
    hideChatMenu()
    if (wasOpen) requestSurface('closed')
  }
  const select = (mode: DesktopMode): void => {
    ipcRenderer.send(DESKTOP_SHELL_CHANNELS.select, mode)
  }

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.getAttribute('data-mode')
      if (isDesktopMode(mode)) select(mode)
    })
    button.addEventListener('keydown', (event) => {
      const index = modeButtons.indexOf(button)
      let nextIndex: number | undefined
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + modeButtons.length) % modeButtons.length
      else if (event.key === 'ArrowRight') nextIndex = (index + 1) % modeButtons.length
      else if (event.key === 'Home') nextIndex = 0
      else if (event.key === 'End') nextIndex = modeButtons.length - 1
      if (nextIndex === undefined) return
      event.preventDefault()
      const nextButton = modeButtons[nextIndex]
      if (nextButton === undefined) return
      const nextMode = nextButton.getAttribute('data-mode')
      if (!isDesktopMode(nextMode)) return
      nextButton.focus()
      select(nextMode)
    })
  })
  actions.addEventListener('click', () => {
    hideChatMenu()
    if (requestedSurface !== 'chat-menu') {
      requestSurface('chat-menu')
    } else {
      closeChatMenu()
    }
  })
  element('reload-chat').addEventListener('click', () => { closeChatMenu(); sendCommand('reload-chat') })
  element('clear-chat-data').addEventListener('click', () => {
    hideChatMenu()
    requestSurface('dialog')
  })
  confirmClear.addEventListener('click', () => { sendCommand('clear-chat-data') })
  dialog.addEventListener('close', () => { requestSurface('closed') })
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || chatMenu.hidden) return
    event.preventDefault()
    closeChatMenu()
    actions.focus()
  })
  document.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Node)
      || (!actions.contains(event.target)
        && !chatMenu.contains(event.target)
        && !dialog.contains(event.target))) {
      closeChatMenu()
    }
  })

  ipcRenderer.on(DESKTOP_SHELL_CHANNELS.chromeLayout, (_event, layout: DesktopChromeLayout) => {
    appliedSurface = layout.surface
    if (layout.dismissMenus) {
      hideChatMenu()
      if (dialog.open) dialog.close()
      if (requestedSurface !== 'closed') requestSurface('closed')
      return
    }
    if (layout.surface !== requestedSurface) return
    document.documentElement.dataset.surface = layout.surface
    switch (layout.surface) {
      case 'closed':
        hideChatMenu()
        if (dialog.open) dialog.close()
        return
      case 'chat-menu':
        chatMenu.hidden = false
        actions.setAttribute('aria-expanded', 'true')
        return
      case 'dialog':
        hideChatMenu()
        if (!dialog.open) dialog.showModal()
        return
    }
  })

  ipcRenderer.on(DESKTOP_SHELL_CHANNELS.chromeTheme, (_event, value: unknown) => {
    if (!isDesktopColorScheme(value)) return
    document.documentElement.dataset.theme = value
  })

  ipcRenderer.on(DESKTOP_SHELL_CHANNELS.snapshot, (_event, snapshot: DesktopModeSnapshot) => {
    selected = snapshot.selected
    document.documentElement.dataset.mode = selected
    modeButtons.forEach((button) => {
      const isSelected = button.getAttribute('data-mode') === selected
      button.setAttribute('aria-checked', String(isSelected))
      button.tabIndex = isSelected ? 0 : -1
    })
    actions.hidden = selected !== 'chat'
    if (selected !== 'chat') closeChatMenu()
  })
  requestSurface('closed')
})
