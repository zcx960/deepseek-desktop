# Task 3 report: framework-neutral mode controller

## RED evidence

Before production code existed, this command failed as required:

```sh
pnpm exec vitest run apps/desktop/tests/desktop-mode-controller.spec.ts
```

Vitest reported `Cannot find module '../src/desktop-mode-controller.ts'` from `apps/desktop/tests/desktop-mode-controller.spec.ts`; the suite contained zero runnable tests because the controller module was deliberately absent.

## Implementation

Added `apps/desktop/src/desktop-mode-controller.ts` with the exact `DesktopModeControllerOptions`, `DesktopModeController`, and `createDesktopModeController()` public interfaces.

The controller keeps Harness and Chat independent, starts Harness eagerly, creates Chat lazily, retains ready surfaces, serializes asynchronous mutations with one promise tail, persists selections, manages pending external URLs privately, and publishes detached snapshots.

The controller tests cover the supplied ownership cases plus concurrent same-mode selections, retained-surface resize, shutdown disposal waiting and single ownership, and disposal of a create completion that arrives after shutdown.

## GREEN evidence

```sh
pnpm exec vitest run apps/desktop/tests/desktop-mode-controller.spec.ts apps/desktop/tests/desktop-state.spec.ts
```

Result: 2 test files passed, 10 tests passed.

```sh
pnpm --filter @deepseek-ai/dsh-desktop run typecheck
```

Result: both Desktop TypeScript programs exited successfully.

## Changed files

- `apps/desktop/src/desktop-mode-controller.ts` (new)
- `apps/desktop/tests/desktop-mode-controller.spec.ts` (new)
- `.superpowers/sdd/task-3-report.md` (new)

`apps/desktop/src/desktop-mode.ts` already supplied the required Task 1 interfaces, so it required no change.

## Self-review

- Serialized ordering: all mutating asynchronous controller APIs and factory failure callbacks pass through one tail promise; Chat clear disposes before partition clearing and recreates only after clearing.
- Shutdown races: shutdown raises its guard before queued work drains, hides retained surfaces, clears the pending URL in a published snapshot, and causes late factory completions to dispose rather than attach.
- Disposer ownership: a surface is removed from the controller map before disposal, so repeated shutdown and later transitions cannot dispose the same retained surface twice; shutdown awaits both owned disposers.
- Detached snapshots: `snapshot()` creates fresh outer and nested status objects; callback consumers cannot mutate controller state. The pending URL itself never leaves the controller, only its presence does.
- Public interfaces: the controller options, methods, and consumed Task 1 types match the brief verbatim; the module imports no Electron APIs.

## Concerns

None. The focused Vitest run emitted existing Vite tsconfig-path warnings, and Desktop typecheck emitted existing unsupported Linux native-package notices on macOS; neither affected the passing results.

## Review fix follow-up

### RED evidence

After adding the four reviewed regression cases, this command failed as expected:

```sh
pnpm exec vitest run apps/desktop/tests/desktop-mode-controller.spec.ts
```

Result: 11 tests ran; the four new tests failed because a throwing `onChange` escaped cleanup, a newer pending external URL was cleared by an older open, selected Chat stayed `idle` during deferred persistence, and resize/reload still reached surfaces after shutdown began.

### Fixes

- `publish()` now catches `onChange` exceptions and reports only the callback error with `console.error('desktop mode change callback failed:', error)`, allowing cleanup, retry, and shutdown to continue without exposing pending URL content.
- Pending external offers now carry a private generation. `openPendingExternal()` clears the offer only if that generation is still current after `openExternal()` resolves.
- `select()` marks an unready selected surface `loading` before persisting the selection, then explicitly permits the subsequent factory call through the loading guard.
- `resize()` and `reloadChat()` now return immediately after shutdown has been requested.

### Added regression coverage

- Throwing state callbacks cannot block failed-surface disposal, retry, or shutdown.
- An offer made while an older external URL is opening remains pending and opens subsequently.
- An unready selected mode publishes `loading` while `saveMode()` is deferred, then creates once when persistence resolves.
- Resize and Chat reload are ignored after shutdown begins.

### Final verification

```sh
pnpm exec vitest run apps/desktop/tests/desktop-mode-controller.spec.ts apps/desktop/tests/desktop-state.spec.ts
```

Result: 2 test files passed, 14 tests passed.

```sh
pnpm --filter @deepseek-ai/dsh-desktop run typecheck
```

Result: both Desktop TypeScript programs exited successfully.

The same existing Vite tsconfig-path warnings and unsupported Linux native-package notices on macOS were emitted; neither affected the passing results.
