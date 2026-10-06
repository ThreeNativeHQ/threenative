// Identity-preserving imports over the V8 adapter, never upstream Three.js.
export const {
  Box3, BoxGeometry, BufferAttribute, BufferGeometry, Color, DataTexture, DirectionalLight,
  Frustum, Group, InstancedMesh, Matrix3, Matrix4, Mesh, MeshStandardMaterial, Object3D,
  OrthographicCamera, PerspectiveCamera, Plane, PlaneGeometry, Scene, SkinnedMesh, Sphere,
  Texture, Vector2, Vector3, Vector4, NoColorSpace,
} = globalThis;

export function unsupported() {
  throw new Error("TN_CORE_NATIVE_UNSUPPORTED: this demo does not provide loaders, picking, or projection materials");
}

// Core constructs pickers even in a keyboard-only game. Allocation is inert; every query refuses.
export class Raycaster {
  set = unsupported;
  setFromCamera = unsupported;
}

export const BatchedMesh = unsupported;
export const InstancedBufferGeometry = unsupported;
export const LOD = unsupported;
export const Line = unsupported;
export const LineLoop = unsupported;
export const LineSegments = unsupported;
export const Points = unsupported;
export const Sprite = unsupported;
export const WebGLRenderer = unsupported;
export const TextureLoader = unsupported;
export const AudioLoader = unsupported;
export const SRGBColorSpace = "srgb";

// Native traversal and child enumeration are host callbacks, not a second JS scene graph.
const bags = new WeakMap();
for (const name of ["Object3D", "Scene", "Mesh", "Group", "SkinnedMesh", "InstancedMesh",
  "PerspectiveCamera", "OrthographicCamera", "DirectionalLight"]) {
  const prototype = globalThis[name].prototype;
  const parent = Object.getOwnPropertyDescriptor(prototype, "parent").get;
  Object.defineProperties(prototype, {
    parent: { get() { return parent.call(this) ?? null; } },
    children: { get() { return globalThis.tn.children(this); } },
    userData: { get() {
      if (!bags.has(this)) bags.set(this, {});
      return bags.get(this);
    } },
  });
  prototype.traverse = function(callback) { globalThis.tn.traverse(this, callback, false); };
  prototype.traverseVisible = function(callback) { globalThis.tn.traverse(this, callback, true); };
  prototype[`is${name}`] = true;
}
PerspectiveCamera.prototype.isCamera = true;
OrthographicCamera.prototype.isCamera = true;
DirectionalLight.prototype.isLight = true;
