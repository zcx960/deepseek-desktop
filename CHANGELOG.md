# Changelog

## 1.0.4 - 2026-08-28

- Rebuilt the desktop release with the synchronized `sharp` lockfile entry so frozen CI installs succeed on macOS and Windows.

## 1.0.3 - 2026-08-28

- Fixed Windows workspace directory selection under the Electron runtime by using koffi's direct UTF-16 decoder when available.
- Kept the bounded memory-view fallback for older koffi versions.
- Added regression coverage for both decoder paths.
