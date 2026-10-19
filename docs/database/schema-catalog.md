# Database schema catalog

## Scope and authority

This catalog organizes the repository's reference inventory of **103 SQL entities**. It is a source-code inventory, not a live database introspection report. Migration files in `apps/api/src/server/db/migrations/` remain the executable authority for column definitions, keys, constraints, indexes and data transformations. Do not infer production schema readiness from this catalog alone.

## Entities by domain

### Identity, tenancy and access

- `organizations`
- `branches`
- `users`
- `sessions`
- `password_reset_otps`
- `user_branches`
- `user_permissions`
- `roles`
- `permissions`
- `role_permissions`
- `user_section_access`
- `user_table_access`
- `organization_entitlements`
- `organization_status_history`
- `organization_access_status_sessions`
- `organization_activation_requests`
- `platform_admins`
- `platform_admin_sessions`
- `platform_admin_password_reset_otps`
- `platform_audit_logs`

### Menu, modifiers and product configuration

- `menu_categories`
- `menu_items`
- `menu_combo_components`
- `menu_item_modifier_groups`
- `menu_item_variants`
- `modifier_groups`
- `modifier_options`
- `modifier_option_ingredient_impacts`
- `variant_ingredient_impacts`
- `menu_item_stock_links`
- `operational_settings`
- `branch_tax_configs`
- `payment_methods`

### Dining, orders and kitchen operations

- `floors`
- `sections`
- `dining_tables`
- `table_allocations`
- `orders`
- `order_items`
- `order_tables`
- `order_rounds`
- `order_number_counters`
- `pending_order_table_claims`
- `order_operation_events`
- `order_amendment_requests`
- `kitchen_tickets`
- `kitchen_ticket_items`
- `kot_number_counters`
- `preparation_stations`
- `registers`
- `shifts`
- `business_days`
- `memberships`
- `membership_usages`

### Billing, settlement and finance

- `bills`
- `bill_lines`
- `bill_settlement_attempts`
- `bill_split_batches`
- `bill_split_requests`
- `payments`
- `cash_movements`
- `expenses`
- `expense_categories`
- `customers`
- `customer_receivables`
- `customer_credit_payments`

### Inventory, stock and recipes

- `inventory_balances`
- `inventory_categories`
- `inventory_consumption_events`
- `inventory_count_items`
- `inventory_counts`
- `inventory_items`
- `inventory_locations`
- `inventory_movements`
- `stock_dependencies`
- `stock_items`
- `stock_movements`
- `stock_transfers`
- `units_of_measure`
- `recipes`
- `recipe_versions`
- `recipe_version_ingredients`
- `order_item_recipe_snapshots`

### Purchasing and suppliers

- `suppliers`
- `supplier_contacts`
- `supplier_items`
- `supplier_item_price_history`
- `purchase_order_items`
- `purchase_order_sequences`
- `purchase_orders`
- `purchase_receipt_items`
- `purchase_receipts`

### Alerts, audit and lifecycle

- `activity_logs`
- `alert_auth_failure_windows`
- `alert_settings`
- `alerts`
- `domain_audit_events`
- `lifecycle_automation_attention`

### Printing and hardware

- `hardware_printers`
- `print_agent_pairing_tokens`
- `print_agents`
- `print_jobs`

### Workforce setup

- `departments`

## Cross-domain invariants to preserve

- **Tenant boundary:** organization-owned rows must be scoped by `organization_id`; branch-owned operations must also be scoped by `branch_id`. Repository queries and joins must enforce both where applicable.
- **Referential integrity:** preserve declared foreign keys and unique constraints; review delete behavior carefully for financial, audit, inventory-ledger and print-history records.
- **Financial integrity:** settlement attempts, payments, bills, receivables and credits must reconcile. Reversals are explicit events, not silent deletion of successful transactions.
- **Stock authority:** use the established stock movement/ledger model as the source of truth. Recipe costing must not introduce a second POS sale-consumption ledger.
- **Recipe history:** active recipe versions remain immutable; changes create a new draft version. Recipe ingredient units must be dimension-compatible with inventory units.
- **Operational idempotency:** order mutations, settlement attempts, inventory movements and print jobs require stable idempotency/uniqueness boundaries appropriate to the domain.
- **Auditability:** retain activity/domain/platform audit trails and preserve timestamps for critical lifecycle changes.
- **Printing isolation:** print jobs, agents and pairing tokens are organization/branch scoped; credentials and pairing tokens are stored as hashes, never plaintext.
- **Migration discipline:** apply the numbered chain through the guarded runner, validate checksums, and never rewrite applied migrations. The known 065–070 checksum-provenance exception is documented in `runtime-migration-gap.json` and remains a production release blocker.

## Required database verification

1. Clean MySQL 8.0 database: apply all registered migrations in order; assert the ledger contains the expected chain.
2. Restart test: start the production runtime against the migrated database and verify no migrations are unexpectedly rerun.
3. Upgrade test: apply pending migrations to a representative prior schema and verify compatibility.
4. Isolation tests: create at least two organizations and multiple branches; prove cross-tenant and cross-branch reads/writes are rejected.
5. Ledger tests: reconcile payment/settlement/reversal and stock movement/balance invariants after success and forced rollback.
6. Backup/restore test: restore a real backup to an isolated database and verify critical counts and relationships.
7. Release test: rebuild the runtime from current source, verify the artifact contains the same migration chain, then run API and browser smoke tests against that exact artifact.

These database execution and release gates have **not** been certified by this static catalog or migration integrity workflow.
