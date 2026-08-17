import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  session,
  WebContentsView,
} from 'electron'
import { createDesktopApplication } from '../../../lib/desktop-application.js'

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url))
const DESKTOP_DIR = resolve(FIXTURE_DIR, '../../..')
const CHAT_PARTITION = 'persist:dsh-dual-mode-electron-fixture'
const userDataDirectory = process.env.DSH_DESKTOP_FIXTURE_USER_DATA

if (userDataDirectory === undefined) {
  throw new Error('DSH_DESKTOP_FIXTURE_USER_DATA is required')
}
app.setPath('userData', userDataDirectory)

const activeViews = { chat: undefined, harness: undefined }
const activeThemeControls = { chat: undefined, harness: undefined }
const allViews = new Set()
const failureCallbacks = { chat: undefined, harness: undefined }
const generations = { chat: 0, harness: 0 }
const preferences = { chat: 'system', harness: 'system' }
const schemes = { chat: 'light', harness: 'light' }
const reloads = { chat: 0, harness: 0 }
let sidebarClicks = 0
let desktopApplication
let harnessServer
let chatServer
let quitReleased = false

function page(kind) {
  const title = kind === 'chat' ? 'Chat fixture' : 'Harness fixture'
  const field = kind === 'chat'
    ? `<button id="chat-sidebar-toggle" type="button" aria-label="Toggle sidebar">&#9776;</button>
      <label>Draft <input id="chat-draft" autocomplete="off"></label>
      <script>
        document.querySelector('#chat-sidebar-toggle').addEventListener('click', () => {
          void fetch('/sidebar-click', { method: 'POST' })
        })
      </script>`
    : '<p id="harness-ready">Harness is ready</p>'
  const themeColor = kind === 'harness' ? '<meta name="theme-color" content="#f5f7f8">' : ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  ${themeColor}
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 32px; background: #f5f7f8; color: #202428; font: 16px system-ui; }
    main { max-width: 720px; margin: 0 auto; }
    input { display: block; width: min(100%, 520px); margin-top: 10px; padding: 10px; }
    #chat-sidebar-toggle {
      position: fixed;
      top: 12px;
      left: 16px;
      width: 40px;
      height: 40px;
      border: 0;
      border-radius: 6px;
      background: rgba(127, 127, 127, 0.14);
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #121416; color: #f1f3f4; }
    }
  </style>
</head>
<body data-fixture="${kind}">
  <main><h1>${title}</h1>${field}</main>
</body>
</html>`
}

async function startFixtureServer(kind) {
  const server = createServer((request, response) => {
    if (kind === 'chat' && request.method === 'POST' && request.url === '/sidebar-click') {
      sidebarClicks += 1
      response.writeHead(204)
      response.end()
      return
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    response.end(page(kind))
  })
  await new Promise((resolveListen, reject) => {
    const onError = error => { reject(error) }
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      resolveListen()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error(`fixture ${kind} server did not publish a TCP address`)
  }
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: () => new Promise((resolveClose, reject) => {
      server.close(error => { error === undefined ? resolveClose() : reject(error) })
    }),
  }
}

async function createFixtureSurface(kind, origin, options, partition) {
  const view = options.createView({
    webPreferences: {
      ...(partition === undefined ? {} : { partition }),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  view.setVisible(false)
  generations[kind] += 1
  activeViews[kind] = view

  const resolvedScheme = preference => preference === 'system'
    ? nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    : preference
  const renderTheme = async (preference, report) => {
    const scheme = resolvedScheme(preference)
    preferences[kind] = preference
    schemes[kind] = scheme
    const color = scheme === 'dark' ? '#121416' : '#f5f7f8'
    await view.webContents.executeJavaScript(`(() => {
      document.body.dataset.theme = ${JSON.stringify(scheme)}
      document.body.style.background = ${JSON.stringify(color)}
      document.body.style.color = ${JSON.stringify(scheme === 'dark' ? '#f1f3f4' : '#202428')}
    })()`)
    if (kind === 'harness') options.onThemeColor?.(color)
    if (report) options.onThemeState({ preference, scheme, backgroundColor: color })
  }
  const userSetTheme = async preference => { await renderTheme(preference, true) }
  activeThemeControls[kind] = { userSetTheme, renderSystem: () => renderTheme(preferences[kind], true) }

  let disposed = false
  const fail = () => {
    if (disposed) return
    options.onFailure(new Error(`fixture ${kind} failed`))
  }
  failureCallbacks[kind] = fail
  const onGone = () => { fail() }
  view.webContents.on('render-process-gone', onGone)
  const onThemeColor = (_event, color) => { options.onThemeColor?.(color) }
  if (options.onThemeColor !== undefined) {
    view.webContents.on('did-change-theme-color', onThemeColor)
  }

  let disposePromise
  const dispose = () => {
    disposePromise ??= Promise.resolve().then(() => {
      disposed = true
      view.webContents.off('render-process-gone', onGone)
      view.webContents.off('did-change-theme-color', onThemeColor)
      if (failureCallbacks[kind] === fail) failureCallbacks[kind] = undefined
      if (activeViews[kind] === view) activeViews[kind] = undefined
      if (activeThemeControls[kind]?.userSetTheme === userSetTheme) activeThemeControls[kind] = undefined
      allViews.delete(view)
      options.removeView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close()
    })
    return disposePromise
  }

  try {
    await view.webContents.loadURL(`${origin}/${kind}`)
    await renderTheme(preferences[kind], true)
  } catch (error) {
    await dispose()
    throw error
  }

  return {
    setBounds(bounds) { view.setBounds({ ...bounds }) },
    setVisible(visible) { view.setVisible(visible) },
    reload() { reloads[kind] += 1; view.webContents.reload() },
    setThemePreference(preference) {
      const changed = preferences[kind] !== preference
      if (kind === 'chat' && changed && !view.getVisible()) reloads.chat += 1
      void renderTheme(preference, true).catch(options.onFailure)
    },
    dispose,
  }
}

function fixtureState() {
  const chrome = [...allViews].find((view) => {
    if (view.webContents.isDestroyed()) return false
    try {
      return new URL(view.webContents.getURL()).pathname.endsWith('/mode-chrome.html')
    } catch {
      return false
    }
  })
  return {
    snapshot: desktopApplication?.snapshot(),
    visible: {
      chat: activeViews.chat?.getVisible() ?? false,
      harness: activeViews.harness?.getVisible() ?? false,
    },
    generations: { ...generations },
    bounds: {
      chat: activeViews.chat?.getBounds(),
      chrome: chrome?.getBounds(),
      harness: activeViews.harness?.getBounds(),
    },
    preferences: { ...preferences },
    schemes: { ...schemes },
    reloads: { ...reloads },
    sidebarClicks,
  }
}

globalThis.__dshDualModeFixture = {
  fail(mode) { failureCallbacks[mode]?.() },
  async setTheme(target, preference) {
    if (target === 'system') {
      nativeTheme.themeSource = preference
      await Promise.all(Object.values(activeThemeControls).map(control => control?.renderSystem()))
      return
    }
    const control = activeThemeControls[target]
    if (control === undefined) throw new Error(`fixture ${target} view is unavailable`)
    await control.userSetTheme(preference)
  },
  state: fixtureState,
}

function closeServers() {
  return Promise.allSettled([
    harnessServer?.close(),
    chatServer?.close(),
  ])
}

function releaseQuit() {
  if (quitReleased) return
  quitReleased = true
  nativeTheme.themeSource = 'system'
  void closeServers().then(() => { app.quit() })
}

async function boot() {
  ;[harnessServer, chatServer] = await Promise.all([
    startFixtureServer('harness'),
    startFixtureServer('chat'),
  ])
  const chatSession = session.fromPartition(CHAT_PARTITION)
  desktopApplication = createDesktopApplication({
    stateFile: join(app.getPath('userData'), 'desktop-state.json'),
    shellPath: join(DESKTOP_DIR, 'resources/shell.html'),
    preloadPath: join(DESKTOP_DIR, 'lib/shell-preload.cjs'),
    chromePath: join(DESKTOP_DIR, 'resources/mode-chrome.html'),
    chromePreloadPath: join(DESKTOP_DIR, 'lib/mode-chrome-preload.cjs'),
    platform: process.platform,
    createWindow: options => new BrowserWindow(options),
    createView: options => {
      const view = new WebContentsView(options)
      allViews.add(view)
      return view
    },
    createAuthWindow: options => new BrowserWindow(options),
    createHost: () => { throw new Error('fixture must not create a production Host') },
    chatSession,
    ipcMain,
    openExternal: async () => {},
    quit: releaseQuit,
    reportError: error => { console.error('dual-mode fixture error:', error) },
    systemTheme: {
      getColorScheme: () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      subscribe: (listener) => {
        nativeTheme.on('updated', listener)
        return () => { nativeTheme.off('updated', listener) }
      },
    },
    harnessSurfaceFactory: options => createFixtureSurface(
      'harness',
      harnessServer.origin,
      options,
    ),
    chatSurfaceFactory: options => createFixtureSurface(
      'chat',
      chatServer.origin,
      options,
      CHAT_PARTITION,
    ),
    clearChatStorage: async () => {
      await chatSession.clearStorageData()
      await chatSession.clearCache()
      preferences.chat = 'system'
      schemes.chat = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    },
  })
  await desktopApplication.start()
}

app.on('window-all-closed', () => {})
app.on('before-quit', event => {
  if (quitReleased) return
  event.preventDefault()
  void desktopApplication?.requestQuit()
})
app.whenReady().then(boot).catch(async error => {
  console.error('dual-mode fixture startup failed:', error)
  await closeServers()
  app.exit(1)
})
