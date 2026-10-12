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
- Repository-level stock-count guards now reject empty/oversized item sets, unsafe IDs, and non-finite/negative counted quantities before opening a transaction; the contract test checks these guards.

## Verification / acceptance
- [x] P44 contract CI passes on commit `d752329e2da421d1ab32d4cc8526a763d249154d` in [run #12](https://github.com/aayush-oj/Rms/actions/runs/38205319791); phase-chain audit, inventory contract, active-branch guards for item/stock/count workflows, and TypeScript syntax all passed.
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
- [P44 CI run #12](https://github.com/aayush-oj/Rms/actions/runs/38205319791): success on `d752329e2da421d1ab32d4cc8526a763d249154d`; confirms item creation rereads are tenant/branch-scoped and opening stock, adjustment, transfer, count creation, and count confirmation validate the active branch inside their transaction.
- [P44 CI run](https://github.com/aayush-oj/Rms/actions/runs/38205869297): success; adds explicit not-found behavior for missing or cross-tenant item stock lookups and verifies it in the inventory contract.
- [P44 CI run](https://github.com/aayush-oj/Rms/actions/runs/38205872240): success; exposes `PURCHASE_RECEIPT` in the movement-history filter and covers the filter contract.
- [P44 CI run](https://github.com/aayush-oj/Rms/actions/runs/38205901569): success on commit `7f071981ea08f2ab0a587ac727af2543970b411f`; the P44 workflow now also runs global reports and finance reports regression contracts alongside phase-chain, inventory contract, and TypeScript syntax checks.
- [P44 CI run](https://github.com/aayush-oj/Rms/actions/runs/38206142466): success; stock count item updates and finalization now include tenant/branch predicates, and finalization requires the count to remain in DRAFT.
- [P44 CI run](https://github.com/aayush-oj/Rms/actions/runs/38206168205): success; stock count lists now return scoped item details instead of empty arrays, and weighted-average costing rejects non-finite or negative incoming quantities.

## Current status
**IN PROGRESS.** The contract and CI wiring pass, but static assertions are not live database workflow tests; passing CI does not alone establish P44 completion. Full database behavior, tenant-isolation integration tests, screenshot parity and P01–P44 regression remain acceptance gates.
