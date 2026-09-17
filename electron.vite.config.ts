import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          'windows-menu': resolve('src/preload/windows-menu.ts'),
          // Binds the embedded DeepSeek Chat page to the desktop theme carrier.
          'chat-theme': resolve('src/preload/chat-theme.ts'),
          // Trusted DOM behavior for the title-bar mode switch.
          'mode-chrome': resolve('src/preload/mode-chrome.ts')
        },
        // A sandboxed preload gets a restricted `require` that cannot load
        // arbitrary local files, so any chunk shared between two preload entries
        // is unloadable and that preload silently fails. The entries below
        // therefore keep their helpers local instead of importing a common
        // module; see the notes beside each preload's duplicated constant.
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  }
})
