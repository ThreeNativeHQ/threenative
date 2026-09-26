import { runMeshBrowser } from "./mesh-browser.js";

runMeshBrowser("plain-three-web").catch((error: unknown) => {
  (globalThis as unknown as Record<string, unknown>).__ENGINE_MESH_BENCH_ERROR__ = String(error);
});
