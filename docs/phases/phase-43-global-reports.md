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
- `tests/unit/global-reports-runtime-smoke.cjs`: two production-mode startup/HTTP checks against an isolated MySQL 8 database.
- `tests/unit/global-reports-browser-smoke.cjs`: browser checks for search, keyboard focus, mobile overflow, JavaScript errors, and axe WCAG 2.1 AA rules.
- `package.json`: `test:global-reports`, `test:global-reports:runtime`, and `test:finance-reports` commands.
- `.github/workflows/p43-global-reports-smoke.yml`: CI workflow for P42 dependency checks, P43 static consistency, TypeScript syntax, and two production-mode starts against an isolated MySQL 8 service.
- `docs/phases/phase-00-baseline-audit.md`: phase-chain preflight and evidence gaps.
- `docs/analysis/phase-00-to-43-audit.md`: numbered P00–P43 scope/evidence audit.
- `scripts/audit-phase-chain.cjs` / `npm run audit:phase-chain`: structural phase-chain and manifest audit; it reports missing external evidence without treating it as verified.

## Verification status
- GitHub writes: commits returned for all implementation and documentation changes. Remote files were re-fetched and the `main` branch head was verified at `7bbab9689c2a99df08f7bf03789119b7a53ce556` before this documentation correction.
- GitHub Actions run [#15](https://github.com/aayush-oj/Rms/actions/runs/37936407643): **success** for the P42 Finance Reports dependency contract, static route/catalog consistency, TypeScript syntax, two production-mode starts against clean MySQL 8, and browser/accessibility checks. Both runtime passes applied/checked migrations and verified HTTP 200 for `/en/reports`, `/en/reports/`, and the four-item catalog. Browser checks passed search filtering, keyboard focus visibility, mobile overflow, catalog-load failure handling, no page errors, and axe WCAG 2.1 AA rules.
- The CI runtime passes provide live HTTP evidence for the preserved compiled production runtime; they do not replace the full P01–P43 regression suite or screenshot-level visual parity checks.
- Browser/accessibility test: passed in CI run #15.
- Full P01–P43 regression verification twice: not run; the historical full validator requires external evidence archives not present in the current execution workspace.
- Production readiness: not established.

## Acceptance checklist
- [x] `npm run test:global-reports` passes in GitHub Actions run [#15](https://github.com/aayush-oj/Rms/actions/runs/37936407643).
- [x] TypeScript syntax check passes in the same CI run.
- [x] The production runtime returns HTTP 200 for `/en/reports` and `/en/reports/` and serves `/reports-catalog.json` in two separate starts.
- [x] Browser checks confirm keyboard navigation, focus visibility, responsive layout, search filtering, and no JavaScript errors; axe WCAG 2.1 AA rules pass.
- [x] Catalog-load failure state is covered by a browser/network-failure test.
- [ ] All catalog destinations resolve and authorization/tenant scoping remain owned by their destination routes.
- [ ] Finance calculations remain owned by the existing Finance Reports implementation.
- [ ] Full-start and P01–P43 regression checks pass twice, with failures fixed and evidence recorded.
- [x] GitHub remote files and branch head were rechecked; ledger/status docs reflect the known evidence and open gates.

## Rollback
Remove the P43 route handlers, static aliases, runtime copies, catalog/page and smoke workflow; no database migration or schema change is introduced by this phase.
