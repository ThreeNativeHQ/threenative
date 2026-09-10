# Creating an animated creature through the asset MCP

Use this recipe when the game needs a bespoke, animated creature. The asset MCP owns the
packaged anyCreature compiler and local preview/check tools; the game owns the authored spec,
claims, render source, cook and playback. Do not add anyCreature to `src/` or the player bundle.

## 1. Choose the input route

For a conventional model, use `finding-assets.md`. For a supplied reference image, first follow
`sculpt-from-a-reference.md`: record the reference credit, inventory its recognizable regions and
decide which details are geometry. Then translate that brief into a creature spec. The creature
tools accept JSON, not an image, and a successful compile is not proof that the result resembles a
reference.

For a thin request such as “a dragon”, call `creature_guide` with `section: "overview"` and ask
the single direction question described there. Freeze one identity, one signature part, one
exaggeration, the mass hierarchy, the two focal parts, the stance, the value plan and the attack
before writing geometry. A specific request still needs one winner when several parts compete for
attention.

## 2. Check the installed tools

Start the MCP session from the game root. It reads `.mcp.json` from the launch directory. Put the
project-local directory in place before starting or restarting the server:

```text
.threenative/creatures/
```

Call:

```json
// creature_status
{}
```

Then call `creature_guide` for `overview`, `syntax`, and the stage you are entering. The guide
returned by the pinned server is the authority for supported spec fields and current limits; do
not copy a wolf example's coordinates or invent fields from memory.

`creature_status` separates the fixed compiler from optional render dependencies:

- Compiler availability is enough for a compile-only loop. It needs no Python, Chromium, account,
  LLM key, setup script or runtime download.
- Silhouettes need either the reported Python outline backend or the reported Chromium fallback.
- Hero images and browser claims measurement need Chromium. A missing optional dependency is an
  actionable unavailable result, not visual approval.

If `creature_compile`, `creature_preview` or `creature_check` is unavailable because the launch
root has no `.threenative` directory, create it and restart the MCP. Keep the server's paths
project-relative; never pass an absolute path, executable, URL or custom working directory.

## 3. Author two editable files

Keep the source of truth under `.threenative/creatures/`:

```text
.threenative/creatures/wyvern.json
.threenative/creatures/wyvern-claims.json
```

The first file is the anyCreature spec. Use `creature_guide` with `section: "syntax"` for the
complete language. At minimum, author the metre `height`, a nonempty `palette`, named `joints`,
`chains`, `volumes` with `chain` and `material`, and all three animations. A wing or other
membrane, a conspicuous jaw/horn, and an articulated tail should be authored as the parts they
are, not as unrelated straight spikes. Keep the bind pose planted and include a forward-
committing `attack`.

The claims file is also ordinary JSON and must have a nonempty `claims` array. Replace every
placeholder with names and materials in the spec:

```json
{
  "name": "wyvern",
  "claims": [
    {
      "type": "part_exists",
      "part": "wing_skin",
      "stage": "MID",
      "enforce": "block",
      "when": "verify"
    },
    {
      "type": "part_signature",
      "part": "wing_skin",
      "view": "side",
      "min_share": 0.12,
      "or_min_span": 0.1,
      "stage": "MID",
      "enforce": "advise",
      "when": "allocate"
    },
    {
      "type": "rig_skinned",
      "stage": "HIGH",
      "enforce": "block",
      "when": "verify"
    },
    {
      "type": "anim_named",
      "names": ["idle", "move", "attack"],
      "stage": "HIGH",
      "enforce": "block",
      "when": "verify"
    },
    {
      "type": "tri_budget",
      "min": 400,
      "max": 9000,
      "stage": "LOW",
      "enforce": "advise",
      "when": "allocate"
    }
  ]
}
```

Claims are measurements, not permission to skip a visual review. `stage` is exactly `LOW`,
`MID` or `HIGH`; `enforce` is `block` or `advise`; `when` is `allocate` or `verify`. An unknown
claim, empty stage after filtering, missing required observation or non-finite value fails closed.
Use the current `creature_guide` claims section for the complete claim-type field list.

## 4. Compile into the normal asset source

Read the game's asset configuration and pass an explicit output path under its source asset
directory, normally `assets/creatures/`. Do not put generated source in `public/`, and do not use
the MCP's provider download directory as a creature default.

```json
// creature_compile
{
  "specPath": ".threenative/creatures/wyvern.json",
  "outputPath": "assets/creatures/wyvern.glb"
}
```

The successful result is the record for this round: retain its `inputSha256`, `outputSha256`,
`checksSha256`, measurements, clip names, diagnostics path, checks path, source snapshot path and
receipt path. Read compiler diagnostics, including warnings, before deciding what to revise. The
MCP validates the emitted GLB and publishes it atomically; a blocked or failed revision must not
replace the last good file. When revising an existing output, pass its last known
`expectedOutputSha256` so a stale writer returns `OUTPUT_CONFLICT` instead of overwriting newer
work. Edit the JSON spec, never the generated GLB.

## 5. Inspect, preview and review each round

After a successful compile, inspect actual bytes before judging the look:

```json
// creature_check — structural
{
  "glbPath": "assets/creatures/wyvern.glb",
  "mode": "structural"
}
```

Confirm the returned measurements include reachable skin bindings, materials, bounds and clip
details. A structural pass still returns `visualReview: "notReviewed"`.

Request fresh images from the same compiled GLB:

```json
// creature_preview — silhouettes
{
  "glbPath": "assets/creatures/wyvern.glb",
  "mode": "silhouettes"
}
```

For a colour/lighting view, call the same tool with `"mode": "hero"`. The result names the
backend, native view names, camera and resolution, preview ID, artifact paths and hashes. Inspect
the actual images for the identity, signature part, tail, jaw/horn, planted stance and readable
value hierarchy. The MCP never grades its own images: `visualReview` remains `notReviewed`.

Record one small round note beside the returned artifacts: the spec hash, GLB hash, backend,
what changed, what the independent visual reviewer saw, and the next edit. Do not overwrite a
previous round's receipt, claims metrics or preview. A comparison using `previousPreviewId` is
valid only when the server reports matching backend, cameras and resolutions; a backend switch
requires a new baseline.

Run claims by stage, keeping the output for each stage:

```json
// creature_check — LOW, then MID, then HIGH
{
  "glbPath": "assets/creatures/wyvern.glb",
  "mode": "claims",
  "claimsPath": ".threenative/creatures/wyvern-claims.json",
  "stage": "HIGH"
}
```

Run LOW and MID while allocating big forms, then HIGH after colour and animation are authored.
Treat `advise` as measured feedback and `block` as a required fix. A passing claim response is
not a substitute for an independent human or host-side visual review.

## 6. Deliver it to the game

Delivery requires all three real clips: `idle`, `move`, and `attack`. HIGH must find nonempty
tracks bound to the actual loaded rig, and `attack` must commit toward the space in front of the
body. Do not rename a missing clip in the game or claim success from a spec field alone.

Use the existing asset cook and loader. The source GLB stays under `assets/`; let the normal build
produce its cooked output, then load it through the same path as every other model. In the
existing scene, use `SkeletalMesh3D` and `AnimationPlayer` (search the engine capability manifest
first), set the authored body as `strideRoot` when the scene needs locomotion, and use the measured
height rather than a universal scale workaround. Play `idle -> move -> attack` in the game and
assert visible geometry, expected size, skin deformation, bound animation tracks and stable bone
lengths on every target you claim.

The final artifact is complete only after both machine results and independent visual review are
recorded. If Python or Chromium is unavailable, report a compile-only or structural result and
leave preview/claims delivery outstanding; never turn an unavailable optional tool into approval.
If the target is browser and native, run the same consumer scenario on both. Android and iOS stay
unclaimed unless their own playtests execute.
