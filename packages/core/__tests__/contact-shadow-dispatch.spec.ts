import { PerspectiveCamera, Vector3, WebGPUCoordinateSystem } from "three";
import { describe, expect, it } from "vitest";
import {
  CONTACT_SHADOW_MAX_DISPATCHES,
  CONTACT_SHADOW_WAVE_SIZE,
  type IContactShadowDispatchList,
  buildContactShadowDispatchList,
  contactShadowLightProjection,
  contactShadowWritePixel,
} from "../src/render/contact-shadow-dispatch.js";

function lightCases(width: number, height: number) {
  const camera = new PerspectiveCamera(65, width / height, 0.1, 1000);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const viewProjection = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
  const project = (direction: Vector3) =>
    contactShadowLightProjection(viewProjection.elements, direction);
  const pixelDirection = (x: number, y: number) =>
    new Vector3((x / width) * 2 - 1, 1 - (y / height) * 2, 0.5).unproject(camera).normalize();
  return [
    { name: "front", projection: project(new Vector3(0.3, 0.2, -1).normalize()) },
    { name: "behind", projection: project(new Vector3(-0.3, -0.2, 1).normalize()) },
    { name: "beside", projection: project(new Vector3(1, 0, 0)) },
    { name: "inside", projection: project(pixelDirection(width * 0.37, height * 0.42)) },
    { name: "corner", projection: project(pixelDirection(0, 0)) },
    { name: "far off screen", projection: project(pixelDirection(width * 20, -height * 12)) },
  ];
}

function assertCoverage(
  list: IContactShadowDispatchList,
  width: number,
  height: number,
  label: string,
  bounds: { readonly min: readonly [number, number]; readonly max: readonly [number, number] } = {
    min: [0, 0],
    max: [width - 1, height - 1],
  },
  waveSize = CONTACT_SHADOW_WAVE_SIZE,
): void {
  const writes = new Uint8Array(width * height);
  let outsideDistance = 0;
  let invalidPixels = 0;
  for (const dispatch of list.dispatches) {
    for (let gx = 0; gx < dispatch.groups[0]; gx++) {
      for (let gy = 0; gy < dispatch.groups[1]; gy++) {
        for (let gz = 0; gz < dispatch.groups[2]; gz++) {
          for (let thread = 0; thread < waveSize; thread++) {
            const [x, y] = contactShadowWritePixel(list, dispatch, [gx, gy, gz], thread, waveSize);
            if (!Number.isInteger(x) || !Number.isInteger(y)) invalidPixels++;
            else if (x >= 0 && x < width && y >= 0 && y < height) writes[y * width + x]++;
            else
              outsideDistance = Math.max(
                outsideDistance,
                -x,
                x - (width - 1),
                -y,
                y - (height - 1),
              );
          }
        }
      }
    }
  }
  // The pixel under the light has no ray to cast and is never written. Every other pixel is
  // written at least once. The wavefronts overlap where they fan in towards the light and at the
  // seams between tiles, so a pixel may be written more than once; the kernel gives the same
  // answer for each write. Away from the light the overlap stays small.
  const lightX = Math.floor(list.lightCoordinate[0]);
  const lightY = Math.floor(list.lightCoordinate[1]);
  let missed: string | undefined;
  let maxFarWrites = 0;
  let total = 0;
  for (let y = bounds.min[1]; y <= bounds.max[1]; y++) {
    for (let x = bounds.min[0]; x <= bounds.max[0]; x++) {
      const count = writes[y * width + x];
      total += count;
      const isLight = x === lightX && y === lightY;
      if (count === 0 && !isLight && missed === undefined) missed = `(${x}, ${y})`;
      if (Math.max(Math.abs(x - lightX), Math.abs(y - lightY)) > waveSize) {
        maxFarWrites = Math.max(maxFarWrites, count);
      }
    }
  }
  const area = (bounds.max[0] - bounds.min[0] + 1) * (bounds.max[1] - bounds.min[1] + 1);
  expect.soft(missed, `${label}: first unwritten pixel`).toBeUndefined();
  expect.soft(invalidPixels, `${label}: non-integer pixels`).toBe(0);
  expect
    .soft(maxFarWrites, `${label}: max writes beyond one wave of the light`)
    .toBeLessThanOrEqual(2);
  if (area >= 500_000) {
    expect.soft(total / area, `${label}: mean writes per pixel`).toBeLessThan(1.25);
  }
  expect
    .soft(outsideDistance, `${label}: outside distance=${outsideDistance}`)
    .toBeLessThanOrEqual(2 * waveSize);
}

const totalGroups = (list: IContactShadowDispatchList) =>
  list.dispatches.reduce(
    (sum, dispatch) => sum + dispatch.groups[0] * dispatch.groups[1] * dispatch.groups[2],
    0,
  );

describe("Bend contact-shadow CPU dispatch", () => {
  it("writes every 1920x1080 pixel for front, behind, beside, inside, corner and far-off-screen lights", () => {
    const viewport = { width: 1920, height: 1080 };
    for (const { name, projection } of lightCases(viewport.width, viewport.height)) {
      const list = buildContactShadowDispatchList(projection, viewport);
      if (name === "corner") {
        expect(list.lightCoordinate[0]).toBeCloseTo(0, 8);
        expect(list.lightCoordinate[1]).toBeCloseTo(0, 8);
      }
      assertCoverage(list, viewport.width, viewport.height, name);
    }
  }, 30000);

  it("writes every pixel for odd and 64-aligned viewports", () => {
    for (const [width, height] of [
      [1001, 577],
      [63, 65],
      [1, 1],
      [130, 70],
      [1024, 512],
    ]) {
      for (const { name, projection } of lightCases(width, height)) {
        assertCoverage(
          buildContactShadowDispatchList(projection, { width, height }),
          width,
          height,
          `${width}x${height} ${name}`,
        );
      }
    }
  }, 30000);

  it("issues at most eight nonempty dispatches", () => {
    expect(CONTACT_SHADOW_MAX_DISPATCHES).toBe(8);
    expect(CONTACT_SHADOW_WAVE_SIZE).toBe(64);
    for (const [width, height] of [
      [1920, 1080],
      [1001, 577],
      [63, 65],
      [1, 1],
      [130, 70],
    ]) {
      for (const { projection } of lightCases(width, height)) {
        const list = buildContactShadowDispatchList(projection, { width, height });
        // A 1x1 viewport holding only the light's own pixel needs no work.
        if (width * height > 1) expect(list.dispatches.length).toBeGreaterThan(0);
        expect(list.dispatches.length).toBeLessThanOrEqual(CONTACT_SHADOW_MAX_DISPATCHES);
        for (const dispatch of list.dispatches) {
          expect(dispatch.groups[0]).toBe(CONTACT_SHADOW_WAVE_SIZE);
          for (const count of dispatch.groups) {
            expect(Number.isInteger(count)).toBe(true);
            expect(count).toBeGreaterThanOrEqual(1);
          }
          for (const offset of dispatch.waveOffset)
            expect(Math.abs(offset % CONTACT_SHADOW_WAVE_SIZE)).toBe(0);
        }
      }
    }
  });

  it("bounds reduce total groups while keeping inclusive coverage", () => {
    const viewport = { width: 1920, height: 1080 };
    const bounds = { min: [301, 203], max: [700, 510] } as const;
    for (const { name, projection } of lightCases(viewport.width, viewport.height)) {
      const full = buildContactShadowDispatchList(projection, viewport);
      const bounded = buildContactShadowDispatchList(projection, viewport, { bounds });
      expect(totalGroups(bounded), name).toBeLessThan(totalGroups(full));
      assertCoverage(bounded, viewport.width, viewport.height, `${name} bounded`, bounds);
    }
  }, 30000);

  it("preserves the sign of w and guards lights on the camera plane", () => {
    const viewport = { width: 1920, height: 1080 };
    for (const { name, projection } of lightCases(viewport.width, viewport.height)) {
      const list = buildContactShadowDispatchList(projection, viewport);
      expect(list.lightCoordinate[3]).toBe(projection[3] > 0 ? 1 : -1);
      if (name === "beside") {
        expect(projection[3]).toBe(0);
        expect(list.lightCoordinate.every(Number.isFinite)).toBe(true);
        expect(list.lightCoordinate[2]).toBe(0);
        const limit = 0.000002 * CONTACT_SHADOW_WAVE_SIZE;
        expect(list.lightCoordinate[0]).toBe(
          Math.fround(((projection[0] / limit) * 0.5 + 0.5) * viewport.width),
        );
      }
      const expanded = buildContactShadowDispatchList(projection, viewport, {
        expandedZRange: true,
      });
      expect(expanded.lightCoordinate[2]).toBe(list.lightCoordinate[2] * 0.5 + 0.5);
    }
    const projection = lightCases(viewport.width, viewport.height)[2].projection;
    for (const w of [1e-8, -1e-8]) {
      const list = buildContactShadowDispatchList([projection[0], projection[1], 0, w], viewport);
      expect(list.lightCoordinate[0]).toBe(
        Math.fround(
          ((projection[0] / (Math.sign(w) * 0.000002 * CONTACT_SHADOW_WAVE_SIZE)) * 0.5 + 0.5) *
            viewport.width,
        ),
      );
      expect(list.lightCoordinate[3]).toBe(Math.sign(w));
    }
  });

  it("multiplies a real camera's column-major matrix by (direction, 0)", () => {
    const camera = new PerspectiveCamera(71, 16 / 9, 0.2, 1200);
    camera.coordinateSystem = WebGPUCoordinateSystem;
    camera.updateProjectionMatrix();
    camera.position.set(3, 5, 7);
    camera.lookAt(-2, 1, -4);
    camera.updateMatrixWorld();
    const matrix = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).elements;
    const direction = new Vector3(2, -3, 4).normalize();
    const expected = [
      matrix[0] * direction.x + matrix[4] * direction.y + matrix[8] * direction.z,
      matrix[1] * direction.x + matrix[5] * direction.y + matrix[9] * direction.z,
      matrix[2] * direction.x + matrix[6] * direction.y + matrix[10] * direction.z,
      matrix[3] * direction.x + matrix[7] * direction.y + matrix[11] * direction.z,
    ];
    expect(contactShadowLightProjection(matrix, direction)).toEqual(expected);
  });

  it("rejects invalid viewport, wave size, projection, bounds, matrix and direction inputs", () => {
    const viewport = { width: 1920, height: 1080 };
    const projection = lightCases(viewport.width, viewport.height)[0].projection;
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        buildContactShadowDispatchList(projection, { ...viewport, width: value }),
      ).toThrow(/viewport.width/u);
      expect(() =>
        buildContactShadowDispatchList(projection, { ...viewport, height: value }),
      ).toThrow(/viewport.height/u);
      expect(() =>
        buildContactShadowDispatchList(projection, viewport, { waveSize: value }),
      ).toThrow(/waveSize/u);
    }
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (let component = 0; component < 4; component++) {
        const invalid: [number, number, number, number] = [...projection];
        invalid[component] = value;
        expect(() => buildContactShadowDispatchList(invalid, viewport)).toThrow(/lightProjection/u);
      }
    }
    for (const bounds of [
      { min: [10, 0], max: [9, 20] },
      { min: [0, 10], max: [20, 9] },
      { min: [Number.NaN, 0], max: [20, 20] },
    ] as const) {
      expect(() => buildContactShadowDispatchList(projection, viewport, { bounds })).toThrow(
        /bounds/u,
      );
    }
    const matrix = new PerspectiveCamera().projectionMatrix.elements;
    expect(() => contactShadowLightProjection(matrix.slice(0, 15), new Vector3(1, 2, 3))).toThrow(
      /viewProjection/u,
    );
    expect(() =>
      contactShadowLightProjection(
        matrix.map(() => Number.NaN),
        new Vector3(1, 2, 3),
      ),
    ).toThrow(/viewProjection/u);
    for (const component of ["x", "y", "z"] as const) {
      const direction = new Vector3(1, 2, 3);
      direction[component] = Number.NaN;
      expect(() => contactShadowLightProjection(matrix, direction)).toThrow(/directionToLight/u);
    }
  });
});
