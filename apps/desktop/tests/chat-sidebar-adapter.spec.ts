import { describe, expect, it } from 'vitest'
import {
  CHAT_LAST_SESSION_STORAGE_KEY,
  resolveExpandedChatSidebar,
} from '../src/chat-sidebar-adapter.ts'

describe('DeepSeek Chat sidebar adapter', () => {
  it('opens the current official version-zero sidebar state without changing sibling values', () => {
    expect(CHAT_LAST_SESSION_STORAGE_KEY).toBe('__appKit_@deepseek/chat_lastSessionValue')
    expect(resolveExpandedChatSidebar(JSON.stringify({
      value: {
        userIsMuted: false,
        userMuteUntil: 0,
        loginMethod: 'code',
        siderCollapsed: true,
      },
      __version: '0',
    }))).toEqual({
      kind: 'update',
      value: '{"value":{"userIsMuted":false,"userMuteUntil":0,"loginMethod":"code","siderCollapsed":false},"__version":"0"}',
    })
  })

  it('leaves missing and already-expanded state untouched', () => {
    expect(resolveExpandedChatSidebar(null)).toEqual({ kind: 'unchanged' })
    expect(resolveExpandedChatSidebar(
      '{"value":{"siderCollapsed":false},"__version":"0"}',
    )).toEqual({ kind: 'unchanged' })
  })

  it('rejects malformed or unknown storage without overwriting it', () => {
    for (const raw of [
      '',
      '{',
      '[]',
      'null',
      '{"value":{"siderCollapsed":true},"__version":"1"}',
      '{"value":{"siderCollapsed":true},"__version":"0","extra":true}',
      '{"value":{},"__version":"0"}',
      '{"value":{"siderCollapsed":"yes"},"__version":"0"}',
    ]) {
      expect(resolveExpandedChatSidebar(raw)).toEqual({ kind: 'unsupported' })
    }
  })
})
