# Official Chat mode

This fork is based on `dsh-tauri/deepseek-harness-desktop` commit `bd4da3aee51d65061001857e4234a8942ceca6ff` (desktop 0.15.4). It adds the official DeepSeek Chat website beside the existing Harness interface.

## Use

Choose **Harness** or **Chat** in the top bar. The switch remains available in macOS fullscreen. Each window keeps its own selection while running; the last selection is saved for future launches. Harness continues its normal startup in the background. Chat is created when first selected, and switching back and forth retains each page, including unfinished input.

Chat uses the official website and its own login interface. It does not use Harness API keys or provide a model adapter. The toolbar offers reload, open in browser, and clear Chat data. Clear requires confirmation and signs out Chat in every application window. It clears local cookies, cache, and website storage; it does not delete online conversations or Harness sessions/settings.

## Platform support

The embedded Chat mode requires macOS 14 or newer for a separate persistent WebKit data store. Older macOS versions retain Harness and the browser fallback; the app never silently puts Chat into the shared default store. Windows uses WebView2 and Linux uses WebKitGTK with a dedicated data directory. Windows/Linux behavior requires validation on those platforms.

The official website may change its login flow or decline an embedded browser. The app does not bypass website checks. This version allows top-level navigation only at the exact `https://chat.deepseek.com` origin. Other HTTP(S) links open in the system browser; other schemes are blocked. Cross-origin authentication popups are not integrated. Actual account sign-in requires the user; automated checks use a local fixture to verify persistent storage.

## Implementation

`src-tauri/src/desktop/chat.rs` owns one child WebView per shell window. The Harness page remains inside the existing React shell iframe. `src/store/modules/desktop-mode` serializes local mode changes and stores only the selected mode. `src/hooks/use-chat-layout.ts` measures the content rectangle in native logical coordinates and hides Chat while local menus or dialogs are open. The native page never covers the toolbar.

`chat_policy.rs` owns URL decisions, bounds validation, and generation-checked load settlement. Loading has a 45-second timeout with retry and browser fallback. A Chat startup failure does not alter Harness state. Child WebViews receive no Tauri capability; the application command dispatcher also rejects every command from a Chat WebView. Native permission denial is verified with the loopback fixture, including `get_app_config`, `desktop_chat_clear`, and the Store plugin.

`chat_profile.rs` uses an app-specific data directory on Windows/Linux and an app-specific WebKit store identifier on macOS. Debug and release profiles are separate. Clearing navigates all live Chat pages to a blank document and waits for acknowledgement before closing them. On macOS it awaits WebKit's data-clearing completion callback; on other platforms it removes the owned profile directory after closing its views. A successfully cleared profile advances a persisted generation before selected windows reopen Chat. Failed clearing is reported and never reported as success.

Tauri's single-WebView lookup stops finding a window after adding a child WebView. Native window operations therefore use `get_window`, and Harness installation/progress operations use the local shell's `get_webview`. Existing tray, geometry, theme, and install behavior continues to address the same native window or local renderer.

## Fork identity and updates

The application is **DeepSeek Desktop Chat**, version `0.15.4-chat.1`, identifier `io.github.deepseek-desktop.chat`. Its desktop settings and WebView data are separate from the upstream application. Harness data follows the upstream profile rules (`~/.dsh` in release, `~/.dsh.dev` in debug).

Desktop self-update is disabled for this fork because the upstream installer would replace the Chat feature. Harness core updates remain available. A future release channel must point at this fork's own signed artifacts before enabling desktop updates. Upstream licenses and attribution are retained.

## Develop and verify

```sh
pnpm install --frozen-lockfile
pnpm build:plugins
pnpm typecheck
pnpm exec vitest run test/desktop-mode.test.ts
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
pnpm dev:desktop
```

On macOS, the upstream Worktree tests compare Git's canonical paths with Node's temporary paths. Use `TMPDIR=/private/tmp pnpm exec vitest run` to avoid the `/var` to `/private/var` alias difference.

For a native smoke test without API requests, profile migration, plugin installation, or a real login, run the fixture server and the debug application in separate terminals:

```sh
node scripts/chat-smoke-server.mjs
```

```sh
DSH_DESKTOP_SMOKE=1 VITE_DESKTOP_SMOKE=1 \
DSH_CHAT_TEST_URL=http://127.0.0.1:19086/chat pnpm tauri dev --no-watch
```

Both native overrides are compiled out of release builds. The frontend fixture is gated by Vite development mode and dynamically imported. The Chat URL override accepts only HTTP on `127.0.0.1`. Omit `DSH_CHAT_TEST_URL` to verify the official Chat page while retaining the Harness fixture.

Check that drafts survive mode switches, the Chat profile identifier survives restart, clear cancellation preserves data, confirmed clearing changes only the Chat identifier, local settings remain clickable over Chat, the switch remains visible in fullscreen, and native commands from the Chat fixture are denied.
