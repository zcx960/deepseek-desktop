import { describe, expect, it } from 'vitest'
import {
  desktopChromeBounds,
  desktopTitlebarDragStart,
  insetDesktopContentBounds,
} from '../src/main/desktop-chrome-layout'
import { DESKTOP_TITLEBAR_HEIGHT } from '../src/shared/shell-protocol'

const content = { x: 0, y: 0, width: 1200, height: 800 }

describe('desktop mode chrome geometry', () => {
  it('keeps closed chrome inside the native title bar', () => {
    expect(desktopChromeBounds({
      platform: 'darwin',
      mode: 'harness',
      surface: 'closed',
      content,
    })).toEqual({ x: 980, y: 6, width: 164, height: 32 })
    expect(desktopChromeBounds({
      platform: 'darwin',
      mode: 'chat',
      surface: 'closed',
      content,
    })).toEqual({ x: 980, y: 6, width: 200, height: 32 })
    expect(desktopChromeBounds({
      platform: 'win32', mode: 'harness', surface: 'closed', content,
    })).toEqual({ x: 980, y: 6, width: 164, height: 32 })
  })

  it('anchors the selector to the content area, not to screen coordinates', () => {
    // A window repositioned on screen must not move its child views: the
    // returned rectangle is relative to the content area, so `content.x`/`y`
    // must not leak into it.
    const moved = { x: 240, y: 96, width: 1200, height: 800 }
    expect(desktopChromeBounds({
      platform: 'darwin', mode: 'harness', surface: 'closed', content: moved,
    })).toEqual({ x: 980, y: 6, width: 164, height: 32 })
  })

  it('anchors every closed control past the title-bar drag region', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const chrome = desktopChromeBounds({
        platform,
        mode: 'chat',
        surface: 'closed',
        content,
      })
      // The drag strip stops at `desktopTitlebarDragStart`; the selector must
      // begin after it so a drag gesture never lands on a button.
      expect(chrome.x).toBeGreaterThanOrEqual(desktopTitlebarDragStart(platform))
      expect(chrome.x + chrome.width).toBeLessThanOrEqual(content.width)
    }
  })

  it('expands only to the Chat menu and the full dialog', () => {
    expect(desktopChromeBounds({
      platform: 'darwin', mode: 'chat', surface: 'chat-menu', content,
    })).toEqual({ x: 980, y: 6, width: 200, height: 132 })
    expect(desktopChromeBounds({
      platform: 'darwin', mode: 'chat', surface: 'dialog', content,
    })).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
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
