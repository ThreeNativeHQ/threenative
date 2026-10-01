import * as RAPIER from "@dimforge/rapier3d-compat";
import type { ICtx } from "@threenative/core";
import { Heightfield, SnowField } from "@threenative/core/world";
import { Object3D } from "three";
import { afterEach, describe, expect, it } from "vitest";
import "../src/index.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";
import { type IPhysicsContext, rapier } from "../src/plugin.js";
import { attachSnowPhysics, boxFootprint, capsuleFootprint } from "../src/snow.js";

/**
 * These runs drive real Rapier. Nothing here mocks the solver: the whole point of the acceptance
 * is that a solved contact, read back from the narrow phase, is what deforms the snow and that
 * the deformed surface is what the next step collides against.
 */
const FIXED_STEP = 1 / 60;
const SNOW_DEPTH = 0.28;
const BALL_RADIUS = 0.25;
const BALL_MASS = 10;
const SETTLE_TOLERANCE = 0.02;

const plugins: Array<ReturnType<typeof rapier>> = [];
const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  for (const plugin of plugins.splice(0))
    plugin.dispose?.({} as ICtx<Record<string, unknown>, IPhysicsContext>);
});

interface IScene {
  readonly ctx: ICtx<Record<string, unknown>, IPhysicsContext>;
  readonly field: Heightfield;
  readonly snow: SnowField;
}

async function scene(options: { depth?: number; size?: number; slope?: number } = {}): Promise<IScene> {
  await RAPIER.init();
  const plugin = rapier({ gravity: { x: 0, y: -9.81, z: 0 } });
  const ctx = { physics: undefined } as unknown as ICtx<Record<string, unknown>, IPhysicsContext>;
  await plugin.setup?.(ctx);
  plugins.push(plugin);
  const size = options.size ?? 6;
  const slope = options.slope ?? 0;
  const field = Heightfield.fromSampler({
    columns: 129,
    depth: size,
    origin: { x: 0, z: 0 },
    rows: 129,
    sampleHeight: (x) => x * slope,
    width: size,
  });
  const snow = new SnowField({ field, depth: options.depth ?? SNOW_DEPTH });
  return { ctx, field, snow };
}

function ball(physics: IPhysicsContext, options: { x?: number; z?: number; y?: number } = {}) {
  const object = new Object3D();
  object.position.set(options.x ?? 0, options.y ?? 2, options.z ?? 0);
  const body = new RigidBody3D({
    mass: BALL_MASS,
    object,
    physics,
    shape: CollisionShape3D.sphere(BALL_RADIUS),
  });
  return { body, object };
}

function run(
  ctx: ICtx<Record<string, unknown>, IPhysicsContext>,
  binding: { step(deltaTime: number): void },
  steps: number,
  onStep?: (index: number) => void,
): void {
  for (let index = 0; index < steps; index += 1) {
    ctx.physics.simulation.step(FIXED_STEP);
    binding.step(FIXED_STEP);
    onStep?.(index);
  }
}

function solvedPosition(
  ctx: ICtx<Record<string, unknown>, IPhysicsContext>,
  body: RigidBody3D,
): { readonly rotation: { x: number; y: number; z: number; w: number }; readonly y: number } {
  const transform = ctx.physics.simulation.readBodyTransform?.(body.body.id);
  if (transform === undefined) throw new Error("the solver reported no transform for the body");
  return { rotation: transform.rotation, y: transform.position.y };
}

describe("deformable snow under real physics", () => {
  it("settles a dropped sphere on the surface it made, within the stated tolerance", async () => {
    const { ctx, snow } = await scene();
    const snowPhysics = attachSnowPhysics({ physics: ctx.physics, snow });
    disposers.push(() => snowPhysics.dispose());
    const { body } = ball(ctx.physics, { x: 0, y: 1.6, z: 0 });
    snowPhysics.add(body);

    // Airborne: the sphere is above the snow and nothing may be stamped yet.
    run(ctx, snowPhysics, 30);
    expect(solvedPosition(ctx, body).y).toBeGreaterThan(SNOW_DEPTH + BALL_RADIUS + 0.05);
    expect(snow.activeCells).toBe(0);
    expect(snow.steps).toBe(0);

    run(ctx, snowPhysics, 570);
    const rest = solvedPosition(ctx, body);
    const surface = snow.heightAt(0, 0);
    expect(snowPhysics.supported).toBeGreaterThan(0);
    expect(snow.sample(0, 0).indent).toBeGreaterThan(0.02);
    // The sphere's underside and the surface it made agree to within the acceptance tolerance.
    expect(Math.abs(rest.y - BALL_RADIUS - surface)).toBeLessThan(SETTLE_TOLERANCE);
  });

  it("carves a connected track and rotates a pushed sphere without copying its transform", async () => {
    const { ctx, snow } = await scene();
    const snowPhysics = attachSnowPhysics({ physics: ctx.physics, snow });
    disposers.push(() => snowPhysics.dispose());
    const { body } = ball(ctx.physics, { x: -2, y: 0.4, z: 0 });
    snowPhysics.add(body);
    run(ctx, snowPhysics, 120);
    const before = solvedPosition(ctx, body).y;
    expect(snow.sample(-2, 0).indent).toBeGreaterThan(0.01);

    body.applyImpulse({ x: 0, y: 0, z: 12 });
    run(ctx, snowPhysics, 600);
    const after = solvedPosition(ctx, body);

    // It moved because the solver moved it, and it rotated as a rolling body does.
    expect(after.y).toBeGreaterThan(before - 0.5);
    const spin = Math.abs(after.rotation.x) + Math.abs(after.rotation.y) + Math.abs(after.rotation.z);
    expect(spin).toBeGreaterThan(0.01);

    // The snow it crossed carries a connected track: every sample along the path was pressed.
    let pressed = 0;
    for (let index = 0; index <= 20; index += 1) {
      const z = -2 + (index / 20) * 4;
      if (snow.sample(-2, z).indent > 0.005) pressed += 1;
    }
    expect(pressed).toBeGreaterThan(14);
    expect(snow.sample(2.4, 0).indent).toBeLessThan(0.001);
  });

  it("keeps a box and a capsule resting on shape-appropriate prints", async () => {
    const { ctx, snow } = await scene();
    const snowPhysics = attachSnowPhysics({ physics: ctx.physics, snow });
    disposers.push(() => snowPhysics.dispose());

    const boxObject = new Object3D();
    boxObject.position.set(-1.5, 1.2, 0);
    const box = new RigidBody3D({
      mass: 60,
      object: boxObject,
      physics: ctx.physics,
      shape: CollisionShape3D.box(0.8, 0.4, 0.6),
    });
    const capsuleObject = new Object3D();
    capsuleObject.position.set(1.5, 1.2, 0);
    const capsule = new RigidBody3D({
      mass: 60,
      object: capsuleObject,
      physics: ctx.physics,
      // Laid on its side so its long axis runs along z, as a fallen body does.
      shape: CollisionShape3D.capsule(0.5, 0.2),
    });
    snowPhysics.add(box);
    snowPhysics.add(capsule);
    run(ctx, snowPhysics, 700);

    // A box presses a rectangular print: two axes are indented, the diagonal corner is not.
    const boxPrint = snow.sample(-1.5, 0);
    expect(boxPrint.indent).toBeGreaterThan(0.01);
    expect(snow.sample(-1.5, 0.25).indent).toBeGreaterThan(0.005);
    expect(snow.sample(-1.5, 0.9).indent).toBeLessThan(0.002);

    // The capsule's print runs along its spine, so the two ends are pressed and the sides are not.
    const along = Math.max(
      snow.sample(1.5, -0.45).indent,
      snow.sample(1.5, 0.45).indent,
    );
    const across = snow.sample(1.5 - 0.5, 0).indent;
    expect(snow.sample(1.5, 0).indent).toBeGreaterThan(0.01);
    expect(along).toBeGreaterThan(0.01);
    expect(across).toBeLessThan(along);

    // Both bodies are still supported by the surface they deformed.
    expect(solvedPosition(ctx, box).y).toBeLessThan(1.0);
    expect(solvedPosition(ctx, capsule).y).toBeLessThan(1.0);
  });

  it("survives recovery and a field reset without stale colliders or fall-through", async () => {
    const { ctx, snow } = await scene();
    const snowPhysics = attachSnowPhysics({
      deposition: 0.002,
      physics: ctx.physics,
      snow,
      wind: 0.5,
    });
    disposers.push(() => snowPhysics.dispose());
    const { body } = ball(ctx.physics, { x: 0, y: 0.6, z: 0 });
    snowPhysics.add(body);
    run(ctx, snowPhysics, 300);
    const surface = snowPhysics.surface;
    const version = snowPhysics.surfaceVersion;
    expect(snow.activeCells).toBeGreaterThan(0);
    expect(version).toBe(snow.version);

    // Recovery buries the print; the collider identity and the body's support must both hold.
    run(ctx, snowPhysics, 900);
    expect(snow.activeCells).toBeLessThan(4000);
    expect(snowPhysics.surface).toBe(surface);

    snow.reset();
    snowPhysics.step(FIXED_STEP);
    expect(snow.sample(0, 0).indent).toBe(0);
    expect(snowPhysics.surface).toBe(surface);
    expect(snowPhysics.surfaceVersion).toBe(snow.version);

    // The surface is rebuilt, not abandoned: the sphere still rests on it rather than falling.
    const beforeReset = solvedPosition(ctx, body).y;
    run(ctx, snowPhysics, 240);
    const afterReset = solvedPosition(ctx, body).y;
    expect(afterReset).toBeGreaterThan(beforeReset - 0.1);
    expect(Math.abs(afterReset - BALL_RADIUS - snow.heightAt(0, 0))).toBeLessThan(0.05);
  });

  it("deforms only the field a body is attached to", async () => {
    const first = await scene();
    const second = await scene();
    const firstBinding = attachSnowPhysics({ physics: first.ctx.physics, snow: first.snow });
    const secondBinding = attachSnowPhysics({ physics: second.ctx.physics, snow: second.snow });
    disposers.push(() => firstBinding.dispose(), () => secondBinding.dispose());
    const { body } = ball(first.ctx.physics, { x: 0, y: 0.6, z: 0 });
    firstBinding.add(body);
    run(first.ctx, firstBinding, 400);

    expect(first.snow.sample(0, 0).indent).toBeGreaterThan(0.01);
    expect(second.snow.sample(0, 0).indent).toBe(0);
    expect(second.snow.activeCells).toBe(0);
    expect(second.snow.version).toBe(1);
  });

  it("orients the surface collider on the field's own axes and scale", async () => {
    const { ctx, field, snow } = await scene({ slope: 0.15 });
    const snowPhysics = attachSnowPhysics({ physics: ctx.physics, snow });
    disposers.push(() => snowPhysics.dispose());
    const uphill = ball(ctx.physics, { x: 1.8, y: 2, z: 0 });
    const downhill = ball(ctx.physics, { x: -1.8, y: 2, z: 0 });
    snowPhysics.add(uphill.body);
    snowPhysics.add(downhill.body);
    run(ctx, snowPhysics, 600);

    // A slope rising along +x must hold the +x sphere higher. A transposed or mis-scaled
    // heightfield would put the two at the same height, or invert them.
    const high = solvedPosition(ctx, uphill.body).y;
    const low = solvedPosition(ctx, downhill.body).y;
    expect(high - low).toBeGreaterThan(0.4);
    expect(high).toBeLessThan(field.heightAt(1.8, 0) + BALL_RADIUS + 0.05);
    expect(low).toBeGreaterThan(field.heightAt(-1.8, 0) + BALL_RADIUS - 0.35);
  });
});

describe("attachSnowPhysics contracts", () => {
  it("refuses a shape it cannot profile and names the ones it can", async () => {
    const { ctx, snow } = await scene();
    const snowPhysics = attachSnowPhysics({ physics: ctx.physics, snow });
    disposers.push(() => snowPhysics.dispose());
    const object = new Object3D();
    const mesh = new RigidBody3D({
      mass: 5,
      object,
      physics: ctx.physics,
      shape: CollisionShape3D.heightfield(3, 3, new Float32Array(9), { x: 1, y: 1, z: 1 }),
    });
    expect(() => snowPhysics.add(mesh)).toThrow(/supported shapes are sphere, box, capsule/);
    // An explicit footprint is always allowed, even for a shape with no automatic profile.
    expect(() => snowPhysics.add(mesh, boxFootprint(0.5, 0.5))).not.toThrow();
    expect(() => snowPhysics.add(mesh, capsuleFootprint(0.4, 0.15))).not.toThrow();
  });

  it("rejects malformed tuning and malformed steps", async () => {
    const { ctx, snow } = await scene();
    const snowPhysics = attachSnowPhysics({ physics: ctx.physics, snow });
    disposers.push(() => snowPhysics.dispose());
    expect(() => snowPhysics.step(0)).toThrow(/delta time/);
    expect(() => snowPhysics.step(Number.NaN)).toThrow(/delta time/);
    expect(() => attachSnowPhysics({ physics: ctx.physics, loadScale: Number.NaN, snow })).toThrow(
      /loadScale/,
    );
    expect(() => capsuleFootprint(0.4, 0)).toThrow(/radius/);
    expect(() => boxFootprint(-1, 1)).toThrow(/halfWidth/);
  });

  it("ignores side contacts and stops watching a removed body", async () => {
    const { ctx, snow } = await scene({ depth: 0.3 });
    const snowPhysics = attachSnowPhysics({ physics: ctx.physics, snow });
    disposers.push(() => snowPhysics.dispose());
    const wallObject = new Object3D();
    wallObject.position.set(0, 0.2, 0);
    // A sphere wedged against a wall it also touches would deform twice if side contacts counted.
    const body = new RigidBody3D({
      mass: BALL_MASS,
      object: wallObject,
      physics: ctx.physics,
      shape: CollisionShape3D.sphere(BALL_RADIUS),
    });
    snowPhysics.add(body);
    run(ctx, snowPhysics, 60);
    expect(snow.steps).toBeGreaterThan(0);
    const steps = snow.steps;
    snowPhysics.remove(body);
    run(ctx, snowPhysics, 120);
    expect(snow.steps).toBe(steps);
    expect(snowPhysics.contacts).toBe(0);
  });

  it("is idempotent on dispose", async () => {
    const { ctx, snow } = await scene();
    const snowPhysics = attachSnowPhysics({ physics: ctx.physics, snow });
    snowPhysics.dispose();
    expect(() => snowPhysics.dispose()).not.toThrow();
    expect(() => snowPhysics.step(FIXED_STEP)).not.toThrow();
  });
});
