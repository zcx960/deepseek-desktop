import { describe, expect, it, vi } from 'vitest'
import { createDesktopModeController } from '../src/desktop-mode-controller.ts'
import type { DesktopSurface } from '../src/desktop-mode.ts'

function surface(): DesktopSurface & { visible: boolean } {
  return {
    visible: false,
    setBounds: vi.fn(),
    setVisible(value) { this.visible = value },
    reload: vi.fn(),
    dispose: vi.fn(() => Promise.resolve()),
  }
}

describe('desktop mode controller', () => {
  it('lazy-creates Chat once and retains it across switches', async () => {
    const harness = surface()
    const chat = surface()
    const createChat = vi.fn(() => Promise.resolve(chat))
    const controller = createDesktopModeController({
      initialMode: 'harness', createHarness: () => Promise.resolve(harness), createChat,
      clearChatStorage: () => Promise.resolve(), openExternal: () => Promise.resolve(),
      saveMode: () => Promise.resolve(), onChange: vi.fn(),
    })
    await controller.start()
    await controller.select('chat')
    await controller.select('harness')
    await controller.select('chat')
    expect(createChat).toHaveBeenCalledOnce()
    expect(chat.visible).toBe(true)
    expect(harness.visible).toBe(false)
  })

  it('keeps Chat usable when Harness fails and retries only Harness', async () => {
    const chat = surface()
    const createHarness = vi.fn().mockRejectedValueOnce(new Error('host failed')).mockResolvedValueOnce(surface())
    const controller = createDesktopModeController({
      initialMode: 'chat', createHarness, createChat: () => Promise.resolve(chat),
      clearChatStorage: () => Promise.resolve(), openExternal: () => Promise.resolve(),
      saveMode: () => Promise.resolve(), onChange: vi.fn(),
    })
    await controller.start()
    expect(controller.snapshot().harness.phase).toBe('failed')
    expect(controller.snapshot().chat.phase).toBe('ready')
    await controller.retry('harness')
    expect(createHarness).toHaveBeenCalledTimes(2)
    expect(controller.snapshot().harness.phase).toBe('ready')
  })

  it('disposes Chat before clearing its partition and recreates it when selected', async () => {
    const order: string[] = []
    const chat = surface()
    chat.dispose = vi.fn(async () => { order.push('dispose') })
    const controller = createDesktopModeController({
      initialMode: 'chat', createHarness: () => Promise.resolve(surface()), createChat: () => Promise.resolve(chat),
      clearChatStorage: async () => { order.push('clear') }, openExternal: () => Promise.resolve(),
      saveMode: () => Promise.resolve(), onChange: vi.fn(),
    })
    await controller.start()
    await controller.clearChatData()
    expect(order).toEqual(['dispose', 'clear'])
    expect(controller.snapshot().chat.phase).toBe('ready')
  })

  it('coalesces concurrent selections of the same lazy surface', async () => {
    const createChat = vi.fn(() => Promise.resolve(surface()))
    const controller = createDesktopModeController({
      initialMode: 'harness', createHarness: () => Promise.resolve(surface()), createChat,
      clearChatStorage: () => Promise.resolve(), openExternal: () => Promise.resolve(),
      saveMode: () => Promise.resolve(), onChange: vi.fn(),
    })
    await controller.start()
    await Promise.all([controller.select('chat'), controller.select('chat')])
    expect(createChat).toHaveBeenCalledOnce()
  })

  it('resizes both retained surfaces', async () => {
    const harness = surface()
    const chat = surface()
    const controller = createDesktopModeController({
      initialMode: 'chat', createHarness: () => Promise.resolve(harness), createChat: () => Promise.resolve(chat),
      clearChatStorage: () => Promise.resolve(), openExternal: () => Promise.resolve(),
      saveMode: () => Promise.resolve(), onChange: vi.fn(),
    })
    await controller.start()
    const bounds = { x: 1, y: 2, width: 3, height: 4 }
    controller.resize(bounds)
    expect(harness.setBounds).toHaveBeenCalledWith(bounds)
    expect(chat.setBounds).toHaveBeenCalledWith(bounds)
  })

  it('waits for both retained surface disposers exactly once during shutdown', async () => {
    const harness = surface()
    const chat = surface()
    let releaseHarness: (() => void) | undefined
    let releaseChat: (() => void) | undefined
    harness.dispose = vi.fn(() => new Promise<void>((resolve) => { releaseHarness = resolve }))
    chat.dispose = vi.fn(() => new Promise<void>((resolve) => { releaseChat = resolve }))
    const controller = createDesktopModeController({
      initialMode: 'chat', createHarness: () => Promise.resolve(harness), createChat: () => Promise.resolve(chat),
      clearChatStorage: () => Promise.resolve(), openExternal: () => Promise.resolve(),
      saveMode: () => Promise.resolve(), onChange: vi.fn(),
    })
    await controller.start()
    let settled = false
    const stopping = controller.shutdown().then(() => { settled = true })
    await vi.waitFor(() => { expect(harness.dispose).toHaveBeenCalledOnce() })
    expect(chat.dispose).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    releaseHarness!()
    releaseChat!()
    await stopping
    await controller.shutdown()
    expect(harness.dispose).toHaveBeenCalledOnce()
    expect(chat.dispose).toHaveBeenCalledOnce()
  })

  it('disposes a surface that resolves after shutdown', async () => {
    const harness = surface()
    let resolveHarness: ((surface: DesktopSurface) => void) | undefined
    const createHarness = vi.fn(() => new Promise<DesktopSurface>((resolve) => { resolveHarness = resolve }))
    const controller = createDesktopModeController({
      initialMode: 'harness', createHarness, createChat: () => Promise.resolve(surface()),
      clearChatStorage: () => Promise.resolve(), openExternal: () => Promise.resolve(),
      saveMode: () => Promise.resolve(), onChange: vi.fn(),
    })
    const starting = controller.start()
    await vi.waitFor(() => { expect(createHarness).toHaveBeenCalledOnce() })
    const stopping = controller.shutdown()
    resolveHarness!(harness)
    await Promise.all([starting, stopping])
    expect(harness.dispose).toHaveBeenCalledOnce()
  })

  it('continues disposal, retry, and shutdown when state callbacks throw', async () => {
    const firstHarness = surface()
    const secondHarness = surface()
    const callbackError = new Error('render failed')
    let throwCallbacks = false
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const createHarness = vi.fn().mockResolvedValueOnce(firstHarness).mockResolvedValueOnce(secondHarness)
    const controller = createDesktopModeController({
      initialMode: 'harness', createHarness, createChat: () => Promise.resolve(surface()),
      clearChatStorage: () => Promise.resolve(), openExternal: () => Promise.resolve(), saveMode: () => Promise.resolve(),
      onChange: () => { if (throwCallbacks) throw callbackError },
    })
    try {
      await controller.start()
      throwCallbacks = true
      await controller.fail('harness', new Error('host failed'))
      expect(firstHarness.dispose).toHaveBeenCalledOnce()
      await controller.retry('harness')
      expect(createHarness).toHaveBeenCalledTimes(2)
      await controller.shutdown()
      expect(secondHarness.dispose).toHaveBeenCalledOnce()
      expect(reportError).toHaveBeenCalledWith('desktop mode change callback failed:', callbackError)
    } finally {
      reportError.mockRestore()
    }
  })

  it('keeps a newer external offer pending while an older URL opens', async () => {
    let releaseOpen: (() => void) | undefined
    const openExternal = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { releaseOpen = resolve }))
      .mockResolvedValueOnce(undefined)
    const controller = createDesktopModeController({
      initialMode: 'harness', createHarness: () => Promise.resolve(surface()), createChat: () => Promise.resolve(surface()),
      clearChatStorage: () => Promise.resolve(), openExternal,
      saveMode: () => Promise.resolve(), onChange: vi.fn(),
    })
    controller.offerExternalUrl('https://first.example')
    const opening = controller.openPendingExternal()
    await vi.waitFor(() => { expect(openExternal).toHaveBeenCalledOnce() })
    controller.offerExternalUrl('https://second.example')
    releaseOpen!()
    await opening
    expect(controller.snapshot().pendingExternalUrl).toBe(true)
    await controller.openPendingExternal()
    expect(openExternal).toHaveBeenCalledTimes(2)
    expect(controller.snapshot().pendingExternalUrl).toBe(false)
  })

  it('publishes an unready selected mode as loading before persistence resolves', async () => {
    let releaseSave: (() => void) | undefined
    const saveMode = vi.fn(() => new Promise<void>((resolve) => { releaseSave = resolve }))
    const createChat = vi.fn(() => Promise.resolve(surface()))
    const controller = createDesktopModeController({
      initialMode: 'harness', createHarness: () => Promise.resolve(surface()), createChat,
      clearChatStorage: () => Promise.resolve(), openExternal: () => Promise.resolve(),
      saveMode, onChange: vi.fn(),
    })
    await controller.start()
    const selecting = controller.select('chat')
    await vi.waitFor(() => { expect(saveMode).toHaveBeenCalledWith('chat') })
    expect(controller.snapshot().chat.phase).toBe('loading')
    expect(createChat).not.toHaveBeenCalled()
    releaseSave!()
    await selecting
    expect(createChat).toHaveBeenCalledOnce()
    expect(controller.snapshot().chat.phase).toBe('ready')
  })

  it('ignores resize and Chat reload requests after shutdown starts', async () => {
    const harness = surface()
    const chat = surface()
    const controller = createDesktopModeController({
      initialMode: 'chat', createHarness: () => Promise.resolve(harness), createChat: () => Promise.resolve(chat),
      clearChatStorage: () => Promise.resolve(), openExternal: () => Promise.resolve(),
      saveMode: () => Promise.resolve(), onChange: vi.fn(),
    })
    await controller.start()
    const stopping = controller.shutdown()
    controller.resize({ x: 1, y: 2, width: 3, height: 4 })
    controller.reloadChat()
    await stopping
    expect(harness.setBounds).not.toHaveBeenCalled()
    expect(chat.setBounds).not.toHaveBeenCalled()
    expect(chat.reload).not.toHaveBeenCalled()
  })
})
