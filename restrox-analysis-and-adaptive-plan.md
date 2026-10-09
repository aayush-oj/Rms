# RestroX — Evidence Analysis & Adaptive Delivery Plan

**Analysis date:** 2026-10-07  
**Evidence basis:** `ALL_AI_SCREENSHOTS.zip`, `restrox-complete-inspection-bundle.zip`, and the supplied implementation brief.  
**Current status:** **NOT READY** for production; **DEVELOPMENT READY** for an evidence-backed foundation build once the contract gaps are explicitly accepted/closed.

## 1. Evidence manifest

### Supplied local artifacts

| Artifact set | Result |
|---|---|
| `restrox-complete-inspection-bundle.zip` | 195 files: 90 Markdown, 103 JSON, 1 text file, 1 Python utility |
| `ALL_AI_SCREENSHOTS.zip` | 834 local JPG screenshots |
| Videos in inspection bundle | 0 persisted |
| Playwright traces in inspection bundle | 0 persisted |
| Existing source code | None found in supplied bundles |
| Raw HAR / auth headers / credentials | Not present; intentionally excluded |

### Screenshot analysis

All 834 local JPGs were indexed, dimension-checked, duplicate-checked, and visually inspected via 17 contact sheets covering the full numbered sequence.

Observed local screenshot dimensions are predominantly desktop captures around `1633×899`, `1558×808`, and `1633×808`, with a few other desktop widths and one narrow crop. 31 exact-image duplicate groups account for 66 duplicate files; duplicates were retained rather than silently dropped.

A separate inspection-manifest in the bundle records **667 inline screenshot references** plus **29 older PNG filenames** that pre-dated the walkthrough. Those inline captures are not local files in the bundle. The 834-JPG archive supplied in this turn is therefore treated as an additional local visual evidence set, not as the same artifact population as the bundle's 667 inline references.

### Video / trace analysis

There are no persisted videos and no persisted Playwright trace files. Therefore no defensible frame-rate/duration/timestamp/event-timeline analysis exists for video or trace artifacts. This is an evidence gap, not an implementation result.

## 2. Route inventory

The canonical `route-inventory.json` contains **142 route records**, with IDs extending through `PAGE-143`; `PAGE-058` is absent. The companion route-artifact index also references `PAGE-142` (dynamic Finance Sales Ledger) and `PAGE-143` (Inventory Stock Transfer).

The inspection coverage report and master guide describe the inventory as **143 routes**. This is a consistency error caused by counting the maximum page ID rather than the number of route records. The implementation ledger should use **142 observed route records**, while preserving the historical page IDs.

### Route counts by capability

| Capability | Route records |
|---|---:|
| Finance Reports | 50 |
| Settings | 21 |
| Orders / POS / KOT | 14 |
| Finance (non-report) | 11 |
| Services | 11 |
| Inventory | 8 |
| Menu | 7 |
| Reservations | 4 |
| Other / cross-cutting | 3 |
| Staff | 3 |
| Table & Space | 3 |
| Notifications | 2 |
| Customers | 2 |
| Global Reports | 1 |
| Home | 1 |
| Restaurant Management | 1 |
| **Total** | **142** |

The major scale driver is the Finance/Reports surface: **61 routes** across Finance and Finance Reports, plus the report/catalog families.

## 3. Workflow inventory

The consolidated workflow inventory contains **98 workflows**. The evidence set spans read-only observations, draft interactions, synthetic mutations, route reachability, and follow-up reconciliation checks.

The strongest verified mutation-style evidence is deliberately bounded: synthetic Supplier, Customer, Staff, Stock Item, Measuring Unit, Stock Group, Space, and one BOM/Batch production example were observed in narrowly scoped cases. A synthetic Cash checkout also produced a matching Finance read-back, but downstream order/KOT/KDS visibility did not reconcile.

## 4. Product model

The evidence supports a multi-area restaurant operations product:

`restaurant/workspace -> roles/staff/customers -> table/space + menu -> orders/POS -> KOT/KDS -> service/delivery -> checkout/payment -> invoice/finance -> inventory/report reconciliation`

Additional surfaces include Analytics, Reservations, Services (Dine In, Delivery, SMS, Loyalty, Connect, RestroLink), Settings, Migrated Data, Support, and Release Notes.

This is a **product capability model**, not a claim about the reference application's internal service or event architecture.

## 5. UI and design-system model

### OBSERVED visual language

- Persistent left navigation/sidebar on light backgrounds.
- Strong red primary/active accent; pale red/pink active-row or active-tab backgrounds.
- Green success/positive action accent, especially for save/confirm/success states.
- White/light-gray content surfaces with rounded cards and modal surfaces.
- Dense data tables with horizontal overflow; visible scrollbars on wide report/ledger views.
- Filled red primary actions; neutral outlined/light-gray controls; green success actions.
- Centered modal dialogs with dark scrims for form, confirmation, image, and chooser states.
- Right-side detail sheets/panels for some record inspections.
- Empty-state illustrations with a short explanatory message and primary recovery CTA.
- Persistent floating support/help control on the right edge.
- Typography visually reads as a rounded/geometric sans-serif; exact font family is not established.
- Header/tab treatment is consistently pill/tab-like and route-backed in Analytics and many feature areas.
- Customer-facing settings frequently include an embedded phone/device preview; these are **preview surfaces**, not evidence of an actual mobile browser session.

### INFERRED / PROPOSED token model

These are implementation tokens derived from the screenshots, not measured source tokens:

| Token family | Inference | Confidence |
|---|---|---|
| Brand primary | High-saturation RestroX-style red | Medium |
| Positive | Medium green | Medium |
| Canvas | White / near-white | High |
| Surface | White with light neutral borders/shadows | High |
| Active surface | Pale red/pink tint | High |
| Text primary | Dark charcoal | High |
| Text secondary | Neutral gray | High |
| Radius | Small-to-medium rounded corners | Medium |
| Shadow | Subtle elevation for cards/modals | Medium |
| Density | Compact enterprise/table-oriented | High |
| Font | Rounded geometric sans appearance | Medium |

Exact hex values, font family, weight scale, spacing scale, icon family, and design-token source are **UNKNOWN** and must be measured/confirmed before pixel-level acceptance.

## 6. Interaction and motion model

### OBSERVED

The screenshots establish visible states for tabs, filters, dropdowns, modals, drawers/sheets, confirmations, image selectors, table selectors, print destination menus, and horizontally scrollable tables.

### UNKNOWN

No persisted videos means animation timing, easing, hover-to-open thresholds, pointer interpolation, keyboard timing, and transition durations are not evidence-backed.

### PROPOSED implementation defaults

Use short, interruptible transitions for menus/dialogs/sheets, honor `prefers-reduced-motion`, and keep all motion state-independent so data correctness never depends on animation completion. Exact timing will be set only after reference recordings exist.

## 7. API model

Only one read-only API observation set is confirmed.

### OBSERVED endpoint paths

1. `/finance/purchaseBill/overview` — query names observed: `startDate`, `dateFrom`, `dateTo` — status 200.
2. `/finance/sales` — query names observed: `startDate`, `dateFrom`, `take`, `page` — status 200.
3. `/finance/salesInvoice/overview` — query names observed: `startDate`, `dateFrom`, `dateTo` — status 200.
4. `/finance/paymentModes` — status 200.
5. `/finance/taxes` — query name observed: `includeInactive` — status 200.

The request method, request/response schemas, authentication, tenant scoping, pagination semantics, error shapes, write endpoints, idempotency, and side effects are **UNKNOWN**.

## 8. SQL / data model

### CONFIRMED

**0 database schemas/entities are confirmed.** The bundle explicitly states that the original database schema is unknown.

### PROPOSED bounded domain groups

The implementation should create a relational model only after the domain contracts below are approved:

- Identity & tenancy: users, organizations/workspaces, branches, memberships, roles, permissions, sessions.
- Restaurant configuration: services, settings, printers, kitchen assignments, cancellation reasons, notification preferences.
- People: customers, customer groups, staff links.
- Catalog: dishes, categories, add-ons, menu sets, submenus, combo offers, variants, stock recipes.
- Space: tables, spaces, QR/link configuration.
- Ordering: orders, order items, modifiers, reservations, KOTs, KOT items, KDS status/audit.
- Checkout/finance: invoices, invoice items, payments, payment allocations, account heads, journal entries, day-book projections, returns/void/reversal records.
- Inventory: stock items/groups, suppliers, measuring units, conversions, movements, consumption, transfers, BOMs, production batches, losses/byproducts.
- Reporting/analytics: metric definitions, saved reports/filters, report jobs/exports, analytics read models.
- Cross-cutting: audit logs, notification events, attachment metadata, outbox/integration events.

These are **PROPOSED** entities, not reverse-engineered facts.

## 9. Evidence conflicts and high-value unknowns

### Critical conflicts / blockers

| ID | Finding | Classification |
|---|---|---|
| C-01 | POS checkout/read-back appeared successful in Finance while the corresponding order/KOT/KDS surfaces did not expose the synthetic record after refresh/search. | CONFLICTING / CRITICAL |
| C-02 | Receipt for the settled synthetic sale retained an `ESTIMATE` heading and stated it was not a Tax Invoice. | CONFLICTING / CRITICAL |
| C-03 | Purchase Bill list showed Paid while the unsaved Edit draft displayed an Unpaid Amount. | CONFLICTING / HIGH |
| C-04 | Mark as Void confirmation used irreversible-delete wording. | CONFLICTING / HIGH |
| C-05 | Staff removal warning conflicted with Removed view's recovery countdown/Restore affordance. | CONFLICTING / HIGH |
| C-06 | Delivery selector/slip and side-summary showed different statuses. | CONFLICTING / HIGH |
| C-07 | Stock Group row count returned to zero after item removal while a summary card still showed one. | CONFLICTING / MEDIUM |
| C-08 | Table Add New did not open in observed attempts. | UNKNOWN / HIGH |
| C-09 | Stock Transfer had no eligible destination in the observed tenant. | UNKNOWN / HIGH |
| C-10 | Stock History route load exposed React error #418 but remained usable. | UNKNOWN / HIGH |
| C-11 | Cancelled History parent route exposed a React hydration warning. | UNKNOWN / HIGH |

### Systemic unknowns

- Authentication flow, password/session model, tenant isolation, branch scope.
- Permission matrix and server-side enforcement.
- Canonical status machines for Order, KOT, KDS, delivery, payment, invoice.
- Accounting posting rules, tax/VAT behavior, rounding, payment allocation, returns, voids, day close.
- Inventory posting timing, unit conversion, valuation, consumption, production costing, waste, reversals.
- Export file formats, contents, pagination, sorting, filter semantics.
- Import validation and duplicate handling for migrated registers and customer/menu/supplier imports.
- Printer/QZ Tray integration and offline behavior.
- Responsive breakpoints, keyboard behavior, screen-reader semantics, focus management, reduced motion.
- Persistence semantics of many observed UI drafts and controls.

## 10. Risk register

| Risk | Severity | Why it matters | Required control |
|---|---|---|---|
| R-01 Missing API contracts | CRITICAL | Backend fidelity and retries/error handling cannot be inferred safely | Obtain versioned schemas and fixtures before write-path implementation |
| R-02 Missing SQL schema/ownership | CRITICAL | Tenant boundaries, transactions, reconciliation, and migrations are undefined | Define approved relational model + migrations before data-changing features |
| R-03 Missing auth/RBAC/tenant rules | CRITICAL | Security boundary is unverified | Independent role/tenant matrix + server tests |
| R-04 POS/Order/KOT/KDS mismatch | CRITICAL | Cross-module source of truth is unclear | Define state ownership and read-after-write reconciliation |
| R-05 Finance/tax/invoice semantics unknown | CRITICAL | Financial correctness cannot be inferred from screenshots | Product/finance sign-off + accounting acceptance suite |
| R-06 Inventory semantics unknown | CRITICAL | Stock ledgers and production costing are high-risk | Inventory expert rules + reconciliation suite |
| R-07 Accessibility/responsive/motion unverified | HIGH | Desktop screenshots do not establish inclusive behavior | Dedicated browser matrix + a11y tests |
| R-08 Printing external dependency failed | HIGH | Print evidence is incomplete | Adapter + offline/timeout/duplicate-print tests |
| R-09 Destructive action semantics conflict | HIGH | Data loss/recovery risk | Explicit trash/restore/permanent-delete policy and tests |
| R-10 Runtime warnings/errors | HIGH | React #418 / hydration warning may hide real regressions | Clean-console CI gate |
| R-11 Retained synthetic records | HIGH | Cross-test contamination | Fresh isolated test tenant + cleanup/reversal scripts |
| R-12 Evidence provenance mismatch | MEDIUM | 834 local JPGs differ from 29 persisted PNG + 667 inline refs | Maintain separate manifests and provenance metadata |
| R-13 Route inventory count mismatch | MEDIUM | Could cause missed route delivery | Use canonical 142-record route set and preserve page IDs |

## 11. Complexity assessment

| Capability | Complexity | Main drivers |
|---|---|---|
| Evidence/contract closure | CRITICAL | No API/SQL/RBAC contracts; unresolved cross-module conflicts |
| Platform foundation | CRITICAL | Auth, tenancy, RBAC, migrations, audit, observability |
| Configuration + catalog | HIGH | Many routes/forms/imports/settings but lower transaction risk |
| Orders + Reservations | HIGH | Dynamic route, filters, assignments, status/state ownership |
| KOT/KDS | CRITICAL | Operational state machine, freshness, printing, concurrency |
| POS checkout + payments | CRITICAL | Financial writes, invoice/payment semantics, idempotency |
| Inventory | CRITICAL | Stock ledger, valuation, conversion, transfers, production |
| Finance + reports + analytics | CRITICAL | Accounting/tax/report correctness and 61 finance/report routes |
| Services/integrations | HIGH | Delivery/SMS/Connect/RestroLink/printers/external systems |
| Validation/hardening/operations | CRITICAL | Large E2E/visual/a11y/security/performance surface |

The complexity is driven less by page count than by **cross-module transaction correctness and missing contracts**.

## 12. Adaptive phase plan

This plan uses **8 meaningful phases**. Eight is the smallest practical count that keeps the security/data-contract work, operational transaction spine, inventory, reporting, integrations, and final production gates independently verifiable without combining unrelated critical-risk work.

### PHASE P0 — Evidence & Contract Closure

**Objective:** Turn the evidence package into an implementation-safe contract set.  
**Business capability:** none; risk reduction and product-definition authority.  
**Complexity:** CRITICAL.

**Included:**
- Canonical route registry (142 records; page-ID gap documented).
- Workflow registry (98 records) and evidence labels.
- Screenshot catalog/provenance split between the 834 JPG archive and bundle inline/persisted references.
- Formal issue tickets for C-01…C-11.
- Product-owner decision records for state ownership, payment/tax/invoice semantics, inventory posting, delete/trash model, permissions, and tenant boundaries.
- Sanitized API contract capture for read and write paths.
- Approved relational entity model, migration strategy, transaction boundaries, audit policy, retention.

**Excluded:** application feature implementation.

**Dependencies:** none.  
**Evidence references:** inspection index, build-readiness guide, master guide, priority workflows, finance Day Book API evidence, all focused route/workflow documents.  
**Routes affected:** all 142 indirectly; no runtime route implementation yet.  
**Components affected:** evidence/contract metadata tooling only.  
**API affected:** contract definition only.  
**SQL affected:** logical model and migration specification only.  
**Security impact:** CRITICAL — define tenancy/authz before data writes.  
**Accessibility impact:** establishes acceptance targets from desktop evidence; does not yet claim reference a11y.  
**Performance impact:** establishes baselines and budget.  
**Expected files:** `/docs/analysis/**`, `/docs/api/**`, `/docs/database/**`, `/validation/reference/**`, `/validation/comparisons/**`, route/workflow registries.  
**Migrations:** no deployable migration.  
**Test plan:** contract tests, fixture validation, evidence-manifest consistency.  
**Visual plan:** baseline screenshot catalog and token measurement backlog.  
**Video plan:** mark as blocked because no reference videos exist; prepare recorder specification.  
**Data plan:** synthetic deterministic fixtures only.  
**Rollback:** delete/restore only analysis artifacts; no runtime migration.  
**Acceptance:** C-01…C-11 each has an owner, expected behavior, authorized reproduction path, and resolution test; API/RBAC/SQL contracts are either confirmed or explicitly approved as proposed.  
**Completion:** implementation can begin without inventing domain rules.

### PHASE P1 — Secure Platform Foundation & Visual Shell

**Objective:** Build the reusable application substrate and security boundary.  
**Business capability:** authentication, tenancy, navigation, shared UI, telemetry.  
**Complexity:** CRITICAL.

**Included:**
- React + TypeScript web app and Node.js + TypeScript API.
- PostgreSQL connection, migrations, seed/fixture runner.
- Secure authentication/session handling.
- Organizations/workspaces/branches/memberships/roles/permissions.
- Server-side authorization and tenant isolation.
- Global sidebar/header/breadcrumb/tab/modal/drawer/table/form/toast primitives.
- Error boundaries, route loading, not-found, permission-denied, empty/error/loading primitives.
- Structured redacted logging, correlation IDs, health/readiness, configuration validation.
- Initial visual token system inferred from screenshots and labelled as provisional.

**Excluded:** domain transactions and report calculations.

**Dependencies:** P0.  
**Routes affected:** global shell across all 142; initial concrete routes `/en/restrox`, `/en/analytics*`, `/en/settings`, `/en/user/restaurants`.  
**Components:** `packages/ui`, `apps/web/src/app`, navigation, overlays, data table, date controls, selectors, notifications.  
**API:** `/api/v1/auth`, `/api/v1/session`, `/api/v1/workspaces`, `/api/v1/memberships`, permission introspection endpoints.  
**SQL:** identity/tenant/audit foundations.  
**Security:** CRITICAL.  
**Accessibility:** keyboard/focus/labels built from first component, axe/Playwright component gates.  
**Performance:** route-level code splitting and bounded query defaults.  
**Expected files:** `/apps/web/**`, `/apps/api/**`, `/packages/ui/**`, `/packages/types/**`, `/packages/validation/**`, `/database/migrations/**`, `/database/seeds/**`, `/docs/architecture/**`, `/tests/unit/**`, `/tests/component/**`, `/tests/security/**`.  
**Migrations:** identity/tenant/RBAC/audit base.  
**Tests:** unit, API, migration, authz/tenant, component accessibility, shell visual snapshots.  
**Visual:** match sidebar proportions, typography hierarchy, cards, buttons, forms, overlays.  
**Video:** establish recorder for future comparison; no reference comparison yet.  
**Data:** deterministic demo tenant and synthetic records.  
**Rollback:** migration down/redeploy previous app; no destructive production writes in dev/staging.  
**Acceptance:** fresh database migrates from zero; demo login works; cross-tenant access is rejected; shell routes render; no critical console errors; accessibility component gate passes.

### PHASE P2 — Configuration, People, Catalog & Workspace Surfaces

**Objective:** Implement the low-to-medium risk administrative/configuration surface and all reusable form/list patterns before the transaction spine.  
**Business capability:** restaurant setup, staff, customers, menu/catalog, table/space, services/settings, Analytics read-only shell.  
**Complexity:** HIGH.

**Included:**
- Restaurant management and branch configuration.
- Staff active/pending/removed lifecycle, invitations, roles/permissions UI.
- Customers, groups, import drafts.
- Menu: dishes, categories, add-ons, menu sets, submenus, combo offers.
- Table & Space + QR surfaces.
- Service/settings screens: Dine In, Delivery, SMS, Loyalty, Connect, RestroLink, Invoice/KOT/Order Slip/Printer settings, notifications, support/release notes.
- Analytics three-route layout, date control UI, KPI/chart containers, Top Selling Dishes detail sheet; export remains contract-driven.

**Excluded:** order/payment settlement, stock posting, financial posting.

**Dependencies:** P1; domain contracts from P0.  
**Routes affected:** all configuration routes; approximately 60+ routes across Settings, Services, Menu, Table & Space, Customer, Staff, Home/Analytics.  
**API:** CRUD/read/import endpoints by bounded domain; validation and permission checks on server.  
**SQL:** people/catalog/space/settings entities.  
**Security:** high — row/tenant scope and role enforcement on every mutation.  
**Accessibility:** forms, labels, modal focus, keyboard selectors, table semantics.  
**Performance:** pagination and lazy loading for dense lists; debounced search.  
**Tests:** component + integration + route E2E + mutation rollback tests for synthetic entities.  
**Visual:** screenshots for each major state family (list, empty, draft, edit, confirmation, selector, wide table).  
**Video:** record synthetic CRUD and configuration journeys once the capture environment is available.  
**Data:** isolated synthetic tenant; cleanup scripts.  
**Rollback:** domain-specific migration rollback plus soft-delete/recovery procedures; no live destructive actions.  
**Acceptance:** each affected route reachable; synthetic CRUD cases pass after reload; unauthorized mutations rejected server-side; no known critical visual regression.

### PHASE P3 — Orders, Reservations, KOT & KDS Operational Spine

**Objective:** Establish the canonical operational state machines from order entry through kitchen/service completion.  
**Business capability:** Orders, Table Order, Reservations, KOT, KDS, order detail, assignments, status history.  
**Complexity:** CRITICAL.

**Included:**
- Orders list/table/KOT routes and dynamic order detail.
- Reservations and cancellation reasons.
- Order creation/edit/assignment according to approved contract.
- KOT creation, pending/completed/cancelled views, split-by-type, print routing abstraction.
- KDS status board, filters, search, ticket detail, action menu.
- Explicit state machines with legal transitions, actor permissions, timestamps, audit events, concurrency/conflict handling.
- Reload/second-client consistency tests.

**Excluded:** final tender capture and accounting/report posting beyond explicit integration contracts.

**Dependencies:** P1/P2 + approved order/KOT/KDS state-machine contract from P0.  
**Routes:** Orders/KOT/KDS/Reservation and related action-panel destinations.  
**API:** versioned order/reservation/KOT/KDS reads+writes with idempotency and conflict errors.  
**SQL:** orders/order items/modifiers/reservations/KOT/KDS state history/audit.  
**Security:** CRITICAL.  
**Accessibility:** status controls, filters, table navigation, dialogs.  
**Performance:** bounded boards, polling/refetch or event-driven refresh after source contract.  
**Tests:** state-machine unit tests, API authorization, concurrent edit, duplicate submit, reload/second browser E2E.  
**Visual:** compare list/table/detail/KDS/card/empty/confirmation states.  
**Video:** create event timelines for each major status transition in the rebuilt app and compare action order to reference workflow records.  
**Data:** deterministic synthetic order/KOT dataset.  
**Rollback:** transaction-safe status reversal; no hard delete of operational records.  
**Acceptance:** C-01 and C-06 are resolved; every tested state is consistent across Order/KOT/KDS after reload; audit trail exists.

### PHASE P4 — POS Checkout, Payments, Invoice & Finance Posting Core

**Objective:** Make the transaction spine financially correct and idempotent.  
**Business capability:** POS catalog/cart, checkout, payment chooser/tenders, invoices/receipts, payment allocation, finance posting.  
**Complexity:** CRITICAL.

**Included:**
- POS New/catalog/category/filter/search/cart/customization.
- Dine In/Take Away/Pick Up/Delivery service modes as contract permits.
- Checkout draft -> payment chooser -> payment -> invoice/receipt.
- Payment idempotency, duplicate-submit prevention, retries, partial/multi-tender if approved.
- Server transaction boundary for order + payment + invoice + finance posting.
- Finance Transactions/Day Book basic posting/read-back and transaction details.
- Print adapter abstraction; no claim that local QZ printing works until independently tested.

**Excluded:** full Finance Reports catalog and full inventory reconciliation.

**Dependencies:** P3 + approved pricing/tax/payment/invoice/accounting contracts.  
**API:** checkout/payment/invoice/transaction endpoints; idempotency key; structured financial errors.  
**SQL:** invoices, invoice items, payments, allocations, account heads/journal entries, day-book projections, audit/outbox.  
**Security:** CRITICAL.  
**Accessibility:** payment forms, confirmation, receipt detail.  
**Performance:** bounded cart reads and reportable transaction writes; no client-calculated authoritative totals.  
**Tests:** accounting invariants, tax/rounding, duplicate submit, payment failure/retry, concurrency, authorization, read-after-write.  
**Visual:** POS cart/checkout/payment/receipt; Finance list/detail.  
**Video:** exact synthetic flow from POS to receipt and downstream finance read-back.  
**Data:** isolated payment sandbox/seeded tender only.  
**Rollback:** compensating reversal/void/refund according to approved financial contract; DB transaction rollback for failed writes.  
**Acceptance:** C-01/C-02 resolved; invoice/tax semantics are explicit; Finance read-back reconciles; no double posting under retry.

### PHASE P5 — Inventory, Consumption, Transfer & Production

**Objective:** Implement the stock ledger and production model as a reconciled transactional subsystem.  
**Business capability:** Stock Item/Group/Supplier/Measuring Unit, Consumption, History, Transfer, BOM, Batch Production.  
**Complexity:** CRITICAL.

**Included:**
- Stock CRUD and grouping.
- Supplier lifecycle.
- Measuring units and conversions.
- Consumption with repeated rows and stock deduction.
- Stock History filters/search/pagination/export semantics.
- Stock Transfer with two eligible locations and reversible posting.
- BOM and Batch Production; costing, loss/byproduct rules only from approved contract.
- Recipe linkage from menu to stock consumption if approved.

**Excluded:** unsupported speculative valuation formulas.

**Dependencies:** P2 + approved inventory contract; integrate with P4 sale events where recipe consumption is required.  
**API:** inventory CRUD/mutation/read endpoints; bounded ledger queries; concurrency checks.  
**SQL:** stock master, units/conversions, movements, consumption, transfer, BOM, production, suppliers, audit.  
**Security:** high/critical.  
**Accessibility:** wide ledgers, filters, row actions, form tables.  
**Performance:** indexed stock-history queries; bounded report windows.  
**Tests:** ledger equations, unit conversion, transfer rollback, production/consumption reconciliation, concurrent edits, audit.  
**Visual:** stock lists, forms, wide ledgers, production dialogs and empty states.  
**Video:** synthetic receive/consume/transfer/production timelines.  
**Data:** deterministic fixture set matching observed one-row production case plus approved edge cases.  
**Rollback:** compensating stock movement/reversal; no destructive hard delete of posted movements.  
**Acceptance:** stock movements are authoritative and reconcile to transaction sources; C-07/C-09/C-10 are resolved.

### PHASE P6 — Finance Reports, Analytics Data Products & Reconciliation

**Objective:** Complete the 61-route Finance/Finance Reports surface and make analytics/report outputs bounded, auditable, and consistent with transactional truth.  
**Business capability:** Sales/Purchase, income/expenses/payments, cash & banks, taxes, balance transfers, journal voucher, 50 Finance Report routes, global Reports, Analytics data reads.  
**Complexity:** CRITICAL.

**Included:**
- Finance Sales/Purchases and returns.
- Income, Expenses, Payments, Cash & Banks, Tax & Rates, Balance Transfer, Account Heads.
- Day Book reconciliation and sales summary.
- All 50 Finance Reports routes using shared report framework with route-specific query descriptors.
- Global Reports catalog and Menu/Inventory report routes.
- Analytics Overview/Finance/Order data queries and date-range semantics.
- Export job framework where export is confirmed/approved.

**Excluded:** external integrations and provider-side workflows.

**Dependencies:** P4/P5 + approved accounting/report/tax rules.  
**API:** versioned report query endpoints, cursor/page bounds, export jobs, saved reports.  
**SQL:** indexed views/materialized projections only where justified; report queries documented with date/timezone/currency/rounding/null/pagination limits.  
**Security:** critical; every report scoped by tenant and permission.  
**Accessibility:** keyboard-scrollable report tables and accessible filters.  
**Performance:** query budgets, pagination, caching where safe, pre-aggregation for heavy dashboards.  
**Tests:** finance invariants, report reconciliation, date boundaries, tax periods, export contents, permissions.  
**Visual:** all report route templates, empty/populated/wide-table states, analytics charts/cards.  
**Video:** report filter/export journeys where reference recordings become available.  
**Data:** golden ledger fixtures and approved synthetic tenant snapshots.  
**Rollback:** report deployment can roll back independently; financial schema changes use migration compatibility windows.
**Acceptance:** Finance and report totals reconcile with source transactions; all report routes resolve; no unbounded report query remains; analytics uses the same source-of-truth data.

### PHASE P7 — External Services, Printing, Migrated Data & Final Route Closure

**Objective:** Complete the remaining external/auxiliary surfaces and remove route gaps.  
**Business capability:** Delivery provider detail, SMS, Loyalty, Connect, RestroLink, printer configuration/output, migrated tax registers, support/release notes, remaining settings.  
**Complexity:** HIGH.

**Included:**
- Delivery platform configuration and safe sandbox transaction/collection flows.
- SMS event templates/bulk send/package UI with provider abstraction.
- Loyalty/rewards lifecycle.
- Connect settings and banners.
- RestroLink share/appearance/media preview.
- Printer management and print adapters/fallbacks.
- Migrated Data four tax-register destinations with import validation/duplicate handling.
- Remaining support/release-note and notification state behavior.

**Excluded:** new third-party capabilities not represented in evidence or approved contracts.

**Dependencies:** P1 + each domain's approved provider contract; P4/P6 for financial/provider posting.  
**API:** external provider adapters behind internal interfaces; timeout/retry/circuit-breaker behavior.  
**SQL:** integration credentials metadata (secrets outside DB where appropriate), job/outbox state, imported-record audit.  
**Security:** high/critical for providers, uploads, credentials.  
**Accessibility:** file chooser, dialogs, banners, settings switches, notifications.  
**Performance:** background jobs for imports/exports/SMS; bounded upload sizes.  
**Tests:** provider failure/retry, printer offline, import invalid/duplicate files, permission tests, E2E.  
**Visual:** compare remaining route families and empty/draft/success/error states.  
**Video:** record external integration failure/success timelines in sandbox.  
**Data:** provider sandboxes + synthetic import files.  
**Rollback:** disable integration flags, job cancellation, import transaction rollback, provider configuration versioning.  
**Acceptance:** all documented routes resolve; external failures are explicit; no secret enters logs/artifacts; print fallback works.

### PHASE P8 — Full-System Verification, Hardening & Production Readiness

**Objective:** Run the entire application through production-readiness gates and correct all defects before release.  
**Business capability:** none; release assurance.  
**Complexity:** CRITICAL.

**Included:**
- Full route/workflow matrix across all 142 route records and 98 workflows.
- Unit/component/integration/API/SQL/migration/E2E/accessibility/security/performance/visual suites.
- Reference-vs-rebuilt screenshots and video timelines for every available reference workflow.
- Data comparisons: API request/response, DB before/after, audit, UI before/after, authorization, rollback, exports.
- Browser back/forward, refresh, deep links, error/loading/empty/permission states.
- Security review, rate limits, structured redacted logs, secret scanning.
- Backup/restore drills, migration rollback, staging deployment, production runbook.
- Final defect register and known-differences/open-questions documentation.

**Excluded:** feature scope expansion without a new approved requirement.

**Dependencies:** P0–P7 complete.  
**Routes affected:** all 142.  
**API/SQL:** all production contracts.  
**Security:** critical release gate.  
**Accessibility:** full WCAG-oriented acceptance suite.  
**Performance:** load budgets for dashboard, POS, KDS, ledgers, reports.  
**Expected files:** `/tests/**`, `/validation/**`, `/docs/testing/**`, `/docs/operations/**`, deployment manifests, monitoring/alert rules.  
**Migrations:** clean install, upgrade, rollback, restore.  
**Acceptance:** zero critical blockers; all critical journeys pass; staging deployment succeeds; backup restore verified; all remaining differences are documented and explicitly accepted.  
**Rollback:** tested deployment rollback plus DB migration reversal/forward-fix runbook.  
**Completion:** only then can status become **PRODUCTION READY**.

## 13. Phase dependency graph / critical path

```text
P0 Contract closure
  |
  v
P1 Secure platform + shell
  |
  v
P2 Configuration + catalog + Analytics UI
  |
  v
P3 Orders + Reservations + KOT/KDS
  |
  +-----------> P5 Inventory (can start after P2 but integration closes after P4)
  |
  v
P4 POS + Checkout + Payment + Invoice + Finance core
  |
  +-----------> P6 Finance Reports + Analytics reconciliation
  |
  v
P5 Inventory reconciliation
  |
  v
P6 Finance/Reports/Analytics reconciliation
  |
  v
P7 External services + printing + migrated data
  |
  v
P8 Full verification + hardening + operations
```

**Critical path:** P0 -> P1 -> P2 -> P3 -> P4 -> P6 -> P7 -> P8.  
**Parallelizable work:** P5 may begin after P2 at the data-model/UI level, but posted-sale and recipe reconciliation cannot close until P4 exists.

## 14. Acceptance matrix

| Gate | Required before phase close |
|---|---|
| Functional | Affected routes, workflows, states, refresh/back-forward work |
| Data | Read-after-write and source-of-truth reconciliation for mutations |
| Security | Server authz, tenant isolation, privilege-denial tests |
| Database | Migration from zero, constraints/indexes, rollback/restore path |
| Accessibility | Keyboard/focus/labels/semantics and responsive checks for affected area |
| Visual | Screenshot diff within agreed thresholds; all known differences logged |
| Video | Event order/state transitions equivalent for available reference recordings |
| Performance | Route/query budgets met; no unbounded report query |
| Operations | Deployable/stable, telemetry, rollback, backup posture documented |

A phase is **not complete** when only the UI looks right. The phase closes when the relevant data/security/rollback/evidence gates pass.

## 15. Rollback matrix

| Phase | Primary rollback | Data rollback |
|---|---|---|
| P0 | Revert analysis/contract commits | None |
| P1 | Revert app release + reversible base migrations | Drop/restore development tenant only |
| P2 | Revert feature release | Soft-delete/recover or migration down for unposted config data |
| P3 | Revert workflow release | Transaction-safe state reversal; preserve audit trail |
| P4 | Revert API/UI release | Compensating financial reversal or approved void/refund; DB transaction rollback for failed writes |
| P5 | Revert inventory release | Compensating stock movement/reversal; never delete posted ledger rows |
| P6 | Revert report/read-model release | Preserve source ledger; rebuild projections/views |
| P7 | Disable provider/integration feature flags; revert adapter version | Cancel/reverse queued jobs and import transactions; restore previous integration config |
| P8 | Revert deployment to prior known-good release | Execute tested DB rollback/forward-fix + backup restore only under incident runbook |

## 16. Immediate implementation gates

The first implementation sprint should begin only after these are either confirmed or explicitly approved as temporary development contracts:

1. Auth/session/tenant/RBAC matrix.
2. Order/KOT/KDS/delivery status source-of-truth and allowed transitions.
3. Pricing/tax/discount/charge/tip/rounding/payment allocation rules.
4. Invoice vs Estimate semantics and invoice-number policy.
5. Finance account/posting model and reconciliation invariants.
6. Inventory unit/conversion/valuation/consumption/production/transfer rules.
7. Trash/restore/permanent-delete semantics.
8. API schemas and error/idempotency conventions.
9. Database schema ownership and migration policy.
10. Responsive/a11y acceptance targets and browser matrix.

## 17. Current project status

**PROJECT STATUS: NOT READY**

Reason: the evidence is strong for UI structure and selected synthetic cases, but the supplied package does not establish the production backend/API/database/security contracts required by the brief. The next safe state is **DEVELOPMENT READY** after P0 closes the contract decisions and P1 creates the secure foundation.

---
