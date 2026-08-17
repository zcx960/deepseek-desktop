/** Isolated startup-state and theme adapter for the official DeepSeek Chat renderer. */

import { ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  CHAT_LAST_SESSION_STORAGE_KEY,
  resolveExpandedChatSidebar,
} from './chat-sidebar-adapter.ts'
import {
  CHAT_THEME_STORAGE_KEY,
  parseChatThemeStorage,
  schemeFromChatBody,
  serializeChatThemeStorage,
} from './chat-theme-adapter.ts'
import { DESKTOP_THEME_CHANNELS } from './desktop-theme-sync.ts'
import {
  isDesktopThemePreference,
  normalizeDesktopThemeBackgroundColor,
  type DesktopThemePreference,
} from './desktop-theme.ts'

let ready = false
let pendingPreference: DesktopThemePreference | undefined
let errorReported = false

function reportError(message: string): void {
  if (errorReported) return
  errorReported = true
  ipcRenderer.send(DESKTOP_THEME_CHANNELS.adapterError, message)
}

function expandSidebarOnLoad(): void {
  const resolution = resolveExpandedChatSidebar(localStorage.getItem(CHAT_LAST_SESSION_STORAGE_KEY))
  if (resolution.kind === 'unsupported') {
    reportError('DeepSeek Chat retained page-settings format is unsupported')
  } else if (resolution.kind === 'update') {
    localStorage.setItem(CHAT_LAST_SESSION_STORAGE_KEY, resolution.value)
  }
}

function currentPreference(): DesktopThemePreference | undefined {
  const raw = localStorage.getItem(CHAT_THEME_STORAGE_KEY)
  const preference = parseChatThemeStorage(raw)
  if (raw !== null && preference === undefined) {
    reportError('DeepSeek Chat theme storage format is unsupported')
  }
  return preference
}

function currentBackgroundColor(): string | undefined {
  const point = document.elementFromPoint(Math.max(0, Math.floor(window.innerWidth / 2)), 0)
  for (const candidate of [point, document.body, document.documentElement]) {
    if (candidate === null) continue
    const color = normalizeDesktopThemeBackgroundColor(getComputedStyle(candidate).backgroundColor)
    if (color !== undefined) return color
  }
  return undefined
}

function reportTheme(): void {
  const preference = currentPreference()
  const body = document.body
  if (preference === undefined) return
  const scheme = schemeFromChatBody({
    classList: new Set(body.classList),
    darkAttribute: body.getAttribute('data-ds-dark-theme'),
  })
  if (scheme === undefined) return
  const backgroundColor = currentBackgroundColor()
  ipcRenderer.send(DESKTOP_THEME_CHANNELS.report, {
    preference,
    scheme,
    ...(backgroundColor === undefined ? {} : { backgroundColor }),
  })
}

function applyPreference(preference: DesktopThemePreference): void {
  if (!ready) {
    pendingPreference = preference
    return
  }
  const current = currentPreference()
  if (current === undefined && localStorage.getItem(CHAT_THEME_STORAGE_KEY) !== null) return
  if (current === preference) {
    reportTheme()
    return
  }
  localStorage.setItem(CHAT_THEME_STORAGE_KEY, serializeChatThemeStorage(preference))
  location.reload()
}

expandSidebarOnLoad()

ipcRenderer.on(DESKTOP_THEME_CHANNELS.apply, (_event: IpcRendererEvent, value: unknown) => {
  if (isDesktopThemePreference(value)) applyPreference(value)
})

window.addEventListener('DOMContentLoaded', () => {
  ready = true
  const body = document.body
  const observer = new MutationObserver(reportTheme)
  const observation = { attributes: true, attributeFilter: ['class', 'data-ds-dark-theme', 'style'] }
  observer.observe(document.documentElement, observation)
  observer.observe(body, observation)
  window.addEventListener('pagehide', () => { observer.disconnect() }, { once: true })
  const preference = pendingPreference
  pendingPreference = undefined
  if (preference === undefined) requestAnimationFrame(reportTheme)
  else applyPreference(preference)
})
