import { DocCallout, DocCodeBlock, DocsLayout, DocSection } from "./DocsLayout.js";

const INSTALL = `pnpm create threenative my-game
cd my-game
pnpm install
pnpm dev`;

const GAME = `import { defineGame } from "@threenative/core";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { Play } from "./scenes/Play.js";

const game = defineGame({
  plugins: [rapier()],
  render: config.renderer,
  scenes: { play: Play },
  start: "play",
});

export default game;`;

export function GettingStarted() {
  return (
    <DocsLayout
      path="/docs/getting-started"
      sourceHref="https://github.com/ThreeNativeHQ/threenative/tree/main/packages/create-threenative"
      toc={[
        { id: "requirements", label: "Requirements" },
        { id: "create", label: "Create a project" },
        { id: "anatomy", label: "Project anatomy" },
        { id: "game", label: "Game entry" },
        { id: "verify", label: "Verify the build" },
      ]}
    >
      <DocSection id="requirements" title="Requirements">
        <p>
          Use Node 20.19 or newer and pnpm 10 or newer. For the browser path, use a WebGPU-capable
          browser when possible; the renderer can fall back to WebGL2. Native builds add the target
          platform toolchain only when you actually need that target.
        </p>
        <DocCallout title="Native is opt-in during development">
          You do not need CMake, the Android NDK or Xcode to scaffold a project and work on the web
          path. Keep the fast loop fast, then qualify the native target when the game needs it.
        </DocCallout>
      </DocSection>

      <DocSection id="create" title="Create a project">
        <p>
          The default scaffold is meant to run immediately rather than hand you an empty renderer.
          It gives you a scene, physics, a HUD and a playtest that can be deleted or replaced as the
          project takes shape.
        </p>
        <DocCodeBlock code={INSTALL} label="terminal" />
        <p>
          The generated application is still your code. ThreeNative does not hide camera setup,
          materials, lighting or post-processing behind an editor asset you cannot inspect.
        </p>
      </DocSection>

      <DocSection id="anatomy" title="Know the project anatomy">
        <div className="overflow-hidden rounded-xl border border-tn-border">
          {[
            ["src/game.ts", "Portable game entry: plugins, scenes, input and renderer config."],
            ["src/scenes/", "Gameplay scenes with load, enter and update lifecycle methods."],
            ["src/render/", "Lighting, materials and post-processing that decide how the frame looks."],
            ["src/state.ts", "Game-owned state shared with systems and the React HUD."],
            ["threenative.config.ts", "Renderer, asset and platform configuration."],
            ["playtests/", "Scenarios that drive the real build and assert observable behaviour."],
          ].map(([name, description], index) => (
            <div
              className={[
                "grid gap-1 px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-5",
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

      <DocSection id="game" title="The game entry stays small">
        <p>
          A ThreeNative application declares the parts the framework needs to wire together, while
          the scene itself remains ordinary TypeScript and Three.js. The minimal shape looks like
          this:
        </p>
        <DocCodeBlock code={GAME} label="src/game.ts" />
        <p>
          A scene can implement <code className="font-mono text-tn-fg">load</code>,{" "}
          <code className="font-mono text-tn-fg">enter</code> and{" "}
          <code className="font-mono text-tn-fg">update</code>. Start with the lifecycle you need;
          there is no requirement to build a second object model around Three.js.
        </p>
      </DocSection>

      <DocSection id="verify" title="Verify before you add complexity">
        <p>
          Keep one browser playtest green while you replace the scaffold. It gives you a stable
          proof that boot, movement, state and rendering still work while assets and gameplay are
          changing quickly.
        </p>
        <DocCodeBlock
          code={`pnpm build
pnpm test`}
          label="project checks"
        />
        <p>
          When you are choosing whether ThreeNative is the right foundation at all, continue with
          the engine comparison. If the question is whether a performance claim is earned, use the
          benchmark page instead of a marketing screenshot.
        </p>
      </DocSection>
    </DocsLayout>
  );
}
