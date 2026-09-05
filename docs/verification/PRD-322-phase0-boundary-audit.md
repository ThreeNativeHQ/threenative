# PRD-322 Phase 0 — the boundary audit, and the decline

**Date:** 2026-09-04. **Engine HEAD:** `d9711120`. **Wildwood HEAD:** `d535f51` (separate
repository at `../sandbox/wildwood`).

**Outcome: DECLINED.** No product code was written. **The decline rests on rule 1(b)** — which
vetoes the one line that is genuinely a platform-to-tier decision — and, equivalently, on §6's
first condition: an appearance parameter cannot be kept out of core, and without it there is no
platform half left for rule 1(a) to reach.

**§6's second condition — the line-count one — does not fire, and an earlier version of this record
wrongly claimed it did.** See §6.

Per `docs/PRDs/batch-2026-09-01/README.md`: *"If either PRD's Phase 0 finds it cannot hold that
line, it closes as DECLINED with no product code. That outcome is a success for this batch, not a
failure."*

---

## 1. What Phase 0 asked for

> Read every template's quality file and Wildwood's. List every line that is platform and every
> line that is look. If the platform half is under about 15 lines per game, run `count-loc.ts`
> before proceeding — rule 1(a) says the framework owns a seam at any size, but a seam that is
> one `isWeb` call already has its export.

Eleven files were read: the ten shipped templates plus Wildwood.

---

## 2. The duplication is real, and it is byte-identical

`sed -n '/^export type QualityTier/,/^  return request.mobile === true/p' <file> | md5sum`

```
7f4a7f8f4ccf  packages/create-threenative/templates/action-rpg/src/render/quality.ts
7f4a7f8f4ccf  packages/create-threenative/templates/defense/src/render/quality.ts
7f4a7f8f4ccf  packages/create-threenative/templates/minimal/src/render/quality.ts
7f4a7f8f4ccf  packages/create-threenative/templates/platformer/src/render/quality.ts
7f4a7f8f4ccf  packages/create-threenative/templates/puzzle/src/render/quality.ts
7f4a7f8f4ccf  packages/create-threenative/templates/racing/src/render/quality.ts
7f4a7f8f4ccf  packages/create-threenative/templates/runner/src/render/quality.ts
7f4a7f8f4ccf  packages/create-threenative/templates/sailing/src/render/quality.ts
7f4a7f8f4ccf  packages/create-threenative/templates/shooter/src/render/quality.ts
7f4a7f8f4ccf  packages/create-threenative/templates/starter/src/render/quality.ts
7f4a7f8f4ccf  /home/joao/projects/threenative/sandbox/wildwood/src/render/quality.ts
```

Eleven identical copies. That is the fact PRD-322 was filed on, and it is true. What it is *not*
is a platform seam — see §3.

---

## 3. The premise is stale: the candidate reads no platform source

PRD-322 §1 states:

> `resolveQualityTier` reads an explicit override (a URL parameter, a saved setting) and otherwise
> asks the platform. That is a question a portable game structurally cannot answer: the browser
> answer, the Android answer and the desktop answer come from three different places, and one of
> them is a browser global.

The file does none of that. Every non-comment line of the candidate "platform half", verbatim from
`packages/create-threenative/templates/starter/src/render/quality.ts:32-66`:

```ts
export type QualityTier = "low" | "medium" | "high";
const QUALITY_TIERS: readonly QualityTier[] = ["low", "medium", "high"];
function isQualityTier(value: string): value is QualityTier {
  return (QUALITY_TIERS as readonly string[]).includes(value);
}
export function resolveQualityTier(
  request: { readonly mobile?: boolean; readonly tier?: string } = {},
): QualityTier {
  const requested = request.tier;
  if (requested !== undefined) {
    if (!isQualityTier(requested)) {
      throw new Error(
        `Unknown quality tier ${JSON.stringify(requested)} — expected one of ${QUALITY_TIERS.join(", ")}.`,
      );
    }
    return requested;
  }
  return request.mobile === true ? "low" : "high";
}
```

Nineteen code lines. **No `navigator`, no `window`, no `__THREENATIVE_NATIVE__`, no URL parameter,
no stored setting, no environment variable.** It takes a `mobile: boolean` that its caller hands
it. There is no platform branch to own, because there is no platform lookup.

---

## 4. The seam PRD-322 proposes to build already ships, and every game already calls it

`packages/core/src/platform.ts` owns the whole platform question:

| Line | Export | What it does |
|---|---|---|
| `platform.ts:38` | `nativePlatform` | Validates the host descriptor fail-closed — rejects a bad `runtime`, `os`, `formFactor` or `maxTouchPoints` rather than impersonating a browser |
| `platform.ts:181` | `detectPlatform` | Branches on `__THREENATIVE_NATIVE__` vs `navigator`; the internal source seam for tests |
| `platform.ts:191` | `getPlatform` | The frozen snapshot: `{ formFactor, maxTouchPoints, os, runtime }` |
| `platform.ts:196` | `isWeb` | — |
| `platform.ts:204` | `isMobile` | `getPlatform().formFactor === "mobile"` |

Web resolution reconciles three disagreeing sources (`userAgentData.platform`, `navigator.platform`,
`userAgent`) and returns `"unknown"` when they conflict irreconcilably
(`resolveBrowserOS`, `platform.ts:109-129`). Native resolution reads the host's descriptor and
cross-checks its `formFactor` against its `os`. That is precisely the three-different-places
problem PRD-322 describes — already solved, already exported, already portable.

**All ten templates call it**, in portable game code at the boot path:

```
action-rpg/src/scenes/Play.ts:96        mobile: isMobile()
defense/src/scenes/Defense.ts:32        mobile: isMobile()
minimal/src/scenes/Play.ts:79           mobile: isMobile()
platformer/src/scenes/Level.ts:66       mobile: isMobile()
puzzle/src/scenes/Puzzle.ts:46          mobile: isMobile()
racing/src/scenes/Race.ts:76            mobile: isMobile()
runner/src/scenes/Run.ts:39             mobile: isMobile()
sailing/src/scenes/Sailing.ts:44        mobile: isMobile()
shooter/src/scenes/Play.ts:126          mobile: isMobile()
starter/src/scenes/Play.ts:136          mobile: isMobile()
```

**So does Wildwood**, and the single browser global anywhere in the chain is already guarded by
core's `isWeb()` — the seam doing its job:

```ts
// wildwood/src/scenes/Valley.ts:554
const lowTier = isWeb() && new URLSearchParams(window.location.search).has("lowtier");
// wildwood/src/scenes/Valley.ts:555
setupPost(ctx.renderer, ctx.scene, ctx.camera, { godraysLight: sun, mobile: isMobile() || lowTier });
```

Wildwood's own comment at `Valley.ts:549` states the convention outright: *"isMobile() arrives as
an argument because src/render/ imports no framework package: the platform decision is made here,
in portable game code."*

### The claim that no game gets the native branch right is disproven

PRD-322 §1: *"every game writes its own, gets the web branch right and the native branch wrong,
and nobody notices because the native branch is the one nobody runs."*

No game has a native branch. Eleven games, zero native branches, because core owns it. The
per-game code is a `boolean` parameter.

---

## 5. Line-by-line split, as Phase 0 asked

| Line | Platform or look | Why |
|---|---|---|
| `export type QualityTier = "low" \| "medium" \| "high"` | **Look** | Which tiers this game ships. A game with one tier declares one. Also consumed by `QUALITY_PRESETS: Record<QualityTier, …>` and `qualityPreset`'s throw, so the game keeps it either way |
| `const QUALITY_TIERS = [...]` | **Look** | Same; `qualityPreset` reads it for its own error message |
| `isQualityTier` (3 lines) | Neither | A string-membership test over an array the game declared. No platform content |
| `resolveQualityTier` override check (12 lines) | Neither | Argument validation. No platform content |
| `return request.mobile === true ? "low" : "high"` | **Look — and this is the veto** | See below |

**The one line that maps a platform fact to a tier is a look decision.** "A phone gets `low` and
everything else gets `high`" is not a platform fact; it is this game's choice of which look a
phone deserves. A game that ships one tier deletes it. A game that gives phones `medium` edits it.
A game that also drops a desktop to `medium` when the frame budget slips rewrites it. Every
template's `AGENTS.md` already documents it as the game's: *"`isMobile()` selects `low`, otherwise
`high`, and `setupPost(..., { tier: "low" })` is the named override."*

Moving that line into core makes core decide that Android gets the cheap look. That is an
appearance parameter following the seam into `packages/`, which is PRD-322's **first** decline
condition and rule 1(b)'s veto over rule 1(a).

---

## 6. The line count, since Phase 0 asked for it

`scripts/count-loc.ts` scores framework-arm against vanilla-arm benchmark games; it has no mode
for scoring a proposed export, so the honest measurement is the direct one.

Leaving the look lines where rule 1(b) requires, the movable remainder is `isQualityTier` plus
`resolveQualityTier`'s override check = **15 lines per game**. Each game would gain an import and
still need its own `mobile → tier` mapping, ~3 lines back.

| | Lines |
|---|---:|
| Removed from 11 games (15 × 11) | −165 |
| Import line added to 11 games | +11 |
| Mapping kept in 11 games (~3 × 11) | +33 |
| Added to `packages/core` (export, doc block, fail-closed throw) | +25 |
| Added: `packages/core/__tests__/quality-tier.spec.ts` | +40 |
| Added: capability manifest entry and reference row | +10 |
| **Net** | **−46** |

Raw lines favour the export slightly. **The line count is not what decides this**, and PRD-322
says so: rule 1(b) is a veto over rule 1(a), and the 15 movable lines contain no platform content
for rule 1(a) to reach in the first place. A string narrower over three names the game itself
declared is something the game can write portably, and does.

---

## 7. Decline conditions, checked

PRD-322 §6:

> Close as DECLINED if the platform half cannot be separated without a preset or an appearance
> parameter following it into core, **or** if `isWeb` plus five lines per game already covers it
> and `count-loc.ts` says so.

**Condition 1 fires. Condition 2 does not**, and this record previously said "Both fire", which was
wrong on its own numbers.

1. **An appearance parameter follows it.** The only line with platform-to-tier semantics is the
   `mobile → "low" | "high"` mapping, and that is a look decision (§5). Core cannot take the
   platform half without it, because without it there is no platform half — only argument
   validation.
2. **`isWeb` plus five lines per game already covers it — this condition does NOT fire.** Both of
   its conjuncts fail, on this record's own numbers:
   - The movable remainder is **15 lines per game** (§5, §6), not five. Fifteen is three times the
     stated threshold, and "five" was a threshold, not a figure of speech.
   - `count-loc.ts` **was not run**: §6 states it has no mode for scoring a proposed export. Its
     hand-count substitute lands at **net −46 lines in favour of extraction**, so the line count
     argues *for* the export — the opposite of what this condition requires.

   The seam-already-exists observation is still true and still the most useful thing in this audit
   — `isMobile()` is one call at each game's boot path, and Phase 0's own words are *"a seam that
   is one `isWeb` call already has its export"*. But **that is an argument about rule 1(a) having
   nothing to reach, not a satisfied line-count condition**, and stating it as the latter put the
   line count ahead of the veto that actually decides this.

**One condition is sufficient.** Rule 1(b) is a veto over rule 1(a): once the mapping line stays in
the game, there is no platform half for core to own at any size.

---

## 8. What the audit did not settle

Stated rather than claimed, per `docs/PRDs/AGENTS.md`.

- **The Android and desktop native branches were not executed in this audit.** They are covered by
  `packages/core/__tests__/platform.spec.ts`, which exercises the native marker taking precedence
  over a compatibility DOM and the fail-closed rejection of a malformed descriptor, but this
  session ran no device and no desktop build. Status: `UNVERIFIED` for real-target execution.
  It does not change the decline — the code under audit has no native branch to execute — but it
  is not evidence that `isMobile()` is correct on a phone.
- **The eleven-way duplication is left standing here, and is now filed.** It is real and it is
  byte-identical, but what is duplicated is a narrower over names each game declares, not a seam,
  so removing it is a scaffold-drift argument rather than a rule-1(a) one. Filed as
  [PRD-353](../PRDs/done/PRD-353-eleven-copies-of-a-fail-closed-throw-drift-silently.md)
  — a review pointed out that what is duplicated eleven times includes a **fail-closed throw**, in
  a repository whose invariant is "fail closed everywhere", and that `scripts/template-quality.ts`
  checks the tier *names* and the prose but never compares the implementations or asserts the
  throw exists. A template that silently returned `"high"` on an unknown tier would pass every
  gate here. PRD-353 proposes a drift gate, not an abstraction.

---

## 9. Ledger

| PRD-322 ledger row | Outcome |
|---|---|
| 1 — `QualityTier` type and fail-closed narrower in core | Not built — the narrower has no platform content |
| 2 — Platform tier resolution with an override order | Not built — `getPlatform`/`isMobile` already is it |
| 3 — Wildwood loses its resolver | Not done — its resolver holds a look decision |
| 4 — Every template does the same | Not done |
| 5 — Tier observable to the playtest reporter | Already shipped: `TN_QUALITY_TIER <tier> mobile=<bool> source=platform\|override` at each template's `src/render/postprocessing.ts:32`, `minimal` at `:39` |
| 6 — Capability manifest entry | Not needed; `isMobile` and `isWeb` are already in `capabilities.json` |
