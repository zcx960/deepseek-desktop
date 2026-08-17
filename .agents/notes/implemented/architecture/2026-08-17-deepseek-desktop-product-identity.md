# Agent Note: DeepSeek Desktop product identity

Status: implemented

English | [中文](2026-08-17-deepseek-desktop-product-identity.zh.md)

## Problem

The native application combines the official DeepSeek Chat website with the local Harness workspace, so naming the whole desktop product after only the Harness mode is misleading.

## Decision

The public desktop product identity is **DeepSeek Desktop**. Electron window and tray titles, the shell document titles, the packaged product name, README headings, release title, and the GitHub repository use that name. **Chat** and **Harness** remain the two mode names, and Harness remains the upstream runtime and technical architecture name.

The existing Electron `appId` `ai.deepseek.harness.desktop` remains stable so installed releases retain their application identity across the product rename. Internal package names, protocol channels, filesystem keys, and upstream Harness documentation remain unchanged.

## Alternatives considered

**Keep DeepSeek Harness Desktop as the public name.** Rejected because it describes the local mode rather than the combined Chat and Harness product.

**Rename every Harness package and protocol identifier.** Rejected because those identifiers describe the upstream runtime and would add compatibility churn without improving the user-facing product name.

**Change the Electron `appId` to remove `harness`.** Rejected because the identifier is not user-visible and changing it could make existing installations behave as a different application during updates.

## Consequences

Users see DeepSeek Desktop in the native window, tray, installers, README, and GitHub Releases, while Harness remains clear as the local agent mode. The macOS application directory and executable names change to `DeepSeek Desktop.app` and `DeepSeek Desktop`; packaging and process tests pin those names. The stable `appId` preserves the existing application identity, but the renamed product must still be treated as a new public brand in screenshots, links, and release copy.
