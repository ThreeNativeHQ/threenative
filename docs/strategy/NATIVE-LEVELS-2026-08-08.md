# Going native — state diagnosis, three levels, effort

**Status:** proposal, 2026-08-08. Not binding. `CHARTER.md` wins on any conflict.
**Companion to:** `../architecture/NATIVE-RUNTIME.md` (the path), `../spikes/0a-mobile-render.md`
(the unrun gate), `ROADMAP.md` (which phase), `../PRDs/OPPORTUNITY-AREAS.md` (which area).

Triggered by external research proposing three levels of "native": RN-WebGPU (L1), an own
host over Hermes/QuickJS + Dawn/wgpu (L2), and a native engine with a Three-compatible
scripting API (L3).

---

## 1. Where we actually are

Measured, not argued. Every row has a file behind it.

| Fact | Value | Source |
|---|---|---|
| Framework LOC | **4,184 / 15,000** (28%) | `pnpm budgets`, 2026-08-08 |
| Workspace packages | **7 / 8** — one slot left | `pnpm budgets`; counter includes `examples/*` (`scripts/check-budgets.ts:50`) |
| Packages on disk | `core`, `physics`, `ui`, `playtest`, `create-threenative` | `packages/` |
| Roadmap phase | Phase 2 active; Gate 0 closed 2026-08-07, Phase 1 passed 2026-08-08 | `ROADMAP.md` |
| "Survives the platform" axis | **2 / 20** — web only | `ROADMAP.md` |
| Spike 0a (render on device) | **FAIL / unresolved**, 2026-08-02. 0 lines of shim written | `docs/spikes/0a-mobile-render.md:95` |
| Spike 0b (physics on device) | **not started** | `NATIVE-RUNTIME.md` |
| In-flight PRDs | 033, 035, 036, 038 all "partial / release evidence pending" | `ROADMAP.md` |
| Working tree | dirty; branch `docs/opportunity-areas-prds` is 1,591 files / +84k vs `main` | `git status`, `git diff --stat main...HEAD` |

**The honest reading:** the framework is small, healthy and web-only. Native is a *charter
promise* (one codebase reaching web, desktop and mobile), not a capability. The one spike that gates it
failed for **environmental reasons** — a broken Android emulator (`VK_ERROR_INCOMPATIBLE_DRIVER`)
and missing RN dependencies — so we still have **zero evidence** either way about whether
`three/webgpu` runs outside a browser. That is the single largest unknown in the project,
and it has been unknown for six days.

### What the research changes and what it does not

Already ours, restated: L1 is exactly the charter's cross-platform path. RN-WebGPU over Dawn is the
committed path, and `packages/core/src/renderer.ts` was built as a *factory seam* for it.

Genuinely new and useful:

1. **Hermes and QuickJS-ng embed without React Native.** That makes L2 conceivable at all —
   our docs assumed native meant RN.
2. **TSL compiles to WGSL in JS.** The native side consumes WGSL + pipeline descriptors and
   never needs to understand JS materials. This is the strongest bound on L2/L3 scope: we
   would never port materials, lights or TSL.
3. **Three's `Renderer` / `Backend` split** offers a fork point (`NativeBackend`) far smaller
   than forking Three — though `Backend.domElement` is still typed `HTMLCanvasElement`, so it
   is not a clean plug-in today.
4. **Zero-copy native texture interop** (`IOSurface`, `CVPixelBuffer`, `AHardwareBuffer`) —
   real capability the browser cannot match. Camera/video → GPU texture.

Contradicted by our own record: the research recommends L2 as "your sweet spot." The charter
lists **"a second runtime (Bevy, native rendering)"** as a closed question, decided against
with evidence — *32% of v1's 1,707 commits went to a runtime no benchmark ever measured.*
L3 is that item verbatim. L2 is a softer version of it (one renderer, two hosts), but it is
still a second runtime to keep alive on every Three.js release.

---

## 2. The three levels, priced

Estimates assume one developer plus agents, working focused days. Ranges are *implementation
to a state we would let a user touch* — our own bar, i.e. proven by a playtest, not by a
screenshot.

### Level 1 — RN-WebGPU adapter (~80–85% native) — **the committed path**

| Step | Effort | Notes |
|---|---|---|
| Fix the device environment | 0.5–2 d | Emulator Vulkan is broken here; a physical Android over USB is the faster route |
| Spike 0a — spinning cube on device | 1–3 d | Charter says ~1 day; it has already burned one attempt |
| `@threenative/native` adapter | 1–2 wk | Renderer factory, RN layout → resize (no `ResizeObserver`), rAF/vsync, `Image`/`fetch`/`TextDecoder` shims |
| Scaffold path (Expo prebuild, `create-threenative`) | 1–2 wk | Second template surface, second CI lane |
| Spike 0b — `@threenative/physics-native` JSI/Rapier | **4–8 wk** | Charter's 1–2 wk covers "a cube falls," not iOS+Android builds, prebuilt binaries, bulk transfer API, CI |
| Playtest on device | 1–3 wk | **The under-priced item.** Playwright does not exist on a phone; our proof discipline needs a device harness or it is unproven |

**Cube on a phone: ~1 week. Shippable, physics-enabled, playtest-proven mobile: ~3–4 months.**

Risk is *low and bounded*: it reuses Three, reuses Rapier's Rust, and if 0a fails we delete a
promise instead of maintaining a runtime. `physics-native` remains the one artifact nobody
else ships.

### Level 2 — own host: Hermes/QuickJS + Dawn/wgpu (~90% native)

| Step | Effort |
|---|---|
| Desktop prototype: Three `WebGPURenderer` under Node/Deno Dawn bindings, offscreen cube | **1–3 d** |
| Host: window, surface, swapchain, input, frame loop, JS engine embed, module loader | 4–8 wk |
| Web-platform shims Three and `core` assume (`fetch`, `Image`/`ImageBitmap`, `TextDecoder`, `URL`, canvas-2D for text textures, workers) | 3–6 wk, long tail |
| Audio, filesystem/VFS, asset decoding | 3–4 wk |
| Physics native (shared with L1's 0b) | 4–8 wk |
| iOS/Android app shells, signing, store packaging | 4–8 wk |

**6–12 months to something a user ships a game with**, plus a permanent tax: Three releases
roughly every six weeks, and each one can break a host shim (budget 1–3 d per version,
forever). We have already paid this tax once — it is what the charter is a monument to.

### Level 3 — native engine + Three-compatible scripting API (~95–100%)

**12–24 months, team-scale, and never finished** — Three exports 700+ symbols and API
compatibility is an infinite surface. Proxy objects, command buffers, native scene graph,
culling, animation, batching. This is the charter's rejected item word for word, and the
shape that produced 790k lines in v1.

**Recommendation: do not build.** The legitimate half of the idea — "don't cross JS↔native per
object" — is a *design rule for L1's binding*, not a reason to own the engine. Apply it to
`physics-native` on day one (`simulation.step(dt, input)` / `readVisibleTransforms(buffer)`;
`NATIVE-RUNTIME.md` already specifies this), and revisit native ownership only when a profile
names one specific system.

---

## 3. Two blockers that must be decided before any code

**1. The package cap is already violated by L1.** `pnpm budgets` counts `examples/*` as
packages (`scripts/check-budgets.ts:50`), so we are at 7/8 with one slot. L1 needs *two* new
packages — `native` (RN dep) and `physics-native` (JSI dep) — which lands at 9. The charter's
own eight-package list contains both, so the *list* and the *counter* disagree. Options:

- **(a)** Amend the counter to count only `packages/*`, cap 8 shipped packages. Honest — an
  example is not a published artifact — but it is changing an instrument to fit a plan, and
  must be recorded as a budget amendment with that reasoning stated.
- **(b)** Spend the last slot on `physics-native` and fold the RN adapter into `core` behind a
  subpath export. Contradicts the charter's own package rule: it carries a dep others must not inherit.

(a) is the defensible one, but it is your call, not mine to make silently.

**2. Phase 2 is mid-flight.** PRDs 033, 035, 036 and 038 are all "partial, release evidence
pending," and the branch carries 1,591 uncommitted-lineage files. Opening a native front on top
of four unclosed PRDs is how a 15k-LOC budget becomes 790k. Land them first.

---

## 4. Positioning

**Claim today:** *a web framework for Three.js games whose agent can verify its own work.*
`playtest` is the defensible asset — vanilla Three.js has no answer at all, and it is the one
capability an agent uses on every single task. Physics bindings are second.

**Do not claim device support** in `README.md` or anywhere else until 0a passes on hardware.
The roadmap already scores that axis 2/20; the README should read the same way.

**Differentiator ranking, if the native work lands:**

1. `@threenative/physics-native` — nobody ships a JSI Rapier binding. Highest defensibility.
2. Agent self-verification on device — playtest that works on a phone is unique twice over.
3. "One codebase, web and device" — true of RN + Three today; our version is only better if 1
   and 2 exist.

---

## 5. Recommended sequence

1. **Land Phase 2.** Close 033, 035, 036, 038 with release evidence. (weeks, already scoped)
2. **Run the desktop shim probe — 1–3 days, no phone required.** Three `WebGPURenderer` under
   Node/Deno Dawn bindings, headless cube, and *count every shim line*. It answers 0a's real
   question (how much of the browser does Three need?) at near-zero cost, and the shim
   inventory is the same number that decides whether L1's adapter is a factory or a fork —
   and whether L2 is 4 weeks or 4 months.
3. **Run 0a on a physical Android.** Record the result in `docs/spikes/0a-mobile-render.md`
   either way. A second FAIL for environmental reasons is not a result; get a real device.
4. **Decide the package-cap question** *before* writing adapter code.
5. **0b: `physics-native`.** Bulk-transfer API from the first commit.

L2 stays a live option, unlocked cheaply by step 2 — if the shim inventory comes back small
(tens of lines), L2's price drops sharply and it deserves a real charter debate. L3 stays
closed until new evidence, not a new argument.
