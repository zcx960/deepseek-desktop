import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { readReleaseIdentity } from './release-identity.mjs'

const targetBundles = {
  'aarch64-apple-darwin': ['dmg'],
  'x86_64-apple-darwin': ['dmg'],
  'x86_64-pc-windows-msvc': ['nsis', 'msi'],
  'x86_64-unknown-linux-gnu': ['appimage', 'deb'],
}
const extensions = { dmg: '.dmg', nsis: '.exe', msi: '.msi', appimage: '.AppImage', deb: '.deb' }

export function collectArtifacts({ repo, target, bundles, commit }) {
  const expected = targetBundles[target]
  if (!expected || [...bundles].sort().join(',') !== [...expected].sort().join(','))
    throw new Error('ARTIFACTS_INVALID: unexpected target or installer set')
  if (!/^[a-f0-9]{40}$/i.test(commit ?? ''))
    throw new Error('ARTIFACTS_INVALID: a full source commit is required')

  const { version } = readReleaseIdentity(repo)
  const bundleRoot = path.join(repo, 'src-tauri', 'target', target, 'release', 'bundle')
  const files = bundles.flatMap((bundle) => {
    const directory = path.join(bundleRoot, bundle)
    const files = readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith(extensions[bundle]))
      .map(entry => ({ source: path.join(directory, entry.name), name: `${target}-${entry.name.replaceAll(' ', '-')}` }))
    if (files.length === 0)
      throw new Error(`ARTIFACTS_MISSING: ${bundle} installer was not produced`)
    return files
  })
  const output = path.join(repo, '.temp', 'chat-artifacts')
  mkdirSync(output, { recursive: true })
  const artifacts = files.map(({ source, name }) => {
    const destination = path.join(output, name)
    copyFileSync(source, destination)
    const bytes = readFileSync(destination)
    return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  })
  writeFileSync(path.join(output, `SHA256SUMS-${target}.txt`), `${artifacts.map(file => `${file.sha256}  ${file.name}`).join('\n')}\n`)
  const info = { version, target, commit: commit.toLowerCase(), signed: false, artifacts }
  writeFileSync(path.join(output, `build-info-${target}.json`), `${JSON.stringify(info, null, 2)}\n`)
  return info
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const info = collectArtifacts({
    repo: process.cwd(),
    target: process.argv[2],
    bundles: (process.argv[3] ?? '').split(','),
    commit: process.env.GITHUB_SHA,
  })
  process.stdout.write(`${JSON.stringify(info, null, 2)}\n`)
}
