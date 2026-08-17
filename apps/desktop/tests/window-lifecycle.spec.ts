import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopLifecycle,
  type DesktopWindow,
} from '../src/window-lifecycle.ts'

interface FakeDesktopWindow extends DesktopWindow {
  focus: ReturnType<typeof vi.fn<() => void>>
  hide: ReturnType<typeof vi.fn<() => void>>
  show: ReturnType<typeof vi.fn<() => void>>
}

interface TestDeferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

function testDeferred<T>(): TestDeferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

function fakeWindow(options: { destroyed?: boolean; visible?: boolean } = {}): FakeDesktopWindow {
  let visible = options.visible ?? true
  const show = vi.fn<() => void>(() => { visible = true })
  const hide = vi.fn<() => void>(() => { visible = false })
  return {
    isDestroyed: () => options.destroyed ?? false,
    isVisible: () => visible,
    show,
    focus: vi.fn<() => void>(),
    hide,
  }
}

describe('desktop window lifecycle', () => {
  it('hides an ordinary close without disposing the application', () => {
    const window = fakeWindow()
    const preventDefault = vi.fn()
    const disposeApplication = vi.fn(() => Promise.resolve())
    const lifecycle = createDesktopLifecycle({
      getWindow: () => window,
      createWindow: () => Promise.resolve(window),
      disposeApplication,
      quit: vi.fn(),
    })

    lifecycle.onWindowClose({ preventDefault })

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(window.hide).toHaveBeenCalledOnce()
    expect(disposeApplication).not.toHaveBeenCalled()
    expect(lifecycle.isQuitting).toBe(false)
  })

  it('restores and focuses the existing hidden window', async () => {
    const window = fakeWindow({ visible: false })
    const createWindow = vi.fn(() => Promise.resolve(window))
    const lifecycle = createDesktopLifecycle({
      getWindow: () => window,
      createWindow,
      disposeApplication: () => Promise.resolve(),
      quit: vi.fn(),
    })

    await lifecycle.showWindow()

    expect(createWindow).not.toHaveBeenCalled()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('single-flights replacement creation for concurrent restore requests', async () => {
    const replacement = fakeWindow({ visible: false })
    const created = testDeferred<DesktopWindow>()
    const createWindow = vi.fn(() => created.promise)
    const lifecycle = createDesktopLifecycle({
      getWindow: () => undefined,
      createWindow,
      disposeApplication: () => Promise.resolve(),
      quit: vi.fn(),
    })

    const first = lifecycle.showWindow()
    const second = lifecycle.showWindow()
    expect(createWindow).toHaveBeenCalledOnce()

    created.resolve(replacement)
    await Promise.all([first, second])
    expect(replacement.show).toHaveBeenCalledOnce()
    expect(replacement.focus).toHaveBeenCalledTimes(2)
  })

  it('coalesces explicit quit, lets the window close, and releases quit after application disposal', async () => {
    const window = fakeWindow()
    const disposal = testDeferred<undefined>()
    const disposeApplication = vi.fn(() => disposal.promise)
    const quit = vi.fn()
    const lifecycle = createDesktopLifecycle({
      getWindow: () => window,
      createWindow: () => Promise.resolve(window),
      disposeApplication,
      quit,
    })

    const first = lifecycle.requestQuit()
    const second = lifecycle.requestQuit()
    expect(second).toBe(first)
    expect(lifecycle.pendingQuit).toBe(first)
    expect(lifecycle.isQuitting).toBe(true)
    expect(disposeApplication).toHaveBeenCalledOnce()
    expect(quit).not.toHaveBeenCalled()

    const preventDefault = vi.fn()
    lifecycle.onWindowClose({ preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(window.hide).not.toHaveBeenCalled()

    await lifecycle.showWindow()
    expect(window.focus).not.toHaveBeenCalled()

    disposal.resolve(undefined)
    await first
    expect(quit).toHaveBeenCalledOnce()
  })

  it('reports an application disposal failure and still releases Electron quit', async () => {
    const failure = new Error('application disposal failed')
    const reportError = vi.fn()
    const quit = vi.fn()
    const lifecycle = createDesktopLifecycle({
      getWindow: () => undefined,
      createWindow: () => Promise.resolve(fakeWindow()),
      disposeApplication: () => Promise.reject(failure),
      reportError,
      quit,
    })

    await expect(lifecycle.requestQuit()).resolves.toBeUndefined()
    expect(reportError).toHaveBeenCalledOnce()
    expect(reportError).toHaveBeenCalledWith(failure)
    expect(quit).toHaveBeenCalledOnce()
  })
})
