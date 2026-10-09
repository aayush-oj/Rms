# RestroX / RMS — Phase Ledger

This ledger separates historical validation records from current source and integration status. Historical validation is evidence, not a claim of current production readiness.

| Phase / range | Canonical phase name from recovered master plan | Recovered status | GitHub status |
|---|---|---|---|
| P01–P42 | Evidence/requirements, platform, product domains, Finance reports | The recovered P01–P42 chain marks every phase VALIDATED; overall chain status is `VALIDATED_WITH_SOURCE_GAPS_EXPLICIT` | Source folders and runtime artifacts are present on `main`; historical syntax-only check passed, full validator was blocked by missing `ALL_AI_SCREENSHOTS.zip` |
| P43 | Global reports | Implementation checkpoint exists; not complete because actual `/en/reports` route integration and full-start/regression verification are still open | Hub HTML, catalog, and phase report committed; see [P43 report](phases/phase-43-global-reports.md) |
| P44 | Inventory base & stock item/group | Not started | Not started |
| P45 | Consumption, recipes & costing | Not started | Not started |
| P46 | Stock history, adjustments, transfer & counts | Not started | Not started |
| P47 | Batch production & BOM | Not started | Not started |
| P48 | Purchasing, suppliers & purchase bills | Partial historical reconstruction only; not accepted as phase completion | Not started for new phase work |
| P49 | Cross-domain financial & inventory reconciliation | Historical checkpoint says validated in workspace with mocked database; production build/runtime gaps remain | Historical code exists in current source tree; fresh full validation not established |
| Recovery documentation | Artifact inventory, phase chain, project status | Recovered and reviewed | Documentation and source files are present on `main` |

## P00 — Baseline control step (not counted in the 64-phase plan)

- Baseline report: `docs/phases/phase-00-baseline-audit.md`.
- P01–P42 are historical recovery/validation records; the chain itself documents source gaps and the prior full validator was blocked by a missing screenshot archive.
- P00 defines the baseline evidence and gates for the fresh P43 implementation. It does not rewrite historical validation claims.

## P43 — Global reports

- **Objective:** Implement the `/en/reports` hub and evidence-backed navigation without duplicating Finance report logic.
- **Dependencies:** P26 Analytics and P42 Finance Reports.
- **Evidence:** PAGE-024 in `docs/analysis/route-phase-map.csv`; canonical destination references in `validation/reference/routes.json`.
- **Current checkpoint:** Public page/catalog, explicit editable server route, public/runtime directory-index aliases, preserved runtime copies, smoke test, package command and CI workflow committed.
- **Open acceptance gates:** Smoke/syntax CI results, live runtime route, browser/accessibility checks, and two full-start P01–P43 regression passes. Until these gates are evidenced, P43 remains **in progress**, not complete.

## P44–P48 recovered scope

- **P44 — Inventory base & stock item/group:** Stock items, groups, measuring units, supplier-facing item links and opening stock.
- **P45 — Consumption, recipes & costing:** Consumption editor, recipe versions, ingredient impacts and costing.
- **P46 — Stock history, adjustments, transfer & counts:** Movement history, adjustments, stock transfer, counts/confirmation and audit.
- **P47 — Batch production & BOM:** Production workflow, BOM, byproducts, overhead/loss/salvage and stock movements.
- **P48 — Purchasing, suppliers & purchase bills:** Supplier CRUD, purchase orders/receipts, Finance purchase bills and return registers.

These names/objectives come from the recovered master production-readiness plan. Historical checkpoints explicitly note source gaps for P43–P47 and partial reconstruction for P48.

## Required workflow for every phase

1. Recover exact scope and prior decisions.
2. Inspect source and baseline; record the pre-change audit.
3. Implement only the phase scope.
4. Run targeted tests and record actual results.
5. Revalidate P01 through the current phase; fix regressions.
6. Repeat the full-start and P01-through-current verification before sign-off.
7. Add a phase report under `docs/phases/`.
8. Review changes and secrets.
9. Commit and push without rewriting history.
10. Verify the remote branch and files after push.
11. Report only completion when every acceptance gate passes; otherwise report the exact blocker.
