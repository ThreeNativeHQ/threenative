# Does the performance gate work on the emulator?

2026-08-17. Asked because the regression gate added for [PRD-130](../PRDs/mobile/PRD-130-android-default-js-engine.md)
could only fire with a phone attached, which means it could never fire in CI.

**Yes, and worse than on the phone. It is a tripwire with three working strands out of four.** Both
halves matter, so both are stated.

## 1. Measured, not reasoned about

Same two load-test APKs used on the Pixel 8, same bundle (16,384 moving cubes, 3 draw calls), run on
`emulator-5554` — `sdk_gphone64_x86_64`, API 35, `-gpu swiftshader_indirect`. Engine read from
`JS engine created:` in logcat both times.

| Rung | V8 | QuickJS | Ratio | Phone ratio |
| --- | ---: | ---: | ---: | ---: |
| L2 @ 4,096 | 75.17 ms | 87.75 ms | **1.2×** | 2.5× |
| L3 @ 4,096 | 48.03 ms | 70.36 ms | 1.5× | 2.7× |
| L2 @ 16,384 | 204.08 ms | 299.19 ms | 1.5× | 10.3× |
| L3 @ 16,384 | **65.76 ms** | **158.00 ms** | **2.4×** | **12.1×** |

## 2. Why the signal shrinks

**Swiftshader is a CPU rasteriser.** Software rendering dominates the frame and swamps the thing the
comparison is about. V8 does identical work in 8.34 ms on the phone and 65.76 ms here — **8× slower,
none of it the engine.**

Two consequences worth naming:

- **The engine ratio is squeezed about 5×**, from 12.1× to 2.4× at the top rung.
- **The modes stop behaving like they do on hardware.** On the phone every rung sits on the vsync
  interval. Here `L2@16384` reads 204 ms while `L3@16384` reads 65.76 — the hand-instanced mode is
  three times *slower* than the collapsed one at the same object count, because per-object draw work
  is what software rendering punishes. That is a rendering artifact and says nothing about either
  engine.

**So these numbers are a tripwire, not a measurement, and must never be quoted as performance
figures.** The baseline entry and the code that reads it both say so at the site.

## 3. What it does and does not catch

Against a 25% tolerance, the QuickJS numbers above trip **three rungs of four**.

**`L2@4096` does not trip.** It moves 75.17 → 87.75 ms, 1.2×, which fits inside the tolerance. On the
phone that same rung moves 2.5× and trips easily. There is a test asserting this so nobody
rediscovers it by trusting a green run.

So the honest scope: **a whole-engine revert is caught, loudly, on three rungs.** Something subtler —
a partial deoptimisation, a regression in one mode — may well cross the emulator unnoticed while the
phone would have seen it. That is the price of a gate that runs without hardware, and it is a price
worth paying only because the alternative in CI is no gate at all.

## 4. How it is wired

`assertDeviceReady` still **hard-blocks emulators by default** — PRD-070's rule, and every
qualification lane keeps it, because an emulator proves nothing about arm64, a real GPU driver,
touch, thermal or battery. The new `allowEmulator` option is opt-in, set by exactly one caller: the
benchmark, via `pnpm bench:engines --arm tn-android --allow-emulator`.

With it set, the battery and discharging bars are **relaxed rather than pretended to be met** — an
emulator reports a synthetic battery on AC and no meaningful thermal state.

Baselines are keyed separately: `tn-android@emulator` against `tn-android`, selected from the
report's own `deviceCondition.serial`. Crossing them would report a regression on every emulator run
and a pass on nothing, so there are tests for both directions — an emulator run judged against the
phone budget, and a phone run judged against the emulator's.

## 5. What this does not claim

- **Not a device number, and not a Godot comparison.** Nothing here may be compared with the
  39.27 ms Godot produced on real hardware.
- **Not mobile-ready, and not qualification.** An emulator cannot contribute to either; §4.
- **Not run in CI yet.** The lane is capable of it now; no workflow invokes it. Wiring it into CI is
  a separate change and needs a decision about runtime cost, since the QuickJS arm alone took ~150 s
  on this machine.
