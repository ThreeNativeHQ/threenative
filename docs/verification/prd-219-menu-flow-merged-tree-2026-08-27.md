# Lane B — PRD-219 re-proven on the merged tree (night batch 2026-08-26)

**Date:** 2026-08-27 ~00:30. **Lane:** `emulator-5554` (threenative_api35 AVD, android-35,
gpu host). **PRD:** PRD-219, closed DELIVERED 2026-08-25 by its own lane and merged to main
tonight with the batch's step 0.

## Why tonight ran at all

The 08-25 proof ran on the lane's branch. Step 0's job was to land that branch on `main`, which
means the delivered claim had to survive the merge: prd-202 rewrote the runner's shared lanes,
prd-203 restamped the loading screens, and the template hashes moved twice. One unmodified
scenario run on the merged tree closes that gap.

## What ran

Fresh scaffold of the merged starter via local tarballs (the user's path —
`packages/create-threenative/dist/index.js` with `--*-package` overrides, then `pnpm install`),
APK built with `JAVA_HOME=/usr/lib/jvm/java-17-openjdk`, `THREENATIVE_RUNTIME_SOURCE` at the
merged checkout, installed on `emulator-5554`.

**Green** — `playtests/menu-flow.playtest.json --target android`, unmodified, exit `0`:

```
pass: True | target: android | scenario: starter-menu-flow
  True  resource.state.screen         {"after":"playing","before":"menu","expected":{"equals":"playing","changed":true}}
  True  resource.state.characterName  {"after":"axo","before":"","expected":{"equals":"axo"}}
  True  diagnostics                   {"consoleErrors":0,"networkErrors":0,...}
```

**Red control** — `carry` removed from the scaffold's start-game handler
(`goto("play", { carry: … })` → `goto("play")`), rebuilt, reinstalled, same scenario, exit `1`:

```
pass: False | target: android
  True  resource.state.screen         (transition unaffected — the mutation is carry-only)
  False resource.state.characterName  {"after":"","before":"","expected":{"equals":"axo"}}
```

Both runs name their lane: emulator-5554, package `com.threenative.menuflow`, activity
`com.threenative.runtime.MystralActivity` (the activity lives in the runtime package — the
runner's `.MystralActivity` default expands against the app id and fails `Error type 3`;
invoke with the fully-qualified name).

## What the merge broke on the way — fixed tonight, its own commits

1. **A starter scaffold could not build for android at all** on a machine with the Basis
   encoder installed: `TN_NATIVE_KTX2_UNSUPPORTED`, exit 1. The 08-25 lane predated the
   encoder's arrival, so its "fresh scaffold" silently shipped passthrough assets. Fixed in the
   starter's config (models/textures `"none"`) with a tripwire test and tonight's red/green
   pasted in the commit message — the same scaffold then built (`BUILD SUCCESSFUL in 26s`) and
   drove the runs above.
2. One transient `TN_PLAYTEST_BRIDGE_MISSING` on the first run after a manual `am start` had
   raced the app's endpoint extras; the next run connected on the first handshake. Recorded
   here rather than silently retried away.

## Operator notes for the next device lane

- Install the APK yourself (`adb install -r dist-native/<name>.apk`); the runner launches, it
  does not install.
- `.threenative/build/game.js` legitimately contains `TN_NATIVE_SMOKE_*` strings — the runtime
  wrapper emits those markers as present-counter telemetry on every target. Grep for game
  strings (`MainMenu`, `characterName`), not absence of smoke markers, when verifying an APK
  carries the right bundle.

**Verdict:** PRD-219's delivered claim holds on merged `main`. Nothing moved to `done/` again —
the lane archived it correctly.
