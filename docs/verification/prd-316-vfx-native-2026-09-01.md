# PRD-316 native VFX evidence — 2026-09-01

This record covers the donor-animation port from the pinned
`threenative-vfx-niagara-46-effects.zip` archive.

| archive | value |
| --- | --- |
| file | `threenative-vfx-niagara-46-effects.zip` |
| SHA-256 | `6554c40f862f0ab1b977417d1a01716f76dc3937a3ecb507bedfa230ab6cac0a` |
| size | 2,792,472 bytes |
| entries inspected | 209 |

## Executed evidence

| lane | command or artifact | result |
| --- | --- | --- |
| Browser gallery | `pnpm test:vfx-gallery` | PASS, exit 0; six page captures; 46/46 IDs evaluated and visible; no missing tiles; `changedPixelRatio=0.04296223958333333`; NVIDIA Turing WebGPU adapter with `timestamp-query`. |
| Shared web conformance row | `packages/runtime-native/artifacts/conformance/web/report.json` | `vfx-compute` is `pass`; browser reference rendered frame-zero, settled, next, and restored captures; adapter is NVIDIA/Turing; page errors and GPU validation errors are empty. The complete web matrix is not claimed here because two unrelated baseline rows failed and two rows were blocked. |
| Desktop VFX row | `sh scripts/xvfb.sh node packages/runtime-native/conformance/run-conformance.mjs --target desktop --only-tests vfx-compute --out vfx-desktop --reference artifacts/conformance/web` | Selected row PASS; report summary is 1 pass, 0 fail, 91 intentionally blocked rows; pixel mismatch `0.05164279513888889` <= `0.06`; perceptual delta `4.928133090433908` <= `9`; GPU validation errors empty; native temporal captures rendered. The generated report was kept out of the commit after capture. |

The desktop command exits 2 because `--only-tests vfx-compute` marks the other 91 registry rows
blocked. That exit is expected for this isolated row check; it is not reported as a full parity
matrix pass.

## Explicitly unexecuted

- The six-page gallery itself was not run on a desktop native host, Android hardware, or an iOS simulator.
- Physical iOS was not available in this run.
- No target-specific negative mutation was executed on native; the fail-closed unit controls are recorded in the closeout below.

The isolated shared native compute row proves the direct TSL/compute mechanism on desktop. It does
not establish a full gallery pass for the unexecuted targets.
