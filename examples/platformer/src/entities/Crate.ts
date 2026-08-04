import type { Ctx } from "@threenative/core";
import {
  Area3D,
  CollisionShape3D,
  type PhysicsContext,
  RigidBody3D,
} from "@threenative/physics";
import { Group, Mesh, type Vector3 } from "three";
import type { Materials } from "../render/materials.js";
import { ball, block, roundedBox } from "../render/shapes.js";
import type { Counters, GameState } from "../state.js";
import type { Fox } from "./Fox.js";

type GameCtx = Ctx<GameState, PhysicsContext>;

const SIZE = 1.2;
const BUMP_TIME = 0.26;
const PAYOUT = 5;

/**
 * The `?` crate. Solid enough to stand on, with a sensor on top of the same
 * volume for the payout — a Rapier sensor cannot also be a floor, so it is two
 * colliders on purpose.
 */
export class Crate {
  readonly mesh: Mesh;
  readonly body: RigidBody3D;
  readonly area: Area3D;
  readonly tags = ["crate"];
  spent = false;
  #decor: Group;
  #baseY: number;
  #bump = 0;
  #unsubscribe: () => void;

  constructor(ctx: GameCtx, materials: Materials, at: Vector3, fox: Fox, counters: Counters) {
    // The collider mesh is invisible and never moves: the physics plugin
    // rewrites its transform from the body every step, so anything that
    // animates has to be a child of it, not it.
    this.mesh = new Mesh(roundedBox(SIZE, SIZE, SIZE, 0.13), materials.crate);
    this.mesh.visible = false;
    this.mesh.position.copy(at);
    ctx.add(this.mesh);
    this.#baseY = 0;

    this.#decor = new Group();
    const box = block(SIZE, SIZE, SIZE, materials.crate, { radius: 0.13 });
    this.#decor.add(box);
    for (const side of [-1, 1]) {
      for (const height of [-0.44, 0.44]) {
        const bolt = ball(0.075, materials.crateBolt, { segments: 8 });
        bolt.position.set(side * 0.44, height, 0.61);
        this.#decor.add(bolt);
      }
    }
    // The "?" as three blocks: a hook, a stem and a dot. Reads at any distance,
    // and needs no texture — which is the point, see AGENTS.md.
    const hook = block(0.36, 0.16, 0.09, materials.crateBolt, { radius: 0.04 });
    hook.position.set(-0.02, 0.26, 0.62);
    const stem = block(0.16, 0.3, 0.09, materials.crateBolt, { radius: 0.04 });
    stem.position.set(0.1, 0.04, 0.62);
    const dot = block(0.16, 0.16, 0.09, materials.crateBolt, { radius: 0.04 });
    dot.position.set(0.1, -0.28, 0.62);
    const banding = block(SIZE + 0.04, 0.12, SIZE + 0.04, materials.crateDark, { radius: 0.05 });
    banding.position.y = -0.5;
    this.#decor.add(hook, stem, dot, banding);
    this.#decor.traverse((child) => {
      child.castShadow = true;
      child.receiveShadow = true;
    });
    this.mesh.add(this.#decor);

    this.body = new RigidBody3D({
      mesh: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(SIZE, SIZE, SIZE),
      type: "fixed",
    });

    this.area = new Area3D({
      entity: "crate",
      physics: ctx.physics,
      position: at,
      shape: CollisionShape3D.box(SIZE + 0.3, SIZE + 0.3, SIZE + 0.3),
    });
    this.#unsubscribe = this.area.on("bodyEntered", (body) => {
      // Only a rising fox pays out — walking past or landing on it does not.
      if (this.spent || body !== fox.body || fox.body.velocity.y <= 0.5) return;
      this.spent = true;
      this.#bump = BUMP_TIME;
      counters.coins += PAYOUT;
      hook.visible = false;
      stem.visible = false;
      dot.visible = false;
      box.material = materials.crateDark;
    });
  }

  update(dt: number): void {
    this.#bump = Math.max(0, this.#bump - dt);
    // Only the visual hops. The body is fixed and the plugin rewrites the
    // collider mesh's transform every step, so this has to be the child group.
    this.#decor.position.y = this.#baseY + Math.sin((this.#bump / BUMP_TIME) * Math.PI) * 0.28;
  }

  debug(): Record<string, unknown> {
    return { position: this.mesh.position.toArray(), spent: this.spent };
  }

  dispose(): void {
    this.#unsubscribe();
    this.area.dispose();
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
