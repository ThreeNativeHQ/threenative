import { SceneRenderProjection } from "../../../packages/core/src/renderProjection.js";
import { runMeshBrowser } from "./mesh-browser.js";

const variant = new URLSearchParams(globalThis.location.search).get("variant");
const useProjection = variant !== "rotating-projection-off" && variant !== "rotating-instanced";
runMeshBrowser(
  "tn-web",
  useProjection ? (scene) => new SceneRenderProjection(scene) : undefined,
).catch((error: unknown) => {
  (globalThis as unknown as Record<string, unknown>).__ENGINE_MESH_BENCH_ERROR__ = String(error);
});
