# Agent Note: Tag-driven desktop GitHub releases

Status: implemented

English | [中文](2026-08-17-tag-driven-desktop-github-releases.zh.md)

## Problem

The desktop application had local packaging commands but no repository workflow that produced downloadable macOS and Windows applications. The existing release workflows publish npm, Python, vendored, and native package families; extending one of them would couple desktop artifacts to a different version line and publication destination.

A desktop release also needs platform-native runtime staging. Building both platforms on one host can package the Electron shell, but it does not prove that the staged Host dependency tree matches the target operating system and architecture.

## Decision

`.github/workflows/desktop-release.yml` owns desktop GitHub Releases. A pushed `vX.Y.Z` tag starts one native macOS Apple Silicon job and one native Windows x64 job. Each job performs an immutable install, confirms that the tag matches `apps/desktop/package.json`, confirms the runner architecture, builds the repository, stages the Host runtime, and asks Electron Builder for distributable files.

The macOS job produces unsigned DMG and ZIP files. The Windows job produces unsigned NSIS and ZIP files. Each job uploads only those distributable formats; unpacked directories and update metadata do not enter the Release. The Release job receives `contents: write` while build jobs retain read-only repository access, waits for both builds, and creates the tagged GitHub Release. A rerun uploads the same filenames with `--clobber` instead of creating another Release.

The desktop package carries its own `1.0.0` application version. It does not change the shared pre-release version of the Harness npm family, whose `dsh-v*` tags and registry publication remain independent.

The workflow explicitly disables macOS signing and notarization because the public repository has no distribution credentials. The credential-validated local macOS command remains the path for a signed and notarized DMG.

## Alternatives considered

**Build both platforms on one runner.** Electron Builder can cross-package some targets, but the staged runtime contains platform-selected dependencies. Native runners keep installation, staging, and packaging on the same operating system and architecture.

**Publish only unpacked application directories.** Directories are useful for local verification but inconvenient GitHub Release downloads. DMG, NSIS, and ZIP cover installation and portable inspection without committing generated output.

**Require signing before the first public release.** No Apple or Windows signing credentials are configured. Failing the workflow until credentials exist would provide no downloadable release; silently attempting signing could produce inconsistent results. The artifacts are explicitly unsigned and the documentation states that limitation.

## Consequences

A tag and the desktop package version must agree before either platform builds. Failure on either platform prevents Release creation, so a published Release always contains both supported desktop targets. Users may encounter operating-system warnings because the artifacts are unsigned. Adding Windows signing or automated Apple signing requires a separate credential and trust decision rather than widening build-job permissions.
