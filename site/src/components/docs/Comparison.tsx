import { useState } from "react";
import { DocCallout, DocSection, DocsLayout } from "./DocsLayout.js";

const ENGINES = ["ThreeNative", "Three.js", "Godot", "Unity", "Unreal Engine"] as const;
const ROWS = [
  [
    "What it is",
    "Application framework built around the Three.js API",
    "JavaScript 3D rendering library",
    "Full open-source game engine and editor",
    "Full game engine and editor",
    "Full game engine and editor",
  ],
  [
    "Primary authoring",
    "Code-first TypeScript / JavaScript",
    "Code-first JavaScript / TypeScript",
    "Editor + GDScript or C#; C/C++ via GDExtension",
    "Editor + C#",
    "Editor + Blueprints and C++",
  ],
  [
    "Rendering surface",
    "Direct three/webgpu, TSL, materials and loaders",
    "Direct Three.js APIs",
    "Godot renderer and scene APIs",
    "Unity renderer and engine APIs",
    "Unreal renderer and engine APIs",
  ],
  [
    "Game layer",
    "Loop, input, physics, navigation, HUD bindings and playtest conventions",
    "Assemble the game layer yourself or add libraries",
    "Engine-owned nodes, scenes, physics, input and tooling",
    "Engine-owned scenes, physics, input and tooling",
    "Engine-owned actors, worlds, physics, input and tooling",
  ],
  [
    "Visual ownership",
    "Rendering code stays as readable project source",
    "Rendering code is your project source",
    "Scripts, scenes, resources and editor-authored assets",
    "C# scripts, scenes, prefabs and editor-authored assets",
    "C++, Blueprints, levels and editor-authored assets",
  ],
  [
    "Desktop / mobile path",
    "Owned native host; alpha and evidence-gated",
    "Native hosting is outside Three.js itself",
    "Engine export pipeline",
    "Engine build profiles and platform modules",
    "Engine packaging and platform toolchains",
  ],
] as const;

const REFERENCES = [
  [
    "ThreeNative architecture and status",
    "https://github.com/ThreeNativeHQ/threenative/blob/develop/README.md",
  ],
  ["Three.js renderer docs", "https://threejs.org/docs/pages/Renderer.html"],
  [
    "Godot scripting languages",
    "https://docs.godotengine.org/en/stable/getting_started/step_by_step/scripting_languages.html",
  ],
  ["Unity platform development", "https://docs.unity3d.com/Manual/PlatformSpecific.html"],
  [
    "Unreal tools and editors",
    "https://dev.epicgames.com/documentation/en-us/unreal-engine/tools-and-editors-in-unreal-engine",
  ],
] as const;

export function Comparison() {
  const [selected, setSelected] = useState<(typeof ENGINES)[number] | "all">("all");
  const columns = ENGINES.map((name, index) => ({ name, index })).filter(
    ({ name }) => selected === "all" || name === "ThreeNative" || name === selected,
  );
  return (
    <DocsLayout
      path="/docs/comparison"
      toc={[
        { id: "position", label: "Where ThreeNative sits" },
        { id: "table", label: "Side-by-side" },
        { id: "choose-threenative", label: "Choose ThreeNative when" },
        { id: "choose-other", label: "Choose something else when" },
        { id: "references", label: "References" },
      ]}
    >
      <DocSection id="position" title="ThreeNative sits between a library and an editor engine">
        <p>
          Three.js gives you a rendering library and leaves the game architecture to the project.
          Godot, Unity and Unreal Engine provide broad engine-owned workflows centred on their
          editors. ThreeNative keeps the Three.js programming model and adds repeatable game
          systems, verification and a native host around it.
        </p>
        <DocCallout title="Trade-offs, not a winner table">
          Preserving Three.js source is a reason to choose ThreeNative, not proof it is faster or
          more capable than every alternative. There is no published matched five-engine FPS
          comparison here.{" "}
          <a className="text-tn-accent underline" href="/docs/benchmarks">
            Read the evidence and its limits.
          </a>
        </DocCallout>
      </DocSection>
      <DocSection id="table" title="Side-by-side">
        <label
          className="mb-4 flex flex-wrap items-center gap-3 text-[14px] font-medium text-tn-fg"
          htmlFor="engine-comparison"
        >
          Compare ThreeNative with
          <select
            className="min-w-0 rounded-lg border border-tn-border bg-tn-surface px-3 py-2 text-tn-fg"
            id="engine-comparison"
            onChange={(event) =>
              setSelected(
                ENGINES.find(
                  (name) => name !== "ThreeNative" && name === event.currentTarget.value,
                ) ?? "all",
              )
            }
            value={selected}
          >
            <option value="all">All engines</option>
            {ENGINES.filter((name) => name !== "ThreeNative").map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <p className="mb-4 text-[13px] text-tn-fg-subtle">
          Choose one alternative for a focused view. The full table scrolls horizontally on smaller
          screens.
        </p>
        <section
          aria-label="Engine comparison table"
          className="overflow-x-auto rounded-xl border border-tn-border"
        >
          <table
            className={`w-full border-collapse text-left text-[13px] leading-5 ${selected === "all" ? "min-w-[980px]" : "min-w-[580px]"}`}
          >
            <caption className="sr-only">
              {selected === "all"
                ? "ThreeNative, Three.js, Godot, Unity and Unreal Engine: workflow comparison"
                : `ThreeNative compared with ${selected}`}
            </caption>
            <thead className="bg-tn-surface">
              <tr>
                <th
                  className="sticky left-0 z-10 w-[140px] bg-tn-bg px-4 py-3 font-medium text-tn-fg-subtle"
                  scope="col"
                >
                  Dimension
                </th>
                {columns.map(({ name }) => (
                  <th
                    className={`min-w-[165px] px-4 py-3 font-semibold ${name === "ThreeNative" ? "text-tn-accent" : "text-tn-fg"}`}
                    key={name}
                    scope="col"
                  >
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr className="border-t border-tn-border align-top" key={row[0]}>
                  <th
                    className="sticky left-0 z-10 bg-tn-bg px-4 py-4 font-medium text-tn-fg"
                    scope="row"
                  >
                    {row[0]}
                  </th>
                  {columns.map(({ name, index }) => (
                    <td
                      className={`px-4 py-4 text-tn-fg-muted ${index === 0 ? "bg-tn-accent/[0.025]" : ""}`}
                      key={name}
                    >
                      {row[index + 1]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </DocSection>
      <DocSection id="choose-threenative" title="Choose ThreeNative when these constraints matter">
        <ul className="list-disc space-y-3 pl-5 marker:text-tn-accent">
          <li>
            You already use Three.js and want to keep that API rather than port to another engine
            object model.
          </li>
          <li>
            TypeScript, npm packages and ordinary source files should remain the primary authoring
            surface.
          </li>
          <li>
            You need more game structure than raw Three.js provides: input, physics, HUD bindings
            and repeatable playtests.
          </li>
          <li>
            A browser build and a native runtime should share the same game source. You can qualify
            the alpha runtime on your actual target devices.
          </li>
          <li>
            You want control of generated visual source rather than adopting another engine&apos;s
            scene and asset model.
          </li>
        </ul>
        <p className="mt-5 text-[14px]">
          The native host renders the game without a WebView. Optional web-based UI is a separate
          surface; that is not a claim that every UI configuration avoids a WebView.{" "}
          <a className="text-tn-accent underline" href="/docs/native-runtime">
            Read the native contract.
          </a>
        </p>
      </DocSection>
      <DocSection
        id="choose-other"
        title="Choose something else when its strengths are the requirement"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            [
              "Three.js",
              "Choose the rendering library directly when you want to design your own game-system conventions or do not need a game framework.",
            ],
            [
              "Godot",
              "Choose its integrated open-source editor, scene workflow and scripting model when those matter more than preserving Three.js source.",
            ],
            [
              "Unity",
              "Choose its editor-centric C# workflow, platform tooling and ecosystem when those are central to your project.",
            ],
            [
              "Unreal Engine",
              "Choose the Unreal Editor, Blueprints, its rendering systems and content-production workflow when those are your production requirements.",
            ],
          ].map(([name, description]) => (
            <div className="rounded-xl border border-tn-border bg-tn-surface/45 p-5" key={name}>
              <h3 className="font-semibold text-tn-fg">{name}</h3>
              <p className="mt-2 text-[14px] leading-6">{description}</p>
            </div>
          ))}
        </div>
      </DocSection>
      <DocSection id="references" title="Reference the engines themselves">
        <p>
          This guide compares workflows, not transient prices or license terms. Platform support
          also depends on engine version, language and export target. Use each project&apos;s own
          documentation before committing to a platform.
        </p>
        <p className="mt-3 text-[12px] text-tn-fg-subtle">
          Reference review: September 16, 2026. Vendor documentation describes its own product; it
          is not independent comparative performance evidence.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          {REFERENCES.map(([label, href]) => (
            <a
              className="rounded-lg border border-tn-border px-3 py-2 text-[13px] hover:text-tn-fg"
              href={href}
              key={href}
              rel="noreferrer"
              target="_blank"
            >
              {label} ↗
            </a>
          ))}
        </div>
      </DocSection>
    </DocsLayout>
  );
}
