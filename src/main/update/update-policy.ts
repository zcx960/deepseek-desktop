export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000
export const UPDATE_STARTUP_DELAY_MS = 15_000
export const UPDATE_STARTUP_JITTER_MS = 15_000
export const AUTO_INSTALL_ON_APP_QUIT = false

/**
 * Auto-update is off in this fork.
 *
 * The upstream client pulls from the vendor's own channel, and an update taken
 * from there replaces this build with theirs, dropping Chat mode and the local
 * branding — see `VENDOR_DESKTOP_SERVICE_ENABLED` in `desktop-service/index.ts`.
 *
 * Repointing at this project's releases is possible, but macOS self-update also
 * requires a Developer ID signature, because Squirrel.Mac verifies it before
 * swapping the bundle; an unsigned fork build therefore cannot install its own
 * update at all. Windows could, once the workflow publishes the NSIS manifests.
 *
 * Returning false parks every caller in the explicit `unsupported` state, which
 * is honest, instead of failing a reachable check on every launch.
 */
export function supportsAutoUpdates(_isPackaged: boolean, _platform: NodeJS.Platform): boolean {
  return false
}

export function shouldCheckAfterResume(lastCheckedAt: number, now = Date.now()): boolean {
  return now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS
}
