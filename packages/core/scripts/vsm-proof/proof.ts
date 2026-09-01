import { DirectionalLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SphereGeometry, AmbientLight } from "three";
import { WebGPURenderer, PCFSoftShadowMap } from "three/webgpu";
import { shadow as shadowNodeOf } from "three/tsl";
import { Object3D } from "three";
import { VirtualShadowNode } from "../../src/render/virtual-shadow.js";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "virtual";
const clip = params.get("clip");
const renderer = new WebGPURenderer({ antialias: false });
renderer.setSize(512, 512);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);
await renderer.init();

const scene = new Scene();
const camera = new PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 4, 7);
camera.lookAt(0, 0, 0);
scene.add(camera);
scene.add(new AmbientLight(0xffffff, 0.15));
const sun = new DirectionalLight(0xffffff, 1.2);
sun.position.set(4, 10, 2);
sun.target.position.set(0, 0, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
sun.shadow.camera.left = -10;
sun.shadow.camera.right = 10;
sun.shadow.camera.top = 10;
sun.shadow.camera.bottom = -10;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 40;
scene.add(sun);
scene.add(sun.target);
let node: VirtualShadowNode | undefined;
if (mode === "lw" || mode === "real") {
  // Isolation arms: three's own shadow node over a placeholder Object3D (as CSM does) or over
  // a real zero-intensity DirectionalLight, positioned like the sun.
  const holder = mode === "lw" ? Object.assign(new Object3D(), { target: new Object3D(), castShadow: true }) : new DirectionalLight(0xffffff, 0);
  const lShadow = sun.shadow.clone();
  (holder as unknown as { shadow: unknown }).shadow = lShadow;
  holder.position.copy(sun.position);
  scene.add(holder);
  scene.add((holder as unknown as { target: Object3D }).target);
  (holder as unknown as { castShadow: boolean }).castShadow = true;
  (sun.shadow as unknown as { shadowNode: unknown }).shadowNode = shadowNodeOf(holder as unknown as DirectionalLight, lShadow);
}
if (mode === "virtual") {
  const near = params.get("near") === "1";
  node = new VirtualShadowNode(sun, {
    clipExtents: clip === null ? [6, 18, 54] : clip.split(",").map(Number),
    mapSize: 1024,
    marker: 5,
    ...(near ? { depthRange: 30, lightDistance: 12 } : {}),
  });
  const counts: Record<string, number> = { inner: 0, innerRender: 0, outer: 0 };
  (window as unknown as { __COUNTS__: Record<string, number> }).__COUNTS__ = counts;
  const outerUpdate = node.updateBefore.bind(node);
  node.updateBefore = (frame) => { counts.outer += 1; return outerUpdate(frame); };
  (window as unknown as { __WRAP__: () => void }).__WRAP__ = () => {
    for (const inner of node?.levelNodes ?? []) {
      const target = inner as unknown as { updateBefore: (f: unknown) => unknown; renderShadow: (f: unknown) => unknown; _wrapped?: boolean };
      if (target._wrapped) continue;
      target._wrapped = true;
      const u = target.updateBefore.bind(target);
      target.updateBefore = (f) => {
        counts.inner += 1;
        return u(f);
      };
      const r = target.renderShadow.bind(target);
      target.renderShadow = (f) => { counts.innerRender += 1; return r(f); };
    }
  };
  (sun.shadow as unknown as { shadowNode: unknown }).shadowNode = node;
  if (params.get("auto") === "1") {
    for (const light of node.levelLights) (light as unknown as { shadow: { autoUpdate: boolean } }).shadow.autoUpdate = true;
  }
}
const ground = new Mesh(new PlaneGeometry(40, 40), new MeshStandardMaterial({ color: 0x9a9a9a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const ball = new Mesh(new SphereGeometry(1, 32, 16), new MeshStandardMaterial({ color: 0xff8040 }));
ball.position.set(0, 1.5, 0);
ball.castShadow = true;
scene.add(ball);

const adapter = await navigator.gpu?.requestAdapter();
const info = adapter?.info as { vendor?: string; architecture?: string } | undefined;
// One real animation frame per render: three advances its node frame counter from its own
// animation loop, and a shadow requested in a frame already answered is skipped.
const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
for (let frame = 0; frame < 12; frame += 1) { await renderer.renderAsync(scene, camera); (window as unknown as { __WRAP__?: () => void }).__WRAP__?.(); await nextFrame(); }
(window as unknown as { __PROOF__: unknown }).__PROOF__ = {
  adapter: `${info?.vendor ?? "?"} | ${info?.architecture ?? "?"}`,
  mode,
  stats: node?.stats ?? null,
  levels: node?.levelLights.map((light) => {
    const level = light as unknown as { shadow: { map: unknown; needsUpdate: boolean; matrix: { elements: number[] }; camera: { left: number; far: number } }; target: { position: { toArray(): number[] } } };
    return {
      mapAssigned: level.shadow.map !== null && level.shadow.map !== undefined,
      needsUpdate: level.shadow.needsUpdate,
      position: light.position.toArray().map((v) => Math.round(v * 10) / 10),
      target: level.target.position.toArray().map((v) => Math.round(v * 10) / 10),
      left: level.shadow.camera.left,
      far: level.shadow.camera.far,
      matrix: level.shadow.matrix.elements.slice(0, 4).map((v) => Math.round(v * 1000) / 1000),
    };
  }) ?? null,
  stockMap: mode === "stock" ? sun.shadow.map !== null : undefined,
  counts: (window as unknown as { __COUNTS__?: unknown }).__COUNTS__,
};
