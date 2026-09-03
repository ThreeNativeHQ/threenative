import { furthestSceneCornerDistance, summariseRoom } from "../runner/sceneRoom.js";
import type { IEvaluationContext } from "./context.js";

/**
 * Bounds on the room the game is played in.
 *
 * `doctor --url` reports the same numbers, but a report is read by whoever runs it and a
 * scenario is read by every later change. These are the frame-destroying cases a screenshot
 * assertion catches only after the fact and cannot explain: an unlit scene of lit materials, a
 * fog that ends in front of what it fogs, a camera that clips the world it is pointed at.
 *
 * Every branch fails closed. A bridge that does not report `scene.observe` has not reported a
 * well-lit scene; it has reported nothing.
 */
export function emitScene(ctx: IEvaluationContext): void {
  const assertion = ctx.scenarioAssertions.scene;
  if (assertion === undefined) return;
  const observed = ctx.input.report.observations?.scene;
  if (observed === undefined) {
    ctx.assertions.push({ details: { expected: assertion, observed: undefined }, id: "scene.observed", pass: false });
    ctx.diagnostics.push({
      code: "TN_PLAYTEST_SCENE_UNOBSERVED",
      message:
        "A scene assertion was evaluated against a run whose bridge reported no scene observation.",
      observedRuntimePath: "observations.json/scene",
      severity: "error",
      suggestion:
        "Install the playtest bridge (core's playtest() plugin, or installThreePlaytestBridge for a plain Three.js project) so the run advertises 'scene.observe', or narrow the scenario. Never delete the assertion to get green.",
    });
    return;
  }
  const summary = summariseRoom(observed);
  const furthest = furthestSceneCornerDistance(summary);

  if (assertion.minVisibleLights !== undefined) {
    const pass = summary.lights.visible >= assertion.minVisibleLights;
    ctx.assertions.push({
      details: { expected: assertion.minVisibleLights, observed: summary.lights.visible, total: summary.lights.count },
      id: "scene.minVisibleLights",
      pass,
    });
    if (!pass)
      ctx.diagnostics.push({
        code: "TN_PLAYTEST_SCENE_UNLIT",
        message: `The scene has ${summary.lights.visible} visible light(s) of ${summary.lights.count} mounted, below the asserted floor of ${assertion.minVisibleLights}.`,
        observedRuntimePath: "observations.json/scene/lights",
        severity: "error",
        suggestion:
          "Add the light the scene is missing, or make the mounted one visible — an invisible light is no light as far as the renderer is concerned.",
      });
  }

  if (assertion.litMaterialsAreLit === true) {
    const pass = summary.litMaterials === 0 || summary.lights.visible > 0;
    ctx.assertions.push({
      details: { litMaterials: summary.litMaterials, visibleLights: summary.lights.visible },
      id: "scene.litMaterialsAreLit",
      pass,
    });
    if (!pass)
      ctx.diagnostics.push({
        code: "TN_PLAYTEST_SCENE_UNLIT",
        message: `${summary.litMaterials} lit material(s) are mounted and no light in the scene is visible, so everything wearing one renders black.`,
        observedRuntimePath: "observations.json/scene/materials",
        severity: "error",
        suggestion:
          "Add a visible light, or move the affected meshes onto a material that does not read one.",
      });
  }

  const fog = summary.fog;
  if (assertion.fogClearsScene === true) {
    // Unmeasurable is not satisfied: without a world extent there is nothing to clear.
    const pass =
      furthest !== undefined && (fog === undefined || fog.type !== "linear" || fog.far === undefined || fog.far >= furthest);
    ctx.assertions.push({
      details: { fogFar: fog?.type === "linear" ? fog.far : undefined, sceneReach: furthest },
      id: "scene.fogClearsScene",
      pass,
    });
    if (!pass)
      ctx.diagnostics.push({
        code: furthest === undefined ? "TN_PLAYTEST_SCENE_UNOBSERVED" : "TN_PLAYTEST_SCENE_FOG_CLIPS",
        message:
          furthest === undefined
            ? "The scene reported no world extent, so there was nothing to measure the fog against."
            : `Fog reaches full ${fog?.color} at ${(fog?.type === "linear" ? fog.far : 0)?.toFixed(1)} units while the scene runs to ${furthest.toFixed(1)} — everything past the far plane is one flat wash.`,
        observedRuntimePath: "observations.json/scene/fog",
        severity: "error",
        suggestion:
          "Move the fog's far plane past the scene, or take the far geometry out of the fog by setting fog: false on its material.",
      });
  }

  if (assertion.cameraClearsScene === true) {
    const far = summary.camera.far;
    const pass = furthest !== undefined && far !== undefined && far >= furthest;
    ctx.assertions.push({
      details: { cameraFar: far, sceneReach: furthest },
      id: "scene.cameraClearsScene",
      pass,
    });
    if (!pass)
      ctx.diagnostics.push({
        code: furthest === undefined || far === undefined ? "TN_PLAYTEST_SCENE_UNOBSERVED" : "TN_PLAYTEST_SCENE_CAMERA_CLIPS",
        message:
          furthest === undefined || far === undefined
            ? "The camera reported no far plane, or the scene reported no world extent, so the two could not be compared."
            : `The camera's far plane is ${far.toFixed(1)} and the scene runs to ${furthest.toFixed(1)} — geometry past it is clipped, not drawn small.`,
        observedRuntimePath: "observations.json/scene/camera",
        severity: "error",
        suggestion:
          "Raise the camera's far plane past the scene's reach, or stop building geometry the camera was never going to draw.",
      });
  }
}
