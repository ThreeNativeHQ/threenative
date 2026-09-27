# Find the right API

Look up which package and export covers the job you have, then read its types in the source for the
full options.

## Packages

A generated project installs a matching set for its template. Add others as your game needs them.

| Package | Provides | Used from |
| --- | --- | --- |
| `create-threenative` | Project templates and setup | `pnpm create threenative` |
| `@threenative/core` | Scenes, game loop, input, loading, rendering helpers | Game code |
| `@threenative/physics` | Rapier bodies, triggers and character movement | The `rapier()` plugin |
| `@threenative/assets` | Asset conversion and compression | The build |
| `@threenative/ui` | React components and UI hooks | The UI entry |
| `@threenative/playtest` | Scripted input and gameplay checks | Tests against a running build |
| `@threenative/runtime-native` | Native host and packaging | Desktop and Android builds |

## The scene context

A scene's `enter(ctx)` receives `ICtx`, which holds the scene's runtime tools. It can return a
per-frame function:

```ts
import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import { BoxGeometry, Mesh, MeshStandardMaterial } from "three";

export class Play extends Scene<GameState> {
  override enter(ctx: ICtx<GameState>): SceneFrame<GameState> {
    const box = ctx.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()));
    return (frame, dt) => {
      box.rotation.y += dt;
    };
  }
}
```

| Fields | Use them to |
| --- | --- |
| `scene`, `camera`, `add` | Place Three.js objects and frame the view. `add` returns the object with its type. |
| `renderer`, `viewport` | Reach render controls and screen size. `renderer.raw` is the underlying renderer. |
| `input`, `pointer`, `raycast`, `raycastAll` | Read actions and pick objects. Use physics queries for collision shapes. |
| `assets`, `startup` | Load files and track startup. `startup.hold()` keeps the loading screen up. |
| `state` | Hold game values that a separate UI reads. |
| `after`, `every`, `tween` | Schedule work and animate values. |
| `afterPhysics`, `beforeRender` | Follow solved bodies and adjust visuals before drawing. |
| `entities`, `goto`, `random` | Register entities, switch scenes and make seeded random choices. |

Use the same seed for `random` to repeat choices in a playtest.

## Reusable features

All of these export from `@threenative/core`.

| Job | Exports | Notes |
| --- | --- | --- |
| Animated characters | `AnimationPlayer`, `SkeletalMesh3D` | `SkeletalMesh3D` clones the skeleton, so each character poses on its own. |
| Many copies of one mesh | `InstancedBatch` | `add` or `place` each copy, then `build()` the `InstancedMesh`. |
| Merged static geometry | `mergeParts` | Keeps each part's colour. `preserve` keeps authored normals and UVs. |
| Dense static models | `ClusteredMesh`, `ClusteredBatch` | Use cluster data from the asset build. |
| Distance detail | `updateModelLods`, `baseGeometryOf` | Picks asset-built LODs. `baseGeometryOf` returns LOD0 for collision. |
| Visibility | `alwaysRender`, `MatrixWorldPass` | `alwaysRender` keeps a small object drawn at range. |
| Camera-facing objects | `Billboard3D` | Turns an object to face the camera when you call `update()`. |
| Camera shake | `CameraShake` | `update()` returns an offset. Apply it after your camera rig. |
| Sky | `Atmosphere`, `solarPosition` | The `minimal` template uses it on WebGPU only. |
| Sound | `AudioBus` | Loads and plays sounds and manages volume. Unlocks on first input. |
| GPU ray queries | `GPUSceneBVH` | Call `rebuild()` after the scene geometry changes. |
| Frame timing | `FrameBudget`, `SpanRecorder` | GPU timings appear when the platform provides timestamps. |

Physics nodes (`RigidBody3D`, `Area3D`, `CharacterBody3D`, `CollisionShape3D`) export from
`@threenative/physics`. See [Physics](physics.md).

## Read an API in the source

Start at a package's `src/index.ts` and follow the export to its file. The doc comment above each
export lists its options, constraints and an example. Your editor's completion shows the APIs in the
version you installed.

## Source

- [core index.ts](../../packages/core/src/index.ts)
- [scene.ts](../../packages/core/src/scene.ts)
- [ui index.ts](../../packages/ui/src/index.ts)
- [physics README](../../packages/physics/README.md)
