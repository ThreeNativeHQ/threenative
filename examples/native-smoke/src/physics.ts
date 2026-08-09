import { type Ctx, Scene, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import {
  Area3D,
  CollisionShape3D,
  type PhysicsContext,
  RigidBody3D,
  rapier,
} from "@threenative/physics";
import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";

interface PhysicsState extends Record<string, unknown> {
  collisions: number;
  control: string;
  cubeY: number;
  steps: number;
}

declare global {
  var canvas: HTMLCanvasElement | undefined;
}

declare const __TN_PHYSICS_CONTROL__: "masked" | "normal" | "wrong-gravity";
declare const __TN_PLAYTEST_ENABLED__: boolean;

const runtimeCanvas = globalThis.canvas;
if (runtimeCanvas === undefined)
  throw new Error("TN_NATIVE_CANVAS_MISSING: globalThis.canvas is required");

class NativePhysicsProof extends Scene<PhysicsState, PhysicsContext> {
  static override readonly initialState: PhysicsState = {
    collisions: 0,
    control: __TN_PHYSICS_CONTROL__,
    cubeY: 3,
    steps: 0,
  };

  override enter(ctx: Ctx<PhysicsState, PhysicsContext>) {
    ctx.camera.position.set(0, 2, 8);
    const floor = ctx.add(
      new Mesh(new BoxGeometry(100, 1, 100), new MeshBasicMaterial({ color: 0x222222 })),
    );
    floor.position.y = -0.5;
    new RigidBody3D({
      object: floor,
      physics: ctx.physics,
      shape: CollisionShape3D.box(100, 1, 100),
      type: "fixed",
    });
    const cube = ctx.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ color: 0x44aaff })));
    cube.position.y = 3;
    ctx.entities.add("cube", cube);
    const masked = __TN_PHYSICS_CONTROL__ === "masked";
    new RigidBody3D({
      collisionLayer: masked ? 2 : 1,
      collisionMask: masked ? 2 : 0xffff,
      object: cube,
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
    });
    const contact = new Area3D({
      physics: ctx.physics,
      position: { x: 0, y: -0.25, z: 0 },
      shape: CollisionShape3D.box(100, 1.5, 100),
    });
    let collisions = 0;
    contact.on("bodyEntered", (body) => {
      if (body.object === cube) collisions += 1;
    });
    let steps = 0;
    return () => {
      if (steps >= 180) return;
      steps += 1;
      ctx.state.set({ collisions, cubeY: cube.position.y, steps });
      if (steps === 1) console.info("TN_NATIVE_SMOKE_FIRST_FRAME");
      if (steps === 180) {
        console.info(
          `TN_NATIVE_PHYSICS_RESULT:${__TN_PHYSICS_CONTROL__}:${cube.position.y}:${collisions}`,
        );
        console.info("TN_NATIVE_SMOKE_300_FRAMES:300");
      }
    };
  }
}

const game = defineGame<PhysicsState, PhysicsContext>({
  canvas: runtimeCanvas,
  inputTarget: runtimeCanvas,
  plugins: [
    rapier({
      gravity: {
        x: 0,
        y: __TN_PHYSICS_CONTROL__ === "wrong-gravity" ? 9.81 : -9.81,
        z: 0,
      },
    }),
    ...(__TN_PLAYTEST_ENABLED__ ? [playtest<PhysicsState, PhysicsContext>()] : []),
  ],
  scenes: { proof: NativePhysicsProof },
  start: "proof",
});

void game.start().then(() => console.info("TN_NATIVE_SMOKE_READY:webgpu"));
