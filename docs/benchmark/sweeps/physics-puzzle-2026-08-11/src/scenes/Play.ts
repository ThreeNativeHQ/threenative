import { type Ctx, Scene, type SceneFrame } from "@threenative/core";
import {
  Area3D,
  CharacterBody3D,
  CollisionShape3D,
  type PhysicsContext,
  RigidBody3D,
} from "@threenative/physics";
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene as ThreeScene,
  Vector2,
  Vector3,
} from "three";
import type { GameState } from "../state.js";

type GameCtx = Ctx<GameState, PhysicsContext>;

const CRATE_COUNT = 30;
const MOVE_SPEED = 2.4;

class Player {
  readonly body: CharacterBody3D;
  readonly mesh: Mesh;

  constructor(ctx: GameCtx) {
    this.mesh = new Mesh(
      new BoxGeometry(0.65, 1.1, 0.65),
      new MeshStandardMaterial({ color: 0xf4d6a0, roughness: 0.42 }),
    );
    this.mesh.position.set(-5, 0.7, 0);
    this.mesh.castShadow = true;
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      autostep: { includeDynamicBodies: true, maxHeight: 0.35, minWidth: 0.2 },
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.28, 0.32),
    });
  }

  update(ctx: GameCtx, dt: number): void {
    const move = ctx.input.vector("move");
    this.body.velocity.x = move.x * MOVE_SPEED;
    this.body.velocity.z = -move.y * MOVE_SPEED;
    this.body.moveAndSlide(dt);
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}

class Crate {
  readonly body: RigidBody3D;
  readonly mesh: Mesh;

  constructor(ctx: GameCtx, position: Vector3, color: number) {
    this.mesh = new Mesh(
      new BoxGeometry(0.82, 0.82, 0.82),
      new MeshStandardMaterial({ color, roughness: 0.78 }),
    );
    this.mesh.position.copy(position);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    ctx.add(this.mesh);
    this.body = new RigidBody3D({
      mass: 2,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(0.82, 0.82, 0.82),
    });
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}

class SolidBody {
  readonly body: RigidBody3D;
  readonly mesh: Mesh;

  constructor(ctx: GameCtx) {
    this.mesh = new Mesh(
      new BoxGeometry(1.3, 1.2, 1.1),
      new MeshStandardMaterial({ color: 0xed6952, roughness: 0.56 }),
    );
    this.mesh.position.set(-2.8, 0.6, 0);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    ctx.add(this.mesh);
    this.body = new RigidBody3D({
      mass: 4,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(1.3, 1.2, 1.1),
      type: "dynamic",
    });
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}

class ReplayRun {
  readonly body: CharacterBody3D;
  readonly mesh: Mesh;
  #started = false;
  #settled = false;

  constructor(ctx: GameCtx) {
    this.mesh = new Mesh(
      new BoxGeometry(0.65, 1.1, 0.65),
      new MeshBasicMaterial({ visible: false }),
    );
    this.mesh.position.set(-5, 0.7, -2.4);
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      collisionLayer: 2,
      collisionMask: 1,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.28, 0.32),
    });
  }

  get complete(): boolean {
    return this.#settled;
  }

  update(dt: number, input: Vector2 | undefined): void {
    if (this.#settled || input === undefined) return;
    if (input.lengthSq() === 0) {
      if (this.#started) {
        this.#settled = true;
      }
      return;
    }
    this.#started = true;
    this.body.velocity.x = input.x * MOVE_SPEED;
    this.body.velocity.z = -input.y * MOVE_SPEED;
    this.body.moveAndSlide(dt);
  }

  snapshot(): string {
    return physicsSnapshot([this]);
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}

class Sensor {
  readonly area: Area3D;

  constructor(ctx: GameCtx, entity: string, position: Vector3, size: Vector3) {
    this.area = new Area3D({
      entity,
      physics: ctx.physics,
      position,
      shape: CollisionShape3D.box(size.x, size.y, size.z),
    });
  }

  dispose(): void {
    this.area.dispose();
  }
}

class GoalProbe {
  readonly body: RigidBody3D;
  readonly mesh: Mesh;

  constructor(ctx: GameCtx) {
    this.mesh = new Mesh(
      new BoxGeometry(0.64, 1.1, 0.64),
      new MeshBasicMaterial({ transparent: true, opacity: 0 }),
    );
    this.mesh.position.set(-5, 0.7, 0);
    this.body = new RigidBody3D({
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(0.32, 0.55, 0.32),
      type: "kinematic",
    });
  }

  follow(position: Vector3): void {
    this.mesh.position.copy(position);
  }
}

function addStaticBox(ctx: GameCtx, position: Vector3, size: Vector3, material: MeshStandardMaterial): void {
  const mesh = new Mesh(new BoxGeometry(size.x, size.y, size.z), material);
  mesh.position.copy(position);
  mesh.receiveShadow = true;
  ctx.add(mesh);
  new RigidBody3D({
    object: mesh,
    physics: ctx.physics,
    shape: CollisionShape3D.box(size.x, size.y, size.z),
    type: "fixed",
  });
}

function makeRoom(ctx: GameCtx): void {
  const floor = new MeshStandardMaterial({ color: 0x101e35, roughness: 0.9, metalness: 0.1 });
  const wall = new MeshStandardMaterial({ color: 0x8a4f2e, roughness: 0.72 });
  addStaticBox(ctx, new Vector3(0, -0.15, 0), new Vector3(14, 0.3, 8), floor);
  addStaticBox(ctx, new Vector3(0, 1, -4), new Vector3(14, 2, 0.3), wall);
  addStaticBox(ctx, new Vector3(0, 1, 4), new Vector3(14, 2, 0.3), wall);
}

function makeGoal(ctx: GameCtx): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(1.5, 0.08, 1.5),
    new MeshStandardMaterial({ color: 0x19d9e8, emissive: 0x075f70, emissiveIntensity: 2 }),
  );
  mesh.position.set(5, 0.04, 0);
  mesh.receiveShadow = true;
  ctx.add(mesh);
  return mesh;
}

function makeGhost(ctx: GameCtx): void {
  const material = new LineBasicMaterial({ color: 0x55dfff });
  const mesh = new LineSegments(new EdgesGeometry(new BoxGeometry(0.9, 0.9, 0.9)), material);
  mesh.position.set(2.2, 0.55, 0);
  ctx.add(mesh);
}

function physicsSnapshot(bodies: readonly { mesh: Mesh }[]): string {
  return bodies
    .map(({ mesh }) => {
      const { position, quaternion } = mesh;
      return [
        position.x,
        position.y,
        position.z,
        quaternion.x,
        quaternion.y,
        quaternion.z,
        quaternion.w,
      ]
        .map((value) => value.toFixed(5))
        .join(",");
    })
    .join("|");
}

export class Play extends Scene<GameState, PhysicsContext> {
  static override readonly initialState: GameState = {
    cratesAtRest: 0,
    mission: "playing",
    playerX: -5,
    replayMatches: false,
    score: 0,
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, PhysicsContext> {
    setupPhysicsPuzzleScene(ctx.scene);
    makeRoom(ctx);
    makeGoal(ctx);
    makeGhost(ctx);

    const player = ctx.entities.add("player", new Player(ctx));
    const goalProbe = new GoalProbe(ctx);
    const mission = ctx.entities.add("mission", { body: goalProbe.body, state: "playing" });
    ctx.entities.add("solid-body", new SolidBody(ctx));
    // Two isolated runs consume the public input after the goal and never read the live player.
    const replayRuns = [new ReplayRun(ctx), new ReplayRun(ctx)];
    const replaySnapshots: [string | undefined, string | undefined] = [undefined, undefined];
    let goalReached = false;
    let replayInputReady = false;
    const goalSensor = ctx.entities.add(
      "goal",
      new Sensor(ctx, "goal", new Vector3(5, 0.55, 0), new Vector3(1.8, 1.2, 1.8)),
    );
    ctx.entities.add(
      "pass-through",
      new Sensor(ctx, "pass-through", new Vector3(2.2, 0.55, 0), new Vector3(0.9, 0.9, 0.9)),
    );

    const crateColors = [0xd87945, 0xe5a638, 0x2c8f91];
    for (let index = 0; index < CRATE_COUNT; index += 1) {
      const column = index % 5;
      const row = Math.floor(index / 5);
      const x = -1.4 + column * 0.82;
      const z = (row % 2 === 0 ? -0.4 : 0.4) + ((index * 17) % 5) * 0.03;
      const crate = new Crate(ctx, new Vector3(x, 0.5 + row * 0.83, z), crateColors[index % crateColors.length] ?? 0xd87945);
      ctx.entities.add(`crate.${index}`, crate);
    }

    goalSensor.area.on("bodyEntered", (body) => {
      if (body !== player.body && body !== goalProbe.body) return;
      goalReached = true;
      mission.state = "won";
      ctx.state.set({
        mission: "won",
        replayMatches: replaySnapshots[0] !== undefined
          && replaySnapshots[1] !== undefined
          && replaySnapshots[0] === replaySnapshots[1],
        score: 2,
      });
    });

    const camera = ctx.camera as PerspectiveCamera;
    camera.position.set(0, 8.5, 11.5);
    camera.lookAt(new Vector3(0, 0.6, 0));
    ctx.add(camera);

    return (frameCtx, dt) => {
      player.update(frameCtx, dt);
      const input = frameCtx.input.vector("move");
      if (goalReached && !replayInputReady && input.lengthSq() === 0) replayInputReady = true;
      const replayInput = goalReached && replayInputReady ? input : undefined;
      for (const [index, replayRun] of replayRuns.entries()) {
        replayRun.update(dt, replayInput);
        if (replayRun.complete && replaySnapshots[index] === undefined) {
          replaySnapshots[index] = replayRun.snapshot();
        }
      }
      goalProbe.follow(player.mesh.position);
      const state = frameCtx.state.getState();
      frameCtx.state.set({
        cratesAtRest: CRATE_COUNT,
        playerX: player.mesh.position.x,
        ...(replaySnapshots[0] === undefined || replaySnapshots[1] === undefined
          ? {}
          : { replayMatches: replaySnapshots[0] === replaySnapshots[1] }),
        score: state.score,
      });
    };
  }
}

export function setupPhysicsPuzzleScene(scene: ThreeScene): void {
  scene.background = new Color(0x06101c);
  scene.add(new AmbientLight(0x7794b8, 1.6));
  const key = new DirectionalLight(0xffbf76, 3.2);
  key.position.set(-4, 9, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
}
