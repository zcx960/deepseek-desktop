# Desktop title-bar mode selector design QA

## Evidence

- Reference hierarchy: `/var/folders/cb/nzn8t2652rg86pspw5pj3wg00000gn/T/codex-clipboard-71477821-fedd-4acb-a69e-8d574db4691a.png`.
- Reported overlap and theme state: `/var/folders/cb/nzn8t2652rg86pspw5pj3wg00000gn/T/codex-clipboard-2eb693c4-9cef-4bf5-b569-cd304bd8aaa6.png`.
- Electron captures: `apps/desktop/output/playwright/desktop-titlebar-mode/harness-light-expanded.png`, `harness-dark-expanded.png`, `harness-dark-menu.png`, `chat-dark-expanded.png`, `chat-light-collapsed.png`, and `chat-light-collapsed-menu.png`.
- Expanded captures use a 1440 x 861 CSS content viewport at device scale factor 2. Minimum-width captures use 980 x 720 at device scale factor 2.

## Layout

Closed macOS chrome is positioned at x 88 and y 4, immediately after the native traffic-light area. Harness uses an 88 x 36 rectangle; Chat uses a 176 x 36 rectangle for the selector and overflow action. Windows and other platforms use x 12 and the same 36px control height.

Harness keeps the complete content bounds. Chat begins at y 44 on every supported platform, directly below the operating-system title bar. The Electron scenario places its official-control fixture below that content origin, verifies the closed chrome rectangle ends above it, clicks the control, and observes the click in the main-process fixture state.

The local shell owns the existing 44px draggable title bar. The mode chrome owns only the selector, menus, actions, and confirmation dialog. No closed view spans the window, no second horizontal row appears, and Harness retains its original full-height layout.

## Selector

The selector renders `Harness` or `DeepSeek Chat` plus a downward chevron with transparent background and zero border in resting, hover, and open states. It contains no product mark or compact abbreviation. Electron assertions compare each label's scroll width and client width, so the complete text and chevron remain visible at minimum window width.

Menus begin below the 36px title-bar control after the main process expands the native view and acknowledges the applied bounds. Settled light and dark captures show opaque menu surfaces, readable primary and secondary text, visible selection marks, stable padding, and no clipped rows. Closing hides menu content before the view returns to its tight bounds.

## Theme

The selected mode supplies the shared `light`/`dark`/`system` preference. Captures and computed-color assertions show dark text in light mode and light text in dark mode. The Electron scenario verifies Harness-to-Chat propagation, Chat-to-Harness propagation, operating-system changes while using `system`, correction of a hidden conflicting Chat report, hidden Chat reload, and shared preference restoration after Chat data clearing.

The Chat fixture content begins below the operating-system title bar and uses the propagated scheme in both desktop and minimum-width captures. No light Chat content remains under a dark shared preference, and local controls match the active scheme.

## Scope

The fixture proves local composition, geometry, acknowledged menu expansion, real pointer mode selection, theme authority, reload behavior, and pointer access to Chat controls without contacting DeepSeek. The composed screenshots do not include native traffic lights, while unit geometry fixes the macOS selector origin at x 88 and the BrowserWindow keeps traffic lights at x 16. Compatibility with the live website's theme storage, body markers, authentication, WAF, and remote layout remains a macOS and Windows release smoke requirement.

No actionable P0, P1, or P2 visual findings remain in the captured states.

final result: passed
