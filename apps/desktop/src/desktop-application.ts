/** Injectable Electron composition for the independent Chat and Harness desktop modes. */

import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Event,
  IpcMain,
  IpcMainEvent,
  Session,
  WebContentsView,
  WebContentsViewConstructorOptions,
} from 'electron'
import { CHAT_URL } from './chat-navigation.ts'
import { clearChatPartition, createChatSurface } from './chat-surface.ts'
import {
  desktopChromeBounds,
  insetDesktopContentBounds,
} from './desktop-chrome-layout.ts'
import {
  createDesktopModeController,
  type DesktopModeController,
} from './desktop-mode-controller.ts'
import type {
  DesktopContentBounds,
  DesktopMode,
  DesktopModeSnapshot,
  DesktopSurface,
  DesktopThemedSurface,
} from './desktop-mode.ts'
import { loadDesktopMode, saveDesktopMode } from './desktop-state.ts'
import {
  schemeForThemeColor,
  type DesktopColorScheme,
  type DesktopSystemTheme,
} from './desktop-theme.ts'
import {
  createDesktopThemeCoordinator,
  type DesktopThemeCoordinator,
  type DesktopThemeSnapshot,
  type DesktopThemeState,
} from './desktop-theme-sync.ts'
import { createHarnessSurface } from './harness-surface.ts'
import type { HostSupervisor } from './host-supervisor.ts'
import {
  DESKTOP_TITLEBAR_HEIGHT,
  DESKTOP_SHELL_CHANNELS,
  isDesktopChromeSurface,
  isDesktopShellCommand,
  type DesktopChromeSurface,
  type DesktopShellCommand,
} from './shell-protocol.ts'
import { createDesktopLifecycle } from './window-lifecycle.ts'

const APP_NAME = 'DeepSeek Desktop'
const WINDOW_WIDTH = 1440
const WINDOW_HEIGHT = 920

/** Native factories, paths, and side effects supplied by the production entrypoint. */
export interface DesktopApplicationOptions {
  readonly stateFile: string
  readonly shellPath: string
  readonly preloadPath: string
  readonly chromePath: string
  readonly chromePreloadPath: string
  readonly harnessThemePreloadPath: string
  readonly chatThemePreloadPath: string
  readonly platform: NodeJS.Platform
  readonly createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow
  readonly createView: (options: WebContentsViewConstructorOptions) => WebContentsView
  readonly createAuthWindow: DesktopApplicationOptions['createWindow']
  readonly createHost: () => HostSupervisor
  readonly chatSession: Session
  readonly ipcMain: IpcMain
  readonly openExternal: (url: string) => Promise<void>
  readonly quit: () => void
  readonly reportError: (error: unknown) => void
  readonly systemTheme: DesktopSystemTheme
  readonly onShellLoaded?: () => void
  readonly harnessSurfaceFactory?: (options: DesktopHarnessSurfaceFactoryOptions) => Promise<DesktopSurface>
  readonly chatSurfaceFactory?: (options: DesktopChatSurfaceFactoryOptions) => Promise<DesktopSurface>
  readonly clearChatStorage?: () => Promise<void>
}

/** Attached-view operations available to an injected Harness fixture adapter. */
export interface DesktopHarnessSurfaceFactoryOptions {
  readonly createView: DesktopApplicationOptions['createView']
  readonly removeView: (view: WebContentsView) => void
  readonly onFailure: (error: Error) => void
  readonly onThemeColor: (color: string | null) => void
  readonly onThemeState: (state: DesktopThemeState) => void
  readonly platform: NodeJS.Platform
}

/** Attached-view operations available to an injected Chat fixture adapter. */
export interface DesktopChatSurfaceFactoryOptions {
  readonly createView: DesktopApplicationOptions['createView']
  readonly removeView: (view: WebContentsView) => void
  readonly onExternalNavigation: (url: string) => void
  readonly onFailure: (error: Error) => void
  readonly onThemeState: (state: DesktopThemeState) => void
  readonly onThemeAdapterError: (error: Error) => void
}

/** Public lifecycle of one composed desktop application. */
export interface DesktopApplication {
  /** Create and reveal the local shell without waiting for Harness readiness. */
  start(): Promise<void>
  /** Restore and focus the current desktop window. */
  showWindow(): Promise<void>
  /** Join every surface disposer and release Electron quit. */
  requestQuit(): Promise<void>
  /** Return the current detached mode snapshot when a shell is active. */
  snapshot(): DesktopModeSnapshot | undefined
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function isDesktopMode(value: unknown): value is DesktopMode {
  return value === 'chat' || value === 'harness'
}

function contentBounds(window: BrowserWindow): DesktopContentBounds {
  const { width, height } = window.getContentBounds()
  return {
    x: 0,
    y: 0,
    width: Math.max(0, width),
    height: Math.max(0, height),
  }
}

function assertNever(value: never): never {
  throw new Error(`unsupported desktop shell command: ${String(value)}`)
}

/**
 * Compose the shell window, IPC, mode controller, and independent surfaces.
 * @param options - Electron factories, persistent paths, and application side effects.
 * @returns An application whose explicit quit waits for both mode surfaces.
 */
export function createDesktopApplication(options: DesktopApplicationOptions): DesktopApplication {
  let window: BrowserWindow | undefined
  let controller: DesktopModeController | undefined
  let startPromise: Promise<void> | undefined
  let disposalPromise: Promise<void> | undefined
  let controllerShutdown: Promise<void> = Promise.resolve()
  let disposed = false
  const attachedViews = new Set<WebContentsView>()
  const windowListenerDisposers: Array<() => void> = []
  let chromeView: WebContentsView | undefined
  let chromeLoaded = false
  let chromeSurface: DesktopChromeSurface = 'closed'
  let selectedMode: DesktopMode = 'harness'
  let systemScheme = options.systemTheme.getColorScheme()
  let harnessScheme: DesktopColorScheme | undefined
  let themeCoordinator: DesktopThemeCoordinator | undefined
  let themeSnapshot: DesktopThemeSnapshot | undefined

  const reportError = (error: unknown): void => {
    try {
      options.reportError(error)
    } catch (callbackError) {
      console.error('desktop error listener failed:', callbackError)
    }
  }

  const selectedScheme = (): DesktopColorScheme => {
    if (themeSnapshot?.authoritative === true) return themeSnapshot.scheme
    return selectedMode === 'harness' ? harnessScheme ?? systemScheme : systemScheme
  }

  const sendChromeTheme = (): void => {
    const scheme = selectedScheme()
    const titlebarBackground = selectedMode === 'chat'
      ? themeSnapshot?.backgroundColor ?? null
      : null
    const currentWindow = window
    const localContents = [
      currentWindow === undefined || currentWindow.isDestroyed()
        ? undefined
        : currentWindow.webContents,
      chromeLoaded ? chromeView?.webContents : undefined,
    ]
    for (const contents of localContents) {
      if (contents === undefined || contents.isDestroyed()) continue
      try {
        contents.send(DESKTOP_SHELL_CHANNELS.chromeTheme, scheme)
        if (contents === currentWindow?.webContents) {
          contents.send(DESKTOP_SHELL_CHANNELS.titlebarBackground, titlebarBackground)
        }
      } catch (error) {
        reportError(error)
      }
    }
  }

  const sendSnapshot = (snapshot: DesktopModeSnapshot): void => {
    selectedMode = snapshot.selected
    themeCoordinator?.select(selectedMode)
    setChromeBounds()
    const currentWindow = window
    if (currentWindow === undefined || currentWindow.isDestroyed()) return
    for (const contents of [currentWindow.webContents, chromeView?.webContents]) {
      if (contents === undefined || contents.isDestroyed()) continue
      try {
        contents.send(DESKTOP_SHELL_CHANNELS.snapshot, snapshot)
      } catch (error) {
        reportError(error)
      }
    }
    sendChromeTheme()
  }

  const onHarnessThemeColor = (color: string | null): void => {
    harnessScheme = schemeForThemeColor(color)
    if (selectedMode === 'harness' && themeSnapshot?.authoritative !== true) sendChromeTheme()
  }

  const connectTheme = (
    mode: DesktopMode,
    surface: DesktopThemedSurface,
    contentTopInset = 0,
  ): DesktopThemedSurface => {
    const themes = themeCoordinator
    if (themes === undefined) throw new Error('desktop theme coordinator is unavailable')
    const disconnect = themes.connect(mode, (preference) => { surface.setThemePreference(preference) })
    let disposed = false
    return {
      setBounds(bounds) {
        surface.setBounds(contentTopInset === 0
          ? bounds
          : insetDesktopContentBounds(bounds, contentTopInset))
      },
      setVisible(visible) { surface.setVisible(visible) },
      reload() { surface.reload() },
      setThemePreference(preference) { surface.setThemePreference(preference) },
      async dispose() {
        if (disposed) return
        disposed = true
        disconnect()
        await surface.dispose()
      },
    }
  }

  const createThemeConnection = (mode: DesktopMode, contentTopInset = 0) => {
    const themes = themeCoordinator
    if (themes === undefined) throw new Error('desktop theme coordinator is unavailable')
    let connected = false
    let pendingState: DesktopThemeState | undefined
    return {
      report(state: DesktopThemeState): void {
        if (!connected) {
          pendingState = state
          return
        }
        themes.report(mode, state)
      },
      connect(surface: DesktopThemedSurface): DesktopThemedSurface {
        const acceptPendingState = !themes.snapshot().authoritative
        connected = true
        const connectedSurface = connectTheme(mode, surface, contentTopInset)
        if (acceptPendingState && pendingState !== undefined) themes.report(mode, pendingState)
        pendingState = undefined
        return connectedSurface
      },
    }
  }

  const setChromeBounds = (dismissMenus = false): void => {
    const currentWindow = window
    const currentChrome = chromeView
    if (currentWindow === undefined || currentChrome === undefined || currentWindow.isDestroyed()) return
    const content = contentBounds(currentWindow)
    currentChrome.setBounds(desktopChromeBounds({
      platform: options.platform,
      mode: selectedMode,
      surface: chromeSurface,
      content,
    }))
    if (chromeLoaded && !currentChrome.webContents.isDestroyed()) {
      currentChrome.webContents.send(DESKTOP_SHELL_CHANNELS.chromeLayout, {
        surface: chromeSurface,
        dismissMenus,
      })
    }
  }

  const removeAttachedView = (view: WebContentsView): void => {
    if (!attachedViews.delete(view)) return
    const currentWindow = window
    if (currentWindow === undefined || currentWindow.isDestroyed()) return
    currentWindow.contentView.removeChildView(view)
  }

  const keepChromeAbove = (currentWindow: BrowserWindow): void => {
    const currentChrome = chromeView
    if (currentChrome === undefined) return
    currentWindow.contentView.removeChildView(currentChrome)
    currentWindow.contentView.addChildView(currentChrome)
  }

  const createAttachedView = (viewOptions: WebContentsViewConstructorOptions): WebContentsView => {
    const currentWindow = window
    if (currentWindow === undefined || currentWindow.isDestroyed()) {
      throw new Error('desktop window is unavailable for a content view')
    }
    const view = options.createView(viewOptions)
    currentWindow.contentView.addChildView(view)
    keepChromeAbove(currentWindow)
    attachedViews.add(view)
    return view
  }

  const disposeChrome = (): void => {
    const currentWindow = window
    const currentChrome = chromeView
    chromeView = undefined
    chromeLoaded = false
    if (currentChrome === undefined) return
    if (currentWindow !== undefined && !currentWindow.isDestroyed()) {
      currentWindow.contentView.removeChildView(currentChrome)
    }
    if (!currentChrome.webContents.isDestroyed()) currentChrome.webContents.close()
  }

  const runControllerOperation = (operation: (current: DesktopModeController) => Promise<void> | void): void => {
    const current = controller
    if (current === undefined) return
    void Promise.resolve().then(() => operation(current)).catch(async (error: unknown) => {
      if (controller !== current) return
      try {
        await current.fail(current.snapshot().selected, asError(error))
      } catch (failureError) {
        reportError(failureError)
      }
    })
  }

  const onSelectMode = (_event: IpcMainEvent, value: unknown): void => {
    if (!isDesktopMode(value)) return
    runControllerOperation(current => current.select(value))
  }

  const onChromeSurface = (_event: IpcMainEvent, value: unknown): void => {
    if (!isDesktopChromeSurface(value)) return
    chromeSurface = value
    setChromeBounds()
  }

  const performCommand = (current: DesktopModeController, command: DesktopShellCommand): Promise<void> | void => {
    switch (command) {
      case 'retry-chat': return current.retry('chat')
      case 'retry-harness': return current.retry('harness')
      case 'reload-chat':
        current.reloadChat()
        return
      case 'clear-chat-data': return current.clearChatData()
      case 'open-chat-browser': return options.openExternal(CHAT_URL)
      case 'open-pending-external': return current.openPendingExternal()
      default: return assertNever(command)
    }
  }

  const onShellCommand = (_event: IpcMainEvent, value: unknown): void => {
    if (!isDesktopShellCommand(value)) return
    runControllerOperation(current => performCommand(current, value))
  }

  options.ipcMain.on(DESKTOP_SHELL_CHANNELS.select, onSelectMode)
  options.ipcMain.on(DESKTOP_SHELL_CHANNELS.command, onShellCommand)
  options.ipcMain.on(DESKTOP_SHELL_CHANNELS.chromeSurface, onChromeSurface)
  const removeIpcListeners = (): void => {
    options.ipcMain.off(DESKTOP_SHELL_CHANNELS.select, onSelectMode)
    options.ipcMain.off(DESKTOP_SHELL_CHANNELS.command, onShellCommand)
    options.ipcMain.off(DESKTOP_SHELL_CHANNELS.chromeSurface, onChromeSurface)
  }

  const removeWindowListeners = (): void => {
    for (const dispose of windowListenerDisposers.splice(0)) dispose()
  }

  const stopController = (target: DesktopModeController | undefined): Promise<void> => {
    if (target === undefined) return Promise.resolve()
    return target.shutdown().catch((error: unknown) => { reportError(error) })
  }

  const disposeApplication = (): Promise<void> => {
    disposalPromise ??= (async () => {
      disposed = true
      removeIpcListeners()
      removeWindowListeners()
      const current = controller
      controller = undefined
      await stopController(current)
      await controllerShutdown
      disposeChrome()
      attachedViews.clear()
    })()
    return disposalPromise
  }

  const createWindow = async (): Promise<BrowserWindow> => {
    await controllerShutdown
    let initialMode: DesktopMode = 'harness'
    try {
      initialMode = await loadDesktopMode(options.stateFile)
    } catch (error) {
      reportError(error)
    }
    themeCoordinator = createDesktopThemeCoordinator({
      initialMode,
      initialSystemScheme: systemScheme,
      onChange: (snapshot) => {
        themeSnapshot = snapshot
        sendChromeTheme()
      },
    })
    themeSnapshot = themeCoordinator.snapshot()

    const nativeWindow = options.createWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      minWidth: 960,
      minHeight: 640,
      show: false,
      autoHideMenuBar: true,
      frame: options.platform === 'win32',
      titleBarStyle: options.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      ...(options.platform === 'darwin' ? {} : {
        titleBarOverlay: { color: '#00000000', symbolColor: '#7f858f', height: DESKTOP_TITLEBAR_HEIGHT },
      }),
      ...(options.platform === 'darwin' ? {
        trafficLightPosition: { x: 16, y: 18 },
        vibrancy: 'sidebar' as const,
        visualEffectState: 'followWindow' as const,
      } : {}),
      ...(options.platform === 'win32' ? {
        backgroundMaterial: 'acrylic' as const,
        hasShadow: true,
        roundedCorners: true,
        thickFrame: true,
      } : {
        transparent: true,
        backgroundColor: '#00000000',
      }),
      title: APP_NAME,
      webPreferences: {
        preload: options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
    window = nativeWindow

    const onClose = (event: Event): void => { lifecycle.onWindowClose(event) }
    const onResize = (): void => {
      const bounds = contentBounds(nativeWindow)
      setChromeBounds()
      controller?.resize(bounds)
    }
    const onClosed = (): void => {
      removeWindowListeners()
      if (window !== nativeWindow) return
      window = undefined
      const closedController = controller
      controller = undefined
      controllerShutdown = stopController(closedController)
      disposeChrome()
      attachedViews.clear()
    }
    nativeWindow.on('close', onClose)
    nativeWindow.on('resize', onResize)
    nativeWindow.on('closed', onClosed)
    windowListenerDisposers.push(
      () => { nativeWindow.off('close', onClose) },
      () => { nativeWindow.off('resize', onResize) },
      () => { nativeWindow.off('closed', onClosed) },
    )
    const stopSystemTheme = options.systemTheme.subscribe(() => {
      systemScheme = options.systemTheme.getColorScheme()
      if (themeCoordinator === undefined || themeSnapshot?.authoritative !== true) sendChromeTheme()
      else themeCoordinator.systemChanged(systemScheme)
    })
    windowListenerDisposers.push(stopSystemTheme)

    const readyToShow = new Promise<void>((resolve) => { nativeWindow.once('ready-to-show', resolve) })
    await Promise.all([nativeWindow.loadFile(options.shellPath), readyToShow])
    options.onShellLoaded?.()
    if (disposed) throw new Error('desktop application was disposed during shell load')

    try {
      chromeView = options.createView({
        webPreferences: {
          preload: options.chromePreloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      })
      chromeView.setBackgroundColor('#00000000')
      nativeWindow.contentView.addChildView(chromeView)
      const onChromeBlur = (): void => { setChromeBounds(true) }
      chromeView.webContents.on('blur', onChromeBlur)
      windowListenerDisposers.push(() => { chromeView?.webContents.off('blur', onChromeBlur) })
      setChromeBounds()
      await chromeView.webContents.loadFile(options.chromePath)
      chromeLoaded = true
      setChromeBounds()
      sendChromeTheme()
    } catch (error) {
      disposeChrome()
      throw error
    }

    const nextController = createDesktopModeController({
      initialMode,
      createHarness: async (onFailure) => {
        const themeConnection = createThemeConnection('harness')
        const factoryOptions: DesktopHarnessSurfaceFactoryOptions = {
          createView: createAttachedView,
          removeView: removeAttachedView,
          onFailure,
          onThemeColor: onHarnessThemeColor,
          onThemeState: (state) => { themeConnection.report(state) },
          platform: options.platform,
        }
        const surface = options.harnessSurfaceFactory === undefined
          ? await createHarnessSurface({
            ...factoryOptions,
            host: options.createHost(),
            ipcMain: options.ipcMain,
            themePreloadPath: options.harnessThemePreloadPath,
            openExternal: options.openExternal,
          })
          : await options.harnessSurfaceFactory(factoryOptions) as DesktopThemedSurface
        return themeConnection.connect(surface)
      },
      createChat: async (onFailure) => {
        const themeConnection = createThemeConnection('chat', DESKTOP_TITLEBAR_HEIGHT)
        const factoryOptions: DesktopChatSurfaceFactoryOptions = {
          createView: createAttachedView,
          removeView: removeAttachedView,
          onExternalNavigation: (url) => { nextController.offerExternalUrl(url) },
          onFailure,
          onThemeState: (state) => { themeConnection.report(state) },
          onThemeAdapterError: reportError,
        }
        const surface = options.chatSurfaceFactory === undefined
          ? await createChatSurface({
            ...factoryOptions,
            chatSession: options.chatSession,
            ipcMain: options.ipcMain,
            themePreloadPath: options.chatThemePreloadPath,
            openExternal: options.openExternal,
            createAuthWindow: options.createAuthWindow,
          })
          : await options.chatSurfaceFactory(factoryOptions) as DesktopThemedSurface
        return themeConnection.connect(surface)
      },
      clearChatStorage: options.clearChatStorage
        ?? (async () => { await clearChatPartition(options.chatSession) }),
      openExternal: options.openExternal,
      saveMode: async (mode) => { await saveDesktopMode(options.stateFile, mode) },
      onChange: sendSnapshot,
    })
    controller = nextController
    nextController.resize(contentBounds(nativeWindow))
    setChromeBounds()
    sendSnapshot(nextController.snapshot())
    void nextController.start().catch((error: unknown) => { reportError(error) })
    return nativeWindow
  }

  const lifecycle = createDesktopLifecycle({
    getWindow: () => window,
    createWindow,
    disposeApplication,
    quit: options.quit,
    reportError,
  })

  return {
    start() {
      startPromise ??= lifecycle.showWindow()
      return startPromise
    },
    showWindow() { return lifecycle.showWindow() },
    requestQuit() { return lifecycle.requestQuit() },
    snapshot() { return controller?.snapshot() },
  }
}
