# RestroX / RMS — Phase Ledger

This ledger separates historical validation records from source currently committed to GitHub.

| Phase / range | Canonical phase name from recovered master plan | Recovered status | GitHub status |
|---|---|---|---|
| P01–P42 | Evidence/requirements, platform, product domains, Finance reports | The recovered P01–P42 chain marks every phase VALIDATED; overall chain status is `VALIDATED_WITH_SOURCE_GAPS_EXPLICIT` | Phase chain and inventory documentation committed; application source archive not yet pushed |
| P43 | Global reports | Original phase plan exists; P01–P49 chain says historical source not rehydrated | Not pushed |
| P44 | Inventory base & stock item/group | Original phase plan exists; P01–P49 chain says historical source not rehydrated | Not pushed |
| P45 | Consumption, recipes & costing | Original phase plan exists; P01–P49 chain says historical source not rehydrated | Not pushed |
| P46 | Stock history, adjustments, transfer & counts | Original phase plan exists; P01–P49 chain says historical source not rehydrated | Not pushed |
| P47 | Batch production & BOM | Original phase plan exists; P01–P49 chain says historical source not rehydrated | Not pushed |
| P48 | Purchasing, suppliers & purchase bills | Router/types/contracts reconstructed, but full historical source not rehydrated | Not pushed |
| P49 | Cross-domain financial & inventory reconciliation | Current-workspace source/contract checks recorded as passing with mocked database; production build/runtime gaps remain | Not pushed |
| Recovery documentation | Artifact inventory, phase chain, project status | Committed from recovered files and checks | Pushed and remotely verified |

## Phase requirements recovered for P43–P48

- **P43 — Global reports:** Implement the `/en/reports` hub, evidence-backed navigation and summary cards, without duplicating Finance report logic.
- **P44 — Inventory base & stock item/group:** Stock items, groups, measuring units, supplier-facing item links and opening stock.
- **P45 — Consumption, recipes & costing:** Consumption editor, recipe versions, ingredient impacts and costing.
- **P46 — Stock history, adjustments, transfer & counts:** Movement history, adjustments, stock transfer, counts/confirmation and audit.
- **P47 — Batch production & BOM:** Production workflow, BOM, byproducts, overhead/loss/salvage and stock movements.
- **P48 — Purchasing, suppliers & purchase bills:** Supplier CRUD, purchase orders/receipts, Finance purchase bills and return registers.

These names and objectives come from the recovered master production-readiness plan. They are not a claim that the phase implementations were successfully pushed or fully revalidated.

## Recovered evidence

- `restrox-rebuild-01-42.tar.gz` is available in the Library and its SHA-256 matches the release manifest.
- The P01–P42 archive contains source/runtime files, migrations, validation scripts, and reports for all 42 phases.
- `restrox-rebuild-01-49.tar.gz` contains the P01–P42 baseline plus a P49 checkpoint; its chain explicitly records P43–P47 source gaps and P48 partial reconstruction.
- Production readiness is not established. See [Recovered Artifact Inventory](RECOVERED-ARTIFACT-INVENTORY.md).

## Required workflow for every next phase

1. Recover exact scope and prior decisions.
2. Inspect source and baseline.
3. Implement only the phase scope.
4. Run relevant tests and record actual results.
5. Revalidate from P01 through the current phase and repair regressions.
6. Add a phase report under `docs/phases/`.
7. Review changes and secrets.
8. Commit and push without rewriting history.
9. Verify the remote branch and files.
10. Report exact phase(s) and artifacts actually pushed.
