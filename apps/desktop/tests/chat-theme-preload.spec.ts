import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_LAST_SESSION_STORAGE_KEY } from '../src/chat-sidebar-adapter.ts'

const ipcRenderer = vi.hoisted(() => ({ on: vi.fn(), send: vi.fn() }))

vi.mock('electron', () => ({ ipcRenderer }))

describe('DeepSeek Chat preload', () => {
  beforeEach(() => {
    vi.resetModules()
    ipcRenderer.on.mockClear()
    ipcRenderer.send.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens a retained collapsed sidebar before the official page initializes', async () => {
    const getItem = vi.fn((key: string) => key === CHAT_LAST_SESSION_STORAGE_KEY
      ? '{"value":{"loginMethod":"code","siderCollapsed":true},"__version":"0"}'
      : null)
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem, setItem })
    vi.stubGlobal('window', { addEventListener: vi.fn() })

    await import('../src/chat-theme-preload.ts')

    expect(getItem).toHaveBeenCalledWith(CHAT_LAST_SESSION_STORAGE_KEY)
    expect(setItem).toHaveBeenCalledWith(
      CHAT_LAST_SESSION_STORAGE_KEY,
      '{"value":{"loginMethod":"code","siderCollapsed":false},"__version":"0"}',
    )
  })
})
