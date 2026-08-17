import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMain,
  Session,
  WebContentsView,
  WebContentsViewConstructorOptions,
} from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDesktopApplication } from '../src/desktop-application.ts'
import type { DesktopColorScheme, DesktopSystemTheme } from '../src/desktop-theme.ts'
import { DESKTOP_THEME_CHANNELS } from '../src/desktop-theme-sync.ts'
import type { HostSupervisor } from '../src/host-supervisor.ts'
import { DESKTOP_SHELL_CHANNELS } from '../src/shell-protocol.ts'

type Listener = (...args: unknown[]) => void

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

class FakeEmitter {
  readonly listeners = new Map<string, Set<Listener>>()

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  once(event: string, listener: Listener): this {
    const wrapper: Listener = (...args) => { this.off(event, wrapper); listener(...args) }
    return this.on(event, wrapper)
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args)
  }
}

class FakeViewContents extends FakeEmitter {
  readonly loadURL = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve())
  readonly loadFile = vi.fn<(filename: string) => Promise<void>>(() => Promise.resolve())
  readonly send = vi.fn()
  readonly reload = vi.fn()
  readonly close = vi.fn()
  readonly isDestroyed = vi.fn(() => false)
  readonly setWindowOpenHandler = vi.fn()
}

function fakeView() {
  const contents = new FakeViewContents()
  const value = {
    webContents: contents,
    setBounds: vi.fn(),
    setBackgroundColor: vi.fn(),
    setVisible: vi.fn(),
  }
  return { contents, value, view: value as unknown as WebContentsView }
}

function fakeThemedSurface() {
  return {
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    reload: vi.fn(),
    setThemePreference: vi.fn(),
    dispose: vi.fn(() => Promise.resolve()),
  }
}

class FakeWindow extends FakeEmitter {
  visible = false
  destroyed = false
  readonly sent: Array<{ channel: string; payload: unknown }> = []
  readonly webContents = {
    send: vi.fn((channel: string, payload: unknown) => { this.sent.push({ channel, payload }) }),
    isDestroyed: vi.fn(() => false),
  }
  readonly contentView = {
    addChildView: vi.fn(),
    removeChildView: vi.fn(),
  }
  readonly loadFile = vi.fn(async () => { queueMicrotask(() => { this.emit('ready-to-show') }) })
  readonly show = vi.fn(() => { this.visible = true })
  readonly focus = vi.fn()
  readonly hide = vi.fn(() => { this.visible = false })
  readonly getContentBounds = vi.fn(() => ({ x: 20, y: 30, width: 1200, height: 800 }))
  isVisible(): boolean { return this.visible }
  isDestroyed(): boolean { return this.destroyed }
}

class FakeIpc extends FakeEmitter {
  dispatch(channel: string, payload: unknown, sender?: FakeViewContents): void {
    this.emit(channel, { sender }, payload)
  }
}

function fakeSession(clearStorageData = vi.fn(() => Promise.resolve())): Session {
  return {
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    clearStorageData,
    clearCache: vi.fn(() => Promise.resolve()),
  } as unknown as Session
}

function fakeHost(start: () => Promise<string>) {
  let exitListener: ((detail: { code: number | null; signal: NodeJS.Signals | null }) => void) | undefined
  const value = {
    start: vi.fn(start),
    shutdown: vi.fn(() => Promise.resolve()),
    onUnexpectedExit: vi.fn((listener: typeof exitListener) => {
      exitListener = listener
      return () => { exitListener = undefined }
    }),
  }
  return value as HostSupervisor
}

function fakeSystemTheme(initial: DesktopColorScheme = 'dark') {
  let scheme = initial
  const listeners = new Set<() => void>()
  const value: DesktopSystemTheme = {
    getColorScheme: vi.fn(() => scheme),
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  return {
    value,
    set(next: DesktopColorScheme): void {
      scheme = next
      for (const listener of [...listeners]) listener()
    },
  }
}

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function stateFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-composition-'))
  roots.push(root)
  return join(root, 'desktop-state.json')
}

function applicationOptions(input: {
  readonly stateFile: string
  readonly window: FakeWindow
  readonly views: WebContentsView[]
  readonly host: HostSupervisor
  readonly platform?: NodeJS.Platform
  readonly chatSession?: Session
  readonly ipc?: FakeIpc
  readonly order?: string[]
  readonly quit?: () => void
  readonly reportError?: (error: unknown) => void
  readonly systemTheme?: DesktopSystemTheme
}) {
  const ipc = input.ipc ?? new FakeIpc()
  const order = input.order ?? []
  return {
    ipc,
    options: {
      stateFile: input.stateFile,
      shellPath: '/desktop-resources/shell.html',
      preloadPath: '/app/lib/shell-preload.cjs',
      chromePath: '/desktop-resources/mode-chrome.html',
      chromePreloadPath: '/app/lib/mode-chrome-preload.cjs',
      harnessThemePreloadPath: '/app/lib/harness-theme-preload.cjs',
      chatThemePreloadPath: '/app/lib/chat-theme-preload.cjs',
      platform: input.platform ?? 'darwin',
      createWindow: vi.fn((_options: BrowserWindowConstructorOptions) => input.window as unknown as BrowserWindow),
      createView: vi.fn((_options: WebContentsViewConstructorOptions) => {
        const view = input.views.shift()
        if (view === undefined) throw new Error('no fake view available')
        return view
      }),
      createAuthWindow: vi.fn((_options: BrowserWindowConstructorOptions): BrowserWindow => {
        throw new Error('unexpected authentication window')
      }),
      createHost: vi.fn(() => input.host),
      chatSession: input.chatSession ?? fakeSession(),
      ipcMain: ipc as unknown as IpcMain,
      openExternal: vi.fn((_url: string) => Promise.resolve()),
      quit: input.quit ?? vi.fn<() => void>(),
      reportError: input.reportError ?? vi.fn<(error: unknown) => void>(),
      systemTheme: input.systemTheme ?? fakeSystemTheme().value,
      onShellLoaded: () => { order.push('shell') },
    },
  }
}

describe('desktop application composition', () => {
  it.each([
    { platform: 'darwin' as const, chromeBounds: { x: 88, y: 6, width: 164, height: 32 } },
    { platform: 'win32' as const, chromeBounds: { x: 88, y: 6, width: 164, height: 32 } },
  ])('keeps $platform Harness full-height and chrome inside the title bar', async ({ platform, chromeBounds }) => {
    const filename = await stateFile()
    const window = new FakeWindow()
    const chrome = fakeView()
    const harness = fakeView()
    const hostReady = deferred<string>()
    const order: string[] = []
    const host = fakeHost(async () => { order.push('host'); return hostReady.promise })
    const { options } = applicationOptions({
      stateFile: filename,
      window,
      views: [chrome.view, harness.view],
      host,
      order,
      platform,
    })
    const application = createDesktopApplication(options)

    await application.start()

    expect(order).toEqual(['shell', 'host'])
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(harness.value.setBounds).not.toHaveBeenCalled()

    hostReady.resolve('http://127.0.0.1:4173')
    await vi.waitFor(() => {
      expect(harness.value.setBounds).toHaveBeenCalledWith({
        x: 0,
        y: 0,
        width: 1200,
        height: 800,
      })
    })
    expect(chrome.value.setBounds).toHaveBeenCalledWith(chromeBounds)
    expect(chrome.value.setBackgroundColor).toHaveBeenCalledWith('#00000000')
    expect(window.contentView.addChildView).toHaveBeenCalledWith(harness.view)
    expect(application.snapshot()?.harness.phase).toBe('ready')
  })

  it('applies expanded chrome bounds before acknowledging the requested surface', async () => {
    const filename = await stateFile()
    const window = new FakeWindow()
    const chrome = fakeView()
    const harness = fakeView()
    const ipc = new FakeIpc()
    const host = fakeHost(() => Promise.resolve('http://127.0.0.1:4173'))
    const { options } = applicationOptions({
      stateFile: filename,
      window,
      views: [chrome.view, harness.view],
      host,
      ipc,
    })
    const application = createDesktopApplication(options)

    await application.start()
    await vi.waitFor(() => { expect(application.snapshot()?.harness.phase).toBe('ready') })
    chrome.value.setBounds.mockClear()
    chrome.contents.send.mockClear()

    ipc.dispatch(DESKTOP_SHELL_CHANNELS.chromeSurface, 'chat-menu', chrome.contents)

    expect(chrome.value.setBounds).toHaveBeenLastCalledWith({
      x: 88,
      y: 6,
      width: 184,
      height: 132,
    })
    expect(chrome.contents.send).toHaveBeenLastCalledWith(
      DESKTOP_SHELL_CHANNELS.chromeLayout,
      { surface: 'chat-menu', dismissMenus: false },
    )
    expect(chrome.value.setBounds.mock.invocationCallOrder.at(-1))
      .toBeLessThan(chrome.contents.send.mock.invocationCallOrder.at(-1)!)
  })

  it('synchronizes theme changes from the selected mode and contains hidden disagreement', async () => {
    const filename = await stateFile()
    const window = new FakeWindow()
    const chrome = fakeView()
    const harness = fakeView()
    const chat = fakeView()
    const ipc = new FakeIpc()
    const systemTheme = fakeSystemTheme('dark')
    const host = fakeHost(() => Promise.resolve('http://127.0.0.1:4173'))
    const { options } = applicationOptions({
      stateFile: filename,
      window,
      views: [chrome.view, harness.view, chat.view],
      host,
      ipc,
      systemTheme: systemTheme.value,
    })
    const application = createDesktopApplication(options)

    await application.start()
    await vi.waitFor(() => { expect(application.snapshot()?.harness.phase).toBe('ready') })
    expect(chrome.contents.send).toHaveBeenCalledWith(DESKTOP_SHELL_CHANNELS.chromeTheme, 'dark')
    expect(window.webContents.send).toHaveBeenCalledWith(DESKTOP_SHELL_CHANNELS.chromeTheme, 'dark')
    expect(window.webContents.send).toHaveBeenCalledWith(DESKTOP_SHELL_CHANNELS.titlebarBackground, null)

    ipc.dispatch(
      DESKTOP_THEME_CHANNELS.report,
      { preference: 'dark', scheme: 'dark' },
      harness.contents,
    )
    expect(chrome.contents.send).toHaveBeenLastCalledWith(DESKTOP_SHELL_CHANNELS.chromeTheme, 'dark')

    ipc.dispatch(DESKTOP_SHELL_CHANNELS.select, 'chat')
    await vi.waitFor(() => { expect(application.snapshot()?.chat.phase).toBe('ready') })
    expect(chat.value.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 44,
      width: 1200,
      height: 756,
    })
    expect(chat.contents.send).toHaveBeenCalledWith(DESKTOP_THEME_CHANNELS.apply, 'dark')

    ipc.dispatch(
      DESKTOP_THEME_CHANNELS.report,
      { preference: 'light', scheme: 'light', backgroundColor: '#f5f7f8' },
      chat.contents,
    )
    expect(chrome.contents.send).toHaveBeenLastCalledWith(DESKTOP_SHELL_CHANNELS.chromeTheme, 'light')
    expect(window.webContents.send).toHaveBeenCalledWith(DESKTOP_SHELL_CHANNELS.chromeTheme, 'light')
    expect(window.webContents.send).toHaveBeenLastCalledWith(
      DESKTOP_SHELL_CHANNELS.titlebarBackground,
      '#f5f7f8',
    )
    expect(harness.contents.send).toHaveBeenLastCalledWith(DESKTOP_THEME_CHANNELS.apply, 'light')

    ipc.dispatch(
      DESKTOP_THEME_CHANNELS.report,
      { preference: 'dark', scheme: 'dark' },
      harness.contents,
    )
    expect(harness.contents.send).toHaveBeenLastCalledWith(DESKTOP_THEME_CHANNELS.apply, 'light')
    expect(chrome.contents.send).toHaveBeenLastCalledWith(DESKTOP_SHELL_CHANNELS.chromeTheme, 'light')

    ipc.dispatch(
      DESKTOP_THEME_CHANNELS.report,
      { preference: 'system', scheme: 'light', backgroundColor: '#f5f7f8' },
      chat.contents,
    )
    systemTheme.set('dark')
    expect(chrome.contents.send).toHaveBeenLastCalledWith(DESKTOP_SHELL_CHANNELS.chromeTheme, 'dark')
    expect(window.webContents.send).toHaveBeenCalledWith(DESKTOP_SHELL_CHANNELS.chromeTheme, 'dark')
    expect(window.webContents.send).toHaveBeenLastCalledWith(
      DESKTOP_SHELL_CHANNELS.titlebarBackground,
      '#f5f7f8',
    )
    expect(harness.contents.send).toHaveBeenLastCalledWith(DESKTOP_THEME_CHANNELS.apply, 'system')

    ipc.dispatch(DESKTOP_THEME_CHANNELS.adapterError, 'unsupported theme format', chat.contents)
    expect(application.snapshot()?.chat.phase).toBe('ready')
    expect(options.reportError).toHaveBeenCalledWith(new Error('unsupported theme format'))
  })

  it('applies an established theme before accepting a newly selected surface report', async () => {
    const filename = await stateFile()
    const window = new FakeWindow()
    const chrome = fakeView()
    const harness = fakeThemedSurface()
    const chat = fakeThemedSurface()
    const ipc = new FakeIpc()
    const host = fakeHost(() => Promise.resolve('http://127.0.0.1:4173'))
    const { options } = applicationOptions({
      stateFile: filename,
      window,
      views: [chrome.view],
      host,
      ipc,
    })
    const application = createDesktopApplication({
      ...options,
      harnessSurfaceFactory: async (surfaceOptions) => {
        surfaceOptions.onThemeState({ preference: 'dark', scheme: 'dark' })
        return harness
      },
      chatSurfaceFactory: async (surfaceOptions) => {
        surfaceOptions.onThemeState({ preference: 'system', scheme: 'light' })
        return chat
      },
    })

    await application.start()
    await vi.waitFor(() => { expect(application.snapshot()?.harness.phase).toBe('ready') })
    expect(chrome.contents.send).toHaveBeenLastCalledWith(DESKTOP_SHELL_CHANNELS.chromeTheme, 'dark')

    ipc.dispatch(DESKTOP_SHELL_CHANNELS.select, 'chat')
    await vi.waitFor(() => { expect(application.snapshot()?.chat.phase).toBe('ready') })

    expect(chat.setThemePreference).toHaveBeenCalledWith('dark')
    expect(harness.setThemePreference).not.toHaveBeenCalledWith('system')
    expect(chrome.contents.send).toHaveBeenLastCalledWith(DESKTOP_SHELL_CHANNELS.chromeTheme, 'dark')
  })

  it('contains invalid durable state and malformed IPC until a valid user selection is persisted', async () => {
    const filename = await stateFile()
    await writeFile(filename, '{"version":2,"mode":"chat"}\n')
    const window = new FakeWindow()
    const chrome = fakeView()
    const harness = fakeView()
    const chat = fakeView()
    const reportError = vi.fn<(error: unknown) => void>()
    const ipc = new FakeIpc()
    const host = fakeHost(() => Promise.resolve('http://127.0.0.1:4173'))
    const { options } = applicationOptions({
      stateFile: filename,
      window,
      views: [chrome.view, harness.view, chat.view],
      host,
      ipc,
      reportError,
    })
    const application = createDesktopApplication(options)
    await application.start()
    await vi.waitFor(() => { expect(application.snapshot()?.harness.phase).toBe('ready') })

    expect(application.snapshot()?.selected).toBe('harness')
    expect(reportError).toHaveBeenCalledOnce()
    expect(await readFile(filename, 'utf8')).toBe('{"version":2,"mode":"chat"}\n')
    ipc.dispatch(DESKTOP_SHELL_CHANNELS.select, 'invalid')
    await Promise.resolve()
    expect(application.snapshot()?.selected).toBe('harness')
    expect(await readFile(filename, 'utf8')).toBe('{"version":2,"mode":"chat"}\n')

    ipc.dispatch(DESKTOP_SHELL_CHANNELS.select, 'chat')
    await vi.waitFor(() => { expect(application.snapshot()?.chat.phase).toBe('ready') })
    expect(await readFile(filename, 'utf8')).toBe('{"version":1,"mode":"chat"}\n')
  })

  it('turns command rejection into a selected-mode failure without quitting the application', async () => {
    const filename = await stateFile()
    const window = new FakeWindow()
    const chrome = fakeView()
    const harness = fakeView()
    const chat = fakeView()
    const ipc = new FakeIpc()
    const quit = vi.fn<() => void>()
    const clearFailure = new Error('partition unavailable')
    const chatSession = fakeSession(vi.fn(() => Promise.reject(clearFailure)))
    const host = fakeHost(() => Promise.resolve('http://127.0.0.1:4173'))
    const { options } = applicationOptions({
      stateFile: filename,
      window,
      views: [chrome.view, harness.view, chat.view],
      host,
      chatSession,
      ipc,
      quit,
    })
    const application = createDesktopApplication(options)
    await application.start()
    ipc.dispatch(DESKTOP_SHELL_CHANNELS.select, 'chat')
    await vi.waitFor(() => { expect(application.snapshot()?.chat.phase).toBe('ready') })

    ipc.dispatch(DESKTOP_SHELL_CHANNELS.command, 'clear-chat-data')

    await vi.waitFor(() => { expect(application.snapshot()?.chat).toEqual({ phase: 'failed', message: clearFailure.message }) })
    expect(application.snapshot()?.harness.phase).toBe('ready')
    expect(quit).not.toHaveBeenCalled()
  })
})
