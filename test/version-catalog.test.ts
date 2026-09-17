import { describe, expect, it } from 'vitest'
import {
  archiveFeedUrl,
  compareVersions,
  fetchAvailableReleases,
  parseReleaseList,
  STABLE_FEED_URL,
  VERSION_INDEX_URL
} from '../src/main/update/version-catalog'

describe('version-catalog constants', () => {
  /**
   * These must not point at the vendor's channel: an update taken from
   * `dshdesktop.com` installs the vendor's build over this fork, dropping Chat
   * mode and the local branding.
   */
  it('points the stable feed and index at this project rather than the vendor', () => {
    expect(STABLE_FEED_URL).toBe(
      'https://github.com/zcx960/deepseek-desktop/releases/latest/download/'
    )
    expect(VERSION_INDEX_URL).toBe(
      'https://api.github.com/repos/zcx960/deepseek-desktop/releases'
    )
    expect(STABLE_FEED_URL).not.toContain('dshdesktop.com')
    expect(VERSION_INDEX_URL).not.toContain('dshdesktop.com')
  })

  it('builds a per-version archive feed url with a trailing slash', () => {
    expect(archiveFeedUrl('1.2.3')).toBe(
      'https://github.com/zcx960/deepseek-desktop/releases/download/v1.2.3/'
    )
  })
})

describe('compareVersions', () => {
  it('orders by numeric segments', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('treats a prerelease as lower than its release', () => {
    expect(compareVersions('1.2.3-rc.1', '1.2.3')).toBe(-1)
    expect(compareVersions('1.2.3', '1.2.3-rc.1')).toBe(1)
    expect(compareVersions('1.2.3-rc.1', '1.2.3-rc.2')).toBe(-1)
  })

  it('compares prerelease counters numerically, not lexicographically', () => {
    // "rc.10" < "rc.9" under string comparison; semver says the reverse.
    expect(compareVersions('1.2.3-rc.10', '1.2.3-rc.9')).toBe(1)
    expect(compareVersions('1.2.3-rc.9', '1.2.3-rc.10')).toBe(-1)
    expect(compareVersions('1.2.3-alpha.10', '1.2.3-alpha.9')).toBe(1)
    expect(compareVersions('1.2.3-rc.10', '1.2.3-rc.1')).toBe(1)
  })

  it('follows semver identifier precedence', () => {
    // fewer identifiers < more ("alpha" < "alpha.1")
    expect(compareVersions('1.2.3-alpha', '1.2.3-alpha.1')).toBe(-1)
    // numeric identifiers < alphanumeric ones ("1" < "alpha")
    expect(compareVersions('1.2.3-1', '1.2.3-alpha')).toBe(-1)
    expect(compareVersions('1.2.3-alpha', '1.2.3-beta')).toBe(-1)
    expect(compareVersions('1.2.3-rc.10', '1.2.3-rc.10')).toBe(0)
  })
})

describe('parseReleaseList', () => {
  it('reads GitHub tags into the picker shape and drops entries without one', () => {
    const raw = [
      {
        tag_name: 'v1.2.3',
        html_url: 'https://github.com/zcx960/deepseek-desktop/releases/tag/v1.2.3'
      },
      { tag_name: '', html_url: 'https://example.test/empty-tag' },
      { tag_name: 'v1.2.4' },
      { nope: true },
      42
    ]
    expect(parseReleaseList(raw)).toEqual([
      {
        version: '1.2.3',
        tag: 'v1.2.3',
        archiveUrl: 'https://github.com/zcx960/deepseek-desktop/releases/tag/v1.2.3'
      }
    ])
  })

  it('returns an empty array when the payload is not a release list', () => {
    expect(parseReleaseList(null)).toEqual([])
    expect(parseReleaseList({ versions: [] })).toEqual([])
    expect(parseReleaseList('nope')).toEqual([])
  })
})

describe('fetchAvailableReleases', () => {
  // GitHub's release list, which is an array keyed by tag_name.
  const index = [
    { tag_name: 'v1.0.0', html_url: 'a' },
    { tag_name: 'v1.2.0', html_url: 'b' },
    { tag_name: 'v1.1.0', html_url: 'c' }
  ]
  const ok = () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(index) } as Response)

  it('drops the current version and sorts descending', async () => {
    const releases = await fetchAvailableReleases('1.1.0', ok as unknown as typeof fetch)
    expect(releases.map((r) => r.version)).toEqual(['1.2.0', '1.0.0'])
  })

  it('throws when the request fails', async () => {
    const bad = () => Promise.resolve({ ok: false, status: 503 } as Response)
    await expect(
      fetchAvailableReleases('1.1.0', bad as unknown as typeof fetch)
    ).rejects.toThrow()
  })

  it('throws when the network rejects', async () => {
    const boom = () => Promise.reject(new Error('offline'))
    await expect(
      fetchAvailableReleases('1.1.0', boom as unknown as typeof fetch)
    ).rejects.toThrow('offline')
  })
})
