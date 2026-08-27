# PRD-224 — binding tables install once per class, 2026-08-27

**Lane:** desktop host, `packages/runtime-native/build/tn-linux` (headless V8 + wgpu-native,
Vulkan on NVIDIA RTX 2080). This is the record commit `47d1adb3` promised ("paste in
verification record") — written the morning after, with every executable re-run fresh at HEAD
(`0e11cadb` + the guard-script commit). **This is a contract record, not a measurement record:**
no gpubench rerun and no `TN_FRAME_BUDGET` pair has been run since the Phase 2 conversion, so
the frame-level claims below Phase 2 remain predicted, not measured. Phase 1's pricing gate has
not executed.

## What landed overnight

`47d1adb3` — Phase 2's conversion, same mechanism as step 1's `GPUCommandEncoder` (`c9941d0a`):

- One shared frozen `GPURenderPassEncoder` prototype (`state->renderPassPrototype`), built on
  first pass creation; all fifteen method rows go through the same transactional
  `installBindingTable` (snapshot/verify/rollback once per class, never per pass). Instances get
  `newObject` + `setPrivateData` + `setPrototypeOf`.
- The paired-state ruling, on the record (also in the commit message): `end` and the batched
  `__tnReplayEnd` resolve their command encoder from the **receiver** through
  `state->encoderRenderPassMap` at call time (`encoderForLiveRenderPass`), lifetime re-derived —
  a pass whose map entry no longer matches takes the same silent no-op the captured handler's
  mismatch branch always took. No captured `(encoder, pass)` pair survives in the receiver-aware
  rows; asserted negative by the static guard.
- Engines without native-method support (`!supportsNativeMethods()`) fall back to the untouched
  legacy per-call install behind the same entry point.

## Contract evidence — fresh runs, 2026-08-27 morning

`threenative-render-pass-class-table-test` drives the real headless runtime.

**Green (as committed):**

```
render-pass-class-table: prototype=shared receivers=resolved pairing=map-resolved runtime=wired
exit 0
```

**Red re-demonstrated.** Mutation: one line at the top of `ensureRenderPassEncoderClassTable` —
`if (engine != nullptr) return false;` — so every `beginRenderPass` takes the legacy per-call
path. Rebuilt in `build/tn-linux`, same executable:

```
FAIL: render pass methods are prototype members, not per-instance own properties
FAIL: render pass method identities are shared across instances
FAIL: detached end() reports the missing receiver by name, got: Cannot read properties of
undefined (reading 'call')
render-pass-class-table contract: 3 failure(s)
exit 1
```

Matches `47d1adb3`'s commit-message claim exactly (3 failure(s), exit 1). Reverting the one line
and rebuilding restores green (exit 0) — the mutation is the disable, the test is its detector.

**Siblings and static guards, same tree:**

- `threenative-command-encoder-class-table-test`: exit 0 (step 1's contract unbroken).
- `tests/webgpu-bindings-contract.test.mjs`: **34/34 passed** (includes the mutation self-check
  rows added at `47d1adb3`). The PRD's filing-time disclosure of an "over-broad source slice"
  red in this file no longer reproduces — the file is green at HEAD.
- Working tree after the demonstration: clean (`git status` shows no residue of the mutation).

## What remains open — stated plainly

- **Phase 1 (frame pricing)** — not started. No gpubench rerun (no current per-call residuals
  for the legacy classes), no desktop `TN_FRAME_BUDGET` pair against the recorded 22.2 ms
  render.p50 baseline. The predicted ≥2 ms win is still a prediction.
- **Phase 2's measurement checkboxes** — `gpubench.js`
  (`artifacts/prd-222/frame-attribution-2026-08-26/gpubench.js`) does not price
  `beginRenderPass` yet, so no ≥10× red→green paste exists for the conversion; the frame pair
  has not been repeated.
- **Phase 3 (widen the rest)** — not started. Only `ensureCommandEncoderClassTable` and
  `ensureRenderPassEncoderClassTable` exist; **37 per-call `installBindingTable` sites remain**
  in `bindings.cpp` (every other class: queue, buffer, device, texture, sampler, bind group, …),
  each one's constructor site uncounted and unpriced. No QuickJS/JSC lane has exercised either
  conversion — V8-only tonight and overnight.
- **Phase 4 (device arm)** — not started; the Pixel 8 was offline all night (`adb connect
  192.168.1.192:5555` refused at probe time ~00:45 and again 2026-08-27 morning).

## Verdict

Phase 2's conversion is **code-complete and contract-proven** (red and green both fresh-pasted
above); PRD-224 overall remains **PARTIAL** — phases 1, 3, 4 open. The PRD stays live at
`docs/PRDs/PRD-224-webgpu-binding-tables-install-once-per-class.md` for the next lane.
