import { BoxGeometry, Color, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PlaneGeometry, type Camera, type Scene } from "three";
import { DisposalScope } from "../clearwaterLifetime.js";

/** Real opaque receivers: their colour/depth is what the water refracts, not a baked demo texture. */
export function setupClearwaterDemo(scene: Scene, camera: Camera): () => void {
  const scope = new DisposalScope();
  const previousBackground = scene.background;
  scene.background = new Color(0x9bbacc);
  scope.defer(() => { scene.background = previousBackground; });
  camera.position.set(5, 4, 7);
  camera.lookAt(0, -0.5, 0);
  const sunlight = new DirectionalLight(0xffe4c0, 3);
  sunlight.position.set(4.5, 8.2, 3);
  const sky = new HemisphereLight(0xcfe4f5, 0x696050, 1.4);
  scene.add(sunlight, sky);
  scope.defer(() => { sunlight.removeFromParent(); sunlight.dispose(); sky.removeFromParent(); sky.dispose(); });
  const sand = new MeshStandardMaterial({ color: 0x958671, roughness: 0.95 });
  const stone = new MeshStandardMaterial({ color: 0x494d50, roughness: 0.65 });
  scope.defer(() => { sand.dispose(); stone.dispose(); });
  const bed = new PlaneGeometry(24, 24);
  bed.rotateX(-Math.PI / 2);
  const floor = new Mesh(bed, sand);
  floor.position.y = -2;
  scene.add(floor);
  scope.defer(() => { floor.removeFromParent(); bed.dispose(); });
  for (const [x, height, z] of [[-2, 3.2, -1], [2, 0.9, 2], [-3, 1.3, 3]] as const) {
    const geometry = new BoxGeometry(0.8, height, 0.8);
    const rock = new Mesh(geometry, stone);
    rock.position.set(x, -2 + height / 2, z);
    rock.rotation.y = x * 0.21;
    scene.add(rock);
    scope.defer(() => { rock.removeFromParent(); geometry.dispose(); });
  }
  return () => scope.dispose();
}
