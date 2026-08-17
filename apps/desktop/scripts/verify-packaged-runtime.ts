/** Reject a packaged desktop shell that omitted the staged Host entrypoints. */

import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { AfterPackContext } from 'electron-builder'

const REQUIRED_HOST_FILES = [
  ['@deepseek-ai', 'dsh', 'lib', 'bin.js'],
  ['@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html'],
] as const

const REQUIRED_SHELL_FILES = [
  ['desktop-resources', 'shell.html'],
  ['desktop-resources', 'shell.css'],
  ['desktop-resources', 'mode-chrome.html'],
  ['desktop-resources', 'mode-chrome.css'],
  ['app.asar.unpacked', 'lib', 'shell-preload.cjs'],
  ['app.asar.unpacked', 'lib', 'mode-chrome-preload.cjs'],
  ['app.asar.unpacked', 'lib', 'harness-theme-preload.cjs'],
  ['app.asar.unpacked', 'lib', 'chat-theme-preload.cjs'],
] as const

/**
 * Verify the Host files required before the signed application can start.
 * @param context - Electron Builder's completed application directory.
 * @returns A promise that rejects when a staged Host entrypoint is absent.
 */
export async function afterPack(context: AfterPackContext): Promise<void> {
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  for (const segments of REQUIRED_HOST_FILES) {
    await access(join(resources, 'host', 'node_modules', ...segments))
  }
  for (const segments of REQUIRED_SHELL_FILES) {
    await access(join(resources, ...segments))
  }
}

export default afterPack
