## Spec Compliance

Not fully compliant.

- Required controller API, ESM imports, detached snapshots, serialized async queue, visibility control, and late-create disposal are present.
- Critical lifecycle and URL-race issues remain; see below.
- No Agent Note appears in the diff, despite the repository requirement at `AGENTS.md:122`.
- Concrete Harness/Chat adapter isolation and adapter-level disposer coverage cannot be verified from this diff. Reported test/typecheck results are report-only.

## Strengths

- Controller imports no Electron and consumes the Task 1 types correctly: [desktop-mode-controller.ts:3](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/src/desktop-mode-controller.ts:3).
- One promise tail serializes async operations: [desktop-mode-controller.ts:95](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/src/desktop-mode-controller.ts:95).
- Surfaces are removed from ownership before disposal, preventing duplicate disposal: [desktop-mode-controller.ts:102](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/src/desktop-mode-controller.ts:102).
- Late factory completions after shutdown are disposed: [desktop-mode-controller.ts:138](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/src/desktop-mode-controller.ts:138).
- Snapshots expose only pending-URL presence: [desktop-mode-controller.ts:66](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/src/desktop-mode-controller.ts:66).
- Tests cover lazy creation, failure isolation, clear ordering, coalescing, resize, shutdown disposal, and late completion: [desktop-mode-controller.spec.ts:16](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/tests/desktop-mode-controller.spec.ts:16).

## Issues

### Critical

- [desktop-mode-controller.ts:86](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/src/desktop-mode-controller.ts:86) — `onChange` exceptions escape `publish()`. A throwing callback can prevent `failMode()` or `shutdown()` from reaching `disposeSurface()`, leaving a retained failed surface that blocks retry. Catch and report callback failures inside `publish()` so lifecycle cleanup always continues; add a regression test.

### Important

- [desktop-mode-controller.ts:212](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/src/desktop-mode-controller.ts:212) — A URL offered while `openExternal()` is awaiting is unconditionally cleared at line 213, losing the newer pending URL. Track an offer generation/token and clear only the URL being opened.

- [desktop-mode-controller.ts:163](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/src/desktop-mode-controller.ts:163) — `select()` awaits `saveMode()` before marking an unready target as `loading`, violating the required phase-before-await ordering. Publish `loading` before persistence, or otherwise restructure the transition.

- [desktop-mode-controller.ts:175](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/src/desktop-mode-controller.ts:175) — `resize()` and `reloadChat()` can still call retained surfaces after shutdown has been requested but before queued disposal starts. Ignore these calls when `shuttingDown` is true.

- `AGENTS.md:122` — The non-trivial controller change has no accompanying Agent Note in the provided diff. Add or update an active Agent Note in the same change.

### Minor

- [desktop-mode-controller.ts:23](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/src/desktop-mode-controller.ts:23) — Public controller methods lack method-level JSDoc describing parameters, side effects, disposal timing, and rejection behavior. Add concise API documentation.

## Assessment

Needs fixes