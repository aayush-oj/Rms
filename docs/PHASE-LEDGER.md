# RestroX / RMS — Phase Ledger

This ledger is the index for verified implementation phases. A phase must not be marked complete until its implementation, documentation, regression checks, and remote GitHub commit are verified.

| Phase | Scope | Status | Validation | Commit |
|---|---|---|---|---|
| Historical phases | Awaiting recovery from the “Aanalyatic report” conversation or original artifacts | Unverified — do not infer | Not available | Not available |
| Repository workflow baseline | Record repository baseline and define mandatory phase workflow | Documentation committed | Remote commit verified; application checks not applicable to this documentation-only change | See project status commit |

## Rules

- Add a row for each real phase in chronological order.
- Link the phase report in `docs/phases/`.
- Record only test results actually observed.
- Record the exact commit SHA and link for every completed phase.
- If a phase is blocked, document the blocker rather than claiming completion.
- Keep historical reconstructed notes clearly labeled and do not fabricate missing details.

## Phase report template

Create `docs/phases/PHASE-XX-short-name.md` with:
1. Objective and acceptance criteria
2. Scope and implementation summary
3. Files/modules changed
4. Architecture, schema, API, and configuration decisions
5. Security and compatibility review
6. Tests and exact results
7. Phase 1-to-current regression review
8. Known issues and follow-ups
9. Commit SHA and remote verification
