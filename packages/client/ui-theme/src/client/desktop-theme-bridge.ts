/** Desktop-only adapter between Electron's closed bridge and ThemeRuntime. */

import type { Context } from '@deepseek-ai/cordis'
import { isThemePreference, type ThemePreference } from '../theme-settings.ts'
import type { ThemeRuntime, ThemeSnapshot } from './index.ts'

/** State published to the desktop carrier after each theme change. */
export interface DesktopThemeBridgeState {
  readonly preference: ThemePreference
  readonly scheme: 'light' | 'dark'
}

/** Electron operations exposed only to an embedded loopback renderer. */
export interface DesktopThemeBridge {
  /** Publish the current Harness preference and resolved scheme. */
  publish(value: DesktopThemeBridgeState): void
  /** Observe preference writes from the desktop carrier. */
  subscribe(listener: (value: unknown) => void): () => void
}

declare global {
  interface Window {
    /** Present only in the trusted desktop Harness renderer. */
    dshDesktopTheme?: DesktopThemeBridge
  }
}

/**
 * Bind one embedded Harness ThemeRuntime to the desktop carrier. Browserless
 * client compositions and ordinary Web renderers remain disconnected.
 * @param ctx - Client context that owns both event and bridge subscriptions.
 * @param theme - Harness theme service used for all preference reads and writes.
 */
export function bindDesktopThemeBridge(ctx: Context, theme: ThemeRuntime): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  if (document.documentElement.dataset.dshDesktopEmbedded !== 'true') return
  const bridge = window.dshDesktopTheme
  if (bridge === undefined) return
  const publish = (snapshot: ThemeSnapshot): void => {
    bridge.publish({
      preference: snapshot.preference,
      scheme: snapshot.active.colorScheme,
    })
  }
  publish(theme.getTheme())
  ctx.on('theme/change', publish)
  ctx.effect(() => bridge.subscribe((value) => {
    if (isThemePreference(value)) theme.setTheme(value)
  }), 'ui-theme: desktop preference bridge')
}
