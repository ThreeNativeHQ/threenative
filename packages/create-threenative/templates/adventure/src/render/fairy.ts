// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The fairy: a bright white-gold mote with four beating wings and a small light of its own, who
// drifts at the hero's left shoulder. It is a companion and a light source, so the woods around the
// hero are never quite dark. Her glow is not a sprite: a textured quad shows its edge over a dark
// floor as a pale square, so the body is simply brighter than white and the bloom stage does the
// glowing.
import { Color, DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, PointLight, SphereGeometry, Vector3 } from "three";

export interface IFairy {
  readonly dispose: () => void;
  readonly group: Group;
  /** Follows a hero standing at `(x, y, z)` whose camera has orbited to `yaw`. */
  readonly update: (time: number, dt: number, x: number, y: number, z: number, yaw: number) => void;
}

export function createFairy(): IFairy {
  const group = new Group();
  // Above 1.0 on purpose: the bloom stage only lifts what is brighter than white.
  const body = new MeshBasicMaterial({ color: new Color(3.2, 3.2, 2.8), toneMapped: false });
  const wingMaterial = new MeshBasicMaterial({ color: new Color(1.8, 1.8, 1.7), depthWrite: false, opacity: 0.8, side: DoubleSide, toneMapped: false, transparent: true });
  const geometry = new SphereGeometry(1, 14, 10);
  const core = new Mesh(geometry, body);
  core.scale.set(0.06, 0.08, 0.06);
  group.add(core);
  const wings: Mesh[] = [];
  for (const side of [-1, 1])
    for (const lower of [false, true]) {
      const wing = new Mesh(geometry, wingMaterial);
      wing.position.set(side * (lower ? 0.075 : 0.07), lower ? -0.005 : 0.09, 0);
      wing.scale.set(lower ? 0.075 : 0.055, lower ? 0.045 : 0.13, 0.016);
      wing.rotation.z = side * (lower ? 1.15 : -0.6);
      group.add(wing);
      wings.push(wing);
    }
  const light = new PointLight(0xeaffc7, 4, 7, 2);
  group.add(light);
  const goal = new Vector3();
  group.position.set(-0.5, 2, 12);
  return {
    dispose: () => {
      body.dispose();
      wingMaterial.dispose();
      geometry.dispose();
    },
    group,
    update: (time, dt, x, y, z, yaw) => {
      goal.set(
        x - Math.cos(yaw) * 0.95 + Math.sin(time * 1.8) * 0.18,
        y + 1.85 + Math.sin(time * 2.4) * 0.12,
        z + Math.sin(yaw) * 0.95 - Math.cos(yaw) * 0.25 + Math.cos(time * 1.4) * 0.12,
      );
      group.position.lerp(goal, 1 - Math.exp(-dt * 5));
      group.rotation.y = time * 0.8;
      wings.forEach((wing, i) => {
        wing.rotation.y = Math.sin(time * 38 + i) * 0.78;
      });
      light.intensity = 4 + MathUtils.clamp(Math.sin(time * 3.1), -1, 1) * 0.6;
    },
  };
}
