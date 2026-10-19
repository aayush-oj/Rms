# P45 — Consumption, recipes & costing

## Scope

The predecessor and historical-phase dependency review is tracked in [P45 upstream audit and regression map](../analysis/p45-upstream-audit.md). It distinguishes historical phase claims from current targeted CI evidence and records the unresolved evidence/deployment gates.

Expose the existing recipe/version/ingredient/costing domain through the authenticated API and provide a branch-scoped recipe workspace. Keep unit conversions dimension-safe, recipe versions immutable after activation, and costing based on current inventory unit costs and the existing menu price/tax calculation. Do not replace the established POS stock ledger or enable dormant recipe-based order consumption without its own verified migration path.

## Implementation

- Mounted the existing recipe router at both `/api/v1/recipes` and the compatibility alias `/api/v1/inventory/recipes`.
- Retained per-action `recipe:view`, `recipe:create`, `recipe:update`, `recipe:activate`, `recipe:archive`, and `recipe:view_cost` permission checks.
- Added `apps/web/public/recipes.html`: responsive recipe list/search, draft creation, version listing/activation, draft ingredient editing, and current food-cost/gross-margin display. Menu items, inventory items, stock locations, and units load from authenticated scoped APIs into selectors; ingredient-unit choices are filtered to the inventory item's dimension. Amounts are formatted without assuming USD.
- Updated `scripts/build-runtime-candidate.mjs` to require the recipe router in the candidate bundle and copy the recipe workspace into `runtime/dist/recipes.html`.
- Added `tests/unit/recipe-costing-smoke.cjs` and `npm run test:recipe-costing` for unit conversion, costing math, schema boundaries, route/permission wiring, tenant/branch scoping, explicit tenant/branch predicates on ingredient/version writes, and POS stock-boundary preservation.
- Hardened recipe ingredient/version reads and writes with organization/branch predicates on mutation statements, and scoped the recipe category join to its organization.
- Extended the isolated MySQL integration test to reject foreign-tenant menu items, mass units as recipe yield, cross-branch stock locations, and incompatible ingredient unit dimensions.
- Extended runtime smoke verification to check the recipe workspace and ensure both API prefixes reject unauthenticated requests.
- Extended the repeated P00–P45 static regression workflow with recipe contract tests.

## Safety boundary

`apps/api/src/server/modules/recipe/operationalBoundary.ts` remains responsible for the existing POS order lifecycle and delegates stock consumption/reversal to the authoritative simple-stock repository. P45 does not silently switch sale transactions to recipe ingredient consumption. This avoids creating a second stock ledger or changing order/cancel semantics without the P45/P46 integration evidence.

## Verification / acceptance

Latest main-branch evidence: [P45 Recipes and inventory regression run](https://github.com/aayush-oj/Rms/actions/runs/39208484404) and [P43 Global Reports smoke run](https://github.com/aayush-oj/Rms/actions/runs/39208484349), both successful on commit `3631e9a00c4b3537aaf08fda7c3e4b84f64c9e28`. These checks used an isolated MySQL service; no production database was touched.

- [x] Recipe contract tests pass in the main-branch CI run.
- [x] Candidate build proves the recipe router is bundled and copies the recipe workspace.
- [x] Rebuilt runtime serves `/recipes.html`; unauthenticated requests to both recipe API prefixes return HTTP 401.
- [x] Existing P00–P44 static regression suite is repeated twice; inventory and global-report runtime/browser checks also pass in CI.
- [x] Live MySQL recipe create/version/ingredient/activation/costing and tenant/branch isolation tests pass in the isolated CI database.
- [ ] Full P01–P45 product regression passes twice; current workflow repeats P00–P44 static checks plus targeted P45 contracts, not the full product regression.
- [ ] Browser keyboard, responsive layout, error-state and recipe editing tests receive complete acceptance review; current browser smoke verifies the recipe workspace but does not close the full visual/accessibility matrix.
- [ ] Reference-screenshot visual parity is reviewed; the required `ALL_AI_SCREENSHOTS.zip` evidence archive is not available in the current workspace.

## Rollback

Remove the two recipe router mounts, the recipe workspace copy/check from the runtime candidate builder, the P45 smoke checks and phase-owned UI/tests. Do not roll back migration 020 or drop recipe data as part of an application-code rollback. The existing POS stock boundary remains unchanged.
