import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

interface FixtureState {
  readonly snapshot?: {
    readonly selected: 'chat' | 'harness'
    readonly chat: { readonly phase: string }
    readonly harness: { readonly phase: string }
  }
  readonly visible: { readonly chat: boolean; readonly harness: boolean }
  readonly generations: { readonly chat: number; readonly harness: number }
  readonly bounds: {
    readonly chat?: FixtureBounds
    readonly chrome?: FixtureBounds
    readonly harness?: FixtureBounds
  }
  readonly preferences: { readonly chat: FixtureThemePreference; readonly harness: FixtureThemePreference }
  readonly schemes: { readonly chat: FixtureThemeScheme; readonly harness: FixtureThemeScheme }
  readonly reloads: { readonly chat: number; readonly harness: number }
  readonly sidebarClicks: number
}

interface FixtureBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

type FixtureThemeTarget = 'chat' | 'harness' | 'system'
type FixtureThemePreference = 'light' | 'dark' | 'system'
type FixtureThemeScheme = 'light' | 'dark'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = resolve(desktopRoot, 'tests/fixtures/dual-mode-app')

function isModeChrome(page: Page): boolean {
  try {
    return new URL(page.url()).pathname.endsWith('/mode-chrome.html')
  } catch {
    return false
  }
}

async function modeChrome(application: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const existing = application.windows().find(isModeChrome)
    if (existing !== undefined) {
      await existing.waitForLoadState('domcontentloaded', { timeout: 8_000 })
      await existing.locator('#mode-switch').waitFor({ timeout: 8_000 })
      return existing
    }
    await new Promise((resolveWait) => { setTimeout(resolveWait, 50) })
  }
  throw new Error(`mode chrome page did not settle: ${application.windows().map(page => page.url()).join(', ')}`)
}

async function selectMode(chrome: Page, mode: 'chat' | 'harness'): Promise<void> {
  const segment = chrome.locator(`#mode-switch [data-mode="${mode}"]`)
  await segment.click()
  await expect.poll(() => segment.getAttribute('aria-checked')).toBe('true')
}

async function waitForChromeWidth(chrome: Page, width: number): Promise<void> {
  await chrome.waitForFunction(expected => window.innerWidth === expected, width, { timeout: 8_000 })
}

async function fixtureState(application: ElectronApplication): Promise<FixtureState> {
  return application.evaluate(() => {
    const fixture = (globalThis as typeof globalThis & {
      __dshDualModeFixture?: { state: () => FixtureState }
    }).__dshDualModeFixture
    if (fixture === undefined) throw new Error('dual-mode fixture API is unavailable')
    return fixture.state()
  })
}

async function failFixture(application: ElectronApplication, mode: 'chat' | 'harness'): Promise<void> {
  await application.evaluate((_electron, selectedMode) => {
    const fixture = (globalThis as typeof globalThis & {
      __dshDualModeFixture?: { fail: (mode: 'chat' | 'harness') => void }
    }).__dshDualModeFixture
    if (fixture === undefined) throw new Error('dual-mode fixture API is unavailable')
    fixture.fail(selectedMode)
  }, mode)
}

async function setFixtureTheme(
  application: ElectronApplication,
  target: FixtureThemeTarget,
  preference: FixtureThemePreference,
): Promise<void> {
  await application.evaluate(async (_electron, input) => {
    const fixture = (globalThis as typeof globalThis & {
      __dshDualModeFixture?: {
        setTheme: (target: FixtureThemeTarget, preference: FixtureThemePreference) => Promise<void>
      }
    }).__dshDualModeFixture
    if (fixture === undefined) throw new Error('dual-mode fixture API is unavailable')
    await fixture.setTheme(input.target, input.preference)
  }, { target, preference })
}

async function captureWindow(
  application: ElectronApplication,
  chrome: Page,
  mode: 'chat' | 'harness',
  name: string,
): Promise<void> {
  const directory = process.env.DSH_DESKTOP_SCREENSHOT_DIR
  if (directory === undefined) return
  await chrome.waitForTimeout(180)
  const content = application.windows().find((page) => {
    try {
      return new URL(page.url()).pathname === `/${mode}`
    } catch {
      return false
    }
  })
  if (content === undefined) throw new Error(`dual-mode ${mode} fixture page is unavailable`)
  const [contentImage, chromeImage, state, windowBounds, scale] = await Promise.all([
    content.screenshot(),
    chrome.screenshot({ omitBackground: true }),
    fixtureState(application),
    application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds()),
    chrome.evaluate(() => devicePixelRatio),
  ])
  const [contentMetadata, theme] = await Promise.all([
    sharp(contentImage).metadata(),
    chrome.evaluate(() => document.documentElement.dataset.theme),
  ])
  const contentBounds = state.bounds[mode]
  const chromeBounds = state.bounds.chrome
  if (contentMetadata.width === undefined || contentMetadata.height === undefined
    || contentBounds === undefined || chromeBounds === undefined) {
    throw new Error('dual-mode fixture screenshot dimensions are unavailable')
  }
  await mkdir(directory, { recursive: true })
  await sharp({
    create: {
      width: Math.round(windowBounds.width * scale),
      height: Math.round(windowBounds.height * scale),
      channels: 4,
      background: theme === 'dark' ? '#121416' : '#f5f7f8',
    },
  })
    .composite([
      { input: contentImage, left: Math.round(contentBounds.x * scale), top: Math.round(contentBounds.y * scale) },
      { input: chromeImage, left: Math.round(chromeBounds.x * scale), top: Math.round(chromeBounds.y * scale) },
    ])
    .png()
    .toFile(join(directory, `${name}.png`))
}

async function chromeForeground(chrome: Page): Promise<number[]> {
  return await chrome.evaluate(() => {
    const channels = (value: string): number[] => [...value.matchAll(/\d+/g)].map(match => Number(match[0]))
    const segment = document.querySelector('#mode-switch [data-mode="harness"]')
    if (segment === null) throw new Error('mode chrome Harness segment is unavailable')
    return channels(getComputedStyle(segment).color)
  })
}

async function modeLabelsFit(chrome: Page): Promise<boolean> {
  return chrome.locator('#mode-switch [data-mode]').evaluateAll(elements =>
    elements.every(element => element.scrollWidth <= element.clientWidth),
  )
}

async function evaluateChat<T>(application: ElectronApplication, expression: string): Promise<T> {
  return application.evaluate(async ({ webContents }, source) => {
    const contents = webContents.getAllWebContents().find((candidate) => {
      try {
        return new URL(candidate.getURL()).pathname === '/chat'
      } catch {
        return false
      }
    })
    if (contents === undefined) throw new Error('Chat fixture WebContents is unavailable')
    return await contents.executeJavaScript(source, true) as T
  }, expression)
}

async function waitForState(
  application: ElectronApplication,
  predicate: (state: FixtureState) => boolean,
): Promise<FixtureState> {
  const deadline = Date.now() + 8_000
  let lastState: FixtureState | undefined
  while (Date.now() < deadline) {
    lastState = await fixtureState(application)
    if (predicate(lastState)) return lastState
    await new Promise((resolveWait) => { setTimeout(resolveWait, 50) })
  }
  throw new Error(`fixture state did not settle: ${JSON.stringify(lastState)}`)
}

async function launchFixture(userDataDirectory: string): Promise<ElectronApplication> {
  return await _electron.launch({
    args: [fixtureRoot],
    cwd: desktopRoot,
    env: {
      ...process.env,
      DSH_DESKTOP_FIXTURE_USER_DATA: userDataDirectory,
    },
  })
}

describe('desktop dual-mode Electron application', () => {
  it('defaults a fresh profile to Harness and restores the last selected mode', { timeout: 30_000 }, async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'dsh-dual-mode-persistence-'))
    let application: ElectronApplication | undefined
    try {
      application = await launchFixture(userDataDirectory)
      let chrome = await modeChrome(application)
      await waitForState(application, state =>
        state.snapshot?.selected === 'harness'
        && state.snapshot.harness.phase === 'ready'
        && state.visible.harness,
      )

      await selectMode(chrome, 'chat')
      await waitForState(application, state =>
        state.snapshot?.selected === 'chat'
        && state.snapshot.chat.phase === 'ready'
        && state.visible.chat,
      )
      await application.close()

      application = await launchFixture(userDataDirectory)
      chrome = await modeChrome(application)
      await waitForState(application, state =>
        state.snapshot?.selected === 'chat'
        && state.snapshot.chat.phase === 'ready'
        && state.visible.chat
        && !state.visible.harness,
      )
      expect(await chrome.locator('#mode-switch [data-mode="chat"]').getAttribute('aria-checked')).toBe('true')
    } finally {
      await application?.close().catch(() => undefined)
      await rm(userDataDirectory, { recursive: true, force: true })
    }
  })

  it('retains Chat state, isolates failures, and clears the Chat partition', { timeout: 30_000 }, async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'dsh-dual-mode-electron-'))
    let application: ElectronApplication | undefined
    try {
      application = await launchFixture(userDataDirectory)
      const chrome = await modeChrome(application)
      await waitForChromeWidth(chrome, 164)
      expect(await chrome.locator('#mode-menu').count()).toBe(0)
      expect(await chrome.locator('.chevron').count()).toBe(0)
      await waitForState(application, state =>
        state.snapshot?.harness.phase === 'ready'
        && state.visible.harness
        && !state.visible.chat,
      )
      await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.mode)).toBe('harness')
      expect(await chrome.locator('#mode-switch [data-mode="chat"]').getAttribute('aria-checked')).toBe('false')
      expect(await chrome.locator('#mode-switch [data-mode="harness"]').getAttribute('aria-checked')).toBe('true')
      await chrome.locator('#mode-switch [data-mode="harness"]').focus()
      await chrome.keyboard.press('Home')
      await waitForState(application, state => state.snapshot?.selected === 'chat')
      await waitForChromeWidth(chrome, 200)
      await chrome.keyboard.press('End')
      await waitForState(application, state => state.snapshot?.selected === 'harness')
      await waitForChromeWidth(chrome, 164)
      await chrome.keyboard.press('ArrowLeft')
      await waitForState(application, state => state.snapshot?.selected === 'chat')
      await chrome.keyboard.press('ArrowRight')
      await waitForState(application, state => state.snapshot?.selected === 'harness')
      await chrome.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur() })
      const shell = application.windows().find(page => page.url().endsWith('/shell.html'))
      const harnessContent = application.windows().find((page) => {
        try {
          return new URL(page.url()).pathname === '/harness'
        } catch {
          return false
        }
      })
      if (shell === undefined || harnessContent === undefined) {
        throw new Error('dual-mode shell hierarchy did not settle')
      }
      const [shellHeight, chromeHeight, contentHeight, switchBox, dragBox] = await Promise.all([
        shell.evaluate(() => innerHeight),
        chrome.evaluate(() => innerHeight),
        harnessContent.evaluate(() => innerHeight),
        chrome.locator('#mode-switch').boundingBox(),
        shell.locator('#window-drag-region').boundingBox(),
      ])
      expect(contentHeight).toBe(shellHeight)
      expect(chromeHeight).toBe(32)
      expect(switchBox).not.toBeNull()
      expect(switchBox).toMatchObject({ x: 0, y: 0, width: 164, height: 32 })
      expect(dragBox).not.toBeNull()
      expect(dragBox?.x).toBe(300)
      expect(await chrome.locator('.mode-mark').count()).toBe(0)
      expect(await chrome.locator('#mode-switch').evaluate((element) => {
        const style = getComputedStyle(element)
        return { border: style.borderTopWidth, columns: style.gridTemplateColumns }
      })).toEqual({ border: '0px', columns: '82px 82px' })
      expect(await chrome.locator('#mode-switch [data-mode="chat"]').textContent()).toBe('Chat')
      expect(await chrome.locator('#mode-switch [data-mode="harness"]').textContent()).toBe('Harness')
      expect(await modeLabelsFit(chrome)).toBe(true)

      await setFixtureTheme(application, 'harness', 'light')
      await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
      await expect.poll(async () => Math.max(...(await chromeForeground(chrome)))).toBeLessThan(128)
      await captureWindow(application, chrome, 'harness', 'harness-light-selected')
      await setFixtureTheme(application, 'harness', 'dark')
      await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
      await expect.poll(async () => Math.min(...(await chromeForeground(chrome)))).toBeGreaterThan(200)
      await captureWindow(application, chrome, 'harness', 'harness-dark-selected')

      await selectMode(chrome, 'chat')
      await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.mode)).toBe('chat')
      const initialChat = await waitForState(application, state =>
        state.snapshot?.selected === 'chat'
        && state.snapshot.chat.phase === 'ready'
        && state.visible.chat
        && !state.visible.harness,
      )
      expect(initialChat.preferences).toEqual({ chat: 'dark', harness: 'dark' })
      expect(initialChat.schemes).toEqual({ chat: 'dark', harness: 'dark' })
      expect(initialChat.reloads.chat).toBeGreaterThan(0)
      expect(await modeLabelsFit(chrome)).toBe(true)
      const chatContent = application.windows().find((page) => {
        try {
          return new URL(page.url()).pathname === '/chat'
        } catch {
          return false
        }
      })
      if (chatContent === undefined || initialChat.bounds.chat === undefined || initialChat.bounds.chrome === undefined) {
        throw new Error('Chat fixture geometry is unavailable')
      }
      expect(initialChat.bounds.chrome.x + initialChat.bounds.chrome.width).toBeLessThanOrEqual(dragBox!.x)
      const sidebarToggleBox = await chatContent.locator('#chat-sidebar-toggle').boundingBox()
      if (sidebarToggleBox === null) throw new Error('Chat fixture sidebar toggle is unavailable')
      expect(initialChat.bounds.chat.y + sidebarToggleBox.y)
        .toBeGreaterThanOrEqual(initialChat.bounds.chrome.y + initialChat.bounds.chrome.height)
      await chatContent.locator('#chat-sidebar-toggle').click()
      const runningApplication = application
      await expect.poll(async () => (await fixtureState(runningApplication)).sidebarClicks).toBe(1)

      const reloadsBeforeChatChoice = initialChat.reloads.chat
      await setFixtureTheme(application, 'chat', 'light')
      const chatLight = await waitForState(application, state =>
        state.preferences.chat === 'light'
        && state.preferences.harness === 'light'
        && state.schemes.chat === 'light'
        && state.schemes.harness === 'light',
      )
      expect(chatLight.reloads.chat).toBe(reloadsBeforeChatChoice)
      await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
      await expect.poll(() => shell.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
      const chatLightBackground = await evaluateChat<string>(application, 'getComputedStyle(document.body).backgroundColor')
      expect(await shell.locator('#titlebar-backdrop').evaluate(element => getComputedStyle(element).backgroundColor))
        .toBe(chatLightBackground)

      await selectMode(chrome, 'harness')
      const harnessLight = await waitForState(application, state => state.visible.harness && !state.visible.chat)
      await setFixtureTheme(application, 'chat', 'dark')
      const correctedChat = await waitForState(application, state =>
        state.preferences.chat === 'light'
        && state.preferences.harness === 'light'
        && state.reloads.chat > harnessLight.reloads.chat,
      )
      expect(correctedChat.schemes).toEqual({ chat: 'light', harness: 'light' })
      await setFixtureTheme(application, 'harness', 'system')
      await setFixtureTheme(application, 'system', 'dark')
      await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
      await expect.poll(async () => Math.min(...(await chromeForeground(chrome)))).toBeGreaterThan(200)
      await waitForState(application, state =>
        state.preferences.chat === 'system'
        && state.preferences.harness === 'system'
        && state.schemes.chat === 'dark'
        && state.schemes.harness === 'dark',
      )
      await selectMode(chrome, 'chat')
      await waitForState(application, state => state.visible.chat && !state.visible.harness)
      await expect.poll(() => shell.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
      const chatDarkBackground = await evaluateChat<string>(application, 'getComputedStyle(document.body).backgroundColor')
      expect(await shell.locator('#titlebar-backdrop').evaluate(element => getComputedStyle(element).backgroundColor))
        .toBe(chatDarkBackground)
      await captureWindow(application, chrome, 'chat', 'chat-dark-selected')
      await setFixtureTheme(application, 'system', 'light')
      await expect.poll(() => chrome.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
      await evaluateChat(application, `(() => {
        document.querySelector('#chat-draft').value = 'retained draft'
        localStorage.setItem('login-marker', 'fixture-user')
      })()`)

      await selectMode(chrome, 'harness')
      await waitForState(application, state => state.visible.harness && !state.visible.chat)
      await selectMode(chrome, 'chat')
      await waitForState(application, state => state.visible.chat && !state.visible.harness)
      await expect(evaluateChat<string>(application,
        'document.querySelector(\'#chat-draft\').value',
      )).resolves.toBe('retained draft')
      expect((await fixtureState(application)).generations.chat).toBe(initialChat.generations.chat)

      await failFixture(application, 'harness')
      await waitForState(application, state =>
        state.snapshot?.harness.phase === 'failed'
        && state.snapshot.chat.phase === 'ready'
        && state.visible.chat,
      )

      await selectMode(chrome, 'harness')
      await waitForState(application, state =>
        state.snapshot?.harness.phase === 'ready'
        && state.visible.harness
        && !state.visible.chat,
      )
      await failFixture(application, 'chat')
      await waitForState(application, state =>
        state.snapshot?.chat.phase === 'failed'
        && state.snapshot.harness.phase === 'ready'
        && state.visible.harness,
      )

      await selectMode(chrome, 'chat')
      const recreatedChat = await waitForState(application, state =>
        state.snapshot?.chat.phase === 'ready'
        && state.visible.chat,
      )
      expect(recreatedChat.generations.chat).toBeGreaterThan(initialChat.generations.chat)
      await expect(evaluateChat<string | null>(application,
        'localStorage.getItem(\'login-marker\')',
      )).resolves.toBe('fixture-user')

      await chrome.locator('#chat-actions').click()
      await chrome.locator('#clear-chat-data').click()
      await chrome.locator('#clear-chat-confirm[open]').waitFor()
      await chrome.locator('#confirm-clear').click()
      const clearedChat = await waitForState(application, state =>
        state.snapshot?.chat.phase === 'ready'
        && state.visible.chat
        && state.generations.chat > recreatedChat.generations.chat,
      )
      expect(clearedChat.snapshot?.harness.phase).toBe('ready')
      expect(clearedChat.preferences).toEqual({ chat: 'system', harness: 'system' })
      expect(clearedChat.schemes).toEqual({ chat: 'light', harness: 'light' })
      await expect(evaluateChat<string | null>(application,
        'localStorage.getItem(\'login-marker\')',
      )).resolves.toBeNull()

      await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setSize(980, 720) })
      await waitForChromeWidth(chrome, 200)
      expect(await chrome.locator('#mode-switch [data-mode="chat"]').textContent()).toBe('Chat')
      expect(await chrome.locator('#mode-switch [data-mode="harness"]').textContent()).toBe('Harness')
      expect(await modeLabelsFit(chrome)).toBe(true)
      expect(await chrome.locator('.mode-mark').count()).toBe(0)
      expect(await chrome.locator('#mode-menu').count()).toBe(0)
      expect(await chrome.locator('.chevron').count()).toBe(0)
      await captureWindow(application, chrome, 'chat', 'chat-light-selected')
    } finally {
      await application?.close().catch(() => undefined)
      await rm(userDataDirectory, { recursive: true, force: true })
    }
  })
})
