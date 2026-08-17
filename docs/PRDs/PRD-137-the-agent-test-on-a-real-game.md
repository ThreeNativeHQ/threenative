---
prd_contract: v1
---

# PRD-137 — The agent test, run once on a game that already shipped

**Status:** PROPOSED, 2026-08-17. Nothing below has executed.

**Outcome:** the first paired build in this repository whose reference is a real game rather than a
generated brief, run by two agents that have never read this repository, scored on the number that
now sits at the top of `METRICS.md` — **friction rows per cold-agent build**.

**Depends on:** the requirements capture at
`fps-legacy-requirements.md` (§1), which must be complete before §2 seals anything.

**Blocks:** nothing. It supersedes nothing. It does, however, settle what
[PRD-080](./BLOCKED/requires-external-person/PRD-080-five-minute-stranger-test.md) is for — see §8.

**Complexity: 7 → HIGH mode, operator-run.** Two cold builds, a sealed corpus addition, a blind
judging pass, and a set of validity controls that are the actual subject of the PRD.

**Blast radius: additive.** One new genre directory, one new evidence file, one PRD lifecycle
change. No package source is touched by this PRD; anything the experiment *finds* becomes its own
PRD in the next round.

---

## 0. Why this exists, in one paragraph

`METRICS.md` was re-pointed on 2026-08-17: the framework's decisive experiment is a cold agent
building from the published packages, and the number is friction rows trending down. That
experiment has never been run. `docs/verification/adopter-pilot-2026-08-14.md` is the closest
attempt and it opens by disqualifying itself — *"the subject was an agent that has read this
repository"*. Every genre brief in the corpus was also written by us, for us, which means no build
has ever been measured against a game somebody actually shipped. This PRD fixes both at once by
rebuilding `~/projects/threejs-to-bevy/starters/fps-kit-arena-starter` — a working FPS, 2,444 LOC
of gameplay source, with real GLB assets and its own final screenshot.

**Reliability is the deliverable.** A result nobody trusts costs more than no result, and this
repository is downstream of a harness that reported pass while asserting nothing. Section 3 is the
longest section for that reason.

## 1. Input — the requirements capture

A read-only agent reads the legacy starter and writes a complete functional specification:
player, weapon, enemy state machine, arena, win/lose, asset manifest, visual target, and eight to
twelve candidate observable assertions. Every numeric constant carries a `file:line` citation or
the words *not found in source*.

That file is an **input to this PRD, not evidence for it.** It is written by an agent that read the
legacy repository, which is fine — the legacy repository is the subject, not ThreeNative.

## 2. Seal the genre before anything is built

Create `docs/benchmark/genres/fps/`, matching the six existing genres exactly:

| File | Source |
| --- | --- |
| `brief.md` | written from §1, describing **the game**, never an implementation |
| `reference.png` | `fps-final-local-runtime.png` from the legacy repository, copied unmodified |
| `proof/fps-*.playtest.json` | two scenarios chosen from §1's candidate assertions |

Then seal:

```sh
sha256sum docs/benchmark/genres/fps/brief.md docs/benchmark/genres/fps/reference.png
pnpm tsx -e "import {sealedProofHash} from './scripts/make-sandbox.ts'; console.log(sealedProofHash(process.cwd(),'fps'))"
```

The four hashes go into the evidence file **before either arm starts**, and are re-checked after
both finish. `scripts/make-sandbox.ts` already refuses an unknown genre, a missing brief and a
missing reference image, so a half-built genre cannot be built against.

**The brief is written by someone who will not build either arm.** Whoever writes it has read the
legacy source and cannot be a builder without carrying that knowledge across.

### 2.1 The proof scenarios must be framework-neutral

Both arms run the same two scenarios. A scenario that names a ThreeNative export, a node class, or
`world.*` state only ThreeNative populates hands the framework arm a free pass. Phrase every
assertion as an observable fact about game state after a described input sequence — the vanilla arm
installs the same bridge with `installThreePlaytestBridge`, so the assertions must be satisfiable
by any Three.js game that behaves correctly.

## 3. Threats to validity, and the control for each

This is the section to argue with. Each row is a way the result could be wrong, and the thing that
stops it.

| # | Threat | Control | Verifiable how |
| --- | --- | --- | --- |
| 1 | **Builder contamination.** An agent that has read `packages/` skips the friction the test exists to find | Both arms are fresh sessions with no access to this repository. `pnpm sandbox --bare` removes the files from disk; a fresh session removes them from context | The sandbox path is outside this repo, and the builder's transcript is archived |
| 2 | **The bar moves to meet the result.** Brief or proof edited after seeing a build | Four hashes recorded before either arm starts, re-checked after both finish | Hashes in the evidence file, twice |
| 3 | **Asymmetric information.** One arm gets a better prompt | Both arms receive the byte-identical brief, asset folder, proof, and tool-call budget. The launching prompts differ only in the scaffold step | Diff the two prompts and paste it |
| 4 | **Judge bias.** The critic knows which arm it is scoring | Fresh read-only critic, samples shuffled, arm identity never in context — the round-9 procedure | `judge.json` contains no arm labels |
| 5 | **The visual instrument cannot resolve the change.** PRD-126 found an untouched build moving a full point between raters | **State the noise floor in the result or do not report a visual verdict.** Two raters minimum, or the visual column is recorded as *unresolved* rather than as a win or a loss | Two independent rater outputs, or an explicit "unresolved" |
| 6 | **Capture asymmetry.** One arm rendered on SwiftShader | Same recipe both arms, headed, under `sh scripts/xvfb.sh`, `--enable-features=Vulkan`. Adapter read by field name — `JSON.stringify` on `GPUAdapterInfo` returns `{}` | `adapter.vendor` and `adapter.architecture` quoted per arm; `swiftshader` voids the run |
| 7 | **Off-instrument work uncounted.** Round 9: both arms hand-wrote a screenshot harness, 151 lines against 70, counted for neither | Either ship the same harness to both arms in the sandbox, or count both and report them beside the LOC delta. **Do not silently exclude it again** | The harness LOC appears in the ledger for both arms |
| 8 | **The archive destroys the evidence.** `sweep-archive.ts` `copyAppShell` copies root files plus `public/` and `assets/` only; round 9 lost 27 iteration screenshots including a final hero shot | Verify the archive preserves the builders' own directories **before** either arm starts, or salvage by hand and say so. Each arm also commits and pushes its own folder to `ThreeNativeHQ/examples` as it builds, so the working tree survives the archive independently | `ls` the archive against the live game folder, pasted, plus the pushed commits |
| 9 | **n = 1.** One build per arm is an anecdote | Not solvable at this budget. **Report it as n=1 in the result's first line** and never quote the delta as a rate | The sentence is in the evidence file |
| 10 | **Budget asymmetry.** One arm simply worked longer | Identical tool-call cap, stated in both prompts. An arm that hits the cap is recorded as hitting it, not extended | Final tool-call count per arm |

Threat 5 is the one most likely to void this experiment. Round 10 already measured the visual
instrument and found five of seven deltas inside its own noise. **If two raters are not available,
the visual column does not get a verdict** — the friction and cost columns still stand, and that is
an acceptable outcome. Reporting a visual win from one rater would be the exact failure this
repository exists downstream of.

## 4. The two arms

| Arm | Scaffold | Gets |
| --- | --- | --- |
| framework | `./scaffold.sh fps-framework` from the bare sandbox | published `@threenative/*`, the generated `AGENTS.md` |
| vanilla | `--name fps-vanilla`: plain `three` + Vite, no ThreeNative packages except `@threenative/playtest` for the proof | `installThreePlaytestBridge` and nothing else |

Each arm owns `../sandbox/<name>/` and nothing else. Every `pnpm sandbox` run rebuilds and re-packs
the framework packages first, so an arm always installs the framework as of that moment rather than
a stale tarball from the previous run.

The vanilla arm getting the playtest bridge is deliberate and is the existing protocol: it hands
the control our strongest asset on purpose, so a framework win cannot come from the harness.

Both arms receive `assets/` copied verbatim from the legacy starter — the same GLBs, textures and
sky. **Loading them is part of what is being measured.**

## 5. What comes back

| Output | Instrument |
| --- | --- |
| **Friction rows per arm**, each with the API, what blocked it, the workaround, and evidence | the builder's own ledger, written during the build |
| Sealed proof passed / total | `pnpm sweep:proof` |
| Tool call at which the first line of game code was written | manual count of the archived transcript |
| Authored LOC, final LOC, files, reach rate | `pnpm sweep:measure`, `pnpm sweep:pair` |
| Visual score, blind | `pnpm sweep:judge` — subject to threat 5 |
| Legacy comparison | the legacy starter is 2,444 LOC of `src/scripts/*.ts`; a third data point, reported, not scored |

**Friction rows are the primary outcome.** Everything else is context for them. A build that ships
nothing but returns twenty well-evidenced friction rows is a successful run of this experiment.

## 6. Acceptance

| # | Command or step | Required result |
| --- | --- | --- |
| 1 | §1 requirements file exists, every constant cited or marked *not found* | pasted section list |
| 2 | `docs/benchmark/genres/fps/` complete; four hashes recorded | hashes in the evidence file |
| 3 | `pnpm sandbox --bare --genre fps --name fps-framework` and `--name fps-vanilla` | each exits `0` and writes only its own `../sandbox/<name>/`; refuses before §2 is complete, and the second run leaves the first arm's folder untouched |
| 4 | framework arm, cold session, capped budget | ledger written, transcript archived |
| 5 | vanilla arm, cold session, same cap | ledger written, transcript archived |
| 6 | `pnpm sweep:proof` on both archives | pass/total recorded per arm, same sealed hash |
| 7 | `pnpm sweep:pair` | exits `0`; the authored-LOC delta pasted verbatim |
| 8 | `pnpm sweep:judge` | blind; **or** the visual column recorded *unresolved* per threat 5 |
| 9 | the four hashes re-checked | identical to step 2 |
| 10 | every row of §3 answered in the evidence file | including the ones whose answer is "not controlled" |

Step 10 is the acceptance criterion that matters. A row of §3 with no answer means the experiment
did not run reliably, whatever the other nine steps returned.

Evidence: `docs/verification/agent-test-fps-2026-08-<dd>.md`.

## 7. What this does not claim

Not mobile, not iOS, not performance — both arms are browser builds on this host and no device is
involved. Not that the friction count is comparable to any earlier round: no previous sweep tracked
it as the primary outcome, so this run establishes the series rather than continuing it. Not a
verdict on whether ThreeNative is good for agents — one genre, one reference, n=1 per arm. And not
a claim about the legacy framework, which is quoted for scale and never scored.

## 8. What happens to PRD-080

[PRD-080](./BLOCKED/requires-external-person/PRD-080-five-minute-stranger-test.md) is the
five-minute stranger test, parked under `requires-external-person/`. It stays there and it stays
open. What changes is what it grades: **the game, which means the templates — not the framework.**
`METRICS.md` no longer routes any framework result through it.

The folder is still correct. A test that needs an external person and does not have one is blocked
on a named external dependency, which is exactly what that folder is for. Moving it would be
paperwork. Leaving it while pretending it is still the north star was the problem, and §0 fixed
that.
