import { DocCallout, DocCodeBlock, DocSection, DocsLayout } from "./DocsLayout.js";

const BROWSER = `npx @threenative/playtest playtests/movement.playtest.json \\
  --url http://127.0.0.1:5173 \\
  --server-command "npm run dev"`;

const DESKTOP = `npx @threenative/playtest playtests/device-smoke.playtest.json \\
  --target desktop \\
  --executable .threenative/build/ThreeNative`;

export function Playtesting() {
  return (
    <DocsLayout
      path="/docs/playtesting"
      sourceHref="https://github.com/ThreeNativeHQ/threenative/blob/main/packages/playtest/README.md"
      toc={[
        { id: "scenario", label: "Run a scenario" },
        { id: "evidence", label: "Fail-closed evidence" },
        { id: "doctor", label: "Doctor" },
        { id: "targets", label: "Native targets" },
        { id: "limits", label: "Target limits" },
      ]}
    >
      <DocSection id="scenario" title="Drive the real development build">
        <p>
          A playtest scenario is an external test recipe for a running build. It can drive input and
          collect browser evidence without changing application source. Add the Three.js bridge when
          semantic entity, camera, movement or visibility assertions need game-level observations.
        </p>
        <DocCodeBlock code={BROWSER} label="browser playtest" />
        <p>
          Use <code className="font-mono text-tn-fg">playtest init</code> to create a config, a
          smoke scenario and an adapter example when a project does not have a harness yet.
        </p>
      </DocSection>

      <DocSection id="evidence" title="A pass must contain an observation">
        <p>
          ThreeNative playtest assertions fail closed. A missing entity, absent resource, empty
          effect log, wrong-typed assertion value or a scenario with no assertions is a failure—not
          a silent pass. A reported pass means at least one assertion evaluated against evidence
          that actually arrived from the build.
        </p>
        <DocCallout title="Prefer observable outcomes over implementation details">
          Assert that the player moved, the camera reached the expected state or the object became
          visible. That keeps the scenario useful while the implementation behind the behavior is
          refactored.
        </DocCallout>
      </DocSection>

      <DocSection id="doctor" title="Ask doctor what the machine and build can prove">
        <DocCodeBlock
          code={`npx @threenative/playtest doctor --text
npx @threenative/playtest doctor --url http://127.0.0.1:5173 --text`}
          label="doctor"
        />
        <p>
          The first command answers whether the machine can run the harness. Adding a URL also
          inspects the game that is currently running there, which is useful before debugging a
          scenario that never had the capability it was trying to assert.
        </p>
      </DocSection>

      <DocSection id="targets" title="Keep one scenario shape across targets">
        <p>
          The schema can target browser, Android, desktop or iOS. For desktop, point the runner at a
          packaged executable; the native host receives a temporary mailbox and injects the shared
          playtest bridge before it evaluates the normal game entry.
        </p>
        <DocCodeBlock code={DESKTOP} label="desktop playtest" />
        <p>
          iOS simulator and signed-device paths use the same scenario format with target-specific
          transport flags. Android and iOS device lanes are opt-in platform evidence; an absent run
          is not a pass.
        </p>
      </DocSection>

      <DocSection id="limits" title="Target capabilities are explicit">
        <p>
          Browser-only observations such as DOM, network and some visual metrics are not silently
          approximated on device targets. Unsupported assertions fail with a named target error so a
          scenario cannot look green while quietly skipping the evidence it was written to collect.
        </p>
      </DocSection>
    </DocsLayout>
  );
}
