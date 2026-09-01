---
name: threenative-capabilities
description: Discover and use the ThreeNative capability surface before writing a game system.
---

# ThreeNative capabilities

This is a critical planning prerequisite. Use it before `prd-creator` drafts a plan, and before
replacing any world, traversal, interaction, simulation, combat, camera, audio, UI, entity,
movement, navigation, attachment, particle, terrain, or measurement system.

1. Infer the concrete mechanics from the request. Preserve its distinctive fantasy with the
   smallest characteristic loop; ask one short question only when two core loops remain equally
   plausible.
2. Search the full request with `engine_search_capabilities` using `scope: "request"`, then search
   every mechanic with `scope: "mechanic"`. Check each returned `matchedSituation`.
3. Record a capability or no-match for every mechanic before writing a replacement. Describe
   situations plainly, such as *"enemy walks around a wall"*.
4. Hand the recorded matches, inspected constraints, and no-matches to `prd-creator`; the PRD must
   plan against this actual engine surface.

The manifest is the complete public surface; grep misses subpath exports such as
`@threenative/physics/navigation`. If MCP is unavailable after `npx threenative doctor`, use
`agent-docs/capability-reference.md` and repeat the full-request plus per-mechanic pass manually.
Returned constraints are binding: import navigation from its returned subpath, use `attachToBone`
for held weapons (add a portable `Bone` named `RightHand` when needed), and never invent platform
support. One game rewrote 446 installed lines and ran at 9 FPS; discovery prevents that.
