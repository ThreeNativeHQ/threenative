import type { FluidField2D } from "@threenative/core";
import { type Camera, Color, Group, Mesh, PlaneGeometry, type Scene } from "three";
import { clamp, mix, uv, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

function fieldSurface(
  field: FluidField2D,
  low: readonly [number, number, number],
  high: readonly [number, number, number],
): Mesh {
  const surface = new Mesh(new PlaneGeometry(1.58, 1.58), new MeshBasicNodeMaterial());
  const nodeMaterial = surface.material as MeshBasicNodeMaterial;
  const density = clamp(field.dye.sample(uv()).x, 0, 1);
  nodeMaterial.colorNode = mix(vec3(...low), vec3(...high), density);
  nodeMaterial.opacityNode = density.mul(0.98);
  nodeMaterial.transparent = true;
  nodeMaterial.depthWrite = false;
  nodeMaterial.toneMapped = false;
  return surface;
}

/** The example owns both looks; each surface reads the same field sampler. */
export function createFluidView(field: FluidField2D, scene: Scene, camera: Camera): Group {
  scene.background = new Color(0x05070e);
  camera.position.set(0, 0, 4.2);
  camera.lookAt(0, 0, 0);

  const view = new Group();
  const backdropMaterial = new MeshBasicNodeMaterial({ toneMapped: false });
  const backdropGradient = uv().x.mul(0.35).add(uv().y.mul(0.65));
  backdropMaterial.colorNode = mix(
    vec3(0.008, 0.012, 0.03),
    vec3(0.05, 0.075, 0.14),
    backdropGradient,
  );
  const backdrop = new Mesh(new PlaneGeometry(4.2, 2.5), backdropMaterial);
  backdrop.position.z = -0.12;
  view.add(backdrop);

  const smoke = fieldSurface(field, [0.03, 0.05, 0.08], [0.78, 0.91, 1.0]);
  smoke.position.x = -0.88;
  view.add(smoke);

  const fire = fieldSurface(field, [0.12, 0.01, 0.005], [1.0, 0.45, 0.025]);
  fire.position.x = 0.88;
  view.add(fire);
  return view;
}
