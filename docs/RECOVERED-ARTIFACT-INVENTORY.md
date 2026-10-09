# RestroX Recovery Artifact Inventory

Reviewed: 2026-10-09

## Recovered source packages

| Package | Phase coverage | Stored size | Integrity | What it contains |
|---|---|---:|---|---|
| `restrox-rebuild-01-42.tar.gz` | P01–P42 | 17,292,392 bytes | SHA-256 verified against `release-manifest.json` | Application source/runtime, database migrations, phase reports P01–P42, validation scripts, route map, package metadata |
| `restrox-rebuild-01-49.tar.gz` | P01–P49 checkpoint | 17,305,020 bytes | Local SHA-256: `b13bff838eae0f2a269653cde922467484be53f5f1e6524bc24a66dc32209377`; does not match the separate source-checkpoint manifest hash | P01–P42 baseline plus P49 reconciliation work; phase-chain report explicitly records P43–P48 source gaps |
| `restrox-rebuild-01-46.tar.gz` | P01–P46 checkpoint | 17,295,059 bytes | Archive exists in Library; raw-byte materialization was denied in this session | Candidate intermediate checkpoint; not inspected locally |
| `restrox-rebuild-01-45.tar.gz` | P01–P45 checkpoint | 17,294,447 bytes | Archive exists in Library; raw-byte materialization was denied in this session | Candidate intermediate checkpoint; not inspected locally |

The P01–P42 archive SHA-256 is `1f9ab29af3df90c384abfe4b280322d1e24b7d7f0c4200370de92923e1d29786`, matching the stored release manifest.

## Phase status evidence

The P01–P42 archive contains 42 individual reconstruction reports, `validation/phase-reports/phase-01-42-chain.json`, `validation/reference/phases-01-42.json`, route/coverage data, validation scripts, API/backend/frontend source and runtime artifacts.

The P01–P42 chain marks every phase P01 through P42 as `VALIDATED` and the chain status as `VALIDATED_WITH_SOURCE_GAPS_EXPLICIT`. This is the archive's recorded validation status, not a fresh production certification.

The P01–P49 chain records:
- P01–P42: validated from the persisted baseline.
- P43–P47: historical source not rehydrated.
- P48: purchasing router/types/contracts reconstructed, but full historical source not rehydrated.
- P49: current-workspace validation with mocked database.
- Release: not deployable; full build, real MySQL integration and runtime/frontend verification remain open.

## Phase names present in the P01–P42 reports

1. P01 — Evidence provenance & checksums
2. P02 — Canonical requirement model
3. P03 — Route canon & compatibility map
4. P04 — Workflow canonicalization
5. P05 — Screenshot baseline & viewport matrix
6. P06 — Video timeline & motion canon
7. P07 — Current code artifact reconciliation
8. P08 — API contract reconciliation
9. P09 — Domain state-machine closure
10. P10 — Database authority & engine decision
11. P11 — Security/tenant/RBAC authority
12. P12 — Print/payment/tax policy closure
13. P13 — Canonical source checkout/recovery
14. P14 — Monorepo/tooling scaffold
15. P15 — Reproducible build & release pipeline
16. P16 — Design tokens & typography
17. P17 — Shared UI primitives
18. P18 — Application shell & navigation
19. P19 — Route gateway & locale aliases
20. P20 — Auth, session & recovery
21. P21 — Workspace & branch context
22. P22 — RBAC & permission UX
23. P23 — API client, schemas & state framework
24. P24 — Observability, audit & telemetry
25. P25 — Migration, seed & fixture harness
26. P26 — Analytics routes & data product
27. P27 — Settings core & restaurant configuration
28. P28 — People, staff & customer surfaces
29. P29 — Menu catalog & customization
30. P30 — Table, space & QR
31. P31 — Orders board/table/detail
32. P32 — Reservations
33. P33 — POS modes & cart
34. P34 — KOT/KDS
35. P35 — Notifications & activity
36. P36 — Billing preview & bill lifecycle
37. P37 — Payment settlement & reversal
38. P38 — Invoice, receipt, tax document & print UI
39. P39 — Returns, voids, trash, duplicates & payment edits
40. P40 — Finance transactions & day book
41. P41 — Finance setup & accounting masters
42. P42 — Finance reports suite

## GitHub transfer status

The source archives are recovered and inspectable in the working container, but they have **not yet been pushed as application source** to `aayush-oj/Rms`. The repository currently contains only README and project-status/ledger docs. Do not describe the source package as pushed until the remote tree is verified to contain it.

The available GitHub write actions accept text contents/Git objects, but no binary archive upload or local Git push handoff is available in this execution. The source archive therefore remains the next transfer blocker; the phase metadata and this inventory can be committed independently.


## Fresh checks performed during recovery

- P01–P42 TypeScript syntax scan: PASS, 287 files.
- P01–P49 TypeScript syntax scan: PASS, 293 files.
- P01–P42 full validation script: BLOCKED, because the expected external evidence file `/mnt/data/ALL_AI_SCREENSHOTS.zip` was not present in the execution environment.
- P01–P49 full validation script: BLOCKED for the same missing evidence file.
- These are syntax-only checks plus an environment-blocked validation attempt; they do not certify full application behavior or production readiness.
