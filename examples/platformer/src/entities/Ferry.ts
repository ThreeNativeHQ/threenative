import type { Ctx } from "@threenative/core";
import { CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import { Group, Mesh, type Vector3 } from "three";
import type { Materials } from "../render/materials.js";
import { block, roundedBox, tube } from "../render/shapes.js";
import type { GameState } from "../state.js";
import type { Fox } from "./Fox.js";

type GameCtx = Ctx<GameState, PhysicsContext>;

const DECK_WIDTH = 3.4;
const DECK_DEPTH = 3.4;
const DECK_HEIGHT = 0.5;
const RAIL_HEIGHT = 0.9;
const RAIL_THICKNESS = 0.3;

/**
 * A one-way lift across the chasm: parked at the near dock, it departs the
 * moment the fox is standing on it and holds at the far dock forever.
 *
 * One-way and *holding* is a test decision as much as a design one. A
 * ping-ponging platform has no stable end state, so any assertion about where
 * the rider ended up would only hold at one exact tick — and the harness gives
 * a scenario more simulated time than it asks for.
 *
 * Carry itself is the framework's: `CharacterBody3D` reads the kinematic
 * platform under the rider's feet and adds its per-tick delta. Nothing here
 * pushes the fox.
 */
export class Ferry {
  readonly mesh: Mesh;
  readonly body: RigidBody3D;
  readonly rail: RigidBody3D;
  readonly tags = ["ferry"];
  departed = false;
  arrived = false;
  #railMesh: Mesh;
  #from: number;
  #to: number;
  #speed: number;
  #fox: Fox;

  constructor(ctx: GameCtx, materials: Materials, at: Vector3, to: number, speed: number, fox: Fox) {
    this.#from = at.x;
    this.#to = to;
    this.#speed = speed;
    this.#fox = fox;

    this.mesh = new Mesh(
      roundedBox(DECK_WIDTH, DECK_HEIGHT, DECK_DEPTH, 0.12),
      materials.plankDark,
    );
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.position.copy(at);
    ctx.add(this.mesh);

    const deck = new Group();
    for (let index = 0; index < 6; index += 1) {
      const plank = block(DECK_WIDTH / 6 - 0.04, 0.12, DECK_DEPTH - 0.1, materials.plank, {
        radius: 0.05,
      });
      plank.position.set(-DECK_WIDTH / 2 + (index + 0.5) * (DECK_WIDTH / 6), DECK_HEIGHT / 2, 0);
      deck.add(plank);
    }
    for (const side of [-1, 1]) {
      const post = tube(0.1, 0.13, 1.1, materials.plankDark, { segments: 8 });
      post.position.set(DECK_WIDTH / 2 - 0.2, 0.55, (side * DECK_DEPTH) / 2 - side * 0.2);
      deck.add(post);
    }
    this.mesh.add(deck);

    this.body = new RigidBody3D({
      mesh: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(DECK_WIDTH, DECK_HEIGHT, DECK_DEPTH),
      type: "kinematic",
    });

    // A guard rail at the bow, so a rider who keeps running cannot walk off the
    // far edge mid-crossing. It is jumpable — that is how you leave the ferry.
    this.#railMesh = new Mesh(
      roundedBox(RAIL_THICKNESS, RAIL_HEIGHT, DECK_DEPTH, 0.1),
      materials.plank,
    );
    this.#railMesh.castShadow = true;
    this.#railMesh.position.set(
      at.x + DECK_WIDTH / 2 - RAIL_THICKNESS / 2,
      at.y + RAIL_HEIGHT / 2,
      at.z,
    );
    ctx.add(this.#railMesh);
    this.rail = new RigidBody3D({
      mesh: this.#railMesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(RAIL_THICKNESS, RAIL_HEIGHT, DECK_DEPTH),
      type: "kinematic",
    });
  }

  get x(): number {
    return this.mesh.position.x;
  }

  update(dt: number): void {
    if (!this.departed && this.#riderAboard()) this.departed = true;
    if (!this.departed || this.arrived) return;
    const next = Math.min(this.#to, this.mesh.position.x + this.#speed * dt);
    this.mesh.position.x = next;
    this.#railMesh.position.x = next + DECK_WIDTH / 2 - RAIL_THICKNESS / 2;
    if (next >= this.#to) this.arrived = true;
  }

  debug(): Record<string, unknown> {
    return { arrived: this.arrived, departed: this.departed, x: this.mesh.position.x };
  }

  dispose(): void {
    this.rail.dispose();
    this.body.dispose();
    this.#railMesh.removeFromParent();
    this.mesh.removeFromParent();
  }

  #riderAboard(): boolean {
    const fox = this.#fox.position;
    const deck = this.mesh.position;
    return (
      this.#fox.body.grounded &&
      Math.abs(fox.x - deck.x) < DECK_WIDTH / 2 &&
      Math.abs(fox.z - deck.z) < DECK_DEPTH / 2 &&
      fox.y > deck.y &&
      fox.y < deck.y + 2.2
    );
  }

  /** The dock this ferry holds at once it has crossed. Playtests assert it. */
  get destination(): number {
    return this.#to;
  }

  /** Where it starts, so the level can butt it against the near ledge. */
  get origin(): number {
    return this.#from;
  }
}
