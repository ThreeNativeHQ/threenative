### Before you write a system, ask what already exists

You have `engine_search_capabilities`. Discovery is required before planning:

1. Infer concrete mechanics from the request: world, traversal, interaction, simulation, combat,
   camera, audio, and UI. Preserve its distinctive fantasy with the smallest loop using its
   characteristic setting or traversal—not a generic game with themed props. Search implied
   mechanics even when the user omits engine terms. Ask one short question only when two core loops
   remain equally plausible.
2. Search the full mechanical request with `scope: "request"`, then every mechanic with
   `scope: "mechanic"`. Check each returned `matchedSituation`.
3. Before writing replacements, record a capability or no-match for every mechanic.

Repeat before writing entity, movement, navigation, attachment, audio, particle, simulation,
terrain, or measurement systems. Describe situations plainly: *"enemy walks around a wall"*.

The manifest is the complete public surface; grep misses unused subpath exports such as
`@threenative/physics/navigation`. If MCP is unavailable, run doctor and search
`agent-docs/capability-reference.md` per mechanic.

Constraints are binding. Import navigation symbols from the returned subpath. Use `attachToBone`
for held weapons; if needed, add a portable Three.js `Bone` named `RightHand` first. Capability
detail governs platform support: never invent limits it does not report. Reject only for a reported
constraint or a contract that does not fit.

This prevents reimplementing installed systems; one game did so in 446 lines and ran at 9 FPS.

## When the framework blocks you, write plain Three.js

For browser, blank-frame, device, or import failures, first run `npx threenative doctor` and
`npx @threenative/playtest doctor`. They separate project/machine failures from engine bugs. For a
running game that looks wrong, inspect it:

```sh
npx @threenative/playtest doctor --url http://127.0.0.1:5173 --text
```

This reports visibility, scale, draw cost, frame rate, advancing state, and errors. Missing output
means unobserved, never zero.

When an `@threenative/*` API is broken, missing, or does not do what you need, implement only that
piece with portable Three.js/plain code and continue:

1. Keep the existing loop, scenes, input, registry, and playtest bridge.
2. Avoid `document`, `window`, `localStorage`, dynamic `import()`, and raw physics handles.
3. **Report what blocked you**: API, expectation, result, and replacement.

Never stall on a framework bug.

### Where the long recipes live

Open the relevant shipped recipe when needed:

- `agent-docs/finding-assets.md` — asset search, licenses, downloads, and archives.
- `agent-docs/sculpt-from-a-reference.md` — sculpt gates and branches.
- `agent-docs/webview-ui.md` — UI state, intents, and hit regions.
- `agent-docs/capture-the-frame.md` — WebGPU screenshots.
- `agent-docs/ctx-cookbook.md` — raycasts, rebuilds, and seeded randomness.
- `agent-docs/gameplay-recipes.md` — movement, gamepads, and physics timing.
- `agent-docs/visual-baseline.md` — generated render-source conventions.
