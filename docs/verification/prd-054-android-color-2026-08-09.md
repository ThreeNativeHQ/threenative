# PRD-054 Android parity verification — 2026-08-09

**Result: visual matrix PASS; aggregate parity remains blocked by PRD-053 multi-touch.** The
same revision passed all 66 registry rows on browser, Linux desktop, and the API-35 Android
emulator. PRD-054 is not moved to done because acceptance criterion 1 still promises a
clean-machine desktop run from prerequisites that do not include CMake, a compiler, or system
development libraries, and `pnpm parity` correctly exits 1 while the Android multi-touch
supplemental fails.

## Android color correction

The emulator exposes only `RGBA8UnormSrgb`, while Three.js r185 already performs its output
transfer. Rendering that output directly into the sRGB surface applied a second transfer:
browser pixels `(24,32,47)` / `(237,151,55)` became `(86,99,119)` / `(247,202,128)`.

The native host now exposes the matching linear canvas format to JavaScript, renders each
frame into a linear intermediate, and presents it through a fullscreen conversion pass that
decodes the already-encoded values before the real sRGB attachment applies its transfer. The
surface itself remains the negotiated Android format. The bridge fails closed on missing
textures, views, bind groups, samplers, shaders, or pipelines. The existing pre-present
screenshot copy captures the linear intermediate, and RGBA/BGRA readback is format-aware.

Bounded row 15 then matched the browser exactly: background `(24,32,47)`, center
`(237,151,55)`, pixel mismatch `0`, perceptual delta E `0`, zero GPU errors, a verified APK,
and a live process after the settle window.

## Complete execution

```sh
xvfb-run -a -s '-screen 0 1600x900x24' \
  node packages/runtime-native/conformance/run-conformance.mjs \
  --target web --out /tmp/tn-prd054-full-final2/web

xvfb-run -a -s '-screen 0 1600x900x24' \
  node packages/runtime-native/conformance/run-conformance.mjs \
  --target desktop --reference /tmp/tn-prd054-full-final2/web \
  --out /tmp/tn-prd054-full-final2/desktop

node packages/runtime-native/conformance/run-conformance.mjs \
  --target android --device emulator-5556 \
  --reference /tmp/tn-prd054-full-final2/web \
  --out /tmp/tn-prd054-full-final2/android-final3
```

| Lane | Pass | Fail | Blocked | Planned |
| --- | ---: | ---: | ---: | ---: |
| browser WebGPU | 66 | 0 | 0 | 0 |
| Linux desktop native | 66 | 0 | 0 | 0 |
| Android emulator | 66 | 0 | 0 | 0 |

Every native row completed, produced a non-uniform 1280×720 capture, stayed within its
committed tolerance, and reported zero unexpected GPU validation errors. Android's largest
pixel mismatch was `0.0038216145833333335` on row 61, with mean delta E
`0.001944920753612383`. Row 30 additionally recorded 2,152 bright glyph pixels and exact
raster bounds `[49,56,313,85]` on all three targets.

The texture scene originally rotated once per frame, so browser and Android captured
different angles. Removing that unrelated animation made rows 40, 83, and 96 pass unchanged
texture semantics. The Android lane also now uninstalls the 236 MB debug APK and waits two
seconds before every install; this kept emulator free space stable through all 66 rows instead
of exhausting `/data` with deferred replacement code paths.

## Fail-closed harness corrections

- Android capture rejects system ANR/error overlays instead of accepting their non-uniform
  pixels as game output.
- Each row records a checksum-verified APK, fresh install, WebGPU heartbeat, settle window,
  and process liveness before and after capture.
- Row 30 rejects fewer than 1,000 bright raster pixels or glyph-bounds drift above one pixel.
- The v24/v25 matrix remains discriminating: v24 fails the named naga `textureLoad`
  regression; v25 passes.

## Remaining blockers

1. The Android multi-touch supplemental still observes `maxPointers=0`; its first proof
   remains healthy. See `docs/verification/prd-053-multitouch-2026-08-09.md`.
2. PRD-055 row 25 still lacks its required two-size/two-orientation raster proof after the
   three-fix stop condition.
3. A literal clean checkout with only Node 20, JDK 17, and an Android SDK cannot compile the
   desktop C++ runtime; PRD-054 acceptance criterion 1 must either add the toolchain
   prerequisite or provide a verified prebuilt runtime.
