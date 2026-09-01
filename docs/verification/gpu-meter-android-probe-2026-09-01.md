<!-- schemaVersion: 1 -->

# The GPU meter on Android: probed, not measured — PRD-305, 2026-09-01

PRD-305 asks for one thing: a `TN_FRAME_BUDGET` line captured from a Pixel 8 that carries a real
`gpuMs`, or a recorded refusal naming the driver that would not grant `timestamp-query`. **Neither
was produced, because no device is attached.** This file records the probe so the next reader does
not have to repeat it, and so "blocked" is a checked condition rather than an assumption.

The repository's own rule is that a blocked reason is attempted before it is believed — two lanes
were once parked for a day on a tool that was on disk the whole time. So this is what was attempted.

## The probe

```
$ ~/Android/Sdk/platform-tools/adb devices -l
List of devices attached

$ ~/Android/Sdk/platform-tools/adb --version
Android Debug Bridge version 1.0.41
Version 37.0.0-14910828
```

The tooling is present and working — `adb` is on disk (off `PATH`, which is a known quirk of this
machine), and four AVDs are installed. What is absent is hardware.

## Why the emulator is not a substitute

The emulator lane is runnable here, and running it would produce a green that answers a different
question:

- `run-conformance.mjs` treats `--target android` as **the emulator lane** and refuses a physical
  serial (`TN_PARITY_ANDROID_EMULATOR_REQUIRED`). The emulator and the phone are different targets
  by construction, and this repository reports them separately on purpose.
- An emulator's WebGPU adapter is software. Whether *it* grants `timestamp-query` says nothing
  about what a Pixel 8's driver grants, and the whole point of PRD-305 is that every GPU number
  this project holds for a phone came from ablation arithmetic rather than from the instrument
  built to replace it.

A run on the emulator would therefore be a claim about the wrong hardware — the failure mode the
PRD exists to end, not to repeat.

## What unblocks it

A physical Android device attached over `adb` and cool enough to pass preflight. From the
operator's device notes, not from this repository: thermal state trips between first-proof launch
and preflight, so cool to ≤31.5 °C and retry, and the battery floor bites after roughly four to six
rungs.

The run itself is PRD-305's Phase 1 and is a **measurement, not an edit**: build the APK, run a
template scenario, and read logcat for three things — the adapter probe line, any `createQuerySet`
refusal, and whether `TN_FRAME_BUDGET` carries `gpuMs`. A "no" is a result; it names the driver and
retargets PRD-308 onto a different instrument rather than leaving it planned against a meter that
cannot run.

## Consequence for the board

PRD-305 moves to `docs/PRDs/BLOCKED/requires-physical-device/`. PRD-308 and PRD-311 depend on it and
stay **OPEN in their batch**, not blocked: a dependency that is not ready is not the same thing as a
missing capability, and filing them as blocked would hide the fact that only one lane needs the
device.

## Not executed

No APK was built, no emulator was started, no logcat was captured. Nothing in this file claims a
platform result.
