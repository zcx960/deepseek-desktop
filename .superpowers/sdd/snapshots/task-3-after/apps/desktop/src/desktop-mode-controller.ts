/** Framework-neutral controller for the desktop mode surfaces. */

import type {
  DesktopContentBounds,
  DesktopMode,
  DesktopModeSnapshot,
  DesktopModeStatus,
  DesktopSurface,
} from './desktop-mode.ts'

/** Dependencies used to coordinate the independent desktop surfaces. */
export interface DesktopModeControllerOptions {
  readonly initialMode: DesktopMode
  readonly createHarness: (onFailure: (error: Error) => void) => Promise<DesktopSurface>
  readonly createChat: (onFailure: (error: Error) => void) => Promise<DesktopSurface>
  readonly clearChatStorage: () => Promise<void>
  readonly openExternal: (url: string) => Promise<void>
  readonly saveMode: (mode: DesktopMode) => Promise<void>
  readonly onChange: (snapshot: DesktopModeSnapshot) => void
}

/** Framework-neutral operations for selecting and managing desktop surfaces. */
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

type SurfaceMap = Record<DesktopMode, DesktopSurface | undefined>
type StatusMap = Record<DesktopMode, DesktopModeStatus>
type GenerationMap = Record<DesktopMode, number>

/** Converts rejected values into the error reported by the controller. */
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Coordinates the isolated Harness and Chat lifecycles without depending on a desktop framework.
 *
 * @param options Surface factories and side effects supplied by the desktop composition root.
 * @returns A serialized controller for the two independent surfaces.
 */
export function createDesktopModeController(options: DesktopModeControllerOptions): DesktopModeController {
  let selected = options.initialMode
  let pendingExternalUrl: string | undefined
  let pendingExternalGeneration = 0
  let bounds: DesktopContentBounds | undefined
  let started = false
  let shuttingDown = false
  let tail = Promise.resolve()
  const surfaces: SurfaceMap = { chat: undefined, harness: undefined }
  const statuses: StatusMap = {
    chat: { phase: 'idle' },
    harness: { phase: 'idle' },
  }
  const generations: GenerationMap = { chat: 0, harness: 0 }

  /** Returns a new immutable-by-ownership view of the current controller state. */
  function snapshot(): DesktopModeSnapshot {
    return {
      selected,
      chat: { ...statuses.chat },
      harness: { ...statuses.harness },
      pendingExternalUrl: pendingExternalUrl !== undefined,
    }
  }

  /** Makes only the selected ready surface visible. */
  function updateVisibility(): void {
    for (const mode of ['chat', 'harness'] as const) {
      surfaces[mode]?.setVisible(!shuttingDown && selected === mode && statuses[mode].phase === 'ready')
    }
  }

  /** Publishes detached state after a lifecycle transition. */
  function publish(): void {
    updateVisibility()
    try {
      options.onChange(snapshot())
    } catch (error) {
      console.error('desktop mode change callback failed:', error)
    }
  }

  /** Updates the phase and notifies the composition root. */
  function setStatus(mode: DesktopMode, status: DesktopModeStatus): void {
    statuses[mode] = status
    publish()
  }

  /** Runs one asynchronous state transition after previously queued transitions. */
  function enqueue(operation: () => Promise<void>): Promise<void> {
    const result = tail.then(operation)
    tail = result.catch(() => undefined)
    return result
  }

  /** Disposes a surface after removing it from controller ownership. */
  async function disposeSurface(mode: DesktopMode): Promise<void> {
    const surface = surfaces[mode]
    surfaces[mode] = undefined
    if (surface !== undefined) await surface.dispose()
  }

  /** Applies saved bounds to a newly created surface. */
  function applyBounds(surface: DesktopSurface): void {
    if (bounds !== undefined) surface.setBounds({ ...bounds })
  }

  /** Marks a mode as failed, retaining the other independent surface. */
  async function failMode(mode: DesktopMode, error: Error, generation?: number): Promise<void> {
    if (shuttingDown || (generation !== undefined && generations[mode] !== generation)) return
    generations[mode] += 1
    setStatus(mode, { phase: 'failed', message: error.message })
    await disposeSurface(mode)
  }

  /** Creates one surface and records its lifecycle without allowing stale completions to attach. */
  async function createSurface(mode: DesktopMode, replaceLoading = false): Promise<void> {
    if (shuttingDown || surfaces[mode] !== undefined || (statuses[mode].phase === 'loading' && !replaceLoading)) return
    const generation = generations[mode] + 1
    generations[mode] = generation
    setStatus(mode, { phase: 'loading' })
    const create = mode === 'chat' ? options.createChat : options.createHarness
    let surface: DesktopSurface
    try {
      surface = await create(error => {
        void enqueue(() => failMode(mode, error, generation)).catch(() => undefined)
      })
    } catch (error) {
      await failMode(mode, asError(error), generation)
      return
    }
    if (shuttingDown || generations[mode] !== generation) {
      await surface.dispose()
      return
    }
    surfaces[mode] = surface
    applyBounds(surface)
    setStatus(mode, { phase: 'ready' })
  }

  return {
    async start(): Promise<void> {
      return enqueue(async () => {
        if (started || shuttingDown) return
        started = true
        const creates = [createSurface('harness')]
        if (selected === 'chat') creates.push(createSurface('chat'))
        await Promise.all(creates)
      })
    },

    async select(mode: DesktopMode): Promise<void> {
      return enqueue(async () => {
        if (shuttingDown) return
        selected = mode
        publish()
        const createSurfaceAfterSave = surfaces[mode] === undefined && statuses[mode].phase !== 'ready'
        if (createSurfaceAfterSave) setStatus(mode, { phase: 'loading' })
        await options.saveMode(mode)
        await createSurface(mode, createSurfaceAfterSave)
      })
    },

    async retry(mode: DesktopMode): Promise<void> {
      return enqueue(async () => {
        if (shuttingDown || statuses[mode].phase !== 'failed') return
        await createSurface(mode)
      })
    },

    resize(nextBounds: DesktopContentBounds): void {
      if (shuttingDown) return
      bounds = { ...nextBounds }
      for (const mode of ['chat', 'harness'] as const) {
        const surface = surfaces[mode]
        if (surface !== undefined) applyBounds(surface)
      }
    },

    reloadChat(): void {
      if (shuttingDown) return
      surfaces.chat?.reload()
    },

    async clearChatData(): Promise<void> {
      return enqueue(async () => {
        if (shuttingDown) return
        generations.chat += 1
        setStatus('chat', { phase: 'loading' })
        await disposeSurface('chat')
        await options.clearChatStorage()
        if (shuttingDown) return
        if (selected === 'chat') {
          await createSurface('chat', true)
        } else {
          setStatus('chat', { phase: 'idle' })
        }
      })
    },

    offerExternalUrl(url: string): void {
      if (shuttingDown) return
      pendingExternalUrl = url
      pendingExternalGeneration += 1
      publish()
    },

    async openPendingExternal(): Promise<void> {
      return enqueue(async () => {
        if (shuttingDown || pendingExternalUrl === undefined) return
        const url = pendingExternalUrl
        const generation = pendingExternalGeneration
        await options.openExternal(url)
        if (generation !== pendingExternalGeneration) return
        pendingExternalUrl = undefined
        publish()
      })
    },

    async fail(mode: DesktopMode, error: Error): Promise<void> {
      return enqueue(() => failMode(mode, error))
    },

    snapshot,

    async shutdown(): Promise<void> {
      shuttingDown = true
      updateVisibility()
      return enqueue(async () => {
        pendingExternalUrl = undefined
        pendingExternalGeneration += 1
        publish()
        await Promise.all([disposeSurface('chat'), disposeSurface('harness')])
      })
    },
  }
}
