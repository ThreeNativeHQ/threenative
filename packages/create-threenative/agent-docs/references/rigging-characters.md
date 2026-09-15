# Rigging characters — the full MCP tool loop

Companion to the humanoid paragraph in `finding-assets.md`. Reach for these tools when a game
needs a rigged character or extra motion on an existing one. The model choice, clip selection,
material changes and intentional motion adjustments stay authored game data; the tools only
produce the GLB.

AETHER / 02 is the pinned default sample: an 18-bone humanoid with 11 clips, five materials, both
UV sets, tangents and two material extensions. `SkeletalMesh3D` loads it and its `hand.R` is the
weapon attachment bone. It is CC0, and was built from a 14-unit source robot, so its source size
is preserved unless a game explicitly authors a `SkeletalMesh3D.size` override.

## 1. Inspect before deciding

`asset_inspect_rig` takes a local GLB path, or `{ "sourceId": "aether-02" }` to acquire the pinned
sample into the development cache, plus optional local UAL ZIP/GLB libraries. It reports meshes,
joints, suggested bone-role mappings with ambiguity, attribute and extension support, measured
bounds, clips, and the actual attachment candidates. It never downloads the animation libraries;
supply local archives or select release donors by clip id.

## 2. Preserve or fit a rig

`asset_auto_rig` preserves an existing valid rig by default. For an unrigged upright biped it fits
an 18-joint skeleton from measured geometry, then binds smooth (up to four normalized influences)
or rigid (one bone per connected mechanical region) weights and publishes the skinned GLB under the
project root. When the anatomy is ambiguous — arms joined to the torso, legs not separated — it
returns a correction request with the measured landmarks instead of a bad rig; pass corrected
`overrides` and call it again. Replacing a real rig requires `replaceRig: true`.

## 3. Select and retarget motion

`asset_retarget_animations` fetches only the donor clips you select from the pinned release and
bakes them onto the target: `{ "id": "ual1/Walk_Loop", "variant": "in_place" }`. In-place is the
normal game-controlled locomotion output; root motion explicitly uses the matching `root_motion`
variant. New clips keep their namespace (`ual1/Walk_Loop`) so an existing `Walk` is never
overwritten. Existing target clips survive unless you pass `keepExistingClips: false` for a
game-minimal export. Target materials, UVs, tangents and extensions are preserved.

## 4. Confirm with a contact sheet

`asset_preview_animation` renders a prepared GLB from two to six angles with an optional clip time
or an explicit bone pose, and publishes a nonblank contact sheet under the project root. A missing
rendering backend returns an explicit `unavailable` result; a blank frame fails. Inspect the sheet
before delivery — a valid animation container alone is not approval.

## 5. Cook and play

Load the prepared GLB the ordinary way and play clips with `SkeletalMesh3D` and its update loop.
Attach a game-authored weapon with `attachToBone(character.root, "hand.R", weapon)`. Credit the
source and keep its license notice with the asset; the donor libraries are CC0, and the pinned
clips are fetched once into the development cache on first use, then reused offline.
