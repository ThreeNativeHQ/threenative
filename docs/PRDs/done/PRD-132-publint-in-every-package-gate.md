---
prd_contract: v1
---

# PRD-132 — No package runs `publint`, and `AGENTS.md` says every one of them does

**Status:** COMPLETE, 2026-08-18. Acceptance is recorded in
`docs/verification/prd-132-publint-2026-08-17.md`; all six publishable package tests run strict
`publint`, and the manifest guard has a passing negative control.

**Outcome:** `pnpm test` fails when any publishable package's export map, `files` list, or
`types` resolution is broken, on every package rather than on none — and a guard fails when a
package's `test` script stops running the check.

**Depends on:** nothing. `publint` is already a dependency of the tree.

**Blocks:** nothing. It is a gate, not a feature.

**Complexity: 2 → LOW mode.** Six `test` scripts and one guard spec.

**Blast radius: 8 files.** All six `packages/*/package.json`, `scripts/__tests__/` (one new
spec), `AGENTS.md` only if the rule needs restating.

---

## 1. The claim and the tree disagree

`AGENTS.md` says, under Code conventions:

> Every package's `test` script is its build plus `publint`, so a broken export map fails
> `pnpm test`.

What the six packages actually run, read out of their manifests on 2026-08-17:

| Package | `scripts.test` | Runs `publint` |
| --- | --- | --- |
| `@threenative/core` | `pnpm run build` | **no** |
| `@threenative/create-threenative` | `pnpm run build` | **no** |
| `@threenative/physics` | `pnpm run build` | **no** |
| `@threenative/ui` | `pnpm run build` | **no** |
| `@threenative/playtest` | `pnpm run build && … vitest run … && bash __tests__/orphan-cleanup.sh` | **no** |
| `@threenative/runtime-native` | `vitest run … && pnpm native:physics:parity` | **no** |

**Zero of six.** The sentence in `AGENTS.md` is not describing a weakened gate; it is describing a
gate that is not there at all, and it has been read as true by every agent that has worked here.

This is the repository's own named failure mode — a check that reports green while asserting
nothing — sitting in the one place a stranger's install goes through. Four packages ship
`files: ["dist"]` and an `exports` map that nothing validates, and npm does not let a bad version
be republished.

## 2. What lands

1. Every publishable package's `test` script becomes its existing command **plus**
   `publint --strict` (or `publint` if `--strict` is red on landing — see §4).
2. A guard spec in `scripts/__tests__/` reads every non-`private` manifest under `packages/` and
   fails when its `test` script does not contain `publint`. Fails closed: a package with no
   `test` script at all is a failure, not a skip.
3. Whatever `publint` finds is fixed, or recorded in §4 with the reason it is accepted.

The guard is the point. Adding six strings to six manifests is undone by the next person who
rewrites a `test` script; a spec that reads the manifests is not.

## 3. Acceptance

Executable, in order. Each must be pasted with its real output into
`docs/verification/prd-132-publint-2026-08-17.md`.

| # | Command | Required result |
| --- | --- | --- |
| 1 | `pnpm -r --if-present run test` | exit `0`, and `publint` output visible for all six packages |
| 2 | `pnpm vitest run scripts/__tests__/publint-gate.spec.ts` | pass |
| 3 | temporarily strip `publint` from `packages/core/package.json` `test`, re-run #2 | **fails**, naming `@threenative/core` |
| 4 | `pnpm test` | exit `0` |

Step 3 is not optional. A guard nobody has watched fail is a guard nobody has tested.

## 4. Findings ledger

Left empty on purpose. Fill it in when the check first runs: one row per `publint` diagnostic,
per package, with `fixed` or the reason it is accepted. If `--strict` produces diagnostics that
are not worth fixing today, land plain `publint`, record the `--strict` output here, and say so
in the status line rather than dropping the finding.

## 5. What this does not claim

Not that the packages install correctly — `publint` reads a manifest, it does not run
`npm install` in a clean directory. `scripts/verify-registry-install.ts` is the lane that would
answer that, and this PRD does not touch it.
