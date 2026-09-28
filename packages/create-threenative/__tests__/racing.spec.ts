import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PathFollow3D } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { CAR, FEEL, RIDE, SAG } from "../templates/racing/src/entities/CarBody.js";
import { headingError } from "../templates/racing/src/entities/Rival.js";
import { cameraBank, chaseCamera } from "../templates/racing/src/render/camera.js";
import { toon } from "../templates/racing/src/render/palette.js";
import { rankRacers, routeProgress } from "../templates/racing/src/track/Ranking.js";
import {
  GRID,
  KERB_HEIGHT,
  TOTAL_LAPS,
  intersectRay,
} from "../templates/racing/src/track/Track.js";

const racingRoot = path.resolve("packages/create-threenative/templates/racing");

describe("racing route promotion", () => {
  it("keeps the horizon upright and banks from lateral load, not from world x", () => {
    const camera = new PerspectiveCamera();
    const target = new Vector3(-3, RIDE, -18);
    const heading = new Vector3(1, 0, 0);

    // Facing along +x is the case the old `cameraRoll` got wrong: it banked on `heading.x`, so on
    // this straight — and on every straight of a square circuit — the horizon tilted for no reason.
    chaseCamera(camera, target, heading, 1);
    camera.rotateZ(cameraBank(0, FEEL.lateral));
    const level = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    expect(Math.abs(level.z)).toBeLessThan(0.05);
    expect(level.y).toBeGreaterThan(0.8);

    // Loaded to the right, the camera leans with the car and no more.
    const banked = cameraBank(FEEL.lateral, FEEL.lateral);
    expect(banked).toBeGreaterThan(0);
    expect(cameraBank(FEEL.lateral * 4, FEEL.lateral)).toBe(banked);
    expect(cameraBank(-FEEL.lateral, FEEL.lateral)).toBe(-banked);
  });

  it("anchors the chase camera to measured velocity, so a sliding car keeps the corner in view", () => {
    const camera = new PerspectiveCamera();
    const target = new Vector3(0, RIDE, 0);
    // The nose points along +x while the car is travelling along +z: a car sideways in a corner.
    // Anchored to the nose the camera would sit off to the side, looking at the tarmac.
    const sliding = chaseCamera(camera, target, new Vector3(1, 0, 0), 1, { x: 0, y: 0, z: 8 });
    expect(sliding).toBeUndefined();
    expect(camera.position.z).toBeLessThan(-5);
    expect(Math.abs(camera.position.x)).toBeLessThan(1);
  });

  it("drives both cars on the same measured chassis, with the boost as the only speed difference", () => {
    const player = readFileSync(path.join(racingRoot, "src/entities/RacingCar.ts"), "utf8");
    const rival = readFileSync(path.join(racingRoot, "src/entities/Rival.ts"), "utf8");
    const chassis = readFileSync(path.join(racingRoot, "src/entities/CarBody.ts"), "utf8");

    // One `VehicleBody3D`, one chassis, two drivers. The defect this replaces was a car whose speed
    // and heading were numbers it rewrote every frame; neither driver may own a speed any more.
    expect(chassis).toContain("VehicleBody3D");
    expect(player).toContain("new CarBody");
    expect(rival).toContain("new CarBody");
    for (const source of [player, rival]) {
      expect(source).toContain("engineForce");
      expect(source).toContain("brake");
      // The two fields the fake kept as its own truth. Read the source, not the prose: the
      // comment above `RacingCar` names both of them while describing what replaced them.
      expect(source.replace(/\/\*[\s\S]*?\*\//gu, "")).not.toMatch(/#speed\b\s*=|#heading\b/u);
    }
    // The suspension is measured, not assumed: the sag is gravity over four times the stiffness.
    expect(SAG).toBeCloseTo(CAR.gravity / (4 * CAR.suspensionStiffness), 10);
    expect(RIDE).toBeCloseTo(CAR.suspensionRestLength - SAG, 10);
    expect(RIDE).toBeGreaterThan(0.15);
    // A kerb is a rumble strip, not a wall, and the chassis collider is what decides that.
    expect(KERB_HEIGHT).toBeLessThan(RIDE - CAR.shape.height / 2);
  });

  it("puts the two cars on their own grid slots, behind the finish line they are lapped on", () => {
    expect(GRID.rival.x).toBeGreaterThan(GRID.player.x);
    // Both on the same straight, and both short of the finish gate at x = 10, so the first gate a
    // car meets is the one the lap is counted on rather than a shortcut on the run to the corner.
    expect(GRID.player.z).toBe(GRID.rival.z);
    expect(GRID.rival.x).toBeLessThan(10);
    expect(TOTAL_LAPS).toBe(3);
  });

  it("steers the rival toward the line instead of away from it", () => {
    const from = new Vector3(0, 0, 0);
    // Facing +x. A point ahead and to the driver's right (+z) is a positive error; one to the left
    // is negative. Getting this backwards drives the rival into the tyre wall at the first corner,
    // which is a two-minute playtest loop to find and one line to fix.
    expect(headingError(0, new Vector3(4, 0, 2), from)).toBeGreaterThan(0);
    expect(headingError(0, new Vector3(4, 0, -2), from)).toBeLessThan(0);
    expect(headingError(0, new Vector3(6, 0, 0), from)).toBeCloseTo(0, 10);
    // Wrapped, so a target behind the car is 180° rather than 540°.
    expect(headingError(Math.PI, new Vector3(-5, 0, 0), from)).toBeCloseTo(0, 6);
  });

  it("keeps lap-aware progress and ranking in the racing template", () => {
    const route = new PathFollow3D({
      loop: true,
      points: [
        new Vector3(10, 0, -10),
        new Vector3(10, 0, 10),
        new Vector3(-10, 0, 10),
        new Vector3(-10, 0, -10),
      ],
    });
    const position = route.pointAt(route.totalLength / 4).point;
    const ranked = rankRacers(route, [
      { id: "racer-0-behind", lap: 0, position },
      { id: "racer-1-ahead", lap: 1, position },
    ]);

    expect(ranked.map(({ id }) => id)).toEqual(["racer-1-ahead", "racer-0-behind"]);
    expect(ranked[0]?.place).toBe(1);
    expect(ranked[0]?.routeProgress).toBeGreaterThan(route.totalLength);
    expect(routeProgress(route, position, 1)).toBe(ranked[0]?.routeProgress);
    expect(() => routeProgress(route, position, -1)).toThrow(/lap/u);
  });

  it("uses PathFollow3D directly and removes the duplicate source", () => {
    const track = readFileSync(path.join(racingRoot, "src/track/Track.ts"), "utf8");
    const rival = readFileSync(path.join(racingRoot, "src/entities/Rival.ts"), "utf8");
    const sector = readFileSync(path.join(racingRoot, "src/track/TrackSector.ts"), "utf8");
    const sources = `${track}\n${rival}\n${sector}`;

    expect(existsSync(path.join(racingRoot, "src/track/Driveline.ts"))).toBe(false);
    expect(sources).toContain("PathFollow3D");
    expect(sources).not.toMatch(/Driveline|driveline/u);
  });

  it("uses the direct-space ray query and only falls back without that API", () => {
    const query = vi.fn(() => ({ distance: 2, normal: { x: 0, y: 1, z: 0 } }));
    const fallback = vi.fn(() => ({ distance: 99, normalY: -1 }));
    const physics = {
      directSpaceState: { intersectRay: query },
    } as unknown as IPhysicsContext;
    const origin = new Vector3(3, 4, 5);
    const direction = new Vector3(0, -1, 0);

    expect(intersectRay(physics, fallback)(origin, direction, 6)).toEqual({
      distance: 2,
      normalY: 1,
    });
    expect(query).toHaveBeenCalledWith({
      collisionMask: 2,
      from: origin,
      to: new Vector3(3, -2, 5),
    });
    expect(fallback).not.toHaveBeenCalled();

    const fallbackOnly = vi.fn(() => ({ distance: 1, normalY: 0 }));
    expect(intersectRay({} as IPhysicsContext, fallbackOnly)(origin, direction, 6)).toEqual({
      distance: 1,
      normalY: 0,
    });
    expect(fallbackOnly).toHaveBeenCalledOnce();
  });

  it("keeps a direct-space no-hit result instead of probing the visual meshes", () => {
    const query = vi.fn(() => undefined);
    const fallback = vi.fn(() => ({ distance: 99 }));
    const physics = {
      directSpaceState: { intersectRay: query },
    } as unknown as IPhysicsContext;

    expect(
      intersectRay(physics, fallback)(new Vector3(), new Vector3(0, -1, 0), 2),
    ).toBeUndefined();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("keys toon materials by color and roughness", () => {
    const matte = toon(0x4a7f93, 0.2);
    const glossy = toon(0x4a7f93, 0.8);

    expect(glossy).not.toBe(matte);
    expect(matte.roughness).toBe(0.2);
    expect(glossy.roughness).toBe(0.8);
    expect(toon(0x4a7f93, 0.2)).toBe(matte);
    expect(toon(0x4a7f93, 0.8)).toBe(glossy);
  });
});
