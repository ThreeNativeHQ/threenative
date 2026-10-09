/**
 * PRD-540: the web GLTFLoader under engine "native" hands the bytes to the engine glTF loader and
 * answers in GLTFLoader's shape; a codec or plugin the engine loader lacks is refused by name.
 */
import { describe, expect, it, vi } from "vitest";

const loaded: Uint8Array[] = [];
vi.mock("three", () => ({
  __tnLoadGltf(bytes: Uint8Array) {
    loaded.push(bytes);
    return { scene: { name: "scene" }, animations: [{ name: "fly" }] };
  },
}));

const { GLTFLoader } = await import("../src/addons/gltf-loader-web.js");

describe("web GLTFLoader over the engine", () => {
  it("parses through the engine loader into GLTFLoader's result", async () => {
    const bytes = new Uint8Array([103, 108, 84, 70]).buffer;
    const gltf = await new GLTFLoader().parseAsync(bytes, "aircraft.glb");
    expect(loaded.at(-1)).toEqual(new Uint8Array([103, 108, 84, 70]));
    expect(gltf.scene).toEqual({ name: "scene" });
    expect(gltf.scenes).toEqual([{ name: "scene" }]);
    expect(gltf.animations).toEqual([{ name: "fly" }]);
  });

  it("refuses the decoders and plugins the engine loader does not take", () => {
    const loader = new GLTFLoader();
    expect(() => loader.setKTX2Loader()).toThrow("TN_NATIVE_GLTF_KTX2_UNSUPPORTED");
    expect(() => loader.setMeshoptDecoder()).toThrow("TN_NATIVE_GLTF_MESHOPT_UNSUPPORTED");
    expect(() => loader.register()).toThrow("TN_NATIVE_GLTF_PLUGIN_UNSUPPORTED");
  });
});
