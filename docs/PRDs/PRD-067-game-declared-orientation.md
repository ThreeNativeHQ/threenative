---
prd_contract: v1
---

# PRD-067 — A game declares its own orientation; the framework stops hard-coding landscape

**Status: DEFECT REPRODUCED ON PHYSICAL HARDWARE, 2026-08-10. NOT STARTED.** Observed on a
Pixel 8 (`shiba`, serial `37251FDJH0037Z`, arm64-v8a, Android 17, physical display 1080×2400).
Split out of PRD-066, which owns frame rate and explicitly does not own this.

**Complexity: 4 → MEDIUM mode.** One new config field, one packager edit, one manifest that
stops being hand-authored, one contract test.

**Blast radius: ~6 repository paths.**
`packages/runtime-native/android/app/src/main/AndroidManifest.xml`,
`packages/runtime-native/scripts/package-android.mjs`,
`packages/create-threenative/src/build.ts`, `packages/create-threenative/templates/*/`,
`packages/runtime-native/docs/G3-mobile-bring-up.md`, `packages/runtime-native/tests/`.

## 1. Why this exists

A developer who wants a portrait game — or a landscape game on a portrait-locked phone — has
no way to say so. The framework's own `AndroidManifest.xml` hard-codes it:

```
packages/runtime-native/android/app/src/main/AndroidManifest.xml:35
android:screenOrientation="landscape"
```

The only way to change it today is to edit a file inside `@threenative/runtime-native`. That
is framework source a consumer does not own and cannot keep across an upgrade, and it is
exactly the kind of plumbing the framework is supposed to ship so no game writes it.

### What it does to a running game

On the Pixel 8 with the device auto-rotate off and the display physically portrait, the game
was told the wrong screen:

```
I MystralRuntime: ANativeWindow validated: (2400x1080)
I MystralJS: [log] TN_PROBE_VIEWPORT 2400x1080
```

The physical display is 1080×2400. Two consequences, both visible in the captured screenshot
`~/projects/fox-native/artifacts/probe/pixel8-baseline.png`:

1. **Camera aspect is inverted.** The perspective camera is built for 2.22:1 and presented at
   0.45:1, so the player character sits off in a corner instead of framed.
2. **Every pixel-space HUD coordinate is wrong.** Pointer coordinates arrive in the same
   2400×1080 space — an injected touch at screen (250, 2000) was delivered to the game as
   (556, 900), consistent with normalising by the swapped dimensions. Hit-testing is therefore
   self-consistent but the on-screen controls are drawn stretched: a circular stick renders as
   an ellipse and the buttons crowd the edges.

Touch delivery itself works. This is a framing defect, not an input defect.

## 2. Solution

A game declares orientation once, in the config channel the native build already reads, and
the Android packager writes the manifest instead of shipping a hand-authored one.

**Where it goes.** `packages/create-threenative/src/build.ts:86` already reads a `threenative`
block from the project's `package.json` for `nativeEntry`. That is the established per-project
native config channel and the field belongs beside it:

```jsonc
"threenative": {
  "nativeEntry": "src/game.ts",
  "orientation": "landscape" | "portrait" | "sensor"
}
```

`threenative.config.ts` exists in scaffolded projects and templates document it as
"renderer + plugins", but **no loader for it was found in `packages/*/src`** — it appears to be
convention rather than a read file. Confirm that before choosing between the two channels; if
it is genuinely unread, either wire it or stop shipping it, but do not add a second
config surface that also does nothing.

**Default.** `landscape`, matching today's behaviour, so this is not a silent change for
existing projects.

**Fail closed.** An unrecognised value throws at build time with a named code, in the same
shape as `TN_NATIVE_ENTRY_MISSING`. Accepting and discarding it would become a
platform-specific gameplay bug, which is the failure mode the repository's native rules exist
to prevent.

**iOS.** The same field must reach the iOS packager's orientation keys, or the field is a fork
that means something on one platform and nothing on the other. No Apple hardware is attached
here, so the iOS half is written and tested but claimed only as far as it executes.

## 3. Execution phases

### Phase 1 — read and validate the field

- `packages/create-threenative/src/build.ts` — parse `threenative.orientation`, default
  `landscape`, throw a named code on an unrecognised value.
- Test: each valid value parses; an invalid value throws; the default applies when absent.

### Phase 2 — the Android packager writes the manifest

- `packages/runtime-native/scripts/package-android.mjs` — emit `android:screenOrientation`
  from the declared value.
- `packages/runtime-native/android/app/src/main/AndroidManifest.xml` — stop hard-coding it.
- Test: each value produces the matching manifest attribute; assert on the packaged manifest,
  not on the template.

### Phase 3 — prove it on the device

- Build `fox-native` at `portrait` and at `landscape`, install both on `37251FDJH0037Z`, and
  assert the reported viewport matches the declared orientation in each — the direct inverse of
  the `TN_PROBE_VIEWPORT 2400x1080` observation above.
- Capture a screenshot per orientation.

### Phase 4 — iOS parity and record

- Route the same field through `scripts/package-ios.mjs`.
- `packages/runtime-native/docs/G3-mobile-bring-up.md` — close the open portrait/landscape
  framing row with the device result, and say plainly that the iOS half is unexecuted.

## 4. Acceptance criteria

- [ ] A game sets orientation without editing any file under `@threenative/*`.
- [ ] An unrecognised value fails the build with a named code; a test proves it.
- [ ] Absent value still produces landscape, so no existing project changes behaviour.
- [ ] On `37251FDJH0037Z`, a `portrait` build reports a portrait viewport and a `landscape`
      build reports a landscape one, with a screenshot for each.
- [ ] The field reaches the iOS packager, with its execution status stated honestly.
- [ ] The `threenative.config.ts` question is resolved one way or the other, not left as two
      config surfaces where one is dead.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` passes.

## 5. Negative controls

| Control | Change | Expected |
|---|---|---|
| `bad-value` | `"orientation": "sideways"` | build throws the named code |
| `no-field` | omit the field | landscape, unchanged from today |
| `manifest-drift` | hand-edit the manifest attribute | packaged manifest still follows the declared value |
| `device-mismatch` | declare portrait, assert landscape viewport | Phase 3 assertion fails |

## 6. Out of scope

- Frame rate — PRD-066.
- 16 KB page alignment of the shipped `.so` files — unowned, needs its own PRD.
- Runtime orientation changes mid-session. This PRD declares orientation at build time only.
  A resize path that survives rotation is a separate question and should not be smuggled in.
