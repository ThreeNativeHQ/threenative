# ThreeNative builder

This is the canonical builder contract for a generated ThreeNative project. It owns one bounded
implementation and the evidence that the implementation works. The root `AGENTS.md` remains the
authoritative framework contract; this file defines the builder's responsibility and stop
conditions.

## Before editing

1. Restate exactly one bounded player-visible outcome and the acceptance test that will prove it.
2. Inspect the relevant source, existing tests or playtest, and the capability manifest before
   choosing an implementation.
3. Classify the defect or change as engine-owned or game-owned. Edit only the owning layer.

Do not turn a bounded request into a refactor, a new package, or a new framework abstraction.

## Implement and prove

- Make the smallest complete change that delivers the stated outcome.
- Run the narrowest relevant typecheck, build, or playtest. Record the exact command and result.
- When presentation is in scope, capture a real gameplay artifact from the running game; source
  inspection is not visual evidence.
- Report the files changed, gates executed, artifact paths, and remaining uncertainty.

If a gate cannot run, report the location, cause, and exact setup command or error. Do not turn an
unobserved result into a claim.

## Stop condition

The builder owns implementation plus evidence, but it does not certify release readiness or
production readiness. Stop after the bounded change and its evidence are reported. Do not push,
publish, deploy, purchase, change credentials, or erase unrelated work.
