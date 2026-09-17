import { afterEach, expect, it, vi } from 'vitest'

/**
 * Pin the fork's decision to keep the vendor's desktop service unconstructed.
 *
 * That service posts a persistent installation UUID to `dshdesktop.com` and
 * hands the updater the vendor's own archive feed, so an accepted update would
 * replace this build with theirs. `app.isPackaged: true` is the exact condition
 * that used to switch it on, so that is what this test mocks — and the mock is
 * deliberately complete enough (a writable userData directory, an EventEmitter
 * `app`) that a service which *is* constructed really is constructed. Otherwise
 * the constructor would throw into `initializeDesktopService`'s catch block and
 * this test would pass for the wrong reason.
 */
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'vendor-service-'))
  return {
    app: Object.assign(new EventEmitter(), {
      isPackaged: true,
      getPath: (name: string) => (name === 'logs' ? join(root, 'logs') : join(root, 'userData')),
      getVersion: () => '0.8.0',
      isReady: () => true
    }),
    dialog: { showMessageBox: vi.fn() },
    net: { fetch: vi.fn() }
  }
})

afterEach(() => {
  vi.resetModules()
})

it('leaves the vendor service unconstructed even in a packaged build', async () => {
  const service = await import('../src/main/desktop-service')

  service.initializeDesktopService()

  // Every crash-report and update-policy path in the composition root is an
  // optional call on this value, so `undefined` is what makes them all no-ops.
  expect(service.desktopDiagnostics).toBeUndefined()
  await expect(service.checkDesktopUpdate()).rejects.toThrow()
})
