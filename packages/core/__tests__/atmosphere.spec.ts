import { Group, Vector3 } from "three";
import { float, vec3, vec4 } from "three/tsl";
import { describe, expect, it } from "vitest";
import {
  Atmosphere,
  type IAtmosphereParameters,
  directionalTransmittance,
  solarPosition,
  zenithTransmittance,
} from "../src/atmosphere/index.js";
import type { IRendererLike } from "../src/renderer.js";

const earth: IAtmosphereParameters = {
  rayleigh: [0.005802, 0.013558, 0.0331],
  mie: [0.00444, 0.00444, 0.00444],
  ozone: [0.00065, 0.001881, 0.000085],
  planetRadius: 6360,
  atmosphereRadius: 6460,
};

function renderer(dispatched: unknown[]): IRendererLike {
  const canvas = new EventTarget() as HTMLCanvasElement;
  return {
    compileAsync: async () => undefined,
    compute: (node) => dispatched.push(node),
    dispose: () => undefined,
    domElement: canvas,
    info: {},
    kind: "webgpu",
    raw: {},
    render: () => undefined,
    readback: async () => new ArrayBuffer(0),
    renderOverlay: () => undefined,
    setOutputNode: () => undefined,
    setSize: () => undefined,
    gpuFrameMs: () => undefined,
    resolveGpuFrame: () => undefined,
    setResolutionScale: () => undefined,
    surface: () => ({
      atFloor: false,
      drawingBufferHeight: 1,
      drawingBufferWidth: 1,
      resolutionScale: 1,
      sampleCount: 1,
      scaleSource: "pinned" as const,
    }),
  };
}

describe("Atmosphere", () => {
  it("matches the Earth zenith transmittance fixture", () => {
    expect(zenithTransmittance(earth)).toEqual([
      0.9403587505338243, 0.8676155338551922, 0.7623099761372392,
    ]);
  });

  it("requires every physical coefficient and radius", () => {
    for (const field of ["rayleigh", "mie", "ozone", "planetRadius", "atmosphereRadius"]) {
      const incomplete = { ...earth } as Record<string, unknown>;
      delete incomplete[field];
      expect(() => new Atmosphere(incomplete as never)).toThrow(`Atmosphere.${field}`);
    }
  });

  it("bakes three LUT nodes once, then only rebakes after a parameter change", () => {
    const dispatched: unknown[] = [];
    const atmosphere = new Atmosphere(earth);
    const parent = new Group();
    parent.add(atmosphere);

    expect(atmosphere.warmupNodes).toHaveLength(3);
    expect(atmosphere.luts.transmittance.image).toMatchObject({ width: 256, height: 64 });
    atmosphere.attachRenderer(renderer(dispatched));
    expect(dispatched).toHaveLength(3);

    atmosphere.process();
    expect(dispatched).toHaveLength(3);
    atmosphere.setAtmosphere({ rayleigh: [0.008, 0.016, 0.04] });
    atmosphere.process();
    expect(dispatched).toHaveLength(6);

    parent.remove(atmosphere);
    expect(atmosphere.released).toBe(true);
    expect(() => atmosphere.process()).not.toThrow();
  });

  it("changes its LUT identity when the supplied planet changes", () => {
    const thicker = new Atmosphere({
      ...earth,
      rayleigh: [0.012, 0.027, 0.066],
      ozone: [0, 0, 0],
    });

    expect(thicker.luts.hash).not.toBe(new Atmosphere(earth).luts.hash);
  });

  it("changes the numeric horizon radiance when scattering changes", () => {
    const atmosphere = new Atmosphere(earth);
    const thicker = new Atmosphere({
      ...earth,
      rayleigh: [0.012, 0.027, 0.066],
    });
    const direction = new Vector3(0, 0, 1);

    expect((thicker.radiance(direction) as Vector3).toArray()).not.toEqual(
      (atmosphere.radiance(direction) as Vector3).toArray(),
    );
  });

  it("exposes TSL nodes for radiance, sun transmittance, and depth haze", () => {
    const atmosphere = new Atmosphere(earth);
    const direction = vec3(0, 1, 0);
    const colour = atmosphere.radiance(direction);
    const transmittance = atmosphere.sunTransmittance(direction);
    const scenePass = {
      getTextureNode: () => vec4(0.2, 0.3, 0.4, 1),
    };

    expect((colour as { isNode?: boolean }).isNode).toBe(true);
    expect((transmittance as { isNode?: boolean }).isNode).toBe(true);
    expect(
      (atmosphere.aerialPerspective(scenePass, float(10)) as { isNode?: boolean }).isNode,
    ).toBe(true);
  });

  it("returns physical sun transmittance for numeric directions", () => {
    const atmosphere = new Atmosphere(earth);
    const transmittance = atmosphere.sunTransmittance(new Vector3(0, 1, 0));

    expect(transmittance).toBeInstanceOf(Vector3);
    expect(transmittance.x).toBeCloseTo(0.9403586, 6);
    expect(transmittance.z).toBeCloseTo(0.76231, 6);
  });

  it("rejects a zero direction before normalizing it", () => {
    expect(() => directionalTransmittance(earth, new Vector3())).toThrow(
      "Atmosphere direction must be finite and non-zero",
    );
  });

  it("rejects malformed numeric sun and depth inputs", () => {
    const atmosphere = new Atmosphere(earth);
    expect(() =>
      (atmosphere as unknown as { setSunDirection: (elevation: number) => void }).setSunDirection(
        45,
      ),
    ).toThrow("Atmosphere sun direction requires elevation and azimuth");
    expect(() =>
      atmosphere.aerialPerspective({ getTextureNode: () => vec4(0, 0, 0, 1) }, Number.NaN),
    ).toThrow("Atmosphere depth must be finite");
  });
});

describe("solarPosition", () => {
  it("computes a known solstice elevation from date, latitude, and longitude", () => {
    const position = solarPosition({
      date: new Date("2024-06-21T12:00:00.000Z"),
      latitude: 45,
      longitude: 0,
    });

    expect(position.elevation).toBeCloseTo(68.44, 1);
    expect(position.azimuth).toBeCloseTo(179, 0);
  });

  it("accepts the positional overload", () => {
    const position = solarPosition(new Date("2024-06-21T12:00:00.000Z"), 45, 0);
    expect(position.elevation).toBeCloseTo(68.44, 1);
  });

  it("treats a negative UTC offset as west of UTC", () => {
    const position = solarPosition({
      dayOfYear: 172,
      timeOfDay: 6,
      latitude: 49.28,
      longitude: -123.12,
      utcOffset: -8,
    });

    expect(position.elevation).toBeCloseTo(15.4, 1);
  });

  it("writes changing numeric inputs into a retained result target", () => {
    const input = {
      dayOfYear: 172,
      timeOfDay: 6,
      latitude: 49.28,
      longitude: -123.12,
      utcOffset: -8,
    };
    const target = { azimuth: 0, elevation: 0 };

    expect(solarPosition(input, target)).toBe(target);
    const first = { ...target };
    input.timeOfDay += 1;
    expect(solarPosition(input, target)).toBe(target);
    expect(target).not.toEqual(first);
  });
});
