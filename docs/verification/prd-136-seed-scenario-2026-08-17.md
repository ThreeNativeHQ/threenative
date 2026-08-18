# PRD-136 seed scenario verification — 2026-08-17

The defect is in the starter template: the old scenario asserted one internal seeded-generator
float. The replacement asserts the seeded world, a changed `levelX`, and the inclusive range
`[-1, 1]`. The template keeps the `-99` sentinel through the runner's initial sample, then
reports the seeded level after 0.25 fixed seconds; this is required because the bridge's normal
before sample occurs after `Scene.enter`.

## 1. Audit

Command:

```sh
grep -rnE '"equals": *-?[0-9]+\.[0-9]{6,}' packages/create-threenative/templates/*/playtests/
```

Initial output, exactly one hit:

```text
packages/create-threenative/templates/starter/playtests/seed.playtest.json:13:      { "id": "GameState", "path": "levelX", "allowTrivial": true, "equals": -0.6056551518850029 }
```

After the change, the same command returned no matches.

## 2. Core seed proof

```sh
pnpm vitest run packages/core/__tests__/seed.spec.ts
```

Result: exit `0`; 1 test passed. The test replays seed `90210` and asserts a different seed
diverges.

The focused change suite also passed:

```text
Test Files  4 passed (4)
Tests       90 passed (90)
```

## 3. Scaffold and edit pair

The starter was scaffolded with `packageLocalFramework` and `createProject` into a temporary
directory. Dependency installation completed; the optional native prebuilt installer reported
HTTP 404 for this Linux host but did not fail installation.

The unmodified generated project's exact `pnpm test` was run in an isolated user/network
namespace so the unrelated host listener on port `4173` could not interfere:

```sh
unshare --user --map-root-user --net sh -c 'ip link set lo up; pnpm test'
```

It reached the first `survives` playtest and returned exit `2` with:

```text
TN_PLAYTEST_BRIDGE_MISSING
Scenario requires semantic capabilities but '__THREENATIVE_PLAYTEST_BRIDGE__' is not installed.
```

This is a host/browser setup result: the generated script supplies no `--browser-recipe webgpu`,
and this Linux Chromium run does not expose the app bridge without the repository's documented
browser recipe. The seed-specific run was therefore executed with the recipe and the authenticated
headed NVIDIA display.

Baseline seed observation:

```text
resource.GameState.levelX: before -99, after -0.6056551518850029, pass true
world.seed: observed 90210, pass true
pass: true
exit: 0
```

After inserting one extra `ctx.random.range(0, 1)` before the level-draw block, the same
seed-specific playtest returned exit `0`; observed `levelX` was `0.33044456131756306`.

For the negative control, the level draw was replaced with `Math.random` while the extra seeded
draw remained. The seed-specific playtest returned exit `1`:

```text
TN_PLAYTEST_RESOURCE_ASSERTION_FAILED
resource.GameState.levelX: before -99, after 2, expected [-1, 1], pass false
world.seed: observed 90210, pass true
scenario: seed
```

The failure is therefore the required `seed.playtest.json` assertion, not a deleted assertion or
a world-seed mismatch.

## 4. Template suite

```sh
pnpm test:templates
```

The command returned exit `1` after scaffolding `action-rpg`. Its first generated playtest stopped
before assertions with:

```text
TN_PLAYTEST_SERVER_FAILED
Managed server URL is already in use before startup. URL: http://127.0.0.1:4173.
```

The listener is an unrelated pre-existing process on the shared host; it was not terminated.

## 5. Repository checks

```text
pnpm typecheck  — exit 0
pnpm test       — exit 0; 134 test files, 1,195 tests passed
pnpm lint       — exit 1; existing complexity diagnostics outside this lane
```

## 6. Follow-up after the scaffold-runner fix

Commit `dfa62f7` made generated template test scripts include the WebGPU browser recipe and use
managed ports. On 2026-08-18, `pnpm test:templates` scaffolded and ran all seven templates —
action-rpg, defense, minimal, platformer, racing, shooter and starter — with exit `0`. This
supersedes the host-setup failure recorded in §4 and re-proves the generated starter test gate.
