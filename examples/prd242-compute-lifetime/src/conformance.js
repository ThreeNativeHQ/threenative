import {
  assertCondition,
  startVisualScene,
} from "../../../packages/runtime-native/conformance/scenes/shared/scene-support.js";
import { PingPongField } from "./ping-pong-field.ts";

async function waitForSubmittedWork(renderer) {
  await renderer.backend?.device?.queue?.onSubmittedWorkDone?.();
}

async function warm(field, renderer) {
  assertCondition(field.warmupNodes.length === 2, "compute field must declare two warmup kernels");
  for (const node of field.warmupNodes) await renderer.computeAsync(node);
}

export async function startScene(canvas, dimensions) {
  return startVisualScene(
    canvas,
    dimensions,
    "compute-driven-lifetime",
    async ({ renderer, scene }) => {
      const compute = { compute: (node) => renderer.compute(node) };
      let releases = 0;
      const first = new PingPongField({
        onRelease: () => {
          releases += 1;
        },
      });
      scene.add(first);
      first.attachRenderer(compute);
      await warm(first, renderer);
      for (let index = 0; index < 4; index += 1) first.process(compute);
      await waitForSubmittedWork(renderer);
      first.removeFromParent();
      assertCondition(first.released, "the outgoing compute field must release on scene removal");

      const second = new PingPongField({
        onRelease: () => {
          releases += 1;
        },
      });
      second.position.x = 0.02;
      scene.add(second);
      second.attachRenderer(compute);
      await warm(second, renderer);
      for (let index = 0; index < 4; index += 1) second.process(compute);
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
