# Android engine size — what a phone actually downloads for V8

2026-08-16. [PRD-130](../PRDs/batch-26-08-16/PRD-130-android-default-js-engine.md) Phase 3.

**The +25.6 MB the owner accepted is right.** It was arrived at by summing uncompressed native
libraries — a different quantity from an artifact's size — and this measures it the other way, on
per-ABI APKs built for the purpose. The two agree to within 0.03%.

**It also corrects a wrong number I published earlier today.** See §3.

## 1. The four numbers

Per-ABI APKs, produced by the new `-PthreenativeAbiSplits=true`, each built after deleting the APK
outputs so nothing is inherited from the other engine's build (§3 explains why that matters).

| ABI | QuickJS | V8 | Delta |
| --- | ---: | ---: | ---: |
| **arm64-v8a** (the phone) | 76,690,124 B | 102,297,258 B | **+25,607,134 B — +25.6 MB** |
| **x86_64** (the emulator) | 76,724,758 B | 102,838,302 B | **+26,113,544 B — +26.1 MB** |

An arm64 phone downloads **about 25.6 MB more** to get V8. That is the number PRD-130 asked for and
the answer is not smaller than the one on record.

### Where it goes, and why it is not simply +30 MB

`libv8android.so` is 29,919,888 B, and `libc++_shared.so` adds 1,794,776 B because V8's Android build
links the shared STL. Against that, `libmystral-runtime.so` **sheds 6,201,960 B** — 66,618,112 under
QuickJS against 60,416,152 under V8 — because QuickJS is compiled into the runtime and V8 is not.

```
+29,919,888  libv8android.so
 +1,794,776  libc++_shared.so
 -6,201,960  libmystral-runtime.so sheds a compiled-in QuickJS
    +90,841  both ABIs' startup snapshots (see below)
------------
+25,603,545  ≈ the measured +25,607,134
```

Native libraries are **stored, not compressed**, in these APKs, so the artifact delta is very close
to the raw library delta. There is no compression win to hope for here.

**One inefficiency this measurement exposed, introduced by Phase 1.** Both split APKs carry *both*
ABIs' snapshots — `assets/v8/arm64-v8a/` and `assets/v8/x86_64/` — because AGP splits `lib/` by ABI
and assets are not split. Each APK therefore wastes ~45 KB on a snapshot it can never use. At 45 KB
against 25.6 MB it is not worth an asset-filtering mechanism today; it is recorded so nobody has to
rediscover it.

## 2. PRD-118's universal figure, kept and labelled

PRD-118 §4 reports **+142.7 MB** for a universal APK carrying both ABIs, and its own retake already
labels that as double-counting. It is not deleted here and it is not wrong for what it measures — it
is simply not what any device downloads, because no device installs both slices.

| Figure | What it measures | Use it for |
| --- | --- | --- |
| +142.7 MB | universal APK, both ABIs | nothing user-facing; it double-counts |
| +25.6 MB (summed libraries) | uncompressed native payload, arm64 | a rough cost before splits existed |
| **+25.6 MB (this record)** | **arm64 APK artifact** | **what an arm64 phone downloads** |

**No Play-delivery figure.** An Android App Bundle would deliver less again, and this repository
produces no `.aab` and has no signing config to make one meaningful (PRD-128's row). Absent, not
estimated.

## 3. Correction: the "V8 APK is smaller" claim was a build artifact

[`prd-130-phase-5`](./prd-130-phase-5-2026-08-16.md) §4 and
[`prd-130-phase-6`](./prd-130-phase-6-2026-08-16.md) §4 report that the V8 APK measured *smaller*
than the QuickJS one — 211,910,388 B against 218,627,505 B — and call the direction "opposite to the
one on record". **That is wrong, and both records now carry this correction inline.**

The cause is incremental packaging. Building one engine and then the other reuses the previous APK
file, and the space the removed library occupied stays in the file as dead bytes. The evidence:

```
qjs-arm64.apk   file=102,296,944   sum of entries=77,799,387   → 25.5 MB unaccounted
v8-arm64.apk    file=102,297,258   sum of entries=103,402,932  → none
```

A 25.5 MB hole, sitting exactly where `libv8android.so` had been in the previous build. The QuickJS
APK was carrying V8's ghost. The first pair of split APKs differed by **314 bytes**, which is the
number that made me look — two builds whose native payloads differ by 30 MB cannot produce artifacts
314 bytes apart.

**Deleting `app/build/outputs/apk` and `app/build/intermediates/apk` between engines is what makes
the numbers real**, and every figure in §1 was produced that way.

The lesson generalises past this PRD: **an APK's size is only a measurement if it was packaged from
clean outputs.** Any future size comparison in this repository that skips that step is measuring the
build order.

## 4. What this does not claim

- **Debug builds.** `assembleDebug` throughout, because the release type has no `signingConfig`
  (PRD-128). Release would shrink the Java side, which is under 100 KB here, and leave the native
  libraries — the entire story — untouched.
- **Not a bundle figure.** No `.aab` was produced; see §2.
- **Not a runtime memory claim.** This is download size only. V8's resident footprint is a different
  measurement nobody has taken.
- **Not a reason to reverse the decision.** The owner accepted +25.6 MB, and +25.6 MB is what it
  costs. This record confirms the price rather than renegotiating it.
