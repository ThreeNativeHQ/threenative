import { DepthTexture, Mesh } from "three";
import { WGSLNodeBuilder } from "three/webgpu";
import { describe, expect, it } from "vitest";

interface ITextureLoadBuilder {
  generateTextureLoad(
    texture: unknown,
    property: string,
    uv: string,
    level: string | null,
    depth: string | null,
    offset: string | null,
  ): string;
}

function builderWithSamples(primarySamples: number): ITextureLoadBuilder {
  const renderer = {
    backend: {
      capabilities: { getUniformBufferLimit: () => 65_536 },
      compatibilityMode: false,
      device: {},
      utils: { getTextureSampleData: () => ({ primarySamples }) },
    },
    hasCompatibility: () => false,
    hasFeature: () => false,
  } as never;
  return new WGSLNodeBuilder(
    new Mesh(undefined, undefined),
    renderer,
  ) as unknown as ITextureLoadBuilder;
}

// naga v25 (wgpu-native v25.0.2.2) rejects a u32 sample index on a multisampled
// textureLoad while every backend accepts i32, so the multisampled operand must
// be i32 and the mip-level operand stays u32.
describe("WGSL multisampled textureLoad sample index", () => {
  it("emits an i32 sample index for a multisampled depth texture", () => {
    const builder = builderWithSamples(4);
    const snippet = builder.generateTextureLoad(
      new DepthTexture(4, 4),
      "nodeUniform4",
      "vec2( 0, 0 )",
      null,
      null,
      null,
    );

    expect(snippet).toBe("textureLoad( nodeUniform4, vec2( 0, 0 ), i32( 0u ) )");
  });

  it("keeps a u32 mip level for a single-sampled texture", () => {
    const builder = builderWithSamples(1);
    const snippet = builder.generateTextureLoad(
      new DepthTexture(4, 4),
      "nodeUniform4",
      "vec2( 0, 0 )",
      null,
      null,
      null,
    );

    expect(snippet).toBe("textureLoad( nodeUniform4, vec2( 0, 0 ), u32( 0u ) )");
  });

  it("keeps the mip-level operand u32 for array textures", () => {
    const builder = builderWithSamples(4);
    const snippet = builder.generateTextureLoad(
      new DepthTexture(4, 4),
      "nodeUniform4",
      "vec2( 0, 0 )",
      "0",
      "0",
      null,
    );

    expect(snippet).toContain("u32( 0 )");
    expect(snippet).not.toContain("i32(");
  });
});
