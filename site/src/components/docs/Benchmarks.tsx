import type { ReactNode } from "react";
import {
  EVIDENCE_REF,
  EVIDENCE_REVIEWED,
  evidenceUrl,
  locCensus,
  lodCensus,
  percentageOf,
  percentageReduction,
  shaderCensus,
} from "../../content/benchmarks.js";
import { DocCallout, DocCodeBlock, DocSection, DocsLayout } from "./DocsLayout.js";

const PERF = "docs/verification/runtime-perf-state.md";
const LOD = "docs/PRDs/assets/PRD-377-auto-lod-is-on-by-default.md";
const RESULTS = "docs/benchmark/RESULTS-2026-08-02.md";

function EvidenceLink({ path, children }: { readonly path: string; readonly children: ReactNode }) {
  return (
    <a
      className="mt-3 inline-flex text-[13px] font-medium text-tn-accent underline underline-offset-4"
      href={evidenceUrl(path)}
      rel="noreferrer"
      target="_blank"
    >
      {children} ↗
    </a>
  );
}

function Metric({
  value,
  label,
  note,
}: { readonly value: string; readonly label: string; readonly note: string }) {
  return (
    <div className="rounded-xl border border-tn-border bg-tn-surface/45 p-5">
      <p className="text-[30px] font-semibold tracking-[-0.03em] text-tn-fg">{value}</p>
      <p className="mt-1 text-[14px] font-medium text-tn-fg">{label}</p>
      <p className="mt-2 text-[12px] leading-5 text-tn-fg-subtle">{note}</p>
    </div>
  );
}

/** Captions and explicit header scopes keep wide numerical tables understandable without layout. */
function EvidenceTable({
  caption,
  headers,
  rows,
}: {
  readonly caption: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly (string | number)[])[];
}) {
  return (
    <section
      aria-label={caption}
      className="my-6 overflow-x-auto rounded-xl border border-tn-border"
    >
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <caption className="border-b border-tn-border px-4 py-3 text-left font-medium text-tn-fg">
          {caption}
        </caption>
        <thead className="bg-tn-surface text-tn-fg-subtle">
          <tr>
            {headers.map((header) => (
              <th className="px-4 py-3 font-medium" key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-t border-tn-border" key={row[0]}>
              <th className="px-4 py-3 font-medium text-tn-fg" scope="row">
                {row[0]}
              </th>
              {row.slice(1).map((value, index) => (
                <td className="px-4 py-3 tabular-nums" key={headers[index + 1]}>
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function Benchmarks() {
  return (
    <DocsLayout
      path="/docs/benchmarks"
      sourceHref={evidenceUrl("docs/benchmark/PROTOCOL.md")}
      toc={[
        { id: "rules", label: "Evidence rules" },
        { id: "loc", label: "Abyss source census" },
        { id: "programs", label: "Shader program census" },
        { id: "lod", label: "AutoLOD proof" },
        { id: "comparison-status", label: "Engine comparison status" },
        { id: "reproduce", label: "Reproduce and report" },
        { id: "void", label: "VOID head-to-head" },
      ]}
    >
      <DocSection id="rules" title="Measurements with a scope, not a leaderboard">
        <p>
          These are retained repository observations, not a fresh benchmark of today&apos;s release.
          Source size, program counts and submitted triangles answer different questions. None is an
          FPS multiplier.
        </p>
        <p className="mt-4 rounded-lg border border-tn-border p-3 text-[12px] text-tn-fg-subtle">
          Source snapshot reviewed <time dateTime={EVIDENCE_REVIEWED}>{EVIDENCE_REVIEWED}</time> ·
          commit <code>{EVIDENCE_REF.slice(0, 12)}</code>. Evidence links below are pinned to that
          revision.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Metric
            label="Source: percent of control"
            note="441 / 473 normalized LOC. Static Abyss fixture, not development time."
            value={percentageOf(locCensus.framework.total, locCensus.vanilla.total)}
          />
          <Metric
            label="Plumbing: percent of control"
            note="74 / 138 normalized plumbing LOC. This is not 53.6% less code."
            value={percentageOf(locCensus.framework.plumbing, locCensus.vanilla.plumbing)}
          />
          <Metric
            label="Far-route triangle reduction"
            note="8,192 → 369, opt-in browser proof. Geometry work, not whole-game speed."
            value={percentageReduction(lodCensus[0].near, lodCensus[0].far)}
          />
        </div>
      </DocSection>
      <DocSection id="loc" title="Abyss source census">
        <p>
          Both arms are formatted with the repository&apos;s Biome configuration. The frozen,
          hand-written vanilla control is a regression ratchet, not an equal-agent productivity
          experiment. Game logic is counted separately from framework plumbing.
        </p>
        <EvidenceTable
          caption="Normalized source lines · inspected snapshot"
          headers={["Arm", "Total LOC", "Plumbing LOC", "Game LOC"]}
          rows={[
            [
              "ThreeNative",
              locCensus.framework.total,
              locCensus.framework.plumbing,
              locCensus.framework.game,
            ],
            [
              "Vanilla Three.js",
              locCensus.vanilla.total,
              locCensus.vanilla.plumbing,
              locCensus.vanilla.game,
            ],
          ]}
        />
        <p>
          The source reduction is{" "}
          {percentageReduction(locCensus.vanilla.total, locCensus.framework.total)} overall and{" "}
          {percentageReduction(locCensus.vanilla.plumbing, locCensus.framework.plumbing)} in
          plumbing. The record still notes a pending manual Abyss parity run; it does not establish
          equivalent visuals, runtime speed, token cost or human effort.
        </p>
        <EvidenceLink path={locCensus.source}>Inspect LOC.md and its generated table</EvidenceLink>
      </DocSection>
      <DocSection id="programs" title="Whole-town shader program census">
        <p>
          The September 9, 2026 experiment combined tint uniforms with stable buffer naming. Showing
          the intermediate column matters: the complete reduction cannot be attributed to buffer
          naming alone.
        </p>
        <EvidenceTable
          caption="Distinct shader programs · September 9, 2026"
          headers={[
            "Target",
            "Original",
            "Tint uniforms",
            "Tint + stable names",
            "Combined reduction",
          ]}
          rows={shaderCensus.map((row) => [
            row.target,
            row.original,
            row.tint,
            row.stable,
            percentageReduction(row.original, row.stable),
          ])}
        />
        <DocCallout title="The adverse observations belong beside the gains">
          Browser and desktop reached the one-third program-reduction target; Pixel 8 did not. Pixel
          readiness remained 16,500.797697 ms and failed the 8,000 ms gate. The phone was
          AC-charging, so these runs do not qualify timing, first-playable time or unobstructed
          appearance. Fewer programs is not proof of faster startup.
        </DocCallout>
        <EvidenceLink path={`${PERF}#equivalent-shaders-retained-process-wide-buffer-names`}>
          Inspect the experiment, device receipts and retained caveats
        </EvidenceLink>
      </DocSection>
      <DocSection id="lod" title="AutoLOD: geometry work on a qualified route">
        <p>
          PRD-377&apos;s September 11, 2026 record describes an opt-in 8,192-triangle source hull
          tested on an RTX 2080. The near route retains full geometry; the far route chooses a
          generated level.
        </p>
        <EvidenceTable
          caption="Submitted triangles · opt-in AutoLOD proof"
          headers={["Target", "Near", "Far", "Reduction"]}
          rows={lodCensus.map((row) => [
            row.target,
            row.near.toLocaleString("en-US"),
            row.far,
            percentageReduction(row.near, row.far),
          ])}
        />
        <DocCallout title="Partial qualification, not default-on release proof">
          At this snapshot, default-on rollout, quality/frame-time/byte gates and Windows, macOS,
          Android and iOS qualification remain unproven in this PRD. Do not infer a shipped default,
          cross-platform completion or an FPS gain from triangle counts.
        </DocCallout>
        <EvidenceLink path={LOD}>Inspect PRD-377 status and qualification evidence</EvidenceLink>
      </DocSection>
      <DocSection id="comparison-status" title="Where are the five-engine FPS results?">
        <p>
          No matched runtime ranking is published here. The{" "}
          <a className="text-tn-accent underline" href="/docs/comparison">
            engine comparison
          </a>{" "}
          is a workflow comparison, not measured performance evidence.
        </p>
        <EvidenceTable
          caption="Matched runtime comparison status · this evidence set"
          headers={["Comparison", "Available here", "Runtime verdict"]}
          rows={[
            [
              "ThreeNative vs Three.js",
              "Static Abyss source census",
              "Not established by this census",
            ],
            ["ThreeNative vs Godot", "No matched runtime dataset", "Not measured"],
            ["ThreeNative vs Unity", "No matched runtime dataset", "Not measured"],
            ["ThreeNative vs Unreal Engine", "No matched runtime dataset", "Not measured"],
          ]}
        />
        <p className="text-[14px]">
          Not measured does not mean zero, unsupported or slower. A fair runtime comparison needs
          equivalent content and output quality on the same hardware, resolution, camera route and
          measurement protocol.
        </p>
      </DocSection>
      <DocSection id="reproduce" title="Reproduce an observation before generalizing it">
        <p>
          The source census has a repository command. Run it in a checkout of the pinned revision
          with the repository&apos;s required Node and pnpm versions:
        </p>
        <DocCodeBlock
          code={`git checkout ${EVIDENCE_REF}\npnpm install --frozen-lockfile\npnpm tsx scripts/count-loc.ts`}
          label="source census · repository checkout"
        />
        <p className="text-[14px]">
          Use a clean checkout for that revision. The command regenerates LOC.md; it does not run an
          engine FPS benchmark. For the shader investigation, the pinned experiment links to actual
          device receipts, source manifests and capture inputs.
        </p>
        <p className="mt-4">
          For new runtime results, retain the engine commit/version, scene and asset hashes,
          CPU/GPU/driver, OS, resolution, settings, cold versus warm state, presentation mode,
          power/thermal state, warm-up, sample count and raw traces. Report frame-time distributions
          and CPU/GPU work separately. Keep failed quality or readiness gates with the result.
        </p>
      </DocSection>
      <DocSection id="void" title="The agent-vs-agent head-to-head is still VOID">
        <p>
          The retained August 2, 2026 experiment lacks the required six external model runs, equal
          proof, blind quality scores and authoritative usage events. A working harness is not a
          completed experiment.
        </p>
        <DocCallout title="VOID — no winner is published">
          No quality winner, cost winner or productivity multiplier can be inferred from this run.
          The source census above does not repair those missing controls.
        </DocCallout>
        <div className="flex flex-wrap gap-5">
          <EvidenceLink path={RESULTS}>RESULTS-2026-08-02.md</EvidenceLink>
          <EvidenceLink path="docs/benchmark/PROTOCOL.md">Benchmark protocol</EvidenceLink>
        </div>
      </DocSection>
    </DocsLayout>
  );
}
