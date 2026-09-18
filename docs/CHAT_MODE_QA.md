# Chat mode verification — 2026-09-18

## Environment

macOS 26.5.2, Apple Silicon; Tauri 2.11.5 / wry 0.55.1; Node 26.8.1; pnpm 11.7.0; Rust 1.96.0. Base commit: `bd4da3aee51d65061001857e4234a8942ceca6ff`.

## Automated checks

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm build:plugins` | Passed; 10 bundled plugins staged |
| `pnpm typecheck` | Passed |
| `pnpm exec vitest run test/desktop-mode.test.ts` | 9 passed |
| `TMPDIR=/private/tmp pnpm exec vitest run` | 72 files, 616 passed |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Passed |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 575 passed |
| Targeted ESLint over changed frontend files and new tests | Passed |
| `rustfmt --edition 2021 --check` over the three new Chat Rust modules | Passed |
| Production frontend fixture exclusion | Passed; no smoke URL or fixture module in the five production JS/HTML assets |
| `pnpm tauri build --bundles app --no-sign` | Passed; macOS application bundle created |
| `git diff --check` | Passed |

The initial frontend full-suite run used the system `/var/folders` temporary path; two existing Worktree tests failed because Git canonicalized it to `/private/var/folders`. Using the canonical `/private/tmp` resolved both failures. No Worktree implementation or tests were changed.

Release builds retain upstream warnings for debug-only patch code and the transitive `block` crate. Those warnings did not fail compilation or packaging.

## Native macOS scenarios

All scenarios used the actual Tauri app and child WKWebView, with the local fixture except where noted.

| Scenario | Observed result |
| --- | --- |
| Switch Harness → Chat → Harness | Harness draft remained `Harness draft retained` |
| Switch Chat → Harness → Chat | Chat draft remained `Chat draft retained` |
| Storage isolation | Harness and Chat showed different persistent profile identifiers for the same fixture origin |
| Restart while Chat selected | Chat selected automatically; Chat profile identifier remained `4247bd47-7cb4-4676-8fe5-79f91527d474` |
| Remote application command | `get_app_config` rejected |
| Remote Chat control command | `desktop_chat_clear` rejected |
| Remote Store plugin command | `plugin:store|load` rejected |
| Settings over Chat | Cmd+, opened the local settings; Escape restored Chat with its draft intact |
| Fullscreen | Mode switch remained visible; child page filled the content area below it |
| Cancel clear | Chat profile and draft remained unchanged |
| Confirm clear | New Chat profile identifier `ec0920f8-fa7b-49f7-8c92-377cbe9b5032` after first successful clear |
| Repeat clear | Completed successfully a second time |
| Harness after Chat clear | Profile remained `090e4226-edb5-4346-a2c4-dddc5b231240`; draft remained `Keep Harness through Chat clear` |
| Official website | `https://chat.deepseek.com/sign_in` loaded in the native child view, with phone/code/password login controls |

The first clear implementation tried removing the WebKit store after closing the view. Real native testing returned `data store is currently opened`; wry 0.55 retains the underlying WKWebView after close. The implementation now blanks all live Chat documents, waits for navigation completion, closes them, waits for WebKit's data-clearing callback, and advances the profile generation. The successful clear scenarios above were rerun after that fix.

## Artifact

Application: `src-tauri/target/release/bundle/macos/DeepSeek Desktop Chat.app` (approximately 29 MiB of file contents). The build is unsigned and has not been notarized. Application identifier: `io.github.deepseek-desktop.chat`. Version: `0.15.4-chat.1`.

Main executable SHA-256: `49521a5c48a4127b283e4bafff05ce452c28d3f130c2f0b62274c5f0d02a24a8`.

## Validation limits

No account credentials were entered or messages sent to DeepSeek. Login persistence was exercised with the fixture's persistent WebView storage, not a signed-in real account. Windows and Linux native WebView behavior was not exercised on this macOS host. Cross-origin authentication popups are sent to the browser and are not integrated with the embedded session.
