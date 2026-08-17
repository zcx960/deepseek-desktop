# Task 1: Mode Types and Atomic Desktop State

## Context

This is the first implementation unit for the approved isolated DeepSeek Chat desktop mode. It introduces only shared mode types and durable last-mode state; it must not touch Electron composition, Chat navigation, or UI.

## Global constraints

- Node remains `^22.19.0 || >=24.0.0`; Electron remains `43.4.0`.
- Harness and Chat never share conversations, prompts, credentials, cookies, storage, navigation state, Session events, or telemetry content.
- Keep changes outside `vendor/`.
- Every export has concise contract JSDoc required by `verify-export-jsdoc`.
- Follow TDD: capture the failing command and output before implementation, then the passing command and output.
- The workspace has no `.git`; do not initialize Git and do not attempt the commit step.
- You are not alone in the codebase. Do not revert edits made by other workers; adjust to existing changes.

## Files owned by this task

- Create: `apps/desktop/src/desktop-mode.ts`
- Create: `apps/desktop/src/desktop-state.ts`
- Create: `apps/desktop/tests/desktop-state.spec.ts`
- Modify: `apps/desktop/package.json`
- Mechanical lockfile update: `pnpm-lock.yaml`

Do not edit any other production or test file.

## Required interfaces

`apps/desktop/src/desktop-mode.ts` produces:

```ts
export type DesktopMode = 'chat' | 'harness'
export type DesktopModePhase = 'idle' | 'loading' | 'ready' | 'failed'

export interface DesktopModeStatus {
  readonly phase: DesktopModePhase
  readonly message?: string
}

export interface DesktopModeSnapshot {
  readonly selected: DesktopMode
  readonly chat: DesktopModeStatus
  readonly harness: DesktopModeStatus
  readonly pendingExternalUrl: boolean
}

export interface DesktopContentBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface DesktopSurface {
  setBounds(bounds: DesktopContentBounds): void
  setVisible(visible: boolean): void
  reload(): void
  dispose(): Promise<void>
}
```

`apps/desktop/src/desktop-state.ts` produces:

```ts
export async function loadDesktopMode(filename: string): Promise<DesktopMode>
export async function saveDesktopMode(filename: string, mode: DesktopMode): Promise<void>
```

`loadDesktopMode` returns `harness` only for `ENOENT`. It rejects malformed JSON, unknown versions, unknown modes, and other filesystem failures. `saveDesktopMode` writes exactly `{"version":1,"mode":"<mode>"}\n` through `writeFileAtomic(filename, content, { mode: 0o600, dirMode: 0o700 })`.

Add `"@deepseek-ai/dsh-atomic-write": "workspace:^"` to `apps/desktop/package.json` dependencies and update the lockfile with pnpm.

## Required test

Create `apps/desktop/tests/desktop-state.spec.ts` with these behaviors:

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadDesktopMode, saveDesktopMode } from '../src/desktop-state.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function stateFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-state-'))
  roots.push(root)
  return join(root, 'nested', 'desktop-state.json')
}

describe('desktop mode persistence', () => {
  it('defaults a missing file to Harness', async () => {
    await expect(loadDesktopMode(await stateFile())).resolves.toBe('harness')
  })

  it('round-trips a validated versioned mode with owner-only permissions', async () => {
    const filename = await stateFile()
    await saveDesktopMode(filename, 'chat')
    expect(await readFile(filename, 'utf8')).toBe('{"version":1,"mode":"chat"}\n')
    await expect(loadDesktopMode(filename)).resolves.toBe('chat')
  })

  it('rejects malformed or unknown durable state', async () => {
    const filename = await stateFile()
    await writeFile(filename, '{"version":2,"mode":"chat"}\n')
    await expect(loadDesktopMode(filename)).rejects.toThrow('desktop state is invalid')
  })
})
```

You may add focused cases for malformed JSON, an unknown mode, and a non-ENOENT read failure. Do not weaken the required cases.

## Commands and expected evidence

RED: `pnpm exec vitest run apps/desktop/tests/desktop-state.spec.ts`

Expected before implementation: failure because `../src/desktop-state.ts` cannot be resolved.

GREEN: `pnpm exec vitest run apps/desktop/tests/desktop-state.spec.ts && pnpm --filter @deepseek-ai/dsh-desktop run typecheck`

Expected after implementation: all state tests pass and both Desktop TypeScript programs exit 0. Existing vite-tsconfig-paths warnings are baseline noise and must be reported, not attributed to this task.

## Report

Write the complete report to `.superpowers/sdd/task-1-report.md` with implemented behavior, RED/GREEN evidence, files changed, self-review, and concerns. Return only status, test summary, concerns, and the report path.
