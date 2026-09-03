# PRD-314 — A broken retarget is a number, not a screenshot

Status: DONE, 2026-08-31. Owner instruction; evidence in `docs/verification/PRD-314.md`.

## The problem, from a real game

`sandbox/threenative-hq` retargeted a Mixamo animation library onto an office rig this week and
shipped four defects that every automated gate in the repository passed:

1. The retarget wrote glTF rotation channels with the target path `quaternion` instead of
   `rotation`. `GLTFLoader` mapped the unknown path to `undefined`, every track loaded as
   `<bone>.undefined`, `AnimationMixer` bound none of them, and the whole cast played its bind
   pose. A human noticed the T-pose; nothing else did.
2. The retarget copied absolute world rotations between two rigs whose bind poses differ by 90
   degrees on every arm bone and 180 on the legs. Every limb pointed the right way while rolled
   about its own axis, which tears the skin into a smear. **A bone-direction check reports 0.0
   degrees of error on exactly this defect.**
3. The clips drove 22 of the rig's 65 bones. The other 43 held whatever the previous clip left
   them in, so a worker leaving a walk cycle kept the walk's hand shape forever.
4. A seated character's hips and hands did not demonstrably meet the chair and the keyboard.

Every one of those is a measurement the framework can take and no game should have to invent. The
game wrote a 150-line probe for the first three (`tools/verify-retarget.mjs`); the fourth was still
unanswered.

## What ships

Four functions in `@threenative/core`, all pure `three`, all diagnostic:

| Function | Answers |
| --- | --- |
| `clipPoseError(subject, reference, options?)` | how far a retargeted clip's pose is from its source, per bone, in degrees |
| `clipTrackBindings(root, clip)` | which tracks resolve to nothing on this character, by name |
| `clipBoneCoverage(root, clip)` | which bones the clip does not drive |
| `boneContact(root, boneName, target)` | how far a named bone is from the object it should be touching, in metres |

`clipPoseError` compares each bone's world rotation **relative to its own rig's bind pose**, as a
whole quaternion. Both halves of that sentence are load-bearing and are what a game gets wrong:

- The delta makes the two rigs' bind conventions cancel. An absolute comparison scores the
  skeleton difference forever and reports the same number for a fixed retarget and a broken one.
- The whole quaternion makes twist count. A direction comparison is blind to defect 2 by
  construction, which is why the unit test asserts the direction metric reads under 0.5 degrees on
  the same clip `clipPoseError` scores at 90.

## Which package, and why

`@threenative/core`, not `@threenative/playtest`. The dependency direction settles it: core depends
on playtest (`@threenative/core/playtest` imports `@threenative/playtest/three`), so nothing in
playtest can import `measureThreePose`, `posedBounds` or `skeletonBones` — and `boneContact` is
built on `measureThreePose`. Beyond that, these run inside a game (a registered entity's `debug()`,
a scene's own check) and inside an offline Node tool over `.glb` files; neither should pull a
package whose peer dependency is Playwright.

## The gate

- **Could the game write this portably itself?** Yes, and one did — badly, in one game, for three
  of the four checks. It is admitted as the test harness §5b already lists under what the framework
  may own, and under the rule that a mechanism one game writes more than twice is plumbing.
- **Does it decide how anything looks?** No. It selects no clip, moves no object, and has no
  geometry, material, colour, texture, curve or timing. It reports numbers and names.
- **Closed list.** Not an IR, scene format, editor, preset system, ECS or CLI vocabulary.
- **Vocabulary.** `AnimationClip`, `AnimationMixer`, `PropertyBinding`, `Skeleton`, `Bone`,
  `clipAction` — Three.js's own names, camelCase.
- **Kill switch.** 341 package lines against the one game's 150-line probe covering three of the
  four checks, one clip pair and one hard-coded bone map. Scored across the repetitions the rule
  requires — the same game needs the fourth check, and the next game needs all four — the package
  column wins. Rescored if a second game ever writes it smaller.
- **Web-only.** Not admitted for unportability, and portable anyway: no DOM, no WASM, no dynamic
  import. The unit suite executes it in Node with no browser at all.

## Acceptance, and the mutation that reverts each

1. `clipPoseError` scores a correct retarget at 0 degrees across a 90-degree bind-pose difference
   and the same clip's world-copy at 90. **Mutation:** compare the deltas' Y axes instead of the
   quaternions in `clip-audit.ts`; the roll test fails at 0.0000012 degrees.
2. `clipTrackBindings` names `<bone>.undefined` tracks with Three.js's own reason, without leaking
   a console error into the page. **Mutation:** report `bound` from node existence alone; three
   binding tests fail, reporting 4 of 4 misnamed tracks as bound.
3. `clipBoneCoverage` names undriven bones and counts a track that binds nothing as driving
   nothing.
4. `boneContact` reports metres and `inside`, and names the available bones when asked for one the
   rig does not have.
5. Two playtest scenarios over `examples/prd314-clip-audit`, one arm per outcome, both fail closed.
