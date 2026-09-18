import { store } from '@/store'

export function prepareDesktopSmoke() {
  store.harness.$patch({
    status: 'ready',
    serviceUrl: 'http://127.0.0.1:19086',
    iframeSrc: 'http://127.0.0.1:19086/harness',
    serviceHealthy: true,
    serviceRunning: false,
    iframeLoaded: false,
    iframeError: false,
  })
}
