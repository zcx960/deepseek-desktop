/** Production Electron entrypoint for the dual-mode desktop application. */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  session,
  shell,
  Tray,
  WebContentsView,
  type Event,
  type MenuItemConstructorOptions,
} from 'electron'
import { CHAT_PARTITION } from './chat-navigation.ts'
import {
  createDesktopApplication,
  type DesktopApplication,
} from './desktop-application.ts'
import { createHostSupervisor, spawnDshWeb } from './host-supervisor.ts'

const APP_NAME = 'DeepSeek Harness'
const DESKTOP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPOSITORY_ROOT = resolve(DESKTOP_DIR, '../..')

let desktopApplication: DesktopApplication | undefined
let tray: Tray | undefined
let quitReleased = false

/** Resolve Host artifacts from the checkout or packaged resources. */
function hostPaths(): { nodeExecutable: string; cliEntry: string; cwd: string; electronRunAsNode: boolean } {
  if (!app.isPackaged) {
    return {
      nodeExecutable: process.env.DSH_DESKTOP_NODE_EXECUTABLE ?? 'node',
      cliEntry: join(REPOSITORY_ROOT, 'apps/cli/lib/bin.js'),
      cwd: process.cwd(),
      electronRunAsNode: false,
    }
  }
  return {
    nodeExecutable: process.execPath,
    cliEntry: join(process.resourcesPath, 'host/node_modules/@deepseek-ai/dsh/lib/bin.js'),
    cwd: app.getPath('home'),
    electronRunAsNode: true,
  }
}

function assertHostArtifacts(paths: ReturnType<typeof hostPaths>): void {
  if (paths.nodeExecutable.includes('/') && !existsSync(paths.nodeExecutable)) {
    throw new Error(`desktop Node runtime is missing: ${paths.nodeExecutable}`)
  }
  if (!existsSync(paths.cliEntry)) {
    throw new Error(`desktop Host entry is missing: ${paths.cliEntry}; run pnpm run build first`)
  }
}

function shellPaths(): {
  shellPath: string
  preloadPath: string
  chromePath: string
  chromePreloadPath: string
  harnessThemePreloadPath: string
  chatThemePreloadPath: string
} {
  if (app.isPackaged) {
    return {
      shellPath: join(process.resourcesPath, 'desktop-resources/shell.html'),
      preloadPath: join(process.resourcesPath, 'app.asar.unpacked/lib/shell-preload.cjs'),
      chromePath: join(process.resourcesPath, 'desktop-resources/mode-chrome.html'),
      chromePreloadPath: join(process.resourcesPath, 'app.asar.unpacked/lib/mode-chrome-preload.cjs'),
      harnessThemePreloadPath: join(process.resourcesPath, 'app.asar.unpacked/lib/harness-theme-preload.cjs'),
      chatThemePreloadPath: join(process.resourcesPath, 'app.asar.unpacked/lib/chat-theme-preload.cjs'),
    }
  }
  return {
    shellPath: join(DESKTOP_DIR, 'resources/shell.html'),
    preloadPath: join(DESKTOP_DIR, 'lib/shell-preload.cjs'),
    chromePath: join(DESKTOP_DIR, 'resources/mode-chrome.html'),
    chromePreloadPath: join(DESKTOP_DIR, 'lib/mode-chrome-preload.cjs'),
    harnessThemePreloadPath: join(DESKTOP_DIR, 'lib/harness-theme-preload.cjs'),
    chatThemePreloadPath: join(DESKTOP_DIR, 'lib/chat-theme-preload.cjs'),
  }
}

/** Load the app-local tray template, with an empty fallback for incomplete staging. */
function trayImage(): Electron.NativeImage {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'desktop-resources/trayTemplate.png')]
    : [join(DESKTOP_DIR, 'resources/trayTemplate.png')]
  const path = candidates.find(candidate => existsSync(candidate))
  const image = path === undefined ? nativeImage.createEmpty() : nativeImage.createFromPath(path)
  if (process.platform === 'darwin') image.setTemplateImage(true)
  return image
}

function releaseAppQuit(): void {
  if (quitReleased) return
  quitReleased = true
  tray?.destroy()
  tray = undefined
  app.quit()
}

function requestAppQuit(): Promise<void> {
  return desktopApplication?.requestQuit() ?? Promise.resolve().then(() => { releaseAppQuit() })
}

function createTray(): void {
  tray = new Tray(trayImage())
  tray.setToolTip(APP_NAME)
  const template: MenuItemConstructorOptions[] = [
    { label: '打开主窗口', click: () => { void desktopApplication?.showWindow() } },
    { type: 'separator' },
    { label: '退出', click: () => { void requestAppQuit() } },
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))
  tray.on('click', () => { void desktopApplication?.showWindow() })
}

async function boot(): Promise<void> {
  const paths = shellPaths()
  desktopApplication = createDesktopApplication({
    stateFile: join(app.getPath('userData'), 'desktop-state.json'),
    shellPath: paths.shellPath,
    preloadPath: paths.preloadPath,
    chromePath: paths.chromePath,
    chromePreloadPath: paths.chromePreloadPath,
    harnessThemePreloadPath: paths.harnessThemePreloadPath,
    chatThemePreloadPath: paths.chatThemePreloadPath,
    platform: process.platform,
    createWindow: options => new BrowserWindow(options),
    createView: options => new WebContentsView(options),
    createAuthWindow: options => new BrowserWindow(options),
    createHost: () => {
      const host = hostPaths()
      assertHostArtifacts(host)
      return createHostSupervisor({
        spawnHost: () => spawnDshWeb({
          ...host,
          env: { ...process.env, DSH_DESKTOP: '1' },
        }),
        log: chunk => process.stderr.write(chunk),
      })
    },
    chatSession: session.fromPartition(CHAT_PARTITION),
    ipcMain,
    openExternal: async (url) => { await shell.openExternal(url) },
    quit: releaseAppQuit,
    reportError: (error) => { console.error('desktop application error:', error) },
    systemTheme: {
      getColorScheme: () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      subscribe: (listener) => {
        nativeTheme.on('updated', listener)
        return () => { nativeTheme.off('updated', listener) }
      },
    },
  })
  createTray()
  await desktopApplication.start()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { void desktopApplication?.showWindow() })
  app.on('activate', () => { void desktopApplication?.showWindow() })
  app.on('window-all-closed', () => {
    // Tray and desktop surfaces own application lifetime on every platform.
  })
  app.on('before-quit', (event: Event) => {
    if (quitReleased) return
    event.preventDefault()
    void requestAppQuit()
  })
  app.whenReady().then(boot).catch(async (error: unknown) => {
    console.error('desktop startup failed:', error)
    if (!quitReleased) {
      await dialog.showMessageBox({
        type: 'error',
        title: `${APP_NAME} failed to start`,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    await requestAppQuit()
  })
}
