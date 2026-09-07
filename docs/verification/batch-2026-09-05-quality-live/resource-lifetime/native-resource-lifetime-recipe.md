# Native resource-lifetime recipe

This uses the retained `quality-resource-lifecycle-probe.mjs` and its unchanged assertions. The
native branch must receive the host's real `globalThis.canvas`; `canvasForHost()` checks the shipped
`isNative()` seam before any document fallback and throws when that surface is absent. The probe
uses synthetic quality windows (`gpuMs` 40, 40, 1, 1; `gpuAgeFrames: 1`) to force the tier sequence;
this is resource-transition evidence, not measured adaptive-load, phone-performance, or native
quality acceptance.

Run from the engine worktree after the native lane is released. The package-filtered esbuild uses
the installed `create-threenative` resolver and emits a self-contained ESM entry because the
desktop `mystral` host loads native entries through its V8 module system. The output stays under
ignored `artifacts/`.

```sh
pnpm --filter create-threenative exec esbuild ../../docs/verification/batch-2026-09-05-quality-live/resource-lifetime/quality-resource-lifecycle-probe.mjs --bundle --format=esm --platform=browser --target=es2022 --outfile=../../artifacts/batch-2026-09-05/quality-resource-lifecycle-native.js
```

This checkout's existing V8/Dawn Linux host is
`packages/runtime-native/build/tn-linux-coverage/mystral`; its CLI accepts `run <bundle>`,
`--headless`, `--frames`, `--width`, and `--height`. (A normal non-coverage build may put the
same host at `build/tn-linux/mystral`.) Give shader startup more than thirty seconds without
fabricating readiness; this outer bound is 60 seconds. The probe itself owns completion and
disposal.

```sh
artifact_dir=artifacts/batch-2026-09-05
runtime_binary=packages/runtime-native/build/tn-linux-coverage/mystral
bundle="$artifact_dir/quality-resource-lifecycle-native.js"
export LLVM_PROFILE_FILE="$artifact_dir/quality-resource-lifecycle-native-%p.profraw"
sha256sum "$runtime_binary" "$bundle" | tee "$artifact_dir/quality-resource-lifecycle-native.sha256"
set +e
SDL_AUDIODRIVER=dummy timeout --kill-after=5s 60s sh scripts/xvfb.sh "$runtime_binary" run "$bundle" --headless --screenshot "$artifact_dir/quality-resource-lifecycle-native.png" --frames 180 --width 640 --height 360 > /tmp/quality-resource-lifecycle-native.log 2>&1
exit_code_value=$?
marker_count=$(rg -o 'TN_QUALITY_RESOURCE_LIFECYCLE:' /tmp/quality-resource-lifecycle-native.log | wc -l | tr -d ' ')
cp /tmp/quality-resource-lifecycle-native.log "$artifact_dir/quality-resource-lifecycle-native.log"
echo "NATIVE_EXIT=$exit_code_value MARKER_COUNT=$marker_count"
cat /tmp/quality-resource-lifecycle-native.log
```

Accept only exit `0`, exactly one `TN_QUALITY_RESOURCE_LIFECYCLE:` marker, JSON `pass: true`,
positive integer textures and draw calls in every settled sample, bloom in every stage list, and
no dropped-stage reason. Keep the complete log with the native host/GPU identity and report the
actual per-cycle counts; do not substitute browser counts or treat a missing marker as zero. The
host screenshot only provides the CLI's bounded shutdown; because the probe disposes its renderer
before logging the marker, it is not native visual acceptance evidence.

The corrected positive command exited 0 and saved its shutdown capture after 33,604 ms.
It emitted one passing result with 100 actual presentations. The earlier normal-mode command
was terminated after its passing marker; `--frames` alone does not bound normal mode.


The host can exit 0 after logging a failing probe; require the retained result verifier as well:

```sh
python3 docs/verification/batch-2026-09-05-quality-live/resource-lifetime/verify-native-result.py artifacts/batch-2026-09-05/quality-resource-lifecycle-native-screenshot.log
```

For the native mutation, run the retained negative bundle builder, copy its output to
`artifacts/batch-2026-09-05/quality-resource-lifecycle-native-negative.js`, and use that bundle in
the screenshot command with distinct log/capture paths. The host exited 0, but the unchanged
verifier exited 1 for `26 -> 34` texture growth. Running the original native bundle again exited
0 and its verifier exited 0. The [receipt](native-receipt.json) retains both results and hashes.
The default browser-named bundle was restored with the normal esbuild command afterward.
