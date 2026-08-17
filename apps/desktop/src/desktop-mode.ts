/** Shared mode and desktop-surface contracts for the desktop application. */

import type { DesktopThemePreference } from './desktop-theme.ts'

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
  /** Apply content bounds without transferring ownership of the bounds object. */
  setBounds: (bounds: DesktopContentBounds) => void
  /** Include or exclude the retained surface from native drawing. */
  setVisible: (visible: boolean) => void
  /** Reload the current renderer without replacing its persistent session. */
  reload: () => void
  /** Release every renderer, listener, and process owned by the surface. */
  dispose: () => Promise<void>
}

/** Desktop surface that accepts the preference shared by the active mode. */
export interface DesktopThemedSurface extends DesktopSurface {
  /** Apply one shared preference without transferring ownership. */
  setThemePreference: (preference: DesktopThemePreference) => void
}
