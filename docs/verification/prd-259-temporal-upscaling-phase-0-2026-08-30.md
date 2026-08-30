# PRD-259 temporal upscaling Phase 0 — 2026-08-30

## Verdict

**DECLINED.** Neither temporal arm passed the Phase 0 gate, so no physical-device run or product
integration is justified. This is an image-quality decision, not a claim about Bayview's known CPU
fixed term.

## Current-main browser proof

The isolated Bayview copy used engine `fbfb3693e2e643ba7954ad8b8ad3f8a772b1afba`, consumer
`b394778f97830dbc9f61ed541cf82443087a86c6`, Three revision 185, source scale 0.44, effective
sample count 1 and the real NVIDIA Turing WebGPU adapter at 1280×720. Both arms ran the same
`survives.playtest.json` route and passed movement, nonblank-frame and diagnostics assertions.

| Arm | Output | Capture SHA-256 | Observed result |
| --- | --- | --- | --- |
| bilinear control | 0.44 drawing buffer | `a68f112ba2945705fefbd6c30811e7a725e4c4ac1fcf6d80bddaee5fdbf75c8b` | Intact, visibly pixelated reduced-resolution reference. |
| Three `TAAUNode` | full-size output from 0.44 scene pass | `5dfe9d8a414792d97de1a12fd88558a23ffbe4db1ecdd6477a0463783b286e1b` | Whole image is softer; shutters, awnings, cables, distant facades and the moving soldier lose detail. |

The TAAU arm therefore fails the required “visibly improves” gate on current main even though its
runtime/playtest contract is healthy.

## Android emulator diagnostic proof

The earlier isolated three-arm run is retained at engine `e8754ab2`, with exact bundle/APK hashes
in each arm's `provenance.json`. It ran `com.threenative.bayview` on Android API 35, x86_64,
`ro.kernel.qemu=1`, Three revision 185, sample count 1 and source scale 0.44.

| Arm | Render p50/p95 diagnostic windows | Capture SHA-256 | Result |
| --- | --- | --- | --- |
| control | p50 5.44–5.91 ms; p95 7.04–8.19 ms | `50acef0131942a62a9348b41ea3f5ec047508aaf5e2f24adb9752fefeefa7b88` | 1056×475 reduced buffer, intact after motion/resume. |
| TAAU | p50 8.21–8.89 ms; p95 10.20–12.17 ms | `4c64e7ea369e96e9dc9bfdcf49891fe3a9ec86af54e00116c197e2d8e306c66e` | Full 2400×1080 output, still softer; diagnostic p50 overhead 2.7–3.3 ms exceeds the 2.35 ms rung budget. |
| pmndrs challenger | p50 initially 20.77–27.23 ms | `408709c397aed8437c39f7e0d6a1d320ed89dd318bd75d6e8421da2520942f42` | Visible moving-soldier trail, then repeated `TypeError: ... createView`; render loop stopped. |

Emulator timing is diagnostic only. It is sufficient to reject an arm but is not promoted to a
vendor-GPU or physical Pixel claim.

A current-main Android rerun remains `UNVERIFIED`: after source dependencies were provisioned and
the copied consumer's already-proven interleaved assets were explicitly allowed for this diagnostic
build, the local Gradle/SDK lane failed before compilation with `26.0.2`. Three setup fixes had
already failed, so work stopped under the repository rule. This does not weaken the decline because
the current-main browser visual gate had already failed and all Phase 0 conditions were conjunctive.

## Fail-closed evidence

- The isolated consumer README maps temporal reconstruction to PRD-259, its game rule and the
  `TN_PRD259_ARM` observation.
- Real TAAU provenance passed: `arm=taau`, Three 185, scale 0.44, sample count 1, WebGPU.
- Swapping only the packaged arm marker to `control` failed with
  `TN_PRD259_ARM_MISMATCH expected=taau actual=control` and exit 1.
- No framework public upscaling capability or renderer option was added; the spike stayed ordinary
  game render source and is excluded from the shipped change.
