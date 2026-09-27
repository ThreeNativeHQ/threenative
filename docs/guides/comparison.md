# ThreeNative compared

How ThreeNative differs from Three.js alone, Godot, Unity and Unreal, and when a Three.js and
TypeScript team picks each one.

## At a glance

ThreeNative is a game framework on top of Three.js. You write TypeScript in your own editor and
keep Three.js materials, cameras, meshes and loaders. ThreeNative adds the game loop, input,
physics, asset builds, UI bindings, playtests and a native runtime.

| | ThreeNative | Three.js | Godot | Unity | Unreal Engine |
| --- | --- | --- | --- | --- | --- |
| What it is | Game framework on Three.js | 3D rendering library | Open-source engine and editor | Engine and editor | Engine and editor |
| You write | TypeScript in your editor | JavaScript or TypeScript | GDScript or C# in the editor, C/C++ via GDExtension | C# in the editor | Blueprints and C++ in the editor |
| Rendering | Three.js, with the render setup as project source | Three.js | Godot renderer | Unity renderer | Unreal renderer |
| Game systems | Loop, input, Rapier physics, UI hooks, playtests | Bring your own | Built in | Built in | Built in |
| Desktop and mobile | Native runtime for Windows, macOS, Linux, Android | Needs a separate native host | Engine export | Build profiles and platform modules | Engine packaging |

## Pick ThreeNative when

- Your game already runs on Three.js, or your team knows it well.
- You want game code in plain TypeScript files, reviewed and versioned like any other code, with
  npm packages available.
- You want one `src/game.ts` for the browser, desktop and Android. See
  [Native runtime](native-runtime.md) for platform support.
- You want to edit lighting, materials and post effects as source files in the project.
- You want a React HUD and automated [playtests](playtesting.md) against the running game.

## Pick something else when

- Three.js alone: you are building a 3D scene or visualisation, not a game, and ship only to the
  web.
- Godot: you want an integrated scene editor with its own scripting. ThreeNative physics borrows
  Godot names such as `CharacterBody3D` and `RigidBody3D`, but has no editor.
- Unity: your team works in C# and relies on the Unity editor and its platform tooling.
- Unreal Engine: you want its world-building and content tools, Blueprints and C++.
- Any of the three engines: you need to ship on iOS. ThreeNative does not support it yet.

## Vendor documentation

- [ThreeNative README](../../README.md)
- [Three.js: creating a scene](https://threejs.org/manual/pages/creating-a-scene.html)
- [Godot scripting languages](https://docs.godotengine.org/en/stable/getting_started/step_by_step/scripting_languages.html)
- [Unity platform development](https://docs.unity3d.com/Manual/PlatformSpecific.html)
- [Unreal tools and editors](https://dev.epicgames.com/documentation/en-us/unreal-engine/tools-and-editors-in-unreal-engine)
