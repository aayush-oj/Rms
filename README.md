# RestroX / RMS

Version-controlled rebuild and controlled recovery of the RestroX / RMS project.

## Project documentation
- [Project status and current phase checkpoint](docs/PROJECT-STATUS.md)
- [Phase ledger and acceptance workflow](docs/PHASE-LEDGER.md)
- [Recovered source artifact inventory](docs/RECOVERED-ARTIFACT-INVENTORY.md)
- [Recovered Phase 01–42 validation chain](docs/phases/phase-01-42-chain.json)
- [Phase 0 — Baseline audit](docs/phases/phase-00-baseline-audit.md)
- [Phase 43 — Global Reports](docs/phases/phase-43-global-reports.md)

## Canonical recovery scope
- 64 planned phases total; P01–P42 form the recovered baseline, and later phases must be implemented and verified in sequence.
- The recovered reference set includes 142 canonical routes, 253 API methods in the reconciled runtime model, 103 SQL entities, 98 documented workflows, and 50 Finance Reports routes.
- The supplied compiled frontend/runtime is preserved under `runtime/dist`. Editable frontend source is incomplete, so compiled artifacts must not be mistaken for a fully reproducible frontend build.

## Development and delivery rules
Every implementation phase must be documented, tested, reviewed for regressions from P01 through the current phase, committed, pushed, and verified on GitHub before it is reported complete. Run the full-start verification and P01-to-current regression review twice before sign-off. If an integration or evidence gate is blocked, document the exact blocker and do not claim completion.

## Validation commands
Run from the repository root with the required evidence inputs available:

```bash
node scripts/validate-rebuild.cjs
node scripts/check-ts-syntax.cjs
node tests/unit/finance-reports-smoke.cjs
node scripts/package-release.cjs
```

A historical syntax-only pass or a blocked validation run is not production-readiness certification.

## Database and security authority
The recovered P10 architecture specifies MySQL 8.0 and separate runtime, migration, read-only, and backup identities. Secrets must be injected outside source control. Reports must remain tenant/branch scoped and use the existing report/query contracts; the global report hub must not duplicate financial calculations.
