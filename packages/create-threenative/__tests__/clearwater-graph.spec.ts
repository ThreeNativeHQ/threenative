import { RippleField, Scene, SpectralOcean, WaterSurface3D } from "@threenative/core";
import { describe, expect, it } from "vitest";
import { createClearwater } from "../template-assets/clearwater/src/clearwater.js";
import { ClearwaterDemo } from "../template-assets/clearwater/src/clearwaterDemo.js";
import { createClearwaterAppearance } from "../template-assets/clearwater/src/render/clearwater.js";
import { resolveClearwaterOptions } from "../template-assets/clearwater/src/render/clearwaterOptions.js";

// Real Three.js/engine nodes, not a fake shader API. This catches graph construction errors;
// it does not pretend to compile WGSL or prove pixels without a WebGPU adapter.
describe("Clearwater graph construction", () => {
  it("loads the public factory and optional scene without allocating a renderer", () => {
    expect(createClearwater).toBeTypeOf("function");
    expect(new ClearwaterDemo()).toBeInstanceOf(Scene);
  });
  it("composes real fields, three dispersion passes and idempotent owned-resource disposal", () => {
    const options = resolveClearwaterOptions({ center: [4, -3], level: 2 });
    const ocean = new SpectralOcean({
      resolution: 32, cascades: [{ patchSize: 8 }, { patchSize: 2 }], windSpeed: 1.8,
      windDirection: 0.55, gravity: 9.81, amplitude: 0.00012, directionality: 1.5,
      choppiness: 0, smallWaveCutoff: 0.08, seed: 1,
      readbackResolution: 0, readbackEveryFrames: 1,
    });
    const ripples = new RippleField({ resolution: 32, size: 7, speed: 1.2 });
    const surface = new WaterSurface3D({ level: 2, maxThickness: 24, reflection: { resolutionScale: 0.5 } });
    try {
      const water = createClearwaterAppearance(ocean, ripples, surface, options);
      try {
        expect(water.material.positionNode).toBeDefined();
        expect(water.material.colorNode).toBeDefined();
        expect(water.material.transparent).toBe(true);
        expect(water.material.depthWrite).toBe(false);
        expect(water.caustics?.scene.children).toHaveLength(3);
        expect(water.caustics?.texture.image).toMatchObject({ width: 512 });
        expect(water.level.value).toBe(2);
        let geometryReleases = 0;
        let materialReleases = 0;
        water.mesh.geometry.addEventListener("dispose", () => { geometryReleases++; });
        water.material.addEventListener("dispose", () => { materialReleases++; });
        ripples.impulse(0, 0, 0.3, -0.04);
        ripples.advance(1 / 60);
        water.uploadRipples();
        water.dispose();
        water.dispose();
        expect(geometryReleases).toBe(1);
        expect(materialReleases).toBe(1);
      } finally {
        water.dispose();
      }
    } finally {
      surface.dispose();
      ocean.detach();
    }
  });
});
