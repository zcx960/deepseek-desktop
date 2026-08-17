import { describe, expect, it } from 'vitest'
import { classifyChatUrl, decideChatNavigation } from '../src/chat-navigation.ts'

describe('Chat navigation policy', () => {
  it.each([
    ['https://chat.deepseek.com/', 'chat'],
    ['https://chat.deepseek.com/a/b?x=1#y', 'chat'],
    ['https://example.com/', 'external-web'],
    ['https://evil.deepseek.com/', 'external-web'],
    ['mailto:test@example.com', 'blocked'],
    ['not a url', 'blocked'],
  ] as const)('classifies %s as %s', (url, expected) => {
    expect(classifyChatUrl(url)).toBe(expected)
  })

  it('opens untrusted new-window web links externally but offers top-level escapes for confirmation', () => {
    expect(decideChatNavigation('new-window', 'https://example.com/')).toBe('open-external')
    expect(decideChatNavigation('top-level', 'https://example.com/')).toBe('offer-external')
    expect(decideChatNavigation('redirect', 'https://example.com/')).toBe('block')
  })

  it('allows trusted Chat navigation from every source', () => {
    for (const source of ['new-window', 'top-level', 'redirect'] as const) {
      expect(decideChatNavigation(source, 'https://chat.deepseek.com/sign_in')).toBe('allow')
    }
  })
})
