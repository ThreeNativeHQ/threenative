# Tower defense starter kit

A finished tower defense: build on sixteen pads, hold a winding road for twelve waves, and keep the
reactor alive. Four towers (Sentry, Mortar, Arc coil, Cryo) each have three levels and three targeting
modes; Titans arrive on waves six and twelve; one orbital strike recharges every thirty seconds.

Everything you see is procedural: no model, no texture beyond the photographed sky that lights the
board (`assets/sky.jpg`, Poly Haven, CC0). Every tower and enemy is built in `src/render/shapes.ts`.

It deliberately does not use `@threenative/physics/navigation`: the road is a `PathFollow3D` curve,
which runs on every target, and towers ask the physics world who is in range rather than tracking
enemies themselves.

Press `1`–`4` to arm a tower and click a pad, `B` to build on the best free pad, `Space` to launch a
wave, `U` / `X` to upgrade or recycle the selected tower, `F` for the strike, `P` to pause, `H` for
the field guide and `R` to restart. Right-drag, the wheel and `Q` / `E` move the camera.
