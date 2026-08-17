# DeepSeek Harness Desktop

English | [中文](README.zh.md)

DeepSeek Harness Desktop brings the local DeepSeek Harness Web UI and the official [DeepSeek Chat](https://chat.deepseek.com/) website into one native desktop window. Use the title-bar switch to move between **Chat** and **Harness** without merging their accounts, conversations, credentials, or storage.

> This is a community desktop project built on DeepSeek Harness. It is not an official DeepSeek product and does not bypass the official website's login, WAF, or embedding policies.

## Screenshots

### Chat mode

The Chat mode opens the official DeepSeek Chat page in an isolated, persistent browser partition. The screenshot shows the signed-out entry page; users can sign in through the website's own interface.

![DeepSeek Chat mode](assets/screenshots/chat-mode-home.png)

### Harness mode

Harness mode runs the local Web UI with its workspace sidebar and agent composer.

![DeepSeek Harness mode](assets/screenshots/harness-mode-home.png)

## Highlights

- **Two modes in one window.** Chat and Harness are independent retained views selected from the native title bar.
- **Official Chat embedding.** Chat loads `https://chat.deepseek.com/` directly, keeps authentication in its own Electron partition, and never becomes a Harness model provider.
- **Local Harness runtime.** Harness starts and supervises the local Host, Web UI, sessions, workspaces, tools, and agent configuration.
- **State that stays separate.** The modes do not share cookies, credentials, conversations, attachments, prompts, or navigation state.
- **Theme synchronization.** Light, dark, and system preferences stay synchronized across both modes while each renderer keeps its own page implementation.
- **Native desktop behavior.** macOS and Windows use platform-aware title-bar controls; macOS sidebar geometry avoids overlapping the mode switch.
- **MIT licensed.** The repository includes the MIT license. Third-party packages keep their own license notices.

## Platform support

The current desktop composition targets:

- macOS Apple Silicon (`arm64`), tested locally.
- Windows (`x64`), packaged through the Electron Builder configuration.

Linux remains available for the underlying Harness Web UI, but the native desktop packaging path is not currently a release target.

## Requirements

- Node.js `^22.19.0` or `>=24.0.0`
- pnpm `11.7.0`
- A DeepSeek API key for Harness model requests when the selected profile requires one.
- A supported desktop host for Electron development or packaging.

<a id="run"></a>

## Run from source

```sh
pnpm install
pnpm run dev:desktop
```

The development command builds the required Host, client, Web, and Electron layers before opening the desktop app. The first Chat selection opens the official website, where the user completes login if needed.

## Build a desktop artifact

```sh
pnpm run package:desktop
```

The packaging command builds the application, stages the Host runtime dependency tree, and creates an unpacked application for the current platform. Signed macOS distribution requires the release credentials described in [the desktop release guide](apps/desktop/README.md#signed-macos-dmg).

## Repository layout

```text
apps/desktop/       Electron application, native shell, and dual-mode controller
apps/web/           Harness Web frontend
packages/           Harness and client plugin workspaces
assets/screenshots/ README screenshots
docs/               Architecture, testing, and contributor documentation
vendor/             Pinned Cordis source
```

The core Harness architecture and plugin contracts remain owned by the upstream [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) project. This repository adds the desktop composition and its platform integration.

## Contributing

Read [AGENTS.md](AGENTS.md) and [the development guide](docs/development.md) before changing the repository. Focused checks for the desktop surface include:

```sh
pnpm --filter @deepseek-ai/dsh-desktop run typecheck
pnpm --filter @deepseek-ai/dsh-desktop run test:electron
pnpm run build:desktop
```

Please do not commit generated `lib/`, `dist/`, `runtime-host/`, `node_modules/`, or Playwright output directories.

## License

This project is released under the [MIT License](LICENSE).

DeepSeek and DeepSeek Chat are trademarks and services of their respective owners. Embedding the official website remains subject to its current terms and technical policies.
