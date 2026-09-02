# PRD-291 device-input verification — 2026-08-31

## Result

The browser lane was proven for the seven templates that existed at the PRD parent commit
`c064b6a0`. Six templates exposed local touch controls and the platformer used the same portable
predicate on browser and native. Native execution was `UNVERIFIED`: that environment had no
physical-device serial and no Android emulator.

The current-baseline recovery extends delivery to the eight templates now in the repository and
adds sailing's local touch control, scene wiring, Ship input merge, and browser playtest. Native
execution remains `UNVERIFIED`; no browser or desktop result is inferred as native touch evidence.
The earlier complete discovered-template gate and repository-gate results remain recorded below as
historical recovery evidence; this repair adds a fresh rerun section after the current-baseline
change.

## Historical parent scope

The PRD's seven-template set was the `action-rpg`, `defense`, `minimal`, `platformer`, `racing`,
`shooter`, and `starter` directories listed by:

```sh
git ls-tree -d --name-only c064b6a0:packages/create-threenative/templates
```

The `sailing` template was added after that parent and was outside the original PRD lane. It is
included by the current-baseline recovery below.

## Phase 0 playability table — current eight-template baseline

Phase 0 inspected the parent behavior before the fix. Browser results were reproduced through the
template playtests and source review. The sailing row is the current-baseline pre-repair source
finding because it was added after the parent. The native column is intentionally marked
`UNVERIFIED`, not presented as an execution result; the named interaction was not run without a
device lane.

| Template | Touch-only browser | Touch-only native |
| --- | --- | --- |
| action-rpg | **FAIL** — no movement, attack, or ability control | **UNVERIFIED** — no serial/emulator; interaction not executed |
| defense | **PASS** — pointer placement advances tower placement | **UNVERIFIED** — no serial/emulator; pointer placement not executed |
| minimal | **FAIL** — no movement or jump control | **UNVERIFIED** — no serial/emulator; movement/jump not executed |
| platformer | **FAIL** — `isNative()` hid movement/jump controls in a browser | **UNVERIFIED** — no serial/emulator; native control path not executed |
| racing | **FAIL** — no steering/throttle, boost, or brake control | **UNVERIFIED** — no serial/emulator; driving interaction not executed |
| sailing | **FAIL** — `Ship` read only `ctx.input.vector("move")`, so touch could not advance the course | **UNVERIFIED** — added after parent; no serial/emulator; touch sailing not executed |
| shooter | **FAIL** — no movement, aim, or fire control | **UNVERIFIED** — no serial/emulator; shooting interaction not executed |
| starter | **FAIL** — no movement or jump control | **UNVERIFIED** — no serial/emulator; movement/jump not executed |

After the change, the seven touch-control browser lanes pass:
`action-rpg-touch-controls`, `minimal-touch-controls`, `platformer-touch-controls-web`,
`racing-touch-controls`, `sailing-touch-controls`, `shooter-touch-controls`, and
`starter-touch-controls`. Keyboard `survives` lanes also pass and assert that `touch-controls` is
absent. Native behavior remains unverified, with a source prediction **PASS** for all eight native
interaction paths because the same portable pointer map and local control code are used; this is
not a native execution claim.

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
- `sailing` gained a local `src/render/touch-controls.ts`; `Sailing` passes its movement vector to
  `Ship`, which merges it with the existing keyboard vector before applying boat handling.
- Each control is registered through that template's entity registry, imports Three.js and local
  render palette code only, and is deletable without editing a framework package.
- Minimal skips its WebGPU `Atmosphere` path on the touch-primary browser lane. The first real
  touch run showed renderer errors and a blank capture in that template's mobile-emulation path;
  the fallback keeps the playable scene and controls visible while leaving desktop atmosphere
  behavior unchanged.

## Mutation evidence

These red runs were observed, then each temporary mutation was restored before the final green
runs.

### Current-baseline sailing ownership proof

The missing-sailing proof was made red first by adding `sailing` to
`packages/create-threenative/__tests__/touch-controls.spec.ts` before creating its control file.
The mutation was the test inventory entry itself; the production tree was otherwise unchanged.

Command:

```sh
pnpm exec vitest run packages/create-threenative/__tests__/touch-controls.spec.ts --reporter=dot
```

Observed exit `1`; Vitest reported **1 failed and 11 passed tests**. The failing case was
`template touch controls > keeps sailing controls in its own render source`, with
`ENOENT: no such file or directory` for
`packages/create-threenative/templates/sailing/src/render/touch-controls.ts`.

After the sailing renderer, scene wiring, Ship merge, scenario, and source assertions were added,
the focused green command was:

```sh
pnpm exec vitest run packages/create-threenative/__tests__/touch-controls.spec.ts \
  packages/create-threenative/__tests__/playtest.spec.ts \
  packages/create-threenative/__tests__/scaffold.spec.ts --reporter=dot
```

Observed exit `0`; **3 test files and 104 tests passed**.

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

## Historical evidence commands — 2026-08-31

The following commands are retained with their observed result from 2026-08-31.

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

## AC6 — historical parent duplication score

`pnpm tsx scripts/count-loc.ts` reported:

```text
touch controls LOC: 1157 across 7 authored copies; hypothetical shared export 219; duplicated 938 (accepted on the look-ownership rule)
```

The seven copies were the five new control files plus platformer's existing `touch-controls.ts` and
`touch-layout.ts`. The hypothetical shared-export number is the largest authored copy, used as a
conservative source-size proxy rather than a proposed framework implementation. The 938 duplicated
lines were accepted because the controls decide appearance and the repository's look rule keeps
those materials, geometry, palette use, placement, and interaction affordances in each template's
`src/render/` source. This is retained as the historical parent score; the current-baseline score
including sailing is below.

## AC6 — current-baseline duplication score — 2026-09-02

The current-baseline command reported:

```text
touch controls LOC: 1297 across 8 authored copies; hypothetical shared export 219; duplicated 1078 (accepted on the look-ownership rule)
```

The eight copies are six new control files plus platformer's existing `touch-controls.ts` and
`touch-layout.ts`, across the seven failing continuous-movement templates. The duplicated 1,078
lines remain accepted because the controls decide appearance and stay in each template's
`src/render/` source; no visual ownership moved into a package.

## Recovery verification — 2026-09-02

The recovered touch-input changes were rerun after rebuilding the playtest package, which cleared a
stale platformer bridge artifact:

```text
pnpm exec vitest run packages/playtest/__tests__/schema-boundaries.spec.ts \
  packages/playtest/__tests__/evidence-required.spec.ts \
  packages/create-threenative/__tests__/touch-controls.spec.ts \
  packages/create-threenative/__tests__/platformer.spec.ts \
  packages/create-threenative/__tests__/playtest.spec.ts \
  scripts/__tests__/count-loc.spec.ts
PASS, exit 0; 6 files and 170 tests passed.

TN_TEMPLATE_ONLY=action-rpg,minimal,platformer,racing,shooter,starter pnpm test:templates
PASS for the recovered touch scenarios; each selected template's touch scenario passed.

TN_TEMPLATE_ONLY=platformer pnpm test:templates
PASS, exit 0; all 22 platformer scenarios passed, including keyboard survives and
platformer-touch-controls-web.
```

The desktop forced-true predicate mutation remains red as recorded above. The physical-device
criterion is `UNVERIFIED`: `adb devices` exposed no serial/emulator, `xcrun` and `emulator` were
unavailable, and no native result is inferred from the browser run.

## Prior recovery repository gates — 2026-09-02 (before sailing repair)

The required repository gates were rerun after all four recovery groups were integrated:

| Command | Result |
| --- | --- |
| `pnpm sync:agents` and `pnpm sync:agents --check` | PASS; generated mirrors were refreshed, then all 17 `CLAUDE.md` mirrors were in sync. |
| `pnpm typecheck && pnpm lint && pnpm test` | PASS; typecheck and lint passed (522 warnings only); 340 test files passed, 1 skipped; 3406 tests passed, 2 skipped. |
| `pnpm budgets` | PASS; all budget and freshness checks passed. The informational LOC triggers reported 51,192 framework lines and 117,105 native-runtime lines. |
| `pnpm test:playtest` | PASS; movement, camera, movement-axis, zoom-input, and navigation scenarios passed on NVIDIA/Turing WebGPU with no diagnostics. |
| `PLAYWRIGHT_BROWSERS_PATH=<isolated /home cache> pnpm test:templates` | PASS; 87 scenarios across all 8 templates passed. The first bare invocation waited on an unrelated global Playwright install; the isolated-cache invocation ran the same repository script successfully. |
| `pnpm check:docs` | PASS; 1277 relative links across 944 Markdown files. |

The physical-device criterion remains `UNVERIFIED`: no Android serial/emulator was available,
and `xcrun`/the iOS simulator were unavailable. Browser and desktop evidence is not inferred as
native touch-device evidence.

## Current-baseline sailing repair gates — 2026-09-02

These are the fresh gates for the sailing repair. They extend the historical seven-template
evidence to the current eight-template tree; they do not rewrite the parent-commit record above.

| Command | Result |
| --- | --- |
| `pnpm exec vitest run packages/create-threenative/__tests__/touch-controls.spec.ts packages/create-threenative/__tests__/playtest.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts --reporter=dot` | PASS — 3 files and 104 tests passed; this is the green result after the red missing-sailing ownership proof. |
| `pnpm sync:agents && pnpm sync:agents --check` | PASS — `17 mirrors, 0 written`, then all 17 `CLAUDE.md` mirrors were in sync. |
| `pnpm typecheck && pnpm lint && pnpm test` | PASS — typecheck passed; lint passed with 522 existing warnings; 340 test files passed, 1 skipped; 3410 tests passed, 2 skipped. |
| `pnpm budgets` | PASS — retention and capabilities were fresh; `budgets ok` reported 10 framework packages, 14 examples, 92 PRD files, and no compiled texture manifests. |
| `pnpm test:playtest` | PASS — all five framework/example scenarios passed on NVIDIA/Turing WebGPU with no diagnostics. |
| `PLAYWRIGHT_BROWSERS_PATH=/home/joao/tn-template-playwright.repair-2 pnpm test:templates` | PASS — 88 scenarios across all 8 templates passed, including `sailing-touch-controls`; no native result is inferred. |
| `pnpm check:docs` | PASS — 1,278 relative documentation links across 944 Markdown files. |
| `pnpm tsx scripts/generate-retention-index.ts` | PASS — retention index regenerated for the current tree. |
| `pnpm tsx scripts/count-loc.ts` | PASS — 1,297 touch-control LOC across 8 authored copies; hypothetical shared export 219; duplicated 1,078. |
| `adb devices; xcrun --version 2>&1 || true; emulator -list-avds 2>&1 || true` | UNVERIFIED — ADB listed no serial; `xcrun` and `emulator` were unavailable. |

Native and physical-device lanes remain **UNVERIFIED**. No Android serial/emulator, `xcrun`, or iOS
simulator was available, and no browser result is being presented as native touch evidence.
