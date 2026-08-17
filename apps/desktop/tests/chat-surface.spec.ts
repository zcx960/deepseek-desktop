import type { BrowserWindow, IpcMain, Session, WebContents, WebContentsView } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { CHAT_PARTITION, CHAT_URL } from '../src/chat-navigation.ts'
import { clearChatPartition, createChatSurface } from '../src/chat-surface.ts'
import { DESKTOP_THEME_CHANNELS } from '../src/desktop-theme-sync.ts'

type Listener = (...args: unknown[]) => void

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

class FakeWebContents extends FakeEmitter {
  readonly loadURL = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve())
  readonly reload = vi.fn()
  readonly send = vi.fn()
  readonly close = vi.fn()
  readonly isDestroyed = vi.fn(() => false)
  windowOpenHandler: ((details: { url: string }) => { action: 'allow' | 'deny' }) | undefined

  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }): void {
    this.windowOpenHandler = handler
  }
}

class FakeIpc extends FakeEmitter {
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

function fakeWindow(contents = new FakeWebContents()) {
  const emitter = new FakeEmitter()
  const destroy = vi.fn()
  return {
    contents,
    destroy,
    window: {
      webContents: contents,
      loadURL: contents.loadURL,
      destroy,
      isDestroyed: vi.fn(() => false),
      on: emitter.on.bind(emitter),
      once: emitter.once.bind(emitter),
      off: emitter.off.bind(emitter),
    } as unknown as BrowserWindow,
    close: () => { emitter.emit('closed') },
  }
}

function fakeSession(order: string[] = []) {
  let checkHandler: unknown
  let requestHandler: unknown
  const value = {
    setPermissionCheckHandler: vi.fn((handler: unknown) => { checkHandler = handler; order.push(handler === null ? 'permissions-reset' : 'permissions') }),
    setPermissionRequestHandler: vi.fn((handler: unknown) => { requestHandler = handler }),
    clearStorageData: vi.fn(async () => { order.push('storage') }),
    clearCache: vi.fn(async () => { order.push('cache') }),
  }
  return {
    session: value as unknown as Session,
    value,
    checkHandler: () => checkHandler,
    requestHandler: () => requestHandler,
  }
}

function navigationEvent(url: string) {
  return { url, isMainFrame: true, preventDefault: vi.fn() }
}

function themeOptions() {
  return {
    ipcMain: new FakeIpc() as unknown as IpcMain,
    themePreloadPath: '/app/lib/chat-theme-preload.cjs',
    onThemeState: vi.fn(),
    onThemeAdapterError: vi.fn(),
  }
}

describe('Chat surface', () => {
  it('restores session permission handlers when view construction fails', async () => {
    const { session, value } = fakeSession()
    await expect(createChatSurface({
      ...themeOptions(),
      createView: () => { throw new Error('view failed') },
      chatSession: session,
      openExternal: vi.fn(() => Promise.resolve()),
      createAuthWindow: vi.fn(),
      onExternalNavigation: vi.fn(),
      onFailure: vi.fn(),
    })).rejects.toThrow('view failed')
    expect(value.setPermissionCheckHandler).toHaveBeenLastCalledWith(null)
    expect(value.setPermissionRequestHandler).toHaveBeenLastCalledWith(null)
  })

  it('configures permission denial before loading a restricted persistent view', async () => {
    const order: string[] = []
    const { session, value, checkHandler, requestHandler } = fakeSession(order)
    const { view, contents } = fakeView()
    contents.loadURL.mockImplementation(async () => { order.push('load') })
    const createView = vi.fn(() => { order.push('view'); return view })

    const surface = await createChatSurface({
      ...themeOptions(),
      createView,
      chatSession: session,
      openExternal: vi.fn(() => Promise.resolve()),
      createAuthWindow: vi.fn(),
      onExternalNavigation: vi.fn(),
      onFailure: vi.fn(),
    })

    expect(createView).toHaveBeenCalledWith({
      webPreferences: {
        partition: CHAT_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        preload: '/app/lib/chat-theme-preload.cjs',
      },
    })
    expect(order.slice(0, 3)).toEqual(['permissions', 'view', 'load'])
    expect(contents.loadURL).toHaveBeenCalledWith(CHAT_URL)
    expect((checkHandler() as () => boolean)()).toBe(false)
    const permissionCallback = vi.fn()
    const request = requestHandler() as (
      _contents: unknown,
      _permission: unknown,
      callback: (allowed: boolean) => void,
    ) => void
    request(undefined, undefined, permissionCallback)
    expect(permissionCallback).toHaveBeenCalledWith(false)
    await surface.dispose()
    expect(value.setPermissionCheckHandler).toHaveBeenLastCalledWith(null)
    expect(value.setPermissionRequestHandler).toHaveBeenLastCalledWith(null)
  })

  it('applies one decision table to top-level navigation, redirects, and new windows', async () => {
    const { session } = fakeSession()
    const { view, contents } = fakeView()
    const openExternal = vi.fn(() => Promise.resolve())
    const onExternalNavigation = vi.fn()
    await createChatSurface({
      ...themeOptions(),
      createView: () => view,
      chatSession: session,
      openExternal,
      createAuthWindow: vi.fn(),
      onExternalNavigation,
      onFailure: vi.fn(),
    })

    const trusted = navigationEvent(`${CHAT_URL}sign_in`)
    contents.emit('will-navigate', trusted)
    expect(trusted.preventDefault).not.toHaveBeenCalled()

    const external = navigationEvent('https://example.com/path')
    contents.emit('will-navigate', external)
    expect(external.preventDefault).toHaveBeenCalledOnce()
    expect(onExternalNavigation).toHaveBeenCalledWith('https://example.com/path')

    const redirect = navigationEvent('https://example.com/redirect')
    contents.emit('will-redirect', redirect)
    expect(redirect.preventDefault).toHaveBeenCalledOnce()
    expect(onExternalNavigation).toHaveBeenCalledOnce()

    expect(contents.windowOpenHandler?.({ url: 'https://example.com/new' })).toEqual({ action: 'deny' })
    await vi.waitFor(() => { expect(openExternal).toHaveBeenCalledWith('https://example.com/new') })
    expect(contents.windowOpenHandler?.({ url: 'mailto:test@example.com' })).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledOnce()
  })

  it('creates trusted child windows with the same restricted partition and disposes every view once', async () => {
    const { session } = fakeSession()
    const { view, contents } = fakeView()
    const auth = fakeWindow()
    const createAuthWindow = vi.fn(() => auth.window)
    const surface = await createChatSurface({
      ...themeOptions(),
      createView: () => view,
      chatSession: session,
      openExternal: vi.fn(() => Promise.resolve()),
      createAuthWindow,
      onExternalNavigation: vi.fn(),
      onFailure: vi.fn(),
    })

    expect(contents.windowOpenHandler?.({ url: `${CHAT_URL}sign_in` })).toEqual({ action: 'deny' })
    expect(createAuthWindow).toHaveBeenCalledWith(expect.objectContaining({
      webPreferences: {
        partition: CHAT_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    }))
    await vi.waitFor(() => { expect(auth.contents.loadURL).toHaveBeenCalledWith(`${CHAT_URL}sign_in`) })
    await surface.dispose()
    await surface.dispose()
    expect(auth.destroy).toHaveBeenCalledOnce()
    expect(contents.close).toHaveBeenCalledOnce()
  })

  it('releases a user-closed authentication window before surface disposal', async () => {
    const { session } = fakeSession()
    const { view, contents } = fakeView()
    const auth = fakeWindow()
    const surface = await createChatSurface({
      ...themeOptions(),
      createView: () => view,
      chatSession: session,
      openExternal: vi.fn(() => Promise.resolve()),
      createAuthWindow: () => auth.window,
      onExternalNavigation: vi.fn(),
      onFailure: vi.fn(),
    })

    contents.windowOpenHandler?.({ url: `${CHAT_URL}sign_in` })
    await vi.waitFor(() => { expect(auth.contents.loadURL).toHaveBeenCalledOnce() })
    auth.close()
    await surface.dispose()
    expect(auth.destroy).not.toHaveBeenCalled()
  })

  it('omits the failing Chat URL from renderer error messages', async () => {
    const { session } = fakeSession()
    const { view, contents } = fakeView()
    const onFailure = vi.fn()
    await createChatSurface({
      ...themeOptions(),
      createView: () => view,
      chatSession: session,
      openExternal: vi.fn(() => Promise.resolve()),
      createAuthWindow: vi.fn(),
      onExternalNavigation: vi.fn(),
      onFailure,
    })

    contents.emit('did-fail-load', {}, -2, 'ERR_FAILED', `${CHAT_URL}callback?token=secret`, true)
    expect(onFailure.mock.calls[0]?.[0]).toMatchObject({
      message: 'DeepSeek Chat failed to load (-2 ERR_FAILED)',
    })
  })

  it('reports renderer failures once and ignores aborted or subframe loads', async () => {
    const { session } = fakeSession()
    const { view, contents } = fakeView()
    const onFailure = vi.fn()
    await createChatSurface({
      ...themeOptions(),
      createView: () => view,
      chatSession: session,
      openExternal: vi.fn(() => Promise.resolve()),
      createAuthWindow: vi.fn(),
      onExternalNavigation: vi.fn(),
      onFailure,
    })

    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', CHAT_URL, true)
    contents.emit('did-fail-load', {}, -2, 'ERR_FAILED', CHAT_URL, false)
    expect(onFailure).not.toHaveBeenCalled()
    contents.emit('render-process-gone', {}, { reason: 'crashed' })
    contents.emit('unresponsive')
    expect(onFailure).toHaveBeenCalledOnce()
    expect(onFailure.mock.calls[0]?.[0]).toBeInstanceOf(Error)
  })

  it('closes registered Chat views before clearing storage and cache', async () => {
    const order: string[] = []
    const { session } = fakeSession(order)
    const { view, contents } = fakeView()
    contents.close.mockImplementation(() => { order.push('dispose') })
    await createChatSurface({
      ...themeOptions(),
      createView: () => view,
      chatSession: session,
      openExternal: vi.fn(() => Promise.resolve()),
      createAuthWindow: vi.fn(),
      onExternalNavigation: vi.fn(),
      onFailure: vi.fn(),
    })
    order.length = 0

    await clearChatPartition(session)

    expect(order).toEqual(['dispose', 'permissions-reset', 'storage', 'cache'])
  })

  it('contains theme IPC to the owned Chat renderer', async () => {
    const { session } = fakeSession()
    const { view, contents } = fakeView()
    const ipc = new FakeIpc()
    const onThemeState = vi.fn()
    const onThemeAdapterError = vi.fn()
    const onFailure = vi.fn()
    const surface = await createChatSurface({
      createView: () => view,
      chatSession: session,
      ipcMain: ipc as unknown as IpcMain,
      themePreloadPath: '/app/lib/chat-theme-preload.cjs',
      openExternal: vi.fn(() => Promise.resolve()),
      createAuthWindow: vi.fn(),
      onExternalNavigation: vi.fn(),
      onFailure,
      onThemeState,
      onThemeAdapterError,
    })

    ipc.dispatch(DESKTOP_THEME_CHANNELS.report, contents, {
      preference: 'dark',
      scheme: 'dark',
      backgroundColor: '#000000',
    })
    ipc.dispatch(DESKTOP_THEME_CHANNELS.report, new FakeWebContents(), { preference: 'light', scheme: 'light' })
    ipc.dispatch(DESKTOP_THEME_CHANNELS.report, contents, { preference: 'sepia', scheme: 'dark' })
    ipc.dispatch(DESKTOP_THEME_CHANNELS.report, contents, {
      preference: 'dark',
      scheme: 'dark',
      backgroundColor: 'url(https://example.com/a.png)',
    })
    expect(onThemeState).toHaveBeenCalledOnce()
    expect(onThemeState).toHaveBeenCalledWith({
      preference: 'dark',
      scheme: 'dark',
      backgroundColor: '#000000',
    })

    surface.setThemePreference('light')
    expect(contents.send).toHaveBeenCalledWith(DESKTOP_THEME_CHANNELS.apply, 'light')

    ipc.dispatch(DESKTOP_THEME_CHANNELS.adapterError, contents, 'theme storage version is unsupported')
    expect(onThemeAdapterError).toHaveBeenCalledOnce()
    expect(onThemeAdapterError.mock.calls[0]?.[0]).toEqual(new Error('theme storage version is unsupported'))
    expect(onFailure).not.toHaveBeenCalled()

    await surface.dispose()
    ipc.dispatch(DESKTOP_THEME_CHANNELS.report, contents, { preference: 'light', scheme: 'light' })
    expect(onThemeState).toHaveBeenCalledOnce()
  })
})
