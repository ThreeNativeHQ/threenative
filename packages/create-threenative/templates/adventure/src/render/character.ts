// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The hero and the keeper, drawn from primitives. Built for the reference picture: a child's
// proportions (a head a fifth of the height, short legs), a long pointed green cap whose tail hangs
// down the back and swings when the hero turns, a shield strapped over the shoulders, a satchel and
// brown boots. Each articulated part is merged to one draw per material once, then posed by
// rotating its group — about sixteen draw calls for the whole figure.
import {
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  type Material,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { palette } from "./palette.js";
import type { IRenderTools } from "./tools.js";

/** What the animation reads from the rules: a subset of `IPlayer`, so this file imports no rules. */
export interface IPose {
  angle: number;
  attack: number;
  blocking: boolean;
  dead: number;
  invuln: number;
  roll: number;
  speed: number;
  walk: number;
}

export type CharacterRole = "hero" | "keeper";

export interface ICharacter {
  readonly arms: readonly [Group, Group];
  readonly body: Group;
  readonly group: Group;
  readonly head: Group;
  readonly legs: readonly [Group, Group];
  /** Blade in the right hand; visible only while the sword is drawn. */
  readonly sword: Group;
  readonly dispose: () => void;
  /** Poses the figure for one frame. `time` is scene seconds, `dt` the step. */
  readonly update: (pose: IPose, time: number, dt: number) => void;
  /** Turns the head toward a world heading, for the keeper's glance. */
  readonly lookToward: (heading: number, dt: number) => void;
}

const damp = (a: number, b: number, rate: number, dt: number): number => a + (b - a) * (1 - Math.exp(-rate * dt));

export function createCharacter(tools: IRenderTools, role: CharacterRole = "hero"): ICharacter {
  const keeper = role === "keeper";
  const materials: Material[] = [];
  const geometries: BufferGeometry[] = [];
  const std = (color: number, roughness = 0.82, metalness = 0, emissive = 0): MeshStandardMaterial => {
    const material = new MeshStandardMaterial({ color, emissive, metalness, roughness });
    materials.push(material);
    return material;
  };
  const m = {
    boot: std(keeper ? 0x4d3a28 : 0x7a5230),
    cuff: std(0x9a7548),
    eye: std(0x2c68b0, 0.3),
    gold: std(0xcaa64c, 0.4, 0.5),
    hair: std(keeper ? 0x6c4326 : 0xd9b457),
    iris: std(0x0e1d2e, 0.3),
    leather: std(0x5a3f28),
    pupil: std(0x0a0a0a, 0.2),
    red: std(0xa9382c, 0.6),
    skin: std(0xe6b78e, 0.7),
    steel: std(0xcfdadd, 0.28, 0.75),
    tunic: std(keeper ? 0x557a4b : palette.tunic),
    tunicDark: std(keeper ? 0x3e5d38 : 0x2f6029),
    white: std(0xeeead6),
    wood: std(0x81603a, 0.9),
  };
  const glowMaterial = std(0xf3dc9e, 0.4, 0, 0xe0b04d);
  glowMaterial.emissiveIntensity = 1.4;

  const mesh = (geometry: BufferGeometry, material: Material, parent: Group, x = 0, y = 0, z = 0): Mesh => {
    geometries.push(geometry);
    const item = new Mesh(geometry, material);
    item.position.set(x, y, z);
    parent.add(item);
    return item;
  };
  const ball = (parent: Group, material: Material, x: number, y: number, z: number, sx: number, sy = sx, sz = sx): Mesh => {
    const item = mesh(new SphereGeometry(1, 18, 12), material, parent, x, y, z);
    item.scale.set(sx, sy, sz);
    return item;
  };
  const from = new Vector3();
  const to = new Vector3();
  const up = new Vector3(0, 1, 0);
  /** A tapered rod from `a` to `b`. */
  const rod = (parent: Group, material: Material, a: readonly number[], b: readonly number[], r1: number, r2 = r1, sides = 10): Mesh => {
    from.set(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);
    to.set(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0);
    const direction = to.clone().sub(from);
    const item = mesh(new CylinderGeometry(r2, r1, direction.length(), sides), material, parent);
    item.position.copy(from).add(to).multiplyScalar(0.5);
    item.quaternion.setFromUnitVectors(up, direction.normalize());
    return item;
  };
  /** Builds one rigid part into a scratch group, bakes it to a mesh per material, and returns the result. */
  const bake = (label: string, fill: (scratch: Group) => void): Mesh[] => {
    const scratch = new Group();
    fill(scratch);
    const baked = tools.merge(scratch, `${role}-${label}`);
    for (const item of baked) {
      item.castShadow = true;
      item.receiveShadow = true;
    }
    return baked;
  };
  const attach = (parent: Group, parts: readonly Mesh[]): void => {
    for (const part of parts) parent.add(part);
  };

  const root = new Group();
  const body = new Group();
  root.add(body);

  // --- torso, tunic, belt, satchel, straps: one rigid piece --------------------------------------
  attach(
    body,
    bake("torso", (g) => {
      mesh(new CylinderGeometry(0.16, 0.19, 0.34, 20), m.tunic, g, 0, 0.73, 0);
      const skirt = mesh(new CylinderGeometry(0.19, 0.3, 0.27, 24, 2, true), m.tunic, g, 0, 0.53, 0);
      const pos = skirt.geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i += 1)
        if (pos.getY(i) < -0.05) pos.setY(i, pos.getY(i) + Math.cos(Math.atan2(pos.getZ(i), pos.getX(i)) * 7) * 0.024);
      skirt.geometry.computeVertexNormals();
      mesh(new CylinderGeometry(0.2, 0.3, 0.02, 24, 1, true), m.tunicDark, g, 0, 0.405, 0);
      mesh(new CylinderGeometry(0.197, 0.2, 0.07, 24), m.leather, g, 0, 0.635, 0);
      mesh(new BoxGeometry(0.1, 0.085, 0.03), m.gold, g, 0, 0.635, 0.2);
      mesh(new BoxGeometry(0.05, 0.05, 0.035), m.leather, g, 0, 0.635, 0.21);
      mesh(new CylinderGeometry(0.055, 0.07, 0.1, 12), m.skin, g, 0, 0.93, 0);
      if (!keeper) {
        rod(g, m.leather, [-0.16, 0.9, 0.1], [0.15, 0.6, 0.17], 0.024, 0.024, 8);
        ball(g, m.leather, 0.23, 0.52, -0.05, 0.1, 0.12, 0.09);
        mesh(new CylinderGeometry(0.1, 0.11, 0.05, 12), m.leather, g, 0.23, 0.6, -0.05);
      } else {
        // The keeper's sash and a leaf-green collar.
        rod(g, m.tunicDark, [-0.17, 0.86, 0.1], [0.16, 0.66, 0.17], 0.03, 0.03, 8);
        mesh(new TorusGeometry(0.11, 0.028, 8, 20), m.tunicDark, g, 0, 0.9, 0).rotation.x = Math.PI / 2;
      }
    }),
  );

  // --- legs: white tights, boots with a cuff -------------------------------------------------------
  const legs: Group[] = [];
  for (const side of [-1, 1]) {
    const leg = new Group();
    leg.position.set(side * 0.085, 0.5, 0);
    body.add(leg);
    attach(
      leg,
      bake("leg", (g) => {
        mesh(new CapsuleGeometry(0.06, 0.13, 4, 10), m.white, g, 0, -0.1, 0);
        mesh(new CylinderGeometry(0.086, 0.074, 0.2, 14), m.boot, g, 0, -0.39, 0);
        mesh(new CylinderGeometry(0.097, 0.09, 0.045, 14), m.cuff, g, 0, -0.29, 0);
        ball(g, m.boot, 0, -0.475, 0.048, 0.088, 0.06, 0.135);
        mesh(new BoxGeometry(0.15, 0.02, 0.27), m.leather, g, 0, -0.505, 0.03);
      }),
    );
    legs.push(leg);
  }

  // --- arms: green sleeve, white forearm, hand -----------------------------------------------------
  const arms: Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new Group();
    arm.position.set(side * 0.2, 0.86, 0);
    arm.rotation.z = side * 0.1;
    body.add(arm);
    attach(
      arm,
      bake("arm", (g) => {
        mesh(new CapsuleGeometry(0.062, 0.06, 4, 10), m.tunic, g, 0, -0.05, 0);
        mesh(new CapsuleGeometry(0.044, 0.15, 4, 10), keeper ? m.skin : m.white, g, 0, -0.2, 0.005);
        mesh(new CylinderGeometry(0.05, 0.046, 0.05, 10), m.leather, g, 0, -0.28, 0.005);
        ball(g, m.skin, 0, -0.34, 0.01, 0.048, 0.06, 0.045);
      }),
    );
    arms.push(arm);
  }
  const rightArm = arms[0] as Group;
  const leftArm = arms[1] as Group;

  // --- head ------------------------------------------------------------------------------------------
  const head = new Group();
  head.position.set(0, 1.13, 0);
  body.add(head);
  attach(
    head,
    bake("head", (g) => {
      ball(g, m.skin, 0, 0, 0, 0.235, 0.245, 0.225);
      for (const side of [-1, 1]) {
        const ear = mesh(new ConeGeometry(0.05, 0.22, 8), m.skin, g, side * 0.235, 0.025, 0);
        ear.rotation.z = -side * 1.2;
        ball(g, m.white, side * 0.083, -0.012, 0.185, 0.05, 0.056, 0.02);
        ball(g, m.eye, side * 0.085, -0.014, 0.197, 0.036, 0.048, 0.014);
        ball(g, m.iris, side * 0.086, -0.014, 0.205, 0.02, 0.03, 0.01);
        ball(g, m.white, side * 0.079, 0.002, 0.212, 0.008);
        rod(g, m.hair, [side * 0.04, 0.075, 0.196], [side * 0.125, 0.07, 0.185], 0.009, 0.007, 6);
      }
      ball(g, m.skin, 0, -0.065, 0.216, 0.03, 0.028, 0.032);
      rod(g, m.leather, [-0.04, -0.12, 0.196], [0.04, -0.12, 0.2], 0.006, 0.005, 6);
      // Hair: the nape under the cap, side locks, and a few bangs where the cap lifts off the brow.
      ball(g, m.hair, 0, -0.005, -0.055, 0.245, 0.235, 0.215);
      for (const side of [-1, 1]) ball(g, m.hair, side * 0.205, -0.03, 0.01, 0.048, 0.15, 0.13);
      for (let i = 0; i < 5; i += 1) {
        const a = -0.55 + i * 0.275;
        ball(g, m.hair, Math.sin(a) * 0.19, 0.13 - Math.abs(a) * 0.05, 0.16 + Math.cos(a) * 0.03, 0.06, 0.075, 0.05);
      }
      if (keeper) {
        // A leaf-green headband and a long ponytail.
        mesh(new TorusGeometry(0.235, 0.024, 8, 32), m.tunicDark, g, 0, 0.08, 0).rotation.x = Math.PI / 2 - 0.15;
        rod(g, m.hair, [0, 0.02, -0.2], [0, -0.42, -0.28], 0.075, 0.03, 10);
        ball(g, m.tunicDark, 0, -0.02, -0.21, 0.05);
      }
    }),
  );

  // --- the cap and its tail (hero) -------------------------------------------------------------------
  const tail: Group[] = [];
  if (!keeper) {
    const dome = new Group();
    head.add(dome);
    attach(
      dome,
      bake("cap", (g) => {
        // Tilted back: the brow shows at the front and the cap sits low on the nape.
        const frame = new Group();
        frame.position.set(0, 0.055, -0.015);
        frame.rotation.x = -0.32;
        g.add(frame);
        const cap = mesh(new SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.6), m.tunic, frame);
        cap.scale.set(0.27, 0.27, 0.275);
        // The dome's rim: 0.6π of a unit sphere ends at y = cos(0.6π), radius sin(0.6π).
        const rim = mesh(new TorusGeometry(0.2568, 0.022, 8, 40), m.tunicDark, frame, 0, Math.cos(Math.PI * 0.6) * 0.27, 0);
        rim.rotation.x = Math.PI / 2;
      }),
    );
    // Five hinged segments, each bending a little further toward the floor than the last.
    let parent: Group = head;
    const lengths = [0.19, 0.18, 0.17, 0.16, 0.14];
    const radii = [0.135, 0.11, 0.088, 0.066, 0.045, 0.03];
    for (let i = 0; i < lengths.length; i += 1) {
      const segment = new Group();
      if (i === 0) {
        segment.position.set(0, 0.19, -0.19);
        segment.rotation.x = 1.0;
      } else {
        segment.position.set(0, -(lengths[i - 1] as number), 0);
        segment.rotation.x = -0.2;
      }
      parent.add(segment);
      attach(
        segment,
        bake(`tail${i}`, (g) => {
          mesh(new CylinderGeometry(radii[i + 1] as number, radii[i] as number, lengths[i] as number, 14), m.tunic, g, 0, -(lengths[i] as number) / 2, 0);
          ball(g, m.tunic, 0, 0, 0, radii[i] as number);
          if (i === lengths.length - 1) ball(g, m.white, 0, -(lengths[i] as number) - 0.02, 0, 0.05);
        }),
      );
      tail.push(segment);
      parent = segment;
    }
  }

  // --- the shield on the back, held out when blocking ---------------------------------------------------
  const shield = (): Group => {
    const group = new Group();
    const outline = new Shape();
    outline.moveTo(-0.24, 0.24);
    outline.quadraticCurveTo(0, 0.34, 0.24, 0.24);
    outline.lineTo(0.22, -0.08);
    outline.quadraticCurveTo(0.1, -0.3, 0, -0.36);
    outline.quadraticCurveTo(-0.1, -0.3, -0.22, -0.08);
    outline.closePath();
    const extrude = (shape: Shape, depth: number, material: Material, z: number, bevel = 0.012): void => {
      const geometry = new ExtrudeGeometry(shape, { bevelEnabled: true, bevelSegments: 2, bevelSize: bevel, bevelThickness: bevel * 0.8, curveSegments: 10, depth, steps: 1 });
      const item = mesh(geometry, material, group, 0, 0, z);
      item.castShadow = true;
    };
    extrude(outline, 0.05, m.wood, 0, 0.02);
    const diamond = new Shape();
    diamond.moveTo(0, 0.2);
    diamond.lineTo(0.13, 0.02);
    diamond.lineTo(0, -0.24);
    diamond.lineTo(-0.13, 0.02);
    diamond.closePath();
    extrude(diamond, 0.02, m.red, 0.062, 0.006);
    mesh(new BoxGeometry(0.045, 0.4, 0.02), m.white, group, 0, -0.02, 0.09);
    mesh(new BoxGeometry(0.24, 0.04, 0.02), m.white, group, 0, 0.03, 0.09);
    return group;
  };
  const backShield = new Group();
  const backShieldMesh = shield();
  backShield.add(backShieldMesh);
  backShield.position.set(0, 0.74, -0.2);
  backShield.rotation.set(0, Math.PI, -0.08);
  backShield.scale.setScalar(0.95);
  const heldShield = shield();
  heldShield.position.set(0.02, -0.2, 0.16);
  heldShield.rotation.y = -0.15;
  heldShield.scale.setScalar(0.9);
  heldShield.visible = false;

  // --- the sword: in the hand while drawn, sheathed across the back otherwise ----------------------------
  const sword = new Group();
  sword.position.set(0, -0.34, 0.02);
  const sheath = new Group();
  if (!keeper) {
    body.add(backShield);
    leftArm.add(heldShield);
    rightArm.add(sword);
    body.add(sheath);
    const buildSword = (target: Group, blade: number): void => {
      mesh(new CylinderGeometry(0.021, 0.021, 0.14, 8), m.leather, target, 0, 0.02, 0);
      ball(target, m.gold, 0, 0.1, 0, 0.03);
      mesh(new BoxGeometry(0.2, 0.034, 0.045), m.gold, target, 0, -0.06, 0);
      const outline = new Shape();
      outline.moveTo(-0.032, -0.08);
      outline.lineTo(0.032, -0.08);
      outline.lineTo(0.028, -blade);
      outline.lineTo(0, -blade - 0.11);
      outline.lineTo(-0.028, -blade);
      outline.closePath();
      const geometry = new ExtrudeGeometry(outline, { bevelEnabled: true, bevelSegments: 1, bevelSize: 0.006, bevelThickness: 0.006, depth: 0.016, steps: 1 });
      mesh(geometry, m.steel, target, 0, 0, -0.008);
    };
    attach(sword, bake("sword", (g) => buildSword(g, 0.5)));
    // Hilt above the left shoulder, scabbard running down across the shield.
    sheath.position.set(0.05, 0.6, -0.27);
    sheath.rotation.set(0, 0, -0.62);
    attach(
      sheath,
      bake("sheath", (g) => {
        mesh(new CylinderGeometry(0.02, 0.02, 0.14, 8), m.leather, g, 0, 0.62, 0);
        ball(g, m.gold, 0, 0.71, 0, 0.028);
        mesh(new BoxGeometry(0.19, 0.032, 0.04), m.gold, g, 0, 0.54, 0);
        rod(g, m.wood, [0, 0.52, 0], [0, -0.12, 0], 0.036, 0.028, 8);
        mesh(new CylinderGeometry(0.038, 0.038, 0.03, 8), m.gold, g, 0, 0.5, 0);
      }),
    );
  } else {
    // The keeper's staff, its orb lit.
    attach(
      rightArm,
      bake("staff", (g) => {
        rod(g, m.leather, [0.02, -1.0, 0.1], [0.02, 0.5, 0.1], 0.03, 0.024, 8);
        const orb = ball(g, glowMaterial, 0.02, 0.6, 0.1, 0.075);
        orb.scale.set(0.075, 0.095, 0.075);
      }),
    );
    rightArm.rotation.x = -0.3;
  }

  let drawn = 0;
  let tailLag = 0;
  let lastAngle = 0;
  let lean = 0;

  const update: ICharacter["update"] = (p, time, dt) => {
    if (keeper) {
      body.position.y = Math.sin(time * 1.9) * 0.012;
      return;
    }
    // Dead: fall on the side, and stop breathing.
    if (p.dead > 0) {
      body.rotation.z = damp(body.rotation.z, -1.4, 5, dt);
      body.position.y = damp(body.position.y, -0.32, 5, dt);
      return;
    }
    body.rotation.z = damp(body.rotation.z, 0, 8, dt);
    const moving = p.speed > 0.2 && p.roll === 0;
    const sprint = MathUtils.clamp((p.speed - 3.65) / 2.2, 0, 1);
    // The sword stays drawn for two seconds after the last swing.
    drawn = p.attack > 0 ? 2 : Math.max(0, drawn - dt);
    sword.visible = drawn > 0;
    sheath.visible = drawn <= 0;
    backShield.visible = !p.blocking;
    heldShield.visible = p.blocking;
    // Body: breathe, bob with the stride, lean into a run, tumble in a roll.
    lean = damp(lean, moving ? 0.1 + sprint * 0.18 : 0, 8, dt);
    if (p.roll > 0) {
      const q = 1 - p.roll / 0.58;
      // Tumble about the belly, not the boots: displace the body so its centre stays put.
      const angle = q * Math.PI * 2;
      body.rotation.x = angle;
      body.position.set(0, 0.62 * (1 - Math.cos(angle)) - Math.sin(q * Math.PI) * 0.16, -0.62 * Math.sin(angle));
    } else {
      body.rotation.x = damp(body.rotation.x % (Math.PI * 2), lean, 18, dt);
      body.position.set(0, moving ? Math.abs(Math.sin(p.walk)) * 0.035 : Math.sin(time * 2) * 0.008, 0);
    }
    // Stride.
    const swing = moving ? Math.sin(p.walk) * (0.62 + sprint * 0.25) : 0;
    (legs[0] as Group).rotation.x = damp((legs[0] as Group).rotation.x, swing, 26, dt);
    (legs[1] as Group).rotation.x = damp((legs[1] as Group).rotation.x, -swing, 26, dt);
    rightArm.rotation.set(-swing * 0.72 - 0.11, 0, -0.1);
    leftArm.rotation.set(swing * 0.72 - 0.11, 0, 0.1);
    body.rotation.y = 0;
    if (p.blocking) leftArm.rotation.set(-1.1, -0.35, 0.22);
    if (p.attack > 0) {
      const q = 1 - p.attack / 0.46;
      rightArm.rotation.set(-1.35 - Math.sin(q * Math.PI) * 0.4, -1.0 + q * 2.5, 0.2);
      body.rotation.y = (q - 0.4) * 0.5;
    }
    head.rotation.y = Math.sin(time * 0.8) * 0.045;
    // Cap tail: it hangs, drags behind a turn, streams back when running, and never stops breathing.
    const turn = MathUtils.clamp(-Math.atan2(Math.sin(p.angle - lastAngle), Math.cos(p.angle - lastAngle)) / Math.max(dt, 1e-3), -8, 8);
    lastAngle = p.angle;
    tailLag = damp(tailLag, turn * 0.05, 7, dt);
    tail.forEach((segment, i) => {
      const k = i + 1;
      const base = i === 0 ? 1.0 - lean * 0.2 + sprint * 0.35 : -0.2 + sprint * 0.1;
      segment.rotation.x = base + Math.sin(time * 2.2 - k * 0.7) * 0.03 * (1 + p.speed * 0.2);
      segment.rotation.z = tailLag * k * 0.35 + Math.sin(time * 1.7 - k * 0.9) * 0.025;
    });
  };

  const lookToward: ICharacter["lookToward"] = (heading, dt) => {
    const relative = Math.atan2(Math.sin(heading - root.rotation.y), Math.cos(heading - root.rotation.y));
    head.rotation.y = damp(head.rotation.y, MathUtils.clamp(relative, -0.8, 0.8), 4, dt);
  };

  return {
    arms: [rightArm, leftArm],
    body,
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
    group: root,
    head,
    legs: [legs[0] as Group, legs[1] as Group],
    lookToward,
    sword,
    update,
  };
}
