# RestroX Evidence-Reconciled Master Reconstruction & Production Readiness Plan

**Revision:** 2026-10-07
**Status:** NOT READY FOR PRODUCTION — implementation-ready after contract/source decisions; staging gate not passed.

> This document is intentionally granular. The 64 phases are capability/risk boundaries derived from the evidence volume (142 reference routes, 98 workflows, 834 screenshots, a compiled Node/React application with a 796-source backend map, 70 runtime migrations, and a durable printing/realtime subsystem). The count is not an arbitrary completion metric.

## 1. Executive decision
The supplied material now contains substantially more than a screenshot-only reference. The current distribution artifact exposes a large candidate implementation: React/TypeScript frontend assets, a Node/TypeScript backend bundled into `server.cjs`, a `server.cjs.map` containing 796 source entries with source contents, a MySQL-specific migration system reaching migration 070 in the runtime bundle, and a production/cPanel deployment procedure. The new print bundle uses the same B6 frontend JS/CSS hashes as `dist (1)`, so it is not a separate frontend implementation. It adds an 8-second product walkthrough and print/receipt assets.

The correct production approach is therefore **reconstruction plus controlled convergence**, not “build a new app from screenshots from scratch” and not “edit the dist bundle in place.” The compiled artifact is a strong candidate implementation but is not yet the authoritative source of truth because its active runtime is newer than its source map in important places, and the frontend source checkout is not supplied.

### Current blockers
- Authoritative editable source checkout is absent. Backend source can be partially recovered from server.cjs.map, but frontend source is not supplied as TypeScript source; only compiled code/debug file references are present.
- server.cjs is ahead of server.cjs.map: runtime contains migrations 065–070 plus compiled printing/print-agent modules that are absent from the source map.
- Current runtime is MySQL 8.0 specific. The original delivery brief allows PostgreSQL or another approved relational database, but no explicit MySQL approval was supplied. This requires an architecture decision.
- The active frontend candidate uses a different route model/brand (`/dashboard`, `/work/*`, `/reports/*`, `/settings/*`, MIH DineOS) than the 142 `/en/...` RestroX reference routes. Exact canonical route parity is therefore not proven.
- The inspection bundle recorded no persisted Playwright traces. The new MP4 is an 8-second marketing walkthrough, not a click-by-click transactional trace.
- Physical printer output remains unverified; current printing code includes network raw TCP validation and a print agent, but production hardware must be validated separately.
- Historical evidence contains unresolved cross-module semantic conflicts around invoice/estimate terminology, void/deletion, purchase-bill paid status, staff removal/restore, delivery status, stock counts and POS rendering/persistence.

These are release gates, not reasons to stop engineering. The plan below closes them in controlled order.

## 2. Evidence manifest

| Artifact | SHA-256 | Contents | Significance |
|---|---|---|---|
| `ALL_AI_SCREENSHOTS.zip` | `6b0ca4e22f86a126bbd7fdb71b66f87432a63089da601b0498f9f7941f5648bd` | 834 archive members / 834 files; 68,338.4 KiB uncompressed where archive | Evidence or candidate release input |
| `restrox-complete-inspection-bundle.zip` | `ba6b7e754b7c5be4c154ab18b4bd14e39c189277dbf298fd351eae03f3a88697` | 195 archive members / 195 files; 2,071.9 KiB uncompressed where archive | Evidence or candidate release input |
| `bill-print-ui-20260929.zip` | `c4d796e0ac238b8b720ab95b773385350a83e0ca0925a3ad70703b15734f1ddf` | 37 archive members / 28 files; 13,449.4 KiB uncompressed where archive | Evidence or candidate release input |
| `dist (1).zip` | `05724a26b1da0c900637f491fa64e9fef5536091c397206a3248a94fc62cc56e` | 79 archive members / 47 files; 33,949.9 KiB uncompressed where archive | Evidence or candidate release input |
| `Pasted text(1).txt` | `b9ea3ba52c2862195dfc47ef7b4b227521d81a4d91fe859d1146a584adfd0ea3` | 1 archive members / 1 files; 22.3 KiB uncompressed where archive | Evidence or candidate release input |

### Evidence counts established from the supplied materials
- **834 screenshots** in `ALL_AI_SCREENSHOTS.zip`; duplicate-byte groups exist, so screenshot count is not equivalent to unique visual states.
- **195 inspection artifacts** in the complete inspection bundle (103 JSON, 90 Markdown, one Python helper and one text file in the inventory snapshot).
- **142 canonical reference route records** in the consolidated route model, historically spanning PAGE-001 through PAGE-143 with PAGE-058 missing from the numbered sequence.
- **98 workflows** in the consolidated workflow inventory at the evidence snapshot; focused workflow JSONs contain a smaller unique ID subset and continuation records.
- **8-second MP4** in the new print bundle: 1280×720, 24 fps, 192 frames. It validates product-flow staging/motion but does not establish backend event semantics.
- **796 backend source-map sources** in `server.cjs.map`, with 796 source contents present.
- **285 TypeScript source entries** in that backend map; the frontend candidate exposes **116 source-file debug references** inside `index-Cz4falgD.js` but not the original TS files.
- **70 runtime migration names** in `server.cjs` checksum metadata (001–070). The source map contains migrations 001–064.
- **At least 103 current runtime-created SQL tables**: 100 created by source-map migrations plus `print_jobs`, `print_agents`, and `print_agent_pairing_tokens` from compiled-only migrations 066/067/069. Migration 065/068/070 alter existing structures/permissions.
- **At least 253 explicit backend HTTP methods** can be reconstructed from the current bundle/source-map combination: 239 mounted module methods + 8 historical/root compatibility methods + 6 compiled-only printing/print-agent methods.

## 3. Source-of-truth hierarchy

| Rank | Evidence | Use | Confidence |
|---:|---|---|---|
| 1 | User-supplied reference screenshots / route / workflow evidence | Authoritative for observed RestroX UI, route naming and observed state | OBSERVED |
| 2 | Current compiled `dist` runtime and `server.cjs` behavior | Candidate implementation behavior and operational constraints | OBSERVED implementation |
| 3 | `server.cjs.map` sourcesContent | Recoverable backend source evidence; must be reconciled with runtime before editing | OBSERVED but stale in late modules |
| 4 | Current `DEPLOY_README.md`, `.env.example`, build metadata | Deployment intent and operational procedure | PROPOSED/IMPLEMENTATION-DOCUMENTED; must be verified in staging |
| 5 | Inferences from conflicts / missing traces | Hypotheses used to design investigation gates | INFERRED |
| 6 | New code or business semantics not supported by evidence | Only allowed after explicit architecture/behavior approval | PROPOSED |

The evidence policy in the supplied delivery brief requires behavior to be labeled OBSERVED, CONFIRMED, INFERRED, PROPOSED, UNKNOWN or CONFLICTING rather than silently promoted to fact. fileciteturn0file0L109-L118

## 4. Current candidate implementation — exact findings

### 4.1 Frontend
- The active `dist/index.html` references `index-B6jCMuG_.js` and `index-CCBqssT9.css` as the live frontend entry assets.
- `bill-print-ui-20260929.zip` contains the same B6 JavaScript, CSS, Leaflet asset, `index.html` and `sw.js` hashes as `dist (1).zip`; therefore the two packages share the same frontend build and should not be maintained as two independent UI implementations.
- A legacy/alternate bundle `index-Cz4falgD.js` contains React development metadata pointing to 116 original source files, including `App.tsx`, `AppShell`, navigation, Dashboard, POS, billing, KDS, inventory, reports, platform admin, realtime and print components.
- The current candidate route string surface is materially different from the reference route model. Representative paths are `/dashboard`, `/orders`, `/pos`, `/billing`, `/reports/finance`, `/settings/restaurant`, `/settings/printing`, `/work/dine-in`, `/kitchen`, and `/profile`-style surfaces rather than canonical `/en/...` RestroX paths.
- The current brand is MIH DineOS, while the reference evidence uses RestroX page titles/labels. Branding must be treated as a product-identity decision, not silently changed in code.

### 4.2 Backend
- Node/TypeScript Express runtime, with Socket.IO realtime and production startup checks.
- `/api/v1` is the primary versioned API prefix. Health endpoints are `/api/health` and `/api/ready` in deployment documentation; the versioned migration-status endpoint is `/api/v1/system/migrations/status`.
- Security configuration is intentionally strict in production: placeholder JWT secrets, wildcard/missing origins, insecure cookies, legacy state, invalid Platform Admin bootstrap and invalid SMTP/support combinations can block startup.
- Production rate limits are process-local in the current implementation. The deployment README therefore recommends one Node process for the first rollout.
- Tenant scoping and permission checks are present in the candidate implementation, but they still require exhaustive endpoint-to-permission tests before production sign-off.
- The candidate billing service uses transaction boundaries, captured/reversed payments and reconciliation-oriented reporting logic. This is strong evidence of an implementation direction, but it is still subject to independent contract and reference validation.

### 4.3 Printing
- Current compiled runtime includes durable printing, queue/retry/failover logic, receipt/KOT renderers, printer diagnostics, printer selection, station routing, print-agent credentials/pairing and realtime agent gateway.
- Runtime-only printing methods are six endpoints: five print/reprint/job-list methods plus one print-agent pairing exchange method.
- Runtime migrations 065–070 establish printer domain enhancements, durable print jobs, print-agent foundation, manual permissions, pairing tokens and failover metadata.
- Physical printer output is not yet proven by the evidence package and remains a mandatory staging/onsite gate.

### 4.4 Database
- Current SQL implementation is MySQL-specific: `mysql2`, port 3306 defaults, `AUTO_INCREMENT`, `ENGINE=InnoDB`, `utf8mb4`, and MySQL migration constructs are used.
- The source map has migrations 001–064; the compiled runtime registers 065–070. This mismatch makes the current source map unsafe as the sole build source.
- The migration runner uses a database lock and migration checksums. Production deployment should preserve that mechanism and must not mutate migration-history rows manually.

## 5. Canonical reference route inventory — all 142 routes

| ID | Reference route | Evidence status | Implementation phase | Current candidate exact-route status |
|---|---|---|---:|---|
| PAGE-001 | `/en/analytics` | observed | P26 | Not proven in active candidate `/en/*` route surface |
| PAGE-002 | `/en/analytics/finance` | observed | P26 | Not proven in active candidate `/en/*` route surface |
| PAGE-003 | `/en/analytics/order` | observed | P26 | Not proven in active candidate `/en/*` route surface |
| PAGE-004 | `/en/settings` | observed | P27 | Not proven in active candidate `/en/*` route surface |
| PAGE-005 | `/en/settings/notification` | observed | P27 | Not proven in active candidate `/en/*` route surface |
| PAGE-006 | `/en/settings/activity-log` | route-observed | P27 | Not proven in active candidate `/en/*` route surface |
| PAGE-007 | `/en/settings/billing-and-subscription` | read-only-observed | P53 | Not proven in active candidate `/en/*` route surface |
| PAGE-008 | `/en/settings/user-role` | interactive-ui-observed | P27 | Not proven in active candidate `/en/*` route surface |
| PAGE-009 | `/en/settings/trash` | read-only-observed | P53 | Not proven in active candidate `/en/*` route surface |
| PAGE-010 | `/en/settings/migrated-data` | interactive-ui-observed | P53 | Not proven in active candidate `/en/*` route surface |
| PAGE-011 | `/en/settings/integrations` | read-only-observed | P27 | Not proven in active candidate `/en/*` route surface |
| PAGE-012 | `/en/settings/invoice` | interactive-ui-observed | P27 | Not proven in active candidate `/en/*` route surface |
| PAGE-013 | `/en/settings/kot-setting` | interactive-ui-observed | P27 | Not proven in active candidate `/en/*` route surface |
| PAGE-014 | `/en/settings/order-slip-setting` | interactive-ui-observed | P27 | Not proven in active candidate `/en/*` route surface |
| PAGE-015 | `/en/settings/printer` | interactive-ui-observed | P50 | Not proven in active candidate `/en/*` route surface |
| PAGE-016 | `/en/settings/support-and-feedback` | interactive-ui-observed | P53 | Not proven in active candidate `/en/*` route surface |
| PAGE-017 | `/en/settings/release-notes` | interactive-ui-observed | P53 | Not proven in active candidate `/en/*` route surface |
| PAGE-018 | `/en/orders` | observed | P31 | Not proven in active candidate `/en/*` route surface |
| PAGE-019 | `/en/orders/table` | observed | P31 | Not proven in active candidate `/en/*` route surface |
| PAGE-020 | `/en/orders/kot` | observed | P34 | Not proven in active candidate `/en/*` route surface |
| PAGE-021 | `/en/orders/:orderId` | interactive-ui-observed | P31 | Not proven in active candidate `/en/*` route surface |
| PAGE-022 | `/en/notification` | title-observed | P35 | Not proven in active candidate `/en/*` route surface |
| PAGE-023 | `/en/finance/transactions` | title-observed | P40 | Not proven in active candidate `/en/*` route surface |
| PAGE-024 | `/en/reports` | title-observed | P43 | Not proven in active candidate `/en/*` route surface |
| PAGE-025 | `/en/services/restrolink` | interactive-ui-observed | P52 | Not proven in active candidate `/en/*` route surface |
| PAGE-026 | `/en/customer` | title-observed | P28 | Not proven in active candidate `/en/*` route surface |
| PAGE-027 | `/en/staff` | interactive-ui-observed | P28 | Not proven in active candidate `/en/*` route surface |
| PAGE-028 | `/en/menu/dish-setup` | interactive-ui-observed | P29 | Not proven in active candidate `/en/*` route surface |
| PAGE-029 | `/en/menu/dish-setup/category` | interactive-ui-observed | P29 | Not proven in active candidate `/en/*` route surface |
| PAGE-030 | `/en/menu/dish-setup/add-ons` | interactive-ui-observed | P29 | Not proven in active candidate `/en/*` route surface |
| PAGE-031 | `/en/menu/menu-setup/menu-set` | interactive-ui-observed | P29 | Not proven in active candidate `/en/*` route surface |
| PAGE-032 | `/en/menu/menu-setup/sub-menu` | interactive-ui-observed | P29 | Not proven in active candidate `/en/*` route surface |
| PAGE-033 | `/en/menu/combo-offer` | interactive-ui-observed | P29 | Not proven in active candidate `/en/*` route surface |
| PAGE-034 | `/en/services/dine-in` | interactive-ui-observed | P52 | Not proven in active candidate `/en/*` route surface |
| PAGE-035 | `/en/services/delivery` | interactive-ui-observed | P52 | Not proven in active candidate `/en/*` route surface |
| PAGE-036 | `/en/services/sms` | interactive-ui-observed | P52 | Not proven in active candidate `/en/*` route surface |
| PAGE-037 | `/en/services/loyalty-and-rewards` | interactive-ui-observed | P52 | Not proven in active candidate `/en/*` route surface |
| PAGE-038 | `/en/services/connect` | interactive-ui-observed | P52 | Not proven in active candidate `/en/*` route surface |
| PAGE-039 | `/en/services/setting` | interactive-ui-observed | P52 | Not proven in active candidate `/en/*` route surface |
| PAGE-040 | `/en/table-and-space/table` | interactive-ui-observed | P30 | Not proven in active candidate `/en/*` route surface |
| PAGE-041 | `/en/table-and-space/space` | interactive-ui-observed | P30 | Not proven in active candidate `/en/*` route surface |
| PAGE-042 | `/en/table-and-space/qr-codes` | interactive-ui-observed | P30 | Not proven in active candidate `/en/*` route surface |
| PAGE-043 | `/en/inventory/stock-item` | synthetic-crud-observed | P44 | Not proven in active candidate `/en/*` route surface |
| PAGE-044 | `/en/inventory/consumption` | read-only-ui-observed-backend-unverified | P45 | Not proven in active candidate `/en/*` route surface |
| PAGE-045 | `/en/inventory/suppliers` | workflow-observed | P44 | Not proven in active candidate `/en/*` route surface |
| PAGE-046 | `/en/inventory/measuring-unit` | synthetic-crud-observed-backend-unverified | P44 | Not proven in active candidate `/en/*` route surface |
| PAGE-047 | `/en/inventory/stock-group` | synthetic-crud-observed-backend-unverified | P44 | Not proven in active candidate `/en/*` route surface |
| PAGE-048 | `/en/inventory/stock-history` | read-only-ui-observed-backend-unverified | P46 | Not proven in active candidate `/en/*` route surface |
| PAGE-049 | `/en/inventory/batch-production` | interactive-ui-observed-backend-unverified | P47 | Not proven in active candidate `/en/*` route surface |
| PAGE-050 | `/en/restrox` | observed | P18 | Not proven in active candidate `/en/*` route surface |
| PAGE-051 | `/en/orders/kot-history` | interactive-ui-observed | P34 | Not proven in active candidate `/en/*` route surface |
| PAGE-052 | `/en/settings/kot-setting/setting` | interactive-ui-observed | P27 | Not proven in active candidate `/en/*` route surface |
| PAGE-053 | `/en/orders/cancelled-history` | interactive-ui-observed | P39 | Not proven in active candidate `/en/*` route surface |
| PAGE-054 | `/en/orders/cancellation-reasons` | interactive-ui-observed | P39 | Not proven in active candidate `/en/*` route surface |
| PAGE-055 | `/en/reservations` | interactive-ui-observed | P32 | Not proven in active candidate `/en/*` route surface |
| PAGE-056 | `/en/orders/pos-mode` | workflow-observed | P33 | Not proven in active candidate `/en/*` route surface |
| PAGE-057 | `/en/orders/kds-mode` | workflow-observed-with-possible-status-transition | P34 | Not proven in active candidate `/en/*` route surface |
| PAGE-059 | `/en/notification/activity` | workflow-observed | P35 | Not proven in active candidate `/en/*` route surface |
| PAGE-060 | `/en/menu/dish-setup/add-dish` | interactive-ui-observed | P29 | Not proven in active candidate `/en/*` route surface |
| PAGE-061 | `/en/services/connect/connect-banner` | empty-state-observed | P52 | Not proven in active candidate `/en/*` route surface |
| PAGE-062 | `/en/finance/day-book` | workflow-observed | P40 | Not proven in active candidate `/en/*` route surface |
| PAGE-063 | `/en/finance/journal-voucher` | empty-state-observed | P41 | Not proven in active candidate `/en/*` route surface |
| PAGE-064 | `/en/finance/sales-and-purchase` | workflow-observed | P41 | Not proven in active candidate `/en/*` route surface |
| PAGE-065 | `/en/finance/sales-and-purchase/purchase-bills` | workflow-observed | P41 | Not proven in active candidate `/en/*` route surface |
| PAGE-066 | `/en/finance/income` | empty-state-observed | P41 | Not proven in active candidate `/en/*` route surface |
| PAGE-067 | `/en/finance/expenses` | empty-state-observed | P41 | Not proven in active candidate `/en/*` route surface |
| PAGE-068 | `/en/finance/payments` | empty-state-observed | P41 | Not proven in active candidate `/en/*` route surface |
| PAGE-069 | `/en/finance/cash-and-banks` | workflow-observed | P41 | Not proven in active candidate `/en/*` route surface |
| PAGE-070 | `/en/finance/tax-and-rates` | workflow-observed | P41 | Not proven in active candidate `/en/*` route surface |
| PAGE-071 | `/en/finance/balance-transfer` | empty-state-observed | P41 | Not proven in active candidate `/en/*` route surface |
| PAGE-072 | `/en/finance/reports/account-heads` | workflow-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-073 | `/en/finance/reports` | workflow-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-074 | `/en/finance/reports/general-ledger` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-075 | `/en/finance/reports/trial-balance` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-076 | `/en/finance/reports/income-statement` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-077 | `/en/finance/reports/balance-sheet` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-078 | `/en/finance/reports/general-ledger-master` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-079 | `/en/finance/reports/payment-mode-summary` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-080 | `/en/finance/reports/tax-report/sales-register` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-081 | `/en/finance/reports/tax-report/sales-return-register` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-082 | `/en/finance/reports/tax-report/purchase-register` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-083 | `/en/finance/reports/tax-report/purchase-return-register` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-084 | `/en/finance/reports/tax-report/vat-summary-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-085 | `/en/finance/reports/tax-report/annex-13-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-086 | `/en/finance/reports/tax-report/annex-5-materialized-view-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-087 | `/en/finance/reports/sales-master-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-088 | `/en/finance/reports/customerwise-monthly-sales` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-089 | `/en/finance/reports/invoicewise-complimentary-discount-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-090 | `/en/finance/reports/sales-collection-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-091 | `/en/finance/reports/daily-sales-summary` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-092 | `/en/finance/reports/party-balance-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-093 | `/en/finance/reports/party-receivable-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-094 | `/en/finance/reports/party-payable-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-095 | `/en/finance/reports/balance-confirmation-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-096 | `/en/finance/reports/purchase-vat-reconciliation` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-097 | `/en/finance/reports/purchase-by-supplier` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-098 | `/en/finance/reports/purchase-return-by-supplier` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-099 | `/en/finance/reports/purchase-by-item` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-100 | `/en/finance/reports/purchase-return-by-item` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-101 | `/en/finance/reports/purchase-by-supplier-monthly` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-102 | `/en/finance/reports/purchase-return-by-supplier-monthly` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-103 | `/en/finance/reports/purchase-by-item-monthly` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-104 | `/en/finance/reports/purchase-return-by-item-monthly` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-105 | `/en/user/restaurants` | interactive-ui-observed | P21 | Not proven in active candidate `/en/*` route surface |
| PAGE-106 | `/en/staff/pending` | empty-state-observed | P28 | Not proven in active candidate `/en/*` route surface |
| PAGE-107 | `/en/staff/removed` | empty-state-observed | P28 | Not proven in active candidate `/en/*` route surface |
| PAGE-108 | `/en/settings/kot-setting/setting` | interactive-ui-observed | P27 | Not proven in active candidate `/en/*` route surface |
| PAGE-109 | `/en/settings/kot-setting/kitchen-assignment` | interactive-ui-observed | P27 | Not proven in active candidate `/en/*` route surface |
| PAGE-110 | `/en/services/delivery/:platformId` | interactive-ui-observed | P52 | Not proven in active candidate `/en/*` route surface |
| PAGE-111 | `/en/orders/cancelled-history/kot` | interactive-ui-observed | P39 | Not proven in active candidate `/en/*` route surface |
| PAGE-112 | `/en/orders/cancelled-history/dish` | interactive-ui-observed | P39 | Not proven in active candidate `/en/*` route surface |
| PAGE-113 | `/en/reservations/booking` | empty-state-observed | P32 | Not proven in active candidate `/en/*` route surface |
| PAGE-114 | `/en/reservations/completed` | empty-state-observed | P32 | Not proven in active candidate `/en/*` route surface |
| PAGE-115 | `/en/reservations/cancelled` | empty-state-observed | P32 | Not proven in active candidate `/en/*` route surface |
| PAGE-116 | `/en/finance/reports/complimentary-items-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-117 | `/en/finance/reports/complimentary-addon-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-118 | `/en/finance/reports/salesby-submenu` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-119 | `/en/finance/reports/submenuwise-monthly-sales-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-120 | `/en/finance/reports/category-quantity-sales` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-121 | `/en/finance/reports/categorywise-monthly-sales` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-122 | `/en/finance/reports/dish-monthly-sales` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-123 | `/en/finance/reports/dish-quantity-sales` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-124 | `/en/finance/reports/kot-type-wise-sales` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-125 | `/en/finance/reports/food-cost-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-126 | `/en/finance/reports/menuset-wise-sales` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-127 | `/en/finance/reports/stock-item-ledger-summary` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-128 | `/en/finance/reports/stock-reconciliation-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-129 | `/en/finance/reports/stock-ageing-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-130 | `/en/finance/reports/stock-movement-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-131 | `/en/finance/reports/stock-position-report` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-132 | `/en/services/restrolink/share-my-menu` | interactive-ui-observed | P52 | Not proven in active candidate `/en/*` route surface |
| PAGE-133 | `/en/services/restrolink/appearance` | interactive-ui-observed | P52 | Not proven in active candidate `/en/*` route surface |
| PAGE-134 | `/en/customer/groups` | interactive-ui-observed | P28 | Not proven in active candidate `/en/*` route surface |
| PAGE-135 | `/en/settings/migrated-data/sales-register` | interactive-ui-observed | P53 | Not proven in active candidate `/en/*` route surface |
| PAGE-136 | `/en/settings/migrated-data/sales-return-register` | interactive-ui-observed | P53 | Not proven in active candidate `/en/*` route surface |
| PAGE-137 | `/en/settings/migrated-data/purchase-register` | interactive-ui-observed | P53 | Not proven in active candidate `/en/*` route surface |
| PAGE-138 | `/en/settings/migrated-data/purchase-return-register` | interactive-ui-observed | P53 | Not proven in active candidate `/en/*` route surface |
| PAGE-139 | `/en/orders/pos-mode/active-orders` | read-only-ui-observed | P33 | Not proven in active candidate `/en/*` route surface |
| PAGE-140 | `/en/orders/pos-mode/table` | read-only-ui-observed | P33 | Not proven in active candidate `/en/*` route surface |
| PAGE-141 | `/en/orders/pos-mode/kot` | read-only-ui-observed | P33 | Not proven in active candidate `/en/*` route surface |
| PAGE-142 | `/en/finance/reports/sales-ledger/:accountId` | report-ui-observed | P42 | Not proven in active candidate `/en/*` route surface |
| PAGE-143 | `/en/inventory/stock-transfer` | read-only-ui-observed-no-eligible-destination | P46 | Not proven in active candidate `/en/*` route surface |

### Route normalization exceptions
- `PAGE-058` is absent from the numbered route sequence. It must remain an explicit gap marker rather than be invented.
- `PAGE-052` and `PAGE-108` both point to `/en/settings/kot-setting/setting`. These must resolve to one canonical route component with compatibility aliases, not two divergent implementations.
- `PAGE-143` is valid evidence for `/en/inventory/stock-transfer` even though it extends the historical sequence beyond `PAGE-142`.
- Dynamic routes such as `/en/orders/:orderId`, `/en/services/delivery/:platformId`, and `/en/finance/reports/sales-ledger/:accountId` require parameter-contract tests, not just path-existence tests.

## 6. Current candidate frontend compatibility surface

The compiled debug bundle contains the following explicit path strings. These are **candidate implementation routes**, not the reference route inventory:

- `/billing`
- `/dashboard`
- `/engine.io`
- `/kitchen`
- `/management`
- `/management/customers`
- `/management/departments`
- `/management/inventory`
- `/management/menu`
- `/management/staff`
- `/operations/shift`
- `/orders`
- `/pos`
- `/reports/branches`
- `/reports/controls`
- `/reports/finance`
- `/reports/performance`
- `/reports/sales`
- `/reports/transactions`
- `/service`
- `/settings/activity-log`
- `/settings/dining`
- `/settings/general`
- `/settings/payment-methods`
- `/settings/printing`
- `/settings/restaurant`
- `/settings/stations`
- `/socket.io`
- `/system/audit-log`
- `/tables`
- `/work/billing`
- `/work/cashier/billing`
- `/work/cashier/orders`
- `/work/cashier/sales`
- `/work/cashier/shift`
- `/work/dine-in`
- `/work/orders`
- `/work/sales`
- `/work/shift`
- `/work/takeaway`

The route gateway phase must therefore implement canonical RestroX `/en/...` routes and may expose candidate DineOS paths as aliases only where beneficial and approved. A manual `if/else pathname` router is not acceptable for the final system.

## 7. Backend API surface

### Count and reconciliation
- Mounted application router methods reconstructed from source-map code: **243** including health, migration status and menu upload methods; legacy state methods are listed separately.
- Legacy `/state/:key` compatibility methods: **4**, which must be disabled in production unless a specific migration/compatibility gate requires them.
- Compiled-only printing/print-agent methods: **6**.
- Total explicit methods in the reconciled runtime model: **253**.

### Endpoint inventory (current candidate implementation)

| Method | Path | Router/source | Evidence note |
|---|---|---|---|
| GET | `/activity-logs/` | `activityLogRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/alert-settings/` | `alertSettingsRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/alert-settings/` | `alertSettingsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/alerts/` | `alertsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/alerts/:id` | `alertsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/auth/access-status` | `authRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/auth/activation-request` | `authRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/auth/activation-request` | `authRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/auth/change-password` | `authRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/auth/forgot-password` | `passwordResetRouter` / `passwordReset.ts` | Candidate implementation endpoint. |
| POST | `/auth/handle-availability` | `authRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/auth/handle-suggestions` | `authRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/auth/lock-staff` | `authRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/auth/login` | `authRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/auth/logout` | `authRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/auth/me` | `authRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/auth/register` | `authRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/auth/reset-password` | `passwordResetRouter` / `passwordReset.ts` | Candidate implementation endpoint. |
| POST | `/auth/switch-branch` | `authRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/billing/bills/:id` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/billing/bills/:id/invoice` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/billing/bills/:id/payments` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/billing/bills/:id/payments` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/billing/bills/:id/receipt` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/billing/bills/:id/settle` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/billing/bills/:id/settlement` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/billing/credit/:receivableId/repay` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/billing/credit/accounts` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/billing/customers` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/billing/customers` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/billing/customers/:customerId/credit` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/billing/orders/:orderId` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/billing/orders/:orderId/bills` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/billing/orders/:orderId/discount` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/billing/orders/:orderId/finalize` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/billing/orders/:orderId/preview` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/billing/orders/:orderId/split` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/billing/payments/:id/reverse` | `billingRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/branches/` | `branchesRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/branches/` | `branchesRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/branches/:id` | `branchesRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/branches/:id` | `branchesRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/complimentary-orders/` | `complimentaryOrderRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/dining-sessions/orders/:orderId/tables` | `multiTableDiningRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/dining-sessions/tables` | `multiTableDiningRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/dining-sessions/tables/:tableId/order` | `multiTableDiningRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/expenses/` | `expenseRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/expenses/` | `expenseRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/expenses/:id` | `expenseRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/expenses/:id` | `expenseRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/expenses/:id/post` | `expenseRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/expenses/:id/void` | `expenseRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/expenses/categories` | `expenseRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/expenses/categories` | `expenseRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/expenses/categories/:id` | `expenseRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/expenses/summary` | `expenseRouter` / `router.ts` | Candidate implementation endpoint. |
| DELETE | `/floors/:id` | `floorsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/floors/:id` | `floorsRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/floors/:id` | `floorsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/health` | `healthRouter` / `health.ts` | Candidate implementation endpoint. |
| GET | `/inventory/availability` | `stockRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/inventory/items` | `stockRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/inventory/items` | `stockRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/inventory/items/:id` | `stockRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/inventory/items/:id` | `stockRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/inventory/items/:id/adjust` | `stockRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/inventory/items/:id/menu-links` | `stockRouter` / `router.ts` | Candidate implementation endpoint. |
| PUT | `/inventory/items/:id/menu-links` | `stockRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/inventory/items/:id/stock-in` | `stockRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/inventory/menu-items/:menuItemId/dependencies` | `stockRouter` / `router.ts` | Candidate implementation endpoint. |
| PUT | `/inventory/menu-items/:menuItemId/dependencies` | `stockRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/inventory/movements` | `stockRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/inventory/transfers` | `stockRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/kitchen/ticket-items/:itemId/status` | `kitchenRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/kitchen/tickets` | `kitchenRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/kitchen/tickets/:id` | `kitchenRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/kitchen/tickets/:id/status` | `kitchenRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/management/customers` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/management/customers` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/management/customers/:id` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/management/customers/:id/memberships` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/management/customers/:id/orders` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/management/departments` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/management/departments` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/management/departments/:id` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/management/memberships` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/management/memberships` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/management/memberships/:id` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/management/memberships/:id/usage` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/management/memberships/:id/usage` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/management/menu-items/:id/department` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/management/roles` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| PUT | `/management/roles/:roleId/permissions` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/management/staff/:userId/access` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| PUT | `/management/staff/:userId/access` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/management/tables/:tableId/waiter` | `managementRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/menu/categories/` | `menuCategoriesRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/menu/categories/` | `menuCategoriesRouter` / `router.ts` | Candidate implementation endpoint. |
| DELETE | `/menu/categories/:id` | `menuCategoriesRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/menu/categories/:id` | `menuCategoriesRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/menu/categories/:id` | `menuCategoriesRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/menu/items/` | `menuItemsRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/menu/items/` | `menuItemsRouter` / `router.ts` | Candidate implementation endpoint. |
| DELETE | `/menu/items/:id` | `menuItemsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/menu/items/:id` | `menuItemsRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/menu/items/:id` | `menuItemsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/menu/items/:id/combo-components` | `menuItemsRouter` / `router.ts` | Candidate implementation endpoint. |
| PUT | `/menu/items/:id/combo-components` | `menuItemsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/menu/items/:itemId/customizations` | `menuCustomizationRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/menu/items/:itemId/modifier-groups` | `menuCustomizationRouter` / `router.ts` | Candidate implementation endpoint. |
| DELETE | `/menu/items/:itemId/modifier-groups/:groupId` | `menuCustomizationRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/menu/modifier-groups` | `menuCustomizationRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/menu/modifier-groups` | `menuCustomizationRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/menu/modifier-groups/:id` | `menuCustomizationRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/menu/modifier-options` | `menuCustomizationRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/menu/modifier-options/:id` | `menuCustomizationRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/menu/uploads/image` | `menuUploadsRouter` / `menuUploads.ts` | Candidate implementation endpoint. |
| POST | `/menu/variants` | `menuCustomizationRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/menu/variants/:id` | `menuCustomizationRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/operational-settings/` | `operationalSettingsRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/operational-settings/` | `operationalSettingsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/orders/` | `ordersRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/orders/` | `ordersRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/orders/:id` | `ordersRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/orders/:id/cancel` | `ordersRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/orders/:id/complete` | `ordersRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/orders/:id/items` | `ordersRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/orders/:id/move-items` | `ordersRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/orders/:id/pickup` | `ordersRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/orders/:id/rounds/:roundId/cancel` | `ordersRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/orders/:id/serve` | `ordersRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/orders/:id/service-items/:itemId/serve` | `ordersRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/orders/:id/status` | `ordersRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/orders/service-ready` | `ordersRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/organizations/current` | `organizationsRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/organizations/current` | `organizationsRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/organizations/current/starter-pack/dismiss` | `organizationsRouter` / `router.ts` | Candidate implementation endpoint. |
| DELETE | `/organizations/current/starter-pack/samples` | `organizationsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/payment-methods/` | `paymentMethodsRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/payment-methods/` | `paymentMethodsRouter` / `router.ts` | Candidate implementation endpoint. |
| DELETE | `/payment-methods/:id` | `paymentMethodsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/payment-methods/:id` | `paymentMethodsRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/payment-methods/:id` | `paymentMethodsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/platform/activation-requests/` | `platformActivationRequestsRouter` / `activationRequestReadRouter.ts` | Candidate implementation endpoint. |
| GET | `/platform/activation-requests/:requestId` | `platformActivationRequestsRouter` / `activationRequestReadRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/activation-requests/:requestId/approve` | `platformActivationRequestsRouter` / `activationRequestReadRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/activation-requests/:requestId/approve-until` | `platformActivationRequestsRouter` / `activationRequestReadRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/activation-requests/:requestId/reject` | `platformActivationRequestsRouter` / `activationRequestReadRouter.ts` | Candidate implementation endpoint. |
| GET | `/platform/audit-logs/` | `platformAuditRouter` / `platformAuditRouter.ts` | Candidate implementation endpoint. |
| GET | `/platform/audit-logs/:auditId` | `platformAuditRouter` / `platformAuditRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/auth/change-password` | `platformAuthRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/platform/auth/login` | `platformAuthRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/platform/auth/logout` | `platformAuthRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/platform/auth/me` | `platformAuthRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/platform/organizations/` | `platformOrganizationsRouter` / `organizationReadRouter.ts` | Candidate implementation endpoint. |
| GET | `/platform/organizations/:organizationId` | `platformOrganizationsRouter` / `organizationReadRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/organizations/:organizationId/access-expiry` | `platformOrganizationsRouter` / `organizationReadRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/organizations/:organizationId/cancel` | `platformOrganizationsRouter` / `organizationReadRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/organizations/:organizationId/grace/extend` | `platformOrganizationsRouter` / `organizationReadRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/organizations/:organizationId/lifecycle/activate` | `platformOrganizationsRouter` / `organizationReadRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/organizations/:organizationId/lifecycle/end-grace` | `platformOrganizationsRouter` / `organizationReadRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/organizations/:organizationId/lifecycle/reactivate` | `platformOrganizationsRouter` / `organizationReadRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/organizations/:organizationId/lifecycle/start-grace` | `platformOrganizationsRouter` / `organizationReadRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/organizations/:organizationId/lifecycle/suspend` | `platformOrganizationsRouter` / `organizationReadRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/organizations/:organizationId/security-suspension` | `platformOrganizationsRouter` / `organizationReadRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/organizations/:organizationId/security-suspension/clear` | `platformOrganizationsRouter` / `organizationReadRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/organizations/:organizationId/suspension-schedule` | `platformOrganizationsRouter` / `organizationReadRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/organizations/:organizationId/suspension-schedule/cancel` | `platformOrganizationsRouter` / `organizationReadRouter.ts` | Candidate implementation endpoint. |
| POST | `/platform/organizations/:organizationId/suspension-schedule/reschedule` | `platformOrganizationsRouter` / `organizationReadRouter.ts` | Candidate implementation endpoint. |
| DELETE | `/printers/:id` | `printersRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/printers/:id` | `printersRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/printers/:id` | `printersRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/ready` | `healthRouter` / `health.ts` | Candidate implementation endpoint. |
| GET | `/receipts/bills/:billId` | `receiptSettingsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/receipts/settings` | `receiptSettingsRouter` / `router.ts` | Candidate implementation endpoint. |
| PUT | `/receipts/settings` | `receiptSettingsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/branches` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/complimentary` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/controls` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/dashboard` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/departments` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/expenses` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/financial` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/fnb` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/fnb/options` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/occupancy` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/occupancy/options` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/payments` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/sales` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/shifts` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/staff` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/tax` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/transactions` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/reports/transactions/:billId` | `reportsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/roles/` | `rolesRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/roles/` | `rolesRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/roles/:id` | `rolesRouter` / `router.ts` | Candidate implementation endpoint. |
| DELETE | `/sections/:id` | `sectionsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/sections/:id` | `sectionsRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/sections/:id` | `sectionsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/shift-ops/` | `shiftRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/shift-ops/` | `shiftRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/shift-ops/:id` | `shiftRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/shift-ops/:id/cash-movements` | `shiftRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/shift-ops/:id/cash-movements` | `shiftRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/shift-ops/:id/close` | `shiftRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/shift-ops/:id/summary` | `shiftRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/shift-ops/business-days` | `shiftRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/shift-ops/business-days/:id` | `shiftRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/shift-ops/business-days/:id/close` | `shiftRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/shift-ops/business-days/current` | `shiftRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/shift-ops/business-days/open` | `shiftRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/shift-ops/current` | `shiftRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/shift-ops/registers` | `shiftRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/shift-ops/registers` | `shiftRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/shift-ops/registers/:id` | `shiftRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/staff-permissions/:userId` | `staffPermissionsRouter` / `router.ts` | Candidate implementation endpoint. |
| PUT | `/staff-permissions/:userId` | `staffPermissionsRouter` / `router.ts` | Candidate implementation endpoint. |
| DELETE | `/state/:key` | `state` / `state.ts` | Candidate implementation endpoint. |
| GET | `/state/:key` | `state` / `state.ts` | Candidate implementation endpoint. |
| POST | `/state/:key` | `state` / `state.ts` | Candidate implementation endpoint. |
| PUT | `/state/:key` | `state` / `state.ts` | Candidate implementation endpoint. |
| DELETE | `/stations/:id` | `stationsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/stations/:id` | `stationsRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/stations/:id` | `stationsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/system/migrations/status` | `system` / `index.ts` | Candidate implementation endpoint. |
| GET | `/table-allocations/` | `tableAllocationsRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/table-allocations/` | `tableAllocationsRouter` / `router.ts` | Candidate implementation endpoint. |
| DELETE | `/table-allocations/:id` | `tableAllocationsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/table-allocations/:id` | `tableAllocationsRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/table-allocations/:id` | `tableAllocationsRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/table-operations/merge` | `tableOperationsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/table-operations/overview` | `tableOperationsRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/table-operations/swap` | `tableOperationsRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/table-operations/transfer` | `tableOperationsRouter` / `router.ts` | Candidate implementation endpoint. |
| DELETE | `/tables/:id` | `tablesRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/tables/:id` | `tablesRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/tables/:id` | `tablesRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/units/` | `unitsRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/units/` | `unitsRouter` / `router.ts` | Candidate implementation endpoint. |
| DELETE | `/units/:id` | `unitsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/units/:id` | `unitsRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/units/:id` | `unitsRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/users/` | `usersRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/users/` | `usersRouter` / `router.ts` | Candidate implementation endpoint. |
| GET | `/users/:id` | `usersRouter` / `router.ts` | Candidate implementation endpoint. |
| PATCH | `/users/:id` | `usersRouter` / `router.ts` | Candidate implementation endpoint. |
| POST | `/printing/kots/:ticketId/print` | `printingRouter` / `server.cjs (compiled-only)` | Compiled-only runtime feature; requires source reconciliation. |
| POST | `/printing/bills/:billId/print` | `printingRouter` / `server.cjs (compiled-only)` | Compiled-only runtime feature; requires source reconciliation. |
| POST | `/printing/jobs/:jobId/reprint` | `printingRouter` / `server.cjs (compiled-only)` | Compiled-only runtime feature; requires source reconciliation. |
| GET | `/printing/kots/:ticketId/jobs` | `printingRouter` / `server.cjs (compiled-only)` | Compiled-only runtime feature; requires source reconciliation. |
| GET | `/printing/bills/:billId/jobs` | `printingRouter` / `server.cjs (compiled-only)` | Compiled-only runtime feature; requires source reconciliation. |
| POST | `/print-agent/pairing/exchange` | `printAgent` / `server.cjs (compiled-only)` | Compiled-only runtime feature; requires source reconciliation. |

### API groups
- `platform`: 26 methods in the current module-derived inventory
- `menu`: 23 methods in the current module-derived inventory
- `billing`: 19 methods in the current module-derived inventory
- `management`: 19 methods in the current module-derived inventory
- `reports`: 18 methods in the current module-derived inventory
- `shift-ops`: 16 methods in the current module-derived inventory
- `auth`: 14 methods in the current module-derived inventory
- `inventory`: 13 methods in the current module-derived inventory
- `orders`: 13 methods in the current module-derived inventory
- `expenses`: 10 methods in the current module-derived inventory
- `payment-methods`: 5 methods in the current module-derived inventory
- `table-allocations`: 5 methods in the current module-derived inventory
- `units`: 5 methods in the current module-derived inventory
- `branches`: 4 methods in the current module-derived inventory
- `kitchen`: 4 methods in the current module-derived inventory
- `organizations`: 4 methods in the current module-derived inventory
- `state`: 4 methods in the current module-derived inventory
- `table-operations`: 4 methods in the current module-derived inventory
- `users`: 4 methods in the current module-derived inventory
- `dining-sessions`: 3 methods in the current module-derived inventory
- `floors`: 3 methods in the current module-derived inventory
- `printers`: 3 methods in the current module-derived inventory
- `receipts`: 3 methods in the current module-derived inventory
- `roles`: 3 methods in the current module-derived inventory
- `sections`: 3 methods in the current module-derived inventory
- `stations`: 3 methods in the current module-derived inventory
- `tables`: 3 methods in the current module-derived inventory
- `alert-settings`: 2 methods in the current module-derived inventory
- `alerts`: 2 methods in the current module-derived inventory
- `operational-settings`: 2 methods in the current module-derived inventory
- `staff-permissions`: 2 methods in the current module-derived inventory
- `activity-logs`: 1 methods in the current module-derived inventory
- `complimentary-orders`: 1 methods in the current module-derived inventory
- `health`: 1 methods in the current module-derived inventory
- `ready`: 1 methods in the current module-derived inventory
- `system`: 1 methods in the current module-derived inventory

The plan requires an automated route-to-contract-to-permission matrix in P08/P22/P59. The current static counts are a starting inventory, not proof that every endpoint is covered by tests.

## 8. SQL entity model

### Current runtime table model (grouped conceptually)
**Identity & tenancy** (12):
`branches`, `memberships`, `organizations`, `password_reset_otps`, `permissions`, `role_permissions`, `roles`, `sessions`, `user_branches`, `user_permissions`, `user_section_access`, `users`
**Platform lifecycle** (9):
`lifecycle_automation_attention`, `organization_access_status_sessions`, `organization_activation_requests`, `organization_entitlements`, `organization_status_history`, `platform_admin_password_reset_otps`, `platform_admin_sessions`, `platform_admins`, `platform_audit_logs`
**Administration & dining** (11):
`branch_tax_configs`, `dining_tables`, `floors`, `hardware_printers`, `operational_settings`, `payment_methods`, `pending_order_table_claims`, `preparation_stations`, `sections`, `table_allocations`, `units_of_measure`
**Menu & recipes** (14):
`menu_categories`, `menu_combo_components`, `menu_item_modifier_groups`, `menu_item_stock_links`, `menu_item_variants`, `menu_items`, `modifier_groups`, `modifier_option_ingredient_impacts`, `modifier_options`, `order_item_recipe_snapshots`, `recipe_version_ingredients`, `recipe_versions`, `recipes`, `variant_ingredient_impacts`
**Orders & kitchen** (11):
`kitchen_ticket_items`, `kitchen_tickets`, `kot_number_counters`, `order_amendment_requests`, `order_item_recipe_snapshots`, `order_items`, `order_number_counters`, `order_operation_events`, `order_rounds`, `order_tables`, `orders`
**Billing & finance** (23):
`bill_lines`, `bill_settlement_attempts`, `bill_split_batches`, `bill_split_requests`, `bills`, `business_days`, `cash_movements`, `customer_credit_payments`, `customer_receivables`, `expense_categories`, `expenses`, `payments`, `purchase_order_items`, `purchase_order_sequences`, `purchase_orders`, `purchase_receipt_items`, `purchase_receipts`, `registers`, `shifts`, `supplier_contacts`, `supplier_item_price_history`, `supplier_items`, `suppliers`
**Inventory** (12):
`inventory_balances`, `inventory_categories`, `inventory_consumption_events`, `inventory_count_items`, `inventory_counts`, `inventory_items`, `inventory_locations`, `inventory_movements`, `stock_dependencies`, `stock_items`, `stock_movements`, `stock_transfers`
**Audit/alerts** (5):
`activity_logs`, `alert_auth_failure_windows`, `alert_settings`, `alerts`, `domain_audit_events`
**Printing** (3):
`print_agent_pairing_tokens`, `print_agents`, `print_jobs`

### Full table list
`activity_logs`, `alert_auth_failure_windows`, `alert_settings`, `alerts`, `bill_lines`, `bill_settlement_attempts`, `bill_split_batches`, `bill_split_requests`, `bills`, `branch_tax_configs`, `branches`, `business_days`, `cash_movements`, `customer_credit_payments`, `customer_receivables`, `customers`, `departments`, `dining_tables`, `domain_audit_events`, `expense_categories`, `expenses`, `floors`, `hardware_printers`, `inventory_balances`, `inventory_categories`, `inventory_consumption_events`, `inventory_count_items`, `inventory_counts`, `inventory_items`, `inventory_locations`, `inventory_movements`, `kitchen_ticket_items`, `kitchen_tickets`, `kot_number_counters`, `lifecycle_automation_attention`, `membership_usages`, `memberships`, `menu_categories`, `menu_combo_components`, `menu_item_modifier_groups`, `menu_item_stock_links`, `menu_item_variants`, `menu_items`, `modifier_groups`, `modifier_option_ingredient_impacts`, `modifier_options`, `operational_settings`, `order_amendment_requests`, `order_item_recipe_snapshots`, `order_items`, `order_number_counters`, `order_operation_events`, `order_rounds`, `order_tables`, `orders`, `organization_access_status_sessions`, `organization_activation_requests`, `organization_entitlements`, `organization_status_history`, `organizations`, `password_reset_otps`, `payment_methods`, `payments`, `pending_order_table_claims`, `permissions`, `platform_admin_password_reset_otps`, `platform_admin_sessions`, `platform_admins`, `platform_audit_logs`, `preparation_stations`, `print_agent_pairing_tokens`, `print_agents`, `print_jobs`, `purchase_order_items`, `purchase_order_sequences`, `purchase_orders`, `purchase_receipt_items`, `purchase_receipts`, `recipe_version_ingredients`, `recipe_versions`, `recipes`, `registers`, `role_permissions`, `roles`, `sections`, `sessions`, `shifts`, `stock_dependencies`, `stock_items`, `stock_movements`, `stock_transfers`, `supplier_contacts`, `supplier_item_price_history`, `supplier_items`, `suppliers`, `table_allocations`, `units_of_measure`, `user_branches`, `user_permissions`, `user_section_access`, `user_table_access`, `users`, `variant_ingredient_impacts`

### Database policy
- Do not add a table simply because a screenshot contains a concept. Every persisted entity must trace to an observed/approved workflow or a necessary integrity boundary.
- Every reporting query must document source tables, joins, date handling, timezone, grouping, aggregation, null behavior, currency/rounding, pagination/max result size, indexes and performance expectations.
- All financial and inventory mutations require parameterized SQL, explicit transaction boundaries and authorization derived from the authenticated tenant/branch rather than request-body tenant IDs.
- A PostgreSQL port is a separate migration program if MySQL is not approved. No hybrid engine is acceptable.

## 9. Major conflicts, unknowns and risk register

| ID | Severity | Topic | Finding | Status | Phase | Closure |
|---|---|---|---|---|---:|---|
| C-01 | Critical | Receipt/invoice terminology | Finance indicates Paid while receipt evidence still shows ESTIMATE semantics. | Observed conflict | P12/P38/P49 | Define document-state machine and tax policy before release. |
| C-02 | Critical | Void/delete semantics | UI wording described irreversible deletion while financial integrity requires audited reversal semantics. | Observed conflict | P09/P12/P39 | Replace with reversible/authorized void policy unless owner confirms true delete. |
| C-03 | High | Purchase bill paid status | List-level Paid state conflicted with edit draft unpaid amount. | Observed conflict | P39/P48/P49 | Define paid/unpaid source-of-truth and reconcile draft vs posted bill. |
| C-04 | High | POS → Orders/KOT/KDS visibility | Settlement/checkout state did not always reconcile across modules. | Observed conflict | P31-P37/P49 | Golden transaction must be traceable across all domains. |
| C-05 | High | Staff removal/recovery | Warning, Removed view countdown and Restore semantics conflicted in observation. | Observed conflict | P28/P39 | Define lifecycle states and retention timing. |
| C-06 | Medium | Delivery status | Different surfaces displayed inconsistent delivery status. | Observed conflict | P31/P52 | Single authoritative delivery state + event propagation. |
| C-07 | Medium | Stock group counts | Summary count lagged row-level linked-item state after synthetic mutation. | Observed conflict | P44/P46/P49 | Fix cache/invalidation or aggregate query semantics. |
| C-08 | Medium | Table creation | Add New Table workflow failed to open during observation. | Observed blocker | P30/P56/P58 | Make route/action reproducible in automated E2E. |
| C-09 | Medium | Stock transfer destination | Observed tenant had no eligible destination for transfer. | Evidence gap | P46 | Fixture two branches/locations for transfer validation. |
| C-10 | Medium | POS first-render/filter timing | Initial catalog/filter interaction sometimes rendered late. | Observed behavior, cause unknown | P33/P56/P61 | Instrument load timing and deterministic query hydration. |
| C-11 | High | Source map lag | Runtime includes migrations 065–070 and print modules not present in server.cjs.map. | Confirmed from artifact comparison | P7/P13/P15 | Rebuild a synchronized source checkout. |
| C-12 | High | Frontend source absence | 116 source file paths are referenced by debug metadata, but original TS source files are not supplied. | Confirmed from artifact contents | P13-P19 | Obtain/recover canonical frontend source before production change control. |
| C-13 | High | MySQL approval | Current runtime is MySQL-specific while the brief requires PostgreSQL or another approved relational DB. | Confirmed implementation / governance gap | P10 | Owner decision gate. |
| C-14 | High | Printer physical output | Software diagnostics exist; physical print output remains unverified. | Confirmed evidence gap | P50-P51/P63 | Onsite printer test matrix. |
| C-15 | Medium | Trace evidence | No persisted Playwright traces; the new video is marketing footage. | Confirmed evidence gap | P6/P58 | Capture new event-by-event validation recordings. |

## 10. Complexity assessment

| Capability | Routes | Workflow density | Data risk | Security risk | Visual risk | Complexity |
|---|---:|---:|---|---|---|---|
| Analytics | 3 | Medium | High | Medium | High | HIGH |
| Settings/admin | 21 | High | High | High | Medium | HIGH |
| Orders/KOT/KDS/POS | 18 | Very high | Critical | High | Critical | CRITICAL |
| Finance + reports | 61 | Very high | Critical | Critical | High | CRITICAL |
| Inventory | 8 | High | Critical | High | High | CRITICAL |
| Services/integrations | 11 | Medium | High | High | Medium | HIGH |
| People/customer | 5 | Medium | High | High | Medium | HIGH |
| Platform admin (candidate) | — | High | High | Critical | Medium | CRITICAL |
| Printing/realtime | — | High | High | Critical | High | CRITICAL |
| Cross-system validation | 142 | 98 | Critical | Critical | Critical | CRITICAL |

The route count is high, but the dominant complexity comes from financial/inventory state integrity and the cross-domain workflows rather than simple page count.

## 11. Adaptive 64-phase implementation program

The phase lifecycle follows the supplied delivery policy: establish baseline, implement the scoped change, run type/lint/unit/integration/API/SQL/auth/accessibility/E2E/visual/performance/security checks, compare against evidence, record defects, fix and re-run, then close the phase only when stable/deployable. fileciteturn0file0L250-L372

### P01 — Evidence provenance & checksums
**Objective:** Freeze the evidence corpus and create immutable hashes, manifests and provenance records.
**Business capability:** Evidence governance
**Included:** No product-code changes; includes archive hashes, extraction logs and manifest generation.
**Dependencies:** Source archive files; prior inspection bundle.
**Evidence:** All
**Routes/components/files:** Repo: /validation/reference and /docs/analysis.
**SQL impact:** No DB.
**API impact:** N/A
**Security:** N/A
**Accessibility:** Prevent evidence contamination; redact secrets in derivative artifacts.
**Test plan:** Automated hash/count verification.
**Acceptance:** Create machine-readable manifest; no unresolved path/hash mismatch.
**Rollback:** Rollback by restoring prior manifest snapshot.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P02 — Canonical requirement model
**Objective:** Normalize observed, confirmed, inferred, proposed, unknown and conflicting behavior into a requirements ledger.
**Business capability:** Requirements governance
**Included:** Requirements matrix, conflict registry, evidence-confidence rules.
**Dependencies:** P1
**Evidence:** All
**Routes/components/files:** /docs/analysis/requirements
**SQL impact:** None
**API impact:** None
**Security:** N/A
**Accessibility:** Protect against untracked assumptions.
**Test plan:** Schema validation for requirements JSON.
**Acceptance:** Every requirement has provenance/status.
**Rollback:** Restore prior ledger version.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P03 — Route canon & compatibility map
**Objective:** Create the canonical 142-route reference model and map every route to implementation ownership plus aliases.
**Business capability:** Navigation architecture
**Included:** Exact /en routes, duplicate/missing-ID handling, alias policy.
**Dependencies:** P1-P2
**Evidence:** 142 reference routes
**Routes/components/files:** apps/web routing + /validation/reference/routes
**SQL impact:** No required schema change.
**API impact:** Route resolution/alias APIs if needed.
**Security:** Auth-gated routes follow evidence.
**Accessibility:** Keyboard/404/focus management.
**Test plan:** Route smoke suite.
**Acceptance:** 142 route IDs represented; no silent collisions.
**Rollback:** Revert route table/alias registry.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P04 — Workflow canonicalization
**Objective:** Turn 98 documented workflows and cross-module journeys into executable workflow definitions.
**Business capability:** Workflow model
**Included:** Given-state/action/expected-state model, data fixtures, blockers and confidence.
**Dependencies:** P1-P3
**Evidence:** 98 workflows
**Routes/components/files:** /tests/e2e /validation/reference/workflows
**SQL impact:** Fixture seed entities where required.
**API impact:** Test-only endpoints prohibited.
**Security:** Per-workflow permission preconditions.
**Accessibility:** Keyboard/pointer fidelity.
**Test plan:** Workflow schema + dry-run validator.
**Acceptance:** Every critical workflow has an executable skeleton.
**Rollback:** Disable failing workflow spec, not production behavior.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P05 — Screenshot baseline & viewport matrix
**Objective:** Build the visual evidence index from all 834 captures and define comparison cohorts.
**Business capability:** Visual validation
**Included:** Dimensions, module/state tags, duplicates, nearest matches, visual regions.
**Dependencies:** P1-P4
**Evidence:** All 834 screenshots
**Routes/components/files:** /validation/reference/screenshots
**SQL impact:** None
**API impact:** None
**Security:** Exclude secret/user-specific data.
**Accessibility:** Pixel diff + responsive cohorts.
**Test plan:** Baseline image manifest and golden set.
**Acceptance:** Golden set reproducible from source archive.
**Rollback:** Version golden-set manifest.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P06 — Video timeline & motion canon
**Objective:** Analyze the 8s product film and establish what it can and cannot validate; keep missing trace evidence explicit.
**Business capability:** Motion validation
**Included:** Frame timing, transition windows, film storyboard, missing interaction traces.
**Dependencies:** P1-P5
**Evidence:** New 8s MP4; historical video manifest.
**Routes/components/files:** /validation/reference/video
**SQL impact:** None
**API impact:** None
**Security:** No user data in derivative recordings.
**Accessibility:** Reduced-motion coverage.
**Test plan:** Frame extraction, metadata report.
**Acceptance:** Timeline report reproducible.
**Rollback:** Remove derived frames without affecting app.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P07 — Current code artifact reconciliation
**Objective:** Compare active frontend bundles, server bundle, source map, build metadata and deployment docs; establish source-of-truth gaps.
**Business capability:** Engineering provenance
**Included:** B6/BT/Cz bundle comparison; server.cjs vs server.cjs.map; source restoration inventory.
**Dependencies:** P1
**Evidence:** Current dist artifact
**Routes/components/files:** /docs/analysis/source-reconciliation
**SQL impact:** None
**API impact:** None
**Security:** Do not edit minified bundles as source.
**Accessibility:** N/A
**Test plan:** Artifact manifest and discrepancy report.
**Acceptance:** No stale map/bundle ambiguity remains before production build.
**Rollback:** Discard reconstructed source tree if superseded by canonical repo.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P08 — API contract reconciliation
**Objective:** Convert observed and implemented API surfaces into canonical OpenAPI-like contracts, including errors/auth/idempotency.
**Business capability:** API governance
**Included:** At least 253 explicit methods from current artifact; 5 historically observed finance APIs; printing endpoints.
**Dependencies:** P1-P7
**Evidence:** API observations + current source map
**Routes/components/files:** apps/api/contracts /docs/api
**SQL impact:** No immediate schema change.
**API impact:** Versioned API contracts.
**Security:** Require server-side authorization matrix.
**Accessibility:** Accessible client error states.
**Test plan:** Contract tests generated per endpoint.
**Acceptance:** 100% critical endpoint contract coverage.
**Rollback:** Version old API version; do not mutate old contract.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P09 — Domain state-machine closure
**Objective:** Resolve authoritative states and transitions for orders, KOT/KDS, bills, payments, voids, inventory and reservations.
**Business capability:** Business correctness
**Included:** State transitions, allowed commands, terminal states, audit semantics.
**Dependencies:** P2-P8
**Evidence:** Conflicting workflows and source implementation.
**Routes/components/files:** /docs/workflows/state-machines
**SQL impact:** Potential status constraints/checks.
**API impact:** Transition endpoints.
**Security:** Server rejects invalid transitions.
**Accessibility:** Focus/announcements for status changes.
**Test plan:** State transition property tests.
**Acceptance:** No unresolved critical transition in production scope.
**Rollback:** Rollback feature flag to previous transition set.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P10 — Database authority & engine decision
**Objective:** Decide and freeze the production relational engine; reconcile current MySQL implementation with the PostgreSQL-or-approved requirement.
**Business capability:** Data architecture
**Included:** Approve MySQL 8.0 for continuity or isolate a PostgreSQL port as a separate program.
**Dependencies:** P1-P9
**Evidence:** Current migrations/config + project brief
**Routes/components/files:** /docs/database/engine-decision
**SQL impact:** All 70 migrations impacted if porting.
**API impact:** DB adapter stable.
**Security:** Least privilege DB user.
**Accessibility:** N/A
**Test plan:** Empty-db rebuild test.
**Acceptance:** Written owner decision before production schema freeze.
**Rollback:** No mixed-engine deployment.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P11 — Security/tenant/RBAC authority
**Objective:** Freeze organization, branch, user, role, permission and session boundaries.
**Business capability:** Security architecture
**Included:** Authentication realms, workspace isolation, staff access, platform admin, rate limits.
**Dependencies:** P1-P10
**Evidence:** Current identity source + reference Settings/Staff.
**Routes/components/files:** apps/api/modules/identity and authorization
**SQL impact:** Existing identity tables; possible constraint/index fixes.
**API impact:** Auth/RBAC APIs.
**Security:** Critical server-side authorization.
**Accessibility:** Accessible permission-denied states.
**Test plan:** Authz matrix tests + tenant breakout tests.
**Acceptance:** No endpoint is exposed without policy.
**Rollback:** Revert permission matrix with migration-safe versioning.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P12 — Print/payment/tax policy closure
**Objective:** Close receipt vs invoice vs estimate semantics and print/reprint/audit requirements.
**Business capability:** Financial & print governance
**Included:** Tax document terminology, invoice numbering, copies, void/reprint reason, printer failover.
**Dependencies:** P6-P11
**Evidence:** Reference receipt evidence + current printing implementation.
**Routes/components/files:** /docs/finance/printing-policy
**SQL impact:** Bills/payments/print_jobs migrations.
**API impact:** Billing/printing contracts.
**Security:** Fraud/audit controls.
**Accessibility:** Accessible receipt preview/print controls.
**Test plan:** Document policy tests.
**Acceptance:** Tax-document state and audit trail unambiguous.
**Rollback:** Feature-flag any new document type.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P13 — Canonical source checkout/recovery
**Objective:** Establish editable source tree; recover backend source from source map where necessary and identify missing frontend source.
**Business capability:** Build foundation
**Included:** Create clean source tree, preserve original paths, annotate recovered files as recovered-not-authoritative.
**Dependencies:** P7-P12
**Evidence:** 796-source backend map; 116 frontend debug refs; compiled bundles.
**Routes/components/files:** Entire repo
**SQL impact:** None
**API impact:** None
**Security:** No secrets in reconstructed tree.
**Accessibility:** N/A
**Test plan:** Source restoration checksum/diff tests.
**Acceptance:** Build from source, not ad hoc bundle edits.
**Rollback:** Retain original artifact as rollback source.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P14 — Monorepo/tooling scaffold
**Objective:** Create maintainable React/TS + Node/TS + relational DB workspace with packages and validation folders.
**Business capability:** Engineering platform
**Included:** /apps/web /apps/api /packages /database /docs /tests /validation.
**Dependencies:** P13
**Evidence:** Architecture brief.
**Routes/components/files:** Repo root
**SQL impact:** None
**API impact:** Tooling only.
**Security:** Centralized config/validation.
**Accessibility:** Shared a11y test utilities.
**Test plan:** Typecheck/lint/build on clean checkout.
**Acceptance:** Clean checkout builds consistently.
**Rollback:** Revert scaffold commit.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P15 — Reproducible build & release pipeline
**Objective:** Make frontend/backend/package artifacts reproducible with checksums and provenance.
**Business capability:** CI/CD
**Included:** Build manifests, release SHA, artifact packing, dependency locking, SBOM.
**Dependencies:** P14
**Evidence:** Current package/readme + build metadata.
**Routes/components/files:** scripts, .github/workflows, release-packages
**SQL impact:** None
**API impact:** Build outputs versioned.
**Security:** Secret scanning/SBOM.
**Accessibility:** N/A
**Test plan:** Repeat-build diff and artifact manifest.
**Acceptance:** Clean build matches release manifest.
**Rollback:** Keep previous artifact for rollback.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P16 — Design tokens & typography
**Objective:** Extract and codify shared visual tokens from screenshot/code evidence.
**Business capability:** Design system
**Included:** Color roles, type scale, spacing, radii, shadows, states, surfaces, icon strategy.
**Dependencies:** P5-P7,P14
**Evidence:** 834 screenshots + CSS bundles.
**Routes/components/files:** packages/ui/styles
**SQL impact:** None
**API impact:** None
**Security:** N/A
**Accessibility:** Contrast/focus tokens.
**Test plan:** Token snapshot tests.
**Acceptance:** Major visual anchors use tokens, no uncontrolled magic values.
**Rollback:** Version token package.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P17 — Shared UI primitives
**Objective:** Build the reusable component foundation.
**Business capability:** Design system
**Included:** Buttons, fields, tabs, cards, tables, badges, drawers, modals, toasts, dropdowns, charts primitives.
**Dependencies:** P16
**Evidence:** Reference screenshots and source bundle components.
**Routes/components/files:** packages/ui
**SQL impact:** None
**API impact:** None
**Security:** Permission/disabled states represented.
**Accessibility:** Keyboard/focus behavior.
**Test plan:** Component tests + a11y.
**Acceptance:** All core primitives have state matrix coverage.
**Rollback:** Component package version rollback.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P18 — Application shell & navigation
**Objective:** Rebuild header/sidebar/breadcrumb/notification/profile/workspace shell.
**Business capability:** Frontend foundation
**Included:** RestroX visual shell, navigation state, responsive shell.
**Dependencies:** P16-P17
**Evidence:** Reference screenshots; current AppShell candidate.
**Routes/components/files:** apps/web/src/app and navigation
**SQL impact:** None
**API impact:** Route gateway hooks.
**Security:** Nav visibility by permissions.
**Accessibility:** Skip links, focus trap, landmarks.
**Test plan:** Shell visual regression.
**Acceptance:** Shell parity at all golden viewports.
**Rollback:** Rollback shell package.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P19 — Route gateway & locale aliases
**Objective:** Replace manual pathname switching with deterministic route matching; expose canonical /en routes.
**Business capability:** Routing
**Included:** React Router route table, locale prefix, dynamic params/query preservation, legacy alias table.
**Dependencies:** P3,P18
**Evidence:** 142 route inventory; current 40 candidate path strings.
**Routes/components/files:** apps/web/src/app/routes
**SQL impact:** Optional route registry table if persisted.
**API impact:** None
**Security:** Authorization guards at route boundary.
**Accessibility:** 404/access unavailable states.
**Test plan:** Route resolution E2E across 142 routes.
**Acceptance:** No duplicate route targets; all canonical routes resolve.
**Rollback:** Revert route registry.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P20 — Auth, session & recovery
**Objective:** Implement secure authentication UX and server flow.
**Business capability:** Identity
**Included:** Login/logout/me/change password/forgot/reset/lockout/session expiry.
**Dependencies:** P11,P19
**Evidence:** Current auth implementation + Settings/Staff evidence.
**Routes/components/files:** apps/web/features/auth; apps/api/modules/identity
**SQL impact:** Use existing identity tables after audit.
**API impact:** /api/v1/auth/*
**Security:** Cookies/session JWT controls and throttling.
**Accessibility:** Form errors, focus, recovery messaging.
**Test plan:** Auth unit/integration/E2E/security tests.
**Acceptance:** All auth flows pass policy.
**Rollback:** Disable new auth flow behind feature flag.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P21 — Workspace & branch context
**Objective:** Implement organization/branch selection and isolation in UI and API.
**Business capability:** Multi-tenancy
**Included:** Current organization, branch switch, user restaurants, branch-scoped queries.
**Dependencies:** P11,P19,P20
**Evidence:** PAGE-105 and current organizations/branches APIs.
**Routes/components/files:** apps/web context; apps/api org scope
**SQL impact:** organizations, branches, user_branches constraints/indexes.
**API impact:** /organizations /branches /auth/switch-branch
**Security:** Tenant boundary enforced server-side.
**Accessibility:** Keyboard-selectable context.
**Test plan:** Breakout tests and cache-key tests.
**Acceptance:** No cross-tenant reads/writes.
**Rollback:** Disable branch switching if regressions, retain session scope.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P22 — RBAC & permission UX
**Objective:** Implement server-enforced permissions plus accessible permission-denied UI.
**Business capability:** Authorization
**Included:** Roles, role permissions, staff permissions, page/action visibility.
**Dependencies:** P11,P20,P21
**Evidence:** Current permission strings/source + reference user-role/staff routes.
**Routes/components/files:** apps/web/features/auth/permissions; apps/api identity/management
**SQL impact:** roles/permissions/user_permissions constraints.
**API impact:** /roles /staff-permissions /management roles
**Security:** Deny-by-default.
**Accessibility:** Accessible disabled/hidden/denied patterns.
**Test plan:** Permission matrix exhaustive tests.
**Acceptance:** 100% API method coverage mapped to permission.
**Rollback:** Permission matrix rollback.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P23 — API client, schemas & state framework
**Objective:** Create typed API client with validation, caching, retry and error boundaries.
**Business capability:** Frontend/backend contract layer
**Included:** Request IDs, structured errors, stale/loading states, query invalidation.
**Dependencies:** P8,P19-P22
**Evidence:** Current app API calls and server middleware.
**Routes/components/files:** apps/web/lib/api; packages/validation
**SQL impact:** None
**API impact:** All versioned APIs.
**Security:** Retry only idempotent operations.
**Accessibility:** Announcements/inline errors.
**Test plan:** Contract/component/integration tests.
**Acceptance:** No raw fetch scattered across views.
**Rollback:** Revert client package version.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P24 — Observability, audit & telemetry
**Objective:** Standardize logs, request IDs, domain audit, metrics and health/readiness.
**Business capability:** Operations
**Included:** Structured redacted logs, correlation IDs, audit events, metrics.
**Dependencies:** P11,P23
**Evidence:** Current app/logger/audit middleware + audit routes.
**Routes/components/files:** apps/api telemetry/audit
**SQL impact:** domain_audit_events/activity_logs indexes.
**API impact:** /health /ready /activity-logs /audit
**Security:** PII/secret redaction.
**Accessibility:** N/A
**Test plan:** Log schema tests, redaction tests.
**Acceptance:** Health/readiness and audit trail deterministic.
**Rollback:** Disable optional telemetry exporter, retain core logs.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P25 — Migration, seed & fixture harness
**Objective:** Formalize empty-db bootstrap, migration integrity, deterministic fixtures and test database reset.
**Business capability:** Database lifecycle
**Included:** Migration lock/checksum, seed packs, fixture loaders, rollback guidance.
**Dependencies:** P10,P24
**Evidence:** 70 runtime migrations, current runner and deployment README.
**Routes/components/files:** database/migrations,seeds,fixtures,tests
**SQL impact:** All schema migrations.
**API impact:** /system/migrations/status admin-only.
**Security:** Migration privilege separation.
**Accessibility:** N/A
**Test plan:** Fresh DB, rerun, rollback and concurrency tests.
**Acceptance:** Empty database reaches expected schema; deterministic seeds.
**Rollback:** Snapshot/restore test DB.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P26 — Analytics routes & data product
**Objective:** Implement exact analytics pages, filters, charts, KPI cards, Top Selling Dishes and export.
**Business capability:** Analytics
**Included:** /en/analytics, finance, order plus query-state/date filters.
**Dependencies:** P19,P23-P25,P42-P49
**Evidence:** PAGE-001-003 and analytics docs/screens.
**Routes/components/files:** apps/web/features/analytics; reports query layer
**SQL impact:** Report indexes/views/materialized summaries only where measured.
**API impact:** Analytics/report endpoints
**Security:** Permission-gated analytics.
**Accessibility:** Chart keyboard summaries, reduced motion.
**Test plan:** E2E, visual, query performance.
**Acceptance:** Reference workflows and screenshots match.
**Rollback:** Revert report UI/API independently.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P27 — Settings core & restaurant configuration
**Objective:** Implement settings routes except dedicated printing/migrated/support surfaces.
**Business capability:** Configuration
**Included:** Restaurant details, notifications, activity, roles, integrations, invoice/KOT/order-slip settings.
**Dependencies:** P18-P25
**Evidence:** PAGE-004-014, PAGE-052, docs.
**Routes/components/files:** apps/web/features/settings; apps/api admin modules
**SQL impact:** operational_settings, branch_tax_configs, role data.
**API impact:** settings APIs
**Security:** Admin permissions server-side.
**Accessibility:** Forms/keyboard/validation.
**Test plan:** CRUD + visual tests.
**Acceptance:** Settings persist and reflect in downstream features.
**Rollback:** Rollback individual setting migrations.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P28 — People, staff & customer surfaces
**Objective:** Implement staff lifecycle, pending/removed, customers and groups.
**Business capability:** People
**Included:** Staff list/access lifecycle; customers; credit/member views as applicable.
**Dependencies:** P21-P27
**Evidence:** PAGE-026-027, 105-107, 134 + current code.
**Routes/components/files:** staff/customer feature modules
**SQL impact:** users, memberships, customers, departments.
**API impact:** users/management routes
**Security:** Staff access protected.
**Accessibility:** Accessible tables/drawers.
**Test plan:** CRUD lifecycle + tenant tests.
**Acceptance:** Removal/restore semantics resolved.
**Rollback:** Soft-delete/restore compatible rollback.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P29 — Menu catalog & customization
**Objective:** Implement dishes/categories/add-ons/menu sets/sub-menu/combo and customization.
**Business capability:** Catalog
**Included:** Menu item lifecycle, categories, variants, modifiers, combo components, stock links.
**Dependencies:** P17,P23-P25,P28
**Evidence:** PAGE-028-033, PAGE-060 and menu workflows.
**Routes/components/files:** apps/web/features/menu; apps/api/modules/menu*
**SQL impact:** menu_* tables, recipe links.
**API impact:** /menu/*
**Security:** Catalog edit permissions.
**Accessibility:** Form and dialog accessibility.
**Test plan:** CRUD, visual, data persistence tests.
**Acceptance:** No orphan modifiers/categories; all reference workflows pass.
**Rollback:** Soft-disable catalog feature if necessary.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P30 — Table, space & QR
**Objective:** Implement tables, spaces, QR and allocation/operations.
**Business capability:** Dining setup
**Included:** Floors/sections/tables, layout editor, allocations, merges/swaps/transfers.
**Dependencies:** P21,P29
**Evidence:** PAGE-040-042, table/space workflows.
**Routes/components/files:** apps/web/features/tables; apps/api table modules
**SQL impact:** floors, sections, dining_tables, allocations.
**API impact:** tables/table-allocations/table-operations
**Security:** Scoped by branch.
**Accessibility:** Map keyboard alternative.
**Test plan:** CRUD + allocation concurrency tests.
**Acceptance:** Table Add New workflow works and persists.
**Rollback:** Migration-compatible rollback.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P31 — Orders board/table/detail
**Objective:** Implement main Orders route, table mode, detail tabs, operations and order history surfaces.
**Business capability:** Order management
**Included:** Search/filter, add order, details/KOT/activity, complete/cancel/serve/pickup.
**Dependencies:** P30,P29,P33-P34
**Evidence:** PAGE-018-021, 051,053-054,111-112,139-141.
**Routes/components/files:** apps/web/features/orders; apps/api/modules/order
**SQL impact:** orders/order_items/order_rounds/order_operation_events.
**API impact:** /orders/*
**Security:** Action permissions and tenant scope.
**Accessibility:** Status announcements and focus.
**Test plan:** State-machine/API/E2E tests.
**Acceptance:** Exact transitions and history match.
**Rollback:** Feature-flag new transition commands.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P32 — Reservations
**Objective:** Implement reservation list, booking, completed and cancelled states.
**Business capability:** Reservations
**Included:** Create/edit/cancel/complete and capacity/status semantics.
**Dependencies:** P30,P31
**Evidence:** PAGE-055,113-115.
**Routes/components/files:** apps/web/features/reservations; API layer
**SQL impact:** Schema only if source-of-truth requires new reservation entity; no unproven table.
**API impact:** Contract TBD from P8/P9
**Security:** Reservation access policy.
**Accessibility:** Accessible calendar/list.
**Test plan:** Validation, concurrency, E2E.
**Acceptance:** No capacity rules are invented without evidence.
**Rollback:** Disable write actions until contract closed.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P33 — POS modes & cart
**Objective:** Implement POS mode, active orders, table selector, catalog, cart, customer/membership, order confirmation.
**Business capability:** POS
**Included:** Dine-in/delivery/pickup/takeaway flows and draft state.
**Dependencies:** P29-P31
**Evidence:** PAGE-056,139-140 and POS continuation workflows.
**Routes/components/files:** apps/web/features/pos; apps/api POS/order/billing clients
**SQL impact:** Orders, bill drafts, customer/membership links.
**API impact:** /orders + /billing contracts
**Security:** POS permission set.
**Accessibility:** Keyboard-first cart and dialogs.
**Test plan:** E2E with deterministic synthetic order.
**Acceptance:** Checkout preview matches reference.
**Rollback:** Rollback POS UI without data loss.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P34 — KOT/KDS
**Objective:** Implement KOT order view/history and KDS operational display/state transitions.
**Business capability:** Kitchen operations
**Included:** Pending/completed, filters, service/kitchen modes, ticket/dish status.
**Dependencies:** P31,P33,P50
**Evidence:** PAGE-020,057,051 and KDS docs.
**Routes/components/files:** apps/web/features/kitchen; apps/api/modules/kitchen
**SQL impact:** kitchen_tickets/items, kot counters.
**API impact:** /kitchen/*
**Security:** Kitchen permissions.
**Accessibility:** Status live region/reduced motion.
**Test plan:** Realtime/E2E/state tests.
**Acceptance:** Observed status transitions become deterministic.
**Rollback:** Disable realtime UI fallback to refresh.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P35 — Notifications & activity
**Objective:** Implement notification center and activity history.
**Business capability:** Operational communication
**Included:** Notification categories, activity/audit filters, unread/read where evidenced.
**Dependencies:** P24,P27,P31-P34
**Evidence:** PAGE-005,022,059 + docs.
**Routes/components/files:** apps/web/features/notifications; audit UI
**SQL impact:** alerts, alert_settings, activity_logs.
**API impact:** /alerts /activity-logs
**Security:** Per-user/branch access.
**Accessibility:** Live announcements.
**Test plan:** UI + audit tests.
**Acceptance:** No notification leaks across tenants.
**Rollback:** Disable noncritical notifications.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P36 — Billing preview & bill lifecycle
**Objective:** Implement bill creation/preview, discounts, split and bill list/detail.
**Business capability:** Billing
**Included:** Estimate/preview, split, discount, bill retrieval and finalization hooks.
**Dependencies:** P9,P12,P33
**Evidence:** Current billing routes + reference POS/Finance evidence.
**Routes/components/files:** apps/web/features/billing; apps/api/modules/billing
**SQL impact:** bills, bill_lines, split tables.
**API impact:** /billing/orders/*, /billing/bills/*
**Security:** Billing permissions.
**Accessibility:** Accessible monetary tables/forms.
**Test plan:** Financial calculation unit/property tests.
**Acceptance:** Bill arithmetic, tax, totals reconcile.
**Rollback:** Transactionally rollback bill writes.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P37 — Payment settlement & reversal
**Objective:** Implement mixed settlement, payment modes, credit receivables and reversals.
**Business capability:** Payments
**Included:** Payment chooser, cash/card/mixed, credit, reverse, settlement idempotency.
**Dependencies:** P9,P12,P36
**Evidence:** Observed settlement behavior + current source.
**Routes/components/files:** apps/web/features/payments; apps/api billing
**SQL impact:** payments, settlement_attempts, receivables, credit payments.
**API impact:** /billing/bills/:id/settle, payments, reverse
**Security:** High-risk permissions/idempotency.
**Accessibility:** Accessible numeric inputs and summaries.
**Test plan:** Concurrency, idempotency, double-submit tests.
**Acceptance:** Financial truth deterministic; no duplicate settlement.
**Rollback:** DB transaction rollback + idempotency key.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P38 — Invoice, receipt, tax document & print UI
**Objective:** Implement exact receipt/invoice document states and print preview.
**Business capability:** Documents
**Included:** Invoice settings, bill receipt, receipt document, copies, numbering, tax wording, print controls.
**Dependencies:** P12,P36-P37,P50
**Evidence:** PAGE-012 + receipt/print assets/code.
**Routes/components/files:** apps/web/features/receipts; packages/ui/print
**SQL impact:** bills + tax config + print_jobs.
**API impact:** /receipts, /billing/*/receipt/invoice, /printing
**Security:** Document-level permissions and audit.
**Accessibility:** Print-preview semantics and accessible content.
**Test plan:** Pixel print template regression + data tests.
**Acceptance:** No ESTIMATE/Paid conflict; correct document type.
**Rollback:** Revert template version without deleting data.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P39 — Returns, voids, trash, duplicates & payment edits
**Objective:** Implement destructive/exception workflows with audit and confirmation semantics.
**Business capability:** Exception handling
**Included:** Sales return, void, trash/restore, duplicate draft, payment edit.
**Dependencies:** P9,P12,P28,P36-P38
**Evidence:** Conflict registry: void wording, purchase duplicate, staff restore patterns, return workflows.
**Routes/components/files:** apps/web/features/exceptions; apps/api exception services
**SQL impact:** Soft-delete/status/audit/index updates.
**API impact:** Versioned mutation endpoints.
**Security:** Least privilege + mandatory reason.
**Accessibility:** Confirmation dialogs, focus restore.
**Test plan:** Concurrency/authorization/audit tests.
**Acceptance:** No irreversible delete without explicit approved policy.
**Rollback:** Use soft-delete/reversal transactions.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P40 — Finance transactions & day book
**Objective:** Implement transaction list/day book and observed finance read workflows.
**Business capability:** Finance operations
**Included:** Date range/search/sort, sales/purchase rows, payment modes and tax reads.
**Dependencies:** P23,P36-P39,P42
**Evidence:** PAGE-023,062-071 + 5 historical observed finance APIs.
**Routes/components/files:** apps/web/features/finance; apps/api finance read layer
**SQL impact:** Indexes on finalized financial timestamps and org/branch.
**API impact:** /finance domain + reports APIs
**Security:** Finance view permissions.
**Accessibility:** Keyboard filters/tables.
**Test plan:** API contract + data reconciliation tests.
**Acceptance:** Reference finance rows reconcile to settlement truth.
**Rollback:** Keep read model backward compatible.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P41 — Finance setup & accounting masters
**Objective:** Implement journal/account heads/payment/tax/banks/expense setup.
**Business capability:** Finance configuration
**Included:** Journal voucher, income, expenses, payments, cash/banks, tax/rates, balance transfer, account heads.
**Dependencies:** P27,P40
**Evidence:** PAGE-063,066-072.
**Routes/components/files:** apps/web/features/finance-setup; apps/api finance modules
**SQL impact:** expense categories/expenses/payment methods/tax configs etc.
**API impact:** Finance config APIs
**Security:** Privileged finance permissions.
**Accessibility:** Form validation and accessible tables.
**Test plan:** CRUD + authorization + audit.
**Acceptance:** All masters have referential integrity.
**Rollback:** Version master data migrations.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P42 — Finance reports suite
**Objective:** Implement the 50+ finance report routes with shared report engine and query limits.
**Business capability:** Financial reporting
**Included:** General ledger, trial balance, income statement, balance sheet, tax reports, sales/purchase, party, stock and menu analytics reports.
**Dependencies:** P8,P40-P41,P49
**Evidence:** PAGE-072-104,116-131,142.
**Routes/components/files:** apps/web/features/finance-reports; apps/api/reports
**SQL impact:** Views/indexes/materialized results only if measured; no speculative entities.
**API impact:** /reports/*
**Security:** Report access permissions by report category.
**Accessibility:** Export accessibility and large-table navigation.
**Test plan:** Golden-data query tests, performance tests, visual reports.
**Acceptance:** All 50+ routes render and return bounded deterministic data.
**Rollback:** Per-report feature flags.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P43 — Global reports
**Objective:** Implement `/en/reports` and any evidence-backed global report navigation/summary.
**Business capability:** Reporting hub
**Included:** Top-level report navigation and summary cards, not duplicate finance logic.
**Dependencies:** P26,P42
**Evidence:** PAGE-024 + global reports docs.
**Routes/components/files:** apps/web/pages/reports; shared report engine
**SQL impact:** None unless report needs measured indexes.
**API impact:** /reports/* adapters
**Security:** Role-gated report navigation.
**Accessibility:** Accessible navigation.
**Test plan:** Smoke/visual.
**Acceptance:** Global report hub is stable and links all child reports.
**Rollback:** Route-only rollback.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P44 — Inventory base & stock item/group
**Objective:** Implement stock items, groups, units, suppliers-facing item links and opening stock.
**Business capability:** Inventory
**Included:** Stock Item, Stock Group, Measuring Unit, availability and base stock.
**Dependencies:** P25,P29,P48
**Evidence:** PAGE-043,045-047 and inventory workflows.
**Routes/components/files:** apps/web/features/inventory; apps/api stock/inventory
**SQL impact:** inventory_items/balances/categories, stock_items/groups/dependencies/units.
**API impact:** /inventory/*
**Security:** Inventory permissions.
**Accessibility:** Editable grid accessibility.
**Test plan:** CRUD/data integrity.
**Acceptance:** Count and link summaries reconcile.
**Rollback:** Transaction rollback on stock writes.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P45 — Consumption, recipes & costing
**Objective:** Implement menu stock consumption and recipe/BOM cost logic.
**Business capability:** Inventory costing
**Included:** Consumption editor, recipe versions, ingredient impacts, costing.
**Dependencies:** P29,P44
**Evidence:** PAGE-044 + recipe/menu workflows; dormant source modules.
**Routes/components/files:** apps/web/features/inventory/recipes; apps/api recipe/stock
**SQL impact:** recipes, recipe_versions, ingredients, consumption events.
**API impact:** /inventory/* and menu costing endpoints
**Security:** Costing permissions.
**Accessibility:** Formula explanation and keyboard editing.
**Test plan:** Cost formula/property tests + data comparison.
**Acceptance:** One-row known case and multi-row cases validated.
**Rollback:** Disable formula modes not evidenced.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P46 — Stock history, adjustments, transfer & counts
**Objective:** Implement movement history, adjustment, stock transfer, counts.
**Business capability:** Inventory control
**Included:** Movement types, stock history filters, transfers, counts/confirm, audit.
**Dependencies:** P44-P45
**Evidence:** PAGE-048,143 and stock history/transfer docs.
**Routes/components/files:** apps/web/features/inventory/control; API stock
**SQL impact:** inventory_movements, stock_transfers, inventory_counts/items.
**API impact:** /inventory/movements /transfers /counts /adjustments
**Security:** High-integrity permission boundary.
**Accessibility:** Filter keyboard + status updates.
**Test plan:** Concurrency/locking/rollback tests.
**Acceptance:** No negative stock or cross-branch movement unless policy permits.
**Rollback:** Transaction/compensating migration rollback.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P47 — Batch production & BOM
**Objective:** Implement batch production workflow with BOM, byproducts, overhead/loss/salvage and stock movements.
**Business capability:** Production
**Included:** Template chooser, setup, save, stock movement effects, costing.
**Dependencies:** P45-P46
**Evidence:** PAGE-049 + batch-production continuation.
**Routes/components/files:** apps/web/features/inventory/production; API recipe/stock
**SQL impact:** recipes/BOM + inventory movements; add constraints only if required.
**API impact:** Production command API
**Security:** Production action permissions.
**Accessibility:** Large forms/dialogs accessible.
**Test plan:** End-to-end data before/after + rollback.
**Acceptance:** Source/stock movements reconcile.
**Rollback:** Atomic transaction rollback.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P48 — Purchasing, suppliers & purchase bills
**Objective:** Implement supplier, purchasing, purchase bill/receipt/return lifecycle where reference evidence requires it.
**Business capability:** Procurement
**Included:** Supplier CRUD, purchase orders/receipts, Finance purchase bills and return registers.
**Dependencies:** P40-P42,P44
**Evidence:** PAGE-045,065,082-083,097-104,137-138 + current dormant purchasing module.
**Routes/components/files:** apps/web/features/purchasing; apps/api purchasing
**SQL impact:** purchasing tables, purchase receipts/orders, supplier price history.
**API impact:** /purchase* adapter APIs + finance APIs
**Security:** Supplier/purchase permissions.
**Accessibility:** Accessible line-item editors.
**Test plan:** Financial/inventory reconciliation, duplicate and payment tests.
**Acceptance:** Purchase bill states unambiguous and reconcile.
**Rollback:** Rollback via reversal/soft cancel.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P49 — Cross-domain financial & inventory reconciliation
**Objective:** Make sales, payments, finance, inventory, tax and reports agree.
**Business capability:** System integrity
**Included:** Golden transaction fixtures; reconciliation views; invariants; discrepancy alarms.
**Dependencies:** P36-P48
**Evidence:** All cross-module conflicts.
**Routes/components/files:** /validation/comparisons; reconciliation services
**SQL impact:** Indexes/constraints only after measured query plans.
**API impact:** Reconciliation/report endpoints
**Security:** Finance/inventory audit access.
**Accessibility:** Explain discrepancies in UI.
**Test plan:** Invariants, property tests, golden datasets, exports.
**Acceptance:** Every critical journey reconciles before/after.
**Rollback:** Block release on invariant failure.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P50 — Printer admin, settings & discovery
**Objective:** Implement printer settings, station routing, test/discovery controls.
**Business capability:** Hardware printing
**Included:** Printer CRUD, station assignment, diagnostics, allowed network rules, test ticket.
**Dependencies:** P27,P38,P51
**Evidence:** PAGE-015; current printing modules and hardware_printers.
**Routes/components/files:** apps/web/features/printing/admin; apps/api printing/admin
**SQL impact:** hardware_printers, preparation_stations.
**API impact:** /printers, /stations, /settings/printing
**Security:** Hardware admin permissions.
**Accessibility:** Device forms and statuses accessible.
**Test plan:** Integration + security network allowlist tests.
**Acceptance:** No public raw TCP SSRF.
**Rollback:** Disable diagnostics endpoints safely.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P51 — Durable print jobs, reprint & print agent
**Objective:** Productionize queued printing, retries, failover, credentials, pairing and realtime agent.
**Business capability:** Printing platform
**Included:** print_jobs, print_agents, pairing tokens, retry/failover, reprint audit reason.
**Dependencies:** P12,P38,P50
**Evidence:** Compiled-only printing/print-agent code + migrations 065-070.
**Routes/components/files:** apps/api/modules/printing, printAgent, realtime; connector app
**SQL impact:** 3 new tables + migrations 065-070.
**API impact:** 6 printing/agent endpoints
**Security:** Pairing rate limit, credential hashing, permission separation.
**Accessibility:** Job status live region, fallback UI.
**Test plan:** Connector integration, retries, duplicate suppression, failure injection.
**Acceptance:** Print job state machine and audit pass.
**Rollback:** Pause printer delivery/agent and drain queue.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P52 — Services & integrations
**Objective:** Implement service routes: RestroLink, dine-in, delivery, SMS, loyalty, Connect.
**Business capability:** Integrations
**Included:** Service settings, platform detail, sharing/appearance.
**Dependencies:** P18-P35
**Evidence:** PAGE-025,034-039,061,110,132-133.
**Routes/components/files:** apps/web/features/services; apps/api integrations
**SQL impact:** Only evidence-backed configuration tables.
**API impact:** Connector APIs
**Security:** Integration credentials protected.
**Accessibility:** Status/error accessibility.
**Test plan:** Mocked integration tests + outage states.
**Acceptance:** No fake “connected” status without verification.
**Rollback:** Disable provider independently.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P53 — Migrated data, trash, subscription/support & release notes
**Objective:** Implement administrative/support surfaces and data-management routes.
**Business capability:** Administration
**Included:** Migrated sales/purchase registers, trash, subscription, support, release notes.
**Dependencies:** P27,P39,P41,P48
**Evidence:** PAGE-007,009-010,016-017,135-138.
**Routes/components/files:** apps/web/features/admin; API adapters
**SQL impact:** Migration/import audit tables only if approved.
**API impact:** Admin/support APIs
**Security:** Restricted admin permissions.
**Accessibility:** Confirmation/empty/error states.
**Test plan:** Data import/export and audit tests.
**Acceptance:** Imported records remain traceable.
**Rollback:** Rollback imports by batch marker.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P54 — Platform administration
**Objective:** Preserve/currently implemented Platform Admin realm and organization lifecycle if within deployment scope.
**Business capability:** Platform operations
**Included:** Platform auth, organization lifecycle, activation requests, audit, grace/suspend/security controls.
**Dependencies:** P11,P20,P21,P24
**Evidence:** Current source-map components and routes outside reference inventory.
**Routes/components/files:** apps/web/platform; apps/api/platformAdmin
**SQL impact:** platform admin/session/audit/entitlement tables.
**API impact:** /api/v1/platform/*
**Security:** Separate JWT realm, stricter permissions.
**Accessibility:** Restricted access UI.
**Test plan:** Security and lifecycle property tests.
**Acceptance:** Platform actions auditable and isolated.
**Rollback:** Disable platform admin surface for restaurant users.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P55 — Responsive, keyboard & accessibility hardening
**Objective:** Make all routes usable across observed and required device sizes with robust keyboard and assistive technology support.
**Business capability:** Quality engineering
**Included:** Focus order, dialogs, grids, charts, tables, print preview, reduced motion.
**Dependencies:** P16-P54
**Evidence:** 834 screenshots + UI requirements.
**Routes/components/files:** All web components
**SQL impact:** None
**API impact:** None
**Security:** No permission bypass via keyboard/ARIA.
**Accessibility:** WCAG 2.2 AA-oriented checks; reduced motion.
**Test plan:** Playwright keyboard + axe tests.
**Acceptance:** No critical accessibility violations on release routes.
**Rollback:** Do not regress desktop shell while fixing mobile.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P56 — Loading, empty, error, permission & stale-state matrix
**Objective:** Complete every documented UI state instead of only happy paths.
**Business capability:** Resilience UX
**Included:** State matrix for routes/components; retry, stale data, optimistic rollback, partial failures.
**Dependencies:** P23,P35,P36-P54
**Evidence:** Reference state evidence + known discrepancies.
**Routes/components/files:** All features
**SQL impact:** None
**API impact:** None
**Security:** Permission state must be server-confirmed.
**Accessibility:** Accessible loading announcements.
**Test plan:** Component/visual/E2E state tests.
**Acceptance:** All critical components cover required states.
**Rollback:** Revert per-component state handling.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P57 — Visual regression & screenshot parity
**Objective:** Execute exact visual comparisons against the 834-image evidence set and golden subsets.
**Business capability:** Visual validation
**Included:** Diff layout, spacing, color, type, icons, charts, tables, filters, drawers and receipts.
**Dependencies:** P5,P16-P18,P26-P54,P55-P56
**Evidence:** All screenshot evidence.
**Routes/components/files:** /validation/comparisons/visual
**SQL impact:** None
**API impact:** None
**Security:** Redaction-safe comparison fixtures.
**Accessibility:** A11y snapshot included.
**Test plan:** Playwright screenshots; pixel/SSIM proposed gates.
**Acceptance:** 0 P0 visual differences; P1 differences explicitly approved.
**Rollback:** Per-surface golden updates require evidence link.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P58 — Workflow replay, video & animation parity
**Objective:** Re-run all important workflows and compare event order, visual state changes and motion; use new walkthrough only where applicable.
**Business capability:** Dynamic validation
**Included:** Reference vs rebuilt timelines, transitions, pointer/keyboard actions, chart animations, drawers/modals.
**Dependencies:** P4,P6,P31-P54,P57
**Evidence:** 98 workflows; 8s film; no persisted interaction traces.
**Routes/components/files:** /validation/comparisons/video
**SQL impact:** None
**API impact:** None
**Security:** No production data in recordings.
**Accessibility:** Reduced-motion variant checked.
**Test plan:** Recorded E2E workflow and event diff.
**Acceptance:** All critical workflows reproduce user outcome and state order.
**Rollback:** Quarantine failed recording without production change.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P59 — API/integration contract suite
**Objective:** Run exhaustive endpoint contract tests, authz matrix and error semantics against rebuilt API.
**Business capability:** API quality
**Included:** All current/new endpoints, including printing, plus reference-observed finance contracts.
**Dependencies:** P8,P11,P22-P54
**Evidence:** Current source map and implementation.
**Routes/components/files:** /tests/integration/api
**SQL impact:** None beyond fixtures.
**API impact:** All /api/v1 contracts
**Security:** Auth matrix.
**Accessibility:** Client error-state validation.
**Test plan:** Contract tests + mutation tests for invalid input.
**Acceptance:** 100% critical endpoints and 90%+ total endpoint coverage proposed.
**Rollback:** Version/revert contract changes.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P60 — DB migration, SQL & concurrency verification
**Objective:** Prove empty-state bootstrap, migration integrity, indexes, transactions, constraints and concurrent writes.
**Business capability:** Database quality
**Included:** Fresh DB, repeat migrations, checksum mismatch detection, transaction rollback, lock contention.
**Dependencies:** P10,P25,P36-P49,P51
**Evidence:** 70 migrations runtime, 103 current runtime tables.
**Routes/components/files:** /tests/database /database/tests
**SQL impact:** All schema and indexes.
**API impact:** No SQL endpoint changes.
**Security:** Least privilege and safe parameterization.
**Accessibility:** N/A
**Test plan:** Migration and concurrent write tests.
**Acceptance:** Clean rebuild + rollback strategy verified.
**Rollback:** Forward-only corrective migrations; no history row edits.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P61 — Security, performance & resilience
**Objective:** Harden against auth attacks, tenant breakout, injection, SSRF, rate-limit abuse and load spikes.
**Business capability:** Production hardening
**Included:** OWASP-style app checks, query bounds, report limits, rate limits, websocket controls, print-agent threat model.
**Dependencies:** P11,P22-P24,P49-P60
**Evidence:** Current security env validation and middleware.
**Routes/components/files:** /tests/security /tests/performance
**SQL impact:** Indexes tuned by real plans.
**API impact:** No new endpoints unless needed.
**Security:** Critical security gate.
**Accessibility:** Accessible degradation under failure.
**Test plan:** SAST/dependency audit/DAST/load tests.
**Acceptance:** No critical/high exploitable finding without mitigation.
**Rollback:** Security hotfix rollback procedure.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P62 — Realtime, offline & external-failure validation
**Objective:** Validate Socket.IO, printer agent, live KDS/alerts, offline indicator and provider outages.
**Business capability:** Runtime resilience
**Included:** Reconnect, duplicate events, stale state, degraded mode, queue drain.
**Dependencies:** P34,P35,P51,P52,P61
**Evidence:** Current realtime/offline components and print gateway.
**Routes/components/files:** apps/web/realtime, apps/api/realtime
**SQL impact:** No new schema unless queue state demands.
**API impact:** Socket.IO + external adapters
**Security:** Channel authorization.
**Accessibility:** ARIA live regions and non-motion fallback.
**Test plan:** Fault injection + reconnect tests.
**Acceptance:** No duplicate or unauthorized event delivery.
**Rollback:** Disable realtime and fall back to polling where safe.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P63 — Staging deployment, backups, restore & rollback
**Objective:** Prove the cPanel/Node/MySQL deployment path in an isolated staging environment.
**Business capability:** Operations
**Included:** Release packing, environment validation, migration lock, persistent uploads, DB backup/restore, rollback.
**Dependencies:** P10,P15,P25,P51,P60-P62
**Evidence:** DEPLOY_README/.env.example/stderr/build metadata.
**Routes/components/files:** release-packages, docs/operations
**SQL impact:** Staging DB + restore target.
**API impact:** /api/health /api/ready
**Security:** Protected envs and secrets.
**Accessibility:** Smoke checks.
**Test plan:** Full staging smoke, restore drill, rollback drill.
**Acceptance:** Staging mirrors prod topology and passes all critical checks.
**Rollback:** Restore prior DB + artifact; verify migration compatibility before app rollback.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

### P64 — Production candidate, go-live & hypercare
**Objective:** Run final release gates, controlled production rollout, post-deploy verification and handover.
**Business capability:** Release management
**Included:** Final defect burn-down, smoke, monitoring, rollback readiness, 24/7 runbook and stabilization.
**Dependencies:** P55-P63
**Evidence:** All evidence, validation reports and production checklists.
**Routes/components/files:** Release + operations docs
**SQL impact:** No unreviewed production migration.
**API impact:** No unreviewed API change.
**Security:** Security sign-off required.
**Accessibility:** No unresolved critical a11y defect.
**Test plan:** Final unit/integration/E2E/visual/a11y/security/perf/video/data suites.
**Acceptance:** PRODUCTION READY only if all critical gates pass.
**Rollback:** Blue/green or file-level rollback + DB compatibility plan; never delete migration history.
**Completion:** application starts; clean DB/migration check remains valid; affected capability passes its acceptance tests; no known critical regression; comparison report and rollback notes are stored.

## 12. Route-to-phase coverage map

### P18
- `PAGE-050` `/en/restrox` — Home | RestroX — evidence `observed`
### P21
- `PAGE-105` `/en/user/restaurants` — RestroX — evidence `interactive-ui-observed`
### P26
- `PAGE-001` `/en/analytics` — Overview - Analytics — evidence `observed`
- `PAGE-002` `/en/analytics/finance` — Finance - Analytics — evidence `observed`
- `PAGE-003` `/en/analytics/order` — Order - Analytics — evidence `observed`
### P27
- `PAGE-004` `/en/settings` — Setting | RestroX — evidence `observed`
- `PAGE-005` `/en/settings/notification` — Notifications - Settings | RestroX — evidence `observed`
- `PAGE-006` `/en/settings/activity-log` — Activity Log - Settings | RestroX — evidence `route-observed`
- `PAGE-008` `/en/settings/user-role` — Users Role - Settings | RestroX — evidence `interactive-ui-observed`
- `PAGE-011` `/en/settings/integrations` — Setting | RestroX — evidence `read-only-observed`
- `PAGE-012` `/en/settings/invoice` — Invoice Settings | RestroX — evidence `interactive-ui-observed`
- `PAGE-013` `/en/settings/kot-setting` — KOT Setting | RestroX — evidence `interactive-ui-observed`
- `PAGE-014` `/en/settings/order-slip-setting` — Order Slip Setting | RestroX — evidence `interactive-ui-observed`
- `PAGE-052` `/en/settings/kot-setting/setting` — Kitchen Settings — evidence `interactive-ui-observed`
- `PAGE-108` `/en/settings/kot-setting/setting` — KOT Setting | RestroX — evidence `interactive-ui-observed`
- `PAGE-109` `/en/settings/kot-setting/kitchen-assignment` — KOT Setting | RestroX — evidence `interactive-ui-observed`
### P28
- `PAGE-026` `/en/customer` — Customers | RestroX — evidence `title-observed`
- `PAGE-027` `/en/staff` — Staff | RestroX — evidence `interactive-ui-observed`
- `PAGE-106` `/en/staff/pending` — Staff | RestroX — evidence `empty-state-observed`
- `PAGE-107` `/en/staff/removed` — Staff | RestroX — evidence `empty-state-observed`
- `PAGE-134` `/en/customer/groups` — Customer Groups | RestroX — evidence `interactive-ui-observed`
### P29
- `PAGE-028` `/en/menu/dish-setup` — Dishes - Menu | RestroX — evidence `interactive-ui-observed`
- `PAGE-029` `/en/menu/dish-setup/category` — Categories - Menu | RestroX — evidence `interactive-ui-observed`
- `PAGE-030` `/en/menu/dish-setup/add-ons` — Add Ons - Menu | RestroX — evidence `interactive-ui-observed`
- `PAGE-031` `/en/menu/menu-setup/menu-set` — MenuSet - Menu | RestroX — evidence `interactive-ui-observed`
- `PAGE-032` `/en/menu/menu-setup/sub-menu` — SubMenu - Menu | RestroX — evidence `interactive-ui-observed`
- `PAGE-033` `/en/menu/combo-offer` — Combo Offer | RestroX — evidence `interactive-ui-observed`
- `PAGE-060` `/en/menu/dish-setup/add-dish` — Create Dish | RestroX — evidence `interactive-ui-observed`
### P30
- `PAGE-040` `/en/table-and-space/table` — Table | RestroX — evidence `interactive-ui-observed`
- `PAGE-041` `/en/table-and-space/space` — Space | RestroX — evidence `interactive-ui-observed`
- `PAGE-042` `/en/table-and-space/qr-codes` — QR Codes | RestroX — evidence `interactive-ui-observed`
### P31
- `PAGE-018` `/en/orders` — Orders | RestroX — evidence `observed`
- `PAGE-019` `/en/orders/table` — Table - Order | RestroX — evidence `observed`
- `PAGE-021` `/en/orders/:orderId` — Orders | RestroX — evidence `interactive-ui-observed`
### P32
- `PAGE-055` `/en/reservations` — Reservation — evidence `interactive-ui-observed`
- `PAGE-113` `/en/reservations/booking` — Reservation - Booking | RestroX — evidence `empty-state-observed`
- `PAGE-114` `/en/reservations/completed` — Reservation - Completed | RestroX — evidence `empty-state-observed`
- `PAGE-115` `/en/reservations/cancelled` — Reservation - Cancelled | RestroX — evidence `empty-state-observed`
### P33
- `PAGE-056` `/en/orders/pos-mode` — POS Mode | RestroX — evidence `workflow-observed`
- `PAGE-139` `/en/orders/pos-mode/active-orders` — Active Orders - POS Mode | RestroX — evidence `read-only-ui-observed`
- `PAGE-140` `/en/orders/pos-mode/table` — Table - Order | RestroX — evidence `read-only-ui-observed`
- `PAGE-141` `/en/orders/pos-mode/kot` — KOT - Order | RestroX — evidence `read-only-ui-observed`
### P34
- `PAGE-020` `/en/orders/kot` — KOT - Order | RestroX — evidence `observed`
- `PAGE-051` `/en/orders/kot-history` — KOT History — evidence `interactive-ui-observed`
- `PAGE-057` `/en/orders/kds-mode` — KDS Mode | RestroX — evidence `workflow-observed-with-possible-status-transition`
### P35
- `PAGE-022` `/en/notification` — Notification | RestroX — evidence `title-observed`
- `PAGE-059` `/en/notification/activity` — Activity | RestroX — evidence `workflow-observed`
### P39
- `PAGE-053` `/en/orders/cancelled-history` — Cancelled History — evidence `interactive-ui-observed`
- `PAGE-054` `/en/orders/cancellation-reasons` — Cancellation Reasons — evidence `interactive-ui-observed`
- `PAGE-111` `/en/orders/cancelled-history/kot` — Orders | RestroX — evidence `interactive-ui-observed`
- `PAGE-112` `/en/orders/cancelled-history/dish` — Orders | RestroX — evidence `interactive-ui-observed`
### P40
- `PAGE-023` `/en/finance/transactions` — Finance - Transactions | RestroX — evidence `title-observed`
- `PAGE-062` `/en/finance/day-book` — Finance - Day Book | RestroX — evidence `workflow-observed`
### P41
- `PAGE-063` `/en/finance/journal-voucher` — Finance - Journal Voucher | RestroX — evidence `empty-state-observed`
- `PAGE-064` `/en/finance/sales-and-purchase` — Finance - Sales & Purchases | RestroX — evidence `workflow-observed`
- `PAGE-065` `/en/finance/sales-and-purchase/purchase-bills` — Finance - Sales & Purchases | RestroX — evidence `workflow-observed`
- `PAGE-066` `/en/finance/income` — Finance - Income | RestroX — evidence `empty-state-observed`
- `PAGE-067` `/en/finance/expenses` — Finance - Expenses | RestroX — evidence `empty-state-observed`
- `PAGE-068` `/en/finance/payments` — Finance - Payments | RestroX — evidence `empty-state-observed`
- `PAGE-069` `/en/finance/cash-and-banks` — Finance - Cash & Banks | RestroX — evidence `workflow-observed`
- `PAGE-070` `/en/finance/tax-and-rates` — Tax and Rates - Settings | RestroX — evidence `workflow-observed`
- `PAGE-071` `/en/finance/balance-transfer` — Finance - Cash & Banks | RestroX — evidence `empty-state-observed`
### P42
- `PAGE-072` `/en/finance/reports/account-heads` — Finance - Reports | RestroX — evidence `workflow-observed`
- `PAGE-073` `/en/finance/reports` — Finance - Reports | RestroX — evidence `workflow-observed`
- `PAGE-074` `/en/finance/reports/general-ledger` — Account Summary — evidence `report-ui-observed`
- `PAGE-075` `/en/finance/reports/trial-balance` — Trial Balance — evidence `report-ui-observed`
- `PAGE-076` `/en/finance/reports/income-statement` — Profit Or Loss Statement — evidence `report-ui-observed`
- `PAGE-077` `/en/finance/reports/balance-sheet` — Balance Sheet — evidence `report-ui-observed`
- `PAGE-078` `/en/finance/reports/general-ledger-master` — General Ledger Master — evidence `report-ui-observed`
- `PAGE-079` `/en/finance/reports/payment-mode-summary` — Payment Mode Summary — evidence `report-ui-observed`
- `PAGE-080` `/en/finance/reports/tax-report/sales-register` — Sales Register — evidence `report-ui-observed`
- `PAGE-081` `/en/finance/reports/tax-report/sales-return-register` — Sales Return Register — evidence `report-ui-observed`
- `PAGE-082` `/en/finance/reports/tax-report/purchase-register` — Purchase Register — evidence `report-ui-observed`
- `PAGE-083` `/en/finance/reports/tax-report/purchase-return-register` — Purchase Return Register — evidence `report-ui-observed`
- `PAGE-084` `/en/finance/reports/tax-report/vat-summary-report` — VAT Summary Report — evidence `report-ui-observed`
- `PAGE-085` `/en/finance/reports/tax-report/annex-13-report` — Annex 13 Report — evidence `report-ui-observed`
- `PAGE-086` `/en/finance/reports/tax-report/annex-5-materialized-view-report` — Annex 5 Materialized View Report — evidence `report-ui-observed`
- `PAGE-087` `/en/finance/reports/sales-master-report` — Sales Master Report — evidence `report-ui-observed`
- `PAGE-088` `/en/finance/reports/customerwise-monthly-sales` — Customer Monthly Sales — evidence `report-ui-observed`
- `PAGE-089` `/en/finance/reports/invoicewise-complimentary-discount-report` — Invoice-wise Complimentary Discount Report — evidence `report-ui-observed`
- `PAGE-090` `/en/finance/reports/sales-collection-report` — Sales Collection Report — evidence `report-ui-observed`
- `PAGE-091` `/en/finance/reports/daily-sales-summary` — Daily Sales Summary Report — evidence `report-ui-observed`
- `PAGE-092` `/en/finance/reports/party-balance-report` — Party Balance Report — evidence `report-ui-observed`
- `PAGE-093` `/en/finance/reports/party-receivable-report` — Party Receivable Report — evidence `report-ui-observed`
- `PAGE-094` `/en/finance/reports/party-payable-report` — Party Payable Report — evidence `report-ui-observed`
- `PAGE-095` `/en/finance/reports/balance-confirmation-report` — Balance Confirmation Report — evidence `report-ui-observed`
- `PAGE-096` `/en/finance/reports/purchase-vat-reconciliation` — Purchase VAT Reconciliation — evidence `report-ui-observed`
- `PAGE-097` `/en/finance/reports/purchase-by-supplier` — Purchase By Supplier — evidence `report-ui-observed`
- `PAGE-098` `/en/finance/reports/purchase-return-by-supplier` — Purchase Return By Supplier — evidence `report-ui-observed`
- `PAGE-099` `/en/finance/reports/purchase-by-item` — Purchase By Item — evidence `report-ui-observed`
- `PAGE-100` `/en/finance/reports/purchase-return-by-item` — Purchase Return By Item — evidence `report-ui-observed`
- `PAGE-101` `/en/finance/reports/purchase-by-supplier-monthly` — Purchase By Supplier (Monthly) — evidence `report-ui-observed`
- `PAGE-102` `/en/finance/reports/purchase-return-by-supplier-monthly` — Purchase Return By Supplier (Monthly) — evidence `report-ui-observed`
- `PAGE-103` `/en/finance/reports/purchase-by-item-monthly` — Purchase By Item (Monthly) — evidence `report-ui-observed`
- `PAGE-104` `/en/finance/reports/purchase-return-by-item-monthly` — Purchase Return By Item (Monthly) — evidence `report-ui-observed`
- `PAGE-116` `/en/finance/reports/complimentary-items-report` — Finance - Reports | RestroX — evidence `report-ui-observed`
- `PAGE-117` `/en/finance/reports/complimentary-addon-report` — Finance - Reports | RestroX — evidence `report-ui-observed`
- `PAGE-118` `/en/finance/reports/salesby-submenu` — Finance - Reports | RestroX — evidence `report-ui-observed`
- `PAGE-119` `/en/finance/reports/submenuwise-monthly-sales-report` — Finance - Submenu-wise Monthly Sales Report | RestroX — evidence `report-ui-observed`
- `PAGE-120` `/en/finance/reports/category-quantity-sales` — Finance - Reports | RestroX — evidence `report-ui-observed`
- `PAGE-121` `/en/finance/reports/categorywise-monthly-sales` — Finance - Category-wise Monthly Sales Report | RestroX — evidence `report-ui-observed`
- `PAGE-122` `/en/finance/reports/dish-monthly-sales` — Finance - Reports | RestroX — evidence `report-ui-observed`
- `PAGE-123` `/en/finance/reports/dish-quantity-sales` — Finance - Reports | RestroX — evidence `report-ui-observed`
- `PAGE-124` `/en/finance/reports/kot-type-wise-sales` — Finance - KOT Type-wise Sales Report | RestroX — evidence `report-ui-observed`
- `PAGE-125` `/en/finance/reports/food-cost-report` — Finance - Food Cost Report | RestroX — evidence `report-ui-observed`
- `PAGE-126` `/en/finance/reports/menuset-wise-sales` — Finance - Menuset-wise Sales Report | RestroX — evidence `report-ui-observed`
- `PAGE-127` `/en/finance/reports/stock-item-ledger-summary` — Finance - Finance Stock Item Ledger Summary | RestroX — evidence `report-ui-observed`
- `PAGE-128` `/en/finance/reports/stock-reconciliation-report` — Finance - Stock Reconciliation Report | RestroX — evidence `report-ui-observed`
- `PAGE-129` `/en/finance/reports/stock-ageing-report` — Finance - Stock Ageing Report | RestroX — evidence `report-ui-observed`
- `PAGE-130` `/en/finance/reports/stock-movement-report` — Finance - Stock Movement Report | RestroX — evidence `report-ui-observed`
- `PAGE-131` `/en/finance/reports/stock-position-report` — Finance - Stock Position Report | RestroX — evidence `report-ui-observed`
- `PAGE-142` `/en/finance/reports/sales-ledger/:accountId` — Sales Ledger — Account Statement — evidence `report-ui-observed`
### P43
- `PAGE-024` `/en/reports` — Reports | RestroX — evidence `title-observed`
### P44
- `PAGE-043` `/en/inventory/stock-item` — Inventory - Stock Item | RestroX — evidence `synthetic-crud-observed`
- `PAGE-045` `/en/inventory/suppliers` — Inventory - Suppliers | RestroX — evidence `workflow-observed`
- `PAGE-046` `/en/inventory/measuring-unit` — Inventory - Measuring Unit | RestroX — evidence `synthetic-crud-observed-backend-unverified`
- `PAGE-047` `/en/inventory/stock-group` — Inventory - Stock Group | RestroX — evidence `synthetic-crud-observed-backend-unverified`
### P45
- `PAGE-044` `/en/inventory/consumption` — Inventory - Consumption | RestroX — evidence `read-only-ui-observed-backend-unverified`
### P46
- `PAGE-048` `/en/inventory/stock-history` — Inventory - Stock History | RestroX — evidence `read-only-ui-observed-backend-unverified`
- `PAGE-143` `/en/inventory/stock-transfer` — Inventory - Stock Transfer | RestroX — evidence `read-only-ui-observed-no-eligible-destination`
### P47
- `PAGE-049` `/en/inventory/batch-production` — Inventory - Stock Batch Production | RestroX — evidence `interactive-ui-observed-backend-unverified`
### P50
- `PAGE-015` `/en/settings/printer` — Printer - Settings | RestroX — evidence `interactive-ui-observed`
### P52
- `PAGE-025` `/en/services/restrolink` — RestroLink - Services | RestroX — evidence `interactive-ui-observed`
- `PAGE-034` `/en/services/dine-in` — Dine in - Services | RestroX — evidence `interactive-ui-observed`
- `PAGE-035` `/en/services/delivery` — Delivery - Services | RestroX — evidence `interactive-ui-observed`
- `PAGE-036` `/en/services/sms` — SMS - Services | RestroX — evidence `interactive-ui-observed`
- `PAGE-037` `/en/services/loyalty-and-rewards` — Stamp Programs - Services | RestroX — evidence `interactive-ui-observed`
- `PAGE-038` `/en/services/connect` — Connect Settings - Services | RestroX — evidence `interactive-ui-observed`
- `PAGE-039` `/en/services/setting` — Settings - Services | RestroX — evidence `interactive-ui-observed`
- `PAGE-061` `/en/services/connect/connect-banner` — Connect Settings - Services | RestroX — evidence `empty-state-observed`
- `PAGE-110` `/en/services/delivery/:platformId` — Delivery Platform Detail | Services — evidence `interactive-ui-observed`
- `PAGE-132` `/en/services/restrolink/share-my-menu` — RestroLink - Services | RestroX — evidence `interactive-ui-observed`
- `PAGE-133` `/en/services/restrolink/appearance` — RestroLink - Services | RestroX — evidence `interactive-ui-observed`
### P53
- `PAGE-007` `/en/settings/billing-and-subscription` — Billing and Subscription - Settings | RestroX — evidence `read-only-observed`
- `PAGE-009` `/en/settings/trash` — Trash - Settings | RestroX — evidence `read-only-observed`
- `PAGE-010` `/en/settings/migrated-data` — Migrated Data - Settings | RestroX — evidence `interactive-ui-observed`
- `PAGE-016` `/en/settings/support-and-feedback` — Support and Feedbacks | RestroX — evidence `interactive-ui-observed`
- `PAGE-017` `/en/settings/release-notes` — Release Notes | RestroX — evidence `interactive-ui-observed`
- `PAGE-135` `/en/settings/migrated-data/sales-register` — Migrated Data - Settings | RestroX — evidence `interactive-ui-observed`
- `PAGE-136` `/en/settings/migrated-data/sales-return-register` — Migrated Data - Settings | RestroX — evidence `interactive-ui-observed`
- `PAGE-137` `/en/settings/migrated-data/purchase-register` — Migrated Data - Settings | RestroX — evidence `interactive-ui-observed`
- `PAGE-138` `/en/settings/migrated-data/purchase-return-register` — Migrated Data - Settings | RestroX — evidence `interactive-ui-observed`

## 13. Workflow execution strategy

Every workflow should become a deterministic test definition with:
- starting route and authenticated role;
- organization/branch context;
- viewport and theme;
- locale/timezone/date fixture;
- synthetic records and database preconditions;
- exact user actions (pointer/keyboard);
- wait condition and network expectation;
- expected URL/route/state transition;
- expected API request/response class;
- database before/after invariant;
- audit event expectation;
- visual checkpoint and severity threshold.

For every data-changing workflow, compare API request/response, DB before/after, audit event, UI before/after, authorization, transaction result, rollback result and export where applicable. This matches the evidence policy supplied with the project brief. fileciteturn0file0L707-L726

## 14. Visual validation program

Proposed gates (must be tuned after the first golden-set run):
- 100% canonical route URL/path parity for the reference route set.
- 0 P0 visual defects on critical workflows.
- P1 visual differences either fixed or explicitly approved with an evidence note.
- For static high-confidence regions, proposed pixel mismatch ≤2% and SSIM ≥0.98; dynamic timestamps, live counts and randomized IDs are excluded only when the reference also varies.
- Receipt/print templates get a separate deterministic print-diff suite rather than the browser screenshot threshold alone.
- Every responsive breakpoint used by reference evidence has an explicit golden capture.

These are **PROPOSED validation thresholds**, not claims about the reference system.

## 15. API / security hardening gate

- Generate a machine-readable endpoint catalog from source, then attach method, route, request schema, response schema, permission, tenant scope, idempotency, rate limit and audit event to every endpoint.
- Run authorization tests for authenticated-but-wrong-tenant, wrong-branch, wrong-role and revoked-session cases.
- Fuzz validation boundaries for IDs, dates, money, quantities, pagination, sorting/grouping allowlists and report filters.
- Test SSRF-safe printer diagnostics: loopback/private/forbidden addresses and ports must be rejected according to the implemented policy.
- Verify password reset is one-time, expired after its configured lifetime, attempt-limited and non-enumerating.
- Verify logs contain request IDs and no passwords, tokens, cookies or sensitive credentials.
- Verify production environment validation rejects insecure origins, insecure cookies, placeholder secrets and legacy compatibility state.

## 16. Database / migration gate

- Empty MySQL installation must apply all 70 runtime migrations exactly once with checksums and no manual history edits.
- Second startup must produce zero pending migrations and no schema drift.
- Migration lock must serialize concurrent startup.
- Rollback procedure must be migration-aware: never simply restore old application files onto a schema that is forward-incompatible.
- Financial writes must pass explicit transaction rollback tests under injected failure.
- Inventory movement and batch-production writes must be atomic.
- Report queries must have bounded result sets and measured indexes.
- Nightly backup and restore drill must be tested against a clean recovery instance before production approval.

## 17. Deployment architecture — target

### Application
- Node.js 22+ runtime as already described in the supplied cPanel deployment artifact.
- One Node process for the first production rollout because current rate-limit/realtime state is process-local.
- Express + Socket.IO behind verified HTTPS reverse proxy.
- React static assets served from the built `dist` directory.
- Persistent uploads directory outside disposable release files.
- Protected production environment configuration; no secrets inside release ZIPs.

### Database
- **Decision gate:** retain MySQL 8.0 for minimal-risk convergence, or explicitly approve PostgreSQL and fund a full engine port. Do not start production schema work under an implicit choice.
- Dedicated database/user for staging and production; never share staging credentials with production.
- Migration runner remains authoritative; verify migration 070 is current before go-live.

### Printing
- Restaurant-side print connector/agent runs on the restaurant computer, not on cPanel.
- Pair agents securely, rotate/revoke credentials, and verify persistent Socket.IO connectivity over HTTPS.
- Validate KOT, receipt copies, reprint reason, retry/failover and printer recovery with real hardware.

## 18. Production environment checklist

- `NODE_ENV=production`.
- Strong unique `JWT_SECRET` (≥32 characters) and distinct `PLATFORM_JWT_SECRET`.
- `PLATFORM_JWT_EXPIRES_IN` ≤8h as required by current implementation validation.
- Explicit HTTPS `ALLOWED_ORIGINS` — no wildcard.
- `COOKIE_SECURE=true` behind verified HTTPS proxy.
- `TRUST_PROXY=true` only when the hosting proxy behavior is verified.
- `LEGACY_STATE_ENABLED=false`.
- Strong unique MySQL credentials and least-privilege account.
- Persistent `UPLOADS_DIR` outside release directory.
- Optional SMTP configured only after cPanel connection details are verified.
- Support contact configured in environment for restricted-access screens.
- Exactly one application process until shared rate-limit/realtime state is redesigned.
- Production database backup taken before any migration-bearing release.

## 19. Staging verification script

01. Upload exact release artifact; verify SHA256 and release SHA.
02. Configure isolated staging MySQL and persistent uploads path.
03. Start app; require `/api/health` success.
04. Require `/api/ready` to report connected DB, current migrations and zero pending migrations.
05. Run authentication and Platform Admin checks.
06. Run route smoke across all 142 reference paths.
07. Run the priority operational spine: Dine-In → KOT → KDS Ready → Serve → Bill → Payment.
08. Run POS takeaway/pickup and cancellation/void tests.
09. Run inventory stock movement + batch production + reconciliation tests.
10. Run finance day-book and report checks against deterministic fixtures.
11. Run printing with real printer hardware and print-agent recovery.
12. Restart application; verify uploaded images and print queues behave as designed.
13. Execute backup and restore drill.
14. Execute application rollback rehearsal using a known compatible previous release.
15. Archive test output, comparison reports, logs and environment fingerprint.

## 20. Acceptance matrix

| Gate | Required evidence | Pass condition | Release impact if failed |
|---|---|---|---|
| G0 Evidence integrity | Hashes/manifests | All supplied artifacts accounted for | BLOCK |
| G1 Source provenance | Build/source reconciliation | Production build is reproducible from canonical source | BLOCK |
| G2 Route parity | 142-route smoke + navigation report | All required routes resolve with expected auth/empty/error states | BLOCK |
| G3 Workflow parity | 98 workflow suite | Critical workflows reproduce state/order/outcome | BLOCK |
| G4 Financial integrity | Golden transaction + reconciliation | Bills/payments/finance/reports agree | BLOCK |
| G5 Inventory integrity | Movement/BOM/production tests | Stock changes are atomic and reconcilable | BLOCK |
| G6 API/authz | Endpoint contract + permission matrix | No critical contract/authz gap | BLOCK |
| G7 Visual parity | Golden screenshot suite | No unapproved critical visual differences | BLOCK |
| G8 Accessibility | A11y/keyboard suite | No critical violations on release routes | BLOCK |
| G9 Security | DAST/SAST/dependency/load | No critical exploitable findings | BLOCK |
| G10 Printing | Physical printer acceptance | KOT/receipt/reprint/recovery verified | BLOCK for printing scope |
| G11 Performance | Load/query budgets | Critical workflows remain within approved budgets | BLOCK if budget breach is material |
| G12 Staging | Full rehearsal | Staging mirrors production behavior | BLOCK |
| G13 Backup/restore | Restore drill | Recovery objective and data integrity proven | BLOCK |
| G14 Rollback | Previous artifact + DB compatibility | Safe rollback path proven | BLOCK |
| G15 Final release | Signed readiness checklist | No critical blocker remains | PRODUCTION READY permitted |

## 21. Rollback matrix

| Failure mode | Immediate action | Database action | Application action | Exit criteria |
|---|---|---|---|---|
| Frontend visual regression | Disable affected route flag / redeploy prior UI artifact | None | Rollback frontend artifact only | Golden screenshots restored |
| API contract regression | Route traffic to prior compatible release | Only if schema remains compatible | Rollback app artifact | Contract suite green |
| Failed financial migration | Stop rollout | Do not delete migration rows; restore DB only when rehearsed | Use compatible prior artifact | Reconciled financial fixture passes |
| Print agent outage | Pause queue/retry | Preserve print_jobs | Restore connector/agent or prior compatible app | Queue drains without duplicates |
| Cross-tenant authorization defect | Disable feature immediately | Audit and investigate; no blind deletes | Hotfix or revert | Breakout tests pass |
| Data corruption | Stop writes to affected capability | Restore from verified backup to recovery path | Route operations to maintenance state | Data diff reconciled |
| Capacity/performance issue | Reduce traffic / disable expensive reports | No destructive DB action | Rollback query/UI release; tune indexes | Load test passes |
| Release startup env failure | Do not force start | None | Restore prior artifact/config | Health/ready pass |

## 22. Final defect taxonomy

- **P0 / blocker:** tenant isolation failure, duplicate financial settlement, incorrect tax document, data loss, migration corruption, unaudited destructive action, critical auth bypass, unrecoverable production startup, or core order/pay/stock workflow unavailable.
- **P1 / release-critical:** critical route missing, workflow result differs materially, incorrect financial reconciliation, printer failure for a required production site, critical accessibility failure.
- **P2 / material:** significant visual mismatch, noncritical workflow inconsistency, degraded report performance, unresolved but contained UI-state bug.
- **P3 / cosmetic:** icon/spacing/copy deviation without workflow impact, minor responsive polish.

## 23. Machine-verifiable completion definition

The project can move from **NOT READY** to **STAGING READY** only when P01–P63 have their evidence reports complete and no P0 blocker remains. It can move to **PRODUCTION CANDIDATE** only after the full reference comparison suite is green or all exceptions are explicitly approved. It can be reported **PRODUCTION READY** only when P64 passes and every critical gate is green. This matches the supplied instruction that production-ready must not be reported while a critical blocker remains. fileciteturn0file0L375-L459

## 24. Immediate execution order

01. Freeze artifact hashes and regenerate the master manifest.
02. Obtain the canonical source checkout if available; otherwise label recovered backend source as recovered and begin frontend source reconstruction from the compiled evidence.
03. Decide MySQL 8.0 vs PostgreSQL explicitly.
04. Generate the canonical 142-route registry and `/en/*` React Router map.
05. Generate the endpoint-to-permission-to-schema contract inventory from source.
06. Close the P09/P12 business-state conflicts before implementing financial write paths.
07. Build the shared shell/UI primitives, then converge one representative route from each high-risk domain before scaling out.
08. Implement golden transaction fixtures and cross-domain reconciliation before mass-producing finance/inventory reports.
09. Build printing only after receipt/tax semantics are frozen.
10. Run staging with real printer hardware, database backup/restore and rollback rehearsal.
11. Execute the 142-route × workflow × visual test matrix and burn down every P0/P1 difference.

## 25. Required documentation package at release

- Evidence manifest and immutable checksums.
- Canonical route inventory and alias map.
- Workflow catalog and event timelines.
- Design token catalog and component state matrix.
- API contract / permission / tenant matrix.
- SQL entity catalog, migration manifest and query performance notes.
- Security model and threat model.
- Print architecture and onsite printer acceptance report.
- Visual regression and workflow comparison reports.
- Deployment, monitoring, backup/restore and rollback runbooks.
- Production-readiness checklist with signed evidence links.
- Known differences and open-questions log.

## 26. Final status

**PROJECT STATUS: NOT READY**

**Why:** the new evidence materially improves implementation confidence, but the current candidate is still a compiled implementation artifact with source/provenance divergence, route-model divergence, an engine approval decision pending, missing transactional trace evidence and unresolved high-risk business-state conflicts. The plan now provides a complete controlled path to deployability without inventing unsupported behavior.

**Target status sequence:** `NOT READY` → `DEVELOPMENT READY` → `STAGING READY` → `PRODUCTION CANDIDATE` → `PRODUCTION READY`.

**Important:** the supplied brief explicitly requires analysis first, then implementation, validation, correction, hardening, staging verification and final production-readiness gates; the plan follows that lifecycle. fileciteturn0file0L924-L947