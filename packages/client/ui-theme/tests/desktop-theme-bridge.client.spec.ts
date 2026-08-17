// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { ThemeSettings } from '@deepseek-ai/dsh-client-ui-theme/client'
import { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import { bindDesktopThemeBridge } from '../src/client/desktop-theme-bridge.ts'

afterEach(() => {
  delete document.documentElement.dataset.dshDesktopEmbedded
  delete window.dshDesktopTheme
})

function setup(embedded = true) {
  const listeners = new Set<(value: unknown) => void>()
  const publish = vi.fn()
  const unsubscribe = vi.fn()
  window.dshDesktopTheme = {
    publish,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener); unsubscribe() }
    },
  }
  if (embedded) document.documentElement.dataset.dshDesktopEmbedded = 'true'
  const ctx = new Context()
  const host = stubSettingsScope<ThemeSettings>()
  const theme = new ThemeRuntime(ctx, host.scope)
  bindDesktopThemeBridge(ctx, theme)
  return {
    ctx,
    theme,
    publish,
    unsubscribe,
    receive: (value: unknown) => {
      for (const listener of [...listeners]) listener(value)
    },
  }
}

describe('desktop ThemeRuntime bridge', () => {
  it('publishes the initial and changed snapshots', () => {
    const { theme, publish } = setup()
    expect(publish).toHaveBeenCalledWith({ preference: 'system', scheme: 'light' })
    theme.setTheme('dark')
    expect(publish).toHaveBeenLastCalledWith({ preference: 'dark', scheme: 'dark' })
  })

  it('accepts only built-in preferences and releases the subscription', async () => {
    const { ctx, theme, receive, unsubscribe } = setup()
    receive('sepia')
    expect(theme.getTheme().preference).toBe('system')
    receive('dark')
    expect(theme.getTheme().preference).toBe('dark')

    await ctx.fiber.dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
    receive('light')
    expect(theme.getTheme().preference).toBe('dark')
  })

  it('does nothing outside the embedded desktop renderer', () => {
    const { theme, publish, receive } = setup(false)
    expect(publish).not.toHaveBeenCalled()
    receive('dark')
    expect(theme.getTheme().preference).toBe('system')
  })
})
