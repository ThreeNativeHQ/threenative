import type { Ctx } from "@threenative/core";
import { Area3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { Group, type Vector3 } from "three";
import type { Materials } from "../render/materials.js";
import { ball, block, tube } from "../render/shapes.js";
import type { Counters, GameState } from "../state.js";
import type { Fox } from "./Fox.js";

type GameCtx = Ctx<GameState, PhysicsContext>;

export type EnemyKind = "mushroom" | "snail";

const SPEED: Record<EnemyKind, number> = { mushroom: 1.7, snail: 0.7 };
/** How far above the enemy's centre the fox has to be for a stomp to count. */
const STOMP_HEIGHT = 0.3;
const SQUASH_TIME = 0.3;

function mushroomBody(materials: Materials): Group {
  const group = new Group();
  const stem = tube(0.24, 0.3, 0.46, materials.stem, { segments: 12 });
  stem.position.y = -0.12;
  const cap = ball(0.44, materials.cap, { segments: 14 });
  cap.scale.set(1, 0.66, 1);
  cap.position.y = 0.24;
  group.add(stem, cap);
  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI * 2 + 0.4;
    const spot = ball(0.085, materials.capSpot, { segments: 8 });
    spot.position.set(Math.cos(angle) * 0.27, 0.35, Math.sin(angle) * 0.27);
    group.add(spot);
  }
  for (const side of [-1, 1]) {
    const eye = ball(0.06, materials.eye, { segments: 8 });
    eye.position.set(side * 0.11, -0.06, 0.27);
    // Angled brows: the whole "grumpy" read in two blocks.
    const brow = block(0.15, 0.05, 0.05, materials.eye, { radius: 0.02 });
    brow.position.set(side * 0.12, 0.04, 0.28);
    brow.rotation.z = side * -0.4;
    group.add(eye, brow);
  }
  return group;
}

function snailBody(materials: Materials): Group {
  const group = new Group();
  const foot = block(0.95, 0.28, 0.46, materials.slime, { radius: 0.13 });
  foot.position.y = -0.24;
  group.add(foot);
  // A spiral of shrinking balls: four is enough to read as a shell.
  let radius = 0.42;
  for (let index = 0; index < 4; index += 1) {
    const whorl = ball(radius, index % 2 === 0 ? materials.shell : materials.shellLit, {
      segments: 12,
    });
    const angle = index * 1.5;
    whorl.position.set(
      Math.cos(angle) * index * 0.07,
      0.14 + index * 0.03,
      Math.sin(angle) * index * 0.07 - 0.1,
    );
    group.add(whorl);
    radius *= 0.78;
  }
  const head = ball(0.21, materials.slime, { segments: 12 });
  head.position.set(0, -0.12, 0.42);
  group.add(head);
  for (const side of [-1, 1]) {
    const stalk = tube(0.035, 0.035, 0.26, materials.slime, { segments: 6 });
    stalk.position.set(side * 0.09, 0.06, 0.46);
    const eye = ball(0.065, materials.eye, { segments: 8 });
    eye.position.set(side * 0.09, 0.21, 0.48);
    group.add(stalk, eye);
  }
  return group;
}

/**
 * A patroller. Deliberately not a physics body: it is a sensor plus a mesh, so
 * it can never shove the player or fight the character controller. Stomp it
 * from above and it dies; walk into it and the fox takes the hit.
 */
export class Enemy {
  readonly kind: EnemyKind;
  readonly mesh: Group;
  readonly area: Area3D;
  readonly tags: string[];
  defeated = false;
  #origin: Vector3;
  #range: number;
  #direction = 1;
  #life = 0;
  #squash = 0;
  #unsubscribe: () => void;

  constructor(
    ctx: GameCtx,
    materials: Materials,
    kind: EnemyKind,
    at: Vector3,
    range: number,
    fox: Fox,
    counters: Counters,
  ) {
    this.kind = kind;
    this.tags = ["enemy", kind];
    this.#origin = at.clone();
    this.#range = range;

    this.mesh = kind === "mushroom" ? mushroomBody(materials) : snailBody(materials);
    this.mesh.position.copy(at);
    this.mesh.traverse((child) => {
      child.castShadow = true;
    });
    ctx.add(this.mesh);

    this.area = new Area3D({
      entity: kind,
      physics: ctx.physics,
      position: at,
      shape: CollisionShape3D.sphere(kind === "mushroom" ? 0.66 : 0.62),
    });
    this.#unsubscribe = this.area.on("bodyEntered", (body) => {
      if (this.defeated || body !== fox.body) return;
      const stomped =
        fox.position.y > this.mesh.position.y + STOMP_HEIGHT && fox.body.velocity.y < -0.5;
      if (stomped) {
        this.defeated = true;
        this.#squash = SQUASH_TIME;
        fox.bounce();
        counters.defeated += 1;
        counters.stars += 1;
        return;
      }
      if (fox.hurt(this.mesh.position.x)) counters.hearts = fox.hearts;
    });
  }

  update(dt: number): void {
    if (this.defeated) {
      this.#squash = Math.max(0, this.#squash - dt);
      const t = this.#squash / SQUASH_TIME;
      this.mesh.scale.set(1 + (1 - t) * 0.6, Math.max(0.02, t), 1 + (1 - t) * 0.6);
      if (this.#squash === 0) this.mesh.visible = false;
      return;
    }
    this.#life += dt;
    let x = this.mesh.position.x + this.#direction * SPEED[this.kind] * dt;
    if (x > this.#origin.x + this.#range) {
      x = this.#origin.x + this.#range;
      this.#direction = -1;
    } else if (x < this.#origin.x - this.#range) {
      x = this.#origin.x - this.#range;
      this.#direction = 1;
    }
    // Mushrooms hover, snails do not. One line, and they stop reading as the
    // same prop in two colours.
    const bob = this.kind === "mushroom" ? Math.sin(this.#life * 5) * 0.1 : 0;
    const y = this.#origin.y + bob;
    this.mesh.position.set(x, y, this.#origin.z);
    this.mesh.rotation.y = this.#direction > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.area.body.setTranslation({ x, y, z: this.#origin.z }, true);
  }

  debug(): Record<string, unknown> {
    return { defeated: this.defeated, kind: this.kind, position: this.mesh.position.toArray() };
  }

  dispose(): void {
    this.#unsubscribe();
    this.area.dispose();
    this.mesh.removeFromParent();
  }
}
