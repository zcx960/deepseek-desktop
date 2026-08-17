# Task 2: Exact-Origin Chat Navigation Policy

## Context

This task adds one pure policy module used later by the Electron Chat surface. It must not import Electron, touch the DOM, open a browser, or change main-process code.

## Global constraints

- Chat starts at the fixed URL `https://chat.deepseek.com/` and uses `persist:dsh-deepseek-chat`.
- Trusted remote navigation uses exact HTTPS origins only; never accept a `*.deepseek.com` wildcard.
- Do not inject scripts into Chat, inspect its DOM, read its cookies or storage, call undocumented APIs, or bypass WAF and bot checks.
- Preserve strict ESM TypeScript and JSDoc conventions.
- You are not alone in the codebase. Do not revert edits made by other workers; adjust to existing changes.
- The workspace has no `.git`; do not initialize Git or attempt a commit.
- Existing Vite path warnings are baseline noise.

## Files owned by this task

- Create: `apps/desktop/src/chat-navigation.ts`
- Create: `apps/desktop/tests/chat-navigation.spec.ts`

Do not edit other files.

## Required interfaces

```ts
export const CHAT_URL = 'https://chat.deepseek.com/'
export const CHAT_PARTITION = 'persist:dsh-deepseek-chat'
export type ChatUrlClass = 'chat' | 'auth' | 'external-web' | 'blocked'
export type ChatNavigationSource = 'new-window' | 'top-level' | 'redirect'
export type ChatNavigationDecision = 'allow' | 'open-external' | 'offer-external' | 'block'
export function classifyChatUrl(raw: string): ChatUrlClass
export function decideChatNavigation(source: ChatNavigationSource, raw: string): ChatNavigationDecision
```

Use a `CHAT_ORIGINS` exact-origin set initialized with `new URL(CHAT_URL).origin` and an initially empty `AUTH_ORIGINS` exact-origin set. `classifyChatUrl` accepts any path/query/hash under the trusted Chat origin, returns `auth` for a future explicitly added authentication origin, returns `external-web` only for valid HTTPS URLs outside both sets, and returns `blocked` for malformed URLs or every non-HTTPS protocol. Do not use hostname suffix checks.

`decideChatNavigation` returns `allow` for `chat` and `auth`; `open-external` for an external HTTPS `new-window`; `offer-external` for an external HTTPS `top-level`; and `block` for redirects and all blocked URLs. The offer decision lets a later main-process controller show a user-confirmed browser action while preserving the no-script-injection policy.

## Required tests

```ts
import { describe, expect, it } from 'vitest'
import { classifyChatUrl, decideChatNavigation } from '../src/chat-navigation.ts'

describe('Chat navigation policy', () => {
  it.each([
    ['https://chat.deepseek.com/', 'chat'],
    ['https://chat.deepseek.com/a/b?x=1#y', 'chat'],
    ['https://example.com/', 'external-web'],
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
```

Add a focused assertion that `https://evil.deepseek.com/` remains `external-web`, proving the policy is exact-origin rather than suffix-based.

## Commands and evidence

RED: `pnpm exec vitest run apps/desktop/tests/chat-navigation.spec.ts`

Expected before implementation: module-resolution failure for `../src/chat-navigation.ts`.

GREEN: `pnpm exec vitest run apps/desktop/tests/chat-navigation.spec.ts && pnpm --filter @deepseek-ai/dsh-desktop run typecheck`

Expected after implementation: all policy tests pass and Desktop typecheck exits 0.

## Report

Write `.superpowers/sdd/task-2-report.md` with RED/GREEN evidence, changed files, self-review, and concerns. Return only status, test summary, concerns, and report path. Do not claim a Git commit.
