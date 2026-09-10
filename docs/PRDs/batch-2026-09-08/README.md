# Tonight's batch — September 8, 2026

**Status: SELECTED, not started by this batch.** Prioritize repeat-launch caching,
first-launch shader reduction, and a working consumer installation. This folder is
the execution index; linked PRDs remain canonical in their owning folders, with
their existing acceptance criteria and shared contracts intact.

## Selected work

| Priority | Canonical PRD | Why tonight | First bounded outcome |
| --- | --- | --- | --- |
| 1 | [367 — Doctor explains shader compilation](../assets/PRD-367-doctor-explains-shader-compilation.md) | Supplies the common observation needed to prove the startup improvements below. | Phase 1: a complete real-town program/pipeline census, correlated to materials and passes, on browser and native desktop. |
| 2 | [368 — Compiled pipelines survive a relaunch](../BLOCKED/requires-pipeline-cache-api/PRD-368-compiled-pipelines-survive-a-relaunch.md) | Owner-suggested priority; attacks the measured 8,513 ms of pipeline creation on compatible relaunches. | First prove the selected native C API and binary can create, serialize and reuse a real pipeline. Only then implement persistence. |
| 3 | [196 — Complete public installation](../BLOCKED/requires-release-credentials/PRD-196-published-install-is-functional.md) | A new user cannot benefit from engine improvements if the package omits its authoring tools or imports unpublished sibling source. Independent product progress if cache feasibility fails. | Phase 1 package-content repairs and extracted-tarball proof; continue into complete MCP installation under its existing phase order. |
| 4 | [369 — Material variation is data](../assets/PRD-369-material-variation-is-data.md) | Addresses first-install compilation, where an application cache is empty. Complements 368. | After 367 attribution, prove one compatible material family inside the complete town, with cache disabled and appearance preserved. |
| Stretch | [370 — Warm-up counts what the GPU creates](../assets/PRD-370-warmup-counts-what-the-gpu-creates.md) | Corrects the reported 494 pipelines versus 101 observed creations; useful accounting, but not itself a startup speedup. | After the observer stabilizes, separate candidate objects from observed programs/pipelines and prove unknown coverage cannot report completion. |

## Execution order and handoffs

1. **Freeze the subject and investigate feasibility.** Resolve the real town,
   scenario, source/package/host identities and PRD-360 changes using the
   [asset startup contract](../assets/README.md). Timebox 368's initial API/header/
   binary investigation to **60 minutes**; this is a planning limit, not an estimate
   of the implementation. If no supported path is demonstrated, record the exact
   missing capability and continue 367/196. An owned fork requires the PRD revision
   specified by 368; do not quietly expand tonight's scope.
2. **Deliver the common observation and installation repairs.** Execute 367's
   phases in order. PRD-196 can proceed independently on disjoint files; keep its
   [production-readiness handoffs](../production-readiness/README.md) binding.
   With one executor, take 367 Phase 1, then the feasibility decision, then 196's
   first repair slice before deeper optimization work.
3. **Implement only proven optimization candidates.** Once the API is demonstrated
   and 367 Phase 1 is accepted, advance 368. Start 369 after its required attribution
   is available. Hand off shared native pipeline bindings between 367 and 368;
   serialize edits to shared perf reports/tests. Freeze one integrated build before
   comparing results; graph changes from 369 invalidate earlier cache identities.
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

**Verification status:** Selection only. No engine behavior, cache API feasibility,
new performance measurement, implementation gate or platform acceptance is claimed.

Next action (under two minutes): open PRD-368's design and feasibility boundary and
start its native dependency API check.
