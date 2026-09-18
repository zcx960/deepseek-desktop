# DeepSeek Desktop Chat

[简体中文](README.md) · [Downloads](https://github.com/zcx960/deepseek-desktop/releases) · [GitHub Actions](https://github.com/zcx960/deepseek-desktop/actions/workflows/build-chat.yml)

Use **Harness** and the **official DeepSeek Chat website** in one desktop window. Switch in the top bar while both pages and their unfinished input remain open.

This project rebuilds the desktop app on the Tauri 2 + React implementation from [dsh-tauri/deepseek-harness-desktop](https://github.com/dsh-tauri/deepseek-harness-desktop), based on commit `bd4da3aee51d65061001857e4234a8942ceca6ff`. The current version is `0.15.4-chat.1`, named **DeepSeek Desktop Chat**. It is a community derivative, not an official DeepSeek desktop client.

## Features

- **Harness / Chat switch:** retain Harness core, profiles, plugins, and sessions alongside `https://chat.deepseek.com/`.
- **Separate persistent storage:** Chat login data is independent of Harness API keys, sessions, and settings.
- **Last-mode restoration:** reopen the last selected mode after restarting.
- **Chat controls:** reload, open in the browser, and clear local Chat data after confirmation.
- **Independent failure handling:** retry Chat or use the browser while Harness remains accessible.
- **Restricted access:** Chat receives no Tauri command permissions; links to other HTTP(S) sites open in the system browser.

Clearing Chat data signs out every Chat window and clears local cookies, cache, and website storage. It does not delete online conversations or Harness data.

## Download and run

Choose a **DeepSeek Desktop Chat** pre-release with a `chat-build-` tag from this repository's [Releases](https://github.com/zcx960/deepseek-desktop/releases). Earlier `v0.2.0` downloads belong to the previous Electron implementation.

| Platform | Installer | Requirements |
| --- | --- | --- |
| macOS Apple Silicon | `.dmg` with `aarch64-apple-darwin` in its name | Embedded Chat requires macOS 14+ |
| macOS Intel | `.dmg` with `x86_64-apple-darwin` in its name | Embedded Chat requires macOS 14+ |
| Windows x64 | `.exe` (NSIS) or `.msi` | Windows 10+, WebView2 |
| Linux x64 | `.AppImage` or `.deb` | Built on Ubuntu 22.04 |

Install and launch the app, select **Chat**, and sign in with your DeepSeek account. Chat uses the website account, not the Harness API key. Harness starts its local runtime as usual; initial runtime setup, Chat, and remote model requests require network access.

Installers are unsigned and macOS builds are not notarized, so the operating system may show a developer verification warning. Desktop updates are manual to prevent the upstream installer from replacing Chat mode. Harness core updates remain available in the app. Each build includes `SHA256SUMS-*.txt` and `build-info-*.json` identifying the installer hashes and source commit.

## Limitations

- Older macOS versions retain Harness and the browser fallback; embedded persistent Chat requires macOS 14+.
- Cross-origin authentication popups open in the system browser. Browser sign-in state is not imported into the app. Website changes or embedded-browser restrictions may affect login.
- Native switching, retained drafts, isolated storage, clearing, settings overlays, fullscreen, and the official login page were checked on Apple Silicon. No real account login or message submission was performed.
- Successful GitHub Actions packaging does not verify each platform's native interactions. See the [verification record](docs/CHAT_MODE_QA.md).

The new app uses the separate identifier `io.github.deepseek-desktop.chat`. It does not automatically migrate desktop settings or Chat login data from the previous Electron app. Harness follows the base project's `~/.dsh` profile rules. The earlier implementation remains in Git history.

## Development

Use Node.js 24+, the pnpm version declared by this project, Rust stable, and the platform's Tauri build dependencies.

```sh
git clone https://github.com/zcx960/deepseek-desktop.git
cd deepseek-desktop
pnpm install --frozen-lockfile
pnpm build:plugins
pnpm dev:desktop
```

```sh
pnpm typecheck
pnpm exec vitest run
node --test scripts/collect-chat-artifacts.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib
pnpm tauri build --no-sign
```

On macOS use `TMPDIR=/private/tmp pnpm exec vitest run` for the full suite to avoid Git/Node differences in resolving the system temporary-directory symlink. See [Chat development notes](docs/CHAT_MODE.md) for architecture, storage, and the local native smoke fixture.

## Build with GitHub Actions

Open [Build Chat installers](https://github.com/zcx960/deepseek-desktop/actions/workflows/build-chat.yml) and select **Run workflow**:

1. Choose a branch; `main` is the default.
2. Enable `publish_release` to publish a pre-release. Publishing is restricted to `main`.
3. The workflow runs type checking and tests before building both macOS architectures, Windows x64, and Linux x64 in parallel.
4. It publishes only after all four platform builds succeed. Build-only downloads appear under the run's **Artifacts**, retained for 30 days.

No Apple or Windows signing credentials are required. Builds use the dependency lockfiles and record their source commit. Releases use independent `chat-build-<run number>` tags. The inherited upstream signed-release pipeline does not run in this repository.

## Upstream and license

The Tauri shell, Harness installation and process management, and bundled plugins come from [deepseek-harness-desktop](https://github.com/dsh-tauri/deepseek-harness-desktop). The Agent core comes from [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). This repository adds Chat mode and a separate build and release workflow.

The upstream [MIT license](LICENSE), [Non-Commercial Secondary Development condition](LICENSE.details), and copyright notices are retained.
