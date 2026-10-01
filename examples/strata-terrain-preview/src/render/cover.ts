// Mossy boulders and the meadow's ground cover: grass clumps and poppy clusters.
//
// All three are appearance, all three are built here, and none of them is a primitive. A
// `SphereGeometry` with vertex noise on it is a ball with lumps; a boulder is a rock with facets
// that catch the sun along their edges, a flattened top where something rolled off it, a base
// buried in the ground so it grows out of the hillside instead of resting on it, and moss on the
// upward faces only, because moss does not grow on a vertical face.
//
// Grass is the other thing a cone cannot be. A blade is a tapered curved strip, dark at the root
// and light at the tip, and a clump is a handful of them at different angles — which is what makes
// a lawn read as depth rather than as a green plane with a texture on it.
import { createRandom } from "@threenative/core";
import { BufferAttribute, BufferGeometry, IcosahedronGeometry, Vector3 } from "three";

/** How the boulders read, in metres. Sized against a spruce's 12-17 m, not in the abstract. */
export const ROCK = {
  /** Radius at the widest point of the biggest variant. */
  radius: 1.9,
  /** Flattening: a boulder is wider than it is tall, because it fell over. */
  flatten: 0.62,
  /** How much of the base sits below the placement point, as a share of its height. */
  buried: 0.34,
  /** Facet noise, as a share of the radius. Past a third it stops being a rock and becomes a cloud. */
  rough: 0.26,
  /** How flat the noise is: 1 is a smooth blob, high values are shattered facets. */
  facets: 3,
} as const;

/**
 * One seeded boulder: a displaced icosphere, flat-shaded, buried at the base.
 *
 * `IcosahedronGeometry` at detail 2 already has 320 faces, which is the right budget for a rock you
 * see from four metres away: enough that the facets read as fracture, few enough that four hundred
 * of them are affordable. The displacement is a sum of sines at incommensurate frequencies, so no
 * two boulders share a lump pattern, and the whole surface is then `toNonIndexed()` so every facet
 * gets its own normal — smooth-shaded noise reads as a melted blob, not as stone.
 */
export function boulder(seed: number): BufferGeometry {
  const random = createRandom(seed);
  const geometry = new IcosahedronGeometry(ROCK.radius, ROCK.facets);
  const position = geometry.getAttribute("position") as BufferAttribute;
  const phase = random() * Math.PI * 2;
  const phase2 = random() * Math.PI * 2;
  const phase3 = random() * Math.PI * 2;
  const point = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i);
    const direction = point.clone().normalize();
    // Three sine lobes at different frequencies: broad swells, a mid facet and a fine chip.
    const swell = Math.sin(direction.x * ROCK.facets + phase) * 0.55;
    const facet = Math.sin(direction.y * ROCK.facets * 2.3 + phase2) * 0.3;
    const chip = Math.sin(direction.z * ROCK.facets * 5.1 + phase3) * 0.15;
    const displaced = ROCK.radius * (1 + (swell + facet + chip) * ROCK.rough);
    point.copy(direction).multiplyScalar(displaced);
    point.y *= ROCK.flatten;
    // Flatten the top and round the bottom: a boulder that has sat in a hillside for a century has
    // a plane where the ground pushes on it, and a rounded underside where the soil closes under.
    if (point.y > 0) point.y = point.y * 0.86;
    position.setXYZ(i, point.x, point.y, point.z);
  }
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  flat.computeVertexNormals();
  // Bury the base: the placement point is the ground, and the rock has to come out of it.
  flat.translate(0, -ROCK.radius * ROCK.flatten * ROCK.buried, 0);
  flat.computeBoundingSphere();
  return flat;
}

/** One grass clump's blade count and height, in metres. Knee-high meadow grass, not a lawn. */
export const GRASS = {
  blades: 7,
  /** Height range of a clump, in metres. */
  height: [0.42, 0.78],
  /** How far a blade leans from vertical at its tip, as a share of its length. */
  bend: 0.55,
  /** Wind sway at the tip, in metres. */
  sway: 0.09,
} as const;

/** Positions, normals, UVs, vertex colours and the wind envelope, accumulated into one buffer. */
class CoverBuffer {
  readonly color: number[] = [];
  readonly index: number[] = [];
  readonly normal: number[] = [];
  readonly position: number[] = [];
  readonly sway: number[] = [];
  readonly uv: number[] = [];

  vertex(point: Vector3, normal: Vector3, color: Vector3, weight: number): number {
    this.position.push(point.x, point.y, point.z);
    this.normal.push(normal.x, normal.y, normal.z);
    this.color.push(color.x, color.y, color.z);
    this.uv.push(0, 0);
    this.sway.push(weight);
    return this.sway.length - 1;
  }

  quad(
    corners: readonly Vector3[],
    normal: Vector3,
    colors: readonly Vector3[],
    weight: number,
  ): void {
    const base = this.sway.length;
    corners.forEach((point, i) => this.vertex(point, normal, colors[i] as Vector3, weight));
    this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(this.position), 3));
    geometry.setAttribute("normal", new BufferAttribute(new Float32Array(this.normal), 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(this.color), 3));
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array(this.uv), 2));
    geometry.setAttribute("sway", new BufferAttribute(new Float32Array(this.sway), 1));
    geometry.setIndex(this.index);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** The root and tip colours a grass blade is graded between. Dark at the root is what gives depth. */
const BLADE_ROOT = new Vector3(0.09, 0.17, 0.06);
const BLADE_TIP = new Vector3(0.42, 0.55, 0.2);

/**
 * One seeded grass clump: `GRASS.blades` tapered strips, each bent over in its own direction.
 *
 * A blade is three quads narrowing to a point, curving as it rises, with its colour graded root to
 * tip. The bend is per blade and the direction is per blade, which is the entire difference between
 * "grass" and "several identical green triangles".
 */
export function grassClump(seed: number): BufferGeometry {
  const random = createRandom(seed);
  const buffer = new CoverBuffer();
  const segments = 3;
  for (let blade = 0; blade < GRASS.blades; blade += 1) {
    const azimuth = random() * Math.PI * 2;
    const height = GRASS.height[0] + random() * (GRASS.height[1] - GRASS.height[0]);
    const bend = GRASS.bend * (0.5 + random());
    // Blades lean outward from the clump's own centre, so the clump is round, not a flat fan.
    const outward = new Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
    const width = 0.022 + random() * 0.016;
    const side = new Vector3(-Math.sin(azimuth), 0, Math.cos(azimuth));
    // The blade's spine at `at`: rising, and leaning over further the higher it goes.
    const spine = (at: number) =>
      new Vector3(
        outward.x * height * bend * at * at,
        height * at,
        outward.z * height * bend * at * at,
      );
    for (let i = 0; i < segments; i += 1) {
      const at0 = i / segments;
      const at1 = (i + 1) / segments;
      const half0 = (width * (1 - at0 * 0.92)) / 2;
      const half1 = (width * (1 - at1 * 0.92)) / 2;
      const a = spine(at0).addScaledVector(side, -half0);
      const b = spine(at0).addScaledVector(side, half0);
      const c = spine(at1).addScaledVector(side, half1);
      const d = spine(at1).addScaledVector(side, -half1);
      // Face the blade's own normal outward and slightly up, so a clump lit from one side shades
      // like a mass of blades rather than like a fan of paper.
      const normal = outward
        .clone()
        .multiplyScalar(0.55)
        .add(new Vector3(0, 1, 0).multiplyScalar(0.45))
        .normalize();
      buffer.quad(
        [a, b, c, d],
        normal,
        [
          BLADE_ROOT.clone().lerp(BLADE_TIP, at0),
          BLADE_ROOT.clone().lerp(BLADE_TIP, at0),
          BLADE_ROOT.clone().lerp(BLADE_TIP, at1),
          BLADE_ROOT.clone().lerp(BLADE_TIP, at1),
        ],
        at0 * at0,
      );
    }
  }
  return buffer.build();
}

/** How a poppy cluster reads, in metres. */
export const POPPY = {
  /** Stems per cluster. A patch is a colony, not a bouquet. */
  stems: 5,
  /** Stem height range. */
  height: [0.34, 0.56],
  /** Radius of the red disc on top of a stem. */
  disc: 0.075,
} as const;

/**
 * One seeded poppy cluster, as two buffers.
 *
 * Stems and petals are separate because they are separate materials — the petals are alpha-cutout
 * cards sampling the atlas, the stems are opaque graded geometry — and one buffer can only carry one
 * material's worth of channels. It costs one extra draw call for a patch of red in a meadow.
 *
 * Each head carries two crossed petal quads rather than one flat billboard: a poppy seen edge-on is
 * a line, and a meadow full of red lines is not a meadow of poppies.
 */
export function poppyCluster(
  seed: number,
  petal: { u0: number; u1: number; v0: number; v1: number },
): { petals: BufferGeometry; stems: BufferGeometry } {
  const random = createRandom(seed);
  const stems = new CoverBuffer();
  const heads = new CoverBuffer();
  const stemGreen = new Vector3(0.16, 0.26, 0.1);
  const stemLight = new Vector3(0.34, 0.44, 0.18);
  const white = new Vector3(1, 1, 1);
  const segments = 3;
  for (let s = 0; s < POPPY.stems; s += 1) {
    const azimuth = random() * Math.PI * 2;
    const away = 0.02 + random() * 0.11;
    const height = POPPY.height[0] + random() * (POPPY.height[1] - POPPY.height[0]);
    const root = new Vector3(Math.cos(azimuth) * away * 0.4, 0, Math.sin(azimuth) * away * 0.4);
    // The head leans out over the stem, further for the taller stems.
    const lean = new Vector3(Math.cos(azimuth), 0, Math.sin(azimuth)).multiplyScalar(height * 0.22);
    const spine = (at: number) =>
      root
        .clone()
        .addScaledVector(lean, at * at)
        .add(new Vector3(0, height * at, 0));
    const halfWidth = (at: number) => 0.006 * (1 - at * 0.5);
    for (let i = 0; i < segments; i += 1) {
      const at0 = i / segments;
      const at1 = (i + 1) / segments;
      const a = spine(at0).add(new Vector3(-halfWidth(at0), 0, 0));
      const b = spine(at0).add(new Vector3(halfWidth(at0), 0, 0));
      const c = spine(at1).add(new Vector3(halfWidth(at1), 0, 0));
      const d = spine(at1).add(new Vector3(-halfWidth(at1), 0, 0));
      stems.quad(
        [a, b, c, d],
        new Vector3(0, 0, 1),
        [
          stemGreen.clone().lerp(stemLight, at0),
          stemGreen.clone().lerp(stemLight, at0),
          stemGreen.clone().lerp(stemLight, at1),
          stemGreen.clone().lerp(stemLight, at1),
        ],
        at0 * at0 * 0.8,
      );
    }
    // Two crossed petal quads, one rotated a quarter turn from the other.
    const head = spine(1);
    for (const twist of [random() * Math.PI, random() * Math.PI]) {
      const right = new Vector3(Math.cos(twist), 0, Math.sin(twist));
      const up = new Vector3(-Math.sin(twist), 0, Math.cos(twist));
      const centre = head.clone().add(new Vector3(0, POPPY.disc * 0.35, 0));
      const radius = POPPY.disc;
      heads.quad(
        [
          centre.clone().addScaledVector(right, -radius),
          centre.clone().addScaledVector(right, radius),
          centre
            .clone()
            .addScaledVector(right, radius)
            .addScaledVector(up, radius * 1.15),
          centre
            .clone()
            .addScaledVector(right, -radius)
            .addScaledVector(up, radius * 1.15),
        ],
        new Vector3(0, 1, 0),
        [white, white, white, white],
        0.8,
      );
    }
  }
  const petals = heads.build();
  // The petal cell is the atlas's fourth quadrant; CoverBuffer's quad() carries no texture channel,
  // so the UVs are written here. Inside a quad the long edge runs -r -> +r in U and the short one
  // 0 -> +up in V, which is the order the corners above are pushed in.
  const uv = petals.getAttribute("uv") as BufferAttribute;
  for (let i = 0; i < uv.count; i += 1) {
    const along = i % 4 === 1 || i % 4 === 2 ? 1 : 0;
    uv.setXY(i, petal.u0 + (petal.u1 - petal.u0) * along, petal.v0);
  }
  uv.needsUpdate = true;
  return { petals, stems: stems.build() };
}
