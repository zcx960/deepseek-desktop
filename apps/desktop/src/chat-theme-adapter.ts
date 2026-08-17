/** Versioned adapter for the official DeepSeek Chat theme representation. */

import {
  isDesktopThemePreference,
  type DesktopColorScheme,
  type DesktopThemePreference,
} from './desktop-theme.ts'

/** Official Chat local-storage entry carrying its theme preference. */
export const CHAT_THEME_STORAGE_KEY = '__appKit_@deepseek/chat_themePreference'

const CHAT_THEME_STORAGE_VERSION = '0'

/** Body markers read by the isolated Chat preload. */
export interface ChatThemeBodyState {
  readonly classList: ReadonlySet<string>
  readonly darkAttribute: string | null
}

/**
 * Parse the current official Chat theme envelope.
 * @param raw - Exact local-storage value, or `null` when the site has not initialized it.
 * @returns The accepted preference, or `undefined` for any unknown representation.
 */
export function parseChatThemeStorage(raw: string | null): DesktopThemePreference | undefined {
  if (raw === null) return undefined
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const fields = Object.keys(value)
  if (fields.length !== 2 || !fields.includes('value') || !fields.includes('__version')) return undefined
  const envelope = value as { value?: unknown; __version?: unknown }
  if (envelope.__version !== CHAT_THEME_STORAGE_VERSION) return undefined
  return isDesktopThemePreference(envelope.value) ? envelope.value : undefined
}

/**
 * Serialize one preference in the official version-zero field order.
 * @param preference - Shared preference accepted by both desktop modes.
 * @returns Deterministic JSON for the official Chat storage entry.
 */
export function serializeChatThemeStorage(preference: DesktopThemePreference): string {
  return JSON.stringify({ value: preference, __version: CHAT_THEME_STORAGE_VERSION })
}

/**
 * Resolve official Chat body markers without guessing through computed styles.
 * @param state - Body classes and the dark-theme data attribute.
 * @returns A scheme only when the current official markers agree.
 */
export function schemeFromChatBody(state: ChatThemeBodyState): DesktopColorScheme | undefined {
  const light = state.classList.has('light')
  const dark = state.classList.has('dark')
  if (light === dark) return undefined
  if (dark) return state.darkAttribute === 'dark' ? 'dark' : undefined
  return state.darkAttribute === null ? 'light' : undefined
}
