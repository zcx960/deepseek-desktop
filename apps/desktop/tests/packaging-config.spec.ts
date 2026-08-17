import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface DesktopPackage {
  readonly scripts: Readonly<Record<string, string>>
  readonly build: {
    readonly afterPack: string
    readonly asarUnpack: readonly string[]
    readonly electronDist: string
    readonly files: readonly string[]
    readonly extraResources: readonly {
      readonly from: string
      readonly to: string
    }[]
    readonly mac: {
      readonly hardenedRuntime: boolean
      readonly icon: string
      readonly notarize: boolean
    }
    readonly win: { readonly icon: string }
  }
}

interface RootPackage {
  readonly scripts: Readonly<Record<string, string>>
}

const REQUIRED_PACKAGED_SHELL_FILES = [
  'desktop-resources/shell.html',
  'desktop-resources/shell.css',
  'desktop-resources/mode-chrome.html',
  'desktop-resources/mode-chrome.css',
  'lib/shell-preload.cjs',
  'lib/mode-chrome-preload.cjs',
  'lib/harness-theme-preload.cjs',
  'lib/chat-theme-preload.cjs',
] as const

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(desktopRoot, '../..')
const workspaceConfiguration = readFileSync(resolve(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')
const builderPatch = readFileSync(resolve(repositoryRoot, 'patches/app-builder-lib@26.15.3.patch'), 'utf8')
const desktopPackage = JSON.parse(
  readFileSync(resolve(desktopRoot, 'package.json'), 'utf8'),
) as DesktopPackage
const rootPackage = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
) as RootPackage

/** Check whether electron-builder's file and resource rules include one packaged path. */
function includesPackagedFile(relativePath: string): boolean {
  if (relativePath.startsWith('desktop-resources/')) {
    return desktopPackage.build.extraResources.some(({ from, to }) =>
      from === 'resources' && to === 'desktop-resources'
      && relativePath.startsWith(`${to}/`),
    )
  }
  return desktopPackage.build.files.some(pattern =>
    pattern === relativePath || (pattern === 'lib/**' && relativePath.startsWith('lib/')),
  )
}

describe('desktop packaging configuration', () => {
  it('packages the installed Electron distribution', () => {
    expect(desktopPackage.build.electronDist).toBe('node_modules/electron/dist')
    expect(workspaceConfiguration).toContain("'app-builder-lib@26.15.3>@electron/get': '3.1.0'")
  })

  it('maps the staged Host node_modules directory as the copy root', () => {
    expect(desktopPackage.build.extraResources).toEqual(expect.arrayContaining([
      { from: 'resources', to: 'desktop-resources' },
      { from: 'runtime-host/package.json', to: 'host/package.json' },
      { from: 'runtime-host/node_modules', to: 'host/node_modules' },
    ]))
    for (const packagedFile of REQUIRED_PACKAGED_SHELL_FILES) {
      expect(includesPackagedFile(packagedFile)).toBe(true)
    }
    expect(existsSync(resolve(desktopRoot, 'resources/shell.html'))).toBe(true)
    expect(existsSync(resolve(desktopRoot, 'resources/shell.css'))).toBe(true)
    expect(desktopPackage.build.files).toContain('lib/**')
    expect(desktopPackage.build.asarUnpack).toContain('lib/shell-preload.cjs')
    expect(desktopPackage.build.asarUnpack).toContain('lib/mode-chrome-preload.cjs')
    expect(desktopPackage.build.asarUnpack).toContain('lib/harness-theme-preload.cjs')
    expect(desktopPackage.build.asarUnpack).toContain('lib/chat-theme-preload.cjs')
    expect(desktopPackage.build.afterPack).toBe('./scripts/verify-packaged-runtime.ts')
  })

  it('unlocks the temporary signing Keychain with its own password', () => {
    expect(workspaceConfiguration).toContain(
      'app-builder-lib@26.15.3: patches/app-builder-lib@26.15.3.patch',
    )
    expect(builderPatch).toContain('cscPasswords, keychainPassword')
    expect(builderPatch).toContain('"-k", keychainPassword, keychainFile')
  })

  it('keeps the supplied image byte-for-byte and shares it across macOS and Windows', () => {
    const icon = readFileSync(resolve(desktopRoot, 'build/icon.png'))

    expect(createHash('sha256').update(icon).digest('hex'))
      .toBe('e9fa2ac692491c051536fb5d322e7eefe874d3977892e82852295d137bf27d91')
    expect(desktopPackage.build.mac.icon).toBe('build/icon.png')
    expect(desktopPackage.build.win.icon).toBe('build/icon.png')
  })

  it('builds and stages the complete workspace before local packaging', () => {
    for (const name of ['package', 'dist']) {
      expect(desktopPackage.scripts[name]).toContain('pnpm --workspace-root run build')
      expect(desktopPackage.scripts[name]).toContain('scripts/stage-runtime.ts')
    }
    expect(desktopPackage.scripts.package).toContain('electron-builder --dir')
    expect(desktopPackage.scripts.package).not.toContain('release-preflight.ts')
  })

  it('makes the macOS DMG path signed, hardened, and notarized', () => {
    const command = desktopPackage.scripts['dist:mac']

    expect(command).toBe('node --import tsx scripts/release-mac.ts')
    expect(desktopPackage.build.mac.hardenedRuntime).toBe(true)
    expect(desktopPackage.build.mac.notarize).toBe(true)
  })

  it('exposes generic and macOS release commands at the repository root', () => {
    expect(rootPackage.scripts['dist:desktop'])
      .toBe('pnpm --filter @deepseek-ai/dsh-desktop run dist')
    expect(rootPackage.scripts['dist:mac:desktop'])
      .toBe('pnpm --filter @deepseek-ai/dsh-desktop run dist:mac')
  })
})
