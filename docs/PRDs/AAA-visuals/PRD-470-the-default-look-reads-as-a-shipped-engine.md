# PRD-470 — the default look reads as a shipped engine

**Status: PHASE 1 NEARLY DONE** · filed 2026-09-28 against `3788ce79e` · owner goal: "make it look like
Unreal by default — AAA, 'wow, this looks polished'; baseline assets allowed if the library does not
grow much."

## Why

Measured at `3788ce79e` (headed WebGPU, RTX 2080, 1280×720, scaffolded from local tarballs):

- `minimal`: a floating slab in a grey-blue void, a faceted dim sky, black box "mountains". No
  image-based light, no ambient occlusion, no antialiasing.
- `starter`: washed-out pastel painterly pass (kuwahara + watercolor + outline) over flat colours.
- Every template: the post chain renders `pass(scene, camera)` **single-sampled**, so as soon as any
  stage runs, the renderer's MSAA no longer reaches the frame — every edge is aliased. No template
  sets `scene.environment`, so every `MeshStandardMaterial` has no specular environment at all and
  reads as matte plastic. Every sky is a hand-rolled vertex-colour dome.

What makes the Unreal first frame read as "polished" is a short list, all of it available in
`three@0.185.1` and none of it an asset: a physical sky with a sun disk, the same sky as the image
light on every surface, soft sun shadows with contact occlusion, clean antialiased edges, a filmic
tone curve with bloom, and distance fading into the sky rather than into a void.

## Where it goes

All of it decides how things look, so it ships as generated source in `templates/*/src/render/`
(rule 1b). The one shared file, `worldEnvironment.ts`, gains an antialiasing stage so every template
gets clean edges from the same code. No new package, no new dependency, no new asset bytes.

## Phases

### Phase 1 — `minimal` becomes the reference frame, and every chain antialiases

- [x] A photo sky (Poly Haven, CC0, 4k JPEG 282 KB) is the background, the environment light and the fog colour; the sun is aimed at the photographed sun. proof: `sky` scenario pass (tt-minimal2, 2026-09-28); capture `minimal-08-ground-bounce.png`
- [x] A UE-style test arena: light/dark metre-grid materials with world-metre UVs, bevelled walls/deck/ramp/pillar, blue crates, trimesh colliders via `buildStaticColliders`; Quaternius mannequin (CC0, 665 KB) with a follow camera; camera-centred `VirtualShadowNode` on WebGPU. proof: captures `minimal-06..08`; `TN_VIRTUAL_SHADOW` reuse 0.997
- [x] `worldEnvironment.ts` antialiases (SMAA, Godot `screen_space_aa`) whenever a chain is installed and reports it; GTAO is denoised; shared-source specs updated. proof: `pnpm exec vitest run packages/create-threenative` 777/777 (2026-09-28)
- [ ] `minimal` playtests green. proof: `TN_TEMPLATE_ONLY=minimal pnpm test:templates`
  sky, survives, touch-controls pass; `play` re-measured at 104 draws / 69,930 tris (virtual shadow levels), budget raised to 128 / 80,000 — rerun pending.

### Phase 2 — `starter`, the default template, gets the same light

- [ ] Photo sky + environment light + AO + AA + mannequin hero; painterly stages off by default, still one line away. proof: capture
- [ ] `starter` playtests green. proof: `TN_TEMPLATE_ONLY=starter pnpm test:templates`

### Phase 3 — the other templates inherit the recipe

- [ ] `shooter` rebuilt from the sandbox `fps-framework` game: its hands kept, every other asset replaced by the shared mannequin, arena and sky. proof: `TN_TEMPLATE_ONLY=shooter pnpm test:templates`
- [ ] The remaining templates take the environment light and AO; all template playtests green. proof: `pnpm test:templates`

A fresh judge subagent compares blind before/after captures per phase; its verdicts go in the PR
body, not here (R2).

## Decisions

- Photo sky from Poly Haven instead of the procedural atmosphere: "skybox should be from polyhaven" — owner, 2026-09-28.
- `minimal` is the Unreal third-person test map (grid arena, mannequin, follow camera), and the SCORE/TIME HUD is removed — owner, 2026-09-28.
- The mannequin is Quaternius' Universal Animation Library, recoloured white — owner, 2026-09-28.
- `shooter` is rebuilt from `sandbox/fps-framework`, keeping only its hands — owner, 2026-09-28.
- The AstraCraft RTS template is its own PRD and PR, not this one — agent, 2026-09-28 (one PRD per PR).
- Engine fix found on the way: `CollisionShape3D.fromMesh` centres its box on the mesh origin, so off-centre geometry silently gets a displaced collider (it floated the mannequin 0.4 m). The template now uses `buildStaticColliders`; the engine guard is tracked as its own change.

## Blocked on

- Native desktop proof of PMREM environment light — `pnpm native:build` lane; run before merge.
