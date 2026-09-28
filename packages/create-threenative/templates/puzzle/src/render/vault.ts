// The room. Ordinary Three.js — ThreeNative does not read this file, and nothing here imports a
// framework package, which is what keeps `src/render/` portable.
//
// It returns the geometry *and* a plain list of the boxes that should be solid. The scene turns
// those into physics bodies; this file never touches physics, so the look can be rebuilt without
// disturbing what the warden can walk into.
import {
  BoxGeometry,
  Color,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PointLight,
} from "three";
import { floorMaterial, structureMaterial, worldGridUVs } from "./materials.js";
import { palette } from "./palette.js";
import { block } from "./shapes.js";

/** Interior half-extents. The warden and every crate live inside this box. */
export const VAULT = {
  halfX: 5.5,
  halfZ: 3.8,
  wallHeight: 1.9,
  wallThickness: 0.6,
} as const;

/** The way out: a seal set into the floor at the far corner. */
// Pushed into the corner and away from the pile. A seal within a metre of the crate field is
// tripped by the opening drop itself: a crate toppling off the stack slid to (1.91, -1.45) and
// won the run before the warden moved.
export const SEAL = { half: 1.35, x: 4.0, z: -2.4 } as const;

/** An axis-aligned solid box, in world space, for the scene to hand to the physics backend. */
export interface ISolidBox {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface IVaultRoom {
  readonly object: Group;
  readonly solids: readonly ISolidBox[];
  /** The seal's own group, so the scene can pulse it and a scenario can ask if it is on screen. */
  readonly seal: Object3D;
  readonly setSealLit: (lit: boolean) => void;
}

/**
 * A box already in world space, with the one-metre grid projected onto it.
 *
 * `worldGridUVs` reads world coordinates, so it has to run *after* the translate — that is what
 * makes a grid line one metre long on a 12 m floor and on a 0.26 m kerb alike. The geometry is a
 * clone because `roundedBox` caches by size and every wall here shares a size.
 */
function gridBlock(
  width: number,
  height: number,
  depth: number,
  material: Material,
  position: readonly [number, number, number],
  radius: number,
): Mesh {
  const geometry = worldGridUVs(block(width, height, depth, material, { radius }).geometry.clone());
  geometry.translate(...position);
  worldGridUVs(geometry);
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createVaultRoom(): IVaultRoom {
  const root = new Group();
  root.name = "vault-room";
  const solids: ISolidBox[] = [];

  const outerX = VAULT.halfX + VAULT.wallThickness;
  const outerZ = VAULT.halfZ + VAULT.wallThickness;

  // --- floor -----------------------------------------------------------------------------
  const floor = gridBlock(outerX * 2, 0.6, outerZ * 2, floorMaterial, [0, -0.3, 0], 0.05);
  floor.castShadow = false;
  root.add(floor);
  solids.push({ depth: outerZ * 2, height: 0.6, width: outerX * 2, x: 0, y: -0.3, z: 0 });

  // --- walls -----------------------------------------------------------------------------
  // Four sides, each built from a plinth, a band above it, and a capping rail. The plinth is what
  // the crates actually touch; the rail overhangs both so the wall reads as built rather than as a
  // slab someone extruded.
  const wallSpans: readonly {
    readonly length: number;
    readonly axis: "x" | "z";
    readonly sign: 1 | -1;
  }[] = [
    { axis: "z", length: outerX * 2, sign: -1 },
    { axis: "z", length: outerX * 2, sign: 1 },
    { axis: "x", length: outerZ * 2, sign: -1 },
    { axis: "x", length: outerZ * 2, sign: 1 },
  ];
  for (const span of wallSpans) {
    const alongX = span.axis === "z";
    const centre = alongX
      ? { x: 0, z: span.sign * (VAULT.halfZ + VAULT.wallThickness / 2) }
      : { x: span.sign * (VAULT.halfX + VAULT.wallThickness / 2), z: 0 };
    const size = (width: number, depth: number) => (alongX ? [width, depth] : [depth, width]);

    const [plinthW, plinthD] = size(span.length, VAULT.wallThickness);
    root.add(
      gridBlock(
        plinthW as number,
        0.46,
        plinthD as number,
        structureMaterial,
        [centre.x, 0.23, centre.z],
        0.06,
      ),
    );

    const [bandW, bandD] = size(span.length, VAULT.wallThickness * 0.86);
    root.add(
      gridBlock(
        bandW as number,
        1.14,
        bandD as number,
        structureMaterial,
        [centre.x, 1.03, centre.z],
        0.05,
      ),
    );

    const [railW, railD] = size(span.length, VAULT.wallThickness * 1.16);
    root.add(
      gridBlock(
        railW as number,
        0.34,
        railD as number,
        structureMaterial,
        [centre.x, 1.77, centre.z],
        0.07,
      ),
    );

    solids.push({
      depth: alongX ? VAULT.wallThickness : outerZ * 2,
      height: VAULT.wallHeight * 2,
      width: alongX ? outerX * 2 : VAULT.wallThickness,
      x: centre.x,
      y: VAULT.wallHeight,
      z: centre.z,
    });
  }

  // --- pillars ---------------------------------------------------------------------------
  // Corners and mid-spans, and nothing else. They break the wall run into bays, which is the one
  // thing a wall this long needs; the diamond insets the painterly room wore on each face are
  // gone, because a face turned 45 degrees projects the metre grid into a diamond and the room
  // reads as a texture error rather than as carpentry.
  const pillarSpots: readonly { readonly x: number; readonly z: number }[] = [
    { x: -outerX + 0.42, z: -outerZ + 0.42 },
    { x: outerX - 0.42, z: -outerZ + 0.42 },
    { x: -outerX + 0.42, z: outerZ - 0.42 },
    { x: outerX - 0.42, z: outerZ - 0.42 },
    { x: -2.6, z: -outerZ + 0.3 },
    { x: 1.6, z: -outerZ + 0.3 },
    { x: -outerX + 0.3, z: 0.6 },
    { x: outerX - 0.3, z: 0.9 },
  ];
  for (const spot of pillarSpots)
    root.add(gridBlock(0.9, 2.24, 0.9, structureMaterial, [spot.x, 1.12, spot.z], 0.09));

  // --- the seal --------------------------------------------------------------------------
  const seal = new Group();
  seal.name = "vault-seal";
  seal.position.set(SEAL.x, 0, SEAL.z);
  const rimSpan = SEAL.half * 2 + 0.26;
  for (const [dx, dz] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ] as const) {
    const alongX = dz !== 0;
    const kerb = gridBlock(
      alongX ? rimSpan : 0.26,
      0.15,
      alongX ? 0.26 : rimSpan,
      structureMaterial,
      [dx * (SEAL.half + 0.13), 0.075, dz * (SEAL.half + 0.13)],
      0.05,
    );
    seal.add(kerb);
  }
  // Concentric squares, drawn as FRAMES with dark floor showing between them. Three filled
  // nested plates read as one soft gradient; four thin bars per ring read as an inlay, and the
  // gaps are what make the rings legible at all.
  const glowMaterials: MeshBasicMaterial[] = [];
  const plate = new Mesh(
    new BoxGeometry(SEAL.half * 2, 0.02, SEAL.half * 2),
    new MeshBasicMaterial({ color: new Color(palette.accent).multiplyScalar(0.2) }),
  );
  plate.position.y = 0.012;
  seal.add(plate);
  const rings: readonly {
    readonly bar: number;
    readonly brightness: number;
    readonly span: number;
  }[] = [
    { bar: 0.11, brightness: 0.4, span: SEAL.half * 1.82 },
    { bar: 0.1, brightness: 0.58, span: SEAL.half * 1.24 },
    { bar: 0.09, brightness: 0.76, span: SEAL.half * 0.68 },
  ];
  rings.forEach((ring, index) => {
    const material = new MeshBasicMaterial({
      color: new Color(palette.accent).multiplyScalar(ring.brightness),
    });
    glowMaterials.push(material);
    for (const [dx, dz] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ] as const) {
      const alongX = dz !== 0;
      const bar = new Mesh(
        new BoxGeometry(alongX ? ring.span : ring.bar, 0.02, alongX ? ring.bar : ring.span),
        material,
      );
      bar.position.set(
        (dx * (ring.span - ring.bar)) / 2,
        0.024 + index * 0.004,
        (dz * (ring.span - ring.bar)) / 2,
      );
      seal.add(bar);
    }
  });
  // The core the rings surround: the brightest thing in the room, and the only part that lights.
  const coreMaterial = new MeshBasicMaterial({
    color: new Color(palette.accent).multiplyScalar(0.95),
  });
  glowMaterials.push(coreMaterial);
  const core = new Mesh(new BoxGeometry(SEAL.half * 0.42, 0.02, SEAL.half * 0.42), coreMaterial);
  core.position.y = 0.04;
  seal.add(core);
  // The one light in the room that is not the sun. The seal is the destination, and a run's
  // destination should be findable from the far corner without moving the sun for it.
  const sealLight = new PointLight(palette.accent, 9, 13, 1.6);
  sealLight.position.set(0, 1.3, 0);
  seal.add(sealLight);
  root.add(seal);

  const baseBrightness = [...rings.map((ring) => ring.brightness), 1.05];
  const setSealLit = (lit: boolean): void => {
    const scale = lit ? 1.9 : 1;
    glowMaterials.forEach((material, index) => {
      material.color
        .copy(new Color(palette.accent))
        .multiplyScalar((baseBrightness[index] ?? 1) * scale);
    });
    sealLight.intensity = lit ? 22 : 9;
  };

  return { object: root, seal, setSealLit, solids };
}
