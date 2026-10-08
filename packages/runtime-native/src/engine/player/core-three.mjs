// Identity-preserving imports over the V8 adapter, never upstream Three.js.
export const {
  AmbientLight, AnimationAction, AnimationClip, AnimationMixer, Bone, Box3, BoxGeometry,
  BufferAttribute, BufferGeometry, Camera, CircleGeometry, Color, ConeGeometry, CylinderGeometry,
  DataTexture, DirectionalLight, Euler, Float32BufferAttribute, Fog, FogExp2, Frustum, Group,
  HemisphereLight, InstancedBufferAttribute, InstancedMesh, LOD, Layers, Matrix3, Matrix4, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, Object3D, OrthographicCamera, PerspectiveCamera, Plane, PlaneGeometry,
  PointLight, Quaternion, Ray, Raycaster, RingGeometry, RoundedBoxGeometry, Scene, Skeleton, SkinnedMesh, Sphere,
  SphereGeometry, SpotLight, Sprite, SpriteMaterial, Texture, TorusGeometry, Vector2, Vector3,
  Vector4, ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping, PCFSoftShadowMap,
  NoColorSpace, LinearSRGBColorSpace, SRGBColorSpace, RepeatWrapping, ClampToEdgeWrapping,
  NearestFilter, LinearFilter, LinearMipmapLinearFilter, UnsignedByteType, FloatType, RGBAFormat,
  EquirectangularReflectionMapping, NoToneMapping, LoopOnce, LoopRepeat, LoopPingPong, AttachedBindMode, PropertyBinding, getConsoleFunction, setConsoleFunction,
} = globalThis;

export const clone = globalThis.__tnCloneSkeleton;

// The binding registry represents the stateless namespace as a native object.
export const MathUtils = new globalThis.MathUtils();

export function unsupported() {
  throw new Error("TN_CORE_NATIVE_UNSUPPORTED: this native profile does not provide this import");
}

export const BatchedMesh = unsupported;
export const InstancedBufferGeometry = unsupported;
export const Line = unsupported;
export const LineLoop = unsupported;
export const LineSegments = unsupported;
export const Points = unsupported;
export const WebGLRenderer = unsupported;
export const TextureLoader = unsupported;
export const AudioLoader = unsupported;

// Native traversal and child enumeration are host callbacks, not a second JS scene graph.
const bags = new WeakMap();
for (const name of ["Object3D", "Scene", "Mesh", "Group", "SkinnedMesh", "InstancedMesh",
  "Camera", "PerspectiveCamera", "OrthographicCamera", "DirectionalLight", "AmbientLight",
  "HemisphereLight", "PointLight", "SpotLight", "Bone", "LOD", "Sprite"]) {
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
// Adapt wrapper inheritance only; native classes continue to own every scene operation.
for (const [base, names] of [
  [Object3D, [Scene, Mesh, Group, Camera, Bone, LOD, Sprite, AmbientLight, DirectionalLight,
    HemisphereLight, PointLight, SpotLight]],
  [Camera, [PerspectiveCamera, OrthographicCamera]],
  [Mesh, [SkinnedMesh, InstancedMesh]],
  [BufferGeometry, [BoxGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, PlaneGeometry,
    RingGeometry, RoundedBoxGeometry, SphereGeometry, TorusGeometry]],
  [BufferAttribute, [Float32BufferAttribute, InstancedBufferAttribute]],
  [Texture, [DataTexture]],
]) {
  for (const derived of names) Object.setPrototypeOf(derived.prototype, base.prototype);
}
// The type flags three defines on its value classes (`isColor`, `isVector3`, ...).
for (const value of [Color, Vector2, Vector3, Vector4, Quaternion, Euler, Matrix3, Matrix4, Box3, Plane,
  Texture, DataTexture, BufferGeometry, BufferAttribute, InstancedBufferAttribute])
  value.prototype[`is${value.name}`] = true;
for (const light of [AmbientLight, DirectionalLight, HemisphereLight, PointLight, SpotLight])
  light.prototype.isLight = true;
// three's abstract Material: the base the native material classes share for `instanceof` and its
// default hooks. The engine compiles no WebGL program, so the hooks stay three's no-op defaults;
// a bare Material has no native class and refuses construction.
export class Material {
  constructor() { throw new Error("TN_NATIVE_MATERIAL_ABSTRACT: construct a concrete material class"); }
  onBeforeCompile() {}
  customProgramCacheKey() { return this.onBeforeCompile.toString(); }
}
Material.prototype.isMaterial = true;
for (const material of [MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, SpriteMaterial]) {
  Object.setPrototypeOf(material.prototype, Material.prototype);
  material.prototype[`is${material.name}`] = true;
}
