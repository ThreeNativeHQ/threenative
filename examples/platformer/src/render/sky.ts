// Yours: ordinary Three.js. ThreeNative does not read this file.
//
// The backdrop: a vertex-coloured sky dome, fog tuned to the same colour so the
// far end of the level dissolves instead of ending, and a parallax layer of
// clouds and distant islands that sells the "floating in the sky" premise the
// playfield only implies.
//
// The gradient is vertex colours on a sphere, not a texture — see the
// CanvasTexture warning in AGENTS.md. `BackSide` puts us inside it.
import {
  BackSide,
  BufferAttribute,
  Color,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Scene,
  SphereGeometry,
} from "three";
import { airship, castle, windmill } from "./landmarks.js";
import { createMaterials } from "./materials.js";
import { palette } from "./palette.js";
import { ball, block, makeRandom } from "./shapes.js";

function skyDome(): Mesh {
  const geometry = new SphereGeometry(420, 32, 20);
  const position = geometry.getAttribute("position");
  const high = new Color(palette.skyHigh);
  const low = new Color(palette.skyLow);
  const colors = new Float32Array(position.count * 3);
  const mixed = new Color();
  for (let index = 0; index < position.count; index += 1) {
    // The visible sky is a narrow band just above the horizon — the camera
    // looks *down* at the level, so a ramp measured over the whole hemisphere
    // spends all of its range off-screen and the frame ends up flat. Remap so
    // the gradient is spent between roughly -8° and +20° of elevation.
    const elevation = position.getY(index) / 420;
    const height = Math.min(1, Math.max(0, (elevation + 0.14) / 0.5));
    mixed.copy(low).lerp(high, height ** 0.7);
    colors[index * 3] = mixed.r;
    colors[index * 3 + 1] = mixed.g;
    colors[index * 3 + 2] = mixed.b;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  // fog:false is load-bearing. The dome sits past the fog's far plane, so with
  // fog on it renders as one flat wash of the fog colour and the gradient you
  // just computed is invisible.
  const mesh = new Mesh(
    geometry,
    // toneMapped:false matters as much as fog:false here. ACES compresses a
    // saturated sky straight back to the pale wash you were trying to escape,
    // and the dome is the one surface that should bypass it entirely.
    new MeshBasicMaterial({ fog: false, side: BackSide, toneMapped: false, vertexColors: true }),
  );
  mesh.frustumCulled = false;
  return mesh;
}

function cloud(random: () => number): Group {
  const group = new Group();
  const material = new MeshBasicMaterial({ color: palette.cloud, fog: false, toneMapped: false });
  const puffs = 3 + Math.floor(random() * 3);
  for (let index = 0; index < puffs; index += 1) {
    const radius = 2.4 + random() * 2.6;
    const puff = ball(radius, material, { castShadow: false, receiveShadow: false, segments: 12 });
    puff.position.set(index * 3.1 - puffs * 1.2, random() * 1.1, random() * 1.6 - 0.8);
    group.add(puff);
  }
  return group;
}

/** A far island: grass slab on a tapering rock underside, no collision, no shadows. */
function distantIsland(random: () => number): Group {
  const group = new Group();
  const materials = createMaterials();
  const width = 6 + random() * 8;
  const top = block(width, 1.1, width * 0.7, materials.grass, {
    castShadow: false,
    radius: 0.45,
    receiveShadow: false,
  });
  group.add(top);
  for (let index = 0; index < 3; index += 1) {
    const scale = 1 - (index + 1) * 0.26;
    const chunk = block(width * scale, 1.5, width * 0.7 * scale, materials.rock, {
      castShadow: false,
      radius: 0.5,
      receiveShadow: false,
    });
    chunk.position.y = -1.1 - index * 1.3;
    group.add(chunk);
  }
  for (let index = 0; index < 3; index += 1) {
    const trunk = block(0.4, 1.6, 0.4, materials.trunk, {
      castShadow: false,
      receiveShadow: false,
    });
    const crown = ball(1.2 + random() * 0.5, materials.leaf, {
      castShadow: false,
      receiveShadow: false,
      segments: 10,
    });
    const x = (random() - 0.5) * width * 0.7;
    const z = (random() - 0.5) * width * 0.45;
    trunk.position.set(x, 1.35, z);
    crown.position.set(x, 2.8, z);
    group.add(trunk, crown);
  }
  return group;
}

export interface Backdrop {
  /** Drift this with the camera; the scene owns the parallax factor. */
  readonly group: Group;
  /** Spin the windmill and sail the airship. Call once per frame. */
  readonly update: (dt: number) => void;
}

/**
 * Everything behind the playfield. A static backdrop reads as a painted wall
 * the moment the player moves, so this returns both the group to parallax and
 * the two things in it that are allowed to animate.
 */
export function setupSky(scene: Scene): Backdrop {
  scene.background = new Color(palette.skyHigh);
  scene.fog = new Fog(palette.skyLow, 90, 420);
  scene.add(skyDome());

  const parallax = new Group();
  const random = makeRandom(90210);
  for (let index = 0; index < 14; index += 1) {
    const puff = cloud(random);
    puff.position.set(
      -60 + random() * 240,
      12 + random() * 34,
      -70 - random() * 130,
    );
    const scale = 1 + random() * 1.8;
    puff.scale.setScalar(scale);
    parallax.add(puff);
  }
  for (let index = 0; index < 7; index += 1) {
    const island = distantIsland(random);
    island.position.set(-40 + index * 22 + random() * 8, 4 + random() * 22, -48 - random() * 60);
    parallax.add(island);
  }

  // The reference frame's three landmarks. They sit on their own far islands so
  // they read as *places*, not decals floating in the blue.
  const materials = createMaterials();
  const keepIsle = distantIsland(random);
  keepIsle.position.set(24, 6, -74);
  const keep = castle(materials);
  keep.position.set(24, 6.4, -74);
  const millIsle = distantIsland(random);
  millIsle.position.set(66, 14, -88);
  const mill = windmill(materials);
  mill.group.position.set(66, 14.4, -88);
  const ship = airship(materials);
  ship.position.set(-30, 40, -62);
  parallax.add(keepIsle, keep, millIsle, mill.group, ship);

  scene.add(parallax);

  let sailed = 0;
  const update = (dt: number): void => {
    mill.blades.rotation.z += dt * 0.55;
    sailed = (sailed + dt * 2.4) % 260;
    ship.position.x = -30 + sailed;
    ship.position.y = 40 + Math.sin(sailed * 0.05) * 1.6;
  };

  return { group: parallax, update };
}
