# P43 — Global Reports

## Scope
Implement the evidence-backed global reporting hub for `/en/reports`, providing top-level links to Analytics and the existing Finance Reports suite. This phase must not duplicate finance query logic or invent financial totals.

## Evidence and dependencies
- Canonical route: `PAGE-024`, `/en/reports`, title-observed in `docs/analysis/route-phase-map.csv`.
- Canonical route references: `validation/reference/routes.json`.
- Analytics routes from P26: `/en/analytics`, `/en/analytics/finance`, `/en/analytics/order`.
- Finance report catalog from P42: `/en/finance/reports` and `apps/web/public/finance-reports-catalog.json`.
- Dependencies: P26 Analytics and P42 Finance Reports.

## Implementation checkpoint committed to GitHub
- `apps/web/public/reports.html`: responsive, keyboard-accessible report directory with search, semantic elements, safe DOM text insertion, and a graceful catalog-load failure state.
- `apps/web/public/reports-catalog.json`: four evidence-backed Analytics and Finance Reports destinations.
- `apps/api/src/server/server.ts`: explicit `/en/reports` route handlers for development and for a rebuilt production server.
- `apps/web/public/en/reports/index.html`: canonical static route alias for static-host/dev setups.
- `runtime/dist/reports.html` and `runtime/dist/reports-catalog.json`: preserved runtime copies of the page and catalog.
- `runtime/dist/en/reports/index.html`: static directory-index alias so a static server rooted at `runtime/dist` can resolve `/en/reports/`.
- `tests/unit/global-reports-smoke.cjs`: consistency checks for source/runtime copies, canonical destination routes, safe rendering and route wiring.
- `package.json`: `test:global-reports` command.
- `.github/workflows/p43-global-reports-smoke.yml`: CI workflow for the P43 smoke check and TypeScript syntax scan.
- `docs/phases/phase-00-baseline-audit.md`: phase-chain preflight and evidence gaps.

## Verification status
- GitHub writes: commits returned for all implementation and documentation changes; final remote file/head verification remains required.
- Static consistency smoke test: added but not yet executed in a verified runtime/CI result.
- TypeScript syntax check: workflow added; current run result not yet confirmed.
- Browser/accessibility test: not run in this environment.
- Live application start and actual `/en/reports` HTTP response: not verified.
- Full P01–P43 regression verification twice: not run.
- Production readiness: not established.

## Acceptance checklist
- [ ] `npm run test:global-reports` passes in CI against the committed tree.
- [ ] TypeScript syntax check passes in CI.
- [ ] The deployed runtime's actual `/en/reports` and `/en/reports/` requests return the report hub and load `/reports-catalog.json`.
- [ ] Browser checks confirm keyboard navigation, focus visibility, responsive layout, search filtering, and graceful catalog-load failure.
- [ ] All catalog destinations resolve and authorization/tenant scoping remain owned by their destination routes.
- [ ] Finance calculations remain owned by the existing Finance Reports implementation.
- [ ] Full-start and P01–P43 regression checks pass twice, with failures fixed and evidence recorded.
- [ ] GitHub remote files and branch head are rechecked after final fixes; ledger/status docs match the evidence.

## Rollback
Remove the P43 route handlers, static aliases, runtime copies, catalog/page and smoke workflow; no database migration or schema change is introduced by this phase.
