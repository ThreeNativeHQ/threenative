# PRD-291 device-input verification — 2026-08-31

## Result

The browser lane is proven for the seven templates that existed at the PRD parent commit
`c064b6a0`. Six templates now expose local touch controls and the platformer uses the same
portable predicate on browser and native. Native execution is `UNVERIFIED`: this environment has
no physical-device serial and no Android emulator. The complete discovered-template gate passed
before this review repair; its post-repair rerun reached every template but exited `1` on the
unchanged `defense-survive-ten-waves` `state.leaks` assertion, and an isolated retry reproduced
that unrelated failure. The full repository unit gate is environment-blocked by six unbuilt native
test executables, and the budgets gate reports a stale native-coverage digest; neither failure is
caused by this lane's template changes.

The PRD's seven-template set is the `action-rpg`, `defense`, `minimal`, `platformer`, `racing`,
`shooter`, and `starter` directories listed by:

```sh
git ls-tree -d --name-only c064b6a0:packages/create-threenative/templates
```

The `sailing` template was added after that parent and is outside this PRD lane.

## Phase 0 playability table

Phase 0 inspected the parent behavior before the fix. Browser results were reproduced through the
template playtests and source review. The native column is intentionally marked `UNVERIFIED`, not
presented as an execution result; the named interaction was not run without a device lane.

| Template | Touch-only browser | Touch-only native |
| --- | --- | --- |
| action-rpg | **FAIL** — no movement, attack, or ability control | **UNVERIFIED** — no serial/emulator; interaction not executed |
| defense | **PASS** — pointer placement advances tower placement | **UNVERIFIED** — no serial/emulator; pointer placement not executed |
| minimal | **FAIL** — no movement or jump control | **UNVERIFIED** — no serial/emulator; movement/jump not executed |
| platformer | **FAIL** — `isNative()` hid movement/jump controls in a browser | **UNVERIFIED** — no serial/emulator; native control path not executed |
| racing | **FAIL** — no steering/throttle, boost, or brake control | **UNVERIFIED** — no serial/emulator; driving interaction not executed |
| shooter | **FAIL** — no movement, aim, or fire control | **UNVERIFIED** — no serial/emulator; shooting interaction not executed |
| starter | **FAIL** — no movement or jump control | **UNVERIFIED** — no serial/emulator; movement/jump not executed |

After the change, the six scoped browser lanes and the existing platformer browser lane all pass:
`action-rpg-touch-controls`, `minimal-touch-controls`, `platformer-touch-controls-web`,
`racing-touch-controls`, `shooter-touch-controls`, and `starter-touch-controls`. Keyboard
`survives` lanes also pass and assert that `touch-controls` is absent. Native behavior remains
unverified, with the source prediction **PASS** for all seven mobile-native paths because the same
pointer map and local control code are used; this is not a native execution claim.

## Portable predicate

Every changed continuous-input scene uses exactly:

```ts
const showTouchControls = isMobile() && isTouchscreenAvailable();
```

`isMobile()` and `isTouchscreenAvailable()` read the platform snapshot. Browser detection uses the
mobile form-factor signal and `maxTouchPoints`; native detection reads the validated native
platform marker. The platformer no longer imports or checks `isNative()` for control visibility.

Known-wrong or intentionally unsupported classes are: a desktop-form-factor convertible whose
touchscreen is its primary input; a tablet/browser embedding that suppresses `maxTouchPoints`; a
desktop-mode tablet whose UA data reports non-mobile; a stylus-only surface that is not represented
as touchscreen points; and a native host that reports an incorrect `formFactor` or touch count.
The predicate is deliberately a portable mobile-touch convention, not a general input-remapping
system.

The browser runner marks only scenarios that both send pointer steps and explicitly assert
`touch-controls` present as touch-primary browser scenarios. It supplies Playwright touch points and
mobile UA data for those scenarios. Existing pointer-only scenarios, including defense's pointer
placement proof and pinch/wheel scenarios, retain their desktop platform signal.

## Implementation and ownership

- `action-rpg`, `minimal`, `racing`, `shooter`, and `starter` each gained a local
  `src/render/touch-controls.ts` with movement plus the controls needed by that loop.
- `platformer` keeps its existing `src/render/touch-controls.ts` and `touch-layout.ts`; only its
  predicate and browser touch proof changed.
- Each control is registered through that template's entity registry, imports Three.js and local
  render palette code only, and is deletable without editing a framework package.
- Minimal skips its WebGPU `Atmosphere` path on the touch-primary browser lane. The first real
  touch run showed renderer errors and a blank capture in that template's mobile-emulation path;
  the fallback keeps the playable scene and controls visible while leaving desktop atmosphere
  behavior unchanged.

## Mutation evidence

These red runs were observed, then each temporary mutation was restored before the final green
runs.

### AC1 — restoring the platformer's `isNative()` clause

Temporary source mutation:

```ts
const showTouchControls = isNative() && isMobile() && isTouchscreenAvailable();
```

Command:

```sh
TN_TEMPLATE_ONLY=platformer pnpm test:templates
```

Observed exit `1`; `platformer-touch-controls-web` failed
`resource.state.jumps`, `resource.state.playerX`, `movement.distance`, and
`visibility.touch-controls`. The portable expression was restored and the same scoped run passed.

### AC2 — deleting one template-owned control

Temporary mutation:

```sh
cp packages/create-threenative/templates/action-rpg/src/render/touch-controls.ts /tmp/prd291-action-rpg-touch-controls.ts
rm packages/create-threenative/templates/action-rpg/src/render/touch-controls.ts
```

Command:

```sh
pnpm vitest run packages/create-threenative/__tests__/touch-controls.spec.ts
```

Observed exit `1`; the complete ownership spec ran all 11 tests (the six parameterized template
cases plus the shared touch-control behavior), with 10 passing and only the action-rpg ownership
case failing with `ENOENT` for its deleted local file. The file was restored from
`/tmp/prd291-action-rpg-touch-controls.ts` before verification.

### AC4 — forcing controls on for desktop

Temporary source mutation:

```ts
const showTouchControls = true;
```

Command:

```sh
TN_TEMPLATE_ONLY=platformer pnpm test:templates
```

Initial review reproduction, before the repair, exited `1`; desktop keyboard `survives` failed
only `visibility.touch-controls` because the forced touch entity appeared, while the existing
whole-frame `visual.0.region` assertion passed. That demonstrated the missing visual negative
control.

The repaired `survives` scenario adds a second visual region at the jump-control top-ring bound
`(x: 1172, y: 552, width: 16, height: 20)` with `maxLuminance: 0.4` and
`maxDarkPixelRatio: 0.05`. With the same temporary `true` mutation, the command exited `1` after
22 platformer scenarios; `survives` reported `visual.1.region.maxDarkPixels` with observed dark
ratio `0.234375` above `0.05`, plus `visibility.touch-controls`. All other scenarios passed.
The portable predicate was restored. A repeat of the command then exited `0`; all 22 platformer
scenarios passed, including keyboard `survives` and `platformer-touch-controls-web`.

## Final evidence commands

Commands are recorded with their observed result on 2026-08-31.

| Command | Result |
| --- | --- |
| `pnpm exec playwright install chromium` | PASS — installed the repository's Playwright Chromium/FFmpeg assets |
| `pnpm sync:agents` | PASS — `17 mirrors, 0 written` |
| `pnpm sync:agents --check` | PASS — `17 CLAUDE.md mirrors` in sync |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS — Biome reported existing warnings only |
| changed-file `pnpm exec biome check --max-diagnostics=1000 ...` | PASS — 35 files, 0 errors, 11 existing complexity/style warnings |
| `pnpm --filter @threenative/playtest build` | PASS — ESM, DTS, and publint all passed |
| focused Vitest: `scripts/__tests__/count-loc.spec.ts packages/create-threenative/__tests__/touch-controls.spec.ts packages/create-threenative/__tests__/platformer.spec.ts packages/create-threenative/__tests__/playtest.spec.ts` | PASS — 4 files, 74 tests |
| `pnpm vitest run packages/playtest/__tests__/schema-boundaries.spec.ts packages/playtest/__tests__/evidence-required.spec.ts packages/create-threenative/__tests__/touch-controls.spec.ts packages/create-threenative/__tests__/platformer.spec.ts packages/create-threenative/__tests__/playtest.spec.ts scripts/__tests__/count-loc.spec.ts` | PASS — 6 files, 117 tests |
| `TN_TEMPLATE_ONLY=platformer pnpm test:templates` with `const showTouchControls = true` | FAIL as required — `survives` failed visual `visual.1.region.maxDarkPixels` (`0.234375 > 0.05`) and semantic `visibility.touch-controls` |
| `TN_TEMPLATE_ONLY=platformer pnpm test:templates` after restoring the portable predicate | PASS — all 22 platformer scenarios, including keyboard `survives` and touch `platformer-touch-controls-web` |
| `TN_TEMPLATE_ONLY=action-rpg,minimal,platformer,racing,shooter,starter pnpm test:templates` | PASS — all six scaffolded template suites and six touch scenarios passed |
| `TN_TEMPLATE_ONLY=defense pnpm test:templates` (pre-repair verification) | PASS after an intermediate unchanged `defense-survive-ten-waves` (`state.leaks`) retry |
| `pnpm test:templates` (pre-repair verification) | PASS — all discovered templates passed, including `defense-pointer-placement`, `defense-survive-ten-waves`, and all six new touch scenarios |
| `pnpm test:templates` (post-repair rerun) | FAIL — all templates except `defense-survive-ten-waves` passed; that unchanged scenario failed `resource.state.leaks` |
| `TN_TEMPLATE_ONLY=defense pnpm test:templates` (post-repair retry) | FAIL — reproduced the same unchanged `defense-survive-ten-waves` `state.leaks` assertion; no defense file changed |
| `pnpm tsx scripts/count-loc.ts` | PASS — output recorded below |
| `pnpm quality` | PASS — informational existing file-length/suppression report |
| `pnpm budgets` | BLOCKED — stale native-coverage source digest; it requests the native coverage regeneration command, which is outside this lane |
| `pnpm test` | BLOCKED — six native-runtime tests require unbuilt executables under `packages/runtime-native/build/`; 640 tests passed, 39 skipped, 6 failed setup checks |
| `adb devices; xcrun --version 2>&1 || true; emulator -list-avds 2>&1 || true` | UNVERIFIED — no ADB serial, `xcrun` is unavailable, and `emulator` is unavailable |

The full discovered template command was repeated after the runner classification fix. In the
final complete run, defense's pointer placement and survive-ten-waves scenarios both passed, as
did every other discovered template. No defense file was changed.

## AC6 — duplication score

`pnpm tsx scripts/count-loc.ts` reported:

```text
touch controls LOC: 1157 across 7 authored copies; hypothetical shared export 219; duplicated 938 (accepted on the look-ownership rule)
```

The seven copies are the five new control files plus platformer's existing `touch-controls.ts` and
`touch-layout.ts`. The hypothetical shared-export number is the largest authored copy, used as a
conservative source-size proxy rather than a proposed framework implementation. The 938 duplicated
lines are accepted because the controls decide appearance and the repository's look rule keeps
those materials, geometry, palette use, placement, and interaction affordances in each template's
`src/render/` source. The duplication is recorded rather than hidden; it is not a signal to move
visual ownership into a package.

## Integration closeout — 2026-09-01

The implementation commits were integrated against the current main tree and this PRD is archived
in `docs/PRDs/done/`. The touch/playtest/scaffold focused suite passed 9 files and 266 tests; the
final affected template/scaffold/native-smoke suite passed 3 files and 86 tests. `pnpm sync:agents`
passed while writing the repaired template mirrors. Shared repository gate outcomes are recorded
in the PRD-292 integration record. Physical Android/iOS execution remains unverified, as recorded
above.

## Review repair — 2026-09-02

`maxDarkPixelRatio` now fails closed unless it is a finite ratio in `[0,1]`. The malformed
`maxDarkPixelRatio: 2` schema test was red before the accessor change and passes afterward with the
same `TN_PLAYTEST_SCENARIO_INVALID` contract used by the other schema boundaries. The generated
starter boot-failure scenario uses the bounded field to make its rendered readability proof
observable.
