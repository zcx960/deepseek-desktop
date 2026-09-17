/** Desktop color-scheme resolution shared by Electron main and local chrome. */

/** Resolved palette used by the local desktop chrome. */
export type DesktopColorScheme = 'light' | 'dark'

/** Theme preferences synchronized between the two desktop modes. */
export const DESKTOP_THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** User-selected desktop theme preference before resolving the operating system. */
export type DesktopThemePreference = typeof DESKTOP_THEME_PREFERENCES[number]

/** Operating-system theme adapter owned by the Electron entrypoint. */
export interface DesktopSystemTheme {
  /** Return the currently resolved operating-system color scheme. */
  getColorScheme(): DesktopColorScheme
  /**
   * Observe operating-system color-scheme changes.
   * @param listener - Callback invoked after Electron resolves a new scheme.
   * @returns Disposer for the registered callback.
   */
  subscribe(listener: () => void): () => void
}

/**
 * Test whether an IPC value is a supported desktop color scheme.
 * @param value - Value received by the local chrome renderer.
 * @returns Whether the value belongs to the closed scheme union.
 */
export function isDesktopColorScheme(value: unknown): value is DesktopColorScheme {
  return value === 'light' || value === 'dark'
}

/**
 * Test whether a renderer value is a supported shared theme preference.
 * @param value - Value received through a desktop theme bridge.
 * @returns Whether the value belongs to the closed preference union.
 */
export function isDesktopThemePreference(value: unknown): value is DesktopThemePreference {
  return DESKTOP_THEME_PREFERENCES.some(preference => preference === value)
}

/**
 * Test whether a renderer value is one normalized opaque background color.
 * @param value - Value received from an isolated renderer or local chrome IPC.
 * @returns Whether the value is a canonical six-digit hexadecimal color.
 */
export function isDesktopThemeBackgroundColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[\da-f]{6}$/.test(value)
}

/**
 * Normalize one opaque computed CSS RGB color for trusted local title-bar paint.
 * @param value - Computed `rgb()` or `rgba()` value read from a themed page.
 * @returns A canonical hexadecimal color, or `undefined` for transparent or unsupported values.
 */
export function normalizeDesktopThemeBackgroundColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(value)
  if (match === null) return undefined
  const channels = match.slice(1, 4).map(channel => Number(channel))
  if (channels.some(channel => !Number.isInteger(channel) || channel < 0 || channel > 255)) return undefined
  const alpha = match[4]
  if (value.toLowerCase().startsWith('rgba') && alpha === undefined) return undefined
  if (alpha !== undefined && Number(alpha) !== 1) return undefined
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}

function linearChannel(hex: string): number {
  const value = Number.parseInt(hex, 16) / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/**
 * Resolve whether black or white controls have greater contrast over an Electron theme color.
 * @param color - Electron `did-change-theme-color` value in `#rrggbb` form, or `null`.
 * @returns The matching palette, or `undefined` when the page published no valid color.
 */
export function schemeForThemeColor(color: string | null): DesktopColorScheme | undefined {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color ?? '')
  if (match === null) return undefined
  const red = match[1]
  const green = match[2]
  const blue = match[3]
  if (red === undefined || green === undefined || blue === undefined) return undefined
  const luminance = 0.2126 * linearChannel(red)
    + 0.7152 * linearChannel(green)
    + 0.0722 * linearChannel(blue)
  return luminance >= 0.179 ? 'light' : 'dark'
}
