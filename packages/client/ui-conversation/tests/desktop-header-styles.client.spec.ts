/** Frameless desktop header hit regions remain isolated from Web presentation. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)),
  'utf8',
)

describe('conversation desktop header', () => {
  it('keeps the resident blank-page titlebar seat below the Session header', () => {
    expect(css).toMatch(/\.desktopTitlebarDragRegion\s*\{[^}]*display: none;/s)
    expect(css).toMatch(
      /:global\(html\[data-dsh-desktop='true'\]\) \.desktopTitlebarDragRegion\s*\{[^}]*z-index: 1;[^}]*-webkit-app-region: drag;/s,
    )
    expect(css).toMatch(/\.header\s*\{[^}]*z-index: 2;/s)
  })

  it('uses the full header as a desktop drag region', () => {
    expect(css).toMatch(
      /:global\(html\[data-dsh-desktop='true'\]\) \.header\s*\{[^}]*-webkit-app-region: drag;/s,
    )
    expect(css).not.toMatch(/(?:^|\n)\.header\s*\{[^}]*-webkit-app-region/s)
  })

  it('composes the Windows caption controls into the title row', () => {
    expect(css).toMatch(
      /:global\(html\[data-dsh-desktop-platform='win32'\]\) \.root\s*\{[^}]*--dsh-windows-caption-controls-width: 138px;/s,
    )
    const windowsDragSeat = css.match(
      /:global\(html\[data-dsh-desktop-platform='win32'\]\) \.desktopTitlebarDragRegion\s*\{([^}]*)}/s,
    )?.[1]
    expect(windowsDragSeat).toContain('right: var(--dsh-windows-caption-controls-width);')
    expect(css).toMatch(
      /:global\(html\[data-dsh-desktop-platform='win32'\]\) \.header\s*\{[^}]*padding: 0 0 0 20px;[^}]*-webkit-app-region: no-drag;/s,
    )
    const windowsTitleRow = css.match(
      /:global\(html\[data-dsh-desktop-platform='win32'\]\) \.titleRow\s*\{([^}]*)}/s,
    )?.[1]
    expect(windowsTitleRow).toContain('min-height: var(--dsh-desktop-titlebar-inset, 44px);')
    expect(windowsTitleRow).toContain(
      'padding-right: calc(var(--dsh-windows-caption-controls-width) + 20px);',
    )
    expect(windowsTitleRow).toContain('-webkit-app-region: drag;')
  })

  it('removes renderer drag and caption geometry inside the native desktop shell', () => {
    expect(css).toMatch(
      /:global\(html\[data-dsh-desktop-embedded='true'\]\) \.desktopTitlebarDragRegion\s*\{[^}]*display: none;/s,
    )
    expect(css).toMatch(
      /:global\(html\[data-dsh-desktop-embedded='true'\]\) \.header\s*\{[^}]*padding: 12px 28px 0 20px;[^}]*-webkit-app-region: no-drag;/s,
    )
    const embeddedWindowsTitle = css.match(
      /:global\(html\[data-dsh-desktop-embedded='true'\]\[data-dsh-desktop-platform='win32'\]\) \.titleRow\s*\{([^}]*)}/s,
    )?.[1]
    expect(embeddedWindowsTitle).toContain('min-height: 32px;')
    expect(embeddedWindowsTitle).toContain('padding-right: 0;')
  })

  it.each([
    'button:not(:disabled)',
    'a',
    'input',
    'select',
    'textarea',
    "[role='button']",
    "[role='link']",
    "[role='tab']",
    "[contenteditable='true']",
  ])('keeps header %s interactions outside the drag region', (selector) => {
    expect(css).toContain(
      `:global(html[data-dsh-desktop='true']) .header ${selector}`,
    )
    expect(css).toMatch(/-webkit-app-region: no-drag;/)
  })
})
