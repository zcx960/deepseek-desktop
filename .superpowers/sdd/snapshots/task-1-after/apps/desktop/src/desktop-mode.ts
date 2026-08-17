/** Shared mode and desktop-surface contracts for the desktop application. */

/** Selectable top-level desktop experience. */
export type DesktopMode = 'chat' | 'harness'

/** Lifecycle phase reported by a desktop mode surface. */
export type DesktopModePhase = 'idle' | 'loading' | 'ready' | 'failed'

/** Current lifecycle state of one desktop mode surface. */
export interface DesktopModeStatus {
  readonly phase: DesktopModePhase
  readonly message?: string
}

/** Combined mode selection and surface status snapshot. */
export interface DesktopModeSnapshot {
  readonly selected: DesktopMode
  readonly chat: DesktopModeStatus
  readonly harness: DesktopModeStatus
  readonly pendingExternalUrl: boolean
}

/** Pixel bounds occupied by a desktop content surface. */
export interface DesktopContentBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Lifecycle and presentation operations owned by a desktop surface. */
export interface DesktopSurface {
  setBounds(bounds: DesktopContentBounds): void
  setVisible(visible: boolean): void
  reload(): void
  dispose(): Promise<void>
}
