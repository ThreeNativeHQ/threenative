import { PathFollow3D } from "@threenative/core";
import { CircleGeometry, Group, Mesh, MeshBasicMaterial, type Object3D, Vector3 } from "three";
import { decor, pads, reactor as reactorModel, road, terrain } from "../render/shapes.js";
import { PADS, REACTOR, roundedRoute } from "./Route.js";

interface IHost {
  add(object: Object3D): unknown;
}

/** How far from a pad's centre a tap still counts as that pad: Bastion's own forgiving radius. */
export const PAD_TAP_RADIUS = 1.35;

/**
 * The diorama: slab, road, forest, reactor and the sixteen pads, plus the invisible discs the
 * pointer hits. Nothing here decides how anything looks — that is `render/shapes.ts` — this only
 * decides where things stand and which pads are taken.
 */
export class Board {
  /** The road, as the points `PathFollow3D` walks. */
  readonly points: readonly Vector3[];
  /** Invisible tap targets, one disc per pad, named `pad-<index>`. */
  readonly hits = new Group();
  /** The slab, for taps that land on no pad. */
  readonly ground = terrain();
  readonly #occupied = new Set<number>();
  readonly #reactor: Group;
  #time = 0;

  constructor(host: IHost) {
    this.points = roundedRoute();
    const path = new PathFollow3D({ points: this.points });
    const line = path.curve.getSpacedPoints(280);
    host.add(this.ground);
    host.add(road(line));
    const keepClear: (readonly [number, number, number])[] = [
      [REACTOR.x, REACTOR.z, 3.4],
      ...line.filter((_, index) => index % 3 === 0).map((p) => [p.x, p.z, 2.3] as const),
    ];
    const hitMaterial = new MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      opacity: 0,
      transparent: true,
    });
    const hitGeometry = new CircleGeometry(PAD_TAP_RADIUS, 24).rotateX(-Math.PI / 2);
    this.hits.name = "pad-hits";
    for (const [index, [x, z]] of PADS.entries()) {
      keepClear.push([x, z, 2.1]);
      const hit = new Mesh(hitGeometry, hitMaterial);
      hit.position.set(x, 0.3, z);
      hit.name = `pad-${index}`;
      this.hits.add(hit);
    }
    host.add(pads(PADS));
    host.add(decor(keepClear));
    this.#reactor = reactorModel();
    this.#reactor.position.copy(REACTOR);
    host.add(this.#reactor);
    host.add(this.hits);
  }

  occupied(index: number): boolean {
    return this.#occupied.has(index);
  }

  occupy(index: number): void {
    this.#occupied.add(index);
  }

  free(index: number): void {
    this.#occupied.delete(index);
  }

  position(index: number, target = new Vector3()): Vector3 {
    const pad = PADS[index];
    if (pad === undefined) throw new Error(`There is no pad ${index}.`);
    return target.set(pad[0], 0, pad[1]);
  }

  /** The pad a tap or hover landed on, from any object inside `hits`. */
  padOf(object: Object3D): number | undefined {
    const match = /^pad-(\d+)$/u.exec(object.name);
    return match?.[1] === undefined ? undefined : Number(match[1]);
  }

  /** Spins the reactor core and lets it bob. Cosmetic, and driven by game time. */
  update(dt: number): void {
    this.#time += dt;
    const core = this.#reactor.getObjectByName("core");
    const ring = this.#reactor.getObjectByName("ring");
    if (core !== undefined) {
      core.rotation.y += dt * 0.9;
      core.position.y = 1.95 + Math.sin(this.#time * 1.6) * 0.09;
    }
    if (ring !== undefined) {
      ring.rotation.z += dt * 1.3;
      ring.position.y = core?.position.y ?? 1.95;
    }
  }
}
