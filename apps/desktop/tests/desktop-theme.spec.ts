import { describe, expect, it } from 'vitest'
import {
  isDesktopColorScheme,
  isDesktopThemeBackgroundColor,
  normalizeDesktopThemeBackgroundColor,
  schemeForThemeColor,
} from '../src/desktop-theme.ts'

describe('desktop theme', () => {
  it('chooses the foreground scheme with the greater contrast', () => {
    expect(schemeForThemeColor('#ffffff')).toBe('light')
    expect(schemeForThemeColor('#f5f7f8')).toBe('light')
    expect(schemeForThemeColor('#777777')).toBe('light')
    expect(schemeForThemeColor('#121416')).toBe('dark')
    expect(schemeForThemeColor('#000000')).toBe('dark')
  })

  it('rejects colors outside Electron theme-color events', () => {
    expect(schemeForThemeColor(null)).toBeUndefined()
    expect(schemeForThemeColor('')).toBeUndefined()
    expect(schemeForThemeColor('#fff')).toBeUndefined()
    expect(schemeForThemeColor('rgb(255, 255, 255)')).toBeUndefined()
  })

  it('accepts only the closed desktop color-scheme union', () => {
    expect(isDesktopColorScheme('light')).toBe(true)
    expect(isDesktopColorScheme('dark')).toBe(true)
    expect(isDesktopColorScheme('system')).toBe(false)
    expect(isDesktopColorScheme(undefined)).toBe(false)
  })

  it('normalizes only opaque computed RGB colors for local title-bar paint', () => {
    expect(normalizeDesktopThemeBackgroundColor('rgb(245, 247, 248)')).toBe('#f5f7f8')
    expect(normalizeDesktopThemeBackgroundColor('rgba(18, 20, 22, 1)')).toBe('#121416')
    expect(normalizeDesktopThemeBackgroundColor('rgba(0, 0, 0, 0)')).toBeUndefined()
    expect(normalizeDesktopThemeBackgroundColor('url(https://example.com/a.png)')).toBeUndefined()
    expect(normalizeDesktopThemeBackgroundColor(undefined)).toBeUndefined()
  })

  it('accepts only normalized title-bar background colors', () => {
    expect(isDesktopThemeBackgroundColor('#f5f7f8')).toBe(true)
    expect(isDesktopThemeBackgroundColor('#000000')).toBe(true)
    expect(isDesktopThemeBackgroundColor('rgb(0, 0, 0)')).toBe(false)
    expect(isDesktopThemeBackgroundColor('transparent')).toBe(false)
  })
})
