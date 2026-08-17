/** Embedded macOS Harness sidebar clearance below the desktop mode switch. */

import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/desktop-sidebar-titlebar', import.meta.url))
const GEOMETRY_EXPECTED = join(SNAPSHOT_DIR, 'geometry.expected.md')
const MODE = webSnapshotMode()
const MODE_SWITCH_BOTTOM = 38

interface SidebarGeometry {
  readonly titlebarInset: number
  readonly controlTop: number
  readonly controlHeight: number
}

function renderGeometry(geometry: SidebarGeometry): string {
  return [
    '# Embedded macOS Harness sidebar geometry',
    '',
    `- Title-bar inset: ${String(geometry.titlebarInset)}px`,
    `- Mode switch bottom: ${String(MODE_SWITCH_BOTTOM)}px`,
    `- Collapse control top: ${String(geometry.controlTop)}px`,
    `- Collapse control height: ${String(geometry.controlHeight)}px`,
    `- Gap after mode switch: ${String(geometry.controlTop - MODE_SWITCH_BOTTOM)}px`,
  ].join('\n')
}

describe('web e2e: embedded macOS sidebar title-bar clearance', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    const url = new URL(scaffold.baseUrl)
    url.searchParams.set('dsh-desktop-platform', 'darwin')
    url.searchParams.set('dsh-desktop-embedded', '1')
    await page.goto(url.href, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps the expanded sidebar control below native title-bar chrome', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-desktop-sidebar-titlebar'))
    const toggle = page.getByRole('button', { name: 'Collapse sidebar' })
    await toggle.waitFor({ timeout: 30_000 })
    const bounds = await toggle.boundingBox()
    expect(bounds).not.toBeNull()
    const titlebarInset = await page.evaluate(() => Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--dsh-desktop-titlebar-inset'),
    ))
    const geometry = {
      titlebarInset,
      controlTop: Math.round(bounds!.y),
      controlHeight: Math.round(bounds!.height),
    }
    expect(geometry.controlTop).toBeGreaterThan(MODE_SWITCH_BOTTOM)
    await compareOrRefreshGolden(GEOMETRY_EXPECTED, renderGeometry(geometry), MODE)

    const screenshotDirectory = process.env.DSH_DESKTOP_SCREENSHOT_DIR
    if (screenshotDirectory !== undefined) {
      await mkdir(screenshotDirectory, { recursive: true })
      await page.screenshot({
        path: join(screenshotDirectory, 'harness-embedded-sidebar.png'),
        fullPage: true,
      })
    }
    expect(tripwire.pageErrors).toEqual([])
  })

  it('commits exactly the geometry fixture it reads', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['geometry.expected.md'])
  })

  it.skipIf(MODE === 'record')('issued zero model calls and stayed clean', () => {
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
