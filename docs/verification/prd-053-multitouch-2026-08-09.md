# PRD-053 multi-touch verification — 2026-08-09

**Result: browser PASS; Android device proof BLOCKED.** PRD-053 is not done. The standalone
proof is wired into non-project Android/all parity as `supplemental.androidMultitouch`; its
failure forces aggregate exit 1 without discarding the 66 visual row results.

## What passed

- Core input tests: 23/23 passed (`input.spec.ts`, `replay.spec.ts`). They cover arrival-order
  pointer identity, move without reinsertion, primary promotion, cancel and blur clearing.
- Playtest focused tests: 42/42 passed across scenario validation, browser complete-held-set
  delivery, Android delivery/final release, and explicit iOS unsupported behavior.
- Native input/verifier tests: 4/4 passed. The real x86_64 Android `mystral-runtime` target
  compiled and linked in 30 steps.
- The browser native-smoke scenario passed all seven assertions: `maxPointers=2`, simultaneous
  move and jump latches, labeled airborne observation, `currentPointers=0`, and positive X
  delta `0.6000000000000001`.

## Real emulator result

Command:

```sh
pnpm --dir packages/runtime-native native:verify:android:multitouch \
  --device emulator-5556 --skip-build --skip-install
```

The existing first-proof gate passed: 300 frames, clean logs, screenshot captured, and process
5118 remained alive. The bundle SHA-256 was
`1ad47bff50db7b98fffb904fc5eb14a4fedf590ec396a54846ecacd057023c85`.

The positive multi-touch scenario then failed closed. `maxPointers` remained `0`, both
simultaneous-input latches remained `false`, movement delta stayed `0`, and
`currentPointers` was `0`. The verifier released every protocol-B slot in `finally`. Because
the positive run failed, no passing aggregate report was written.

The fail-closed run evidence was:

- Injection kind: `adb-emu-event-protocol-b`, parsed display rotation `0`.
- Positive requested ids: `[7]`, then `[7, 3]`, then `[]`; protocol-B tracking ids were
  `[100]`, then `[100, 101]`, then `[]`.
- Observed positive latches: `maxPointers=0`, `movedWithTwoPointers=false`,
  `leftGroundWithTwoPointers=false`, labeled `airborne=false`, `currentPointers=0`.
- One-pointer negative control requested `[7]`, released to `[]`, reached assertions, and
  failed as required with exit-code-1 semantics. It is not evidence of the missing positive
  delivery.
- Liveness: first proof `passed`; both scenarios reached their assertion evaluator. Bundle
  hash and first-proof process id are recorded above.

## Failure analysis and stop condition

The first injection attempt used the emulator console's symbolic `SYN_REPORT`. This emulator
returns process exit 0 with `KO:` because it has no symbolic `EV_SYN` code aliases. The driver
now sends numeric Linux `EV_SYN:0:0` and treats `KO:` output as failure.

Live `getevent -lt` confirmed that slot, tracking-id, X/Y, pressure, touch-major and SYN frames
reach `/dev/input/event2` (`virtio_input_multi_touch_1`). The device advertises pressure and
touch-major but not `BTN_TOUCH`; the final bounded attempt therefore supplied non-zero pressure
and touch-major and removed the unsupported key event. Android still did not promote the raw
frames into SDL touch events.

After three failed device attempts, work stopped under the repository rule. The doubtful
assumption is that rootless `adb emu event send` targets the virtio touchscreen associated with
display 0 and is promoted by Android InputReader into `MotionEvent`/SDL touch on this API-35
AVD. Until that routing is proven, Android multi-touch support is not claimed and the PRD must
not move to `docs/PRDs/done/`.

## Native budget review

The focused native tree is 56,974 lines, above the 50,000-line review trigger. The only
PRD-053 native additions are the SDL touch-identity bridge and its standalone fail-closed
verifier. Their kill switch is to delete either component if it cannot preserve stable ids or
produce real-device evidence; no parallel gesture, zone, or input abstraction may replace it.
