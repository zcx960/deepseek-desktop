# Changelog

## 1.0.3 - 2026-08-28

- Fixed Windows workspace directory selection under the Electron runtime by using koffi's direct UTF-16 decoder when available.
- Kept the bounded memory-view fallback for older koffi versions.
- Added regression coverage for both decoder paths.
