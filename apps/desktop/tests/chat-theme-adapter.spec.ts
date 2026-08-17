import { describe, expect, it } from 'vitest'
import {
  CHAT_THEME_STORAGE_KEY,
  parseChatThemeStorage,
  schemeFromChatBody,
  serializeChatThemeStorage,
} from '../src/chat-theme-adapter.ts'

describe('DeepSeek Chat theme adapter', () => {
  it('pins the current official storage key and versioned envelope', () => {
    expect(CHAT_THEME_STORAGE_KEY).toBe('__appKit_@deepseek/chat_themePreference')
    expect(serializeChatThemeStorage('light')).toBe('{"value":"light","__version":"0"}')
    expect(serializeChatThemeStorage('dark')).toBe('{"value":"dark","__version":"0"}')
    expect(serializeChatThemeStorage('system')).toBe('{"value":"system","__version":"0"}')
  })

  it('accepts exactly the three version-zero preferences', () => {
    expect(parseChatThemeStorage('{"value":"light","__version":"0"}')).toBe('light')
    expect(parseChatThemeStorage('{"__version":"0","value":"dark"}')).toBe('dark')
    expect(parseChatThemeStorage('{"value":"system","__version":"0"}')).toBe('system')
  })

  it('rejects malformed, unknown, and expanded storage envelopes', () => {
    for (const raw of [
      null,
      '',
      '{',
      '[]',
      'null',
      '{"value":"sepia","__version":"0"}',
      '{"value":"dark","__version":"1"}',
      '{"value":"dark"}',
      '{"value":"dark","__version":"0","extra":true}',
    ]) {
      expect(parseChatThemeStorage(raw)).toBeUndefined()
    }
  })

  it('resolves only self-consistent official body markers', () => {
    expect(schemeFromChatBody({ classList: new Set(['apple', 'light']), darkAttribute: null })).toBe('light')
    expect(schemeFromChatBody({ classList: new Set(['apple', 'dark']), darkAttribute: 'dark' })).toBe('dark')
    expect(schemeFromChatBody({ classList: new Set(['light', 'dark']), darkAttribute: 'dark' })).toBeUndefined()
    expect(schemeFromChatBody({ classList: new Set(['dark']), darkAttribute: null })).toBeUndefined()
    expect(schemeFromChatBody({ classList: new Set(['light']), darkAttribute: 'dark' })).toBeUndefined()
    expect(schemeFromChatBody({ classList: new Set(['apple']), darkAttribute: null })).toBeUndefined()
  })
})
