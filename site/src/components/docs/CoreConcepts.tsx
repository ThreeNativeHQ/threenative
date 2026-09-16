import { DocCallout, DocCodeBlock, DocSection, DocsLayout } from "./DocsLayout.js";

const GAME_ENTRY = `import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { Play } from "./scenes/Play.js";

const game = defineGame({
  input: {
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
  },
  plugins: [rapier(), playtest()],
  render: config.renderer,
  scenes: { play: Play },
  start: "play",
});

export default game;`;

export function CoreConcepts() {
  return (
    <DocsLayout
      path="/docs/core-concepts"
      sourceHref="https://github.com/ThreeNativeHQ/threenative/blob/main/packages/core/README.md"
      toc={[
        { id: "entry", label: "Portable game entry" },
        { id: "lifecycle", label: "Scene lifecycle" },
        { id: "loop", label: "Fixed-step loop" },
        { id: "input", label: "Input maps" },
        { id: "ownership", label: "What your game owns" },
      ]}
    >
      <DocSection id="entry" title="One portable game entry">
        <p>
          <code className="font-mono text-tn-fg">defineGame</code> is the wiring point for the
          renderer, fixed-step loop, scenes, input, state and plugins. Browser and native builds
          consume that same entry instead of asking the project to maintain two gameplay layers.
        </p>
        <DocCodeBlock code={GAME_ENTRY} label="src/game.ts" />
        <p>
          Keep this file declarative. Systems that decide what the game does belong in scenes and
          game modules; rendering code that decides what the frame looks like stays in project
          source where it can be inspected and changed directly.
        </p>
      </DocSection>

      <DocSection id="lifecycle" title="Scenes have a deliberately small lifecycle">
        <p>
          A scene can implement three optional methods:{" "}
          <code className="font-mono text-tn-fg">load</code>,{" "}
          <code className="font-mono text-tn-fg">enter</code> and{" "}
          <code className="font-mono text-tn-fg">update</code>. Use only the lifecycle hooks the
          scene needs rather than wrapping Three.js in another scene graph.
        </p>
        <div className="mt-5 overflow-hidden rounded-xl border border-tn-border">
          {[
            ["load", "Prepare assets and scene resources before the scene becomes active."],
            ["enter", "Perform activation work when this scene becomes the current scene."],
            ["update", "Advance gameplay using the runtime's frame and fixed-step services."],
          ].map(([name, description], index) => (
            <div
              className={[
                "grid gap-1 px-4 py-3 sm:grid-cols-[100px_1fr] sm:gap-5",
                index === 0 ? "" : "border-t border-tn-border",
              ].join(" ")}
              key={name}
            >
              <code className="font-mono text-[13px] text-tn-accent">{name}</code>
              <span className="text-[14px] leading-6 text-tn-fg-muted">{description}</span>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection id="loop" title="The runtime owns the boring loop mechanics">
        <p>
          The core runtime owns the fixed-step loop and its timing conventions so each project does
          not re-invent frame scheduling and timestep plumbing. Gameplay still receives the timing
          information it needs; the convention simply becomes shared infrastructure instead of
          copy-pasted bootstrap code.
        </p>
        <DocCallout title="ThreeNative does not own the look">
          Materials, shaders, lights, post-processing and camera framing remain game-owned Three.js
          code. The runtime standardizes the application layer around the renderer, not the visual
          decisions inside it.
        </DocCallout>
      </DocSection>

      <DocSection id="input" title="Name intent once, bind devices around it">
        <p>
          Input maps live in the game definition. Gameplay can then ask for a named action such as
          <code className="font-mono text-tn-fg">ctx.input.vector(&quot;move&quot;)</code> instead
          of scattering keyboard, pointer, gamepad and touch checks through scene code. Device
          bindings can evolve without changing the gameplay meaning of{" "}
          <code className="font-mono text-tn-fg">move</code>.
        </p>
      </DocSection>

      <DocSection id="ownership" title="Know the boundary">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-tn-border bg-tn-surface/45 p-5">
            <p className="font-semibold text-tn-fg">ThreeNative owns</p>
            <p className="mt-2 text-[14px] leading-6 text-tn-fg-muted">
              Bootstrap, lifecycle, fixed-step timing, input conventions, plugins and the portable
              application entry shared by web and native targets.
            </p>
          </div>
          <div className="rounded-xl border border-tn-border bg-tn-surface/45 p-5">
            <p className="font-semibold text-tn-fg">Your game owns</p>
            <p className="mt-2 text-[14px] leading-6 text-tn-fg-muted">
              Three.js scenes, materials, shaders, lights, camera composition, game systems and the
              source that determines what players actually see and do.
            </p>
          </div>
        </div>
      </DocSection>
    </DocsLayout>
  );
}
