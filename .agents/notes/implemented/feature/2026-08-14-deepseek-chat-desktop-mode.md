# Agent Note: DeepSeek Chat as an isolated desktop mode

Status: implemented

English | [中文](2026-08-14-deepseek-chat-desktop-mode.zh.md)

## Problem

Users who rely on both the Harness Web profile and the official DeepSeek Chat website need both experiences in one daily desktop workflow without treating them as one product or one data owner.

Embedding the public website is not equivalent to adding another Harness model provider. DeepSeek Chat owns its authentication, conversations, storage, network requests, and release schedule. Treating it as a Harness session would require unsupported DOM automation or private API integration, mix unrelated persistence models, and make ordinary website changes look like Harness regressions.

Chat must also remain usable when the loopback Host is unavailable. Host readiness and unexpected exit therefore cannot own the complete Desktop application lifecycle.

## Decision

Desktop provides two independent modes named **Chat** and **Harness** in one native window. Harness loads the local Web Host without changing its agent loop, tools, Session log, or model configuration. Chat loads `https://chat.deepseek.com/`, leaves authentication to DeepSeek's interface, and keeps the website's main world free of Desktop APIs and controls.

The modes share a Desktop-owned local shell and transparent sidebar mode chrome, but they do not share conversations, attachments, prompts, credentials, cookies, local storage, or navigation state. Switching changes which retained content view is visible; it never translates, copies, or submits data between the modes.

The implementation includes persistent Chat browsing data, preserved page state while switching, bidirectional theme preference synchronization, explicit reload and data-clearing controls, conservative external-link handling, and independent failure recovery. It excludes message synchronization, conversation import, general DOM automation, attachment transfer, and use of the Chat website as a Harness model backend.

## Product contract

- A fresh installation starts in Harness, and later launches restore the last selected mode.
- Chat is created on first selection and remains alive while hidden, preserving its current page, scroll position, and draft across mode switches.
- The dedicated persistent partition retains site data across application restarts until the user signs out on the website or clears Chat data. Whether a live login method works remains subject to release smoke verification.
- Harness retains its Session log and working-directory behavior. Chat content never becomes model-visible Harness input and never enters Harness persistence or telemetry.
- Desktop does not restyle the remote page, inject controls into its DOM, scrape content, or promise compatibility with undocumented website behavior.
- Each new Chat document starts with the official sidebar expanded. The isolated preload changes only a retained official `lastSessionValue.value.siderCollapsed` value from `true` to `false` before website initialization; after loading, a user can collapse the sidebar and the retained view preserves that state across mode switches.
- The selected mode owns the shared `light`/`dark`/`system` preference. Hidden-mode reports cannot replace it, and an unknown Chat theme-storage version disables only theme synchronization.
- Desktop does not bypass WAF, bot detection, authentication restrictions, or a DeepSeek decision to block embedded clients. A fixed system-browser fallback remains available when Chat fails.

## Desktop architecture

One local `BrowserWindow` owns a local status shell, a bounds-limited mode chrome view, and two main-process `WebContentsView` children. Harness uses the complete content bounds. Chat starts below the existing 44px operating-system title bar, while closed mode chrome occupies only its actual controls and cannot intercept the website's top-left controls:

```text
Electron BrowserWindow (local shell)
├── operating-system title-bar drag region
├── local mode chrome (segmented switch, Chat menu, dialog)
├── Harness WebContentsView -> loopback Host
└── Chat WebContentsView -> https://chat.deepseek.com/
```

`DesktopModeController` owns selection, child-view creation, visibility, bounds, status, retries, clearing, and shutdown. It starts Harness independently and creates Chat only when first selected. One serialized operation queue and per-mode generations prevent stale creation or failure callbacks from publishing after clearing, replacement, or shutdown.

The sandbox-compatible chrome preload exposes only the closed mode and command channels, and Main validates their payloads. Harness receives a separate theme bridge that delegates writes to `ThemeRuntime`. Chat receives an isolated preload that exposes no main-world API and cannot access generic IPC.

The mode-chrome WebContentsView remains transparent and shrinks to the actual closed controls in the operating-system title bar. Its equal-width `Chat | Harness` segments select modes directly through the closed IPC channel, with no mode dropdown, chevron, product mark, outer border, or compact abbreviation. Only the Chat action menu requests expanded native bounds. Main applies those bounds and acknowledges the state before the renderer reveals menu content, while closing hides content before restoring tight bounds. The shell drag region begins after the largest closed control span. The isolated Chat preload normalizes one opaque computed page background to canonical `#rrggbb`; Main rejects other CSS values, and the existing title-bar backdrop uses the accepted color with a resolved-scheme fallback, without a separator or vibrancy tint. The active mode reports a preference and resolved color scheme to the coordinator, which applies the preference to the hidden mode and resolves `system` through Electron. A surface created after authority exists receives that preference before its buffered initial report can be accepted.

Harness publishes `ThemeRuntime` snapshots through its trusted bridge. Chat's isolated preload reads and writes `__appKit_@deepseek/chat_themePreference` in the official version-zero envelope and reads the official body class and `data-ds-dark-theme` markers. A changed applied value reloads Chat so the website owns rendering; an unknown envelope reports an adapter error and leaves the rest of Chat usable. Before website initialization, a separate version-zero adapter changes only `__appKit_@deepseek/chat_lastSessionValue.value.siderCollapsed: true` to `false`, preserves sibling settings, and rejects unknown representations without writing them.

The shell opens before Host readiness. Host and Chat startup report independent states, and an unexpected Host exit fails only Harness. The selected mode is atomically stored under Electron's `userData` directory; it is presentation state rather than a Harness setting or Session event.

## Session and security

Chat uses the dedicated persistent partition `persist:dsh-deepseek-chat`; Harness uses its existing session. The Chat partition is never installed as `session.defaultSession`, so remote cookies and permission decisions do not leak into the loopback Host.

Every Chat renderer uses `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and `webSecurity: true`. The main Chat renderer loads only the isolated Chat preload; transient authentication windows load no preload. Permission checks and permission requests deny by default. Desktop grants no implicit access to notifications, location, camera, microphone, screen capture, MIDI, USB, serial devices, Bluetooth, or local fonts.

Desktop never reads Chat cookies, tokens, IndexedDB, service-worker state, conversation DOM, or network response bodies. The isolated preload accesses only the versioned theme preference, body theme markers, and retained sidebar field described above; it does not copy DeepSeek credentials or other storage into Harness settings. Clearing Chat data closes Chat and authentication renderers before clearing the partition's storage and cache.

## Navigation policy

The initial URL and only currently trusted origin are `https://chat.deepseek.com/` and `https://chat.deepseek.com`. The checked-in policy never trusts a wildcard such as `*.deepseek.com`. A new authentication origin requires an explicit code change, navigation tests, and a successful release smoke flow.

Top-level navigation, redirects, and new-window requests pass through one pure URL classifier. Chat-origin navigation remains in Chat. Chat-origin new windows use transient restricted windows that share `persist:dsh-deepseek-chat` and are disposed with the Chat mode.

An unrelated HTTPS new-window request opens in the system browser. An unrelated top-level HTTPS escape is cancelled and offered through the local shell. Untrusted redirects, HTTP, malformed URLs, and non-web protocols are blocked. Desktop never broadens the trusted set automatically to make a failed login pass.

A login method that requires another identity-provider origin remains unsupported until the release adds and verifies that exact flow. Opening it in the system browser does not establish authentication in the embedded partition by itself.

## Lifecycle and recovery

Closing the native window hides it while the tray owns application lifetime. Explicit quit joins Chat-view disposal and bounded Host shutdown before releasing Electron's quit sequence; Chat browsing data remains persistent.

Host startup failure, unexpected exit, or Harness renderer failure marks Harness unavailable while the shell and Chat remain usable. Harness retry creates a fresh supervised Host and accepts its view only after the readiness URL passes loopback validation.

Chat load failure, certificate error, unresponsive renderer, or renderer crash marks Chat unavailable without changing Harness. Chat retry creates a fresh WebContents in the persistent partition, and the shell offers the fixed official URL in the system browser.

## Privacy controls

The Chat menu provides **Reload Chat** and **Clear Chat Data**. Clearing requires confirmation, closes Chat-owned renderers, deletes local browsing data and cache, then recreates Chat when selected. It does not delete conversations or account data stored on DeepSeek servers.

The controller keeps a pending external URL only in the main process and sends the shell a Boolean offer state. Chat load errors omit the failing URL so authentication parameters do not enter status messages. Desktop code does not attach Chat screenshots, page content, headers, cookies, or response bodies to product telemetry.

Public distribution requires a separate review of DeepSeek's current service terms and branding rules. This technical decision grants no permission to redistribute or embed the website.

## Verification

Pure unit tests cover durable mode recovery, serialized transitions, view ownership, bounds, exact-origin classification, external-link routing, restricted WebPreferences, permission denial, authentication-window disposal, clear-data ordering, failure containment, retry behavior, shutdown races, and versioned sidebar-storage updates that preserve sibling settings.

The keyless Electron scenario starts the built production composition with separate local Harness and Chat HTTP servers. It verifies fresh-profile Harness selection, last-mode restoration across relaunch, direct pointer and keyboard segment selection, non-overlapping drag geometry, Chat action-menu bounds acknowledgement, Harness full-height bounds, Chat's single 44px title-bar inset and clickable top-left control, matching Chat page and title-bar backgrounds, retained Chat DOM and partition state, independent mode failures, partition clearing, active-mode theme authority, hidden disagreement correction, system-scheme changes, and hidden Chat reloads without contacting the live DeepSeek service. Packaging tests require the local shell, CSS, four CommonJS sandbox preloads, and staged Host entrypoints.

Presentation tests cover the full-height Harness URL markers and platform-specific title-bar treatment. Live DeepSeek compatibility, supported login methods, WAF behavior, and distribution permission remain release checks on macOS and Windows; deterministic CI does not claim those results.

## Alternatives considered

**Use a renderer `<webview>`.** Rejected because guest WebContents ownership, permission handling, navigation interception, and Electron compatibility would become renderer concerns. A main-process `WebContentsView` keeps remote content outside the Harness React tree and uses Electron's supported composition API.

**Open Chat in a second BrowserWindow.** Rejected as the primary experience because it behaves like two applications and does not provide the required single-window mode switch. Restricted transient authentication windows remain because they have a narrow lifecycle and share only the Chat partition.

**Embed Chat in an iframe.** Rejected because the website controls frame admission through response headers and an iframe does not provide the required session, navigation, popup, and permission isolation.

**Call undocumented DeepSeek Chat APIs or automate its DOM.** Rejected because that would capture private implementation details, create credential-handling obligations, and turn remote releases into integration failures. Desktop displays the official website without extracting its internals.

**Click the official sidebar control after load.** Rejected because the control's DOM structure, translated label, render timing, and animation state are private and unstable. The versioned storage adapter applies the official startup field before rendering and fails closed when that representation changes.

**Unify Chat and Harness history.** Rejected because the products have different data owners, capabilities, and persistence semantics. Future interoperability requires a supported DeepSeek API and an explicit user-controlled transfer format.

## Consequences

Users gain one-window access, retained Chat state, explicit local-data control, and failure isolation without changing Harness model behavior. The browser fallback limits user impact when the live service rejects or breaks embedding.

Keeping two renderer processes alive increases memory and GPU use. Lazy Chat creation avoids startup cost, while retained page state deliberately trades memory for fast switching.

Persistent browsing data remains sensitive even though Desktop never reads it. A shared OS account can retain the authenticated session until the user signs out or clears Chat data, and platform credential storage depends on the host keyring.

Exact-origin trust may lag a legitimate authentication change and block login. Wildcard trust would reduce interruptions but weaken navigation isolation, so releases update and test exact origins instead.

Local fixtures prove Desktop policy and lifecycle behavior, not compatibility with the live service. A passing platform smoke test also cannot guarantee compatibility with a later remote deployment, and public distribution remains blocked until the terms and branding review is recorded.

Theme synchronization depends on the official version-zero theme envelope and body markers, while the expanded startup default depends on the official version-zero retained sidebar field. A website release that changes one representation leaves Chat usable, preserves unknown storage, and reports the affected adapter incompatibility for release diagnosis.
