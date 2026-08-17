/** Active-mode authority and propagation for the desktop theme preference. */

import type { DesktopMode } from './desktop-mode.ts'
import {
  isDesktopColorScheme,
  isDesktopThemeBackgroundColor,
  isDesktopThemePreference,
  type DesktopColorScheme,
  type DesktopThemePreference,
} from './desktop-theme.ts'

export { isDesktopThemePreference } from './desktop-theme.ts'

/** Closed IPC channels shared by the two trusted theme preloads. */
export const DESKTOP_THEME_CHANNELS = {
  report: 'dsh-desktop:theme-report',
  apply: 'dsh-desktop:theme-apply',
  adapterError: 'dsh-desktop:theme-adapter-error',
} as const

/** Preference and resolved color scheme reported by one desktop renderer. */
export interface DesktopThemeState {
  readonly preference: DesktopThemePreference
  readonly scheme: DesktopColorScheme
  readonly backgroundColor?: string
}

/** Detached coordinator state for presentation and tests. */
export interface DesktopThemeSnapshot extends DesktopThemeState {
  readonly authoritative: boolean
  readonly selected: DesktopMode
}

/** Dependencies for one in-memory desktop theme coordinator. */
export interface DesktopThemeCoordinatorOptions {
  readonly initialMode: DesktopMode
  readonly initialSystemScheme: DesktopColorScheme
  readonly onChange: (snapshot: DesktopThemeSnapshot) => void
}

/** Active-mode theme operations used by the desktop composition root. */
export interface DesktopThemeCoordinator {
  /** Accept a renderer report, using only the selected mode as an authority. */
  report(mode: DesktopMode, state: DesktopThemeState): void
  /** Connect one mode's preference writer and return its idempotent disposer. */
  connect(mode: DesktopMode, apply: (preference: DesktopThemePreference) => void): () => void
  /** Select the new authority and apply established state before it reports. */
  select(mode: DesktopMode): void
  /** Update the resolved scheme while the shared preference follows the system. */
  systemChanged(scheme: DesktopColorScheme): void
  /** Return a detached view of the current coordinator state. */
  snapshot(): DesktopThemeSnapshot
}

/**
 * Validate one renderer theme report.
 * @param value - Value received from a sandboxed preload.
 * @returns Whether the value contains one accepted preference and resolved scheme.
 */
export function isDesktopThemeState(value: unknown): value is DesktopThemeState {
  if (typeof value !== 'object' || value === null) return false
  const state = value as { preference?: unknown; scheme?: unknown; backgroundColor?: unknown }
  return isDesktopThemePreference(state.preference)
    && isDesktopColorScheme(state.scheme)
    && (state.backgroundColor === undefined || isDesktopThemeBackgroundColor(state.backgroundColor))
}

function sameState(left: DesktopThemeState, right: DesktopThemeState): boolean {
  return left.preference === right.preference
    && left.scheme === right.scheme
    && left.backgroundColor === right.backgroundColor
}

/**
 * Create an in-memory coordinator that propagates only active-mode changes.
 * @param options - Initial selection, operating-system fallback, and presentation listener.
 * @returns Theme operations whose connections are owned by individual surfaces.
 */
export function createDesktopThemeCoordinator(options: DesktopThemeCoordinatorOptions): DesktopThemeCoordinator {
  let selected = options.initialMode
  let authoritative = false
  let state: DesktopThemeState = { preference: 'system', scheme: options.initialSystemScheme }
  const targets = new Map<DesktopMode, (preference: DesktopThemePreference) => void>()

  const snapshot = (): DesktopThemeSnapshot => ({ ...state, authoritative, selected })
  const publish = (): void => { options.onChange(snapshot()) }
  const applyToOtherModes = (source: DesktopMode): void => {
    for (const [mode, apply] of targets) {
      if (mode !== source) apply(state.preference)
    }
  }

  return {
    report(mode, report) {
      if (mode !== selected) {
        if (authoritative && report.preference !== state.preference) {
          targets.get(mode)?.(state.preference)
        }
        return
      }
      if (authoritative && sameState(state, report)) return
      authoritative = true
      state = { ...report }
      publish()
      applyToOtherModes(mode)
    },
    connect(mode, apply) {
      if (targets.has(mode)) throw new Error(`desktop theme target is already connected: ${mode}`)
      targets.set(mode, apply)
      if (authoritative) apply(state.preference)
      let connected = true
      return () => {
        if (!connected) return
        connected = false
        if (targets.get(mode) === apply) targets.delete(mode)
      }
    },
    select(mode) {
      selected = mode
      if (authoritative) targets.get(mode)?.(state.preference)
    },
    systemChanged(scheme) {
      if (state.preference !== 'system' || state.scheme === scheme) return
      state = { ...state, scheme }
      publish()
    },
    snapshot,
  }
}
