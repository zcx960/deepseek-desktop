/** Closed main-world bridge for the trusted loopback Harness renderer. */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { DESKTOP_THEME_CHANNELS } from './desktop-theme-sync.ts'

contextBridge.exposeInMainWorld('dshDesktopTheme', {
  publish(value: unknown): void {
    ipcRenderer.send(DESKTOP_THEME_CHANNELS.report, value)
  },
  subscribe(listener: (preference: unknown) => void): () => void {
    const receive = (_event: IpcRendererEvent, value: unknown): void => { listener(value) }
    ipcRenderer.on(DESKTOP_THEME_CHANNELS.apply, receive)
    return () => { ipcRenderer.off(DESKTOP_THEME_CHANNELS.apply, receive) }
  },
})
