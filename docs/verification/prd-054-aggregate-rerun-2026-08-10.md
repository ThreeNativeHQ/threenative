# PRD-054 criterion 1 — aggregate parity rerun — 2026-08-10

Result: **RED / browser and desktop have genuine non-green rows; Android did not execute.** The
unsandboxed aggregate command exited `1`; criterion 1 is not closed.

## Command and literal runner output

```sh
pnpm parity
```

Exit code: `1`.

The relevant runner output was:

```text
{
  "wrote": "/home/joao/projects/threejs-webgpu/.worktrees/batch-2026-08-10-final-contract-repair/packages/runtime-native/artifacts/conformance/web/report.json",
  "target": "web",
  "mode": "execution",
  "summary": {
    "pass": 66,
    "fail": 1,
    "blocked": 0,
    "planned": 0,
    "validated": 0
  }
}
{
  "wrote": "/home/joao/projects/threejs-webgpu/.worktrees/batch-2026-08-10-final-contract-repair/packages/runtime-native/artifacts/conformance/desktop/report.json",
  "target": "desktop",
  "mode": "execution",
  "summary": {
    "pass": 65,
    "fail": 1,
    "blocked": 1,
    "planned": 0,
    "validated": 0
  }
}
{
  "wrote": "/home/joao/projects/threejs-webgpu/.worktrees/batch-2026-08-10-final-contract-repair/packages/runtime-native/artifacts/conformance/android/report.json",
  "target": "android",
  "mode": "execution",
  "summary": {
    "pass": 0,
    "fail": 0,
    "blocked": 67,
    "planned": 0,
    "validated": 0
  }
}
```

The browser, desktop, and Android reports were written. These summaries are literal runner
output, not inferred parity results.

| Target | Pass | Fail | Blocked | Observed result |
| --- | ---: | ---: | ---: | --- |
| browser | 66 | 1 | 0 | `90-multitouch-input` failed; report written |
| Linux desktop | 65 | 1 | 1 | `25-camera-parented-overlay` failed; `90-multitouch-input` stayed blocked because desktop native multitouch injection is unsupported |
| Android emulator | 0 | 0 | 67 | every row was blocked by `TN_PARITY_ANDROID_DEVICE_BLOCKED: No online Android device found (none listed). Start an emulator or connect and authorize a device.` |

## Reproduced row failures and blocked row

The browser `90-multitouch-input` row completed its capture but failed on these two page errors:

```text
Failed to execute 'setPointerCapture' on 'Element': No active pointer with the given id is found.
Failed to execute 'setPointerCapture' on 'Element': No active pointer with the given id is found.
```

The Linux desktop `25-camera-parented-overlay` row completed 300 frames with exit code `0`, but
the runtime emitted GPU validation errors. The first was:

```text
[WebGPU] Device error (Validation): The depth stencil attachment [TextureView of Texture (unlabeled 1024x768 px, TextureFormat::Depth24Plus)] size (width: 1024, height: 768) does not match the size of the other attachments' base plane (width: 1280, height: 720).
```

The same mismatch recurred for `720x1280` and `800x1280` depth textures. Desktop
`90-multitouch-input` was **blocked**, not passed or failed: the simultaneous-touch proof has no
desktop native input injector.

## Android cause classification

The Android row blocker is the missing online emulator/device, not the SDL3 AAR. The runner's
device precondition runs before its Android dependency check, so no Android parity row reached
APK assembly or native execution.

The separate Android multitouch supplemental did reach the pre-APK build step under JDK 17 and
failed on a real missing file:

```text
1/4 Building Android debug APK with JDK 17...
FAIL: Command failed (1): bash /home/joao/projects/threejs-webgpu/.worktrees/batch-2026-08-10-final-contract-repair/packages/runtime-native/android/gradlew :app:assembleDebug --console=plain

* What went wrong:
A problem was found with the configuration of task ':app:extractSdl3JniLibs' (type 'DefaultTask').
  - Property '$1' specifies file '/home/joao/projects/threejs-webgpu/.worktrees/batch-2026-08-10-final-contract-repair/packages/runtime-native/third_party/sdl3-android/SDL3-3.2.8.aar' which doesn't exist.
    Reason: An input file was expected to be present but it doesn't exist.
```

The host had `/home/joao/Android/Sdk/platform-tools/adb`, JDK `17.0.19`, and NDK directories
`27.0.12077973` and `27.1.12297006`; `adb devices -l` listed no online device. The SDK XML
version-4 message was only a warning. No SDK/NDK/toolchain-missing error or sandbox `EPERM`
occurred in this unsandboxed run. No Android row executed, so no Android parity pass or parity
failure is claimed.

## Verdict

Browser and desktop remain non-green, Android remains setup-blocked, and the aggregate command
exited `1`. PRD-054 criterion 1 remains open.

## Other declared gates

Observed lane gate results:

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | PASS; exit 0 |
| `pnpm lint` | PASS; Biome checked 391 files |
| `pnpm test` | PASS; exit 0 — root Vitest: 84 files / 628 tests; runtime-native: 35 files / 175 passed / 37 skipped; native physics parity: 1 test passed |
| `pnpm test:templates` | PASS; exit 0 — minimal, starter, and platformer scaffolded playtests passed (25 scenarios total) |
| `pnpm budgets` | PASS; exit 0 — 6 framework packages, 3 example workspaces, 5,975/15,000 framework LOC, 61,617/50,000 native runtime LOC, 4 PRD files, largest template 1,395 LOC; native runtime review trigger is non-fatal |

Those gates cannot turn the non-green parity matrix into a pass.
