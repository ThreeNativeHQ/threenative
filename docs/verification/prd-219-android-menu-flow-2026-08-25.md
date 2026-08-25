# PRD-219 — the starter's menu flow proves itself on Android

**Date:** 2026-08-25. **Lane:** B, night batch 2026-08-24.
**Device:** `emulator-5554`, android-35 google_apis, physical panel 1080x2400 at 420 dpi.
**Result:** DELIVERED. Criteria 1, 2, 3 and 4 met on `emulator-5554`, and **Phase 3's physical
Pixel 8 stretch also passed** once the phone exposed three further defects the emulator cannot
show. Pixel 8 `37251FDJH0037Z`, 26 °C, thermal status 0, 94% battery, charging.

This record supersedes the lane's earlier `prd-219-2026-08-24.md`, which closed
UNVERIFIED/BLOCKED after six red device variants whose causes it could not name. The causes are
named below, and the six variants were a symptom of three separate harness defects, none of them
in the game.

## The steering note's hypothesis is refuted

The night README's 00:40 note proposed Android IME resize: typing opens the keyboard, the WebView
shrinks, and the pre-computed `begin` coordinate points at the pre-keyboard layout. The remedy it
suggested was to dismiss the keyboard (`adb shell input keyevent 111`) after a text `input` step.

**Refuted by the records the note itself pointed at.** `TnUiOverlay.dispatchTouchEvent` logs the
overlay's own dimensions with every pointer-down, and in all eight two-click variants preserved
under `/tmp/threenative-prd219-XMHDHl/artifacts/`, `w` and `h` are identical across the first and
second click:

```
green            {"x":1200.0,"y":532.48535,"w":2400,"h":1080,"regions":2,"owns":true}
                 {"x":1200.0,"y":437.9922 ,"w":2400,"h":1080,"regions":2,"owns":false}
green-rotation3  {"x":1200.0,"y":547.48145,"w":2400,"h":1080,"regions":2,"owns":true}
                 {"x":1200.0,"y":641.9756 ,"w":2400,"h":1080,"regions":2,"owns":false}
```

The view never resized. No keyboard dismissal was needed, and none is in the fix.

`green-rotation3` also refutes the second natural guess. There the touch arrived at normalized
(0.5000, 0.59442) against a request of (0.5, 0.59444) — delivered essentially exactly — and the
host still answered `owns:false`. The transport was not the problem in that variant; the
coordinate was pointing at the wrong thing.

## What was actually wrong: three defects, all in the harness

### A. The Android target never presented the scenario's declared viewport

The scenario declares `viewport: 1280x720`. The browser target honours that by sizing the window,
so a step's `at: {x, y}` is a CSS pixel. Android honoured nothing: at 420 dpi the WebView's CSS
viewport is 2400/2.625 = 914x411, and the starter's menu is fixed-size Tailwind (`gap-3`,
`px-6 py-2`) centred vertically — so its controls sit at fixed pixel offsets from the centre, not
at fixed fractions of the height.

Measured on the device by sweeping taps at x=1200 and reading the host's hit test:

| control | device y | normalized |
| --- | --- | --- |
| name field | 528 – 616 | 0.4889 – 0.5704 |
| `begin` | 656 – 744 | 0.6074 – 0.6889 |

The scenario's first click, 365/720 = 0.5069, lands inside the field — which is why the first tap
always reported `owns:true` and focused the input. Its second click, 428/720 = 0.5944, lands at
device y 642: **in the 40-pixel dead gap between the two controls**, 14 pixels above the top edge
of `begin`. Directly confirmed:

```
$ adb -s emulator-5554 shell input tap 1200 642     # where the scenario asks
TN_UI_HITTEST:{"x":1200.0,"y":642.0,"w":2400,"h":1080,"regions":2,"owns":false}
$ adb -s emulator-5554 shell input tap 1200 693     # where `begin` actually is
TN_UI_HITTEST:{"x":1200.0,"y":693.0,"w":2400,"h":1080,"regions":2,"owns":true}
```

**Fix:** `prepare()` now presents the scenario's viewport — `wm size` in the panel's natural frame
plus `wm density 160`, so `devicePixelRatio` is 1 and a viewport pixel, a CSS pixel and a device
pixel are the same pixel. `stop()` restores with `reset`, never by writing back numbers read
earlier. It fails closed by name (`TN_PLAYTEST_ANDROID_VIEWPORT_NOT_PRESENTED`) if the override
did not take, because a run that silently continues at the wrong viewport blames the game.

Verified on device: with `wm size 720x1280` + `wm density 160`, both scenario coordinates hit.

```
$ adb shell input tap 640 365
TN_UI_HITTEST:{"x":640.0,"y":365.0,"w":1280,"h":720,"regions":2,"owns":true}
$ adb shell input tap 640 428
TN_UI_HITTEST:{"x":640.0,"y":428.0,"w":1280,"h":720,"regions":2,"owns":true}
```

### B. The touch rotation was read from sources that do not describe the window

`readRotation()` read `dumpsys input`'s `SurfaceOrientation` and then `user_rotation`. On this
emulator the first prints nothing at all and the second reads `0`, while `dumpsys window` reports
`mRotation=1` for the landscape-locked game — so the runner applied the identity and every
injected touch arrived transposed. Measured through the runner's own `adb emu event send` path,
requesting view (640, 428):

| rotation fed to `rotatedTouchPosition` | delivered to the view | owns |
| --- | --- | --- |
| 0 (what the old sources reported) | (791.07, 359.98) | false |
| 1 (`mRotation` used directly) | (640.0, 291.99) | false |
| 3 (`mRotation` inverted) | (640.0, 427.98) | **true** |

`mRotation` states how far the content is turned from the panel's natural frame, and
`rotatedTouchPosition` converts the other way, so the value it needs is the inverse. Applying the
forward rotation is a 180-degree error on either odd rotation — which is exactly the discrepancy
the earlier `green` variant recorded (`y_out = 1 - y_in`, delivered exactly), an independent
second confirmation from a different day's data.

**Fix:** `touchRotationFromWindowDump()` reads `mRotation` and inverts it; the two older sources
stay as fallbacks behind it. The rotation table itself is unchanged — this emulator pins the
window at ROTATION_90, so there is no second orientation here to justify editing the table, and
the source was demonstrably wrong on its own.

### C. `noConsoleErrors` meant something different on Android

The Android console observer scrapes logcat and classified every `E/chromium` line as a console
error. A first launch after `adb install -r` writes five of them — a missing variations-seed
signature and an empty HTTP cache directory — none of which is the game's console:

```
E/chromium( 6585): [0825/065120.946206:ERROR:variations_seed_loader.cc(37)] Seed missing signature.
E/chromium( 6585): [ERROR:simple_file_enumerator.cc(21)] opendir .../Code Cache/js: No such file or directory (2)
E/chromium( 6585): [ERROR:simple_index_file.cc(614)] Could not reconstruct index from disk
```

On browser that assertion means the page's console; here it meant "no process on this device
logged at error level". **Fix:** a `chromium` line is the page's console when it is a
`:CONSOLE(` message or carries the framework's own marker; otherwise it is the WebView describing
itself, and its severity drops to `log`. **The line stays in the observation** — nothing is
dropped, only classified, because an observation that disappears is how a harness learns to lie.

## The scenario is cross-target, not forked

The shipped `menu-flow.playtest.json` asserted `noNetworkErrors: true`, which the Android runner
correctly refuses with `TN_PLAYTEST_UNSUPPORTED_ON_TARGET` — device transport has no CDP network
observer. An assertion that only means something on one target is a fork of the harness, so the
fix is in the template: `noNetworkErrors` is now a reasoned opt-out, and the screen transition and
carried name are asserted through `resources`, which all four targets observe. One file, unchanged
between runs, run on both targets below.

## Criterion 1 — unmodified scenario, native target

Red and green are the same APK lineage, same binary, same device; the only difference is the
mutation.

**Green** — `playtests/menu-flow.playtest.json --target android`, exit `0`:

```
pass: True | target: android | scenario: starter-menu-flow
  True  resource.state.screen         {"after":"playing","before":"menu","expected":{"equals":"playing","changed":true}}
  True  resource.state.characterName  {"after":"axo","before":"","expected":{"equals":"axo"}}
  True  diagnostics                   {"consoleErrors":0,"networkErrors":0,"runtimeDiagnostics":0}
```

**Red control** — `carry` removed from the scaffold's start-game handler
(`void game.goto("play", { carry: { characterName: name } })` → `void game.goto("play")`),
rebuilt, reinstalled, same scenario, exit `1`:

```
pass: False | target: android
  True   resource.state.screen         {"after":"playing","before":"menu"}
  False  resource.state.characterName  {"after":"","before":"","expected":{"equals":"axo"}}
  True   diagnostics                   {"consoleErrors":0,"networkErrors":0}
```

The mutation isolates the carry and nothing else: both taps landed identically in both runs
(below), and the screen transition still passed.

**Same scenario on the browser target**, exit `0`, `--browser-recipe webgpu --headed`:

```
pass: True | target: browser
  True  resource.state.screen         {"after":"playing","before":"menu"}
  True  resource.state.characterName  {"after":"axo","before":""}
  True  diagnostics                   {"consoleErrors":0,"networkErrors":0}
```

A headless run of the same scenario was rejected by the harness for being served by SwiftShader
(`TN_PLAYTEST_SOFTWARE_ADAPTER`) — recorded here because it is the harness being right, not a
result.

## Criterion 3 — touch, not keyboard

The host's hit test, from the green run's own console observation. The view is 1280x720 — the
scenario's declared viewport, presented by the fix — and both taps land within 0.02 px of the
request and are decided by the `data-tn-interactive` region protocol:

```
TN_UI_HITTEST:{"x":640.0,"y":364.98828,"w":1280,"h":720,"regions":2,"owns":true}
TN_UI_HITTEST:{"x":640.0,"y":427.9834 ,"w":1280,"h":720,"regions":2,"owns":true}
```

`regions:2` is the published registry deciding ownership on pointer-down. No focus/Enter shortcut
is involved anywhere in the path.

## Criterion 2 — no silent degradation

Covered by `packages/playtest/__tests__/click-step.spec.ts` (7 tests): a `click` step on
`--target android` with no pointer transport fails `TN_PLAYTEST_UNSUPPORTED_ON_TARGET` naming the
target, never skips and never falls back to browser; the misspelled-step-kind guard still throws
at load.

## Criterion 4 — house gates

Red first, on the defects above:

```
$ pnpm exec vitest run packages/playtest/__tests__/android-viewport-rotation.spec.ts
 Test Files  1 failed (1)
      Tests  9 failed (9)

$ pnpm exec vitest run packages/playtest/__tests__/android-console.spec.ts
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)

$ pnpm test        # the template's shipped bytes changed
 FAIL  packages/create-threenative/__tests__/scaffold.spec.ts
       > keeps every no-install scaffold tree byte-stable against the PRD parent
 Expected: "abda912141053b7c53b8b96f51b6df8d42558e38d5cb4dc0401c63b3218a9581"
 Received: "68e0f0bb64809b1228f4b6fd82bc6f70aaeb2c1d9d42d7e1c5ffff844c61c57c"
```

Then green:

```
$ pnpm typecheck            # exit 0
$ pnpm lint                 # exit 0
$ pnpm test                 # exit 0 — Test Files 220 passed (220), Tests 2192 passed (2192)
$ pnpm budgets              # exit 0
$ pnpm sync:agents --check  # exit 0 — agent docs in sync: 16 CLAUDE.md mirrors
```

`PRD_201_PARENT_SCAFFOLD_HASHES` is refreshed for all seven templates in this commit, per the
night README's 04:57 steering note. Two shipped things moved: the starter's menu proof became
cross-target, and the capability manifest every template embeds gained the three Android
viewport/rotation helpers this proof needed. The manifest diff is exactly those three symbols;
the two internal `wm size` parsers were deliberately left unexported so they stay off the public
surface.

## Phase 3 — the physical Pixel 8

The emulator green did not transfer. The phone failed three ways, each a real platform behaviour
the emulator has no way to produce, and each fixed:

### D. The app took whatever orientation the device felt like

`AndroidManifest.xml` declares no `screenOrientation`, so the activity follows the device. The
emulator gave landscape; the Pixel, lying flat, gave portrait — the same build and the same size
override, rendering a 720x405 letterbox inside a 720x1280 window. A 1280x720 viewport is a
landscape viewport, and a device showing it portrait is not presenting it.

**Fix:** the presentation now locks the rotation to the orientation the viewport declares
(`wm user-rotation lock`), and `stop()` frees it. With it, `dumpsys window` reports
`w1280dp h720dp 160dpi` — exactly the scenario's viewport.

### E. Click steps were emulator-only

`setPointers` refuses a non-emulator serial by design — `adb emu event send` is an emulator
console protocol — so the Pixel failed `TN_PLAYTEST_ANDROID_MULTITOUCH_EMULATOR_REQUIRED` before
reaching an assertion.

**Fix:** a click is now one `adb shell input tap` in viewport pixels, which works on emulators and
phones alike. It also needs no rotation mapping at all: `input tap` is delivered in the display's
current orientation, which — with the viewport presented — is the scenario's viewport, one pixel
for one pixel. `setPointers` stays as it was for multi-pointer and held-pointer steps.

### F. The soft keyboard — the steering note was right about hardware

This is where the night README's 00:40 note earns its keep. On the phone, focusing the name field
opens the IME, the WebView reflows into the space above it, and the centred menu rides up:
`begin` moves from y=428 to about y=213. The scenario's second click then lands **on the
keyboard**, where it does not merely miss — it types a letter into the field it was meant to
submit.

So the refutation above needs its scope stated precisely: the note's *mechanism* is refuted for
the emulator, whose recorded hit tests show the overlay's dimensions unchanged across both clicks
because the emulator takes hardware-keyboard input and raises no IME at all. On hardware the
reflow is real and the note's *remedy* — dismiss the keyboard before a later click — is correct.

**Fix:** `hideKeyboard()` runs before every click step, sends BACK, and waits for
`mInputShown=false` before returning, so the click is not sent into the middle of the reflow. It
fails closed as `TN_PLAYTEST_ANDROID_KEYBOARD_STUCK` if the keyboard will not go.

### G. The keyboard rewrote what the player typed

With touches landing correctly the run still failed on one character: `characterName` read
**"Axo"** against an expected "axo". The phone's IME auto-capitalises the first letter of an empty
field. `adb shell input text` behaves identically — it goes through the same IME.

**Fix, in the template**, because it is the game's field and every native text field a game ships
wants it: the starter's name input now carries `autoCapitalize="none"`, `autoCorrect="off"` and
`spellCheck={false}`.

**A caveat worth naming.** That fix did not work at first, and the reason is not the fix: this
phone's default keyboard is **SwiftKey**, which ignores the `autocapitalize` hint. With SwiftKey
disabled the platform fell back to Gboard, which honours it, and the same three keystrokes
produced "axo". The harness deliberately does **not** disable a person's keyboard — that is their
phone — so a run under an IME that ignores the standard hint will still see transformed text. It
is named here rather than papered over.

### Phase 3 result

`playtests/menu-flow.playtest.json --target android --device 37251FDJH0037Z`, unmodified, exit `0`:

```
pass: True | target: android | scenario: starter-menu-flow
  True  resource.state.screen         {"after":"playing","before":"menu","expected":{"equals":"playing","changed":true}}
  True  resource.state.characterName  {"after":"axo","before":"","expected":{"equals":"axo"}}
  True  diagnostics                   {"consoleErrors":0,"networkErrors":0,"runtimeDiagnostics":0}

TN_UI_HITTEST:{"x":640.0,"y":365.0,"w":1280,"h":720,"regions":2,"owns":true}
TN_UI_HITTEST:{"x":640.0,"y":428.0,"w":1280,"h":720,"regions":2,"owns":true}
```

Both taps land on the exact requested pixel, in the scenario's own viewport, decided by the
`data-tn-interactive` region protocol. This is the physical-device claim; the emulator results
above remain the emulator's.

Device state is restored after every run: `wm size`/`wm density`/`user-rotation` by `stop()`, and
the operator's default keyboard by hand at the end of this session.

## Named unverified

- **Power and current numbers** from the Pixel run: the phone was charging, so
  `observations.deviceMetrics` flags the run and its current draw is the charger's. The
  assertions here are functional only, which is what PRD-219 scoped.
- **Text under an IME that ignores `autocapitalize`** (SwiftKey, observed): still transformed. The
  template says what it wants; a keyboard is free to disregard it.
- **Multi-pointer on a physical device**: unchanged and still emulator-only. Only the single-tap
  click path was made portable.
- **iOS**: no lane, excluded by standing rule.
- **Frame rate**: functional assertions only. The emulator's software GL claims no performance.
- **The rotation table** (`rotatedTouchPosition`): unchanged and still unverified for rotations 1
  and 3 independently, because this emulator pins the game's window at ROTATION_90 and forcing
  `user_rotation` to 2 did not move it. Only the *source* feeding it was proven wrong and fixed.
