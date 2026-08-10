# PRD-054 criterion 1 — aggregate parity rerun — 2026-08-10

Result: **RED / incomplete on browser and desktop; Android blocked at setup.** The declared
aggregate command ran and exited 1; criterion 1 is not closed.

## Command

```sh
pnpm parity
```

The command wrote these reports:

- `packages/runtime-native/artifacts/conformance/web/report.json`
- `packages/runtime-native/artifacts/conformance/desktop/report.json`
- `packages/runtime-native/artifacts/conformance/android/report.json`

The reports are ignored runtime artifacts; the summaries below are the observed command
output and are the evidence record.

| Target | Pass | Fail | Blocked | Command result |
| --- | ---: | ---: | ---: | --- |
| browser | 66 | 1 | 0 | row `90-multitouch-input` failed |
| Linux desktop | 65 | 1 | 1 | row `25-camera-parented-overlay` failed; row `90-multitouch-input` blocked |
| Android emulator | 0 | 0 | 67 | every row was blocked before APK build |

Aggregate exit code: `1`.

## Observed red and blocked rows

- Browser `90-multitouch-input` reached the page and failed on two
  `setPointerCapture` errors: `No active pointer with the given id is found.`
- Desktop `25-camera-parented-overlay` reached 300 frames but reported WebGPU depth
  attachment validation errors: `1024x768`, `720x1280`, and `800x1280` depth views did not
  match the `1280x720` color attachment. Desktop `90-multitouch-input` is explicitly
  `blocked`: native desktop input injection is not implemented.
- Android `01-basic-cube` through `96-create-image-bitmap` were all setup-blocked before any
  row executed because `packages/runtime-native/third_party/sdl3-android/SDL3-3.2.8.aar` does
  not exist. The supplemental Android multi-touch proof reported the same build block.

These are the runner's observed states, classified under PRD-054 acceptance criterion 4:
the browser and desktop rows retain their observed red/blocked results, while all 67 Android
rows are **blocked**, not parity failures, because setup prevented any Android row from
executing. The aggregate command still exits `1`; no Android pass or parity failure is
claimed.

## Other declared gates

The repository gates run independently of the aggregate parity lane:

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS; 390 files |
| `pnpm test` | PASS; 84 Vitest files / 624 tests, native 35 files / 174 tests with 31 skipped, Rust parity 1/1 |
| `pnpm budgets` | PASS with review trigger: 61,351 native LOC / 50,000 |

Those gates do not turn the non-green parity matrix into a pass. PRD-054 criterion 1 remains
open, and no clean-checkout cross-target claim is made.
