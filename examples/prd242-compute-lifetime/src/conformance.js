// The root package bundles its Three.js dependency; this source-module import keeps this
// conformance bundle on the same Three.js runtime as the scene while exercising the exported
// registry implementation.
import { ComputeDrivenRegistry } from "../../../packages/core/src/compute-driven.ts";
import { warmUpScene } from "../../../packages/core/src/warmup.ts";
import {
  assertCondition,
  startVisualScene,
} from "../../../packages/runtime-native/conformance/scenes/shared/scene-support.js";
import { PingPongField } from "./ping-pong-field.ts";

async function waitForSubmittedWork(renderer) {
  await renderer.backend?.device?.queue?.onSubmittedWorkDone?.();
}

export async function startScene(canvas, dimensions) {
  return startVisualScene(
    canvas,
    dimensions,
    "compute-driven-lifetime",
    async ({ camera, renderer, scene }) => {
      const registry = new ComputeDrivenRegistry();
      const add = (object) => {
        scene.add(object);
        registry.add(object, renderer);
        return object;
      };
      const warm = async () => {
        assertCondition(
          registry.warmupNodes.length === 2,
          "compute registry must expose two warmup kernels",
        );
        const report = await warmUpScene(renderer, scene, camera, {
          computeNodes: registry.warmupNodes,
        });
        assertCondition(
          report.computeCompiled === 2,
          "compute registry kernels must warm before conformance dispatch",
        );
      };
      let releases = 0;
      const first = add(
        new PingPongField({
          onRelease: () => {
            releases += 1;
          },
        }),
      );
      await warm();
      for (let index = 0; index < 4; index += 1) registry.process(renderer);
      await waitForSubmittedWork(renderer);
      registry.clear();
      assertCondition(first.released, "the outgoing compute field must release on scene removal");
      first.removeFromParent();

      const second = add(
        new PingPongField({
          onRelease: () => {
            releases += 1;
          },
        }),
      );
      second.position.x = 0.02;
      await warm();
      for (let index = 0; index < 4; index += 1) registry.process(renderer);
      await waitForSubmittedWork(renderer);

      assertCondition(second.steps === 4, "the replacement compute field must advance");
      assertCondition(
        second.passOneDispatches === 4 && second.passTwoDispatches === 4,
        "both ordered compute passes must run on every fixed-step equivalent",
      );
      assertCondition(releases === 1, "exactly the outgoing field must be released");
      return {
        field: second,
        detail: {
          attachments: 2,
          firstReleased: first.released,
          passesPerStep: 2,
          pingPong: true,
          releases,
          replacementSteps: second.steps,
          warmupNodes: second.warmupNodes.length,
        },
      };
    },
  );
}
