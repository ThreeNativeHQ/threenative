import { DocCallout, DocsLayout, DocSection } from "./DocsLayout.js";

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
    "Editor + GDScript, C#, C or C++",
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
    "Mix of scripts, scenes, resources and editor-authored assets",
    "Mix of C# scripts, scenes, prefabs and editor-authored assets",
    "Mix of C++, Blueprints, levels and editor-authored assets",
  ],
  [
    "Desktop / mobile path",
    "Owned native host; currently alpha and evidence-gated",
    "Primarily browser; native hosting is outside Three.js itself",
    "Engine export pipeline",
    "Engine build profiles and platform modules",
    "Engine packaging and platform toolchains",
  ],
] as const;

const REFERENCES = [
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
          Godot, Unity and Unreal Engine give you broad engine-owned workflows centred on their
          editors. ThreeNative deliberately occupies the middle: keep the Three.js programming
          model, then add repeatable game systems, verification and a native host around it.
        </p>
        <DocCallout title="This is a tradeoff table, not a winner table">
          A team that wants Unreal&apos;s editor, Unity&apos;s ecosystem or Godot&apos;s integrated scene
          workflow should use those strengths. ThreeNative is useful when preserving direct Three.js
          source and a web-first TypeScript workflow is itself a requirement.
        </DocCallout>
      </DocSection>

      <DocSection id="table" title="Side-by-side">
        <div className="overflow-x-auto rounded-xl border border-tn-border">
          <table className="min-w-[980px] border-collapse text-left text-[13px] leading-5">
            <thead className="bg-white/[0.025]">
              <tr>
                <th className="w-[150px] px-4 py-3 font-medium text-tn-fg-subtle">Dimension</th>
                {ENGINES.map((engine) => (
                  <th
                    className={[
                      "min-w-[165px] px-4 py-3 font-semibold",
                      engine === "ThreeNative" ? "text-tn-accent" : "text-tn-fg",
                    ].join(" ")}
                    key={engine}
                  >
                    {engine}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr className="border-t border-tn-border align-top" key={row[0]}>
                  <th className="px-4 py-4 font-medium text-tn-fg">{row[0]}</th>
                  {row.slice(1).map((cell, index) => (
                    <td
                      className={[
                        "px-4 py-4 text-tn-fg-muted",
                        index === 0 ? "bg-tn-accent/[0.025]" : "",
                      ].join(" ")}
                      key={`${row[0]}-${ENGINES[index] ?? index}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DocSection>

      <DocSection id="choose-threenative" title="Choose ThreeNative when these constraints matter">
        <ul className="space-y-3">
          {[
            "Your rendering code already uses Three.js and you want to keep that API rather than port to another engine object model.",
            "You want TypeScript, npm packages and ordinary source files to remain the primary authoring surface.",
            "You need more game structure than raw Three.js provides: input, physics, navigation, HUD bindings and repeatable playtests.",
            "You want a browser build and a native runtime to share the same game source instead of maintaining separate gameplay implementations.",
            "You value generated code you can edit or delete over engine-owned visual state hidden behind an editor workflow.",
          ].map((item) => (
            <li className="flex gap-3" key={item}>
              <span aria-hidden="true" className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-tn-accent" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </DocSection>

      <DocSection id="choose-other" title="Choose something else when its strengths are the requirement">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            [
              "Three.js",
              "Use it directly when you want the smallest rendering-layer dependency and prefer to design every game-system convention yourself.",
            ],
            [
              "Godot",
              "Use it when an integrated open-source editor, scene workflow and Godot-native scripting model are more valuable than preserving Three.js source.",
            ],
            [
              "Unity",
              "Use it when a mature editor-centric C# workflow, broad platform tooling and the surrounding Unity ecosystem are central to the project.",
            ],
            [
              "Unreal Engine",
              "Use it when the Unreal Editor, Blueprints, its high-end rendering stack and its established content-production pipeline are the point of the tool choice.",
            ],
          ].map(([name, description]) => (
            <div className="rounded-xl border border-tn-border bg-tn-surface/45 p-5" key={name}>
              <p className="font-semibold text-tn-fg">{name}</p>
              <p className="mt-2 text-[14px] leading-6 text-tn-fg-muted">{description}</p>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection id="references" title="Reference the engines themselves">
        <p>
          The comparison avoids transient pricing and licensing claims. For engine-specific details,
          use each project&apos;s own documentation as the authority.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          {REFERENCES.map(([label, href]) => (
            <a
              className="rounded-lg border border-tn-border px-3 py-2 text-[13px] text-tn-fg-muted transition-colors hover:border-white/20 hover:text-tn-fg"
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
