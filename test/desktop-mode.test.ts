import type { ChatSnapshot } from '../src/store/modules/desktop-mode/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptSnapshot, restoredMode } from '../src/store/modules/desktop-mode/types'

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  preferences: { get: vi.fn(), set: vi.fn(), save: vi.fn() },
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }))
vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: async () => bridge.preferences } }))

const idle: ChatSnapshot = { phase: 'idle', error: null, generation: 0 }
const ready: ChatSnapshot = { phase: 'ready', error: null, generation: 1 }

async function freshStore() {
  vi.resetModules()
  return (await import('../src/store/modules/desktop-mode')).desktopMode
}

beforeEach(() => {
  vi.clearAllMocks()
  bridge.preferences.get.mockResolvedValue(undefined)
  bridge.preferences.set.mockResolvedValue(undefined)
  bridge.preferences.save.mockResolvedValue(undefined)
  bridge.invoke.mockResolvedValue(idle)
})

describe('desktop mode', () => {
  it('restores Chat once even if React mounts twice', async () => {
    bridge.preferences.get.mockResolvedValue('chat')
    bridge.invoke.mockResolvedValue(ready)
    const store = await freshStore()
    await Promise.all([store.initialize(), store.initialize()])
    expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith('desktop_chat_select', { mode: 'chat' })
    expect(store.selected).toBe('chat')
    expect(store.chat.phase).toBe('ready')
    expect(store.initialized).toBe(true)
  })

  it('defaults unknown saved modes to Harness without creating Chat', async () => {
    expect(restoredMode({ mode: 'chat' })).toBe('harness')
    bridge.preferences.get.mockResolvedValue('unknown')
    const store = await freshStore()
    await store.initialize()
    expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith('desktop_chat_select', { mode: 'harness' })
  })

  it('serializes rapid switches and persists the final native selection', async () => {
    const first = Promise.withResolvers<ChatSnapshot>()
    bridge.invoke.mockReturnValueOnce(first.promise).mockResolvedValue(ready)
    const store = await freshStore()
    const chat = store.select('chat')
    const harness = store.select('harness')
    await vi.waitFor(() => expect(bridge.invoke).toHaveBeenCalledTimes(1))
    expect(store.busy).toBe(true)
    first.resolve(ready)
    await Promise.all([chat, harness])
    expect(bridge.invoke.mock.calls).toEqual([
      ['desktop_chat_select', { mode: 'chat' }],
      ['desktop_chat_select', { mode: 'harness' }],
    ])
    expect(bridge.preferences.set).toHaveBeenLastCalledWith('selected', 'harness')
    expect(store.selected).toBe('harness')
    expect(store.busy).toBe(false)
  })

  it('can switch back after a rejected command', async () => {
    bridge.invoke.mockRejectedValueOnce('CHAT_CREATE_FAILED').mockResolvedValue(idle)
    const store = await freshStore()
    await store.select('chat')
    expect(store.selected).toBe('harness')
    expect(store.error).toContain('CHAT_CREATE_FAILED')
    expect(bridge.preferences.set).not.toHaveBeenCalled()
    await store.select('harness')
    expect(store.error).toBe('')
    expect(store.busy).toBe(false)
  })

  it('keeps a failed Chat selectable and recovers through retry', async () => {
    bridge.invoke.mockResolvedValueOnce({ phase: 'failed', error: 'CHAT_LOAD_TIMEOUT', generation: 1 })
    const store = await freshStore()
    await store.select('chat')
    expect(store.selected).toBe('chat')
    expect(store.chat.phase).toBe('failed')
    bridge.invoke.mockResolvedValue({ ...ready, generation: 3 })
    await store.retryChat()
    expect(store.chat.phase).toBe('ready')
    expect(bridge.invoke).toHaveBeenLastCalledWith('desktop_chat_retry')
  })

  it('ignores old and regressive status events after retry', async () => {
    const store = await freshStore()
    store.receive({ ...ready, generation: 4 })
    store.receive({ phase: 'loading', error: null, generation: 3 })
    store.receive({ phase: 'loading', error: null, generation: 4 })
    expect(store.chat.phase).toBe('ready')
    expect(acceptSnapshot({ ...ready, phase: 'failed' }, ready)).toBe(false)
    store.receive({ phase: 'idle', error: null, generation: 5 })
    expect(store.chat.phase).toBe('idle')
  })

  it('hides the native page before a confirmation and does not clear on cancellation', async () => {
    const store = await freshStore()
    const bounds = { x: 0, y: 52, width: 1280, height: 700 }
    await store.syncLayout(bounds, false)
    await store.suspendChat()
    expect(bridge.invoke).toHaveBeenLastCalledWith('desktop_chat_layout', { bounds, occluded: true })
    await store.syncLayout(bounds, false)
    expect(bridge.invoke).toHaveBeenLastCalledWith('desktop_chat_layout', { bounds, occluded: true })
    store.resumeChat()
    await store.syncLayout(bounds, false)
    expect(bridge.invoke).toHaveBeenLastCalledWith('desktop_chat_layout', { bounds, occluded: false })
    expect(bridge.invoke.mock.calls.some(call => call[0] === 'desktop_chat_clear')).toBe(false)
  })

  it('reports clear failures and still accepts a later retry', async () => {
    const store = await freshStore()
    bridge.invoke.mockRejectedValueOnce('CHAT_CLEAR_FAILED').mockResolvedValue(ready)
    await expect(store.clearChatData()).rejects.toBe('CHAT_CLEAR_FAILED')
    expect(store.error).toContain('CHAT_CLEAR_FAILED')
    await store.retryChat()
    expect(store.chat.phase).toBe('ready')
    expect(store.error).toBe('')
  })

  it('clears through the dedicated native command and never changes the saved mode', async () => {
    const store = await freshStore()
    bridge.invoke.mockResolvedValue({ phase: 'loading', error: null, generation: 8 })
    await store.clearChatData()
    expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith('desktop_chat_clear')
    expect(bridge.preferences.set).not.toHaveBeenCalled()
    expect(store.chat.generation).toBe(8)
  })
})
