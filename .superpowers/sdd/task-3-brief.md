# Task 3: Framework-Neutral Mode Controller

## Context

This task adds the pure state machine that coordinates the independent Harness and Chat surfaces. It owns lifecycle ordering and state publication, but it must not import Electron or change the concrete surface adapters added by later tasks.

## Global constraints

- Harness and Chat never share conversations, prompts, credentials, cookies, storage, navigation state, Session events, or telemetry content.
- Every production registration, event listener, IPC handler, view, window, and Host process has one disposer.
- Preserve strict ESM TypeScript and JSDoc conventions.
- You are not alone in the codebase. Do not revert edits made by other workers; adjust to existing changes.
- The workspace has no `.git`; do not initialize Git or attempt a commit.
- Existing Vite path warnings and unsupported-platform notices are baseline noise.

## Files owned by this task

- Create: `apps/desktop/src/desktop-mode-controller.ts`
- Create: `apps/desktop/tests/desktop-mode-controller.spec.ts`
- Modify: `apps/desktop/src/desktop-mode.ts`

Do not edit other files.

## Interfaces

- Consumes: `DesktopMode`, `DesktopModeSnapshot`, `DesktopContentBounds`, and `DesktopSurface` from Task 1.
- Produces: `createDesktopModeController(options)` with `select`, `retry`, `resize`, `reloadChat`, `clearChatData`, `offerExternalUrl`, `openPendingExternal`, `fail`, `snapshot`, and `shutdown`.

## Step 1: Write failing controller ownership tests

```ts
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
      clearChatStorage: () => Promise.resolve(), openExternal: () => Promise.resolve(), saveMode: () => Promise.resolve(), onChange: vi.fn(),
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
      clearChatStorage: () => Promise.resolve(), openExternal: () => Promise.resolve(), saveMode: () => Promise.resolve(), onChange: vi.fn(),
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
      clearChatStorage: async () => { order.push('clear') }, openExternal: () => Promise.resolve(), saveMode: () => Promise.resolve(), onChange: vi.fn(),
    })
    await controller.start()
    await controller.clearChatData()
    expect(order).toEqual(['dispose', 'clear'])
    expect(controller.snapshot().chat.phase).toBe('ready')
  })
})
```

## Step 2: Verify the tests fail before the controller exists

Run: `pnpm exec vitest run apps/desktop/tests/desktop-mode-controller.spec.ts`

Expected: FAIL resolving `desktop-mode-controller.ts`.

## Step 3: Implement one serialized controller queue

```ts
export interface DesktopModeControllerOptions {
  readonly initialMode: DesktopMode
  readonly createHarness: (onFailure: (error: Error) => void) => Promise<DesktopSurface>
  readonly createChat: (onFailure: (error: Error) => void) => Promise<DesktopSurface>
  readonly clearChatStorage: () => Promise<void>
  readonly openExternal: (url: string) => Promise<void>
  readonly saveMode: (mode: DesktopMode) => Promise<void>
  readonly onChange: (snapshot: DesktopModeSnapshot) => void
}

export interface DesktopModeController {
  start(): Promise<void>
  select(mode: DesktopMode): Promise<void>
  retry(mode: DesktopMode): Promise<void>
  resize(bounds: DesktopContentBounds): void
  reloadChat(): void
  clearChatData(): Promise<void>
  offerExternalUrl(url: string): void
  openPendingExternal(): Promise<void>
  fail(mode: DesktopMode, error: Error): Promise<void>
  snapshot(): DesktopModeSnapshot
  shutdown(): Promise<void>
}
```

Implement `start()` so Harness starts eagerly while Chat starts only when initially selected. Serialize every mutating async method through one tail promise; set the requested phase before awaiting; dispose a failed or cleared surface before replacement; publish a detached snapshot after every transition; ignore create completions after shutdown; and show only the selected ready surface. Keep the pending external URL only in the controller, expose only its presence in snapshots, clear it after `openPendingExternal`, and never log it.

## Step 4: Add race cases and make the complete controller test pass

Add cases proving concurrent selections coalesce, `resize` reaches both retained surfaces, `shutdown` waits for both disposers once, and a create resolving after shutdown is immediately disposed.

Run: `pnpm exec vitest run apps/desktop/tests/desktop-mode-controller.spec.ts apps/desktop/tests/desktop-state.spec.ts`

Expected: all controller and state tests pass with no unhandled rejection.

Also run: `pnpm --filter @deepseek-ai/dsh-desktop run typecheck`

Expected: both Desktop TypeScript programs exit 0.

## Report

Write `.superpowers/sdd/task-3-report.md` with RED/GREEN evidence, changed files, self-review, and concerns. Return only status, test summary, concerns, and report path. Do not claim a Git commit.
