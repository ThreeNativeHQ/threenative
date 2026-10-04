import { BoxGeometry, Group, InstancedMesh, MeshBasicMaterial, Vector3 } from "three";
import { expect, it } from "vitest";
import { WorldCells } from "@threenative/core/world";
import {
  createProps,
  variantFor,
} from "../../../examples/strata-terrain-preview/src/render/props.js";
import { createStreamedProps } from "../../../examples/strata-terrain-preview/src/render/propStreaming.js";
import type { IPlacement } from "../src/index.js";

it("streams Strata's exact grounded transforms, seeded cover density and original placement count", async () => {
  const placements = Array.from({ length: 60 }, (_, i) => ({
    id: `grass:${i}`,
    asset: "grass",
    position: [i * 5 - 150, 0, 0],
    rotation: 0.3,
    scale: 2,
    normal: [0.1, 0.99, 0],
    alignToNormal: true,
  })) as IPlacement[];
  const material = new MeshBasicMaterial();
  const parts = new Map(
    placements.map((p) => [
      `grass:${variantFor(p, "grass")}`,
      [{ geometry: new BoxGeometry(1, 2, 1), material, role: "grass" as const, variant: 0 }],
    ]),
  );
  const ground = () => ({ height: 4, offset: 0 });
  const materials = { grass: material } as never;
  const original = createProps(placements, ground, parts, materials);
  const follow = { position: new Vector3(-120, 5, 0) };
  const streamed = await createStreamedProps({
    placements,
    groundAt: ground,
    parts,
    materials,
    follow,
    size: 512,
    whileCurrent: () => true,
  });
  expect(streamed?.worlds[0]).toBeInstanceOf(WorldCells);
  if (!streamed) throw new Error("cancelled");
  try {
    expect(streamed.byId.size).toBe(placements.length);
    for (const placement of placements)
      expect(streamed.byId.get(placement.id)?.pose.elements).toEqual(
        original.byId.get(placement.id)?.pose.elements,
      );
    for (const x of [-120, 120, -120]) {
      follow.position.x = x;
      original.setLevels(follow.position);
      for (let frame = 0; frame < 150; frame++) {
        for (const world of streamed.worlds) world.update();
        await Promise.resolve();
      }
      expect(streamed.meshes.reduce((n, m) => n + m.count, 0)).toBe(
        original.meshes.reduce((n, m) => n + m.count, 0),
      );
    }
    expect(streamed.stats().evictions).toBeGreaterThan(0);
    expect(streamed.stats().failures).toBe(0);
  } finally {
    streamed.dispose();
    original.dispose();
  }
  expect(streamed.worlds.every((world) => world.released)).toBe(true);
});
it("cancels a stale scene before querying ground or attaching a stream", async () => {
  let calls = 0;
  const result = await createStreamedProps({
    placements: [] as IPlacement[],
    groundAt: () => {
      calls++;
      return { height: 0, offset: 0 };
    },
    parts: new Map(),
    materials: {} as never,
    follow: { position: new Vector3() },
    size: 512,
    whileCurrent: () => false,
  });
  expect(result).toBeUndefined();
  expect(calls).toBe(0);
});
it("stops stale-scene work during post-grounding package compilation", async () => {
  const placements = [0, 1].map((i) => ({
    id: `grass:${i}`,
    asset: "grass",
    position: [i, 0, 0],
    rotation: 0,
    scale: 1,
    normal: [0, 1, 0],
    alignToNormal: false,
  })) as IPlacement[];
  const material = new MeshBasicMaterial();
  const parts = new Map(
    placements.map((p) => [
      `grass:${variantFor(p, "grass")}`,
      [{ geometry: new BoxGeometry(), role: "grass" as const, material, variant: 0 }],
    ]),
  );
  let groundCalls = 0,
    postChecks = 0;
  const result = await createStreamedProps({
    placements,
    parts,
    materials: { grass: material } as never,
    follow: { position: new Vector3() },
    size: 512,
    groundAt: () => {
      groundCalls++;
      return { height: 0, offset: 0 };
    },
    whileCurrent: () => groundCalls < 2 || ++postChecks < 3,
  });
  result?.dispose();
  expect(groundCalls).toBe(2);
  expect(result).toBeUndefined();
});

it("retains every unlimited canopy placement and keeps prewarm pending until scene attachment", async () => {
  const placements = Array.from({ length: 12 }, (_, i) => ({
    id: `spruce:${i}`,
    asset: "spruce",
    position: [i * 64 - 352, 0, 0],
    rotation: 0.2,
    scale: 1,
    normal: [0, 1, 0],
    alignToNormal: false,
  })) as IPlacement[];
  const material = new MeshBasicMaterial();
  const geometry = new BoxGeometry(1, 3, 1);
  const parts = new Map(
    placements.map((p) => [
      `spruce:${variantFor(p, "spruce")}`,
      [{ geometry, material, role: "bark" as const, variant: 0 }],
    ]),
  );
  const follow = { position: new Vector3(0, 10, 0) };
  const streamed = await createStreamedProps({
    placements,
    parts,
    materials: { bark: material } as never,
    groundAt: () => ({ height: 0, offset: 0 }),
    follow,
    size: 1024,
    horizonDistance: 5000,
    whileCurrent: () => true,
  });
  if (!streamed) throw new Error("cancelled");
  try {
    expect(streamed.ready).toBe(false);
    for (let frame = 0; frame < 200; frame++) {
      for (const world of streamed.worlds) world.update();
      await Promise.resolve();
    }
    expect(streamed.meshes.reduce((n, m) => n + m.count, 0)).toBe(placements.length);
    expect(streamed.ready).toBe(false);
    expect(streamed.stats().pendingPrewarm).toBeGreaterThan(0);
    new Group().add(...streamed.worlds);
    for (let frame = 0; frame < 200 && !streamed.ready; frame++) {
      for (const world of streamed.worlds) {
        world.update();
        world.traverse((node) => {
          if (node instanceof InstancedMesh && node.visible)
            (node.onBeforeRender as (...args: unknown[]) => void)(
              node,
              null,
              null,
              null,
              null,
              null,
            );
        });
      }
      await Promise.resolve();
    }
    expect(streamed.ready).toBe(true);
    expect(streamed.stats().pendingPrewarm).toBe(0);
    for (const x of [4000, 0]) {
      follow.position.x = x;
      for (let frame = 0; frame < 200; frame++) {
        for (const world of streamed.worlds) world.update();
        await Promise.resolve();
      }
      expect(streamed.meshes.reduce((n, m) => n + m.count, 0)).toBe(placements.length);
    }
    expect(streamed.stats().failures).toBe(0);
  } finally {
    streamed.dispose();
  }
  expect(streamed.byId.size).toBe(0);
  expect(streamed.worlds.every((world) => world.released)).toBe(true);
});
