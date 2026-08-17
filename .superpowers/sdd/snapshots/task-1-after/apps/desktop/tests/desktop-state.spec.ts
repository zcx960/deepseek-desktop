import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadDesktopMode, saveDesktopMode } from '../src/desktop-state.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function stateFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-state-'))
  roots.push(root)
  await mkdir(join(root, 'nested'))
  return join(root, 'nested', 'desktop-state.json')
}

describe('desktop mode persistence', () => {
  it('defaults a missing file to Harness', async () => {
    await expect(loadDesktopMode(await stateFile())).resolves.toBe('harness')
  })

  it('round-trips a validated versioned mode with owner-only permissions', async () => {
    const filename = await stateFile()
    await saveDesktopMode(filename, 'chat')
    expect(await readFile(filename, 'utf8')).toBe('{"version":1,"mode":"chat"}\n')
    await expect(loadDesktopMode(filename)).resolves.toBe('chat')
  })

  it('rejects malformed or unknown durable state', async () => {
    const filename = await stateFile()
    await writeFile(filename, '{"version":2,"mode":"chat"}\n')
    await expect(loadDesktopMode(filename)).rejects.toThrow('desktop state is invalid')
  })
})
