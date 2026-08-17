import type { IpcMain, WebContents, WebContentsView } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { HostSupervisor } from '../src/host-supervisor.ts'
import { createHarnessSurface } from '../src/harness-surface.ts'
import { DESKTOP_THEME_CHANNELS } from '../src/desktop-theme-sync.ts'

type Listener = (...args: unknown[]) => void

class FakeWebContents {
  readonly listeners = new Map<string, Set<Listener>>()
  readonly loadURL = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve())
  readonly reload = vi.fn()
  readonly send = vi.fn()
  readonly close = vi.fn()
  readonly isDestroyed = vi.fn(() => false)
  windowOpenHandler: ((details: { url: string }) => { action: 'allow' | 'deny' }) | undefined

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }

  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }): void {
    this.windowOpenHandler = handler
  }
}

class FakeIpc extends FakeWebContents {
  dispatch(channel: string, sender: FakeWebContents, payload: unknown): void {
    this.emit(channel, { sender: sender as unknown as WebContents }, payload)
  }
}

function fakeView(contents = new FakeWebContents()) {
  return {
    contents,
    view: {
      webContents: contents,
      setBounds: vi.fn(),
      setVisible: vi.fn(),
    } as unknown as WebContentsView,
  }
}

function fakeHost(origin = 'http://127.0.0.1:4173') {
  let unexpectedExit: ((detail: { code: number | null; signal: NodeJS.Signals | null }) => void) | undefined
  const host = {
    start: vi.fn(() => Promise.resolve(origin)),
    shutdown: vi.fn(() => Promise.resolve()),
    onUnexpectedExit: vi.fn((listener: typeof unexpectedExit) => {
      unexpectedExit = listener
      return () => { unexpectedExit = undefined }
    }),
  }
  return {
    host: host as HostSupervisor,
    value: host,
    exit: (code: number | null, signal: NodeJS.Signals | null = null) => { unexpectedExit?.({ code, signal }) },
  }
}

function navigationEvent(url: string) {
  return { url, isMainFrame: true, preventDefault: vi.fn() }
}

function themeOptions() {
  return {
    ipcMain: new FakeIpc() as unknown as IpcMain,
    themePreloadPath: '/app/lib/harness-theme-preload.cjs',
    onThemeState: vi.fn(),
  }
}

describe('Harness surface', () => {
  it('starts the Host and loads only its loopback origin in a restricted view', async () => {
    const { host } = fakeHost()
    const { view, contents } = fakeView()
    const createView = vi.fn(() => view)
    const openExternal = vi.fn(() => Promise.resolve())
    const onThemeColor = vi.fn()
    const onThemeState = vi.fn()
    const ipc = new FakeIpc()

    const surface = await createHarnessSurface({
      host,
      createView,
      ipcMain: ipc as unknown as IpcMain,
      themePreloadPath: '/app/lib/harness-theme-preload.cjs',
      openExternal,
      onFailure: vi.fn(),
      onThemeColor,
      onThemeState,
      platform: 'darwin',
    })

    expect(createView).toHaveBeenCalledWith({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        preload: '/app/lib/harness-theme-preload.cjs',
      },
    })
    const loaded = new URL(String(contents.loadURL.mock.calls[0]?.[0]))
    expect(loaded.origin).toBe('http://127.0.0.1:4173')
    expect(loaded.searchParams.get('dsh-desktop-platform')).toBe('darwin')
    expect(loaded.searchParams.get('dsh-desktop-embedded')).toBe('1')

    const trusted = navigationEvent('http://127.0.0.1:4173/session')
    contents.emit('will-navigate', trusted)
    expect(trusted.preventDefault).not.toHaveBeenCalled()
    const external = navigationEvent('https://example.com/')
    contents.emit('will-navigate', external)
    expect(external.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => { expect(openExternal).toHaveBeenCalledWith('https://example.com/') })
    expect(contents.windowOpenHandler?.({ url: 'http://127.0.0.1:4173/new' })).toEqual({ action: 'deny' })
    expect(contents.windowOpenHandler?.({ url: 'https://example.com/new' })).toEqual({ action: 'deny' })
    await vi.waitFor(() => { expect(openExternal).toHaveBeenCalledWith('https://example.com/new') })
    const redirect = navigationEvent('https://example.com/redirect')
    contents.emit('will-redirect', redirect)
    expect(redirect.preventDefault).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledTimes(2)
    contents.emit('did-change-theme-color', {}, '#f5f7f8')
    expect(onThemeColor).toHaveBeenCalledWith('#f5f7f8')

    ipc.dispatch(DESKTOP_THEME_CHANNELS.report, contents, { preference: 'dark', scheme: 'dark' })
    expect(onThemeState).toHaveBeenCalledWith({ preference: 'dark', scheme: 'dark' })
    ipc.dispatch(DESKTOP_THEME_CHANNELS.report, new FakeWebContents(), { preference: 'light', scheme: 'light' })
    ipc.dispatch(DESKTOP_THEME_CHANNELS.report, contents, { preference: 'sepia', scheme: 'dark' })
    expect(onThemeState).toHaveBeenCalledOnce()

    surface.setThemePreference('light')
    expect(contents.send).toHaveBeenCalledWith(DESKTOP_THEME_CHANNELS.apply, 'light')
    await surface.dispose()
    contents.emit('did-change-theme-color', {}, '#121416')
    expect(onThemeColor).toHaveBeenCalledOnce()
    ipc.dispatch(DESKTOP_THEME_CHANNELS.report, contents, { preference: 'light', scheme: 'light' })
    expect(onThemeState).toHaveBeenCalledOnce()
  })

  it('stops the Host and closes the view when the initial load fails', async () => {
    const { host, value } = fakeHost()
    const { view, contents } = fakeView()
    contents.loadURL.mockRejectedValueOnce(new Error('load failed'))

    await expect(createHarnessSurface({ ...themeOptions(), host, createView: () => view, openExternal: vi.fn(), onFailure: vi.fn(), onThemeColor: vi.fn(), platform: 'linux' }))
      .rejects.toThrow('load failed')

    expect(contents.close).toHaveBeenCalledOnce()
    expect(value.shutdown).toHaveBeenCalledOnce()
  })

  it('reports later Host exit without quitting and disposes every resource once', async () => {
    const { host, value, exit } = fakeHost()
    const { view, contents } = fakeView()
    const onFailure = vi.fn()
    const surface = await createHarnessSurface({ ...themeOptions(), host, createView: () => view, openExternal: vi.fn(), onFailure, onThemeColor: vi.fn(), platform: 'win32' })

    exit(9)
    expect(onFailure).toHaveBeenCalledOnce()
    expect(onFailure.mock.calls[0]?.[0]).toBeInstanceOf(Error)

    await surface.dispose()
    await surface.dispose()
    expect(contents.close).toHaveBeenCalledOnce()
    expect(value.shutdown).toHaveBeenCalledOnce()
    expect(value.onUnexpectedExit).toHaveBeenCalledOnce()
    exit(10)
    expect(onFailure).toHaveBeenCalledOnce()
  })
})
