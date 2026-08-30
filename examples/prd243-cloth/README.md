# PRD-243 cloth proof

Press Space to send a gust through the flag. The game wins only when an asynchronous GPU position
sample proves at least 0.34 metres of local-z deformation and the flag remains on the near side of
the physics wall; otherwise it loses. The authored flag starts on local z=0, so this measurement is
specific to this rule. Press R to reload the scene and rebuild the cloth after releasing its GPU
resources.

| Mined feature | PRD | Game rule | Observable proof |
| --- | --- | --- | --- |
| `SoftBody3D` mesh-derived GPU cloth | PRD-243 | A gust must deform the pinned flag enough to win | `GameState.gustDisplacement`, `GameState.outcome` |
| `softBodyCollision` existing-body adapter | PRD-243 | The deformed flag must not cross the wall | `GameState.collisionHeld`, `GameState.outcome` |
| `IComputeDriven` scene lifecycle | PRD-243 / PRD-242 | Reloading must release and rebuild the cloth | `GameState.attachments`, `GameState.releases` |

## Sharp edge found by the proof

Deterministic `waitTicks` can enqueue GPU work faster than an asynchronous readback promise lands.
The playtest therefore yields real render frames, then advances one deterministic tick to consume
the landed sample. It rejects samples issued before the gust instead of treating stale bytes as a
win or loss.
