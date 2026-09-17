/** Desktop surface adapter for the Harness renderer owned by the main window. */

import type { BrowserWindow } from 'electron'
import type { DesktopContentBounds, DesktopSurface } from '../shared/desktop-mode'

/** Operations the adapter needs from the composition root that owns the window. */
export interface HarnessSurfaceOptions {
  /** Window whose `webContents` carries the Harness renderer. */
  readonly window: BrowserWindow
  /** Reload the live Harness origin without replacing its session. */
  readonly reload: () => void
}

/**
 * Wrap the main window's `webContents` as a desktop surface.
 *
 * `BrowserWindow.webContents` is not a `View`, so this renderer cannot be hidden
 * and does not participate in the `contentView` child stack that the Chat
 * overlay uses. That is deliberate: Harness keeps running underneath the
 * overlay, so its sessions, background jobs, and in-flight tool calls survive a
 * trip into Chat. Switching back therefore needs no reload and no restart — the
 * overlay is hidden and Harness is already there.
 *
 * `dispose` intentionally leaves the window alone. The application owns the
 * window's lifetime; a mode transition must never close it.
 *
 * @param options - Window ownership and the reload callback it owns.
 * @returns A surface whose visibility is expressed by the overlay above it.
 */
export function createHarnessSurface(options: HarnessSurfaceOptions): DesktopSurface {
  return {
    setBounds(_bounds: DesktopContentBounds): void {
      // The main window's `webContents` always fills the content area, and the
      // controller records bounds only so the Chat overlay can mirror them.
    },
    setVisible(_visible: boolean): void {
      // Visibility is the overlay's job. Harness stays mounted and visible at
      // the bottom of the child stack, which is what preserves its state.
    },
    reload(): void {
      options.reload()
    },
    dispose(): Promise<void> {
      return Promise.resolve()
    },
  }
}
