# PRD-044 — Native render adapter

**Status: SUPERSEDED by PRD-047.** The React Native host and `@threenative/native` package
described below are no longer the selected architecture. This file is retained as the
historical seam analysis; active work follows the owned Mystral runtime in
`PRD-047-mystral-runtime-absorption.md`.

**Historical gate:** Does not begin until spike 0a records a PROVISIONAL PASS on
the Android emulator. `docs/spikes/0a-mobile-render.md` §6 currently records
*"Unresolved / FAIL — 2026-08-02"* for environmental reasons (emulator
`VK_ERROR_INCOMPATIBLE_DRIVER`, `react-native-webgpu` absent). No device render has ever
been observed. Starting this PRD before that answer exists is building an adapter for a
path nobody has seen work.

**No physical hardware is available (2026-08-08). This PRD runs on the emulator, and the
spike's own rule says that is not a full pass.** `0a-mobile-render.md` §2: *"Emulator is
sufficient for a negative, not for a positive… a pass still owes a physical-device run,
because the emulator fakes the GPU driver."* That rule is not waived — it is **split**:

| Question | Emulator answers it? | Status after this PRD |
|---|---|---|
| Do Three's six assumed globals survive outside a browser? | **Yes, fully** | closed |
| Do our five `core` couplings survive? (§1.1) | **Yes, fully** | closed |
| Does the RN adapter construct a real `WebGPURenderer`? | **Yes** | closed |
| Does it run on a real Metal/Vulkan driver? | **No** — emulated | **OPEN** |
| What frame rate does a real phone get? | **No** | **OPEN** |

The first three are the ones this PRD's design depends on, and they are JS-environment
questions the emulator tests exactly as well as hardware. The last two stay open, are
recorded as open in every claim, and become a hardware debt carried into `ROADMAP.md`
Phase 3. **A doc that reports this PRD as "mobile works" without naming those two open
rows is the failure `AGENTS.md` calls verification dishonesty.**

**Complexity: 9 → HIGH mode.** (multi-package +2, new package +2, external API — React
Native and `react-native-webgpu` +2, platform/lifecycle state +2, type-contract change
across 5 core files +1.) HIGH means an automated checkpoint after every phase, plus a
manual checkpoint on every phase with device behaviour.

**Depends on:** spike 0a (provisional PASS on emulator, recorded in
`docs/spikes/0a-mobile-render.md` §6); PRD-022 (viewport lifecycle — the resize path this
widens); PRD-031 (scene-owned lifecycle).
**Blocks:** PRD-045 (playtest on device), PRD-046 (`@threenative/physics-native`).
**Charter authority:** `CHARTER.md` §7 (the mobile gate and its diagram), §9a (a package
exists only when it carries a dependency the others must not inherit), §10 (budgets —
**this PRD requires a §10 amendment, see Phase 0**), `AGENTS.md` rules 1, 2, 4, 5.
**Area:** `OPPORTUNITY-AREAS.md` #7 "Mobile & on-device", score **61** (the lowest-scored
item this repo has ever opened a PRD for — see §0).

---

## 0. Score this honestly before reading further

**This is the highest-variance item on the board and the opportunity doc says so.** Score
61, with the note *"gap is real, cost is brutal and a failed spike deletes a charter
promise."* Two things follow, and both must stay true through implementation:

| Roadmap axis | Expected movement | Why |
|---|---|---|
| Ships working (`sweep:pair`) | **0** | Sweeps run in a browser. No paired proof executes on a device. |
| Looks good (`sweep:judge`) | **0** | §5b-safe by construction — this ships no material, no light, no camera. |
| Costs less (`count-loc`) | **slightly negative** | The framework gains a package; the user's game code is unchanged. |
| Does what vanilla can't | **+small** | Vanilla Three.js on a phone is possible today via RN-WebGPU. Our delta is the *scaffold*, not the capability. |
| **Survives the platform** | **2 → 10–14** | The only axis this moves, and the only reason to build it. |

**The delta over "just use react-native-webgpu yourself" is thin until PRD-046 lands.**
Rendering on device is already solved upstream. What nobody ships is physics on device
(§7) and proof on device (PRD-045). This PRD is the *carrier* for those two; sold on its
own it is a scaffold convenience, and rule 1 would reject it.

---

## 1. Context

**Problem:** `packages/core` assumes a browser in five places. None of them are deep, and
none of them have ever been exercised outside one.

### Files analyzed

`packages/core/src/renderer.ts` (whole file), `packages/core/src/viewport.ts`,
`packages/core/src/input.ts`, `packages/core/src/audio.ts`, `packages/core/src/game.ts`,
`packages/core/src/loop.ts`, `packages/core/AGENTS.md`, `scripts/check-budgets.ts`,
`docs/architecture/NATIVE-RUNTIME.md`, `docs/spikes/0a-mobile-render.md`,
`docs/architecture/CHARTER.md` §7 / §9a / §10.

### 1.1 The measured coupling — 34 call sites, 10 files

| File | Sites | What breaks on device |
|---|---:|---|
| `renderer.ts` | 12 | `RendererLike.domElement` is typed `HTMLCanvasElement` (`renderer.ts:7`). RN's surface is not a DOM node — the type is a lie, not a runtime failure |
| `game.ts` | 6 | canvas lookup and mount |
| `viewport.ts` | 5 | `ResizeObserver` does not exist in RN; resize arrives as a layout event |
| `input.ts` | 2 | DOM `addEventListener` → native touch/gamepad |
| `audio.ts` | 2 | WebAudio → native audio |
| `loop.ts` | 2 | **already guarded** — `typeof globalThis.requestAnimationFrame === "function"` (`loop.ts:32`) |
| `replay.ts`, `hot.ts`, `particles.ts`, `DebugOverlay.tsx` | 1 each | out of scope; web-only paths |

`createRenderer()` already accepts `webgpuFactory` / `webgl2Factory` overrides
(`renderer.ts:20-21`). `NATIVE-RUNTIME.md` states the intent plainly: *"The RN adapter is
a factory, not a fork."* This PRD tests that claim, and **§6 says what to do when it turns
out to be false.**

### 1.2 The 20-line rule, applied before anything is designed

Could a competent developer write the adapter in under 20 lines? For a spinning cube, yes
— that is what the upstream RN-WebGPU Three.js integration is. For a scaffolded game with
lifecycle, resize, input and teardown, no: the seam work is in `core`, which the user does
not own. The package itself must stay near-trivial. **If `@threenative/native` exceeds
~250 LOC, rule 2 applies and the design is wrong.**

---

## 2. Solution

Widen five seams in `core` so they take an injected platform source instead of reaching
for a browser global. Ship the RN implementations of those sources as
`@threenative/native`. Web behaviour is unchanged, and that is a gate, not an aspiration.

```
@threenative/core            @threenative/native
  createRenderer(factory)  ←   rnWebGPUFactory()
  viewport(resizeSource)   ←   rnLayoutResize()
  input(eventSource)       ←   rnInputSource()
  audio(backend)           ←   rnAudioBackend()
```

### 2.1 Explicitly rejected

- **A `NativeBackend` fork of Three's renderer.** Three's `Backend.domElement` is still
  typed `HTMLCanvasElement`; forking the backend boundary is a second renderer, which
  `CHARTER.md` §2 closed with evidence (32% of v1's 1,707 commits).
- **An own host (Hermes/QuickJS + Dawn directly).** Same §2 closure. Left reachable — see
  §2.2 — but not built.
- **A second template.** The scaffolded starter must run on both targets or the mobile
  promise is a marketing line.
- **Desktop targets.** Not on the roadmap. Do not add a third platform to this PRD.

### 2.2 Host-agnosticism, which is free and must not be skipped

RN is a *host*, not the technology. RN already runs Hermes and already uses Dawn; a future
own-host path (`NATIVE-RUNTIME.md`, and the L2 option) swaps the shell, not the stack.
Three rules keep that door open at zero cost:

1. No `react-native` type or import ever appears in `packages/core`. Enforced by a lint
   rule in Phase 1, not by intent.
2. Every widened seam takes an *injected* source. Never a `typeof window === "undefined"`
   branch inside `core`.
3. `RendererLike.domElement` becomes a structural type, not `HTMLCanvasElement`.

Break these and the framework is welded to React Native.

---

## 3. Phases

### Phase 0 — the three things that must precede any code

**0a's answer, on the emulator.** Two environment blockers killed the 2026-08-02 attempt
and must be cleared first, in this order:

1. **`adb` — `could not install *smartsocket* listener: Operation not permitted`.** This is
   a host/permission failure, not an Android one. `adb kill-server`, confirm nothing else
   owns port 5037, and confirm the sandbox permits it. Until `adb devices` enumerates, the
   spike cannot start.
2. **`emulator -gpu host` — `VK_ERROR_INCOMPATIBLE_DRIVER`.** Confirm host Vulkan works
   (`vulkaninfo`) and that the driver package for this GPU is installed. If `-gpu host`
   cannot be made to work, `-gpu swiftshader_indirect` is an **acceptable fallback for this
   PRD specifically**, and the reason is in §0's table: the questions the design depends on
   are JS-environment questions, and software Vulkan tests those exactly as well. Record
   which GPU mode produced the result. A swiftshader pass **must never be reported as a
   driver or performance result** — `0a-mobile-render.md` §2 is right that such a number
   "means nothing either way."

**Then record PASS or FAIL in §6 of that file, with the shim inventory in lines and the
GPU mode named.** A FAIL for a *structural* reason ends this PRD and triggers a
`CHARTER.md` §7 amendment deleting the mobile promise — a legitimate outcome, not a blocker
to route around. **A third consecutive environment-only failure is not a result**; escalate
to acquiring hardware rather than recording another empty §6.

**Amend the spike's own rule, in the same commit.** `0a-mobile-render.md` §2 says a pass
"still owes a physical-device run before it is written into `docs/verification/`." Do not
quietly ignore that sentence. Amend it to the split in §0 above — emulator closes the JS
questions, hardware still owes the driver and frame-rate rows — so the debt stays visible
instead of disappearing.

**The package cap.** `pnpm budgets` reports 7/8 packages, and
`scripts/check-budgets.ts:50` counts `examples/*` as packages. This PRD needs one slot
(`native`); PRD-046 needs a second (`physics-native`). That is 9. `CHARTER.md` §9a's own
eight-package list contains both, so the list and the counter disagree. Resolve it
**before** Phase 1, in a commit that states the reasoning:

- **(a)** Amend the counter to count only `packages/*`, cap 8 shipped packages. An example
  is not a published artifact. Honest, but it is changing an instrument to fit a plan and
  must be recorded as a §10 amendment saying exactly that.
- **(b)** Spend the last slot on `physics-native` and fold the RN adapter into `core`
  behind a subpath export. Contradicts §9a — it carries a dep others must not inherit.

**(a) is the recommendation. The decision is the human's, and §10 says exceeding a cap is
not a signal to raise the cap — so if neither option is taken, this PRD dies here.**

### Phase 1 — de-DOM the five seams in `core`, web unchanged

`RendererLike.domElement` becomes structural (`{ width: number; height: number }` plus
what Three actually needs). `viewport` takes a resize source, defaulting to the existing
`ResizeObserver` path. `input` takes an event source. `audio` takes a backend.

**Gate:** every existing web gate stays green — `pnpm typecheck && pnpm lint && pnpm test`,
`pnpm test:browser`, `pnpm visuals`, and the four sealed genre proofs. **Zero regression on
web is the phase, not a side condition.** Budget: ≤150 LOC net in `core`. Over that, stop
and re-read §6.

### Phase 2 — `@threenative/native`

The four RN sources, plus the package. Nothing else. ≤250 LOC.

**Gate:** the 0a cube, now driven through `@threenative/core` rather than raw
`three/webgpu`, renders 300+ consecutive frames on the emulator without a crash or a lost
device, at a recorded frame rate. **An unmeasured pass is a fail**
(`0a-mobile-render.md` §4.3) — record the number even though, on an emulator, the number
means nothing. It is the *stability* that is being asserted here, not the speed, and the
result must say that.

### Phase 3 — the scaffolded starter runs on the emulator

`pnpm create threenative` output, unmodified except for the native entry, launches on the
Android emulator and renders its first frame. Screenshot recorded, dated, in
`docs/verification/`, with the GPU mode named.

**Gate:** manual checkpoint. A human sees the starter running. **The record must say
"emulator," never "device" or "phone"** — those words claim the two rows §0 leaves open.

### Phase 4 — scaffold path and CI lane

Expo prebuild wiring in `packages/create-threenative`. A CI lane that at minimum builds the
native bundle; device execution in CI is **out of scope** and must be stated as such rather
than faked.

### Phase 5 — charter and roadmap

`packages/core/AGENTS.md` says the core's contents list *"is closed. Adding to it needs a
PRD and a line in `CHARTER.md`."* This is that PRD; Phase 5 adds the line, updates §9a's
package table to match reality, and updates `ROADMAP.md` Phase 3 (which currently states
device work *"gets no PRD, and that is a charter rule"* — that sentence becomes false the
moment this file exists, and leaving it is a documentation lie).

---

## 4. Verification strategy

**The primary negative control is the web arm.** Every seam widened here is a seam the
browser already uses. If web behaviour changes at all — a proof result, a visual baseline,
a playtest assertion — the widening is wrong. Run the full web suite at every phase, not
just at the end.

**Device proof is manual until PRD-045.** State that in every claim. A screenshot plus a
frame counter plus a measured FPS is what Phase 2 and 3 can honestly assert; it is not a
playtest and must never be described as one. This is the explicit, time-boxed exception to
`AGENTS.md`'s "any change with runtime behaviour gets a playtest scenario" — and PRD-045
exists to close it.

**Negative controls:**

- Delete the injected resize source → viewport must fail loudly, not silently freeze.
- Point `webgpuFactory` at a factory that throws → `createRenderer` must surface it, not
  fall back silently to WebGL2 on a device that has no WebGL2.
- Build `@threenative/core` with `react-native` absent from the dependency graph → must
  succeed. A core that needs RN installed to typecheck has failed §2.2 rule 1.

---

## 5. Acceptance criteria — consumer-scoped

1. `docs/spikes/0a-mobile-render.md` §6 records a dated PASS on the named emulator image
   and GPU mode, with the shim inventory in lines, and §2 amended to the §0 split.
2. A `pnpm create threenative` starter, unmodified, renders on the Android emulator for
   300+ frames, with a dated screenshot in `docs/verification/`.
2b. **The two open rows from §0 — real GPU driver, real frame rate — are recorded as OPEN
   in `ROADMAP.md` Phase 3 as a hardware debt.** This PRD cannot close them and must not
   read as though it did.
3. `packages/core` contains zero `react-native` imports and zero `HTMLCanvasElement`
   annotations, enforced by lint.
4. Web arm unchanged: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:browser`,
   `pnpm visuals` and the four sealed genre proofs all green, with no baseline updated to
   make them pass.
5. `pnpm budgets` green, with the §10 amendment recorded and reasoned — **not** with a cap
   raised to fit.
6. `@threenative/native` ≤250 LOC; net `core` growth ≤150 LOC.

---

## 6. Kill conditions — check these, do not push through them

Stop and amend `CHARTER.md` §7 rather than continue, if any of these hold:

- 0a fails on the emulator for a **structural** reason (not another environment problem).
- 0a fails for environment reasons a third time → stop opening this PRD and acquire
  hardware. Two empty §6 records are enough.
- De-DOMing `core` exceeds 150 LOC, or requires a `typeof window` branch inside `core`.
- The adapter cannot be a factory and needs a fork of Three's renderer or backend — that is
  a §2 closed question and a much larger decision than this PRD.
- The package-cap question in Phase 0 is not answered. §10 exists precisely to stop work
  here.

`AGENTS.md`: *"unverified is an acceptable answer, verified without a run is not."* A FAIL
recorded honestly is worth more than this package.
