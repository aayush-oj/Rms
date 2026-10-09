# P43 — Global Reports

## Scope
Implement the evidence-backed global reporting hub for `/en/reports`, providing top-level links to Analytics and the existing Finance Reports suite. This phase must not duplicate finance query logic or invent financial totals.

## Evidence and dependencies
- Canonical route: `PAGE-024`, `/en/reports`, title-observed in `restrox-route-phase-map.csv`.
- Analytics routes from P26: `/en/analytics`, `/en/analytics/finance`, `/en/analytics/order`.
- Finance report catalog from P42: `/en/finance/reports` and `apps/web/public/finance-reports-catalog.json`.
- Dependencies: P26 Analytics and P42 Finance Reports.

## Implementation checkpoint
- Added `apps/web/public/reports.html`: responsive, keyboard-accessible report directory with search, semantic elements, and a graceful catalog-load failure state.
- Added `apps/web/public/reports-catalog.json`: links only to route-map-backed Analytics and Finance Reports destinations. The hub does not calculate report totals.
- Both files were committed to `main`.

## Verification status
- Remote file existence: verified after commit.
- Functional browser test: not run in this environment.
- Full-start application test and P01–P43 regression: not run.
- Direct `/en/reports` route integration: **not verified**. The recovered frontend's editable route/component source is absent; the repository contains compiled frontend assets and limited public HTML artifacts. Do not mark P43 complete until the page is integrated into the actual application route and the runtime is built and exercised.
- Production readiness: not established.

## Acceptance checklist
- [ ] `/en/reports` resolves to the global report hub in the actual app, not only to a standalone HTML file.
- [ ] All links point to valid, authorized child report routes.
- [ ] Keyboard navigation, focus visibility, responsive layout, search filtering, and catalog-load failure are tested in a browser.
- [ ] Finance calculations remain owned by the existing Finance Reports implementation.
- [ ] Full-start and P01–P43 regression checks pass twice (before and after phase sign-off), with failures fixed and results recorded.
- [ ] GitHub remote is rechecked and the ledger/status docs are updated with actual evidence.

## Rollback
Remove the global hub HTML/catalog and its route registration; no database migration or schema change is introduced by this checkpoint.
