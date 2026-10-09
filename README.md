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
