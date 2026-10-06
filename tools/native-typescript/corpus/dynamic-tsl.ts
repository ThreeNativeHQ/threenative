import { BoxGeometry, Mesh, Scene } from "three";
import { float, sin, uv, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial, OrthographicCamera, WebGPURenderer } from "three/webgpu";

// Read AFTER startup: the same compiled binary must specialize a different graph for each count.
const layers = Number(process.env.TN_TSL_LAYERS ?? "3");
if (!Number.isInteger(layers) || layers < 1 || layers > 8) throw "invalid TN_TSL_LAYERS";
let red = float(0.45);
for (let i = 1; i <= layers; i++) {
  red = red.add(sin(uv().x.mul(float(i * 5))).mul(float(0.05)));
}
const material = new MeshBasicNodeMaterial();
material.colorNode = vec3(red, float(0.3), float(0.65));
const scene = new Scene();
scene.add(new Mesh(new BoxGeometry(2, 2, 0.1), material));
const camera = new OrthographicCamera(-1.5, 1.5, 1.125, -1.125, 0.1, 10);
camera.position.z = 3;
console.log("dynamic graph ready");
export async function render(): Promise<void> {
  const renderer = new WebGPURenderer();
  renderer.setSize(320, 240);
  await renderer.init();
  renderer.render(scene, camera);
}
if (process.env.TN_TSL_FRAME)
  render().catch((error) => {
    throw error;
  });
