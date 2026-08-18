import { readFileSync } from "node:fs";
import path from "node:path";
import * as RAPIER from "@dimforge/rapier3d-compat";
import type { ICtx } from "@threenative/core";
import { BoxGeometry, Mesh } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { FixedStepLoop } from "../../core/src/loop.js";
import "../src/index.js";
import { CharacterBody3D } from "../src/CharacterBody3D.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";
import { type IPhysicsContext, rapier } from "../src/plugin.js";

// Round 5 built a physics puzzle in a bare sandbox and could not push a crate. RigidBody3D had
// six public methods and none of them applied a force, and a transform write to a dynamic body
// was discarded by the next step (measured: +2.0 on x reverted within 600 ms). The game shipped
// an invisible kinematic paddle, a third collision layer and a load limiter to fake a shove --
// roughly 90 lines of user code standing in for the genre's core verb.
//
// `body.raw` is a Rapier object on web and opaque on native, so reaching through it forks the
// game by platform. These tests cover the portable path.

type PhysicsCtx = ICtx<Record<string, unknown>, IPhysicsContext>;

function rigidBodyObject(body: RigidBody3D) {
  const object = body.object;
  if (object === undefined) throw new Error("TEST_RIGID_BODY_OBJECT_MISSING");
  return object;
}

const NATIVE_CENSUS_VERIFICATION_RECORD = path.resolve(
  process.cwd(),
  "docs/verification/native-runtime-census-2026-08-16.md",
);
const EXPECTED_NATIVE_LOC_AREAS = [
  ["src/", 38_455],
  ["conformance/", 6_331],
  ["tests/", 9_192],
  ["scripts/", 11_641],
  ["include/", 3_798],
  ["android/", 1_941],
  ["native/", 3_276],
  ["Root CMakeLists.txt", 1_673],
  ["cmake/", 280],
  ["CMakePresets.json", 140],
  ["ios/", 104],
  ["package.json", 63],
  ["vitest.config.ts", 10],
  // The desktop multitouch injector's ioctl helper, PRD-077. A new counted area, so it appears
  // here rather than growing an existing row: the point of this list is that a native area
  // cannot be added without somebody writing its kill-switch verdict in the record.
  ["tools/", 145],
] as const;
const EXPECTED_ROOT_VITEST_SUMMARY = "Root Vitest: 144 files, 1,306 passed, 0 skipped.";
const EXPECTED_RUNTIME_VITEST_SUMMARY = "Runtime-native Vitest: 48 files, 319 passed, 30 skipped.";

beforeAll(async () => {
  await RAPIER.init();
});

async function world(): Promise<{ ctx: PhysicsCtx; step: (frames: number) => void }> {
  const plugin = rapier();
  const ctx = { physics: undefined } as unknown as PhysicsCtx;
  await plugin.setup?.(ctx);
  const loop = new FixedStepLoop({
    onRender: () => undefined,
    onUpdate: (dt) => plugin.update?.(ctx, dt),
  });
  loop.stepFrame(0);
  let frame = 0;
  return {
    ctx,
    step: (frames) => {
      for (let index = 0; index < frames; index += 1) {
        frame += 1;
        loop.stepFrame(Math.round((frame * 1_000) / 60));
      }
    },
  };
}

function crate(ctx: PhysicsCtx, x = 0, collisionLayer = 1, collisionMask = 0xffff): RigidBody3D {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1));
  mesh.position.set(x, 0.5, 0);
  return new RigidBody3D({
    mass: 1,
    object: mesh,
    physics: ctx.physics,
    shape: CollisionShape3D.box(1, 1, 1),
    collisionLayer,
    collisionMask,
  });
}

/** Without a floor every body free-falls and no contact the test cares about ever happens. */
function ground(ctx: PhysicsCtx): void {
  const mesh = new Mesh(new BoxGeometry(40, 1, 40));
  mesh.position.set(0, -0.5, 0);
  new RigidBody3D({
    object: mesh,
    physics: ctx.physics,
    shape: CollisionShape3D.box(40, 1, 40),
    type: "fixed",
  });
}

describe("dynamic body actuation", () => {
  it("moves a dynamic body along the impulse, where a transform write is discarded", async () => {
    const { ctx, step } = await world();
    const body = crate(ctx);

    body.applyImpulse({ x: 6, y: 0, z: 0 });
    step(30);

    expect(rigidBodyObject(body).position.x).toBeGreaterThan(0.5);
  });

  it("reports and accepts linear velocity", async () => {
    const { ctx, step } = await world();
    const body = crate(ctx);

    body.linearVelocity = { x: 4, y: 0, z: 0 };
    step(1);

    expect(body.linearVelocity.x).toBeGreaterThan(0);
    expect(rigidBodyObject(body).position.x).toBeGreaterThan(0);
  });

  it("accumulates a continuous force into motion", async () => {
    const { ctx, step } = await world();
    const body = crate(ctx);

    for (let frame = 0; frame < 30; frame += 1) {
      body.applyForce({ x: 20, y: 0, z: 0 });
      step(1);
    }

    expect(rigidBodyObject(body).position.x).toBeGreaterThan(0.5);
  });

  // Rapier discards actuation on a sleeping body, which is the same silent no-op class as the
  // discarded transform write this API exists to replace.
  it("wakes a settled body rather than discarding the impulse", async () => {
    const { ctx, step } = await world();
    const body = crate(ctx);
    step(240);
    const settled = rigidBodyObject(body).position.x;

    body.applyImpulse({ x: 8, y: 0, z: 0 });
    step(30);

    expect(rigidBodyObject(body).position.x).toBeGreaterThan(settled + 0.1);
  });

  it("refuses actuation on a body type the backend would silently ignore", async () => {
    const { ctx } = await world();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1));
    const fixed = new RigidBody3D({
      object: mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
      type: "fixed",
    });

    expect(() => fixed.applyImpulse({ x: 1, y: 0, z: 0 })).toThrow(/TN_PHYSICS_NOT_DYNAMIC/u);
    expect(() => fixed.applyForce({ x: 1, y: 0, z: 0 })).toThrow(/TN_PHYSICS_NOT_DYNAMIC/u);
  });

  it.each([
    ["a NaN component", { x: Number.NaN, y: 0, z: 0 }],
    ["an infinite component", { x: 0, y: Number.POSITIVE_INFINITY, z: 0 }],
    ["a missing component", { x: 1, y: 2 } as unknown as { x: number; y: number; z: number }],
  ])("rejects %s instead of corrupting the body", async (_label, vector) => {
    const { ctx } = await world();
    const body = crate(ctx);

    expect(() => body.applyImpulse(vector)).toThrow(/TN_PHYSICS_NON_FINITE/u);
  });

  it("refuses actuation after dispose", async () => {
    const { ctx } = await world();
    const body = crate(ctx);
    body.dispose();

    expect(() => body.applyImpulse({ x: 1, y: 0, z: 0 })).toThrow(/after dispose/u);
  });
});

describe("character push", () => {
  it("shoves a dynamic body when pushesDynamicBodies is set, and not otherwise", async () => {
    const displacement = async (pushesDynamicBodies: boolean): Promise<number> => {
      const { ctx, step } = await world();
      ground(ctx);
      const box = crate(ctx, 1.2);
      const mesh = new Mesh(new BoxGeometry(1, 1, 1));
      mesh.position.set(-0.5, 0.5, 0);
      const character = new CharacterBody3D({
        object: mesh,
        physics: ctx.physics,
        pushesDynamicBodies,
        shape: CollisionShape3D.capsule(0.3, 0.3),
      });
      const startX = rigidBodyObject(box).position.x;
      for (let frame = 0; frame < 90; frame += 1) {
        // moveAndSlide derives its motion from `velocity`; it overwrites anything move() set.
        character.velocity.x = 2.4;
        character.moveAndSlide(1 / 60);
        step(1);
      }
      return rigidBodyObject(box).position.x - startX;
    };

    const pushed = await displacement(true);
    const ignored = await displacement(false);

    expect(pushed).toBeGreaterThan(0.5);
    expect(Math.abs(ignored)).toBeLessThan(0.01);
  });

  it("pushes only a mutually included dynamic body", async () => {
    const { ctx, step } = await world();
    ground(ctx);
    const included = crate(ctx, 2.2, 2, 1);
    const excluded = crate(ctx, 1.2, 4, 1);
    const mesh = new Mesh(new BoxGeometry(1, 1, 1));
    mesh.position.set(-0.5, 0.5, 0);
    const character = new CharacterBody3D({
      object: mesh,
      physics: ctx.physics,
      collisionLayer: 1,
      collisionMask: 2,
      gravity: 0,
      pushesDynamicBodies: true,
      shape: CollisionShape3D.capsule(0.3, 0.3),
    });
    const includedStart = rigidBodyObject(included).position.x;
    const excludedStart = rigidBodyObject(excluded).position.x;

    for (let frame = 0; frame < 90; frame += 1) {
      character.velocity.x = 2.4;
      character.moveAndSlide(1 / 60);
      step(1);
    }

    expect(rigidBodyObject(included).position.x - includedStart).toBeGreaterThan(0.1);
    expect(Math.abs(rigidBodyObject(excluded).position.x - excludedStart)).toBeLessThan(0.01);
  });
});

describe("PRD-116 verification evidence", () => {
  it("keeps the native census and final test counts tied to committed gate output", () => {
    const record = readFileSync(NATIVE_CENSUS_VERIFICATION_RECORD, "utf8");
    const censusStart = record.indexOf("| Counted area | Lines | Owner |");
    const totalStart = record.indexOf("| **Total** |", censusStart);
    expect(censusStart).toBeGreaterThanOrEqual(0);
    expect(totalStart).toBeGreaterThan(censusStart);

    const rows = [
      ...record.slice(censusStart, totalStart).matchAll(/^\| ([^|]+) \| ([\d,]+) \|/gmu),
    ].map((match) => {
      const area = match[1];
      const lines = match[2];
      if (area === undefined || lines === undefined) {
        throw new Error("PRD-116 verification record contains a malformed census row.");
      }
      return [area.replaceAll("`", "").trim(), Number(lines.replaceAll(",", ""))] as const;
    });
    expect(rows).toEqual(EXPECTED_NATIVE_LOC_AREAS);

    const totalMatch = record.match(/^\| \*\*Total\*\* \| \*\*([\d,]+)\*\*/mu);
    if (!totalMatch || totalMatch[1] === undefined) {
      throw new Error("PRD-116 verification record is missing its census total.");
    }
    const total = Number(totalMatch[1].replaceAll(",", ""));
    expect(rows.reduce((sum, [, lines]) => sum + lines, 0)).toBe(total);

    const budgetMatch = record.match(
      /^\| `pnpm budgets` \|.*?([\d,]+)\/50,000 native runtime LOC/mu,
    );
    if (!budgetMatch || budgetMatch[1] === undefined) {
      throw new Error("PRD-116 verification record is missing budget output.");
    }
    expect(Number(budgetMatch[1].replaceAll(",", ""))).toBe(total);
    expect(record).toContain(EXPECTED_ROOT_VITEST_SUMMARY);
    expect(record).toContain(EXPECTED_RUNTIME_VITEST_SUMMARY);
  });
});
