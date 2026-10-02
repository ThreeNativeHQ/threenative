import type { FluidParticles3D } from "@threenative/core";
import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  type Camera,
  type Scene,
} from "three";
import { vec3 } from "three/tsl";
import { Sprite, SpriteNodeMaterial } from "three/webgpu";

/** Debug look only: one lit dot per live particle, a tank outline, a dark backdrop. */
export function createPointsView(water: FluidParticles3D, scene: Scene, camera: Camera): Group {
  scene.background = new Color(0x05070e);
  camera.position.set(0, 2.4, 8.2);
  camera.lookAt(0, 1.9, 0);

  const view = new Group();
  const material = new SpriteNodeMaterial({ transparent: false, depthWrite: true });
  const particle = water.positions.toAttribute();
  const speed = water.velocities.toAttribute();
  material.positionNode = particle.xyz;
  material.scaleNode = particle.w.mul(water.spacing * 0.9);
  material.colorNode = vec3(0.25, 0.75, 1).add(speed.w.mul(0.6));
  const points = new Sprite(material);
  points.count = water.capacity;
  points.frustumCulled = false;
  view.add(points);

  const { min, max } = water.bounds;
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as const;
  const tank = new LineSegments(
    new EdgesGeometry(new BoxGeometry(...size)),
    new LineBasicMaterial({ color: 0x3a5a7a }),
  );
  tank.position.set(min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2);
  view.add(tank);
  return view;
}
