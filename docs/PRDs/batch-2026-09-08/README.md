# Tonight's batch — September 8, 2026

**Status: IN PROGRESS, owner order updated September 9.** Complete reliable measurement,
then appearance-preserving shader reduction. Consider a bounded native cache patch only if the
measured result warrants its maintenance. This folder is
the execution index; linked PRDs remain canonical in their owning folders, with
their existing acceptance criteria and shared contracts intact.

## Selected work

| Priority | Canonical PRD | Why tonight | First bounded outcome |
| --- | --- | --- | --- |
| 1 | [367 — Doctor explains shader compilation](../assets/PRD-367-doctor-explains-shader-compilation.md) | Supplies the common observation needed to prove the startup improvements below. | Phase 1: a complete real-town program/pipeline census, correlated to materials and passes, on browser and native desktop. |
| 2 | [369 — Material variation is data](../assets/PRD-369-material-variation-is-data.md) | Addresses first-install compilation without maintaining a native dependency patch. | After 367 attribution, prove one compatible material family inside the original Bayview town, with cache disabled and appearance preserved. |
| Conditional | [368 — Compiled pipelines survive a relaunch](../assets/PRD-368-compiled-pipelines-survive-a-relaunch.md) | Revisit if the graph result leaves worthwhile repeat-launch savings. | Desktop cache API round trip proven with a bounded version-pinned patch; next: reproducible dependency build, real host integration, app-private persistence and qualified Pixel pairs. No startup saving is established. |
| Separate | [196 — Complete public installation](../BLOCKED/requires-release-credentials/PRD-196-published-install-is-functional.md) | The installation/release lane remains independently owned. | Preserve its existing acceptance and release handoffs; it is outside this performance execution. |
| Stretch | [370 — Warm-up counts what the GPU creates](../assets/PRD-370-warmup-counts-what-the-gpu-creates.md) | Corrects the reported 494 pipelines versus 101 observed creations; useful accounting, but not itself a startup speedup. | After the observer stabilizes, separate candidate objects from observed programs/pipelines and prove unknown coverage cannot report completion. |

## Execution order and handoffs

1. **Freeze the subject.** The real town is
   `/home/joao/projects/threenative/sandbox/prd360-bayview-live`. Its source/assets are hashed before
   intervention. Resolve scenario, package/host identities and PRD-360 changes using the
   [asset startup contract](../assets/README.md). Wildwood evidence cannot replace this subject.
   The [cache feasibility record](../../verification/prd-368-feasibility-2026-09-09.md) retains the
   inspected API limitation; a source patch is a candidate, not a demonstrated cache route.
2. **Deliver the common observation.** Execute 367's phases in order. Real browser, desktop and
   Android checks exposed missing direct-device events, incompatible native/JS hashes and a live
   native completion gap. Repair these before accepting program totals. Opus medium implements
   bounded components; Codex reviews and coordinates builds. Use Wi-Fi ADB for the authorized
   phone, and qualify charging/thermal conditions before making physical timing claims.
3. **Implement and measure one material family.** Start 369 after its required attribution is
   available. Preserve the look and GPU frame-time budget. Freeze one integrated engine build
   before comparing independently hashed game arms. Only then decide whether 368 still pays for
   its maintenance; graph changes invalidate earlier cache identities.
4. **Spend remaining capacity on 370.** Reuse 367's collector and reconcile landed
   PRD-360 fixes. Do not create another observer or repeat rejected warm-up scheduling
   experiments. Reserve one owner for shared core/doctor files and one measurement
   subject at a time on the phone.
5. **End at an evidenced checkpoint.** Record completed phases, actual red/green,
   commands, artifacts and remaining acceptance in the canonical PRDs. Performance
   findings update the [runtime performance record](../../verification/runtime-perf-state.md).
   A useful night delivers accepted slices; it does not require declaring all five
   PRDs complete. Release/publication checkpoints remain those of the owning PRDs.

## Why these beat the alternatives

The [startup source summary](../assets/README.md) records approximately 10.9 seconds
to playable, including 8,513 ms creating 101 pipelines from 96 distinct programs.
That supports targeting actual compiler reuse and structural shader differences;
it does not establish that either proposed optimization will meet its timing bar.
PRD-367 makes that distinction measurable. The
[consumer assessment](../../verification/production-readiness-2026-09-08.md) grounds
196's separate install/toolchain priority. Historical evidence was read, not rerun.

PRD-361 is deferred: the [existing execution census](../../verification/batch-2026-09-05-execution.md)
found only eight directly replaceable executable lines, eleven including a clip
guard, with the aggregate code-size criterion unresolved. Shared-character setup
is not a clean high-return implementation lane until that decision is resolved.
PRD-362 already has partial implementation and pending device acceptance; keep its
follow-up separate from this startup batch. The full production-readiness release
chain is broader than one night; selecting 196 does not pull promotion, signing,
or every platform into this batch. Appearance features and multiplayer follow
these launch/install outcomes.

**Verification status:** The [current evidence](../../verification/runtime-perf-state.md#prd-367-actual-device-census-repair--2026-09-09)
records focused regression greens and passing real-game functional checks. Device completeness,
qualified timing and full implementation gates remain open. No startup improvement is claimed.

Next action (under two minutes): inspect the latest native and core census regression results.
