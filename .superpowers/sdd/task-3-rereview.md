## Spec Compliance

Compliant for the requested Task 3 behavior.

- `onChange` errors are caught and reported without passing the pending URL: [desktop-mode-controller.ts:91](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/src/desktop-mode-controller.ts:91).
- Pending URL generations preserve newer offers: [desktop-mode-controller.ts:225](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/src/desktop-mode-controller.ts:225).
- Unready selection publishes `loading` before persistence: [desktop-mode-controller.ts:169](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/src/desktop-mode-controller.ts:169).
- Resize and reload are guarded after shutdown begins: [desktop-mode-controller.ts:188](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/src/desktop-mode-controller.ts:188).
- The Agent Note requirement is treated as satisfied per the instruction. Reported test results are not independently verifiable from the diff; tests were not rerun.

## Strengths

- Cleanup continues after callback failures, including retry and shutdown: [desktop-mode-controller.spec.ts:388](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/tests/desktop-mode-controller.spec.ts:388).
- The newer external-offer race has direct regression coverage: [desktop-mode-controller.spec.ts:415](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/tests/desktop-mode-controller.spec.ts:415).
- Selection timing and post-shutdown guards have direct regression coverage: [desktop-mode-controller.spec.ts:436](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/tests/desktop-mode-controller.spec.ts:436).
- Existing queue, disposal ownership, detached snapshot, and late-create handling remain intact.

## Issues

### Critical

None.

### Important

None.

### Minor

- [desktop-mode-controller.ts:29](/Users/zo/Documents/deepseek-harness-desktop-master/apps/desktop/src/desktop-mode-controller.ts:29) — Public controller methods still lack method-level JSDoc for side effects, disposal timing, and rejection behavior. Add concise method documentation.

## Assessment

Approve