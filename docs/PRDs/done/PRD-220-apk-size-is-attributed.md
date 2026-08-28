---
prd_contract: v1
---

# PRD-220 — The Android APK's bytes are attributed

**Status: DELIVERED 2026-08-25** — squash-merged to main as `4ade82c7` after two independent review passes; evidence in `docs/verification/apk-size-2026-08-25.md` (clean rebuild 173,572,580 bytes, SHA-256 recorded, C1–C19 fail-closed).
**Complexity:** **2 → LOW**, one build lane, no device frame runs.

## Context

The fps-framework probe on 2026-08-24 (`docs/verification/runtime-perf-state.md`)
measured the game's APK at **379 MB** and explicitly deferred the breakdown: *"APK size —
separate investigation."* Nobody can currently say where those bytes are: which `.so`
libraries, how many ABIs, whether debug symbols ship, whether the 346 MB texture upload seen
during the load stall correlates with bundled asset weight, or whether packaging is
duplicating content the Gradle merge already staged. At 379 MB the artifact is past
play-store comfort and past any plausible download-friction bar for a template game, so every
future mobile demo inherits the problem until someone names it.

This PRD only **attributes and disposes**; performance work stays in PRD-214/218 lanes.

## Solution

- **One table owns the truth:** a byte-level attribution of the built APK whose rows sum to
  the artifact within 5 %, every row naming its component and its owning layer
  (framework packaging / game asset / toolchain output).
- **Fixes land where they are owned.** Framework-owned packaging waste (stripping,
  ABI splits, compression, duplicate staging) is fixed in `packages/runtime-native`'s Gradle
  story with a before/after size proof; game-side weight (source textures, audio) is filed as
  named rows for the game author, never patched silently here.
- No speculative re-encoding of game assets; no new pipeline (the asset-pipeline trigger doc
  governs that and is not reopened).

## Integration Ledger

| # | New thing | Live caller | Replaces | Old path removed? | Negative control |
|---|-----------|-------------|----------|-------------------|------------------|
| 1 | Packaging fixes in the native Gradle/APK story (whatever Phase 2 proves wasted) | `packages/runtime-native` android packaging | unstripped/duplicated packaging defaults | replaced in place | revert the packaging change → rebuild restores the pre-fix byte total (pasted) |
| 2 | Size attribution record + doctor note | `docs/verification/apk-size-<date>.md`; `threenative doctor --text` prints the last attributed total if the lane exists | nothing — no size reporting existed | n/a | delete the record's build dir → the doctor note names the missing evidence rather than inventing a number |

## Phases

#### Phase 0: reproduce the artifact locally

- [ ] Build the same variant the probe measured (debug APK of the fps-framework game,
      applicationId `com.threenative.bayview`) on this machine's Gradle lane; record variant,
      command and byte size next to the probe's 379 MB figure. If local differs from the
      probe by >5 %, stop and reconcile before attributing.

#### Phase 1: attribute every byte

- [ ] Unzip-level breakdown into a table: per-ABI `lib/**/*.so` each named
      (native runtime, V8, SDL, …), `assets/` split game vs engine, `res/`, `classes*.dex`,
      `resources.arsc`, root metadata. Rows sum to ≥95 % of the APK's bytes.
- [ ] For each `.so`: stripped or not (symbol tables present?), and which build setting
      decides that. For duplicated-per-ABI content: name it.

#### Phase 2: dispose of the top contributors

- [ ] Top 5 rows, ranked by bytes, each get a disposition in the record:
      **fixed here** (framework packaging — land it, paste before/after totals),
      **filed** (game-side weight — named row for the game author),
      or **justified** (e.g., a required ABI).
- [ ] Any landed packaging fix keeps `pnpm typecheck && pnpm lint && pnpm test` green and its
      own rebuild diff as red-green evidence.

#### Phase 3: record

- [ ] `docs/verification/apk-size-2026-08-25.md` carries the table, commands, variant, and
      dispositions. Nothing claims a store-compliance outcome — attribution only.

## Acceptance criteria

1. **The table exists and sums.** Attribution rows cover ≥95 % of the rebuilt APK's bytes,
   with the reconciliation to the probe's 379 MB stated. *Red-green:* delete any single row's
   underlying evidence command → re-running it must reproduce that row's bytes; a row that
   cannot be reproduced fails the record.
2. **Every top-5 contributor has a disposition** — fixed with pasted byte delta, filed as a
   named row, or justified in writing.
3. **No silent game edits.** The fps-framework sandbox game (workspace `sandbox/fps-framework`,
   outside this repository) is read-only for this PRD except a size-motivated change the game
   author asked for; anything else is filed, not patched.
4. **House gates stay green** after any packaging fix lands.
