import type { ChatBounds, ChatSnapshot, DesktopMode } from './types'
import { invoke } from '@tauri-apps/api/core'
import { Store } from '@tauri-apps/plugin-store'
import { defineStore } from 'valtio-define'
import { acceptSnapshot, restoredMode } from './types'

let initialization: Promise<void> | undefined
let tail = Promise.resolve()
let pending = 0
let preferences: Promise<Store> | undefined
let lastLayout: { bounds: ChatBounds, occluded: boolean } | undefined

function modePreferences() {
  preferences ??= Store.load(import.meta.env.DEV ? '.desktop-mode.dev.dat' : '.desktop-mode.dat')
  return preferences
}

export const desktopMode = defineStore({
  state: () => ({
    selected: 'harness' as DesktopMode,
    chat: { phase: 'idle', error: null, generation: 0 } as ChatSnapshot,
    initialized: false,
    busy: false,
    error: '',
    notice: '',
    overlayDepth: 0,
  }),
  actions: {
    receive(snapshot: ChatSnapshot) {
      if (acceptSnapshot(this.chat, snapshot))
        this.chat = snapshot
    },
    initialize() {
      initialization ??= enqueue(async () => {
        try {
          const preferences = await modePreferences()
          const mode = restoredMode(await preferences.get('selected'))
          const snapshot = await invoke<ChatSnapshot>('desktop_chat_select', { mode })
          this.selected = mode
          this.receive(snapshot)
        }
        catch (error) {
          this.error = String(error)
        }
        finally {
          this.initialized = true
        }
      })
      return initialization
    },
    select(mode: DesktopMode) {
      return enqueue(async () => {
        this.error = ''
        try {
          const snapshot = await invoke<ChatSnapshot>('desktop_chat_select', { mode })
          this.selected = mode
          this.receive(snapshot)
          const preferences = await modePreferences()
          await preferences.set('selected', mode)
          await preferences.save()
        }
        catch (error) {
          this.error = String(error)
        }
      })
    },
    retryChat() {
      return enqueue(async () => {
        this.error = ''
        try {
          this.receive(await invoke<ChatSnapshot>('desktop_chat_retry'))
        }
        catch (error) {
          this.error = String(error)
        }
      })
    },
    clearChatData() {
      return enqueue(async () => {
        this.error = ''
        this.notice = ''
        try {
          this.receive(await invoke<ChatSnapshot>('desktop_chat_clear'))
          this.notice = 'chat.clear_success'
        }
        catch (error) {
          this.error = String(error)
          throw error
        }
      })
    },
    async openChatBrowser() {
      try {
        await invoke('desktop_chat_open_browser')
      }
      catch (error) {
        this.error = String(error)
      }
    },
    async syncLayout(bounds: ChatBounds, occluded: boolean) {
      lastLayout = { bounds, occluded }
      await invoke('desktop_chat_layout', { bounds, occluded: occluded || this.overlayDepth > 0 })
    },
    async suspendChat() {
      this.overlayDepth++
      if (lastLayout)
        await invoke('desktop_chat_layout', { bounds: lastLayout.bounds, occluded: true })
    },
    resumeChat() {
      this.overlayDepth = Math.max(0, this.overlayDepth - 1)
    },
  },
})

function enqueue(operation: () => Promise<void>) {
  pending++
  desktopMode.busy = true
  const next = tail.then(operation).finally(() => {
    pending--
    desktopMode.busy = pending > 0
  })
  tail = next.catch(() => {})
  return next
}
