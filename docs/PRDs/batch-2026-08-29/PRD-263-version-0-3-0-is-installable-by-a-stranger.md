---
prd_contract: v1
---

# PRD-263 — version 0.3.0 is installable by a stranger

**Status:** PROPOSED — filed 2026-08-29. Depends on Lane A (a green tree),
[PRD-261](./PRD-261-the-release-instruments-report-again.md) (so the result can be graded) and
[PRD-262](./PRD-262-the-runtime-native-prebuilt-release-exists.md) (so `publish:check` can pass).

Fourth lane of [the release batch](./README.md). Moves alpha-bar row **A1** and re-proves **A2**.

**Goal: the eight packages in this workspace exist on the public registry at the versions the
templates pin.** A1 is the bar's first row for a reason — every other claim we make is downstream of
a stranger being able to type one command.

**Complexity:** +2 (8 packages, 8 templates) +2 (registry credentials and a clean-room proof)
+2 (**irreversible**: npm versions cannot be replaced, only deprecated) = **6 → MEDIUM mode**, with
the owner-confirmation gate of a HIGH one.

## The problem, measured today at `8491c5d5`

`pnpm publish:check` → **56 findings, exit 1**, "This tree must not be published as it stands."

The 56 collapse to three facts.

### 1. Two packages have never been published

| Package | Registry | Workspace |
| --- | --- | --- |
| `@threenative/assets` | **E404** | 0.3.0 |
| `threenative-engine-mcp` | **E404** | 0.2.0 |

**All eight templates pin both.** `action-rpg`, `defense`, `minimal`, `platformer`, `racing`,
`shooter`, `starter` — every one of them names dependencies npm cannot resolve. The current tree's
scaffold is uninstallable by anyone, and that is 48 of the 56 findings.

`threenative-engine-mcp` is not an ordinary miss. `packages/core/mcp/servers.mjs:35` names it as the
`npx` fallback for the `threenative-engine` server that `packages/core/scripts/ensure-mcp.mjs` writes
into `.mcp.json` at every consumer install. That server carries `engine_search_capabilities` and
`engine_capability_detail` — the tools the repository's first working rule tells every agent to
consult before writing a system, and the countermeasure to the game that hand-wrote 446 lines that
were already installed and ran at 9 FPS. **The single highest-leverage thing this framework does for
its primary consumer is E404.**

### 2. Six packages are a version behind

| Package | Registry latest | Workspace |
| --- | --- | --- |
| `@threenative/core` | 0.2.0 | 0.3.0 |
| `@threenative/physics` | 0.2.1 | 0.3.0 |
| `@threenative/ui` | 0.2.1 | 0.3.0 |
| `@threenative/playtest` | 0.2.0 | 0.3.0 |
| `@threenative/runtime-native` | 0.2.0 | 0.3.0 |
| `create-threenative` | 0.2.2 | 0.2.3 |

A2 passes today only because it tests `create-threenative@0.2.2`, whose templates predate the
unresolvable pins. **A2's green is about an artifact five versions of drift behind this tree**, and
it will need re-proving after this publish, not carrying forward.

### 3. The runtime prebuilt finding

Owned by [PRD-262](./PRD-262-the-runtime-native-prebuilt-release-exists.md) and listed here only so
the count reconciles: 48 template pins + 7 package rows + 1 prebuilt finding = 56.

## Solution

Run `pnpm release`, which already encodes the lessons this repository paid for. `scripts/release.ts`
publishes in dependency order, refuses on a red `publish:check`, publishes one consistent tree in one
run, and finishes by installing from the registry in a clean room. **It is dry by default; `--yes`
is the only thing that publishes.**

Nothing here re-implements any of that. The work is making `publish:check` green, obtaining the
owner's explicit go-ahead, and proving the result from outside.

**Data changes:** none in this repository. Eight immutable registry versions.

## The irreversibility rule

An npm version cannot be replaced. The 0.2.0 release took four publishes instead of one and three of
the four mistakes were mechanical; `release.ts` exists because of it.

- [ ] **`--yes` runs only with the owner saying so in the same session.** Not inferred from this
      PRD's approval, not from a prior publish, not from a batch sign-off.
- [ ] Registry commands take the untracked local `.npmrc` explicitly: `npm --userconfig .npmrc
      <command>`. It is never printed, logged, or pasted into a record.
- [ ] The dry run's full output is recorded and read **before** the real one, not after.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `@threenative/assets@0.3.0` on the registry | the eight `templates/*/package.json` pins | the E404 | n/a | uninstall it from a scaffold → `npm install` fails naming it |
| 2 | `threenative-engine-mcp@0.2.0` on the registry | `packages/core/mcp/servers.mjs:35` | the E404 | n/a | scaffold, then call `engine_search_capabilities` → it answers |
| 3 | six bumped versions | `templates/*/package.json`, `create-threenative` | the 0.2.x line | n/a | `pnpm publish:check` reds on any pin the registry cannot resolve |

## Execution phases

#### Phase 1: `publish:check` goes green

**Files:** whatever the 56 findings name, the record.

- [ ] Re-run `pnpm publish:check` after PRD-262 lands and record the reduced count.
- [ ] Resolve every remaining finding. A pin the registry cannot resolve is fixed by publishing the
      package, never by loosening the pin.
- [ ] `pnpm publish:check` exit 0, pasted.

**Revert check:** re-pin one template to a version that does not exist → the check reds naming that
template and that package. Paste it.

#### Phase 2: The dry run

**Files:** the record.

- [ ] `pnpm release` with no `--yes`. Record the planned publish order in full.
- [ ] Confirm the order is dependency order and `create-threenative` is last.
- [ ] Confirm the two never-published packages appear in the set. A package silently absent from the
      plan publishes nothing and reports success.

#### Phase 3: The publish

**Files:** the record. **Requires the owner's explicit go-ahead in the session that runs it.**

- [ ] `pnpm release --yes`. Record every version that went out and every one that did not.
- [ ] Record the clean-room install `release.ts` performs at the end, pass or fail.

**Revert check:** not available, by construction. This is why Phases 1 and 2 exist.

#### Phase 4: The stranger's path, proved from outside

**Files:** `docs/verification/registry-install-<date>.md` (NEW), the record.

- [ ] In a directory with **no workspace above it**: `npx --yes create-threenative@<published>
      my-game --template starter && npm install && npm run build`.
- [ ] Confirm `npm install` resolves every package from `registry.npmjs.org` with **zero `file:` or
      `link:` specifiers** — the shape of the existing A2 record.
- [ ] Confirm the install wrote `.mcp.json`, and that the `threenative-engine` server starts and
      answers a capability query. This is the row nobody has ever checked from a published artifact.
- [ ] Confirm `prebuilt/install-status.json` reports `ok: true` (PRD-262's output, re-proved through
      a real scaffold rather than a direct package install).
- [ ] Write the ` ```alpha-bar ` block for **A2**, sourced from the command line. The 2026-08-16
      block describes 0.2.2 and is superseded, not extended.

**Revert check:** run the same scaffold with an offline registry → the install fails rather than
falling back to anything local. A green that a workspace could have produced proves nothing.

## Acceptance criteria

- [ ] `pnpm alpha:bar` reports **A1 pass**: no publishable package absent, no unpublished workspace
      version.
- [ ] `pnpm publish:check` exit 0 on the published tree.
- [ ] A2 has a fresh evidence block naming the version actually shipped.
- [ ] An agent in a scaffolded project can reach `engine_search_capabilities` from the registry alone.
- [ ] No claim in the record names a platform, package, or command that did not execute.
