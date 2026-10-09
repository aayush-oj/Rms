# RestroX database architecture (P10-authorized recovery)

Engine: MySQL 8.0. Database: `restrox_prod`. Runtime user: `restrox_app`. Migration user: `restrox_migrator`. Read-only user: `restrox_readonly`. Backup user: `restrox_backup`.

Passwords are not stored in this repository. Use a secret manager or environment injection. InnoDB + utf8mb4, parameterized SQL, foreign keys, DECIMAL money types, UTC timestamps, tenant/branch predicates, transactions for financial/inventory writes, and audit/reversal semantics are required.

The supplied runtime proves migrations through 070 by active bundle references; migrations 065-070 are preserved as runtime-only provenance because their editable TypeScript source is absent from `server.cjs.map`.
