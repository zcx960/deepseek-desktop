You are implementing Task 4 of the DeepSeek Harness desktop mode plan.

Read `.superpowers/sdd/task-4-brief.md` first; it is the exact requirements and values. The workspace has no Git metadata, so do not initialize Git or commit.

The first implementation attempt ran out of model capacity after creating these valid task files:

- `apps/desktop/src/shell-protocol.ts`
- `apps/desktop/src/shell-preload.ts`
- `apps/desktop/tests/shell-protocol.spec.ts`
- `apps/desktop/tests/packaging-config.spec.ts`
- `apps/desktop/tests/verify-packaged-runtime.spec.ts`
- `apps/desktop/tsdown.config.ts`

Do not revert them. Inspect and adjust them to satisfy the brief. Finish the missing shell HTML/CSS and packaging verification changes, then run the required RED/GREEN focused tests, Desktop typecheck, and Desktop build. Follow the repository's strict ESM/JSDoc rules and the brief's desktop-tool visual constraints. Do not edit files outside the task ownership list.

Write `.superpowers/sdd/task-4-report.md` with the RED/GREEN evidence, changed files, self-review, visible-string review, and concerns. Include exact commands and results. Return only status, one-line test summary, concerns, and report path.
