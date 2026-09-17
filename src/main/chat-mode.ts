/**
 * Chat mode integration for the main window.
 *
 * Harness occupies `BrowserWindow.webContents`, which is not a `View` and
 * therefore cannot be hidden. Chat is instead attached to `contentView` as an
 * overlay: while it is visible it wins the paint order, and while it is hidden
 * Harness underneath keeps running with its sessions and background work
 * intact. Switching modes consequently never reloads or restarts Harness.
 *
 * Two independent views are managed here:
 *
 * - the Chat overlay, which fills the content area when Chat is selected, and
 * - the mode chrome, a small always-on-top selector in the trailing title-bar
 *   space this desktop already reserves for buttons.
 *
 * The chrome view sits above the overlay so the selector stays reachable while
 * Chat is showing.
 */

import { BrowserWindow, WebContentsView, type IpcMain } from 'electron'
import type { DesktopMode, DesktopModeSnapshot, DesktopModeStatus, DesktopThemedSurface } from '../shared/desktop-mode'
import type { DesktopThemeCoordinator } from '../shared/desktop-theme-sync'
import {
  DESKTOP_SHELL_CHANNELS,
  isDesktopChromeSurface,
  isDesktopShellCommand,
  type DesktopChromeSurface,
  type DesktopShellCommand,
} from '../shared/shell-protocol'
import { desktopChromeBounds } from './desktop-chrome-layout'
import { createChatSurface } from './chat-surface'

/**
 * Height reserved above the Chat page for the native title bar.
 *
 * macOS draws its traffic lights in the leading band, and the mode selector
 * occupies the same strip at the trailing edge, so this matches the selector's
 * bottom edge: the strip is the application's title bar and the Chat page fills
 * everything below it.
 */
const CHAT_TITLEBAR_INSET = 38

/** Callbacks the window integration needs from the composition root. */
export interface ChatModeOptions {
  readonly window: BrowserWindow
  readonly ipcMain: IpcMain
  /** Preload that binds the embedded Chat theme to the desktop carrier. */
  readonly chatThemePreloadPath: string
  /** Preload that binds the title-bar selector to the shell protocol. */
  readonly chromePreloadPath: string
  /** Load the selector document into its view. */
  readonly loadChrome: (contents: import('electron').WebContents, query: Record<string, string>) => Promise<void>
  /** Persistent Chat partition session, loaded by the caller. */
  readonly chatSession: Parameters<typeof createChatSurface>[0]['chatSession']
  /** Open a URL in the operator's default browser. */
  readonly openExternal: (url: string) => Promise<void>
  /** Read the persisted mode selection, or `undefined` on first launch. */
  readonly readSavedMode: () => DesktopMode | undefined
  /** Persist the mode selection. */
  readonly writeSavedMode: (mode: DesktopMode) => Promise<void>
  readonly theme: DesktopThemeCoordinator
  /** Report a selector command that needs the composition root. */
  readonly onCommand: (command: DesktopShellCommand) => void
  /** Push the current snapshot to every chrome renderer. */
  readonly publishSnapshot: (snapshot: DesktopModeSnapshot) => void
}

/** Live Chat mode wiring owned by one window. */
export interface ChatMode {
  /** Current selection and per-mode phases, for chrome renderers joining late. */
  snapshot(): DesktopModeSnapshot
  /** Select a mode, creating the Chat overlay the first time it is needed. */
  select(mode: DesktopMode): Promise<void>
  /** Re-apply overlay and selector bounds after a window resize. */
  resize(): void
  /** Push the coordinator's resolved scheme to the selector renderer. */
  syncTheme(): void
  /** Dispose both views and detach every listener. */
  dispose(): Promise<void>
}

/**
 * Create the Chat overlay and the title-bar selector for one window.
 * @param options - Window, IPC surface, and composition-root callbacks.
 * @returns The integration handle.
 */
export function createChatMode(options: ChatModeOptions): ChatMode {
  const { window, ipcMain, theme } = options
  let surface: DesktopThemedSurface | undefined
  let overlay: WebContentsView | undefined
  let chrome: WebContentsView | undefined
  let status: DesktopModeStatus = { phase: 'idle' }
  let selected: DesktopMode = options.readSavedMode() ?? 'harness'
  let chromeSurface: DesktopChromeSurface = 'closed'
  let disconnectTheme: (() => void) | undefined
  let creating: Promise<void> | undefined
  let disposed = false

  const snapshot = (): DesktopModeSnapshot => ({
    selected,
    chat: { ...status },
    harness: { phase: 'ready' },
    pendingExternalUrl: false,
  })

  /**
   * Content-area size in the coordinate space child views use.
   *
   * `getContentBounds()` reports screen coordinates, but `WebContentsView.setBounds`
   * is relative to the window's content area. Carrying the screen offset over
   * would place every overlay outside the visible frame.
   */
  const contentBounds = (): { x: number; y: number; width: number; height: number } => {
    const { width, height } = window.getContentBounds()
    return { x: 0, y: 0, width, height }
  }

  /**
   * Bounds for the Chat page itself.
   *
   * DeepSeek Chat draws its own header flush to the top of the viewport, which
   * puts its logo under the macOS traffic lights. Its header lives in an
   * absolutely positioned band (`.the-header` inside a 60px container) whose
   * class names are build-hashed, so instead of patching page CSS this reserves
   * the title-bar strip and lets the page keep its own layout below it.
   */
  const chatBounds = (): { x: number; y: number; width: number; height: number } => {
    const { width, height } = window.getContentBounds()
    return {
      x: 0,
      y: CHAT_TITLEBAR_INSET,
      width,
      height: Math.max(0, height - CHAT_TITLEBAR_INSET),
    }
  }

  /** Recompute both views: the overlay fills the window, the selector sits top-right. */
  const syncBounds = (): void => {
    if (disposed || window.isDestroyed()) return
    if (surface !== undefined && overlay !== undefined) {
      surface.setBounds(chatBounds())
    }
    if (chrome !== undefined) {
      chrome.setBounds(desktopChromeBounds({
        platform: process.platform,
        mode: selected,
        surface: chromeSurface,
        content: contentBounds(),
      }))
    }
  }

  /** Push theme and selector geometry to the chrome renderer. */
  const syncChrome = (): void => {
    if (chrome === undefined || chrome.webContents.isDestroyed()) return
    const { scheme } = theme.snapshot()
    chrome.webContents.send(DESKTOP_SHELL_CHANNELS.chromeTheme, scheme)
    chrome.webContents.send(DESKTOP_SHELL_CHANNELS.chromeLayout, {
      surface: chromeSurface,
      dismissMenus: false,
    })
    chrome.webContents.send(DESKTOP_SHELL_CHANNELS.snapshot, snapshot())
  }

  /** Create the Chat surface once and keep it hidden until selected. */
  const ensureSurface = async (): Promise<void> => {
    if (disposed || surface !== undefined) return
    creating ??= (async () => {
      status = { phase: 'loading' }
      try {
        const created = await createChatSurface({
          createView: (viewOptions) => {
            const createdView = new WebContentsView(viewOptions)
            createdView.setBackgroundColor('#ffffff')
            window.contentView.addChildView(createdView)
            overlay = createdView
            return createdView
          },
          removeView: (removed) => {
            if (!window.isDestroyed()) window.contentView.removeChildView(removed)
            if (overlay === removed) overlay = undefined
          },
          ipcMain,
          chatSession: options.chatSession,
          themePreloadPath: options.chatThemePreloadPath,
          openExternal: options.openExternal,
          createAuthWindow: (authOptions) => new BrowserWindow(authOptions),
          onExternalNavigation: (url) => { void options.openExternal(url) },
          onFailure: (error) => { status = { phase: 'failed', message: error.message } },
          onThemeState: (state) => {
            theme.report('chat', state)
            syncChrome()
          },
          onThemeAdapterError: () => undefined,
        })
        if (disposed) {
          await created.dispose()
          return
        }
        surface = created
        syncBounds()
        apply()
        // The coordinator drives this mode's preference whenever Harness is the
        // authority; the surface relays it to the Chat renderer's local switch.
        disconnectTheme = theme.connect('chat', (preference) => {
          created.setThemePreference(preference)
        })
        status = { phase: 'ready' }
      } catch (error) {
        status = { phase: 'failed', message: error instanceof Error ? error.message : String(error) }
      } finally {
        creating = undefined
      }
    })()
    await creating
  }

  /** Create the always-on-top selector view. */
  const ensureChrome = (): void => {
    if (disposed || chrome !== undefined || window.isDestroyed()) return
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: options.chromePreloadPath,
        sandbox: true,
        webSecurity: true,
      },
    })
    view.setBackgroundColor('#00000000')
    window.contentView.addChildView(view)
    chrome = view
    syncBounds()
    void options
      .loadChrome(view.webContents, { platform: process.platform })
      .then(() => { syncChrome() })
      .catch(() => undefined)
  }

  /**
   * Apply the selection to the overlay stack, the keyboard, and the shared
   * theme authority. Focus must move explicitly: the overlay covers Harness
   * completely, so leaving focus behind would send keystrokes to a renderer the
   * operator cannot see.
   */
  const apply = (): void => {
    const showChat = selected === 'chat' && status.phase === 'ready'
    surface?.setVisible(showChat)
    // `addChildView` appends to the top of the stack, so a Chat overlay created
    // after the selector would cover it. Re-adding the selector keeps it
    // reachable in both modes.
    if (chrome !== undefined && !window.isDestroyed()) {
      window.contentView.addChildView(chrome)
    }
    theme.select(selected)
    if (!window.isDestroyed()) {
      const target = showChat ? overlay?.webContents : window.webContents
      if (target !== undefined && !target.isDestroyed()) target.focus()
    }
    publish()
  }

  const publish = (): void => {
    options.publishSnapshot(snapshot())
    syncChrome()
  }

  const onResize = (): void => { syncBounds() }
  const onSelect = (_event: unknown, mode: unknown): void => {
    if (mode !== 'chat' && mode !== 'harness') return
    void select(mode)
  }
  const onChromeSurface = (_event: unknown, next: unknown): void => {
    if (!isDesktopChromeSurface(next)) return
    chromeSurface = next
    syncBounds()
    syncChrome()
  }
  const onCommand = (_event: unknown, command: unknown): void => {
    if (!isDesktopShellCommand(command)) return
    if (command === 'reload-chat') {
      surface?.reload()
      return
    }
    options.onCommand(command)
  }

  const select = async (mode: DesktopMode): Promise<void> => {
    if (disposed) return
    selected = mode
    await options.writeSavedMode(mode)
    if (mode === 'chat') await ensureSurface()
    apply()
  }

  window.on('resize', onResize)
  window.on('enter-full-screen', onResize)
  window.on('leave-full-screen', onResize)
  ipcMain.on(DESKTOP_SHELL_CHANNELS.select, onSelect)
  ipcMain.on(DESKTOP_SHELL_CHANNELS.chromeSurface, onChromeSurface)
  ipcMain.on(DESKTOP_SHELL_CHANNELS.command, onCommand)

  ensureChrome()
  if (selected === 'chat') void select('chat')
  else apply()

  return {
    snapshot,
    select,
    resize: syncBounds,
    syncTheme: syncChrome,
    async dispose() {
      if (disposed) return
      disposed = true
      window.off('resize', onResize)
      window.off('enter-full-screen', onResize)
      window.off('leave-full-screen', onResize)
      ipcMain.off(DESKTOP_SHELL_CHANNELS.select, onSelect)
      ipcMain.off(DESKTOP_SHELL_CHANNELS.chromeSurface, onChromeSurface)
      ipcMain.off(DESKTOP_SHELL_CHANNELS.command, onCommand)
      const live = surface
      const liveChrome = chrome
      const disconnect = disconnectTheme
      surface = undefined
      overlay = undefined
      chrome = undefined
      disconnectTheme = undefined
      disconnect?.()
      if (liveChrome !== undefined) {
        if (!window.isDestroyed()) window.contentView.removeChildView(liveChrome)
        if (!liveChrome.webContents.isDestroyed()) liveChrome.webContents.close()
      }
      if (live !== undefined) await live.dispose()
    },
  }
}
