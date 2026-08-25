---
prd_contract: v1
---

# PRD-197 — The native host fails loudly at creation

**Status:** COMPLETED 2026-08-24. WebTransport verifies peers by default, bind-group and sampler
creation throws at the call that creates the handle, and the phantom timer stubs are gone; the
record is `docs/verification/prd-197-native-fails-loudly-2026-08-23.md`.

**Complexity:** +2 for 6–10 files, +2 for C++ backend-sensitive state, +1 for a config
surface (the TLS override) = **5 → MEDIUM mode**.

## Context

Three places in the native host proceed silently where creation should validate, all from
`docs/audits/tech-debt-scan-2026-08-23.md`:

1. **TLS peer verification is permanently off.**
   `packages/runtime-native/src/webtransport/webtransport.cpp:790` calls
   `quiche_config_verify_peer(s->config, false)` with `// TODO: serverCertificateHashes`.
   Any WebTransport endpoint is trusted regardless of certificate.
2. **Bind groups and samplers wrap garbage handles.**
   `webgpu/bindings.cpp:4620` (`createBindGroup`) and `:4384` (`createSampler`) skip the
   check-and-throw that `createBuffer` and both pipeline factories perform; bad input
   dereferences later at submit, far from its cause.
3. **Timer stubs that never schedule are installed by both JS engines**, then overwritten
   by the real system later (`js/v8_engine.cpp:1137`, `quickjs_engine.cpp:886`,
   `runtime.cpp:1206`). A reorder of install order silently kills timers.

Files analyzed: the five paths above plus `include/mystral/js/engine.h`.

## Solution

- Verify peers by default; add one explicit dev override (config/env seam consistent with
  existing runtime flags) that logs loudly when used. Implementing
  `serverCertificateHashes` stays out of scope.
- Give bind groups and samplers the same null-check-and-throw their sibling factories
  already have — copy the local house pattern, no new helper machinery.
- Delete the never-scheduling stubs: either install real timers up front or leave the slot
  empty so absence is detectable, and prove timer delivery is independent of install order.

## Integration Ledger

| # | Changed thing | Live caller | Replaces | Negative control |
| --- | --- | --- | --- | --- |
| 1 | Peer verification default-on | WebTransport connect path in `webtransport.cpp` | unconditional `verify_peer(false)` | connect against a mismatched-cert endpoint → must fail with override off, succeed only with it on |
| 2 | Bind-group/sampler null throw | game code calling `createBindGroup`/`createSampler` via the bindings surface | silent wrap of null | force a null descriptor → throws at creation, not at submit |
| 3 | Real-or-absent timers | engine bootstrap in `runtime.cpp` | placeholder stub installs | swap install order → every timer still fires |

## Execution Phases

### Phase 1 — WebTransport verifies peers unless explicitly overridden

**Files (3):** `webtransport.cpp` (EDIT), the runtime flag/config seam that carries the
override (EDIT), `packages/runtime-native/__tests__/` webtransport spec (EDIT).

- [ ] Default `verify_peer(true)`; the override is named, logged at use, and documented.
- [ ] A connection to an endpoint whose certificate does not verify fails closed without
      the override and connects with it.
- [ ] Paste the red: today's build accepts the mismatched-cert fixture.

Observe red by reverting to `verify_peer(false)`: the new failure test must go red.

### Phase 2 — Bind groups and samplers throw at creation

**Files (2):** `webgpu/bindings.cpp` (EDIT), bindings contract spec (EDIT).

- [ ] Match the existing `createBuffer` check-and-throw shape exactly.
- [ ] Error names the resource type and reason, mirroring sibling messages.

Mutation for red: delete one of the two new checks — its test must fail.

### Phase 3 — Timers are real or absent, never fake

**Files (4):** `v8_engine.cpp`, `quickjs_engine.cpp`, `runtime.cpp`, engine contract spec
(EDIT).

- [ ] Remove both stub installations; the real scheduler owns the slot or nothing does.
- [ ] Prove install-order independence: bootstrap with the real system first and last;
      identical timer firing sequence.
- [ ] A pending timeout across the transition point fires exactly once.

Observe red by restoring either stub under the old ordering: the order-independence test
must fail.

## Verification

Record `docs/verification/prd-197-native-fails-loudly-<date>.md`.

1. Focused specs per phase, each with its mutation observed red, pasted.
2. Native-contract proof runs as a bindings test executable (no display needed).
3. One desktop playtest naming the executable run; any unexecuted target stays marked
   unverified.
4. `grep -n "verify_peer\|TODO" webtransport.cpp` shows the finding's TODO gone with the
   defect fixed.

## Acceptance Criteria

- [ ] Without the override, a certificate that does not verify cannot complete a
      WebTransport connection; with it, the log line proves it was used.
- [ ] Null bind-group/sampler descriptors throw where created; no deferred submit crash.
- [ ] Timer delivery survives arbitrary engine/scheduler installation order.
- [ ] Each criterion states its mutation and has the pasted red above.
