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
- Repository-level stock movement guards reject zero/non-finite/out-of-range quantities; balance, movement-history and stock-count detail joins now enforce tenant/branch scope.
- Unit-cost validation now matches the inventory `DECIMAL(14,4)` column limit and is enforced in API schemas and repository writes.
- P44 CI now provisions isolated MySQL, starts the production runtime twice (first run applies pending migrations; second verifies restart on the migrated schema), and repeats the static regression suite twice.

## Verification / acceptance
- [x] P44 contract CI passes on commit `d752329e2da421d1ab32d4cc8526a763d249154d` in [run #12](https://github.com/aayush-oj/Rms/actions/runs/38205319791); phase-chain audit, inventory contract, active-branch guards for item/stock/count workflows, and TypeScript syntax all passed.
- [x] Exercise create/update/list/get for stock items, categories/groups and locations against isolated MySQL fixtures; create/list tenant-specific measuring units and reject duplicate symbols. Unit conversion metadata is immutable through this API to avoid silently changing historical stock quantities.
- [x] Verify opening stock, adjustment, transfer and stock count writes against isolated MySQL; assert balance/ledger reconciliation and forced mid-transfer rollback.
- [x] Verify cross-tenant and cross-branch item/stock lookups are isolated in live MySQL.
- [ ] Reconcile the inventory foundation with P48 purchasing and P49 reconciliation without duplicate stock ledgers.
- [ ] Full P01–P44 regression and full-start checks pass twice; available static suite and clean/migrated MySQL runtime starts now pass twice, but this is not the full product end-to-end matrix.
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
- [P44 CI run](https://github.com/aayush-oj/Rms/actions/runs/38206741591): success on `fafb1071e2bfa4b00da686b8233afb3873bb99b7`; repository-level stock-count input validation passes the phase contract, reports regression contracts, phase-chain audit, and TypeScript syntax check.
- [P44 CI run](https://github.com/aayush-oj/Rms/actions/runs/38206748444): success on `65337d5701aeaab4241f23023426b1f0be633ed0`; added regression assertions for stock-count input guards.
- [P44 full MySQL repository run](https://github.com/aayush-oj/Rms/actions/runs/38207830220): success on `f7bddc559f9c3f23dd9822f0188ccfc6630b2c49`; production startup applied migrations to clean MySQL, live repository tests exercised opening stock, adjustment, transfer, count confirmation, ledger consistency, forced transaction rollback, insufficient stock, and cross-tenant isolation, and runtime restarted successfully on the migrated schema.
- Canonical `inventoryRouter` is now mounted at `/api/v1/inventory` ahead of the legacy stock router; legacy stock-only routes also remain available through `/api/v1/stock`.
- [P44 repeated regression + MySQL startup run](https://github.com/aayush-oj/Rms/actions/runs/38207167582): success on `a3f8c7b02a483a91fcf77f4658f0efde612fcb31`; static regression suite passed twice, then the production runtime applied migrations to a clean MySQL 8 instance and restarted successfully against the migrated schema.
- [P44 router + cross-branch regression run](https://github.com/aayush-oj/Rms/actions/runs/38207991618): success; confirms the canonical inventory router is mounted ahead of the legacy stock fallback and the live MySQL repository suite verifies cross-tenant and cross-branch isolation. The same run repeats the static phase-chain, inventory, reports and TypeScript checks twice, and starts production runtime twice on clean/migrated MySQL.
- [P44 typed unit CRUD + live MySQL run](https://github.com/aayush-oj/Rms/actions/runs/38208593581): success on `de44bb5e6874b0f68b99b3d8ce5b5bc33f7cd788`; strict inventory repository/domain typecheck passes, custom units are created/listed with duplicate-symbol protection, CRUD fixtures pass, rollback/ledger/tenant/branch checks pass, and the runtime starts on clean and migrated MySQL.
- [Repeated regression CI run](https://github.com/aayush-oj/Rms/actions/runs/38206957368): success on `dfb7421c742447f23fea4748bb963f0f84699ec4`; phase-chain, inventory, global/finance reports and TypeScript syntax checks all passed twice in one CI job.

## Current status
**IN PROGRESS.** The contract and CI wiring pass, but static assertions are not live database workflow tests; passing CI does not alone establish P44 completion. Full database behavior, tenant-isolation integration tests, screenshot parity and P01–P44 regression remain acceptance gates.
