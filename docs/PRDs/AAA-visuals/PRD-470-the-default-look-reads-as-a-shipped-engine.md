# PRD-470 — the default look reads as a shipped engine

**Status: IN PROGRESS** · filed 2026-09-28 against `3788ce79e` · owner goal: "make it look like
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

- [ ] Physical sky (`SkyMesh`) with a sun disk; the same sky baked once through PMREM into `scene.environment`. proof: capture + `TN_WORLD_ENVIRONMENT`
- [ ] A horizon: ground plane to the fog line, world-aligned grid material, haze in the sky's horizon colour; bevelled neutral-PBR props. proof: capture
- [ ] `worldEnvironment.ts` antialiases whenever a chain is installed and reports it; shared-source specs updated. proof: `pnpm exec vitest run packages/create-threenative`
- [ ] `minimal` playtests green with AO + AA on high tier. proof: `pnpm test:templates` (minimal)

### Phase 2 — `starter`, the default template, gets the same light

- [ ] Physical sky + environment light + AO + AA; painterly stages off by default, still one line away. proof: capture
- [ ] `starter` playtests green. proof: `pnpm test:templates` (starter)

### Phase 3 — the other eight templates inherit the recipe

- [ ] Environment light from each template's own sky, AO on high tier. proof: captures in PR body
- [ ] All template playtests green. proof: `pnpm test:templates`

A fresh judge subagent compares blind before/after captures per phase; its verdicts go in the PR
body, not here (R2).

## Blocked on

- Native desktop proof of PMREM environment light — `pnpm native:build` lane; run before merge.
