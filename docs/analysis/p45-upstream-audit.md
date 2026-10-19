# P45 upstream audit and regression map

**Reviewed:** 2026-10-19  
**Target:** P45 — Consumption, recipes & costing  
**Repository baseline:** `3631e9a00c4b3537aaf08fda7c3e4b84f64c9e28` (main at review start)  
**Decision:** Continue P45 hardening; do not advance to P46 until P45 acceptance gates pass.

## Canonical source set reviewed

- [Canonical master plan](master-plan.json): 64 product phases, 142 canonical routes, 253 API methods and 103 SQL entities.
- [Phase ledger](../PHASE-LEDGER.md): source of phase sequence, dependencies and acceptance status.
- [P00 baseline audit](../phases/phase-00-baseline-audit.md) and [P00–P43 audit register](phase-00-to-43-audit.md): historical provenance, phase-by-phase evidence posture and missing-input gates.
- [P43 Global Reports report](../phases/phase-43-global-reports.md) and [P44 Inventory report](../phases/phase-44-inventory-foundation.md): current predecessor implementation and targeted CI evidence.
- [P45 phase report](../phases/phase-45-consumption-recipes-costing.md): recipe domain boundaries, implementation and release gates.
- [Database build guide](../database/README.md), [schema catalog](../database/schema-catalog.md), and [migration provenance record](../database/runtime-migration-gap.json): database source of truth, migration range and deployment constraints.

## Upstream phase findings

| Phase range | Existing evidence and relevance to P45 | Acceptance interpretation |
|---|---|---|
| P00 | Baseline audit is documented; the full historical validator cannot verify the supplied screenshot corpus because `ALL_AI_SCREENSHOTS.zip` is absent from the current workspace. | Evidence-input gate remains open; never report the full validator or screenshot parity as passed. |
| P01–P12 | The historical chain records evidence provenance, requirements, route/workflow models, visual/video baselines, source recovery, API/state contracts, DB authority, tenant/RBAC and print/payment/tax policies. | Historical status is useful context, not a fresh P01–P12 runtime/regression certificate. |
| P13–P42 | The historical phase chain covers source recovery and product areas through analytics, settings, people, menu, tables, orders, POS, KOT/KDS, billing, payments, finance setup and finance reports. | Treat legacy completion labels as historical; run available regression contracts and do not infer missing original frontend source or screenshot evidence. |
| P43 | [Main-branch smoke run](https://github.com/aayush-oj/Rms/actions/runs/39208484349) passed targeted runtime/browser/accessibility checks for Global Reports. | Targeted evidence is green; the full P01–P43 product regression twice remains an open project gate. |
| P44 | [Main-branch regression run](https://github.com/aayush-oj/Rms/actions/runs/39208484404) passed the available repeated static suite, inventory/recipe browser checks, strict inventory typing, isolated MySQL inventory/recipe transactions and tenant isolation, and a rebuilt-runtime restart. | Inventory repository contracts have strong targeted coverage; full P01–P44 product regression, visual parity and active deployed-runtime parity remain open. |
| P45 | Recipe API aliases, scoped repository, recipe workspace and costing tests exist. The POS stock boundary remains the simple-stock ledger; sale-time recipe consumption stays disabled. | P45 may be accepted only after targeted CI, full P01–P45 regression twice, browser/accessibility/error-state review, screenshot parity and full-start verification are all evidenced. |

## P45 changes made in this continuation

- Added organization and branch predicates directly to recipe ingredient/version read-modify-write SQL, rather than relying only on a prior scoped lookup.
- Scoped recipe category joins to the owning organization.
- Extended isolated MySQL tests for cross-tenant menu-item rejection, count-compatible yield units, foreign-branch stock locations and incompatible ingredient-unit dimensions.
- Replaced manual numeric entry for menu items, inventory items, locations and units with authenticated API-backed selectors.
- Filtered ingredient units to the inventory item's measurement dimension and removed the unsupported hard-coded USD assumption from amount formatting.
- Extended browser checks to exercise the selectors and verify incompatible unit dimensions are not offered.

## Safety boundaries retained

- Do not modify or drop historical migration 020 to roll back application code.
- Do not enable recipe ingredient consumption in POS until its own transactional, cancellation/reversal, reconciliation and migration path is separately accepted.
- Do not rewrite established migration checksums 065–070 without recovering their immutable source or reconciling deployed `_schema_migrations` records.
- Do not claim production database migration, live deployment, backup/restore or screenshot parity from isolated CI.

## Remaining release gates

1. Latest branch CI for the scope-hardening and selector changes must pass end to end, including isolated MySQL, browser, runtime restart and candidate packaging.
2. Full P01–P45 regression and full-start verification must pass twice. The existing workflow repeats the available P00–P44 static suite and targeted P45 contracts; it is not a substitute for the full product end-to-end matrix.
3. Review keyboard behavior, responsive layout, loading/empty/error/permission states and recipe editing against actual browser evidence.
4. Obtain the missing screenshot archive or restore the authoritative evidence source; then run screenshot parity review.
5. Reconcile the migration 065–070 checksum provenance before any production migration/deployment.
6. Update the phase ledger only to reflect evidence actually passed. P46 remains blocked until P45 is accepted.

## Evidence distinction

A green targeted CI run proves only the steps it executed on that exact commit. Historical records, static assertions, an isolated MySQL instance and a candidate ZIP do not independently certify the full product regression or production readiness.
