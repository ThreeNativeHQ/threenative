# Optional perception and search gameplay

Editable game source using real Yuka Vision plus the existing world ray query, not a core AI framework.

```sh
cd examples/integrations/perception
npm install --ignore-scripts
npm test
```

```ts
const senses = new YukaPerception({
  body: enemy, forward: [0,0,-1], fieldOfView: Math.PI / 2, range: 30,
  memorySeconds: 5, arrivalDistance: 0.5,
  raycast: ({origin, direction, distance}) => nearestBlockingDistance(origin, direction, distance),
});
const decision = senses.update(dt, {id: 'player', object: player});
// Give decision.destination to the EXISTING navigation/CharacterBody movement path.
```

The ray callback returns the nearest blocking distance or null, never undefined. Exclude observer and target bodies from obstruction filtering. Yuka only answers the view cone; it does not own movement, navigation, physics or a clock. Hidden target positions are never passed into search policy. Memory retains a copied last-seen position and expires on simulation time or arrival. Zero dt pauses expiry. Invalid inputs fail before memory advances. Decisions are immutable. Call forget when a target is deleted and dispose on scene teardown.

The narrow yuka.d.ts declaration describes the real upstream exports; it is not a runtime mock. Integration tests invoke actual Yuka and actual Three raycasts against a wall.

Executed locally: 10 search-policy CPU tests passed after the initial failing run, plus strict TypeScript 5.8.3 checking of search.ts. Donor-backed tests/full build are written but unrun locally because downloads are unavailable. Integration perception runs npm test on PR changes. Playable navigation, native/browser proof and the direct-policy value comparison remain open. Generate/review the lockfile and test with the framework's patched runtime before admission.

Yuka and Three retain MIT notices as separate dependencies. No donor entity manager, game or assets are copied. Ordinary core-only games load none of this code.
