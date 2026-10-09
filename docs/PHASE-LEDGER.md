# RestroX / RMS — Phase Ledger

This ledger records the phase status from recovered Library artifacts separately from whether the source has been pushed to GitHub.

| Phase / range | Phase name or scope | Recovered status | GitHub status |
|---|---|---|---|
| P01–P42 | Evidence and requirements through Finance reports suite | The recovered P01–P42 phase-chain file marks all 42 phases VALIDATED; chain status is `VALIDATED_WITH_SOURCE_GAPS_EXPLICIT` | Source archive not yet pushed; phase status evidence and inventory documented |
| P43–P45 | Historical continuation / renaming workstream per user | Not fully rehydrated in the P01–P49 chain; a P01–P45 archive exists in Library but raw-byte materialization was denied in this session | Not pushed |
| P46 | Historical continuation / renaming workstream per user | Not fully rehydrated in the P01–P49 chain; a P01–P46 archive exists in Library but raw-byte materialization was denied in this session | Not pushed |
| P47 | Historical continuation / renaming workstream per user | Historical source not rehydrated in the P01–P49 chain | Not pushed |
| P48 | Historical continuation / renaming workstream per user | Purchasing router/types/contracts reconstructed; full historical source not rehydrated | Not pushed |
| P49 | Cross-domain financial and inventory reconciliation | Current-workspace source/contract checks recorded as passing with mocked database; production build/runtime gaps remain | Not pushed |
| Recovery documentation | Source archive inventory, phase chain, status and ledger | Updated from recovered artifacts | Committed separately; does not include application source |

## Recovered evidence

- `restrox-rebuild-01-42.tar.gz` is available in Library and has SHA-256 `1f9ab29af3df90c384abfe4b280322d1e24b7d7f0c4200370de92923e1d29786`, matching its release manifest.
- The archive contains source/runtime files, migrations, validation scripts, and reports for all phases P01–P42.
- `restrox-rebuild-01-49.tar.gz` is also available; its phase-chain report explicitly records P43–P47 source gaps and P48 partial reconstruction.
- Full production readiness is **not** established by these archives.

## Mandatory workflow

For each subsequent phase:
1. Recover exact scope and prior decisions.
2. Inspect source and baseline.
3. Implement only the phase scope.
4. Run relevant tests and record real results.
5. Revalidate from P01 through the current phase and repair regressions.
6. Add a phase report under `docs/phases/`.
7. Review changes and secrets.
8. Commit and push without rewriting history.
9. Verify the remote branch and files.
10. Report the exact phase(s) and artifacts actually pushed.

See [recovered artifact inventory](RECOVERED-ARTIFACT-INVENTORY.md) for package details and limitations.
