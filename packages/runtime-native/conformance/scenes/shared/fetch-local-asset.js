import { assertCondition, startBehaviorScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startBehaviorScene(canvas, dimensions, "fetch-local-asset", async () => {
    assertCondition(typeof globalThis.__TN_ASSET_BASE__ === "string", "asset base must exist");
    const response = await fetch(`${globalThis.__TN_ASSET_BASE__}conformance/README.md`);
    assertCondition(response.ok, `local fetch failed with status ${response.status}`);
    const text = await response.text();
    assertCondition(
      text.includes("ThreeNative conformance harness"),
      "local fetch returned wrong asset",
    );
    return { status: response.status, bytes: text.length };
  });
}
