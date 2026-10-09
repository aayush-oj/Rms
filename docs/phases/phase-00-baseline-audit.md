# Phase 0 — Baseline and phase-chain audit

**Purpose:** Establish a verified starting point before accepting Phase 43. This is a project-control step, not an additional product phase; the canonical master plan remains P01–P64.

## Repository and plan baseline

- Repository: https://github.com/aayush-oj/Rms, branch `main`.
- Canonical plan: `docs/analysis/master-plan.json` declares 64 phases, 142 canonical routes, 253 API methods, and 103 SQL entities.
- Phase register: `docs/analysis/phase-coverage-01-42.json` describes the recovered scope and evidence posture for P01–P42.
- Route authority: `validation/reference/routes.json` and `docs/analysis/route-phase-map.csv`; PAGE-024 identifies `/en/reports` as P43.
- Prior recovery: P01–P42 are marked historically validated in the recovered chain, with `VALIDATED_WITH_SOURCE_GAPS_EXPLICIT` overall. Historical status is not equivalent to a fresh full build or production certification.

## Preflight findings

1. The source archive, API source, migrations, validation references, runtime bundle and project documents exist on GitHub. A sanitized `runtime/.env.example` template was restored because the baseline validator and deployment handoff require it.
2. Editable frontend source is incomplete; the original frontend route/component source was not supplied. The compiled frontend bundle is preserved as a runtime artifact.
3. The historical TypeScript syntax scan passed for 287 files in the recovered P01–P42 workspace.
4. The historical full validator did not pass: it was blocked because `/mnt/data/ALL_AI_SCREENSHOTS.zip` was unavailable in the validation environment. Do not represent that run as a pass.
5. Phase 43's original standalone HTML/catalog did not by itself prove that `/en/reports` was connected to the app.
6. The later P43 CI workflow now passes two production-mode runtime starts against a clean MySQL 8 test database and verifies the report route/catalog. Browser/accessibility smoke checks now pass in CI; the full twice-repeated P01–P43 regression run remains outstanding.

## Phase 43 work initiated from this baseline

- Retain the accessible, searchable report hub and evidence-backed catalog.
- Add an explicit `/en/reports` handler to the editable server source and canonical static directory-index aliases for the public and preserved runtime trees.
- Keep the runtime copy of the report page/catalog aligned with the editable public copy.
- Add a deterministic smoke test and a GitHub Actions workflow for the smoke test and TypeScript syntax check.
- Revalidate the phase chain from the earliest recovered phase through P43, twice, and record actual run results before sign-off.

## Acceptance policy

Phase 43 remains **in progress** until the targeted test executes successfully, the actual deployed/runtime path is exercised, browser/accessibility checks are recorded, the full-start and P01–P43 regression verification passes twice, and the remote branch is rechecked after any fixes. No historical or static artifact is a substitute for runtime evidence.
