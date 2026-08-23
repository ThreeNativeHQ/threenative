import { Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
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

  it("fills caller targets for samples and projections", () => {
    const follow = new PathFollow3D({ points, speed: 4 });
    const sampleTarget = { point: new Vector3(), progress: 0, tangent: new Vector3() };
    const sample = follow.advance(0.5, sampleTarget);

    expect(sample).toBe(sampleTarget);
    expect(sample.point).toBe(sampleTarget.point);
    expect(sample.tangent).toBe(sampleTarget.tangent);

    const projectionTarget = {
      distanceFromStart: 0,
      lateralDistance: 0,
      point: new Vector3(),
      segment: 0,
      tangent: new Vector3(),
    };
    const projection = follow.project(new Vector3(1, 0, 0), projectionTarget);

    expect(projection).toBe(projectionTarget);
    expect(projection.point).toBe(projectionTarget.point);
    expect(projection.tangent).toBe(projectionTarget.tangent);
  });

  it("refills the same targets on repeated live calls", () => {
    const follow = new PathFollow3D({ points, speed: 4 });
    const sampleTarget = { point: new Vector3(), progress: 0, tangent: new Vector3() };
    const first = follow.advance(0.5, sampleTarget);
    const firstProgress = sampleTarget.progress;
    const second = follow.advance(0.5, sampleTarget);

    expect(first).toBe(sampleTarget);
    expect(second).toBe(first);
    expect(sampleTarget.progress).toBeGreaterThan(firstProgress);
  });

  it("passes targets through Three.js tangent sampling", () => {
    const follow = new PathFollow3D({ points, speed: 4 });
    const target = { point: new Vector3(), progress: 0, tangent: new Vector3() };
    const getPoint = vi.spyOn(follow.curve, "getPoint");

    follow.sample(0.5, target);

    for (const [, optionalTarget] of getPoint.mock.calls) expect(optionalTarget).toBeDefined();
  });

  it("keeps repeated target projections off allocation-producing array helpers", () => {
    const follow = new PathFollow3D({ points });
    const target = {
      distanceFromStart: 0,
      lateralDistance: 0,
      point: new Vector3(),
      segment: 0,
      tangent: new Vector3(),
    };
    const every = vi.spyOn(Array.prototype, "every");
    const entries = vi.spyOn(Array.prototype, "entries");
    const position = new Vector3(1, 0, 0);
    let usedEvery = false;
    let usedEntries = false;
    try {
      for (let index = 0; index < 8; index += 1) follow.project(position, target);
    } finally {
      usedEvery = every.mock.calls.length > 0;
      usedEntries = entries.mock.calls.length > 0;
      every.mockRestore();
      entries.mockRestore();
    }

    expect(usedEvery).toBe(false);
    expect(usedEntries).toBe(false);
  });

  it("keeps allocating results safe to retain", () => {
    const follow = new PathFollow3D({ points });
    const first = follow.sample(1);
    const firstPoint = first.point.clone();
    const second = follow.pointAt(2);
    const firstProjection = follow.project(new Vector3(1, 0, 0));
    const firstProjectionPoint = firstProjection.point.clone();
    const secondProjection = follow.project(new Vector3(2, 0, 0));

    expect(second).not.toBe(first);
    expect(first.point).toEqual(firstPoint);
    expect(second.point).not.toEqual(first.point);
    expect(secondProjection).not.toBe(firstProjection);
    expect(firstProjection.point).toEqual(firstProjectionPoint);
    expect(secondProjection.point).not.toEqual(firstProjection.point);
  });

  it("rejects malformed routes and deltas", () => {
    expect(() => new PathFollow3D({ points: points.slice(0, 2) })).toThrow(/three points/u);
    expect(() => new PathFollow3D({ points, speed: -1 })).toThrow(/speed/u);
    const follow = new PathFollow3D({ points });
    expect(() => follow.advance(-1)).toThrow(/delta/u);
    expect(() => follow.progressTo(Number.NaN)).toThrow(/progress/u);
  });
});
