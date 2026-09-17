import { app, dialog, net } from 'electron'
import { join } from 'node:path'
import { DesktopService } from './service'
import { attachDiagnostics } from './diagnostics'

let service: DesktopService | undefined
export let desktopDiagnostics: ReturnType<typeof attachDiagnostics> | undefined

/**
 * Whether to talk to the vendor's desktop service at `https://dshdesktop.com`.
 *
 * This fork does not, and it is not a temporary state:
 *
 * - The update channel behind it belongs to the vendor. An accepted update would
 *   download and install *their* build over this one, dropping Chat mode and the
 *   local branding — the user would have clicked "update" and lost the fork.
 * - It identifies the installation with a persistent UUID and posts it on every
 *   update check, with no consent step. A fork should not do that on the user's
 *   behalf, and this repository has no server that could serve the protocol.
 *
 * Leaving `desktopDiagnostics` undefined turns every `desktopDiagnostics?.…`
 * call site in the composition root into a no-op. `DesktopService` is kept
 * intact for a future signed build that points it at this project's own
 * endpoint instead.
 */
const VENDOR_DESKTOP_SERVICE_ENABLED = false

/** Call only after the single-instance lock, before bootstrap writes this session's log. */
export function initializeDesktopService(): void {
  if (!VENDOR_DESKTOP_SERVICE_ENABLED || !app.isPackaged || service) return
  try {
    service = new DesktopService({
      stateDir: join(app.getPath('userData'), 'desktop-service'),
      logPath: join(app.getPath('logs'), 'harness.log'),
      version: app.getVersion(), platform: process.platform, arch: process.arch,
      // Chromium networking uses the same proxy configuration as the desktop app.
      request: (url, init) => net.fetch(url, init),
      confirmUpload: async body => {
        const report = JSON.parse(body) as { version: string; kind: string; lines: string[] }
        const { response } = await dialog.showMessageBox({
          type: 'question',
          title: '发送故障报告',
          message: '是否发送本次故障报告，帮助排查问题？',
          detail: `版本：${report.version}\n故障类型：${report.kind}\n\n报告将发送到 https://dshdesktop.com/crash，包含安装 ID、版本、平台、故障时间、错误信息和 harness.log 最后最多 100 行（本次 ${report.lines.length} 行）。\n\n点击“发送一次”仅同意发送本次报告；选择“不发送”将丢弃本次待传报告，不影响继续使用。`,
          buttons: ['不发送', '发送一次'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
        return response === 1
      }
    })
    desktopDiagnostics = attachDiagnostics(app, service, {
      onError: error => console.warn('[desktop-service]', error instanceof Error ? error.name : 'Diagnostic failure')
    })
  } catch (error) {
    service = undefined
    console.warn('[desktop-service] initialization failed', error instanceof Error ? error.name : 'Unknown error')
  }
}
export async function checkDesktopUpdate() {
  if (!service) throw new Error('Desktop update service is unavailable')
  return service.checkUpdate()
}
