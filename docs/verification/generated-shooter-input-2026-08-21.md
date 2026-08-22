<!-- schemaVersion: 1 -->

# Generated shooter input proof — PRD-P2-7 — 2026-08-21

One committed scenario,
[`packages/create-threenative/templates/shooter/playtests/input-control.playtest.json`](../../packages/create-threenative/templates/shooter/playtests/input-control.playtest.json),
drives a scaffolded shooter project through relative-pointer look, right-button aim hold/release,
and left-button fire on **web and the desktop native target**. Both targets executed for real;
every number below is pasted from the runs. Android is not executed (reason below). No
mobile-readiness or iOS claim is made anywhere in this file.

## What was built

Template (generated user source):

- `src/game.ts` — new bindings: `aim: { mouseButtons: [2] }`, `look: { pointerRelative: true }`,
  and `fire` gains `mouseButtons: [0]` beside its key binding. `fire`'s old `pointer: true` is
  removed: with it, *any* active pointer latches fire, so the right-button aim press itself would
  have fired the weapon and "left-button fire" would have been unprovable.
- `src/render/camera.ts` — `follow`/`snap` take a yaw; offset and look-ahead orbit around the
  player by that angle, so camera rotation and aim direction stay one rig.
- `src/scenes/Play.ts` — accumulates relative mouse pixels into yaw (`0.005 rad/px`, applied per
  pixel, never per second), publishes `yawDegrees`, engages/releases aim with events, rotates shot
  origin and direction with the view, and counts `shotsFired`, `aimedShots`, `demoDamage`.
- `src/state.ts` — the five new GameState fields.
- `package.json` — adds `"esbuild": "0.27.0"`. The shooter template was missing what starter,
  minimal and platformer already ship; without it a cold scaffold cannot even boot `pnpm dev`
  (`TN_CONFIG_TRANSPILER_MISSING`, vite 8 declares esbuild an optional peer). action-rpg, defense
  and racing still carry this gap; their lanes own it.

Harness:

- `packages/playtest/__tests__/generated-shooter-input.spec.ts` (NEW) — packs the local framework
  packages, scaffolds the shooter template into /tmp like a user's machine (tarballs, no
  workspace), warms the dev server past vite's first-boot dependency optimization, then drives the
  committed scenario through `runStandalonePlaytest` twice: green, then a mutated copy with
  right-button delivery removed, which must red.
- `packages/create-threenative/__tests__/playtest.spec.ts` — scaffold-proof rows pinning the
  scenario's shape and the template bindings.
- `packages/runtime-native/conformance/registry.json` — new versioned
  `generatedPlaytestProofs` section registering the scenario row.
- `packages/runtime-native/tests/generated-shooter-input.test.mjs` (NEW) — registration contract
  plus real desktop-runner execution of the committed scenario over the mailbox transport,
  asserting the exact native delivery order.

## Why the registry row is not in `tests[]`

A `tests[]` row is executed by every full visual-parity lane and must export a `startScene` scene
for pixel comparison; a playtest scenario JSON cannot satisfy that, so either shape turns the web
and android CI lanes permanently red. The row is registered under `generatedPlaytestProofs`
instead — still inside the versioned public registry, pointing at the committed template scenario,
with owner and reason inline — and the runtime-native test fails closed on its absence
("RED observed: native scenario missing"). The pre-existing invariant is untouched: rows not
selected by `--only-tests` report blocked, never passed and never omitted.

## Event sequence (one scenario, both targets)

```
no-input-control   wait 5t          control leg: aiming=0 shotsFired=0 demoDamage=0 demoTargetAlive=1
wake-pointer       move to centre   absorbs the browser's one-off pointer warp (web only)
wake-settle        wait 4t
reset-heading      KeyR             the template's own restart zeroes the view heading
reset-settle       wait 20t         fresh Play scene, yawDegrees=0 exactly
aim-down           right down       buttons 2 held across steps (release: false)
aim-settle         wait 6t          aiming=1, aim-engaged drained here
look-right         +320 px          movementX delivered as a real relative delta
look-right-settle  wait 8t          yawDegrees=92 exactly (320 · 0.005 rad = 91.67°)
look-back          −320 px
look-back-settle   wait 8t          yawDegrees=0 exactly
fire-while-aiming  left joins right buttons=3 → justPressed(fire) while pressed(aim)
fire-settle        wait 8t          shotsFired=1 aimedShots=1 demoDamage=40 demoTargetAlive=0
release-buttons    mask cleared     pointerup closes the pointer
release-settle     wait 8t          aiming=0, aim-released drained
```

Settle drains exist because trusted browser input lands between fixed-step advances while
`bridge.advance(ticks)` runs synchronously; keyboard holds are skew-tolerant but relative-mouse
edges are not, so every numeric assertion is pinned to a post-drain label. Signal assertions stay
label-free: web drains them one step later than desktop (skew), and the state rows carry the
sequence proof.

## Web target — executed

```console
$ cd /tmp/tn-p27-manual/shooter && sh <repo>/scripts/xvfb.sh node <repo>/packages/playtest/dist/runner/cli.js \
    <repo>/packages/create-threenative/templates/shooter/playtests/input-control.playtest.json \
    --project . --browser-recipe webgpu --headed --port 0 --timeout 30000 \
    --server-command "pnpm dev --host 127.0.0.1 --port \$PORT --strictPort"
EXIT=0        # 20/20 assertion results pass
```

Adapter identity (artifacts `capture.json`; copy at [web/capture.json](generated-shooter-input-2026-08-21/web/capture.json)):
`architecture: turing, vendor: nvidia` — hardware WebGPU via `--enable-features=Vulkan`; the
runner fails software adapters outright, so a passing run names a GPU by construction.

Labeled series (from the run report):

```text
no-input-control   yaw=   0 aim=0 shots=0 aimed=0 dmg=0 alive=1
wake-settle        yaw= -43 aim=0 ...            ← the warp, absorbed before anything is measured
reset-settle       yaw=   0 aim=0 ...
aim-settle         yaw=   0 aim=1 ...
look-right-settle  yaw=  92 aim=1 ...
look-back-settle   yaw=   0 aim=1 ...
fire-settle        yaw=   0 aim=1 shots=1 aimed=1 dmg=40 alive=0
release-settle     yaw=   0 aim=0 shots=1 aimed=1 dmg=40 alive=0
signals: aim-engaged @aim-settle; fired{aimed:1}, hit{distanceTenths:78}, defeated @fire-settle; aim-released @release-settle
```

`hit.distanceTenths: 78` is the same physics ray the proven KeyF path produces. Screenshots:
[web/input-look-right.png](generated-shooter-input-2026-08-21/web/input-look-right.png) (view
mid-rotation), [web/after.png](generated-shooter-input-2026-08-21/web/after.png).

The same proof as a vitest gate (this is the focused web arm; it scaffolds its own project):

```console
$ sh scripts/xvfb.sh pnpm exec vitest run --config vitest.config.ts \
    packages/playtest/__tests__/generated-shooter-input.spec.ts
 ✓ packages/playtest/__tests__/generated-shooter-input.spec.ts (3 tests) 17.03ms→s
 Test Files  1 passed (1)
      Tests  3 passed (3)
SPEC_EXIT=0
webgpu adapter: {"architecture":"turing","vendor":"nvidia",...}
raw observations: {"demoDamage":40,"demoTargetAlive":0,"shotsFired":1,...}
```

## Desktop target — executed

Built from the same scaffolded project: provisioned the stable host binary
(`packages/runtime-native/build/tn-linux/mystral`) into the installed package's
`prebuilt/linux-x64/threenative-runtime` slot (the release lane has never published; PRD-078),
then `pnpm build --target desktop` → `dist-native/shooter`.

```console
$ cd /tmp/tn-p27-manual/shooter && sh <repo>/scripts/xvfb.sh node <repo>/packages/playtest/dist/runner/cli.js \
    <repo>/.../input-control.playtest.json \
    --project . --target desktop --executable dist-native/shooter --artifacts artifacts/desktop-final --timeout 30000
EXIT=0        # 20/20 assertion results pass
```

Labeled series — identical numbers to web, with zero skew (native delivers input between ticks
deterministically): `look-right-settle yaw=92`, `look-back-settle yaw=0`, `fire-settle
shots=1 aimed=1 dmg=40 alive=0`. Signals drained one label earlier than web (same tick);
the label-free signal rows cover both. Screenshots:
[desktop/input-look-right.png](generated-shooter-input-2026-08-21/desktop/input-look-right.png),
[desktop/after.png](generated-shooter-input-2026-08-21/desktop/after.png); host console captured
at [desktop/console.json](generated-shooter-input-2026-08-21/desktop/console.json).

Transport-level ordering proof
(`packages/runtime-native/tests/generated-shooter-input.test.mjs`, 4 tests green): the real
desktop runner drives the committed scenario through `DeviceBridgeTransport` and the deliveries at
the native host seam are exactly

```json
[
  { "buttons": 0, "type": "pointermove", "x": 640 },
  { "buttons": 2, "type": "pointerdown", "x": 640 },
  { "buttons": 2, "type": "pointermove", "x": 960 },
  { "buttons": 2, "type": "pointermove", "x": 640 },
  { "buttons": 3, "type": "pointermove", "x": 640 },
  { "buttons": 0, "type": "pointermove", "x": 640 },
  { "buttons": 0, "type": "pointerup",   "x": 0 }
]
```

plus `KeyR` keyDown/keyUp — so `packages/playtest/src/three/device.ts` needed **no** edit: the
runner's existing button-mask state machine already preserves right-hold → left-while-held →
release order, and the C++ host synthesizes `movementX` from client-position deltas
(`runtime.cpp`), matching web semantics.

## Negative controls — both observed red, named mutations, restored

**Web — remove right-button delivery** (mutation: strip `buttons: 2` from the aim step AND reduce
the fire step to left-only `buttons: 1`, so no event carries the right bit; everything else
byte-identical). From the focused spec run:

```console
$ sh scripts/xvfb.sh pnpm exec vitest run --config vitest.config.ts \
    packages/playtest/__tests__/generated-shooter-input.spec.ts
RED observed: generated shooter input state unchanged
failed assertions: ["resource.state.aimedShots.atSteps","resource.state.aiming.atSteps","signal.aim-engaged","signal.aim-released"]
SPEC_EXIT=1
```

The first mutation attempt taught the control's shape: removing only the aim step's press leaves
the fire step carrying mask 3, which still contains the right bit — the game correctly read aim as
held. Right-button delivery means every delivery of the bit, so the mutation removes both.

**Native registration — remove the conformance row** (mutation: delete the
`generated-shooter-input-control` entry from `registry.json`, run, restore):

```console
$ cd packages/runtime-native && pnpm exec vitest run --config vitest.config.ts tests/generated-shooter-input.test.mjs
Error: RED observed: native scenario missing (generated-shooter-input-control is not registered)
RED_EXIT=1
```

Restored; the committed suite also asserts this rejection against an in-memory mutated copy
(test "negative control: removing the registry row rejects the native proof").

## Blocked / not-executed targets

- **Android** — not executed. A physical device is attached (`37251FDJH0037Z`, plus Wi-Fi ADB
  `192.168.1.192:5555`), but the PRD requires web and ONE native target; desktop is that target.
  Running Android would additionally require the APK packaging lane (JDK 17, provisioned
  `third_party/v8-android`) which this PRD does not own. Recorded as not-executed, not blocked-on-
  a-missing-device, since the device is reachable.
- **iOS** — no claim; no lane executed.

## Gates

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | clean (rerun after every refactor) |
| `pnpm lint` | my files clean; one error in `packages/core/src/renderer.ts` from a concurrent lane's in-flight edit, not this change |
| focused generated-shooter spec (web arm, xvfb) | 3/3 passed, exit 0 (rerun after every spec change) |
| runtime-native vitest focused | 4/4 passed |
| scripts temp-dir guard | passing — both new suites register cleanup through `test-support/temp-dir.ts` (`makeTempDir`), which the guard requires over raw `mkdtemp` |
| desktop-native scenario run | exit 0, 20/20, adapter/target recorded above |
| full `pnpm test` | **blocked by concurrent lanes**, not by this change — see below |
| `pnpm census` | ran; diff left uncommitted for the coordinator |

Full-suite attempts during this window each surfaced a different concurrent lane's in-flight red,
never this change's:

1. `packages/playtest/src/scenario.ts`, uncommitted mid-refactor by a concurrent lane — broke the
   playtest DTS build (`error TS2322/TS2554`) and cascaded into root typecheck. That lane fixed it;
   a later run got past it.
2. `packages/physics/__tests__/native-contract.spec.ts` + `src/native/host.ts`, also a concurrent
   lane's uncommitted work — passes focused (14/14), flaked under full-suite parallelism.
3. The P2-6 worktree guard tripped when another agent committed while the ~5-minute suite ran
   (`TN_WORKTREE_GUARD_FAILED: phase 'build' — worktree HEAD changed`).
4. The last attempt failed 7 renderer-metrics rows across `packages/core/__tests__` and
   `packages/playtest/__tests__/performance.spec.ts` while two lanes held fresh uncommitted edits
   across `packages/core/src/{renderer,loop,game,playtest}.ts` and
   `packages/runtime-native/src/runtime.cpp` + webgpu sources (mtimes inside the run window).

Every gate this change owns is green individually, including the previous full-suite pass point:
in the fourth attempt's predecessor, the only two failures were the physics flake above and this
spec's negative arm timing out under load — fixed here by generous page/server timeouts and the
temp-dir registration the guard requires (`makeTempDir`, not raw `mkdtemp`). The coordinator
should rerun `pnpm test` once the concurrent lanes land.

## Findings for the next game (not scoped into this PRD)

1. Cold-scaffold esbuild gap on action-rpg, defense and racing templates (shooter fixed here).
2. Relative-mouse edges need settle drains under fixed-step web runners; the harness could offer
   a first-class drain primitive if a second game hits this.
3. The browser emits exactly one spurious pointer-warp mousemove on first motion under Xvfb;
   games should ignore pre-capture look input or reset heading on capture.
