export type DesktopMode = 'harness' | 'chat'
export type ChatPhase = 'idle' | 'loading' | 'ready' | 'failed'

export interface ChatSnapshot {
  phase: ChatPhase
  error: string | null
  generation: number
}

export interface ChatBounds {
  x: number
  y: number
  width: number
  height: number
}

export function restoredMode(value: unknown): DesktopMode {
  return value === 'chat' ? 'chat' : 'harness'
}

export function acceptSnapshot(current: ChatSnapshot, next: ChatSnapshot): boolean {
  if (next.generation !== current.generation)
    return next.generation > current.generation
  if (current.phase === 'ready' || current.phase === 'failed')
    return next.phase === current.phase
  return true
}
