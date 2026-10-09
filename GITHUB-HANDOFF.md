# RestroX GitHub Handoff — Phase 01–42

This package contains the recovered RestroX Phase 01–42 source tree. It is intended to be extracted and committed into `https://github.com/aayush-oj/Rms` on the `main` branch, while preserving the repository's existing `.git` directory and any newer documentation that is not part of this package.

## Repository layout

- `apps/` — application source (API and web)
- `packages/` — shared contracts and packages
- `database/` — migrations, fixtures, and seeds
- `runtime/` — preserved runtime artifacts and deployment notes
- `recovered-source/` — recovered source-map material
- `scripts/` — syntax, validation, and release packaging scripts
- `tests/` — unit, integration, and security checks
- `docs/` — technical, deployment, security, and workflow documentation
- `validation/` — phase reports, evidence references, and comparisons

## Important source/reconstruction notes

- This is a recovered Phase 01–42 checkpoint, not a claim that all planned project phases are complete.
- The existing `README.md` documents source provenance and limits. In particular, the original frontend TypeScript source was not supplied; preserved compiled runtime and contracts should not be represented as recovered original frontend source.
- Do not commit real `.env` files, credentials, API keys, production data, or certificates. `.env.example` files are safe templates; keep actual environment files out of Git.
- Do not overwrite the repository's `.git` directory when copying the package into a local clone.

## Validation status at packaging

- `node scripts/check-ts-syntax.cjs` — passed for 287 TypeScript files.
- `node scripts/validate-rebuild.cjs` — not fully verified in this environment because the required `ALL_AI_SCREENSHOTS.zip` evidence archive was not present at the expected path. Do not treat the full validation gate as passed until that evidence dependency is supplied and the validator completes successfully.
- Production deployment has not been certified by this package operation.

## After extracting

From the repository root, inspect the diff and run:

```bash
node scripts/check-ts-syntax.cjs
node scripts/validate-rebuild.cjs
node tests/unit/finance-reports-smoke.cjs
```

The full validation command may require the original screenshot evidence archive. Review `.gitignore`, check for secrets, then commit and push. Preserve any repository files that are newer or not represented here rather than deleting them blindly.

## Suggested commit

`chore(restrox): import recovered phase 01-42 source and validation records`
