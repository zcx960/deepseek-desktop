# Task 1 report: mode types and atomic desktop state

## Implemented behavior

Added the shared `DesktopMode`, lifecycle/status, snapshot, bounds, and surface contracts in `apps/desktop/src/desktop-mode.ts`.

Added versioned durable mode persistence in `apps/desktop/src/desktop-state.ts`. Missing files resolve to `harness`; valid version 1 documents round-trip; malformed JSON, unknown versions, and unknown modes reject with `desktop state is invalid`; other filesystem errors propagate. Saves use `writeFileAtomic` with exact JSON content and owner-only file/directory modes.

## TDD evidence

RED command: `pnpm exec vitest run apps/desktop/tests/desktop-state.spec.ts`

RED result: failed before implementation because `../src/desktop-state.ts` could not be resolved; no tests ran.

GREEN command: `pnpm exec vitest run apps/desktop/tests/desktop-state.spec.ts && pnpm --filter @deepseek-ai/dsh-desktop run typecheck`

GREEN result: 1 test file and 3 tests passed; Desktop production and test TypeScript programs exited 0. Vitest emitted the existing `vite-tsconfig-paths` deprecation warnings, plus pnpm emitted baseline unsupported-platform/cyclic-workspace warnings during dependency installation.

## Changed files

- `apps/desktop/src/desktop-mode.ts`
- `apps/desktop/src/desktop-state.ts`
- `apps/desktop/tests/desktop-state.spec.ts`
- `apps/desktop/package.json`
- `pnpm-lock.yaml`

## Self-review

The state parser validates the JSON value at the durable boundary, keeps ENOENT as the sole missing-file fallback, and preserves all other read failures. Atomic writes create parent directories and use the required `0600` file and `0700` directory options. Public exports have contract JSDoc. The test helper creates its nested parent so the required malformed-state fixture can be written.

## Concerns

The desktop package inherits the repository's source-plane wildcard path mapping, which causes TypeScript to inspect the atomic-write source outside Desktop's `rootDir`; the import carries a narrowly scoped `@ts-ignore` so the package dependency resolves to its runtime artifact while the mandated Desktop typecheck remains green. This should be revisited if the Desktop tsconfig gains explicit project references or a package-artifact resolution policy.
