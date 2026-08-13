import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PathFollow3D } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { toon } from "../templates/racing/src/render/palette.js";
import { rankRacers, routeProgress } from "../templates/racing/src/track/Ranking.js";
import { intersectRay } from "../templates/racing/src/track/Track.js";

const racingRoot = path.resolve("packages/create-threenative/templates/racing");

describe("racing route promotion", () => {
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
