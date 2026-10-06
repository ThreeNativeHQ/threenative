import { Scene, afterPhysics } from "@threenative/core";
import type { ICtx, SceneFrame } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D } from "@threenative/physics";
import type { IPhysicsContext } from "@threenative/physics";
import { createAnimalActor, loadAnimalBake } from "@threenative/procedural-animals";
import type { IAnimalBake } from "@threenative/procedural-animals";
import { Group, Vector3 } from "three";
import { animalMaterial } from "./render/animal-material.js";
import { course } from "./render/course.js";
import { wolfMotion } from "./render/wolf-motion.js";

export interface IAnimalsState extends Record<string, unknown> {
  loaded: boolean;
  wolves: number;
  elapsed: number;
  rootError: number;
  vertices: number;
  bones: number;
  phase: string;
}
type AnimalsCtx = ICtx<IAnimalsState, IPhysicsContext>;

export class Animals extends Scene<IAnimalsState, IPhysicsContext> {
  static override readonly initialState: IAnimalsState = {
    loaded: false,
    wolves: 0,
    elapsed: 0,
    rootError: 0,
    vertices: 0,
    bones: 0,
    phase: "loading",
  };
  #bake: IAnimalBake | undefined;
  #abort = new AbortController();
  #cleanup: (() => void)[] = [];
  override async load(ctx: AnimalsCtx): Promise<void> {
    this.#abort = new AbortController();
    this.#bake = await loadAnimalBake(ctx.assets, "wolf-crowd.animal", {
      signal: this.#abort.signal,
    });
  }
  override enter(ctx: AnimalsCtx): SceneFrame<IAnimalsState, IPhysicsContext> {
    const bake = this.#bake;
    if (!bake) throw new Error("TN_ANIMAL_MISSING_BAKE");
    this.#cleanup.push(course(ctx));
    const ground = (x: number, z: number) => {
      const hit = ctx.physics.directSpaceState.intersectRay({
        from: { x, y: 50, z },
        to: { x, y: -50, z },
        collisionMask: 1,
      });
      if (!hit) throw new Error("TN_ANIMAL_GROUND_MISSING");
      return hit.position.y;
    };
    const halfHeight = 0.12;
    const radius = 0.25;
    const actors = Array.from({ length: 32 }, (_, index) => {
      const root = new Group();
      root.name = `wolf-body-${index}`;
      root.position.set(
        ((index % 8) - 3.5) * 1.45,
        1.2,
        index === 0 ? -8 : Math.floor(index / 8) * 2 - 3,
      );
      ctx.add(root);
      const body = new CharacterBody3D({
        object: root,
        physics: ctx.physics,
        shape: CollisionShape3D.capsule(halfHeight, radius),
        collisionLayer: 2,
        collisionMask: 5,
      });
      const animal = createAnimalActor(bake, {
        material: animalMaterial,
        motion: wolfMotion,
        ground,
        visualOriginOffset: { x: 0, y: -(halfHeight + radius), z: 0 },
      });
      animal.object.name = `wolf-${index}`;
      animal.mesh.castShadow = animal.mesh.receiveShadow = true;
      ctx.add(animal.object);
      ctx.entities.add(`wolf-${index}`, { body, mesh: animal.object });
      this.#cleanup.push(() => {
        animal.dispose();
        body.dispose();
        root.removeFromParent();
      });
      return { root, body, animal, previous: root.position.clone(), velocity: new Vector3() };
    });
    let elapsed = 0;
    let teleported = false;
    let posture = 0;
    this.#cleanup.push(
      afterPhysics(ctx, (dt) => {
        let rootError = 0;
        for (const { root, animal, previous, velocity } of actors) {
          velocity.copy(root.position).sub(previous).divideScalar(dt);
          animal.follow({ position: root.position, velocity, heading: root.rotation.y }, dt);
          previous.copy(root.position);
          rootError = Math.max(rootError, animal.object.position.distanceTo(root.position));
        }
        ctx.state.set({
          loaded: true,
          wolves: actors.length,
          elapsed,
          rootError,
          vertices: bake.nV,
          bones: bake.bones.length,
          phase: elapsed < 3 ? "walk-wall" : elapsed < 6 ? "turn" : elapsed < 9 ? "walk" : "stop",
        });
      }),
    );
    return (_frameCtx, dt) => {
      elapsed += dt;
      for (const actor of actors) {
        const turning = elapsed >= 3 && elapsed < 6;
        actor.root.rotation.y = turning ? Math.PI / 2 : Math.PI;
        actor.body.velocity.set(
          turning ? 1.5 : 0,
          actor.body.velocity.y,
          elapsed < 9 && !turning ? -1.5 : 0,
        );
        actor.body.moveAndSlide(dt);
      }
      const first = actors[0];
      if (!first) throw new Error("TN_ANIMAL_EMPTY_CORPUS");
      if (elapsed >= 12 && !teleported) {
        teleported = true;
        const position = new Vector3(0, ground(0, -4) + halfHeight + radius, -4);
        first.body.teleport(position);
        first.previous.copy(position);
        first.animal.teleport({
          position,
          velocity: new Vector3(),
          heading: first.root.rotation.y,
        });
      }
      first.animal.paused = elapsed >= 14 && elapsed < 15;
      if (elapsed >= 16 && posture === 0) {
        posture = 1;
        void first.animal.play("sit");
      }
      if (elapsed >= 19 && posture === 1) {
        posture = 2;
        void first.animal.play("lie");
      }
      if (elapsed >= 22 && posture === 2) {
        posture = 3;
        void first.animal.play("stand");
      }
    };
  }
  override exit(): void {
    this.#abort.abort();
    for (const cleanup of this.#cleanup.splice(0).reverse()) cleanup();
  }
}
