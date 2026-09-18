import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
// eslint-disable-next-line test/no-import-node-test -- The artifact collector uses a standalone node --test check.
import test from 'node:test'
import { collectArtifacts } from './collect-chat-artifacts.mjs'

const commit = '0123456789abcdef0123456789abcdef01234567'

function fixture(t, target, bundles) {
  const repo = mkdtempSync(path.join(tmpdir(), 'chat-artifacts-'))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  mkdirSync(path.join(repo, 'src-tauri'), { recursive: true })
  writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ version: '0.15.4-chat.1' }))
  writeFileSync(path.join(repo, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '0.15.4-chat.1' }))
  writeFileSync(path.join(repo, 'src-tauri/Cargo.toml'), '[package]\nversion = "0.15.4-chat.1"\n')
  for (const bundle of bundles)
    mkdirSync(path.join(repo, 'src-tauri/target', target, 'release/bundle', bundle), { recursive: true })
  return { repo, target, bundles, commit }
}

function installer(request, bundle, filename) {
  const file = path.join(request.repo, 'src-tauri/target', request.target, 'release/bundle', bundle, filename)
  writeFileSync(file, 'installer bytes')
}

test('refuses a partial Windows installer set before creating upload files', (t) => {
  const request = fixture(t, 'x86_64-pc-windows-msvc', ['nsis', 'msi'])
  installer(request, 'nsis', 'Chat.exe')
  assert.throws(() => collectArtifacts(request), /ARTIFACTS_MISSING: msi/)
  assert.equal(existsSync(path.join(request.repo, '.temp/chat-artifacts')), false)
})

test('uploads installers with their source commit and verifiable checksums', (t) => {
  const request = fixture(t, 'aarch64-apple-darwin', ['dmg'])
  installer(request, 'dmg', 'DeepSeek Chat.dmg')
  const result = collectArtifacts(request)
  const output = path.join(request.repo, '.temp/chat-artifacts')
  const metadata = JSON.parse(readFileSync(path.join(output, `build-info-${request.target}.json`), 'utf8'))
  assert.equal(metadata.commit, commit)
  assert.equal(metadata.version, '0.15.4-chat.1')
  assert.equal(metadata.signed, false)
  assert.equal(result.artifacts.length, 1)
  const [digest, filename] = readFileSync(path.join(output, `SHA256SUMS-${request.target}.txt`), 'utf8').trim().split('  ')
  const bytes = readFileSync(path.join(output, filename))
  assert.equal(bytes.toString(), 'installer bytes')
  assert.equal(createHash('sha256').update(bytes).digest('hex'), digest)
  assert.equal(metadata.artifacts[0].sha256, digest)
})

test('rejects unknown targets, omitted formats, and missing source revisions', (t) => {
  const request = fixture(t, 'x86_64-unknown-linux-gnu', ['appimage', 'deb'])
  assert.throws(() => collectArtifacts({ ...request, target: '../outside' }), /ARTIFACTS_INVALID/)
  assert.throws(() => collectArtifacts({ ...request, bundles: ['appimage'] }), /installer set/)
  assert.throws(() => collectArtifacts({ ...request, commit: undefined }), /source commit/)
})
