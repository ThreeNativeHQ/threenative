# AGENTS.md — threenative-sandbox

This is the vanilla arm of the benchmark. Build the game described in `brief.md` and match `reference.png`. Use plain Three.js for rendering and gameplay. You may install any npm package you choose, including a physics engine.

The only ThreeNative package available is the observation bridge. Install it after your scene, camera, renderer, and entities exist. Tick-driven proof scenarios require all five provider hooks:

```ts
import { installThreePlaytestBridge } from "@threenative/playtest/three";

installThreePlaytestBridge({
  camera,
  diagnostics: () => [],
  entities,
  fixedStep: (ticks) => {
    for (let index = 0; index < ticks; index += 1) tick();
  },
  gameplay: () => ({
    animation: { player: { clip: "idle", advancedFrames: 1 } },
    states: { player: "idle", mission: "playing" },
  }),
  renderer,
  resources: { read: () => ({ state: { ...state } }) },
  scene,
});
```

`fixedStep` advances the simulation once per requested tick. `diagnostics` returns current runtime diagnostics. `gameplay` must return both `animation` and `states` records when the proof asks for runtime animation or state assertions. `resources.read()` must expose the generic resource id `state` with the current serializable game state. Do not edit or copy the sealed proof scenarios; the sweep runner supplies them at test time.
