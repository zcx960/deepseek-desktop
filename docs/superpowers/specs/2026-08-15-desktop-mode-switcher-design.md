# Desktop mode switcher design

English | [中文](2026-08-15-desktop-mode-switcher-design.zh.md)

## Scope

The desktop application presents `DeepSeek Chat` and `Harness` as two selectable experiences in one window. The mode selector lives in the existing operating-system title bar: immediately after the macOS traffic lights and at the left edge of the Windows title bar. It does not add an application-owned header or full-width toolbar.

The two modes retain separate authentication, conversation storage, navigation, and page state. Theme preference is the only product preference synchronized between them. Selecting a mode otherwise changes visibility without copying or translating page data.

## User experience

The mode control is a compact two-segment switch labeled `Chat` on the left and `Harness` on the right. Both segments have equal width, and selecting either segment changes modes directly without opening a menu. The control has no chevron or product mark. A shallow theme-matched track and a sliding highlight identify the selected segment without drawing an outer border.

The switch is 164px wide and 32px high at every supported window width. Labels never collapse to icons or abbreviations. Light mode uses dark text and a light selected highlight; dark mode uses light text and a dark selected highlight. Hover, pressed, and keyboard focus states remain readable without resizing the control or moving surrounding title-bar content.

The switch uses `radiogroup` and `radio` semantics with `aria-checked` on both segments. `Tab` focuses the group, `Left` and `Right` select the adjacent mode, and `Home` and `End` select the first and last mode. Pointer input on either label selects that mode immediately.

Chat-only reload and clear-data actions remain in a separate 32px overflow control to the right of the switch. That menu closes after a command, on outside pointer input, or on `Escape`.

The switch is window chrome rather than a control inside either product's navigation stack. Harness retains its existing internal title-bar accommodation. Chat receives only the operating-system title-bar inset, so the official page begins immediately below that row with its original sidebar and header layout. No additional full-width separator, toolbar, or blank header occupies product content.

## Window layering and geometry

The local Electron shell retains responsibility for IPC, mode status, retry actions, failure messages, the title-bar backdrop, and the unused draggable portion of the operating-system title bar. Harness continues to use the full window content bounds because its own layout already accommodates that title bar. Chat content begins below the 44px title-bar height and uses all remaining window space; it has no second inset for the mode switch.

A transparent local mode-chrome WebContentsView is placed above both content views. In Harness it tightly matches the 164px switch; in Chat it also includes the 4px gap and 32px overflow control. It expands downward only for the Chat action menu and covers the full window only for the modal clear-data dialog. Closed transparent native pixels never sit over Harness or official Chat controls.

On macOS the control begins at x=88, immediately to the right of the traffic-light group. On Windows it begins at x=12 while native caption controls remain at the right. It begins at y=6 and is vertically centered in the 44px title bar. Resizing recalculates the control and Chat-menu bounds without changing labels, widening the visible switch, or clipping the menu.

The shell drag region starts after the maximum title-bar control span: x=300 on macOS and x=224 on Windows. Its native hit-test rectangle never overlaps the switch or Chat overflow control. The mode chrome marks only its actual interactive controls as non-draggable. This geometry is an invariant shared by CSS, Electron bounds calculation, and tests, preventing the shell drag layer from intercepting native pointer input intended for the switch.

The switch does not require an expanded geometry state: either segment sends the selected mode directly through the closed IPC command. Opening the Chat action menu remains an acknowledged geometry transition. The renderer requests the expanded state, the main process resizes the WebContentsView and returns the applied state, and the renderer reveals the menu only after that acknowledgement. Closing hides the menu before returning the view to its tight bounds. Blur, `Escape`, a command, and stale acknowledgements cannot leave an invisible expanded view above product content.

The 44px title-bar backdrop is part of the existing operating-system title bar, not an additional application row. In Chat mode it follows Chat's resolved light or dark scheme and uses the corresponding page background color without a separator, transparency, or vibrancy tint. The page and title bar therefore read as one continuous surface. Harness keeps its existing title-bar composition.

The shell document remains behind the content views for loading and failure states. When the selected view is ready, its content covers the applicable content region. When loading or failed, the shell status region is visible while the mode selector remains interactive.

## Shared theme preference

The synchronized preference has the values `light`, `dark`, and `system`. The desktop theme coordinator stores the current preference and resolved light/dark scheme in memory. The active mode is authoritative: a preference change reported by the visible mode updates the coordinator and is sent to the hidden mode. Reports from the hidden mode are acknowledgements and cannot overwrite the active preference.

At startup, the initially selected mode supplies the authoritative preference after its bridge is ready. The other mode adopts that value before it becomes visible. If the two persisted page preferences differ, this rule resolves the conflict without timestamps or another durable theme store. When the shared preference is `system`, operating-system changes update both renderers and the local chrome without changing the persisted preference.

The mode switch, Chat overflow control, and title-bar backdrop follow the coordinator's resolved scheme. Light uses dark text; dark uses light text. The switch highlight, Chat menu, and dialog use opaque themed surfaces because their text must remain readable above arbitrary content.

## Harness theme bridge

Harness uses an owned desktop bridge attached only to the loopback desktop renderer. The bridge publishes the `ThemeRuntime` preference and resolved scheme, accepts one validated shared preference, and applies it through `ThemeRuntime.setTheme()`. Normal Harness persistence remains owned by the Host-backed theme settings scope.

Electron exposes only the closed theme operations required by the Harness client. The bridge does not expose Electron primitives, filesystem access, or generic IPC. Browser use outside the desktop marker remains unchanged.

The existing `meta[name="theme-color"]` event remains a compositing signal and fallback diagnostic; it is not the synchronization protocol because it carries only a resolved color and cannot distinguish `system` from a concrete preference.

## Chat theme adapter

DeepSeek Chat has no public desktop theme API. The isolated Chat preload therefore owns a versioned private adapter for the official page's current theme representation. It reads and writes only the `__appKit_@deepseek/chat_themePreference` storage entry with the validated `{ value, __version: "0" }` envelope, observes the page's `light`/`dark` body state to confirm the resolved scheme, and normalizes one opaque computed background from the page top or roots to canonical `#rrggbb` for the existing title-bar backdrop. Main rejects transparent, malformed, and arbitrary CSS values. The adapter never reads account, conversation, draft, token, message, or other page-content data.

## Chat startup sidebar state

Official Chat retains its sidebar choice in the version-zero `__appKit_@deepseek/chat_lastSessionValue` entry. Before each Chat document initializes, the isolated preload changes only `value.siderCollapsed: true` to `false` and preserves every sibling setting. A missing entry keeps the website's expanded default, while an unknown version or representation remains untouched and reports an adapter diagnostic. This applies a startup default rather than continuous enforcement: after the document loads, a user can collapse the sidebar and the retained view keeps that state across mode switches. The preload never locates or clicks a remote DOM control.

When Chat is active, an official theme change is reported to the desktop coordinator and applied to hidden Harness through its owned bridge. When Harness is active, a changed preference is written to hidden Chat; Chat reloads while hidden so its own application state and settings UI adopt the same preference before the next mode switch. The adapter never reloads visible Chat in response to a hidden-mode report.

The Chat preload does not expose IPC or a context-bridge object to the remote page. It validates the expected storage envelope and page markers before accepting or applying a preference. An unknown storage version, missing theme marker, or rejected update disables Chat synchronization for that renderer and reports one diagnostic. Chat authentication, navigation, conversations, and ordinary theme controls continue to work under website ownership.

## State and lifecycle

Harness remains the initial mode when no persisted mode selection exists. The selected mode is persisted through the existing desktop state file and restored on the next launch. Theme persistence remains in each product's existing preference owner; the coordinator only resolves the active-session synchronization order.

The controller continues to create Chat lazily, retain healthy views while hidden, recreate a failed view on retry, and isolate failure state from the other mode. Creating or recreating a surface joins its theme bridge before the surface becomes visible, preventing an initial opposite-theme flash.

Clearing Chat data removes the website's persisted theme together with the rest of the dedicated partition. A recreated selected Chat surface adopts the current shared preference before it becomes visible.

## Verification

Unit tests cover coordinator startup authority, all three preference values, active-to-hidden propagation, acknowledgement loop suppression, operating-system updates under `system`, bridge disposal, malformed Chat storage, unknown versions, normalized opaque background colors, rejection of arbitrary CSS values, and adapter failure containment.

Electron integration tests use real WebContentsViews to prove both synchronization directions, hidden-only Chat reloads, selected-mode conflict resolution, theme restoration after Chat data clearing, real pointer selection of both segments, switch keyboard behavior, Chat-menu expansion and dismissal, retained Chat state, failure isolation, and retry.

The Chat fixture exposes a top-left sidebar control at the page's original content origin. A real pointer click must reach that control while the mode chrome is closed. Native-bound assertions prove the drag region and chrome rectangle never overlap, Chat uses only the operating-system title-bar inset, and the chrome expands only while the Chat menu or dialog is open.

An Electron run with an empty user-data directory must start in Harness. After selecting Chat and restarting with the same directory, it must restore Chat. The scenario then selects Harness directly to prove both segments remain clickable in the packaged interaction path.

Style and screenshot checks cover macOS and Windows title-bar geometry, light and dark foregrounds, the borderless equal-width segments, stable `Chat | Harness` labels, matching Chat page and title-bar backgrounds, absence of an application-owned header, the Chat menu, loading and failure states, drag regions, and reduced motion.

The packaged runtime check verifies the local shell, mode chrome, Harness bridge, isolated Chat preload, Chat WebContentsView entrypoint, Harness Host entrypoint, and Web frontend in both macOS and Windows artifacts.

## Alternatives considered

### App-owned theme control only

A desktop-only preference can drive both pages through the operating-system media signal, but an explicit choice in the official Chat settings cannot update Harness. This does not provide bidirectional synchronization.

### Automate the official settings controls

Opening the Chat settings dialog and clicking its theme options would reproduce a user gesture, but it depends on private DOM structure, translated labels, focus timing, and animation state. The versioned storage adapter has a smaller dependency and can fail without operating the remote UI.

### Separate application-owned header

Placing a local selector row above Chat keeps the controls separate, but it reduces page height, reads as a second toolbar, and makes Harness and Chat start at different visual levels. The operating-system title bar already provides the required shared control row.

### Dropdown product selector

A text label and chevron use less title-bar width, but every mode change requires opening a menu and the control gives no persistent overview of both choices. The direct two-segment switch is faster, exposes the current alternative, and removes the expanded mode-menu layer that previously complicated native hit testing.

### Inject the selector into both products

Rendering the selector inside each navigation tree can align it with local controls, but Chat would depend on private remote DOM and CSS while the two modes would own duplicate interaction implementations. A local title-bar view keeps the remote page untouched and one controller authoritative.

### Native application menu

Placing mode selection only in the operating-system menu avoids web-content layering, but it is less discoverable and differs substantially between macOS and Windows.

## Out of scope

The design does not merge Chat conversations into Harness sessions, synchronize credentials, expose private Chat APIs to Harness, inspect Chat content beyond theme state, add a second application window, or promise compatibility with an unversioned future Chat theme representation.
