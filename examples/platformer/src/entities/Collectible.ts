import type { Ctx } from "@threenative/core";
import { Area3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { CylinderGeometry, Group, Mesh, OctahedronGeometry, type Vector3 } from "three";
import type { Materials } from "../render/materials.js";
import type { Counters, GameState } from "../state.js";
import type { Fox } from "./Fox.js";

type GameCtx = Ctx<GameState, PhysicsContext>;

export type CollectibleKind = "coin" | "gem";

// Baked upright in the geometry rather than rotated per mesh: a coin has to
// face the camera, and a bake cannot be quietly undone by a parent transform.
const COIN_GEOMETRY = new CylinderGeometry(0.34, 0.34, 0.14, 22).rotateX(Math.PI / 2);
const GEM_GEOMETRY = new OctahedronGeometry(0.34, 0);

/**
 * A coin or a gem: a sensor volume, a spinning mesh, and a one-shot pickup.
 * Both use the same class because the only differences are the geometry, the
 * spin rate and which counter goes up — which is not two classes' worth.
 */
export class Collectible {
  readonly kind: CollectibleKind;
  readonly mesh: Group;
  readonly area: Area3D;
  readonly tags: string[];
  collected = false;
  #spin: number;
  #bobPhase: number;
  #baseY: number;
  #life = 0;
  #pop = 0;
  #unsubscribe: () => void;

  constructor(
    ctx: GameCtx,
    materials: Materials,
    kind: CollectibleKind,
    at: Vector3,
    fox: Fox,
    counters: Counters,
  ) {
    this.kind = kind;
    this.tags = [kind];
    this.#spin = kind === "coin" ? 1.5 : 1.7;
    this.#bobPhase = at.x * 0.7 + at.z * 1.3;
    this.#baseY = at.y;

    this.mesh = new Group();
    const face = new Mesh(
      kind === "coin" ? COIN_GEOMETRY : GEM_GEOMETRY,
      kind === "coin" ? materials.coin : materials.gem,
    );
    face.castShadow = true;
    this.mesh.add(face);
    this.mesh.position.copy(at);

    ctx.add(this.mesh);

    this.area = new Area3D({
      entity: kind,
      physics: ctx.physics,
      position: at,
      shape: CollisionShape3D.sphere(kind === "coin" ? 0.78 : 0.92),
    });
    this.#unsubscribe = this.area.on("bodyEntered", (body) => {
      if (this.collected || body !== fox.body) return;
      this.collected = true;
      this.#pop = 0.22;
      if (kind === "coin") counters.coins += 1;
      else counters.gems += 1;
    });
  }

  update(dt: number): void {
    this.#life += dt;
    if (this.collected) {
      // Bloom and vanish rather than blinking out — four frames of motion is
      // the cheapest quality-per-line in the whole project.
      this.#pop = Math.max(0, this.#pop - dt);
      const t = this.#pop / 0.22;
      this.mesh.scale.setScalar(Math.max(0.001, 1 + (1 - t) * 0.9));
      this.mesh.position.y = this.#baseY + (1 - t) * 0.9;
      if (this.#pop === 0) this.mesh.visible = false;
      return;
    }
    // Coins stay face-on and *wobble*, they do not tumble. A full Y spin is the
    // classic look but it spends half its cycle edge-on, where a coin at this
    // distance stops reading as a coin at all — the reference keeps them flat
    // to camera for exactly that reason. Gems, having no flat side, do tumble.
    this.mesh.rotation.y =
      this.kind === "coin"
        ? Math.sin(this.#life * this.#spin + this.#bobPhase) * 0.45
        : this.mesh.rotation.y + this.#spin * dt;
    this.mesh.position.y = this.#baseY + Math.sin(this.#life * 2.6 + this.#bobPhase) * 0.14;
  }

  debug(): Record<string, unknown> {
    return { collected: this.collected, kind: this.kind };
  }

  dispose(): void {
    this.#unsubscribe();
    this.area.dispose();
    this.mesh.removeFromParent();
  }
}
