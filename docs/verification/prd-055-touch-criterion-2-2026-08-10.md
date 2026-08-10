# PRD-055 criterion 2 — touch playability rerun — 2026-08-10

Result: **BLOCKED at Android execution. Path 1's source contract is satisfied; criterion 2
remains open.** No Android touch result is claimed.

## Path 1 — shipped controls with real behavior

The corrected template contains a real, 181-line touch-control implementation:

```sh
wc -l packages/create-threenative/templates/platformer/src/render/touch-controls.ts
```

Observed:

```text
181 packages/create-threenative/templates/platformer/src/render/touch-controls.ts
```

`touch-controls.ts` defines `touchControlPoint`, `TouchControls#at`,
`TouchControls#isMovementPointer`, multi-pointer hit testing, move-stick clamping, button
edge detection, layout, and visual feedback. The source is wired into the game at:

- `packages/create-threenative/templates/platformer/src/scenes/Level.ts:45` — creates and
  attaches `TouchControls` to the camera;
- `packages/create-threenative/templates/platformer/src/scenes/Level.ts:137` — passes
  `frameCtx.input.raw.pointers` and the viewport size to `touchControls.update`;
- `packages/create-threenative/templates/platformer/src/entities/Character.ts:6` — consumes
  the shared `TouchInput` type.

The source audit was rerun against the actual template:

```sh
platformer='packages/create-threenative/templates/platformer/src'
source_files=$(rg --files "$platformer" | sort | awk 'END { print NR + 0 }')
source_lines=$(rg --files "$platformer" -g '*.ts' -g '*.tsx' |
  xargs awk 'END { print NR + 0 }')
behavior_matches=$(rg -ni \
  'touch(start|move|end|cancel)|pointer(down|move|up|cancel)|PointerEvent|TouchEvent|clientX|clientY|raw\.pointers|setPointerCapture|pointerType|onPointer' \
  "$platformer" | awk 'END { print NR + 0 }')
printf 'platformer_source_files=%s\nplatformer_ts_lines=%s\ntouch_control_behavior_matches=%s\n' \
  "$source_files" "$source_lines" "$behavior_matches"
```

Observed:

```text
platformer_source_files=26
platformer_ts_lines=1325
touch_control_behavior_matches=1

matching:
packages/create-threenative/templates/platformer/src/scenes/Level.ts:137:
        touchControls.update(frameCtx.input.raw.pointers, frameCtx.viewport.size),
```

The regex intentionally finds only the framework-input consumer in `Level.ts`; it does not
count the behavior implemented behind `TouchControls.update`. That undercount does not make
the source contract red: the 181-line implementation and its Level/Character wiring are the
source evidence for Path 1.

## Android execution

The declared aggregate command was rerun:

```sh
pnpm parity
```

It exited `1`. The Android runner stopped at its earlier ADB preflight in this sandbox:

```text
TN_PARITY_ANDROID_ADB_BLOCKED: spawnSync /home/joao/Android/Sdk/platform-tools/adb EPERM
```

No APK was built, no emulator assertion ran, and no touch behavior was observed. The new
missing-AAR preflight is separately fail-closed unit-tested, but this parity rerun did not
reach that later preflight because ADB was denied first.

## Verdict

PRD-055 criterion 2 is **not closed**. The corrected shipped source satisfies Path 1's source
contract, while Android execution remains blocked; therefore no touch playability or Android
parity claim is made.
