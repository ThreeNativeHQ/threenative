import { type ICtx, Scene } from "@threenative/core";
import {
  CharacterBody3D,
  CollisionShape3D,
  type IPhysicsContext,
  RigidBody3D,
  buildStaticColliders,
} from "@threenative/physics";
import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  type Group,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
  Vector3,
} from "three";

/** The wall test contract, in world metres: a 4x3 wall at the origin with a 1x2 opening. */
const OPENING_RAY = { origin: [0, 1, -3], direction: [0, 0, 1] } as const;
const WALL_RAY = { origin: [-1.5, 1, -3], direction: [0, 0, 1] } as const;
const RAY_FAR = 6;
/** The authored wall is on its own collision layer so the proof rays only ever see it. */
const DOORWAY_LAYER = 2;

export interface IDoorwayState extends Record<string, unknown> {
  /** Rays cast through the rendered mesh; a doorway is a miss, an intact wall is a hit. */
  renderedOpeningMiss: boolean;
  renderedWallHit: boolean;
  /** The same rays against the cooked LOD0 trimesh collider. */
  physicsOpeningMiss: boolean;
  physicsWallHit: boolean;
  /** Where the two walkers ended after the scripted crossing. */
  passingZ: number;
  blockedZ: number;
  triangles: number;
}

/**
 * The authored Boolean model through the ordinary asset path: `doorway.glb` is cooked, loaded with
 * `ctx.assets.model`, added to the scene, and given static collision from its own LOD0 geometry.
 *
 * Two walkers cross in +Z: one through the 1 m opening, one into the intact wall. The scenario
 * reads their resting positions, and the four ray observations prove the rendered opening and the
 * collision opening are the same hole.
 */
export class Doorway extends Scene<IDoorwayState, IPhysicsContext> {
  static override readonly initialState: IDoorwayState = {
    blockedZ: -2,
    passingZ: -2,
    physicsOpeningMiss: false,
    physicsWallHit: false,
    renderedOpeningMiss: false,
    renderedWallHit: false,
    triangles: 0,
  };

  #mesh: Mesh | undefined;
  #triangles = 0;
  #passing: CharacterBody3D | undefined;
  #blocked: CharacterBody3D | undefined;
  #queried = false;

  override async load(ctx: ICtx<IDoorwayState, IPhysicsContext>): Promise<void> {
    const model = await ctx.assets.model<{ scene: Group }>("doorway.glb");
    model.scene.name = "doorway";
    model.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.name = "doorway-mesh";
      this.#mesh = object;
      const drawn =
        object.geometry.index?.count ?? object.geometry.getAttribute("position")?.count ?? 0;
      this.#triangles += Math.floor(drawn / 3);
    });
    if (this.#mesh === undefined) throw new Error("doorway.glb contains no mesh");
    ctx.scene.add(model.scene);
  }

  override enter(ctx: ICtx<IDoorwayState, IPhysicsContext>) {
    const mesh = this.#mesh;
    if (mesh === undefined) throw new Error("doorway.glb did not load");

    const camera = ctx.camera as PerspectiveCamera;
    camera.fov = 55;
    camera.near = 0.1;
    camera.far = 400;
    camera.position.set(0, 2.4, 6);
    camera.lookAt(0, 1.2, 0);
    camera.updateProjectionMatrix();
    ctx.add(camera);
    ctx.scene.add(new AmbientLight(0xffffff, 1.6));
    const key = new DirectionalLight(0xffffff, 2.6);
    key.position.set(5, 8, 6);
    ctx.scene.add(key);

    // The engine's own walk of the authored scene: fixed trimesh collision from the imported
    // LOD0 geometry, on its own layer so the proof rays only ever see the doorway.
    buildStaticColliders(ctx, mesh, {
      collisionLayer: DOORWAY_LAYER,
      collisionMask: 0xffff,
      predicate: (object) => object === mesh,
    });

    const floor = ctx.add(
      new Mesh(new BoxGeometry(12, 0.2, 12), new MeshStandardMaterial({ color: 0x40454a })),
    );
    floor.position.set(0, -0.1, 0);
    new RigidBody3D({
      entity: "floor",
      object: floor,
      physics: ctx.physics,
      shape: CollisionShape3D.box(12, 0.2, 12),
      type: "fixed",
    });

    this.#passing = this.#walker(ctx, 0x54c7ff, 0, "passing");
    this.#blocked = this.#walker(ctx, 0xffb454, -1.5, "blocked");

    return (frameCtx: ICtx<IDoorwayState, IPhysicsContext>, dt: number) => {
      const walking = frameCtx.input.pressed("walk");
      // The static ray proof runs on the first held frame, so the run observes a transition rather
      // than a value that was already true when the baseline was captured.
      if (!this.#queried && walking) this.#query(frameCtx);
      const speed = walking ? 2 : 0;
      for (const walker of [this.#passing, this.#blocked]) {
        if (walker === undefined) continue;
        walker.velocity.z = speed;
        walker.moveAndSlide(dt);
      }
      frameCtx.state.set({
        blockedZ: this.#blocked?.object.position.z ?? -2,
        passingZ: this.#passing?.object.position.z ?? -2,
        triangles: this.#triangles,
      });
    };
  }

  #walker(
    ctx: ICtx<IDoorwayState, IPhysicsContext>,
    color: number,
    x: number,
    entity: string,
  ): CharacterBody3D {
    const object = ctx.add(
      new Mesh(new BoxGeometry(0.3, 0.3, 0.3), new MeshStandardMaterial({ color })),
    );
    object.position.set(x, 0.5, -2);
    ctx.entities.add(entity, object);
    return new CharacterBody3D({
      entity,
      object,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.3, 0.2),
      snapToGround: 0.2,
    });
  }

  #query(ctx: ICtx<IDoorwayState, IPhysicsContext>): void {
    const mesh = this.#mesh;
    if (mesh === undefined) throw new Error("doorway.glb did not load");
    this.#queried = true;
    const space = ctx.physics.directSpaceState;

    const renderedOpening = ctx.raycast({
      direction: new Vector3(...OPENING_RAY.direction),
      far: RAY_FAR,
      origin: new Vector3(...OPENING_RAY.origin),
      targets: mesh,
    });
    const renderedWall = ctx.raycast({
      direction: new Vector3(...WALL_RAY.direction),
      far: RAY_FAR,
      origin: new Vector3(...WALL_RAY.origin),
      targets: mesh,
    });
    const physicsOpening = space.intersectRay({
      collisionMask: DOORWAY_LAYER,
      from: { x: OPENING_RAY.origin[0], y: OPENING_RAY.origin[1], z: OPENING_RAY.origin[2] },
      to: {
        x: OPENING_RAY.origin[0] + OPENING_RAY.direction[0] * RAY_FAR,
        y: OPENING_RAY.origin[1],
        z: OPENING_RAY.origin[2] + OPENING_RAY.direction[2] * RAY_FAR,
      },
    });
    const physicsWall = space.intersectRay({
      collisionMask: DOORWAY_LAYER,
      from: { x: WALL_RAY.origin[0], y: WALL_RAY.origin[1], z: WALL_RAY.origin[2] },
      to: {
        x: WALL_RAY.origin[0],
        y: WALL_RAY.origin[1],
        z: WALL_RAY.origin[2] + WALL_RAY.direction[2] * RAY_FAR,
      },
    });

    ctx.state.set({
      physicsOpeningMiss: physicsOpening === undefined,
      physicsWallHit: physicsWall !== undefined,
      renderedOpeningMiss: renderedOpening === undefined,
      renderedWallHit: renderedWall !== undefined,
    });
  }
}
