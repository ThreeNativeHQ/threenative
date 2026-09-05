import { AnimationPlayer, type ICtx, Scene, type SceneFrame } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import type { Object3D, PerspectiveCamera } from "three";
import {
  AnimationClip,
  BoxGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import type { IRangeState } from "../state.js";

type RangeCtx = ICtx<IRangeState, IPhysicsContext>;

const RUN_SECONDS = 60;
const RANGE_METRES = 60;
const LOOK_SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.01;
const EYE_HEIGHT = 1.6;
const DEATH_CLIP = "DeathFront";
const DEATH_SECONDS = 1.2;
const CRATE_SIZE = 0.6;
const CRATE_DROP_HEIGHT = 3;
const WALK_CLIP = "Walk";
/** One second of cycle carrying two metres of ground: the clip's own speed at rate 1. */
const WALK_SECONDS = 1;
const WALK_CLIP_METRES = 2;
/** How fast the patroller's body actually travels, and how far it goes before turning round. */
const PATROL_SPEED = 1.6;
const PATROL_HALF_SPAN = 2;
const PATROL_CENTRE_X = -4;
const PATROL_Z = -12;

/** A solid the shot ray can stop on: half extents, and where its centre sits. */
interface ISolid {
  readonly centre: { x: number; y: number; z: number };
  readonly size: { x: number; y: number; z: number };
}

/**
 * Ground, back wall and two side walls. None of them has a mesh of its own — the yard is drawn
 * by one visual floor — which is the case `RigidBody3D` could not express before it took a
 * `position`.
 */
const SOLIDS: readonly ISolid[] = [
  { centre: { x: 0, y: -0.5, z: -30 }, size: { x: 40, y: 1, z: 64 } },
  { centre: { x: 0, y: 3, z: -62 }, size: { x: 40, y: 6, z: 1 } },
  { centre: { x: -20, y: 3, z: -30 }, size: { x: 1, y: 6, z: 64 } },
  { centre: { x: 20, y: 3, z: -30 }, size: { x: 1, y: 6, z: 64 } },
];

function box(width: number, height: number, depth: number, color: number): Mesh {
  return new Mesh(new BoxGeometry(width, height, depth), new MeshBasicMaterial({ color }));
}

/** A one-shot fall, authored in code so the example carries no third-party rig. */
function deathClip(): AnimationClip {
  return new AnimationClip(DEATH_CLIP, DEATH_SECONDS, [
    new VectorKeyframeTrack(".position", [0, DEATH_SECONDS], [0, 0.9, -16, 0, 0.2, -16.4]),
  ]);
}

/**
 * A looping locomotion cycle whose root carries {@link WALK_CLIP_METRES} of ground per second.
 *
 * Authored in code for the same reason the death clip is: no third-party rig ships here. It exists
 * so the *stride* convention — feet meet the floor — has a live caller that actually walks.
 * `assert.animation[].maxFootSlide` had unit proof and no game behind it until this.
 */
function walkClip(): AnimationClip {
  return new AnimationClip(WALK_CLIP, WALK_SECONDS, [
    new VectorKeyframeTrack(".position", [0, WALK_SECONDS], [0, 0, 0, WALK_CLIP_METRES, 0, 0]),
  ]);
}

export class Range extends Scene<IRangeState, IPhysicsContext> {
  static override readonly initialState: IRangeState = {
    allHits: 0,
    crateY: CRATE_DROP_HEIGHT,
    hits: 0,
    lookYaw: 0,
    shots: 0,
    timeRemaining: RUN_SECONDS,
  };

  #detachCapture: (() => void) | undefined;

  override exit(): void {
    this.#detachCapture?.();
    this.#detachCapture = undefined;
  }

  override enter(ctx: RangeCtx): SceneFrame<IRangeState, IPhysicsContext> {
    const camera = ctx.camera as PerspectiveCamera;
    camera.rotation.order = "YXZ";
    camera.position.set(0, EYE_HEIGHT, 0);
    ctx.add(camera);

    // PRD-145: a fixed body straight from a position. There is no carrier Object3D here.
    for (const solid of SOLIDS) {
      new RigidBody3D({
        physics: ctx.physics,
        position: solid.centre,
        shape: CollisionShape3D.box(solid.size.x, solid.size.y, solid.size.z),
        type: "fixed",
      });
    }

    const floor = box(40, 0.1, 64, 0x1d2733);
    floor.name = "floor";
    floor.position.set(0, 0, -30);
    ctx.add(floor);

    // Dropped onto the position-only floor body. If that body were missing the crate would
    // fall past the yard forever, so `crateY` settling is what makes PRD-145 observable.
    const crate = box(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE, 0x7f8c8d);
    crate.name = "crate";
    crate.position.set(2.5, CRATE_DROP_HEIGHT, -6);
    ctx.add(crate);
    new RigidBody3D({
      mass: 1,
      object: crate,
      physics: ctx.physics,
      shape: CollisionShape3D.box(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE),
      type: "dynamic",
    });

    // Thin dressing on the shot line. It is nearest, so `raycast` alone reports it and the
    // enemy behind it is never scored — the shape of the FPS build's occlusion problem.
    const plate = new Mesh(new PlaneGeometry(1.4, 1.4), new MeshBasicMaterial({ color: 0xd8a657 }));
    plate.name = "plate";
    plate.position.set(0, 1.4, -8);
    plate.userData.dressing = 1;
    ctx.add(plate);

    const enemyProxy = box(0.7, 1.8, 0.5, 0xc0392b);
    enemyProxy.name = "enemy-proxy";
    enemyProxy.position.set(0, 0.9, -16);
    enemyProxy.userData.enemy = 1;
    ctx.add(enemyProxy);

    // PRD-139: welded to the camera, so a whole-scene ray hits it at 0.3 m and every shot
    // misses. The call site narrows with `targets` instead of maintaining its own raycaster.
    const viewmodel = box(0.12, 0.12, 0.6, 0x2e3b4e);
    viewmodel.position.set(0.22, -0.18, -0.35);
    camera.add(viewmodel);

    const hittable: Object3D[] = [floor, plate, enemyProxy];

    // PRD-141: a one-shot clip that holds its last frame, with no scheduled freeze hack.
    const animation = new AnimationPlayer({ clips: [deathClip()], root: enemyProxy });
    let dying = false;
    const enemy = {
      animation,
      mesh: enemyProxy,
      get state(): string {
        if (animation.finished) return "dead-finished";
        return dying ? "dying" : "alive";
      },
    };
    ctx.entities.add("enemy", enemy);

    // The rig hangs off a body the game moves, which is the shape stride sync is written for:
    // the clip writes the model's own root track, so measuring the object the mixer writes would
    // read the clip's motion back as if it were the body's.
    const patrolBody = new Group();
    patrolBody.position.set(PATROL_CENTRE_X, 0.9, PATROL_Z);
    const patrolRig = box(0.6, 1.8, 0.4, 0x2d8f5f);
    patrolBody.add(patrolRig);
    ctx.add(patrolBody);
    const patrolAnimation = new AnimationPlayer({
      clips: [walkClip()],
      root: patrolRig,
      strideRoot: patrolBody,
    });
    patrolAnimation.play(WALK_CLIP);
    let patrolDirection = 1;
    ctx.entities.add("patroller", { animation: patrolAnimation, mesh: patrolBody });

    // PRD-138: relative pointer look. Pointer lock is the framework's to ask for; the game
    // reads an axis. Nothing here touches `document`, so the native bundle keeps this path.
    let yaw = 0;
    let pitch = 0;
    const capture = (): void => {
      if (!ctx.input.raw.pointer.captured) ctx.input.captureMouse();
    };
    ctx.renderer.domElement.addEventListener("pointerdown", capture);
    this.#detachCapture = () => ctx.renderer.domElement.removeEventListener("pointerdown", capture);

    const origin = new Vector3();
    const direction = new Vector3();
    let shots = 0;
    let hits = 0;
    let allHits = 0;
    let elapsed = 0;

    const fire = (frameCtx: RangeCtx): void => {
      shots += 1;
      camera.getWorldPosition(origin);
      camera.getWorldDirection(direction);
      const nearest = frameCtx.raycast({
        direction,
        far: RANGE_METRES,
        origin,
        targets: hittable,
      });
      const ordered = frameCtx.raycastAll({
        direction,
        far: RANGE_METRES,
        origin,
        targets: hittable,
      });
      allHits = ordered.length;
      // `raycast` stops on the dressing plate; the solid behind it needs the whole ordered
      // list. Both come from the framework now — the build kept two `Raycaster`s to do this.
      const solid = ordered.find((entry) => entry.object.userData.dressing === undefined);
      if (nearest?.object !== plate || solid?.object !== enemyProxy) return;
      hits += 1;
      if (dying) return;
      dying = true;
      animation.play(DEATH_CLIP, { fade: 0.06, mode: "once" });
    };

    return (frameCtx, dt) => {
      elapsed += dt;

      if (frameCtx.input.raw.pointer.captured) {
        const look = frameCtx.input.vector("look");
        yaw -= look.x * LOOK_SENSITIVITY;
        pitch = MathUtils.clamp(pitch - look.y * LOOK_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
        camera.rotation.set(pitch, yaw, 0);
      }

      // Move the body first, then advance the clip: stride reads the ground the game just
      // covered, so a player that updates the mixer before it moves measures the previous frame.
      patrolBody.position.x += patrolDirection * PATROL_SPEED * dt;
      if (Math.abs(patrolBody.position.x - PATROL_CENTRE_X) > PATROL_HALF_SPAN) {
        patrolDirection *= -1;
        patrolBody.position.x = MathUtils.clamp(
          patrolBody.position.x,
          PATROL_CENTRE_X - PATROL_HALF_SPAN,
          PATROL_CENTRE_X + PATROL_HALF_SPAN,
        );
      }
      patrolBody.rotation.y = patrolDirection > 0 ? Math.PI / 2 : -Math.PI / 2;
      patrolAnimation.update(dt);

      const wasFinished = animation.finished;
      if (dying) animation.update(dt);
      if (frameCtx.input.justPressed("fire")) fire(frameCtx);

      frameCtx.state.set({
        allHits,
        crateY: crate.position.y,
        hits,
        lookYaw: yaw,
        shots,
        timeRemaining: Math.max(0, RUN_SECONDS - elapsed),
      });
      // The throttled sampler must not miss the two transitions the scenarios assert.
      if (frameCtx.input.justPressed("fire") || (animation.finished && !wasFinished))
        frameCtx.state.flush();
    };
  }
}
