<h1 align="center">DSH Desktop</h1>

<p align="center">
  A local-first, cross-platform desktop app for
  <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a>.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh.md">简体中文</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-171513.svg" /></a>
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple%20Silicon%20%7C%20Intel-171513.svg" />
  <img alt="Windows" src="https://img.shields.io/badge/Windows-x64-171513.svg" />
</p>

> [!NOTE]
> **This is a derived build.** It is a secondary development of
> [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop), the
> community desktop shell for DeepSeek Harness. All of the desktop host
> capabilities described below come from that project; this repository adds the
> Chat mode described in [What this build adds](#what-this-build-adds) and
> applies DeepSeek's official brand mark throughout.
> See [Relationship to upstream](#relationship-to-upstream).

DSH Desktop packages the local DeepSeek Harness experience as an installed desktop application. It starts Harness automatically, keeps profiles, plugins, workspaces, model settings, and sessions outside the application directory, and opens the full Harness interface as soon as the local runtime is ready.

> [!IMPORTANT]
> This build tracks the rapidly evolving `@deepseek-ai/dsh@0.1.5-rc.2`, so treat it as an early preview. macOS releases are code-signed and notarized by Apple. Windows x64 installers are code-signed; Windows security warnings may still decrease gradually as the publisher builds download and installation reputation.

## Relationship to upstream

This repository is not an independent product. It takes
[dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) as its base
and changes two things:

| Area | Upstream | Here |
| --- | --- | --- |
| Brand | Its own whale mark, sidebar artwork, splash loaders, and app icon | DeepSeek's official mark, taken from `@deepseek-ai/dsh-client-ui-primitives` |
| Modes | Harness only | Harness plus an embedded DeepSeek Chat mode |

Everything else — the runtime supervisor, profile and plugin maintenance, Safe
Mode, phone access, the PPT runtime, presets, and the update flow — is upstream
work, carried here unchanged apart from the branding above. Bug reports about
those subsystems belong upstream; report Chat mode and branding issues here.

The upstream README, its translations, its screenshots, and its community
invitations have been removed from this repository because they describe a
different product.

## What this build adds

**Chat mode.** A second top-level surface that embeds the official DeepSeek Chat
website alongside Harness, reachable from a selector in the title bar:

- Chat runs in its own persistent Electron partition, so its login and browsing
  data never touch the Harness profile.
- Harness keeps running underneath while Chat is on screen, so sessions,
  background jobs, and in-flight tool calls survive the switch. Returning to
  Harness needs no reload.
- Navigation is restricted to the exact Chat origin; other links open in the
  system browser.
- The shared theme preference follows whichever mode is on screen, and the
  window chrome and selector follow the resolved scheme.

**Official branding.** The application icon, splash animation, sidebar mark, and
conversation hero all use DeepSeek's official mark rather than the upstream
project's own artwork.

## Download

Installed builds check for updates shortly after startup and every six hours. When a new version is available, DSH Desktop asks before downloading it; installation begins only after you choose **Restart and install**. You can also check manually from the application menu or skip one version without hiding future releases.

Stock installers live under the [upstream Releases](https://github.com/dataelement/dsh-desktop/releases). This repository does not publish installers yet, so build from source with the [development guide](docs/development.md). An upstream version marked **Pre-release** closely tracks the latest official DeepSeek Harness and may be incompatible with community plugins.

## What DSH Desktop adds

DeepSeek Harness already provides the Agent runtime and Web UI. DSH Desktop adds the native host capabilities needed for a practical desktop product:

- Starts and stops Harness without requiring a separate CLI or browser tab
- Uses the native system directory picker to add and manage project workspaces
- Supports official DeepSeek models and mainstream third-party model providers
- Imports and exports complete custom Agent presets as portable [`.dshpreset` packages](docs/preset-packages.md), with conflict checks and a trust warning before installation
- Turns source material into editable PPTX decks through the built-in PPT mode
- Preserves profiles, plugins, workspaces, sessions, and model settings across app upgrades
- Detects startup and frontend plugin failures, keeps diagnostics in `harness.log`, and offers guided recovery actions
- Provides a non-destructive Safe Mode that temporarily blocks third-party plugins
- Lets a paired phone continue sessions over the local network or an optional temporary public tunnel
- Checks for desktop updates and keeps download and installation under user control
- Adapts native menus, titlebar behavior, window focus, theme, and application branding for macOS and Windows

## PPT generation

Enable the **PPT** button, choose a template, and describe the deck you need. The built-in catalog includes **16 templates and 192 layouts** with editable PPTX output. Previews use English; decks can use English or Chinese, with corresponding font settings. Preview language does not determine output language.

PPT is preinstalled, and its automatic instructions apply only to sessions where the PPT button is enabled. See the [PPT runtime guide](packages/ppt-runtime/README.md) for templates, validation, and source acknowledgments.

## Phone access

Choose **Connect Phone…** from the `Harness` menu and scan the pairing code. The desktop asks you to approve the connection before the phone can access sessions.

Harness itself remains on a random `127.0.0.1` port. Phone access uses a separate paired bridge. It can stay on the local network or, when you choose remote access, use a temporary Cloudflare Quick Tunnel. Disconnecting the phone from the desktop invalidates the mobile session.

If Cloudflare fails to start, the app tries Pinggy. If a Cloudflare pairing link appears but your phone cannot open it, choose **Can’t open? Try another link** to switch to Pinggy.

## Safe Mode and recovery

If a third-party plugin interferes with startup or rendering, DSH Desktop can identify the implicated plugin from runtime and frontend evidence and open a guided recovery surface.

Choose **Restart as Safe Mode…** from the `Harness` menu to start an isolated profile containing only official core bundles. The Agent, sessions, model settings, and workspaces remain available while third-party plugins from the normal profile stay blocked. You can remove selected plugins or return to a normal launch from the Safe Mode banner.

Recovery screens check for compatible plugin updates. When available, you can upgrade an affected plugin; Safe Mode also offers batch upgrades.

If the normal interface cannot be reached, start DSH Desktop with `--safe-mode`. On macOS:

```sh
open -a "DSH Desktop" --args --safe-mode
```

## Local data and security

- The Harness Web UI is served only on a random loopback port.
- The renderer has no Node.js privileges and uses context isolation and sandboxing.
- Webviews, untrusted in-app navigation, and unexpected permission requests are blocked.
- External web links open in the system browser.
- User profiles and sessions live under Electron's per-user application data directory, not inside the installed app.
- Phone access requires a short-lived pairing token and explicit desktop approval.
- DeepSeek Chat runs in its own persistent partition, separate from the Harness profile.

## Platform support

| Platform | Distribution | Status |
| --- | --- | --- |
| macOS Apple Silicon | Signed and notarized DMG/ZIP | Supported |
| macOS Intel | Signed and notarized DMG/ZIP | Supported |
| Windows x64 | Code-signed NSIS installer | Supported |
| Windows ARM64 | — | Not currently supported |
| Linux | — | Not currently supported |

Harness includes target-native dependencies, so every release artifact is built on the matching operating system and architecture.

## Development and architecture

Start with the engineering documentation inherited from upstream:

- [Development guide](docs/development.md) — setup, validation, patch maintenance, and target-native packaging
- [Architecture](docs/architecture.md) — runtime flow, persistent data, security boundaries, recovery, mobile access, and updates
- [Release runbook](docs/release-runbook.md) — signing and publication controls
- [Preset package format](docs/preset-packages.md) — portable Agent preset contract

Before submitting a change, run `npm test`, `npm run typecheck`, and `npm run build`, then exercise the affected real application flow. Never include real API keys in issues, logs, screenshots, or test data.

## License

This build is open source under the [MIT License](LICENSE), the same license as
the [upstream project](https://github.com/dataelement/dsh-desktop) it derives
from.

DeepSeek Harness and its dependencies remain subject to their respective upstream
licenses and trademark policies. The DeepSeek marks used for application
branding belong to DeepSeek and are used here to identify the product this
desktop shell hosts.
