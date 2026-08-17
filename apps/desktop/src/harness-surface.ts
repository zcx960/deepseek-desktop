/** Electron ownership adapter for one restartable loopback Harness surface. */

import type {
  Event,
  IpcMain,
  IpcMainEvent,
  RenderProcessGoneDetails,
  WebContentsView,
  WebContentsViewConstructorOptions,
  WebContentsWillNavigateEventParams,
  WebContentsWillRedirectEventParams,
} from 'electron'
import type { DesktopThemedSurface } from './desktop-mode.ts'
import type { DesktopThemeState } from './desktop-theme-sync.ts'
import { DESKTOP_THEME_CHANNELS, isDesktopThemeState } from './desktop-theme-sync.ts'
import type { DesktopThemePreference } from './desktop-theme.ts'
import type { HostSupervisor } from './host-supervisor.ts'

/** Electron and Host dependencies owned by one Harness surface. */
export interface HarnessSurfaceOptions {
  readonly host: HostSupervisor
  readonly createView: (options: WebContentsViewConstructorOptions) => WebContentsView
  readonly ipcMain: IpcMain
  readonly themePreloadPath: string
  readonly removeView?: (view: WebContentsView) => void
  readonly openExternal: (url: string) => Promise<void>
  readonly onFailure: (error: Error) => void
  readonly onThemeColor: (color: string | null) => void
  readonly onThemeState: (state: DesktopThemeState) => void
  readonly platform: NodeJS.Platform
}

function sameOrigin(raw: string, origin: string): boolean {
  try {
    return new URL(raw).origin === origin
  } catch {
    return false
  }
}

function isWebUrl(raw: string): boolean {
  try {
    const protocol = new URL(raw).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Start a Host and load its loopback UI into a restricted child view.
 * @param options - Host ownership, Electron factories, and failure callbacks.
 * @returns A surface that closes its view and joins Host shutdown on disposal.
 */
export async function createHarnessSurface(options: HarnessSurfaceOptions): Promise<DesktopThemedSurface> {
  let disposed = false
  let failureReported = false
  const reportFailure = (error: Error): void => {
    if (disposed || failureReported) return
    failureReported = true
    try {
      options.onFailure(error)
    } catch (callbackError) {
      console.error('desktop Harness failure listener failed:', callbackError)
    }
  }
  const openExternal = (url: string): void => {
    void options.openExternal(url).catch((error: unknown) => {
      console.error('desktop Harness external open failed:', error)
    })
  }

  let origin: string
  try {
    origin = await options.host.start()
  } catch (error) {
    await options.host.shutdown()
    throw error
  }

  let view: WebContentsView
  try {
    view = options.createView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        preload: options.themePreloadPath,
      },
    })
    view.setVisible(false)
  } catch (error) {
    await options.host.shutdown()
    throw error
  }

  const contents = view.webContents
  const listenerDisposers: Array<() => void> = []
  const onNavigate = (event: Event<WebContentsWillNavigateEventParams>): void => {
    if (!event.isMainFrame || sameOrigin(event.url, origin)) return
    event.preventDefault()
    if (isWebUrl(event.url)) openExternal(event.url)
  }
  const onRedirect = (event: Event<WebContentsWillRedirectEventParams>): void => {
    if (event.isMainFrame && !sameOrigin(event.url, origin)) event.preventDefault()
  }
  const onFailedLoad = (
    _event: Event,
    errorCode: number,
    errorDescription: string,
    validatedURL: string,
    isMainFrame: boolean,
  ): void => {
    if (!isMainFrame || errorCode === -3) return
    reportFailure(new Error(`Harness failed to load (${String(errorCode)} ${errorDescription}): ${validatedURL}`))
  }
  const onGone = (_event: Event, details: RenderProcessGoneDetails): void => {
    reportFailure(new Error(`Harness renderer exited: ${details.reason}`))
  }
  const onUnresponsive = (): void => {
    reportFailure(new Error('Harness renderer is unresponsive'))
  }
  const onThemeColor = (_event: Event, color: string | null): void => {
    try {
      options.onThemeColor(color)
    } catch (error) {
      console.error('desktop Harness theme listener failed:', error)
    }
  }
  const onThemeState = (event: IpcMainEvent, value: unknown): void => {
    if (event.sender !== contents || !isDesktopThemeState(value)) return
    try {
      options.onThemeState(value)
    } catch (error) {
      console.error('desktop Harness theme bridge listener failed:', error)
    }
  }

  contents.on('will-navigate', onNavigate)
  contents.on('will-redirect', onRedirect)
  contents.on('did-fail-load', onFailedLoad)
  contents.on('render-process-gone', onGone)
  contents.on('unresponsive', onUnresponsive)
  contents.on('did-change-theme-color', onThemeColor)
  options.ipcMain.on(DESKTOP_THEME_CHANNELS.report, onThemeState)
  contents.setWindowOpenHandler(({ url }) => {
    if (!sameOrigin(url, origin) && isWebUrl(url)) openExternal(url)
    return { action: 'deny' }
  })
  listenerDisposers.push(
    () => { contents.off('will-navigate', onNavigate) },
    () => { contents.off('will-redirect', onRedirect) },
    () => { contents.off('did-fail-load', onFailedLoad) },
    () => { contents.off('render-process-gone', onGone) },
    () => { contents.off('unresponsive', onUnresponsive) },
    () => { contents.off('did-change-theme-color', onThemeColor) },
    () => { options.ipcMain.off(DESKTOP_THEME_CHANNELS.report, onThemeState) },
  )
  const stopExitSubscription = options.host.onUnexpectedExit(({ code, signal }) => {
    reportFailure(new Error(`desktop Host exited unexpectedly (code ${String(code)}, signal ${String(signal)})`))
  })

  let disposePromise: Promise<void> | undefined
  const dispose = (): Promise<void> => {
    disposePromise ??= (async () => {
      disposed = true
      stopExitSubscription()
      for (const removeListener of listenerDisposers.splice(0)) removeListener()
      options.removeView?.(view)
      if (!contents.isDestroyed()) contents.close()
      await options.host.shutdown()
    })()
    return disposePromise
  }

  const rendererUrl = new URL(origin)
  rendererUrl.searchParams.set('dsh-desktop-platform', options.platform)
  rendererUrl.searchParams.set('dsh-desktop-embedded', '1')
  try {
    await contents.loadURL(rendererUrl.href)
  } catch (error) {
    await dispose()
    throw error
  }

  return {
    setBounds(bounds) { view.setBounds({ ...bounds }) },
    setVisible(visible) { view.setVisible(visible) },
    reload() { contents.reload() },
    setThemePreference(preference: DesktopThemePreference) {
      if (!contents.isDestroyed()) contents.send(DESKTOP_THEME_CHANNELS.apply, preference)
    },
    dispose,
  }
}
