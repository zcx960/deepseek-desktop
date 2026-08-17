Review Task 3 as a task-scoped spec-compliance and code-quality gate. This is read-only work: do not modify any file.

Read these files first:

- Requirements: `.superpowers/sdd/task-3-brief.md`
- Implementer report: `.superpowers/sdd/task-3-report.md`
- Snapshot diff: `.superpowers/sdd/task-3-review-package.diff`

The diff compares filesystem snapshots because this source archive has no Git metadata. Treat paths under `snapshots/task-3-after/` as their corresponding production paths.

Binding global constraints:

- Harness and Chat never share conversations, prompts, credentials, cookies, storage, navigation state, Session events, or telemetry content.
- Every production registration, event listener, IPC handler, view, window, and Host process has one disposer.
- Preserve strict ESM TypeScript and JSDoc conventions.
- The controller must not import Electron.
- Serialize every mutating async method through one tail promise; set the requested phase before awaiting; dispose a failed or cleared surface before replacement; publish detached snapshots after transitions; ignore and dispose create completions after shutdown; show only the selected ready surface.
- The pending external URL remains controller-private, snapshots expose only its presence, `openPendingExternal` clears it after opening, and code never logs it.

Do not trust the report. Verify the implementation and tests against the brief and diff. Do not re-run tests already evidenced by the report unless a concrete code risk requires one focused test. Do not crawl the repository.

Write a concise review with this exact structure:

## Spec Compliance

State compliant or list missing, extra, or misunderstood requirements with file:line evidence. Mark anything that cannot be verified from the diff.

## Strengths

List specific strengths with file:line evidence.

## Issues

### Critical

### Important

### Minor

For each finding, give file:line, impact, and a concrete correction. Use `None.` when empty.

## Assessment

State `Approve` or `Needs fixes`. Approval requires both complete spec compliance and no Critical or Important issue.
