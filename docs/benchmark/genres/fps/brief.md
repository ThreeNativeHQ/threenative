# FPS arena sweep brief

Build a playable first-person shooting range from the supplied `reference.png` and the
`assets/` folder beside it. This is a game somebody shipped; the brief describes it, and how
you build it is yours.

## The game

The player stands at a firing line at one end of a walled outdoor yard about 34 m square,
under a bright cloudy sky, holding a rifle. Down the range are red rectangular paper targets
on steel stands at varying distances and heights, among concrete barricades, a round barrier,
two dark lockers, a ramp and a raised walkway. Shoot the targets. One armed enemy soldier
patrols the range and shoots back. Register **12 scoring hits before a 60-second timer runs
out**; run out of time or health and the run ends. `Enter` restarts it.

## Player

- First person. Eye height 1.66 m, walking 5.6 m/s, sprinting 8.2 m/s while not aiming.
- Vertical field of view 70°, narrowing to 22° while aiming down the sights, and mouse look
  is half as sensitive while aimed. Pitch is clamped roughly −66° to +72°.
- Health starts at 100 and never regenerates. There is no jump, no crouch and no stamina.
- Spawns at the firing line facing down the range, with the nearest target on the crosshair.

## Weapon

- One rifle, always equipped. **One round per press** — holding the fire input does not
  repeat.
- Magazine 30, reserve 90. Reload moves rounds from the reserve into the magazine; the sights
  drop for about 0.7 s while it happens.
- Hitscan along the exact camera forward axis out to 60 m. No spread, no bloom, no recoil
  kick, no damage falloff.
- 10 damage a round; 4× in the top 12% of a body's height, 0.7× below a third of it.
- A target hit scores that target's value — 100, 150, 250 or 300. The struck target drops
  below its stand, cannot be scored, and swings back up about 1.4 s later.

## Enemy

One soldier, 36 health, unlimited ammunition.

- **Patrols** a fixed six-point route, facing the way it walks.
- **Hears** every player gunshot within 26 m and grows suspicious; **sees** the player within
  its vision cone when nothing blocks the line between them.
- Once alerted it **closes to engagement range, strafes, and fires three-round bursts**;
  each round takes 9 health off the player, so a full burst costs 27.
- Losing sight of the player sends it to **search** the last place it saw them, then
  **return** to its route.
- Dies at 0 health, ragdolls, and comes back. Killing it scores 300; wounding it scores 100.

## What is on screen

Match the reference: a light grey tiled concrete floor with white lane stripes, near-black
walls and blocks, salmon-red target faces, a pale blue sky with high cloud, and long soft
shadows from a high sun. The rifle and gloved hands fill the lower right of the frame. The
HUD is flat white text with no panels: score zero-padded to four digits at the top left,
health below it in green, the remaining time at the top right in orange, magazine and reserve
at the right as `30 / 90`, a small white crosshair dead centre, the objective across the top
centre, and a control legend along the bottom.

The `assets/` folder holds the models, textures and sky the real game shipped with — an enemy
soldier with animations, a rifle, a first-person hands-and-rifle viewmodel, target plate
textures, a tiling surface texture and a sky environment image. Use them. Loading them is
part of the job.

## What the sealed proof drives

Two sealed scenarios run against your finished build. Both drive the **keyboard only**, so:

**The game must be playable the moment it loads** — no click, no menu, no start button, and
no pointer lock required to move, fire, reload or retry. Mouse look may ask for a click to
lock the pointer; keyboard control must not.

The proof presses `KeyW` to advance, `Space` to fire and `KeyR` to reload. Bind those, along
with `KeyA`/`KeyS`/`KeyD` to move, `Shift` to sprint, and `Enter` to retry.

The proof reads these values from your game's observable state, under the resource id
`state`:

| Path | Meaning |
| --- | --- |
| `state.score` | current score |
| `state.health` | current health |
| `state.ammo` | rounds in the magazine |
| `state.reserve` | rounds in the reserve |
| `state.shots` | total rounds fired this run |
| `state.reloads` | reloads completed this run |
| `state.targetsHit` | scoring hits registered this run |
| `state.distanceMoved` | total metres the player has travelled this run |
| `state.timeRemaining` | seconds left on the clock |
| `state.phase` | `playing`, `complete` or `failed` |

The first playable screen must be visible without a user account or an external asset service.
