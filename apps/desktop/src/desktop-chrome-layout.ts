/** Pure platform geometry for local title-bar chrome and content insets. */

import type { DesktopContentBounds, DesktopMode } from './desktop-mode.ts'
import type { DesktopChromeSurface } from './shell-protocol.ts'

const CHROME_TOP = 6
const CHROME_INLINE_INSET = 12
const CHROME_INLINE_INSET_MACOS = 88
const CHROME_INLINE_INSET_WINDOWS = 88
const CHROME_CONTROL_HEIGHT = 32
const CHROME_SWITCH_WIDTH = 164
const CHROME_CHAT_ACTION_GAP = 4
const CHROME_CHAT_ACTION_WIDTH = 32
const CHROME_CHAT_MENU_WIDTH = 184
const CHROME_CHAT_MENU_HEIGHT = 132

/** Inputs that determine one native mode-chrome rectangle. */
export interface DesktopChromeBoundsInput {
  readonly platform: NodeJS.Platform
  readonly mode: DesktopMode
  readonly surface: DesktopChromeSurface
  readonly content: DesktopContentBounds
}

function inlineInset(platform: NodeJS.Platform): number {
  if (platform === 'darwin') return CHROME_INLINE_INSET_MACOS
  // Windows keeps the collapsed sidebar rail at the leading edge; leave its
  // whale toggle outside the native mode-chrome BrowserView hit rectangle.
  if (platform === 'win32') return CHROME_INLINE_INSET_WINDOWS
  return CHROME_INLINE_INSET
}

function controlsWidth(mode: DesktopMode): number {
  return mode === 'chat'
    ? CHROME_SWITCH_WIDTH + CHROME_CHAT_ACTION_GAP + CHROME_CHAT_ACTION_WIDTH
    : CHROME_SWITCH_WIDTH
}

/**
 * Return the first draggable x-coordinate after the largest title-bar controls.
 * @param platform - Host platform whose native controls determine the left inset.
 * @returns A CSS-pixel x-coordinate that cannot overlap closed mode chrome.
 */
export function desktopTitlebarDragStart(platform: NodeJS.Platform): number {
  return platform === 'darwin' || platform === 'win32' ? 300 : 224
}

/**
 * Resolve the native rectangle required by the current chrome surface.
 * @param input - Platform, selected mode, surface, and window bounds.
 * @returns A rectangle contained by the BrowserWindow content bounds.
 */
export function desktopChromeBounds(input: DesktopChromeBoundsInput): DesktopContentBounds {
  if (input.surface === 'dialog') return { ...input.content }
  const x = input.content.x + inlineInset(input.platform)
  const y = input.content.y + CHROME_TOP
  const requestedWidth = input.surface === 'chat-menu'
    ? Math.max(CHROME_CHAT_MENU_WIDTH, controlsWidth(input.mode))
    : controlsWidth(input.mode)
  const requestedHeight = input.surface === 'chat-menu'
    ? CHROME_CHAT_MENU_HEIGHT
    : CHROME_CONTROL_HEIGHT
  const availableWidth = Math.max(0, input.content.x + input.content.width - x)
  const availableHeight = Math.max(0, input.content.y + input.content.height - y)
  return {
    x,
    y,
    width: Math.min(requestedWidth, availableWidth),
    height: Math.min(requestedHeight, availableHeight),
  }
}

/**
 * Reserve a top region without allowing negative content height.
 * @param bounds - Full BrowserWindow content bounds.
 * @param top - Requested top inset in pixels.
 * @returns Remaining bounds below the applied inset.
 */
export function insetDesktopContentBounds(
  bounds: DesktopContentBounds,
  top: number,
): DesktopContentBounds {
  const inset = Math.min(bounds.height, Math.max(0, top))
  return {
    x: bounds.x,
    y: bounds.y + inset,
    width: bounds.width,
    height: bounds.height - inset,
  }
}
