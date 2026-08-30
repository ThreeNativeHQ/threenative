import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  PlaneGeometry,
  RingGeometry,
  type Scene,
} from "three";
import { mix, sin, uv, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

export function createFlagMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ side: DoubleSide, toneMapped: false });
  const bands = sin(uv().x.mul(37.699)).mul(0.5).add(0.5);
  material.colorNode = mix(vec3(0.02, 0.25, 0.38), vec3(0.97, 0.58, 0.12), bands);
  return material;
}

export function createFlagGeometry(): PlaneGeometry {
  const geometry = new PlaneGeometry(3, 2, 20, 14);
  geometry.translate(1.5, 1, 0);
  return geometry;
}

function surface(color: number): MeshBasicNodeMaterial {
  return new MeshBasicNodeMaterial({ color, toneMapped: false });
}

export function createFlagStage(scene: Scene): Group {
  scene.background = new Color(0x07101b);
  const stage = new Group();

  const pole = new Mesh(new CylinderGeometry(0.055, 0.075, 3.2, 16), surface(0xb9d3dd));
  pole.position.set(-1.05, 0.45, 0);
  stage.add(pole);

  const base = new Mesh(new BoxGeometry(5.8, 0.12, 3.4), surface(0x10293a));
  base.position.set(1.1, -1.2, -0.15);
  stage.add(base);

  const target = new Mesh(new RingGeometry(0.28, 0.36, 32), surface(0x63f5c8));
  target.position.set(2.45, -0.85, 0.35);
  target.rotation.x = -Math.PI / 2;
  stage.add(target);

  return stage;
}

export function createClothWall(): Mesh<BoxGeometry, MeshBasicNodeMaterial> {
  const material = surface(0x29485c);
  material.wireframe = true;
  const wall = new Mesh(new BoxGeometry(4.4, 3.2, 0.2), material);
  wall.position.set(0.5, 0.2, 0.45);
  return wall;
}
