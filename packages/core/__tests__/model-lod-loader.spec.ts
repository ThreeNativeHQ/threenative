import { Mesh, type Object3D, PerspectiveCamera, Scene } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssetLoader } from "../src/assets.js";
import { TN_DISCRETE_LOD, baseGeometryOf, updateModelLods } from "../src/model-lod.js";

// PRD-377 §5/§6 — the real front door. A GLB carrying `TN_discrete_lod` is loaded through
// `createAssetLoader` (which fetches the bytes, decides the decoder set from `extensionsUsed`,
// registers the reader, widens quantized positions and attaches the chain all by itself), and the
// engine's per-frame selection then swaps the mesh to the cheapest level the camera allows.

function padTo4(buffer: Buffer, fill: number): Buffer {
  const remainder = buffer.length % 4;
  if (remainder === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(4 - remainder, fill)]);
}

/**
 * A minimal valid GLB: one quad (2 triangles) with LOD0 indices, one derived 1-triangle level, and
 * the `TN_discrete_lod` extension on the primitive. Written by hand so the loader — not the asset
 * package the pipeline owns — is what this test exercises.
 */
function cookedGlb(): Buffer {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  const baseIndices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const levelIndices = new Uint32Array([0, 1, 2]);
  const binPadded = padTo4(
    Buffer.concat([
      Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength),
      Buffer.from(baseIndices.buffer, baseIndices.byteOffset, baseIndices.byteLength),
      Buffer.from(levelIndices.buffer, levelIndices.byteOffset, levelIndices.byteLength),
    ]),
    0,
  );
  const json = {
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 4,
        max: [1, 1, 0],
        min: [-1, -1, 0],
        type: "VEC3",
      },
      { bufferView: 1, componentType: 5125, count: 6, type: "SCALAR" },
      { bufferView: 2, componentType: 5125, count: 3, type: "SCALAR" },
    ],
    asset: { version: "2.0" },
    bufferViews: [
      { buffer: 0, byteLength: 48, byteOffset: 0, target: 34962 },
      { buffer: 0, byteLength: 24, byteOffset: 48, target: 34963 },
      { buffer: 0, byteLength: 12, byteOffset: 72, target: 34963 },
    ],
    buffers: [{ byteLength: binPadded.length }],
    extensionsUsed: [TN_DISCRETE_LOD],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            extensions: {
              [TN_DISCRETE_LOD]: {
                absoluteErrors: [0.05],
                counts: [1],
                errors: [0.05],
                indices: [2],
                lod0Triangles: 2,
                schemaVersion: 1,
                sharedVertexBuffers: true,
                strategy: "discrete",
              },
            },
            indices: 1,
            mode: 4,
          },
        ],
      },
    ],
    nodes: [{ mesh: 0 }],
    scene: 0,
    scenes: [{ nodes: [0] }],
  };
  const jsonPadded = padTo4(Buffer.from(JSON.stringify(json)), 0x20);
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonPadded.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonPadded.copy(out, 20);
  const binHeader = 20 + jsonPadded.length;
  out.writeUInt32LE(binPadded.length, binHeader);
  out.writeUInt32LE(0x004e4942, binHeader + 4);
  binPadded.copy(out, binHeader + 8);
  return out;
}

function stubFetch(glb: Buffer, manifest?: unknown): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("assets.manifest.json")) {
      if (manifest === undefined) {
        return { headers: { get: () => null }, ok: false, status: 404 };
      }
      return {
        headers: { get: () => "application/json" },
        json: async () => manifest,
        ok: true,
        status: 200,
      };
    }
    return {
      arrayBuffer: async () => glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength),
      ok: true,
      status: 200,
    };
  });
}

function firstMesh(root: Object3D): Mesh {
  let found: Mesh | undefined;
  root.traverse((object) => {
    if (found === undefined && object instanceof Mesh) found = object;
  });
  if (found === undefined) throw new Error("the loaded scene holds no mesh");
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createAssetLoader with a cooked TN_discrete_lod model", () => {
  it("attaches the chain and selects by camera through the normal load path", async () => {
    stubFetch(cookedGlb());
    const loader = createAssetLoader({ basePath: "" });
    const value = await loader.model<{ scene: Object3D }>("hull.glb");
    const mesh = firstMesh(value.scene);
    const base = baseGeometryOf(mesh);
    expect(base.index?.count).toBe(6);
    // LOD0 is what the mesh draws before any selection.
    expect(mesh.geometry.index?.count).toBe(6);

    const scene = new Scene();
    scene.add(mesh);
    const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 100);
    camera.updateMatrixWorld(true);
    const triangles = updateModelLods(scene, camera, 1080);
    expect(triangles).toBe(1);
    expect(mesh.geometry.index?.count).toBe(3);
    // The derived level shares the authored vertices, so no buffer was duplicated.
    expect(mesh.geometry.getAttribute("position")).toBe(base.getAttribute("position"));
    // LOD0 is still recoverable for picking.
    expect(baseGeometryOf(mesh)).toBe(base);
  }, 120_000);

  it("refines to full detail when the camera is close", async () => {
    stubFetch(cookedGlb());
    const loader = createAssetLoader({ basePath: "" });
    const value = await loader.model<{ scene: Object3D }>("hull.glb");
    const mesh = firstMesh(value.scene);
    // A camera against the object returns the base geometry and nothing a selection could coarsen.
    const scene = new Scene();
    scene.add(mesh);
    const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 3);
    camera.updateMatrixWorld(true);
    updateModelLods(scene, camera, 1080);
    expect(mesh.geometry.index?.count).toBe(6);
  }, 120_000);

  it("honours the runtime budget the manifest resolved", async () => {
    stubFetch(cookedGlb(), {
      entries: {
        "hull.glb": {
          kind: "model",
          lod: {
            generated: 1,
            preset: "quality",
            runtime: { hysteresis: 0.15, maxPixelError: 0.1 },
          },
          output: "hull.abc123.glb",
        },
      },
      version: 1,
    });
    const loader = createAssetLoader({ basePath: "" });
    const value = await loader.model<{ scene: Object3D }>("hull.glb");
    const mesh = firstMesh(value.scene);
    const scene = new Scene();
    scene.add(mesh);
    const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 100);
    camera.updateMatrixWorld(true);
    // 0.05 * ~9.5 = ~0.47 px: inside the default 1-pixel budget, outside the manifest's 0.1.
    expect(updateModelLods(scene, camera, 1080)).toBe(2);
    expect(mesh.geometry.index?.count).toBe(6);
  }, 120_000);
});
