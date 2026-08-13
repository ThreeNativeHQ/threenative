import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { PathFollow3D } from "../src/path-follow.js";

const points = [new Vector3(0, 0, 0), new Vector3(4, 0, 0), new Vector3(8, 0, 4)];

describe("PathFollow3D", () => {
  it("advances by route distance and clamps an open path", () => {
    const follow = new PathFollow3D({ points, speed: 4 });
    const start = follow.sample();
    follow.advance(0.5);

    expect(follow.progress).toBeCloseTo(2, 5);
    expect(follow.sample().point.distanceTo(start.point)).toBeGreaterThan(0.5);
    follow.advance(100);
    expect(follow.completed).toBe(true);
    expect(follow.progress).toBe(follow.totalLength);
  });

  it("wraps a loop while preserving a normalized tangent", () => {
    const follow = new PathFollow3D({ points, loop: true, speed: 10 });
    follow.advance(follow.totalLength / 10);
    const sample = follow.sample(follow.totalLength * 2.5);

    expect(follow.completed).toBe(false);
    expect(sample.progress).toBeCloseTo(follow.totalLength * 0.5, 5);
    expect(sample.tangent.length()).toBeCloseTo(1, 5);
  });

  it("projects a loop route with a normalized tangent", () => {
    const route = new PathFollow3D({
      loop: true,
      points: [
        new Vector3(10, 0, -10),
        new Vector3(10, 0, 10),
        new Vector3(-10, 0, 10),
        new Vector3(-10, 0, -10),
      ],
    });
    const projection = route.project(new Vector3(9.5, 0, -10));
    expect(projection.lateralDistance).toBeLessThan(1);
    expect(projection.distanceFromStart).toBeLessThan(route.totalLength);
    expect(projection.tangent.length()).toBeCloseTo(1, 5);
  });

  it("projects an open path endpoint using the final segment direction", () => {
    const route = new PathFollow3D({ points });
    const endpoint = route.sample(route.totalLength).point;
    const projection = route.project(endpoint);
    const previous = points.at(-2);
    const last = points.at(-1);
    if (previous === undefined || last === undefined)
      throw new Error("Endpoint fixture is incomplete.");
    const finalDirection = last.clone().sub(previous).normalize();

    expect(projection.point.distanceTo(endpoint)).toBeCloseTo(0, 5);
    expect(projection.distanceFromStart).toBe(route.totalLength);
    expect(projection.tangent.length()).toBeCloseTo(1, 5);
    expect(projection.tangent.dot(finalDirection)).toBeGreaterThan(0.9);
  });

  it("rejects malformed routes and deltas", () => {
    expect(() => new PathFollow3D({ points: points.slice(0, 2) })).toThrow(/three points/u);
    expect(() => new PathFollow3D({ points, speed: -1 })).toThrow(/speed/u);
    const follow = new PathFollow3D({ points });
    expect(() => follow.advance(-1)).toThrow(/delta/u);
    expect(() => follow.progressTo(Number.NaN)).toThrow(/progress/u);
  });
});
