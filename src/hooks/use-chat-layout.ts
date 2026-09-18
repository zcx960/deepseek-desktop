import type { RefObject } from 'react'
import { useWatch } from '@reause/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef } from 'react'
import { useStore } from 'valtio-define'
import { store } from '@/store'

export function useChatLayout(contentRef: RefObject<HTMLDivElement | null>) {
  const mode = useStore(store.desktopMode)
  const scheduleRef = useRef<() => void>(() => {})

  useWatch([mode.selected, mode.chat.phase, mode.overlayDepth], () => scheduleRef.current())

  useEffect(() => {
    const content = contentRef.current
    if (!content)
      return
    let disposed = false
    let frame = 0
    let running = false
    let dirty = false
    let previous = ''

    async function sync() {
      if (running) {
        dirty = true
        return
      }
      running = true
      try {
        const nativeWindow = getCurrentWindow()
        const [size, scale] = await Promise.all([nativeWindow.innerSize(), nativeWindow.scaleFactor()])
        if (disposed || !content || window.innerWidth === 0)
          return
        const factor = size.width / scale / window.innerWidth
        const rect = content.getBoundingClientRect()
        const bounds = { x: rect.x * factor, y: rect.y * factor, width: rect.width * factor, height: rect.height * factor }
        const overlays = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [data-slot="popover"]')
        const occluded = Array.from(overlays).some(element => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true')
        const key = JSON.stringify([bounds, occluded, store.desktopMode.overlayDepth])
        if (key === previous)
          return
        await store.desktopMode.syncLayout(bounds, occluded)
        previous = key
      }
      catch (error) {
        console.error('[chat] layout failed:', error)
      }
      finally {
        running = false
        if (dirty && !disposed) {
          dirty = false
          schedule()
        }
      }
    }

    function schedule() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        void sync()
      })
    }

    scheduleRef.current = schedule
    const resize = new ResizeObserver(schedule)
    resize.observe(content)
    resize.observe(document.documentElement)
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden', 'data-open', 'hidden', 'style', 'class'] })
    schedule()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      scheduleRef.current = () => {}
    }
  }, [contentRef])
}
