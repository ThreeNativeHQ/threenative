# Genre pair record — top-down action — 2026-08-07

Brief SHA-256: `053c4b8c58219b0e578b7526526566496d8ab16b916c86cebb539672b2f86b86`  
Proof SHA-256: `513312953eaeaaa33d7c88de02cb947c0d88505300e393ed34acdad69b2d6d24`

## Paired result

| Arm | Archive | User LOC | Source files | Functional proof | Visual check |
| --- | --- | ---: | ---: | --- | --- |
| framework | `docs/benchmark/sweeps/topdown-action-2026-08-07` | 1606 | 21 | pass: full + pointer | pass: readable 3D arena and clear overlay |
| vanilla | `docs/benchmark/sweeps/topdown-action-2026-08-07-2` | 1620 | 2 | pass: full + pointer | pass: readable 3D arena and clear overlay |

The fresh paired source comparison is **1606 / 1620 = 99.1%**, so this genre does not
support a 50% authoring-cost claim. The source counts include the final target-lock and
completion-observation fixes; neither sealed scenario was weakened or edited.

## Proof evidence

- Framework full proof: `framework-sealed-brief-final`, `score=300`,
  `enemiesRemaining=0`, objective includes `SECURE`, mission `won`, diagnostics `0`.
- Vanilla full proof: `vanilla-sealed-brief-final`, `score=300`,
  `targetsDefeated=3`, objective `SECTOR 07 SECURED`, mission `won`, diagnostics `0`.
- Framework pointer proof: `framework-sealed-pointer3`, shots `4`, reload `0.1`,
  rotation delta `1.2799`, attack animation observed, diagnostics `0`.
- Vanilla pointer proof: `vanilla-sealed-pointer3`, shots `3`, reload `0.267`,
  rotation delta `0.6191`, attack animation observed, diagnostics `0`.

Both arms render a complete loop with distinct user-owned visual treatments. The framework
arena uses a lit 3D court, cover, sentry geometry, pickups, and a completion panel; the
vanilla arm uses its own grid arena, HUD hierarchy, and completion overlay.

## Abstraction decisions

| Candidate | Decision | Evidence |
| --- | --- | --- |
| `CharacterBody3D.syncToPhysics()` | retained | Cross-genre physics correctness: script-controlled rotation survives a physics tick; unit regression passes. It carries no gameplay or visual policy. |
| Target-lock assist | user-space only | It is combat-specific and remains in each top-down caller. Moving it into a package would violate the look/game ownership boundary. |
| Generic registry entity update loop | rejected | The useful caller saving is below the strict 20-line rule, and it does not change the sealed Abyss arm's measured floor. |

The existing platformer paired round remains the second genre check: framework `726` LOC
versus vanilla `769` LOC, or `94.4%`, with both sealed scenarios passing. The cross-genre
measurements therefore show framework plumbing is useful and reliable, but do not justify a
new gameplay abstraction or a 50% reduction.

## Commands

```sh
pnpm sweep:archive /tmp/threenative-topdown-round.jI9Qtv/framework/topdown-framework
pnpm sweep:archive /tmp/threenative-topdown-round.jI9Qtv/vanilla
pnpm sweep:measure docs/benchmark/sweeps/topdown-action-2026-08-07
pnpm tsx scripts/count-loc.ts --check
```
