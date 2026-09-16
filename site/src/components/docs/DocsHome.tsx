import { DocsLayout, DocCodeBlock, DocSection } from "./DocsLayout.js";

const QUICKSTART = `pnpm create threenative my-game
cd my-game
pnpm install
pnpm dev`;

const PATHS = [
  {
    href: "/docs/getting-started",
    eyebrow: "Start",
    title: "Build the first project",
    description: "Scaffold the project, learn the scene shape and run the first browser playtest.",
  },
  {
    href: "/docs/comparison",
    eyebrow: "Understand",
    title: "Compare the tradeoffs",
    description: "See where ThreeNative sits between a rendering library and full editor engines.",
  },
  {
    href: "/docs/benchmarks",
    eyebrow: "Evidence",
    title: "Inspect the measurements",
    description: "Read the measured results, caveats and deliberately unscored experiments.",
  },
] as const;

export function DocsHome() {
  return (
    <DocsLayout
      path="/docs"
      toc={[
        { id: "start", label: "Start in four commands" },
        { id: "paths", label: "Pick a path" },
        { id: "mental-model", label: "Mental model" },
        { id: "engineering-docs", label: "Engineering records" },
      ]}
    >
      <DocSection id="start" title="Start in four commands">
        <p>
          ThreeNative keeps the entry path intentionally small: create a project, install it and
          run the Vite development server. The generated project already includes a game loop,
          physics wiring, a React HUD and a playtest scenario.
        </p>
        <DocCodeBlock code={QUICKSTART} label="terminal" />
        <p>
          Requires Node 20.19 or newer. The browser path uses Three.js WebGPU and can fall back to
          WebGL2; native targets use the owned runtime instead of a WebView.
        </p>
      </DocSection>

      <DocSection id="paths" title="Pick the path that answers your question">
        <div className="grid gap-4 sm:grid-cols-3">
          {PATHS.map((item) => (
            <a
              className="group rounded-xl border border-tn-border bg-tn-surface/55 p-5 transition-colors hover:border-white/20 hover:bg-tn-surface"
              href={item.href}
              key={item.href}
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tn-accent">
                {item.eyebrow}
              </span>
              <span className="mt-3 block text-[17px] font-semibold leading-6 text-tn-fg">
                {item.title}
              </span>
              <span className="mt-2 block text-[13px] leading-5 text-tn-fg-subtle">
                {item.description}
              </span>
              <span className="mt-4 block text-[13px] font-medium text-tn-fg transition-transform group-hover:translate-x-0.5">
                Open guide →
              </span>
            </a>
          ))}
        </div>
      </DocSection>

      <DocSection id="mental-model" title="The mental model">
        <p>
          ThreeNative is not a replacement rendering API. Your scene is still a Three.js scene,
          your renderer is still the Three.js WebGPU renderer, and visual code stays in the game
          repository. ThreeNative owns the repetitive game and platform layer around that code.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {[
            ["Rendering", "Use three/webgpu, TSL, materials and loaders directly."],
            ["Game layer", "Scenes, fixed-step updates, input, physics and navigation."],
            ["Interface", "React 19 and Tailwind for HUDs and menus."],
            ["Proof", "Playtest scenarios drive the real build and assert observable state."],
            ["Native", "The same game source runs through the owned C++ host."],
            ["Ownership", "Generated visual code remains ordinary project source you can edit."],
          ].map(([title, description]) => (
            <div className="rounded-lg border border-tn-border/80 p-4" key={title}>
              <p className="font-medium text-tn-fg">{title}</p>
              <p className="mt-1 text-[14px] leading-6 text-tn-fg-subtle">{description}</p>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection id="engineering-docs" title="Public guide vs engineering record">
        <p>
          This documentation is the product-facing path: how to start, how the pieces fit and what
          the measured evidence says. The repository keeps a second, deeper layer for architecture,
          PRDs, verification receipts, experiments and known limitations.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            className="rounded-lg border border-tn-border px-4 py-2 text-[14px] font-medium text-tn-fg transition-colors hover:border-white/20"
            href="https://github.com/ThreeNativeHQ/threenative/tree/main/docs"
            rel="noreferrer"
            target="_blank"
          >
            Engineering docs ↗
          </a>
          <a
            className="rounded-lg border border-tn-border px-4 py-2 text-[14px] font-medium text-tn-fg transition-colors hover:border-white/20"
            href="https://github.com/ThreeNativeHQ/threenative/blob/main/docs/CURRENT-CHALLENGES.md"
            rel="noreferrer"
            target="_blank"
          >
            Current challenges ↗
          </a>
        </div>
      </DocSection>
    </DocsLayout>
  );
}
