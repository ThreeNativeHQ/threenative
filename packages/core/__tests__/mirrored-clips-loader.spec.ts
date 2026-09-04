import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssetLoader } from "../src/assets.js";

/**
 * A rig whose four voting bones sit off the origin on Z, and one clip holding each of them at the
 * negation of its own bind — the signature `reconcileMirroredClips` votes on. Built as bytes, not
 * as three objects, because what is under test is the loader's own GLTFLoader path: the repair and
 * its report only run there, and `options.model` skips both.
 */
function rigGlb(mirrored: boolean): Uint8Array {
  const bones = [
    { name: "hip", translation: [0, 0, 0] },
    { name: "spine", translation: [0, 0.1, 0.4] },
    { name: "head", translation: [0, 0.05, 0.3] },
    { name: "leg-L", translation: [0.2, 0, 0.1] },
    { name: "leg-R", translation: [-0.2, 0, 0.1] },
  ];
  const animated = bones.slice(1);
  const times = [0, 1];
  const floats: number[] = [];
  const accessors: Record<string, unknown>[] = [];
  const bufferViews: Record<string, unknown>[] = [];
  const push = (values: readonly number[], type: string, count: number): number => {
    bufferViews.push({ buffer: 0, byteLength: values.length * 4, byteOffset: floats.length * 4 });
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count, type });
    floats.push(...values);
    return accessors.length - 1;
  };
  // glTF requires a skin's inverse bind matrices; three needs them to build the Skeleton.
  const inverseBind = bones.flatMap(({ translation }) => [
    ...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    ...translation.map((value) => -value),
    1,
  ]);
  const inverseBindAccessor = push(inverseBind, "MAT4", bones.length);
  const timeAccessor = push(times, "SCALAR", times.length);
  const channels: Record<string, unknown>[] = [];
  const samplers: Record<string, unknown>[] = [];
  for (const [index, bone] of animated.entries()) {
    const [x = 0, y = 0, z = 0] = bone.translation;
    const clipZ = mirrored ? -z : z;
    samplers.push({
      input: timeAccessor,
      interpolation: "LINEAR",
      output: push([x, y, clipZ, x, y, clipZ], "VEC3", times.length),
    });
    channels.push({ sampler: index, target: { node: index + 1, path: "translation" } });
  }

  const json = {
    accessors,
    animations: [{ channels, name: "walk", samplers }],
    asset: { generator: "threenative test fixture", version: "2.0" },
    bufferViews,
    buffers: [{ byteLength: floats.length * 4 }],
    nodes: [
      ...bones.map((bone, index) => ({
        name: bone.name,
        translation: bone.translation,
        ...(index === 0 ? { children: [1, 3, 4] } : {}),
        ...(index === 1 ? { children: [2] } : {}),
      })),
      { name: "rig", children: [0], skin: 0 },
    ],
    scene: 0,
    scenes: [{ nodes: [bones.length] }],
    skins: [{ inverseBindMatrices: inverseBindAccessor, joints: bones.map((_, index) => index) }],
  };

  const pad = (bytes: Uint8Array, filler: number): Uint8Array => {
    if (bytes.byteLength % 4 === 0) return bytes;
    const padded = new Uint8Array(bytes.byteLength + (4 - (bytes.byteLength % 4)));
    padded.set(bytes);
    padded.fill(filler, bytes.byteLength);
    return padded;
  };
  const jsonChunk = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binChunk = pad(new Uint8Array(new Float32Array(floats).buffer), 0);
  const glb = new Uint8Array(12 + 8 + jsonChunk.byteLength + 8 + binChunk.byteLength);
  const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, glb.byteLength, true);
  view.setUint32(12, jsonChunk.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  glb.set(jsonChunk, 20);
  view.setUint32(20 + jsonChunk.byteLength, binChunk.byteLength, true);
  view.setUint32(24 + jsonChunk.byteLength, 0x004e4942, true);
  glb.set(binChunk, 28 + jsonChunk.byteLength);
  return glb;
}

/** Serves the model bytes and nothing else; a missing manifest is a 404, as on a bare web root. */
function serve(bytes: Uint8Array): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) =>
    url.endsWith(".glb")
      ? new Response(bytes.slice() as unknown as BodyInit, { status: 200 })
      : new Response(null, { status: 404 }),
  );
}

describe("the loader's mirrored-clip repair", () => {
  // Spies restore here rather than at the end of each test, so a failing assertion cannot leave
  // console patched and make the next test read another test's calls.
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("warns that a repaired file is a conversion bug, naming the file", async () => {
    vi.stubGlobal("fetch", serve(rigGlb(true)));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const model = await createAssetLoader().model<{ animations: { tracks: unknown[] }[] }>(
      "ue/Models/SK_Wolf.glb",
    );

    expect(model.animations).toHaveLength(1);
    // A file that needed repairing is a defect in whatever converted it, so it is a warning the
    // owner of that file has to see — not an info line among a loading log's hundreds.
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0] as [string];
    expect(message).toContain("TN_ASSETS_MIRRORED_CLIPS_REPAIRED");
    expect(message).toContain("ue/Models/SK_Wolf.glb");
    // The reader has to learn it is not their bug and that re-importing clears it.
    expect(message).toMatch(/re-import|reimport/iu);
    expect(info).not.toHaveBeenCalled();
  });

  it("repairs the clips it warns about, so the loaded model already plays forwards", async () => {
    vi.stubGlobal("fetch", serve(rigGlb(true)));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const model = await createAssetLoader().model<{
      animations: { tracks: { name: string; values: Float32Array }[] }[];
    }>("ue/Models/SK_Wolf.glb");
    const spine = model.animations[0]?.tracks.find((track) =>
      track.name.endsWith("spine.position"),
    );

    expect(spine?.values[2]).toBeCloseTo(0.4, 6);
  });

  it("says nothing about a file that arrives correct", async () => {
    // The same rig, with clips that agree with their own bind pose.
    vi.stubGlobal("fetch", serve(rigGlb(false)));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await createAssetLoader().model("ue/Models/SK_Wolf.glb");

    expect(warn).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });
});
