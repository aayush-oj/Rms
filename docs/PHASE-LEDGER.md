# RestroX / RMS — Phase Ledger

This is the canonical phase index derived from `docs/analysis/master-plan.json`. The plan contains **64 product phases (P01–P64)**. Phase 0 (P00) is a project-control baseline audit and does not change that count.

## Current state

- **Current implementation phase:** P43 — Global reports.
- **P43 status:** In progress. Static checks, TypeScript syntax, and two production-mode starts against clean MySQL passed in [CI run #12](https://github.com/aayush-oj/Rms/actions/runs/37935693711). Browser/accessibility checks and full P01–P43 regression passes remain open.
- **P01–P42:** The recovered historical chain marks them validated with overall status `VALIDATED_WITH_SOURCE_GAPS_EXPLICIT`; that history is not a substitute for a fresh full regression run.
- **P49:** Historical checkpoint only, with mocked-database and production/runtime gaps. It is not proof that P43–P49 are accepted as a continuous production-ready build.
- **Production readiness:** Not established.

## Phase 0 — baseline control step (not counted in P01–P64)

See [Phase 0 baseline audit](phases/phase-00-baseline-audit.md). It records repository/source provenance, historical validation limitations, and the gates required before accepting P43.

## Canonical phase-by-phase register

| Phase | Canonical name | Objective from master plan | Current evidence/status |
|---|---|---|---|
| P01 | Evidence provenance & checksums | Freeze the evidence corpus and create immutable hashes, manifests and provenance records. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P02 | Canonical requirement model | Normalize observed, confirmed, inferred, proposed, unknown and conflicting behavior into a requirements ledger. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P03 | Route canon & compatibility map | Create the canonical 142-route reference model and map every route to implementation ownership plus aliases. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P04 | Workflow canonicalization | Turn 98 documented workflows and cross-module journeys into executable workflow definitions. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P05 | Screenshot baseline & viewport matrix | Build the visual evidence index from all 834 captures and define comparison cohorts. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P06 | Video timeline & motion canon | Analyze the 8s product film and establish what it can and cannot validate; keep missing trace evidence explicit. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P07 | Current code artifact reconciliation | Compare active frontend bundles, server bundle, source map, build metadata and deployment docs; establish source-of-truth gaps. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P08 | API contract reconciliation | Convert observed and implemented API surfaces into canonical OpenAPI-like contracts, including errors/auth/idempotency. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P09 | Domain state-machine closure | Resolve authoritative states and transitions for orders, KOT/KDS, bills, payments, voids, inventory and reservations. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P10 | Database authority & engine decision | Decide and freeze the production relational engine; reconcile current MySQL implementation with the PostgreSQL-or-approved requirement. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P11 | Security/tenant/RBAC authority | Freeze organization, branch, user, role, permission and session boundaries. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P12 | Print/payment/tax policy closure | Close receipt vs invoice vs estimate semantics and print/reprint/audit requirements. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P13 | Canonical source checkout/recovery | Establish editable source tree; recover backend source from source map where necessary and identify missing frontend source. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P14 | Monorepo/tooling scaffold | Create maintainable React/TS + Node/TS + relational DB workspace with packages and validation folders. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P15 | Reproducible build & release pipeline | Make frontend/backend/package artifacts reproducible with checksums and provenance. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P16 | Design tokens & typography | Extract and codify shared visual tokens from screenshot/code evidence. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P17 | Shared UI primitives | Build the reusable component foundation. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P18 | Application shell & navigation | Rebuild header/sidebar/breadcrumb/notification/profile/workspace shell. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P19 | Route gateway & locale aliases | Replace manual pathname switching with deterministic route matching; expose canonical /en routes. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P20 | Auth, session & recovery | Implement secure authentication UX and server flow. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P21 | Workspace & branch context | Implement organization/branch selection and isolation in UI and API. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P22 | RBAC & permission UX | Implement server-enforced permissions plus accessible permission-denied UI. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P23 | API client, schemas & state framework | Create typed API client with validation, caching, retry and error boundaries. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P24 | Observability, audit & telemetry | Standardize logs, request IDs, domain audit, metrics and health/readiness. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P25 | Migration, seed & fixture harness | Formalize empty-db bootstrap, migration integrity, deterministic fixtures and test database reset. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P26 | Analytics routes & data product | Implement exact analytics pages, filters, charts, KPI cards, Top Selling Dishes and export. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P27 | Settings core & restaurant configuration | Implement settings routes except dedicated printing/migrated/support surfaces. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P28 | People, staff & customer surfaces | Implement staff lifecycle, pending/removed, customers and groups. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P29 | Menu catalog & customization | Implement dishes/categories/add-ons/menu sets/sub-menu/combo and customization. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P30 | Table, space & QR | Implement tables, spaces, QR and allocation/operations. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P31 | Orders board/table/detail | Implement main Orders route, table mode, detail tabs, operations and order history surfaces. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P32 | Reservations | Implement reservation list, booking, completed and cancelled states. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P33 | POS modes & cart | Implement POS mode, active orders, table selector, catalog, cart, customer/membership, order confirmation. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P34 | KOT/KDS | Implement KOT order view/history and KDS operational display/state transitions. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P35 | Notifications & activity | Implement notification center and activity history. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P36 | Billing preview & bill lifecycle | Implement bill creation/preview, discounts, split and bill list/detail. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P37 | Payment settlement & reversal | Implement mixed settlement, payment modes, credit receivables and reversals. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P38 | Invoice, receipt, tax document & print UI | Implement exact receipt/invoice document states and print preview. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P39 | Returns, voids, trash, duplicates & payment edits | Implement destructive/exception workflows with audit and confirmation semantics. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P40 | Finance transactions & day book | Implement transaction list/day book and observed finance read workflows. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P41 | Finance setup & accounting masters | Implement journal/account heads/payment/tax/banks/expense setup. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P42 | Finance reports suite | Implement the 50+ finance report routes with shared report engine and query limits. | Historical recovery chain marks validated; source gaps explicit; fresh full regression not certified |
| P43 | Global reports | Implement `/en/reports` and any evidence-backed global report navigation/summary. | IN PROGRESS — static/production runtime checks passed twice; browser/accessibility and full P01–P43 regression open |
| P44 | Inventory base & stock item/group | Implement stock items, groups, units, suppliers-facing item links and opening stock. | Not started — blocked on P43 acceptance |
| P45 | Consumption, recipes & costing | Implement menu stock consumption and recipe/BOM cost logic. | Not started — blocked on P44 |
| P46 | Stock history, adjustments, transfer & counts | Implement movement history, adjustment, stock transfer, counts. | Not started — blocked on P45 |
| P47 | Batch production & BOM | Implement batch production workflow with BOM, byproducts, overhead/loss/salvage and stock movements. | Not started — blocked on P46 |
| P48 | Purchasing, suppliers & purchase bills | Implement supplier, purchasing, purchase bill/receipt/return lifecycle where reference evidence requires it. | Partial historical reconstruction only; not accepted as complete; new work not started |
| P49 | Cross-domain financial & inventory reconciliation | Make sales, payments, finance, inventory, tax and reports agree. | Historical mocked-database checkpoint only; fresh production validation not established |
| P50 | Printer admin, settings & discovery | Implement printer settings, station routing, test/discovery controls. | Not started — planned phase |
| P51 | Durable print jobs, reprint & print agent | Productionize queued printing, retries, failover, credentials, pairing and realtime agent. | Not started — planned phase |
| P52 | Services & integrations | Implement service routes: RestroLink, dine-in, delivery, SMS, loyalty, Connect. | Not started — planned phase |
| P53 | Migrated data, trash, subscription/support & release notes | Implement administrative/support surfaces and data-management routes. | Not started — planned phase |
| P54 | Platform administration | Preserve/currently implemented Platform Admin realm and organization lifecycle if within deployment scope. | Not started — planned phase |
| P55 | Responsive, keyboard & accessibility hardening | Make all routes usable across observed and required device sizes with robust keyboard and assistive technology support. | Not started — planned phase |
| P56 | Loading, empty, error, permission & stale-state matrix | Complete every documented UI state instead of only happy paths. | Not started — planned phase |
| P57 | Visual regression & screenshot parity | Execute exact visual comparisons against the 834-image evidence set and golden subsets. | Not started — planned phase |
| P58 | Workflow replay, video & animation parity | Re-run all important workflows and compare event order, visual state changes and motion; use new walkthrough only where applicable. | Not started — planned phase |
| P59 | API/integration contract suite | Run exhaustive endpoint contract tests, authz matrix and error semantics against rebuilt API. | Not started — planned phase |
| P60 | DB migration, SQL & concurrency verification | Prove empty-state bootstrap, migration integrity, indexes, transactions, constraints and concurrent writes. | Not started — planned phase |
| P61 | Security, performance & resilience | Harden against auth attacks, tenant breakout, injection, SSRF, rate-limit abuse and load spikes. | Not started — planned phase |
| P62 | Realtime, offline & external-failure validation | Validate Socket.IO, printer agent, live KDS/alerts, offline indicator and provider outages. | Not started — planned phase |
| P63 | Staging deployment, backups, restore & rollback | Prove the cPanel/Node/MySQL deployment path in an isolated staging environment. | Not started — planned phase |
| P64 | Production candidate, go-live & hypercare | Run final release gates, controlled production rollout, post-deploy verification and handover. | Not started — planned phase |

## P43 implementation record

- Canonical route: `PAGE-024`, `/en/reports`, from `docs/analysis/route-phase-map.csv`.
- Dependencies: P26 Analytics and P42 Finance Reports.
- Source/runtime artifacts, explicit editable server handlers, public/runtime static aliases, report catalog, smoke test, and CI workflow are recorded in [P43 phase report](phases/phase-43-global-reports.md).
- The static route/assets and TypeScript syntax checks passed; two production-mode full runtime starts on clean MySQL returned HTTP 200 for the canonical route and catalog. Browser/accessibility and full P01–P43 regression checks remain open.
- P43 must not be marked complete until the actual route and catalog are exercised in a running app, accessibility/browser checks pass, and full-start plus P01–P43 regression verification passes twice.

## Required lifecycle for each phase

1. Recover the exact scope and dependencies from the master plan and related phase documents.
2. Inspect source and baseline; record the pre-change audit.
3. Implement only the phase scope and keep historical evidence separate from fresh test results.
4. Run targeted tests and retain the actual logs/results.
5. Revalidate P01 through the current phase; fix regressions.
6. Repeat full-start and P01-through-current verification before sign-off.
7. Update the phase report, route/API/SQL references, rollback instructions, and status ledger.
8. Review changes and secrets.
9. Commit and push without rewriting history.
10. Verify remote files and branch head after the push.
11. Report a phase as completed only when every applicable acceptance gate passes; otherwise document the exact remaining blocker.

## Baseline validation limitations

The historical full validator checks the required evidence input hashes from `validation/reference/input-manifest.json`. The manifest includes `ALL_AI_SCREENSHOTS.zip` (SHA-256 `6b0ca4e22f86a126bbd7fdb71b66f87432a63089da601b0498f9f7941f5648bd`), which is not present in the current execution workspace. Therefore that full validator cannot currently be represented as passing. See [Phase 0 audit](phases/phase-00-baseline-audit.md) and [Project status](PROJECT-STATUS.md).
