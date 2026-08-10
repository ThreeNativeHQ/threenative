# PRD-055 criterion 2 — touch playability rerun — 2026-08-10

Result: **RED at the shipped-source contract; Android execution BLOCKED at APK setup.**
Criterion 2 is not closed.

## Audit of both allowed paths

Criterion 2 allows either real controls shipped in the template or the framework input
surface plus no more than twenty lines of user source. The audit inspected the actual
platformer source and the framework API. It did not accept a filename or an empty file as
evidence.

### Path 1 — shipped controls with real behavior

The command counts the platformer source files and TypeScript/TSX lines, then searches for
actual touch-control behavior rather than generic words such as 'pointer-events' or an
entity's collision 'onTouch' callback:

~~~sh
platformer='packages/create-threenative/templates/platformer/src'
source_files=$(rg --files "$platformer" | sort | awk 'END { print NR + 0 }')
source_lines=$(rg --files "$platformer" -g '*.ts' -g '*.tsx' |
  xargs awk 'END { print NR + 0 }')
behavior_matches=$(rg -ni \
  'touch(start|move|end|cancel)|pointer(down|move|up|cancel)|PointerEvent|TouchEvent|clientX|clientY|raw\.pointers|setPointerCapture|pointerType|onPointer' \
  "$platformer" | awk 'END { print NR + 0 }')
printf 'platformer_source_files=%s\nplatformer_ts_lines=%s\ntouch_control_behavior_matches=%s\n' \
  "$source_files" "$source_lines" "$behavior_matches"
~~~

Observed result:

~~~text
platformer_source_files=25
platformer_ts_lines=1131
touch_control_behavior_matches=0
~~~

Path 1 is red: the shipped source contains no touch-control behavior.

### Path 2 — framework input surface plus no more than twenty lines

The framework does expose a pointer surface. This command counts that API, then checks the
template for a pointer binding, raw-pointer consumer, and ordinary input consumer:

~~~sh
platformer='packages/create-threenative/templates/platformer/src'
api_matches=$(rg -n \
  'pointer|pointers|pointerdown|pointermove|pointerup|pointercancel|clientX|clientY|InputAction' \
  packages/core/src/input.ts | awk 'END { print NR + 0 }')
pointer_binding_matches=$(rg -n 'pointer\s*:' "$platformer/game.ts" |
  awk 'END { print NR + 0 }')
raw_pointer_consumers=$(rg -n \
  'raw\.pointers|raw\.pointer\.(position|down|buttons)|pointers\.get' "$platformer" |
  awk 'END { print NR + 0 }')
input_surface_consumers=$(rg -n \
  'ctx\.input\.(vector|pressed|justPressed|justReleased)' "$platformer" |
  awk 'END { print NR + 0 }')
printf 'framework_input_api_matches=%s\npointer_binding_matches=%s\nraw_pointer_consumers=%s\ninput_surface_consumers=%s\n' \
  "$api_matches" "$pointer_binding_matches" "$raw_pointer_consumers" "$input_surface_consumers"
sed -n '8,11p' "$platformer/game.ts"
~~~

Observed result:

~~~text
framework_input_api_matches=42
pointer_binding_matches=0
raw_pointer_consumers=0
input_surface_consumers=3
  input: {
    dash: { buttons: [7], down: ["ShiftLeft", "ShiftRight"] },
    jump: { buttons: [0], down: ["Space"] },
  },
~~~

The three ordinary consumers are ctx.input.vector('move'), ctx.input.justPressed('jump'), and
ctx.input.justPressed('dash'). game.ts binds those actions to keyboard codes and gamepad
buttons; it has no pointer binding. The framework API therefore exists, but the platformer
has no touch mapping or hit-testing behavior at all. Path 2 is not demonstrated, regardless
of its zero authored touch-mapping lines.

Neither allowed path qualifies. This is an observed red result for the lane source, not a
claim that a touch target is playable.

## Android execution

The declared proof was rerun after the aggregate parity command had bootstrapped the Gradle
wrapper:

```sh
pnpm --dir packages/runtime-native native:verify:android:multitouch \
  --device emulator-5554
```

The emulator was present (`emulator-5554`, API 35), and the proof selected JDK 17, but the
command exited 1 before installing an APK or reaching assertions:

```text
1/4 Building Android debug APK with JDK 17...
FAIL: Command failed (1): bash packages/runtime-native/android/gradlew :app:assembleDebug --console=plain
A problem was found with the configuration of task ':app:extractSdl3JniLibs'
Property '$1' specifies file
'packages/runtime-native/third_party/sdl3-android/SDL3-3.2.8.aar' which doesn't exist.
BUILD FAILED in 390ms
```

The missing AAR is a setup blocker. No positive touch result or negative-control result was
observed, so neither is reported as pass.

## Verdict

PRD-055 criterion 2 remains open: Path 1 has zero real touch-control behavior, Path 2 has
zero pointer binding and zero raw-pointer consumers, and the device proof is blocked before
runtime execution.
