import {
  BoxGeometry,
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  type MeshBasicMaterial,
  type Object3D,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import { glowMaterial } from "../render/materials.js";
import { palette } from "../render/palette.js";

interface IHost {
  add(object: Object3D): unknown;
}

const BEAMS = 40;
const RINGS = 16;
const SHELLS = 8;
const SPARKS = 320;
const FORWARD = new Vector3(0, 0, 1);

interface IBeam {
  readonly mesh: Mesh;
  life: number;
  total: number;
  thickness: number;
}

interface IRing {
  readonly mesh: Mesh;
  life: number;
  total: number;
  radius: number;
}

interface IShell {
  readonly mesh: Mesh;
  life: number;
  total: number;
  height: number;
  readonly from: Vector3;
  readonly to: Vector3;
  onLand: (() => void) | undefined;
}

interface ISpark {
  life: number;
  total: number;
  readonly position: Vector3;
  readonly velocity: Vector3;
  size: number;
}

/**
 * Every transient the fight throws up — beams, shockwaves, mortar shells and sparks — from fixed
 * pools built once. A burst that finds its pool empty simply skips: the effect is decoration, the
 * damage has already happened. Randomness comes from the seeded source the scene hands in, so the
 * same seed throws the same sparks.
 *
 * Fade is by shrinking, never by opacity, so one shared material serves a whole pool per colour.
 */
export class Effects {
  readonly #beams: IBeam[] = [];
  readonly #rings: IRing[] = [];
  readonly #shells: IShell[] = [];
  readonly #sparks: ISpark[] = [];
  readonly #sparkMesh: InstancedMesh;
  readonly #materials = new Map<number, MeshBasicMaterial>();
  readonly #matrix = new Matrix4();
  readonly #rotation = new Quaternion();
  readonly #scale = new Vector3();
  readonly #colour = new Color();
  readonly #direction = new Vector3();
  readonly #middle = new Vector3();
  readonly #top = new Vector3();
  #nextSpark = 0;

  readonly #random: () => number;

  constructor(host: IHost, random: () => number) {
    this.#random = random;
    const beamGeometry = new BoxGeometry(1, 1, 1);
    for (let index = 0; index < BEAMS; index += 1) {
      const mesh = new Mesh(beamGeometry, this.#material(0xffffff));
      mesh.visible = false;
      host.add(mesh);
      this.#beams.push({ life: 0, mesh, thickness: 0.1, total: 1 });
    }
    const ringGeometry = new RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
    for (let index = 0; index < RINGS; index += 1) {
      const mesh = new Mesh(ringGeometry, this.#material(0xffffff));
      mesh.visible = false;
      host.add(mesh);
      this.#rings.push({ life: 0, mesh, radius: 1, total: 1 });
    }
    const shellGeometry = new SphereGeometry(0.2, 8, 6);
    for (let index = 0; index < SHELLS; index += 1) {
      const mesh = new Mesh(shellGeometry, this.#material(palette.towers.mortar));
      mesh.visible = false;
      host.add(mesh);
      this.#shells.push({
        from: new Vector3(),
        height: 4,
        life: 0,
        mesh,
        onLand: undefined,
        to: new Vector3(),
        total: 1,
      });
    }
    this.#sparkMesh = new InstancedMesh(
      new IcosahedronGeometry(0.1, 0),
      glowMaterial(0xffffff),
      SPARKS,
    );
    this.#sparkMesh.frustumCulled = false;
    this.#sparkMesh.count = 0;
    host.add(this.#sparkMesh);
    for (let index = 0; index < SPARKS; index += 1)
      this.#sparks.push({
        life: 0,
        position: new Vector3(),
        size: 1,
        total: 1,
        velocity: new Vector3(),
      });
  }

  /** Mortar shells still in the air. A wave is not over until they land. */
  get inFlight(): number {
    let count = 0;
    for (const shell of this.#shells) if (shell.life > 0) count += 1;
    return count;
  }

  #material(color: number): MeshBasicMaterial {
    let material = this.#materials.get(color);
    if (material === undefined) {
      material = glowMaterial(color);
      this.#materials.set(color, material);
    }
    return material;
  }

  /** A straight beam between two points that thins to nothing over `life` seconds. */
  beam(from: Vector3, to: Vector3, color: number, life = 0.14, thickness = 0.09): void {
    const slot = this.#beams.find((beam) => beam.life <= 0);
    if (slot === undefined) return;
    slot.mesh.material = this.#material(color);
    slot.life = slot.total = life;
    slot.thickness = thickness;
    this.#direction.subVectors(to, from);
    const length = this.#direction.length();
    this.#middle.addVectors(from, to).multiplyScalar(0.5);
    slot.mesh.position.copy(this.#middle);
    if (length > 1e-4)
      slot.mesh.quaternion.setFromUnitVectors(FORWARD, this.#direction.divideScalar(length));
    slot.mesh.scale.set(thickness, thickness, length);
    slot.mesh.visible = true;
  }

  /** A jagged bolt: `segments` short beams wandering off the straight line. */
  bolt(from: Vector3, to: Vector3, color: number, jitter: () => number, segments = 4): void {
    const previous = new Vector3().copy(from);
    for (let index = 1; index <= segments; index += 1) {
      const next = new Vector3().lerpVectors(from, to, index / segments);
      if (index < segments) next.add(new Vector3(jitter() * 0.5, jitter() * 0.3, jitter() * 0.5));
      this.beam(previous, next, color, 0.16, 0.07);
      previous.copy(next);
    }
  }

  /** A flat shockwave on the ground that grows to `radius` and thins away. */
  ring(at: Vector3, radius: number, color: number, life = 0.4): void {
    const slot = this.#rings.find((ring) => ring.life <= 0);
    if (slot === undefined) return;
    slot.mesh.material = this.#material(color);
    slot.life = slot.total = life;
    slot.radius = radius;
    slot.mesh.position.set(at.x, 0.12, at.z);
    slot.mesh.scale.setScalar(0.01);
    slot.mesh.visible = true;
  }

  /** A mortar shell on a parabola. `onLand` runs when it arrives. */
  shell(from: Vector3, to: Vector3, seconds: number, height: number, onLand: () => void): void {
    const slot = this.#shells.find((shell) => shell.life <= 0);
    if (slot === undefined) {
      onLand();
      return;
    }
    slot.from.copy(from);
    slot.to.copy(to);
    slot.life = slot.total = seconds;
    slot.height = height;
    slot.onLand = onLand;
    slot.mesh.position.copy(from);
    slot.mesh.visible = true;
  }

  /** Sparks thrown outward from `at`, tinted `color`. */
  burst(at: Vector3, color: number, count: number, speed = 4): void {
    this.#colour.set(color);
    for (let index = 0; index < count; index += 1) {
      const slot = this.#sparks[this.#nextSpark];
      this.#nextSpark = (this.#nextSpark + 1) % SPARKS;
      if (slot === undefined) return;
      slot.life = slot.total = 0.35 + this.#random() * 0.4;
      slot.position.copy(at);
      slot.velocity.set(
        (this.#random() - 0.5) * speed,
        this.#random() * speed * 0.9 + 0.5,
        (this.#random() - 0.5) * speed,
      );
      slot.size = 0.6 + this.#random() * 0.9;
      this.#sparkMesh.setColorAt(this.#sparks.indexOf(slot), this.#colour);
    }
    if (this.#sparkMesh.instanceColor !== null) this.#sparkMesh.instanceColor.needsUpdate = true;
  }

  /** The orbital strike's column of light from the sky. */
  column(at: Vector3, color: number): void {
    this.#top.set(at.x, 15, at.z);
    this.beam(this.#top, at, color, 0.5, 0.9);
  }

  update(dt: number): void {
    for (const beam of this.#beams) {
      if (beam.life <= 0) continue;
      beam.life -= dt;
      if (beam.life <= 0) {
        beam.mesh.visible = false;
        continue;
      }
      const t = beam.life / beam.total;
      beam.mesh.scale.x = beam.mesh.scale.y = beam.thickness * t;
    }
    for (const ring of this.#rings) {
      if (ring.life <= 0) continue;
      ring.life -= dt;
      if (ring.life <= 0) {
        ring.mesh.visible = false;
        continue;
      }
      const t = 1 - ring.life / ring.total;
      ring.mesh.scale.setScalar(Math.max(0.01, ring.radius * (1 - (1 - t) * (1 - t))));
    }
    for (const shell of this.#shells) {
      if (shell.life <= 0) continue;
      shell.life -= dt;
      const t = Math.min(1, 1 - shell.life / shell.total);
      shell.mesh.position.lerpVectors(shell.from, shell.to, t);
      shell.mesh.position.y += Math.sin(t * Math.PI) * shell.height;
      if (shell.life > 0) continue;
      shell.mesh.visible = false;
      const land = shell.onLand;
      shell.onLand = undefined;
      land?.();
    }
    let live = 0;
    for (const [index, spark] of this.#sparks.entries()) {
      if (spark.life <= 0) {
        this.#matrix.makeScale(0, 0, 0);
        this.#sparkMesh.setMatrixAt(index, this.#matrix);
        continue;
      }
      live = index + 1;
      spark.life -= dt;
      spark.velocity.y -= 9 * dt;
      spark.position.addScaledVector(spark.velocity, dt);
      const s = Math.max(0, spark.life / spark.total) * spark.size;
      this.#matrix.compose(spark.position, this.#rotation.identity(), this.#scale.set(s, s, s));
      this.#sparkMesh.setMatrixAt(index, this.#matrix);
    }
    this.#sparkMesh.count = live;
    this.#sparkMesh.instanceMatrix.needsUpdate = true;
  }
}
