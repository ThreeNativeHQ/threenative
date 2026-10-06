# @threenative/procedural-animals

Optional bake-first wolf content. The build entry pins Procedural Animals at
`c95ae49346aa8e140a924376cec6cf0073d99512` and Node 20.19.6. Runtime imports contain
no generator, worker or Node dependency. Browser/Linux rendering and frame budgets
are still unqualified; see the owning PRD.

At build time, call `bakeWolfToFile({ seed: 7, tier: "crowd" }, destination)` from
`@threenative/procedural-animals/build`, then pass `animalBakePass()` to the normal
`@threenative/assets` compiler. High and crowd bakes share individual parameters.
Each source is validated before a same-directory atomic rename; the asset compiler
owns the hashed manifest. Timing statistics are excluded from deterministic bytes.

At runtime, `loadAnimalBake(ctx.assets, logicalPath, { signal })` resolves the cooked
file and validates the complete PANM payload before constructing resources. Limits:
64 MiB, 250,000 vertices, 1.5 million indices and 256 bones. Unknown revisions,
malformed offsets/indices, non-finite values and unnormalized weights fail by name.
The corruption checksum is not an authenticity signature.

`createAnimalActor(bake, { motion, material, ground })` owns instance geometry, pose,
bounds and lifetime. Supply editable game motion and a DQS material from `src/render/`.
Call `follow(acceptedState, dt)` in `afterPhysics`; accepted position/velocity and
heading are the only root authority. An identity parent is required. A named
`visualOriginOffset` accommodates centred physics capsules and remains reported.
Pause freezes the pose; teleport replaces motion history; disposal settles pending
actions and attempts every resource cleanup. The first action set is stand/sit/lie.

The example contains the pinned wolf's editable motion closure and a base-surface
TSL DQS material with normal/shadow skinning. Fur, fins, eyes, runtime generation,
other species and AnimationMixer/composer ownership are outside this slice.

The [pinned donor](https://github.com/majidmanzarpour/threejs-procedural-animals/tree/c95ae49346aa8e140a924376cec6cf0073d99512)
MIT notice is retained in `LICENSES/Procedural-Animals-MIT.txt`. Focused tests use
actual generation, the ordinary asset cook, real fixed-step Rapier, an independent
CPU DQS oracle and lifecycle fault controls. These are CPU evidence only.
