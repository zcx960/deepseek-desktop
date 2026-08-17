/** Durable last-selected desktop mode state. */

import { readFile } from 'node:fs/promises'
// @ts-ignore The workspace path resolves source across this package's rootDir; runtime uses the package artifact.
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { DesktopMode } from './desktop-mode.ts'

interface DesktopStateDocument {
  readonly version: 1
  readonly mode: DesktopMode
}

/** Read the last selected mode, defaulting to Harness when no state exists.
 * @param filename - JSON file containing the persisted desktop mode.
 * @returns the validated persisted mode, or `harness` when the file is absent.
 */
export async function loadDesktopMode(filename: string): Promise<DesktopMode> {
  let content: string
  try {
    content = await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return 'harness'
    throw error
  }

  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    throw new Error('desktop state is invalid')
  }
  if (!isDesktopStateDocument(value)) throw new Error('desktop state is invalid')
  return value.mode
}

/** Persist the selected mode using an owner-only atomic file replacement.
 * @param filename - JSON file receiving the persisted desktop mode.
 * @param mode - selected desktop mode.
 */
export async function saveDesktopMode(filename: string, mode: DesktopMode): Promise<void> {
  const content = `${JSON.stringify({ version: 1, mode })}\n`
  await writeFileAtomic(filename, content, { mode: 0o600, dirMode: 0o700 })
}

function isDesktopStateDocument(value: unknown): value is DesktopStateDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return candidate.version === 1 && (candidate.mode === 'chat' || candidate.mode === 'harness')
}
