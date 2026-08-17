/** Theme base rules needed for a native desktop material to reach the shell. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/styles/base.css', import.meta.url)), 'utf8')

describe('desktop theme surfaces', () => {
  it('defines the fallback and native-overlay title-bar insets', () => {
    expect(css).toContain("html[data-dsh-desktop='true']")
    expect(css).toContain('--dsh-desktop-titlebar-inset: 40px;')
    expect(css).toContain("html[data-dsh-desktop-platform='darwin']")
    expect(css).toContain("html[data-dsh-desktop-platform='win32']")
    expect(css).toContain("html[data-dsh-desktop-platform='linux']")
    expect(css).toContain('--dsh-desktop-titlebar-inset: 44px;')
  })

  it.each(['darwin', 'win32'])('makes the %s document stack transparent', (platform) => {
    const marker = `html[data-dsh-desktop-platform='${platform}']`
    expect(css).toContain(`${marker} body`)
    expect(css).toContain(`${marker} #root`)
  })

  it('does not make Linux document pixels transparent', () => {
    const marker = "html[data-dsh-desktop-platform='linux']"
    expect(css).not.toContain(`${marker} body`)
    expect(css).not.toContain(`${marker} #root`)
    expect(css).not.toMatch(
      /html\[data-dsh-desktop-platform='linux'\]\s*\{\s*background:/s,
    )
  })

  it('suspends every renderer drag region while a modal is mounted', () => {
    expect(css).toMatch(
      /html\[data-dsh-desktop='true'\]:has\(\[aria-modal='true'\]\) body \*\s*\{[^}]*-webkit-app-region:\s*no-drag;/s,
    )
  })
})
