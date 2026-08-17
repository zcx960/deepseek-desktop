// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { applyDesktopPresentationMarker } from '../src/desktop-marker.ts'

describe('desktop presentation marker', () => {
  it.each(['darwin', 'win32', 'linux'])('marks the %s renderer before boot', (platform) => {
    const root = document.createElement('html')
    applyDesktopPresentationMarker(
      `http://127.0.0.1:4173/?dsh-desktop-platform=${platform}`,
      root,
    )
    expect(root.dataset.dshDesktop).toBe('true')
    expect(root.dataset.dshDesktopPlatform).toBe(platform)
  })

  it.each(['', 'Darwin', 'freebsd'])('ignores the unsupported platform %j', (platform) => {
    const root = document.createElement('html')
    applyDesktopPresentationMarker(
      `http://127.0.0.1:4173/?dsh-desktop-platform=${platform}`,
      root,
    )
    expect(root.dataset.dshDesktop).toBeUndefined()
    expect(root.dataset.dshDesktopPlatform).toBeUndefined()
  })

  it('leaves ordinary Web URLs unmarked', () => {
    const root = document.createElement('html')
    applyDesktopPresentationMarker('http://127.0.0.1:4173/?fixture', root)
    expect(root.dataset.dshDesktop).toBeUndefined()
    expect(root.dataset.dshDesktopPlatform).toBeUndefined()
  })

  it('marks a valid desktop child view as embedded only for the exact flag', () => {
    const root = document.createElement('html')
    applyDesktopPresentationMarker(
      'http://127.0.0.1:4173/?dsh-desktop-platform=darwin&dsh-desktop-embedded=1',
      root,
    )
    expect(root.dataset.dshDesktop).toBe('true')
    expect(root.dataset.dshDesktopPlatform).toBe('darwin')
    expect(root.dataset.dshDesktopEmbedded).toBe('true')

    const ordinary = document.createElement('html')
    applyDesktopPresentationMarker(
      'http://127.0.0.1:4173/?dsh-desktop-platform=darwin&dsh-desktop-embedded=true',
      ordinary,
    )
    expect(ordinary.dataset.dshDesktopEmbedded).toBeUndefined()
  })
})
