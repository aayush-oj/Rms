# P44 — Inventory base, stock items and groups

## Scope
Establish and verify the inventory foundation: stock items, groups/categories, units, branch-local locations, opening stock and their supplier-facing extension points. Preserve existing stock/menu dependency APIs and avoid speculative schema changes.

## Existing implementation reviewed
- Authenticated inventory router: `apps/api/src/server/modules/inventory/router.ts`.
- Tenant/branch context enforcement: `apps/api/src/server/modules/inventory/controller.ts`.
- Inventory repository: `apps/api/src/server/modules/inventory/repository.ts`.
- Input validation: `apps/api/src/server/modules/inventory/validation.ts`.
- Existing schema baseline: `apps/api/src/server/db/migrations/017_inventory_foundation.ts`.
- Legacy stock API compatibility: `apps/api/src/server/modules/stock/router.ts`.
- This phase starts by locking down the existing implementation with an executable contract; this is not a claim that all inventory workflows are complete.

## Added in this checkpoint
- `tests/unit/inventory-foundation-smoke.cjs`: checks authentication and permission gates, tenant/branch context, core inventory schema presence, scoped repository lookups, transactional write patterns, and positive/non-zero quantity validation.
- `.github/workflows/p44-inventory-foundation-smoke.yml`: runs the phase-chain audit, inventory contract, and TypeScript syntax check on relevant changes.
- `npm run test:inventory-foundation`: stable local entry point for the inventory contract.

## Verification / acceptance
- [x] P44 contract CI passes on commit `951b5f470872fe73f0551148bc8e6bcb250812ec` in [run #8](https://github.com/aayush-oj/Rms/actions/runs/38204817754); phase-chain audit, inventory contract, transactional category/location assertions, and TypeScript syntax all passed.
- [ ] Review and exercise create/update/list/get for stock items, categories/groups, units and locations against isolated MySQL fixtures.
- [ ] Verify opening stock, adjustment, transfer and stock count writes atomically update balances and append correct movements.
- [ ] Verify cross-tenant and cross-branch IDs cannot be read or mutated.
- [ ] Reconcile the inventory foundation with P48 purchasing and P49 reconciliation without duplicate stock ledgers.
- [ ] Full P01–P44 regression and full-start checks pass twice; fix any regressions and record evidence.
- [ ] Visual parity against the supplied inventory reference captures is verified before marking P44 complete.

## Latest verification evidence
- [P44 CI run #3](https://github.com/aayush-oj/Rms/actions/runs/38204565581): success.
- [P44 CI run #4](https://github.com/aayush-oj/Rms/actions/runs/38204628427): success after explicitly tenant/branch-scoping inventory balance mutations.
- [P44 CI run #5](https://github.com/aayush-oj/Rms/actions/runs/38204634768): success; phase-chain audit, inventory contract assertions, and TypeScript syntax check all passed.
- [P44 CI run #8](https://github.com/aayush-oj/Rms/actions/runs/38204817754): success on `951b5f470872fe73f0551148bc8e6bcb250812ec`; confirms transactional category/location updates and TypeScript syntax.

## Current status
**IN PROGRESS.** The contract and CI wiring pass, but static assertions are not live database workflow tests; passing CI does not alone establish P44 completion. Full database behavior, tenant-isolation integration tests, screenshot parity and P01–P44 regression remain acceptance gates.
