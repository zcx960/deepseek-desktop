import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { afterPack } from '../scripts/verify-packaged-runtime.ts'

function context(appOutDir: string, electronPlatformName = 'darwin') {
  return {
    appOutDir,
    electronPlatformName,
    packager: { appInfo: { productFilename: 'DeepSeek Harness' } },
  } as Parameters<typeof afterPack>[0]
}

describe('packaged desktop runtime verification', () => {
  it('accepts packaged Host entrypoints and shell assets', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'dsh-packaged-runtime-'))
    try {
      const resources = join(appOutDir, 'DeepSeek Harness.app', 'Contents', 'Resources', 'host', 'node_modules')
      const cli = join(resources, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      const web = join(resources, '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')
      const shell = join(appOutDir, 'DeepSeek Harness.app', 'Contents', 'Resources', 'desktop-resources')
      const preload = join(appOutDir, 'DeepSeek Harness.app', 'Contents', 'Resources', 'app.asar.unpacked', 'lib', 'shell-preload.cjs')
      const chromePreload = join(appOutDir, 'DeepSeek Harness.app', 'Contents', 'Resources', 'app.asar.unpacked', 'lib', 'mode-chrome-preload.cjs')
      const harnessThemePreload = join(appOutDir, 'DeepSeek Harness.app', 'Contents', 'Resources', 'app.asar.unpacked', 'lib', 'harness-theme-preload.cjs')
      const chatThemePreload = join(appOutDir, 'DeepSeek Harness.app', 'Contents', 'Resources', 'app.asar.unpacked', 'lib', 'chat-theme-preload.cjs')
      await mkdir(join(cli, '..'), { recursive: true })
      await mkdir(join(web, '..'), { recursive: true })
      await mkdir(shell, { recursive: true })
      await mkdir(join(preload, '..'), { recursive: true })
      await writeFile(cli, '')
      await writeFile(web, '')
      await writeFile(join(shell, 'shell.html'), '')
      await writeFile(join(shell, 'shell.css'), '')
      await writeFile(join(shell, 'mode-chrome.html'), '')
      await writeFile(join(shell, 'mode-chrome.css'), '')
      await writeFile(preload, '')
      await writeFile(chromePreload, '')
      await writeFile(harnessThemePreload, '')
      await writeFile(chatThemePreload, '')

      await expect(afterPack(context(appOutDir))).resolves.toBeUndefined()
    } finally {
      await rm(appOutDir, { recursive: true, force: true })
    }
  })

  it('rejects a packaged shell whose shell assets are missing', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'dsh-packaged-runtime-'))
    try {
      const resources = join(appOutDir, 'DeepSeek Harness.app', 'Contents', 'Resources', 'host', 'node_modules')
      const cli = join(resources, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      const web = join(resources, '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')
      await mkdir(join(cli, '..'), { recursive: true })
      await mkdir(join(web, '..'), { recursive: true })
      await writeFile(cli, '')
      await writeFile(web, '')

      await expect(afterPack(context(appOutDir))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(appOutDir, { recursive: true, force: true })
    }
  })

  it('accepts the same Host and chrome contract in a Windows resources directory', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'dsh-packaged-runtime-'))
    try {
      const resources = join(appOutDir, 'resources', 'host', 'node_modules')
      const cli = join(resources, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      const web = join(resources, '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')
      const shell = join(appOutDir, 'resources', 'desktop-resources')
      const preload = join(appOutDir, 'resources', 'app.asar.unpacked', 'lib', 'shell-preload.cjs')
      const chromePreload = join(appOutDir, 'resources', 'app.asar.unpacked', 'lib', 'mode-chrome-preload.cjs')
      const harnessThemePreload = join(appOutDir, 'resources', 'app.asar.unpacked', 'lib', 'harness-theme-preload.cjs')
      const chatThemePreload = join(appOutDir, 'resources', 'app.asar.unpacked', 'lib', 'chat-theme-preload.cjs')
      await mkdir(join(cli, '..'), { recursive: true })
      await mkdir(join(web, '..'), { recursive: true })
      await mkdir(shell, { recursive: true })
      await mkdir(join(preload, '..'), { recursive: true })
      await writeFile(cli, '')
      await writeFile(web, '')
      await writeFile(join(shell, 'shell.html'), '')
      await writeFile(join(shell, 'shell.css'), '')
      await writeFile(join(shell, 'mode-chrome.html'), '')
      await writeFile(join(shell, 'mode-chrome.css'), '')
      await writeFile(preload, '')
      await writeFile(chromePreload, '')
      await writeFile(harnessThemePreload, '')
      await writeFile(chatThemePreload, '')

      await expect(afterPack(context(appOutDir, 'win32'))).resolves.toBeUndefined()
    } finally {
      await rm(appOutDir, { recursive: true, force: true })
    }
  })

  it('rejects a shell whose Host dependency tree was filtered out', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'dsh-packaged-runtime-'))
    try {
      await expect(afterPack(context(appOutDir))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(appOutDir, { recursive: true, force: true })
    }
  })
})
