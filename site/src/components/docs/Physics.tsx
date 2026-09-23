import { DocCallout, DocSection, DocsLayout } from "./DocsLayout.js";

const NODES = [
  ["RigidBody3D", "Dynamic or otherwise physics-driven rigid bodies."],
  ["CharacterBody3D", "Character movement with a game-facing body abstraction."],
  ["Area3D", "Overlap and trigger-style regions without treating them as ordinary solids."],
  ["CollisionShape3D", "The collision geometry attached to bodies and areas."],
] as const;

export function Physics() {
  return (
    <DocsLayout
      path="/docs/physics"
      sourceHref="https://github.com/ThreeNativeHQ/threenative/blob/main/packages/physics/README.md"
      toc={[
        { id: "nodes", label: "Godot-shaped nodes" },
        { id: "backends", label: "Backend portability" },
        { id: "raw", label: "Avoid raw handles" },
        { id: "movement", label: "Per-frame movement" },
        { id: "snapshots", label: "Replay boundaries" },
      ]}
    >
      <DocSection id="nodes" title="Use a small, familiar physics vocabulary">
        <p>
          ThreeNative&apos;s physics package uses Godot-shaped names over Rapier so the gameplay
          layer talks in terms of bodies, characters, areas and collision shapes instead of leaking
          a different backend vocabulary into every scene.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {NODES.map(([name, description]) => (
            <div className="rounded-xl border border-tn-border bg-tn-surface/45 p-5" key={name}>
              <code className="font-mono text-[14px] text-tn-accent">{name}</code>
              <p className="mt-2 text-[14px] leading-6 text-tn-fg-muted">{description}</p>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection id="backends" title="Web and native select different Rapier backends">
        <p>
          Browser builds use the WebAssembly Rapier backend. Native desktop, Android and iOS builds
          select the runtime&apos;s native Rapier adapter through the native export condition. The
          public ThreeNative physics surface is the portability boundary between those backends.
        </p>
        <DocCallout title="Portable API does not mean byte-identical simulation">
          Treat web and native as separate pinned physics runtimes for deterministic recordings.
          Replays and snapshots are only repeatable within the exact runtime, operating system and
          architecture that recorded them.
        </DocCallout>
      </DocSection>

      <DocSection id="raw" title="Do not build portable gameplay on raw handles">
        <p>
          <code className="font-mono text-tn-fg">world.raw</code>,{" "}
          <code className="font-mono text-tn-fg">body.raw</code>,{" "}
          <code className="font-mono text-tn-fg">collider.raw</code> and{" "}
          <code className="font-mono text-tn-fg">CollisionShape3D.raw</code> are explicitly
          backend-specific escape hatches. They expose Rapier objects on the web and opaque handles
          on native targets.
        </p>
        <p className="mt-4">
          If code touches <code className="font-mono text-tn-fg">raw</code>, treat that code as
          platform-specific until proven otherwise. Keep ordinary gameplay on the ThreeNative
          surface when the same source is expected to run in both places.
        </p>
      </DocSection>

      <DocSection id="movement" title="Keep hot movement on the bulk path">
        <p>
          Per-frame movement belongs in the reusable typed-array input consumed by the physics
          simulation step. Visible transforms come back in bulk rather than through a chain of
          per-object bridge calls. That boundary matters most on the native path, where accidental
          object-by-object transport can become the dominant cost.
        </p>
      </DocSection>

      <DocSection id="snapshots" title="Be precise about what a replay proves">
        <p>
          A physics snapshot captured in one backend is not a portable artifact for another backend,
          Rapier version, operating system or CPU architecture. Use snapshots to prove behavior
          inside a pinned target, and use cross-target playtests to prove that the game-level result
          remains acceptable across targets.
        </p>
      </DocSection>
    </DocsLayout>
  );
}
