import { DocCallout, DocSection, DocsLayout } from "./DocsLayout.js";

const REPO = "https://github.com/ThreeNativeHQ/threenative";

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

export function Benchmarks() {
  return (
    <DocsLayout
      path="/docs/benchmarks"
      sourceHref={`${REPO}/tree/main/docs/benchmark`}
      toc={[
        { id: "rules", label: "Evidence rules" },
        { id: "loc", label: "Abyss source census" },
        { id: "programs", label: "Shader program census" },
        { id: "lod", label: "AutoLOD proof" },
        { id: "void", label: "VOID head-to-head" },
      ]}
    >
      <DocSection id="rules" title="A benchmark is only as useful as its scope">
        <p>
          ThreeNative keeps benchmark and runtime evidence in the repository next to the protocol,
          inputs and caveats. This page surfaces a few useful measurements, but it does not turn a
          source-size result into a frame-time claim or an incomplete experiment into a win rate.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Metric
            label="Normalised source ratio"
            note="ThreeNative vs the frozen vanilla Abyss control. Static source census only."
            value="93.2%"
          />
          <Metric
            label="Framework plumbing ratio"
            note="74 normalised plumbing LOC vs 138 in the frozen vanilla control."
            value="53.6%"
          />
          <Metric
            label="AutoLOD far-route reduction"
            note="Submitted triangles in the qualified auto-lod example, not a whole-game FPS claim."
            value="95.5%"
          />
        </div>
      </DocSection>

      <DocSection id="loc" title="Abyss source census">
        <p>
          The checked-in Abyss fixture compares a ThreeNative implementation with its frozen vanilla
          Three.js control after both are formatted with the repository&apos;s Biome config. The
          game logic is counted separately from framework plumbing so the framework can be judged on
          the layer it is actually trying to remove.
        </p>
        <div className="my-6 overflow-x-auto rounded-xl border border-tn-border">
          <table className="w-full min-w-[620px] text-left text-[13px]">
            <thead className="bg-white/[0.025] text-tn-fg-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">Arm</th>
                <th className="px-4 py-3 text-right font-medium">Normalised LOC</th>
                <th className="px-4 py-3 text-right font-medium">Plumbing LOC</th>
                <th className="px-4 py-3 text-right font-medium">Game LOC</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-tn-border bg-tn-accent/[0.025]">
                <td className="px-4 py-3 font-medium text-tn-accent">ThreeNative</td>
                <td className="px-4 py-3 text-right text-tn-fg">441</td>
                <td className="px-4 py-3 text-right text-tn-fg">74</td>
                <td className="px-4 py-3 text-right text-tn-fg-muted">367</td>
              </tr>
              <tr className="border-t border-tn-border">
                <td className="px-4 py-3 font-medium text-tn-fg">Vanilla Three.js</td>
                <td className="px-4 py-3 text-right text-tn-fg">473</td>
                <td className="px-4 py-3 text-right text-tn-fg">138</td>
                <td className="px-4 py-3 text-right text-tn-fg-muted">335</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          The static result is favourable to ThreeNative on total normalised source and especially
          on plumbing. It does not establish visual quality, runtime speed or model cost.
        </p>
        <a
          className="mt-4 inline-flex text-[13px] font-medium text-tn-accent hover:opacity-80"
          href={`${REPO}/blob/main/docs/benchmark/LOC.md`}
          rel="noreferrer"
          target="_blank"
        >
          Open LOC.md and its generated table ↗
        </a>
      </DocSection>

      <DocSection id="programs" title="Whole-town shader program census">
        <p>
          A September 9 runtime investigation measured how stable buffer naming changed the number
          of distinct shader programs in the same whole-town target. The measurement is a program
          census, not a claim that frame time fell by the same percentage.
        </p>
        <div className="my-6 overflow-hidden rounded-xl border border-tn-border">
          {[
            ["Browser · NVIDIA/Turing", "79", "52", "34.2% fewer"],
            ["Native desktop", "84", "56", "33.3% fewer"],
            ["Pixel 8", "92", "63", "31.5% fewer"],
          ].map(([target, before, after, delta], index) => (
            <div
              className={[
                "grid grid-cols-[1fr_auto_auto] items-center gap-5 px-4 py-3 text-[13px] sm:grid-cols-[1fr_90px_90px_120px]",
                index === 0 ? "" : "border-t border-tn-border",
              ].join(" ")}
              key={target}
            >
              <span className="font-medium text-tn-fg">{target}</span>
              <span className="text-right text-tn-fg-subtle">{before}</span>
              <span className="text-right font-medium text-tn-fg">{after}</span>
              <span className="hidden text-right text-tn-accent sm:block">{delta}</span>
            </div>
          ))}
        </div>
        <a
          className="inline-flex text-[13px] font-medium text-tn-accent hover:opacity-80"
          href={`${REPO}/blob/main/docs/verification/runtime-perf-state.md`}
          rel="noreferrer"
          target="_blank"
        >
          Open the runtime performance state record ↗
        </a>
      </DocSection>

      <DocSection id="lod" title="AutoLOD example: measure geometry work, not vibes">
        <p>
          The opt-in AutoLOD qualification example uses an 8,192-triangle source hull and asserts
          the selected triangle count from the real loader. On browser WebGPU the far route submits
          369 triangles while the near route keeps 8,192. The native desktop proof records 368 on
          the far route and 8,192 near: roughly 95.5% fewer submitted triangles in the far case.
        </p>
        <DocCallout title="What that result does not say">
          It is not a universal FPS multiplier. Draw topology, materials, visibility, GPU cost and
          the rest of a real game still matter. The value of this proof is narrower: the generated
          LOD is selected on real browser and native paths and the measured geometry work falls.
        </DocCallout>
        <a
          className="inline-flex text-[13px] font-medium text-tn-accent hover:opacity-80"
          href={`${REPO}/blob/main/docs/PRDs/assets/PRD-377-auto-lod-is-on-by-default.md`}
          rel="noreferrer"
          target="_blank"
        >
          Open PRD-377 qualification evidence ↗
        </a>
      </DocSection>

      <DocSection id="void" title="The agent-vs-agent head-to-head is still VOID">
        <p>
          The ambitious benchmark asks equal agents to build the same game with ThreeNative and
          vanilla Three.js, then compares proof, blind human quality scores, tool steps, token cost
          and source. The retained August 2 result does not meet that protocol: the six external
          model runs, equal proof, blind scores and authoritative usage events were not collected.
        </p>
        <div className="my-6 rounded-xl border border-amber-300/20 bg-amber-300/[0.055] p-5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-amber-200">
            VOID
          </p>
          <p className="mt-2 text-[14px] leading-6 text-tn-fg-muted">
            No quality winner, cost winner or productivity multiplier is published from that run.
            The harness exists; the experiment still needs the required external repeats.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a
            className="rounded-lg border border-tn-border px-3 py-2 text-[13px] text-tn-fg-muted transition-colors hover:border-white/20 hover:text-tn-fg"
            href={`${REPO}/blob/main/docs/benchmark/RESULTS-2026-08-02.md`}
            rel="noreferrer"
            target="_blank"
          >
            RESULTS-2026-08-02.md ↗
          </a>
          <a
            className="rounded-lg border border-tn-border px-3 py-2 text-[13px] text-tn-fg-muted transition-colors hover:border-white/20 hover:text-tn-fg"
            href={`${REPO}/blob/main/docs/benchmark/PROTOCOL.md`}
            rel="noreferrer"
            target="_blank"
          >
            Benchmark protocol ↗
          </a>
        </div>
      </DocSection>
    </DocsLayout>
  );
}
