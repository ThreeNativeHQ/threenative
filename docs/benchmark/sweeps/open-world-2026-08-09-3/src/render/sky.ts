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
  Vector3,
} from "three";
import { palette } from "./palette.js";

export function setupSky(scene: Scene) {
  const radius = 650;
  const geometry = new SphereGeometry(radius, 32, 16);
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  const top = new Color(palette.skyHigh);
  const low = new Color(palette.skyLow);
  const mixed = new Color();
  for (let index = 0; index < positions.count; index += 1) {
    const t = Math.max(0, Math.min(1, (positions.getY(index) / radius) * 1.8 + 0.52));
    mixed.copy(low).lerp(top, t);
    colors.set([mixed.r, mixed.g, mixed.b], index * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  const dome = new Mesh(
    geometry,
    new MeshBasicMaterial({ side: BackSide, toneMapped: false, vertexColors: true }),
  );
  dome.frustumCulled = false;
  const clouds = new Group();
  const cloudMaterial = new MeshBasicMaterial({ color: 0xfff4dc, toneMapped: false });
  for (let index = 0; index < 18; index += 1) {
    const cloud = new Group();
    const scale = 4 + (index % 4) * 1.4;
    for (let puff = 0; puff < 5; puff += 1) {
      const mesh = new Mesh(new SphereGeometry(scale * (0.65 + (puff % 3) * 0.16), 8, 6), cloudMaterial);
      mesh.position.set((puff - 2) * scale * 0.65, Math.abs(puff - 2) * -0.55, (puff % 2) * 1.8);
      cloud.add(mesh);
    }
    cloud.position.set(-180 + index * 31, 70 + (index % 5) * 11, -190 + (index % 7) * 62);
    clouds.add(cloud);
  }
  scene.background = top;
  scene.fog = new Fog(0x91c8d8, 150, 500);
  scene.add(dome, clouds);
  return {
    follow(position: Vector3) {
      dome.position.copy(position);
      clouds.position.x = position.x * 0.82;
    },
  };
}
