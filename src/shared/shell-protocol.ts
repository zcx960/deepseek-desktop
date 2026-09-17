/** Closed IPC protocol between the trusted desktop shell and Electron main process. */

/** Fixed height of the native titlebar overlay in CSS pixels. */
export const DESKTOP_TITLEBAR_HEIGHT = 44

/** Channel names accepted by the desktop shell's narrow IPC protocol. */
export const DESKTOP_SHELL_CHANNELS = {
  select: 'dsh-desktop:select-mode',
  command: 'dsh-desktop:shell-command',
  snapshot: 'dsh-desktop:mode-snapshot',
  chromeSurface: 'dsh-desktop:chrome-surface',
  chromeLayout: 'dsh-desktop:chrome-layout',
  chromeTheme: 'dsh-desktop:chrome-theme',
  titlebarBackground: 'dsh-desktop:titlebar-background',
} as const

/** Native bounds state requested by the local chrome renderer. */
export type DesktopChromeSurface = 'closed' | 'chat-menu' | 'dialog'

/** Layout data sent to the local chrome renderer by Electron main. */
export interface DesktopChromeLayout {
  readonly surface: DesktopChromeSurface
  readonly dismissMenus: boolean
}

/** Commands the trusted shell can send to the Electron main process. */
export type DesktopShellCommand =
  | 'retry-chat'
  | 'retry-harness'
  | 'reload-chat'
  | 'clear-chat-data'
  | 'open-chat-browser'
  | 'open-pending-external'

const COMMANDS = new Set<DesktopShellCommand>([
  'retry-chat',
  'retry-harness',
  'reload-chat',
  'clear-chat-data',
  'open-chat-browser',
  'open-pending-external',
])

/**
 * Test whether a renderer value is a command accepted by the shell protocol.
 * @param value - Untrusted renderer value to classify.
 * @returns Whether the value belongs to the closed command union.
 */
export function isDesktopShellCommand(value: unknown): value is DesktopShellCommand {
  return typeof value === 'string' && COMMANDS.has(value as DesktopShellCommand)
}

/**
 * Test whether a renderer value is a supported chrome surface state.
 * @param value - untrusted renderer value to classify.
 * @returns Whether the value belongs to the closed chrome surface union.
 */
export function isDesktopChromeSurface(value: unknown): value is DesktopChromeSurface {
  return value === 'closed' || value === 'chat-menu' || value === 'dialog'
}
