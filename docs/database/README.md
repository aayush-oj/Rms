# RestroX database architecture and build guide

## Purpose and source of truth

RestroX uses **MySQL 8.0 with InnoDB and utf8mb4**. The executable schema is a versioned migration chain, not a hand-maintained one-shot SQL dump.

- Runtime-authoritative migration source and registration: `apps/api/src/server/db/migrations/`.
- Repository distribution mirror: `database/migrations/`.
- Source checksum manifest and ordered registration mirror: `database/migrations/checksums.ts` and `database/migrations/index.ts`.
- Runtime migration ledger: `_schema_migrations`, maintained by the migration runner.
- Migration history is append-only. Never edit an applied migration to change production schema; add a new numbered migration.
- Do not use `runtime/dist/server.cjs.map` as schema source. It is older than the active source migration tree.

The supported chain is 001–070. Migrations 065–070 add printer configuration, durable print jobs, print-agent identity, printing permissions, pairing tokens, retry scheduling and printer failover. Their source was recovered from the active API migration tree and mirrored into `database/migrations/`; the older runtime source-map gap remains documented rather than filled with guessed SQL. **A checksum-provenance exception remains for 065–070:** the established checksum manifest values do not match the current source-file Git blob hashes. Those manifest values were preserved to avoid silently changing hashes that may already exist in deployed `_schema_migrations` ledgers.

## Domain coverage by migration groups

| Range | Domain |
|---|---|
| 001–009 | Identity, organizations/branches, master data, menu foundations, tables/orders, RBAC and owner bootstrap |
| 010–016 | Financial foundations, service lifecycle, modifiers/snapshots, table operations, bill splitting, management and business-day/shift rules |
| 017–020 | Inventory foundation, purchasing bridge, recipes and food costing |
| 021–030 | Expenses, reports/dashboard, operational alerts, concurrency/security, membership, audit, account recovery and operational lifecycle |
| 031–042 | Receipt settings, complimentary items, KOT/table reconciliation, permissions and financial/business-day invariants |
| 043–053 | Restaurant authentication, mixed settlement/credit, multi-table dining, action center, simple-stock inventory, takeaway lifecycle, order rounds, menu combos and customer credit statements |
| 054–064 | Platform-admin identity, organization entitlements/access, platform auditing, lifecycle automation, activation requests, branch coordinates, metrics indexes and platform-admin credential policy |
| 065–070 | Printer domain, durable print queue, print-agent foundation, manual print permissions, pairing/rotation tokens, retry and failover metadata |

This is a domain map, not a replacement for reviewing the DDL and foreign-key relationships in the migrations themselves. The full 103-entity reference inventory is organized in [`schema-catalog.md`](schema-catalog.md).

## Build and verify without touching a live database

1. Install the repository's pinned Node dependencies in a clean checkout.
2. Run `npm run audit:database:migrations`. It verifies the 001–070 sequence, identical source/mirror bytes, Git-blob SHA-1 checksum entries, and registry imports/exports/registration.
3. Run `npm run check:ts-syntax` and the repository's migration-specific unit/static tests.
4. Build the guarded runtime candidate using the repository's runtime-candidate build script; verify its metadata includes all 70 migration modules and the expected inventory/recipe routers.
5. Review the generated migration status against an isolated MySQL 8.0 instance before any deployment. A clean-database migration run and a second restart against the migrated database are separate integration gates.

The user-requested source/build analysis does not require running migrations against any database. This documentation and audit script are static source-integrity checks only; they do not certify live MySQL execution, production data compatibility, backup/restore, or deployment readiness.

## Operational safeguards

- Back up and test restoration before production schema changes.
- Use a dedicated least-privilege application/migration identity; never commit credentials.
- Run migrations through the guarded migration runner, which serializes migration execution and checks recorded source checksums.
- Keep tenant and branch ownership in repository queries and database constraints; add composite keys/constraints where the existing model supports them instead of relying on UI filtering.
- Keep stock movements/ledger as the inventory authority. Recipe costing must not create a second sale-consumption ledger.
- Keep money and quantity precision explicit; use DECIMAL columns for persisted amounts/quantities and avoid floating-point database types for financial records.
- Preserve audit trails for payments, reversals, stock movements, print attempts, permission changes and platform-admin actions.
- Review destructive `down` migrations before use. A rollback is not a substitute for a tested forward fix, and rollback of data-bearing tables can destroy operational history.

## Known release gates

- The preserved runtime source map is older than source migrations 065–070; a fresh production candidate must be built from current source.
- The established checksum manifest for migrations 065–070 differs from the current Git blob hashes. Do not rewrite those checksums or apply production migrations until the original source/deployed ledger is reconciled.
- Full live MySQL 8.0 clean-install and upgrade tests remain required.
- The P45 recipe/costing gates and complete P01–current regression gates remain separate from this static migration-chain audit.
- Production readiness requires a tested backup/restore and a deployment smoke test against the exact release artifact.
