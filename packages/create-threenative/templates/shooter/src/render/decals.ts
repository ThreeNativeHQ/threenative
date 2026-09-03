// Generated for you. What a bullet leaves behind is a look decision; this file owns all of it.
import {
  DataTexture,
  DoubleSide,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  type Texture,
  UnsignedByteType,
  Vector3,
} from "three";
import { scale } from "./scale.js";

/** Deterministic value noise, so a rebuilt texture is byte-identical between runs. */
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * One bullet hole: a punched dark core, a bright rim of powdered surface, and a few spall streaks
 * running out from the edge. The streaks are what stop it reading as a sticker — a perfect circle
 * on a wall is a dot, and an irregular one is damage.
 */
export function bulletHoleTexture(size = 64): Texture {
  const data = new Uint8Array(size * size * 4);
  const centre = (size - 1) / 2;
  const streaks = Array.from({ length: 8 }, (_, index) => ({
    angle: (index / 8) * Math.PI * 2 + hash(index, 3) * 0.6,
    reach: 0.5 + hash(index, 7) * 0.34,
    width: 0.06 + hash(index, 11) * 0.09,
  }));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = (x - centre) / centre;
      const py = (y - centre) / centre;
      const radius = Math.sqrt(px * px + py * py);
      const angle = Math.atan2(py, px);
      // Grain keeps the rim from reading as an airbrushed ring.
      const grain = 0.82 + hash(Math.floor(x * 0.7), Math.floor(y * 0.7)) * 0.36;
      const core = 0.34 * grain;
      const rim = 0.56 * grain;
      let alpha = 0;
      let shade = 0;
      if (radius < core) {
        // The hole itself: opaque, and dark rather than pure black so it takes the fog.
        alpha = 1;
        shade = 0.05 + radius * 0.1;
      } else if (radius < rim) {
        // Crushed surface around the entry — the brightest part of a real bullet hole.
        const t = (radius - core) / Math.max(1e-4, rim - core);
        alpha = 1 - t * 0.3;
        shade = 0.22 + t * 0.7;
      } else if (radius < 1) {
        const t = (radius - rim) / (1 - rim);
        alpha = Math.max(0, (1 - t) ** 2.2) * 0.55 * grain;
        shade = 0.78;
      }
      for (const streak of streaks) {
        let delta = Math.abs(angle - streak.angle);
        if (delta > Math.PI) delta = Math.PI * 2 - delta;
        if (radius <= core || radius > streak.reach) continue;
        const across = delta / streak.width;
        if (across > 1) continue;
        const along = 1 - (radius - core) / Math.max(1e-4, streak.reach - core);
        const strength = (1 - across) ** 1.5 * along ** 1.1;
        alpha = Math.max(alpha, strength * 0.9);
        shade = Math.min(shade, 0.14 + (1 - strength) * 0.55);
      }
      const index = (y * size + x) * 4;
      const value = Math.round(Math.min(1, shade) * 255);
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.needsUpdate = true;
  return texture;
}

const FORWARD = new Vector3(0, 0, 1);
// Scratch. The fire path must not allocate.
const scratchQuaternion = new Quaternion();
const scratchRoll = new Quaternion();
const scratchNormal = new Vector3();

/**
 * Bullet holes that stay put.
 *
 * A hole that fades after half a second is worse than no hole: the player learns their rounds land
 * nowhere. So the pool is fixed and recycled round-robin, and the oldest mark quietly gives up its
 * slot rather than every mark expiring on a timer.
 *
 * Each slot gets its own cloned material, which looks wasteful and is not. The renderer batches
 * renderables sharing a geometry *and* a material; a distinct material per slot keeps every mark on
 * the exact draw path. A mark is also pushed `offset` metres along the surface normal — a decal
 * sitting flat on a wall z-fights it into a shimmering ring that reads as a rendering bug.
 */
export class DecalField {
  readonly #slots: Mesh[] = [];
  readonly #geometry: PlaneGeometry;
  readonly #material: MeshBasicMaterial;
  readonly #offset: number;
  #cursor = 0;
  #placed = 0;
  #settled = false;

  constructor(
    parent: Object3D,
    options: { count?: number; offset?: number; size?: number; tint?: number } = {},
  ) {
    this.#offset = options.offset ?? 0.014;
    this.#geometry = new PlaneGeometry(
      options.size ?? scale.bulletHole,
      options.size ?? scale.bulletHole,
    );
    this.#material = new MeshBasicMaterial({
      color: options.tint ?? 0xb9c4cc,
      depthWrite: false,
      map: bulletHoleTexture(),
      // A hole punched through a thin prop should read from behind it too.
      side: DoubleSide,
      transparent: true,
    });
    for (let index = 0; index < (options.count ?? 32); index += 1) {
      const mesh = new Mesh(this.#geometry, this.#material.clone());
      // Present from the first frame at a size nothing can see, so this material's pipeline is
      // built during loading rather than on the frame the first round lands.
      mesh.scale.setScalar(0.0001);
      mesh.visible = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      parent.add(mesh);
      this.#slots.push(mesh);
    }
  }

  get placed(): number {
    return this.#placed;
  }

  get capacity(): number {
    return this.#slots.length;
  }

  /**
   * Stop submitting the slots nobody has used yet.
   *
   * Every slot is resident from frame one so its pipeline compiles during loading. The cost is a
   * draw call per unused slot, forever, and on a phone the draw call is the expensive part. Once
   * the pipeline is compiled it stays compiled, so hiding a slot afterwards costs nothing to undo.
   * Call this a second or two in — not on the first frame, or the compile this exists to force
   * will not have happened yet.
   */
  settle(): void {
    this.#settled = true;
    for (const mesh of this.#slots) if (mesh.scale.x <= 0.001) mesh.visible = false;
  }

  /**
   * Stick a mark on a surface. `normal` is expected in world space, already transformed off the
   * struck object — a raycast's face normal is object-local and will send marks into walls.
   */
  place(point: Vector3, normal: Vector3, size = 1): void {
    const mesh = this.#slots[this.#cursor % this.#slots.length];
    this.#cursor += 1;
    if (mesh === undefined) return;
    this.#placed += 1;
    scratchNormal.copy(normal).normalize();
    scratchQuaternion.setFromUnitVectors(FORWARD, scratchNormal);
    // Spin about the normal so a wall taking a burst is not tiled with the same mark.
    scratchRoll.setFromAxisAngle(FORWARD, (this.#placed * 2.399) % (Math.PI * 2));
    scratchQuaternion.multiply(scratchRoll);
    mesh.quaternion.copy(scratchQuaternion);
    mesh.position.copy(point).addScaledVector(scratchNormal, this.#offset);
    mesh.scale.setScalar(size);
    mesh.visible = true;
    // The renderer reads the mark off its world matrix and this slot moved after the last scene
    // update; without this the mark draws one frame behind, at its previous hit.
    mesh.updateMatrixWorld(true);
  }

  /** Registered as an entity so a scenario can assert that a round actually left a mark. */
  debug(): { capacity: number; placed: number } {
    return { capacity: this.capacity, placed: this.#placed };
  }

  clear(): void {
    for (const mesh of this.#slots) {
      mesh.scale.setScalar(0.0001);
      if (this.#settled) mesh.visible = false;
    }
    this.#cursor = 0;
  }

  dispose(): void {
    for (const mesh of this.#slots) {
      (mesh.material as Material).dispose();
      mesh.removeFromParent();
    }
    this.#slots.length = 0;
    this.#geometry.dispose();
    this.#material.dispose();
  }
}
