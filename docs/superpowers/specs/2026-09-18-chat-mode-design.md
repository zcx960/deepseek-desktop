# Official Chat Mode Design

## Goal

Add an official DeepSeek Chat mode to the Tauri desktop application while preserving the existing Harness mode, independent page state, and persistent login data.

## User experience

The main window keeps its existing shell navigation and gains a two-option `Harness / Chat` switch. The selected mode is persisted with the existing settings store and restored on startup. Harness remains available in the background while Chat is selected; Chat is created lazily on first use unless it was the last selected mode.

Chat is the official `https://chat.deepseek.com/` experience rendered by a Tauri child WebView below the shell navigation. Harness remains the existing loopback iframe. Switching modes changes WebView visibility without reloading either surface.

## Components

- Rust `ChatWebviewManager`: creates the child WebView, applies bounds, owns its lifecycle, validates navigation, opens unrelated links externally, emits readiness/failure events, and clears its dedicated data directory.
- Rust desktop commands: expose mode selection, retry, clear data, and status reads to the shell.
- React `desktop mode` store: persists the selected mode, serializes mode transitions, subscribes to Rust status events, and exposes retry/clear actions.
- Navbar switch: renders localized mode controls and Chat-only actions without changing existing Harness commands.
- Chat status surface: reports loading, ready, failed, and clearing states and offers retry/browser fallback.

## Data flow

1. The shell starts and reads the persisted mode.
2. Rust builds the main window and registers the Chat WebView manager.
3. The shell sends the selected mode to Rust.
4. Rust creates the Chat WebView on first Chat selection, using an application-data subdirectory on Windows/Linux or an isolated WebKit data store on macOS 14+.
5. Rust positions the child WebView at the measured content origin below the shell navigation (52px at 100% zoom) and resizes it with the main window.
6. Rust emits status events; React renders the switch and failure surfaces.
7. Chat navigation is allowed only for the exact official Chat origin. No additional authentication origins are trusted. Other HTTP(S) URLs open through the system opener; non-web schemes are rejected.

## Storage and clearing

The Chat WebView receives a separate persistent profile. Clearing first blanks all Chat pages and waits for navigation completion, closes the views, then awaits WebKit data clearing on macOS or removes the owned directory on Windows/Linux. A successful clear advances the stored profile generation and recreates selected Chat views. Harness settings, profiles, sessions, and its WebView data remain untouched. macOS versions before 14 show a browser fallback because they cannot provide an isolated persistent WebKit store.

## Failure behavior

Chat failures do not change Harness status. A failed Chat surface remains selectable and presents retry plus browser fallback. Harness failures continue through the existing recovery flow. If Chat is unavailable, selecting Harness still returns immediately to the working Harness surface.

## Security

The Chat child WebView receives no shell command permissions. Navigation checks run in Rust before every top-level navigation. New-window requests do not create unrestricted child windows: official Chat URLs stay in Chat; unrelated web URLs go to the system browser; other protocols are rejected. The shell does not read Chat cookies, page storage, or page content.

## Testing

Rust unit tests cover navigation policy, bounds validation, and stale load settlements. Store tests cover mode restoration, transition serialization, failure/retry, stale events, and clear actions. Native macOS smoke checks cover retained drafts, persistent profile identity after restart, clear cancellation, profile reset without changing Harness, command denial, settings overlays, and fullscreen. The official login page is loaded separately; no account credentials are entered.
