/** Electron ownership adapter for the isolated DeepSeek Chat website. */

import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Event,
  IpcMain,
  IpcMainEvent,
  RenderProcessGoneDetails,
  Session,
  WebContents,
  WebContentsView,
  WebContentsViewConstructorOptions,
  WebContentsWillNavigateEventParams,
  WebContentsWillRedirectEventParams,
  WebPreferences,
} from 'electron'
import { CHAT_PARTITION, CHAT_URL, decideChatNavigation } from './chat-navigation.ts'
import type { DesktopThemedSurface } from './desktop-mode.ts'
import type { DesktopThemeState } from './desktop-theme-sync.ts'
import { DESKTOP_THEME_CHANNELS, isDesktopThemeState } from './desktop-theme-sync.ts'
import type { DesktopThemePreference } from './desktop-theme.ts'

const chatSurfaces = new WeakMap<Session, Set<() => Promise<void>>>()
const permissionOwners = new WeakMap<Session, symbol>()

const CHAT_WEB_PREFERENCES: Readonly<WebPreferences> = {
  partition: CHAT_PARTITION,
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
}

/** Electron factories and callbacks owned by one Chat surface. */
export interface ChatSurfaceOptions {
  readonly createView: (options: WebContentsViewConstructorOptions) => WebContentsView
  readonly ipcMain: IpcMain
  readonly themePreloadPath: string
  readonly removeView?: (view: WebContentsView) => void
  readonly chatSession: Session
  readonly openExternal: (url: string) => Promise<void>
  readonly createAuthWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow
  readonly onExternalNavigation: (url: string) => void
  readonly onFailure: (error: Error) => void
  readonly onThemeState: (state: DesktopThemeState) => void
  readonly onThemeAdapterError: (error: Error) => void
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function webPreferences(preload?: string): WebPreferences {
  return { ...CHAT_WEB_PREFERENCES, ...(preload === undefined ? {} : { preload }) }
}

/**
 * Clear a dedicated Chat partition after closing every registered Chat renderer.
 * @param chatSession - Persistent Electron session reserved for Chat.
 * @returns A promise that settles after view disposal, storage clearing, and cache clearing.
 */
export async function clearChatPartition(chatSession: Session): Promise<void> {
  const registered = [...(chatSurfaces.get(chatSession) ?? [])]
  await Promise.all(registered.map(dispose => dispose()))
  await chatSession.clearStorageData()
  await chatSession.clearCache()
}

/**
 * Create a restricted, persistent Chat renderer and its owned authentication windows.
 * @param options - Electron factories, dedicated session, and contained callbacks.
 * @returns A surface whose disposal closes every Chat-owned renderer.
 */
export async function createChatSurface(options: ChatSurfaceOptions): Promise<DesktopThemedSurface> {
  let disposed = false
  let failureReported = false
  const permissionOwner = Symbol('chat-permission-owner')
  const policyDisposers = new Set<() => void>()
  const ownedWindows = new Map<BrowserWindow, () => void>()

  const reportFailure = (error: Error): void => {
    if (disposed || failureReported) return
    failureReported = true
    try {
      options.onFailure(error)
    } catch (callbackError) {
      console.error('desktop Chat failure listener failed:', callbackError)
    }
  }
  const reportCallbackError = (subject: string, error: unknown): void => {
    console.error(`desktop Chat ${subject} failed:`, error)
  }
  const openExternal = (url: string): void => {
    void options.openExternal(url).catch((error: unknown) => { reportCallbackError('external open', error) })
  }
  const offerExternal = (url: string): void => {
    try {
      options.onExternalNavigation(url)
    } catch (error) {
      reportCallbackError('external navigation listener', error)
    }
  }

  const checkPermission: NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]> = () => false
  const requestPermission: NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]> = (
    _webContents,
    _permission,
    callback,
  ) => { callback(false) }
  permissionOwners.set(options.chatSession, permissionOwner)
  options.chatSession.setPermissionCheckHandler(checkPermission)
  options.chatSession.setPermissionRequestHandler(requestPermission)
  const resetPermissions = (): void => {
    if (permissionOwners.get(options.chatSession) !== permissionOwner) return
    permissionOwners.delete(options.chatSession)
    options.chatSession.setPermissionCheckHandler(null)
    options.chatSession.setPermissionRequestHandler(null)
  }

  const attachPolicy = (contents: WebContents): (() => void) => {
    const onNavigate = (event: Event<WebContentsWillNavigateEventParams>): void => {
      if (!event.isMainFrame) return
      const decision = decideChatNavigation('top-level', event.url)
      if (decision === 'allow') return
      event.preventDefault()
      if (decision === 'offer-external') offerExternal(event.url)
    }
    const onRedirect = (event: Event<WebContentsWillRedirectEventParams>): void => {
      if (!event.isMainFrame) return
      const decision = decideChatNavigation('redirect', event.url)
      if (decision !== 'allow') event.preventDefault()
    }
    const onFailedLoad = (
      _event: Event,
      errorCode: number,
      errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame || errorCode === -3) return
      reportFailure(new Error(`DeepSeek Chat failed to load (${String(errorCode)} ${errorDescription})`))
    }
    const onGone = (_event: Event, details: RenderProcessGoneDetails): void => {
      reportFailure(new Error(`DeepSeek Chat renderer exited: ${details.reason}`))
    }
    const onUnresponsive = (): void => {
      reportFailure(new Error('DeepSeek Chat renderer is unresponsive'))
    }

    contents.on('will-navigate', onNavigate)
    contents.on('will-redirect', onRedirect)
    contents.on('did-fail-load', onFailedLoad)
    contents.on('render-process-gone', onGone)
    contents.on('unresponsive', onUnresponsive)
    let attached = true
    const detach = (): void => {
      if (!attached) return
      attached = false
      policyDisposers.delete(detach)
      contents.off('will-navigate', onNavigate)
      contents.off('will-redirect', onRedirect)
      contents.off('did-fail-load', onFailedLoad)
      contents.off('render-process-gone', onGone)
      contents.off('unresponsive', onUnresponsive)
    }
    policyDisposers.add(detach)

    contents.setWindowOpenHandler(({ url }) => {
      const decision = decideChatNavigation('new-window', url)
      if (decision === 'open-external') {
        openExternal(url)
        return { action: 'deny' }
      }
      if (decision !== 'allow') return { action: 'deny' }

      try {
        const authWindow = options.createAuthWindow({
          width: 560,
          height: 720,
          show: true,
          autoHideMenuBar: true,
          webPreferences: webPreferences(),
        })
        const detachPolicy = attachPolicy(authWindow.webContents)
        const disposeAuthWindow = (): void => {
          if (!ownedWindows.delete(authWindow)) return
          authWindow.off('closed', onClosed)
          detachPolicy()
          if (!authWindow.isDestroyed()) authWindow.destroy()
        }
        const onClosed = (): void => {
          if (!ownedWindows.delete(authWindow)) return
          detachPolicy()
        }
        ownedWindows.set(authWindow, disposeAuthWindow)
        authWindow.once('closed', onClosed)
        void authWindow.loadURL(url).catch((error: unknown) => {
          reportFailure(asError(error))
          disposeAuthWindow()
        })
      } catch (error) {
        reportFailure(asError(error))
      }
      return { action: 'deny' }
    })
    return detach
  }

  let view: WebContentsView
  try {
    view = options.createView({ webPreferences: webPreferences(options.themePreloadPath) })
    view.setVisible(false)
    attachPolicy(view.webContents)
  } catch (error) {
    for (const detachPolicy of [...policyDisposers]) detachPolicy()
    resetPermissions()
    throw error
  }

  const contents = view.webContents
  const onThemeState = (event: IpcMainEvent, value: unknown): void => {
    if (event.sender !== contents || !isDesktopThemeState(value)) return
    try {
      options.onThemeState(value)
    } catch (error) {
      reportCallbackError('theme listener', error)
    }
  }
  const onThemeAdapterError = (event: IpcMainEvent, value: unknown): void => {
    if (event.sender !== contents || typeof value !== 'string' || value.length === 0) return
    try {
      options.onThemeAdapterError(new Error(value))
    } catch (error) {
      reportCallbackError('theme adapter listener', error)
    }
  }
  options.ipcMain.on(DESKTOP_THEME_CHANNELS.report, onThemeState)
  options.ipcMain.on(DESKTOP_THEME_CHANNELS.adapterError, onThemeAdapterError)
  const detachThemeIpc = (): void => {
    options.ipcMain.off(DESKTOP_THEME_CHANNELS.report, onThemeState)
    options.ipcMain.off(DESKTOP_THEME_CHANNELS.adapterError, onThemeAdapterError)
  }
  policyDisposers.add(detachThemeIpc)

  let disposePromise: Promise<void> | undefined
  const dispose = (): Promise<void> => {
    disposePromise ??= Promise.resolve().then(() => {
      disposed = true
      for (const detachPolicy of [...policyDisposers]) detachPolicy()
      for (const disposeAuthWindow of [...ownedWindows.values()]) disposeAuthWindow()
      options.removeView?.(view)
      if (!view.webContents.isDestroyed()) view.webContents.close()
      chatSurfaces.get(options.chatSession)?.delete(dispose)
      resetPermissions()
    })
    return disposePromise
  }

  const registered = chatSurfaces.get(options.chatSession) ?? new Set<() => Promise<void>>()
  registered.add(dispose)
  chatSurfaces.set(options.chatSession, registered)

  try {
    await view.webContents.loadURL(CHAT_URL)
  } catch (error) {
    await dispose()
    throw error
  }

  return {
    setBounds(bounds) { view.setBounds({ ...bounds }) },
    setVisible(visible) { view.setVisible(visible) },
    reload() { view.webContents.reload() },
    setThemePreference(preference: DesktopThemePreference) {
      if (!contents.isDestroyed()) contents.send(DESKTOP_THEME_CHANNELS.apply, preference)
    },
    dispose,
  }
}
