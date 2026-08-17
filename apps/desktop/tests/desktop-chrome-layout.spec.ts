import { describe, expect, it } from 'vitest'
import {
  desktopChromeBounds,
  desktopTitlebarDragStart,
  insetDesktopContentBounds,
} from '../src/desktop-chrome-layout.ts'
import { DESKTOP_TITLEBAR_HEIGHT } from '../src/shell-protocol.ts'

const content = { x: 0, y: 0, width: 1200, height: 800 }

describe('desktop mode chrome geometry', () => {
  it('keeps closed chrome inside the native title bar', () => {
    expect(desktopChromeBounds({
      platform: 'darwin',
      mode: 'harness',
      surface: 'closed',
      content,
    })).toEqual({ x: 88, y: 6, width: 164, height: 32 })
    expect(desktopChromeBounds({
      platform: 'darwin',
      mode: 'chat',
      surface: 'closed',
      content,
    })).toEqual({ x: 88, y: 6, width: 200, height: 32 })
    expect(desktopChromeBounds({
      platform: 'win32', mode: 'harness', surface: 'closed', content,
    })).toEqual({ x: 88, y: 6, width: 164, height: 32 })
  })

  it('keeps each closed control outside the title-bar drag region', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const chrome = desktopChromeBounds({
        platform,
        mode: 'chat',
        surface: 'closed',
        content,
      })
      expect(chrome.x + chrome.width).toBeLessThanOrEqual(desktopTitlebarDragStart(platform))
    }
  })

  it('expands only to the Chat menu and the full dialog', () => {
    expect(desktopChromeBounds({
      platform: 'darwin', mode: 'chat', surface: 'chat-menu', content,
    })).toEqual({ x: 88, y: 6, width: 200, height: 132 })
    expect(desktopChromeBounds({
      platform: 'darwin', mode: 'chat', surface: 'dialog', content,
    })).toEqual(content)
  })

  it('reserves only the native title bar for Chat without producing negative bounds', () => {
    expect(insetDesktopContentBounds(content, DESKTOP_TITLEBAR_HEIGHT)).toEqual({
      x: 0,
      y: 44,
      width: 1200,
      height: 756,
    })
    expect(insetDesktopContentBounds({ x: 2, y: 3, width: 100, height: 40 }, DESKTOP_TITLEBAR_HEIGHT)).toEqual({
      x: 2,
      y: 43,
      width: 100,
      height: 0,
    })
  })
})
