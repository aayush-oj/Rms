<<<<<<< HEAD
# RestroX / RMS

Version-controlled rebuild of the RestroX / RMS project.

## Project documentation

- [Project status and recovery checkpoint](docs/PROJECT-STATUS.md)
- [Phase ledger](docs/PHASE-LEDGER.md)
- [Recovered source artifact inventory and phase names](docs/RECOVERED-ARTIFACT-INVENTORY.md)
- [Recovered Phase 01–42 validation chain](docs/phases/phase-01-42-chain.json)
- [Phase reports](docs/phases/)

## Development and delivery rules

Every implementation phase must be documented, tested, reviewed for regressions from P01 through the current phase, committed, pushed, and verified on GitHub before it is reported complete. See the status and ledger documents for the required workflow.

## Source recovery

The original source archives have been found in the ChatGPT Library/project files. The P01–P42 archive is checksum-verified against its release manifest. The application source archive has **not yet been transferred into this GitHub repository**; the recovery inventory explicitly tracks this outstanding step. Do not treat documentation commits as source-code delivery or production certification.
=======
# RestroX — Phase 01–42 Evidence-Reconstructed Delivery

This repository is the controlled recovery of the RestroX rebuild through Phase 42 from the supplied evidence corpus and current compiled runtime.

## Canonical scope
- 64 planned phases total; this delivery covers Phase 01 through Phase 42.
- 142 canonical reference routes.
- 253 explicit API methods in the reconciled runtime model.
- 103 SQL entities in the master model.
- 98 documented workflows.
- 834 screenshot evidence files in the supplied archive.
- 285 first-party TypeScript sources recovered from `server.cjs.map`.
- 50 Finance Reports routes in Phase 42.

## Source-of-truth policy
The backend TypeScript in `apps/api/src` is recovered from the supplied server source map and is marked as recovered source. The original frontend TypeScript source was not supplied. The supplied compiled frontend/runtime is preserved under `runtime/dist`; canonical route and report contracts are maintained in `packages/contracts` and `validation/reference`.

Migrations 001–064 are recovered as editable source-map files. Migrations 065–070 are preserved as runtime-only migration provenance because their editable source was absent from `server.cjs.map`; SQL semantics were not fabricated.

## Validation
Run:

```bash
node scripts/validate-rebuild.cjs
node scripts/check-ts-syntax.cjs
node tests/unit/finance-reports-smoke.cjs
node scripts/package-release.cjs
```

The validation gate enforces the supplied evidence cardinalities, route/report inventory, recovered source count, migration continuity, input archive hashes, and secret-placeholder rules.

## Database authority
P10-approved recovery architecture: MySQL 8.0, database `restrox_prod`, runtime user `restrox_app`, migration user `restrox_migrator`, readonly user `restrox_readonly`, backup user `restrox_backup`. Secrets are injected outside source control.
>>>>>>> 595fa62 (My lovely chatgpt please analysis thsi depply okey babeeeeee uma uma)
