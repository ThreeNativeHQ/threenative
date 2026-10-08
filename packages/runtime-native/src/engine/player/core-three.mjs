// Identity-preserving imports over the V8 adapter, never upstream Three.js.
import { audio } from "./core-audio.mjs";
export const {
  AmbientLight, AnimationAction, AnimationClip, AnimationMixer, Bone, Box3, BoxGeometry,
  BufferAttribute, BufferGeometry, Camera, CatmullRomCurve3, CircleGeometry, Color, ConeGeometry, CylinderGeometry,
  DirectionalLight, Euler, Float32BufferAttribute, Fog, FogExp2, Frustum, Group,
  HemisphereLight, InstancedBufferAttribute, InstancedMesh, LatheGeometry, LOD, Layers, Matrix3, Matrix4, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, NumberKeyframeTrack, Object3D, OrthographicCamera, Path, PerspectiveCamera, Plane, PlaneGeometry,
  QuaternionKeyframeTrack, VectorKeyframeTrack, Shape, ShapeGeometry, ExtrudeGeometry,
  PointLight, Quaternion, Ray, Raycaster, RingGeometry, RoundedBoxGeometry, Scene, Skeleton, SkinnedMesh, Sphere,
  SphereGeometry, SpotLight, Sprite, SpriteMaterial, TorusGeometry, TubeGeometry, Vector2, Vector3,
  Vector4, ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping, PCFSoftShadowMap,
  NoColorSpace, LinearSRGBColorSpace, SRGBColorSpace, RepeatWrapping, ClampToEdgeWrapping,
  NearestFilter, LinearFilter, LinearMipmapLinearFilter, UnsignedByteType, FloatType, RGBAFormat,
  EquirectangularReflectionMapping, NoToneMapping, LoopOnce, LoopRepeat, LoopPingPong, AttachedBindMode, FrontSide, BackSide, DoubleSide, StaticDrawUsage, DynamicDrawUsage,
  NoBlending, NormalBlending, AdditiveBlending, PCFShadowMap, PropertyBinding, getConsoleFunction, setConsoleFunction,
} = globalThis;
// Texture sources (typed array, canvas, ImageBitmap) the engine copies; see core-textures.mjs.
import { DataTexture, Texture } from "./core-textures.mjs";
export { CanvasTexture, DataTexture, DataUtils, HalfFloatType, ImageBitmapLoader, Texture, TextureLoader } from "./core-textures.mjs";

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
export const { AudioContext, AudioListener, Audio, PositionalAudio, AudioLoader } = audio;

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
const geometries = [BoxGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, PlaneGeometry,
  RingGeometry, RoundedBoxGeometry, SphereGeometry, TorusGeometry, LatheGeometry, TubeGeometry, ShapeGeometry,
  ExtrudeGeometry];
// three's `geometry.attributes` map over the native named attributes: one live view per geometry,
// reading through getAttribute and writing through setAttribute/deleteAttribute.
// ponytail: names are three's standard ones plus those set from JS; a custom-named attribute only a
// native loader added is readable by name but not enumerated. Add a native name list if one appears.
const STANDARD_ATTRIBUTES = ["position", "normal", "uv", "uv1", "uv2", "uv3", "color", "tangent",
  "skinIndex", "skinWeight"];
const authoredNames = new WeakMap();
const attributeViews = new WeakMap();
for (const geometry of [BufferGeometry, ...geometries]) {
  const { setAttribute, deleteAttribute } = geometry.prototype;
  geometry.prototype.setAttribute = function(name, attribute) {
    if (!authoredNames.has(this)) authoredNames.set(this, new Set());
    authoredNames.get(this).add(String(name));
    return setAttribute.call(this, name, attribute);
  };
  geometry.prototype.deleteAttribute = function(name) {
    authoredNames.get(this)?.delete(String(name));
    return deleteAttribute.call(this, name);
  };
  // The registry answers `groups` as canonical JSON text (the fixtures' protocol); three's is an array
  // of { start, count, materialIndex } in that key order.
  // ponytail: a fresh array per read, so edit groups with addGroup/clearGroups, as three advises.
  const groups = Object.getOwnPropertyDescriptor(geometry.prototype, "groups");
  Object.defineProperty(geometry.prototype, "groups", { get() {
    return JSON.parse(groups.get.call(this)).map(({ start, count, materialIndex }) => ({ start, count, materialIndex }));
  } });
}
Object.defineProperty(BufferGeometry.prototype, "attributes", { get() {
  if (attributeViews.has(this)) return attributeViews.get(this);
  const names = () => [...new Set([...STANDARD_ATTRIBUTES, ...(authoredNames.get(this) ?? [])])]
    .filter((name) => this.hasAttribute(name));
  const view = new Proxy({}, {
    get: (_, name) => typeof name === "string" && this.hasAttribute(name) ? this.getAttribute(name) : undefined,
    has: (_, name) => typeof name === "string" && this.hasAttribute(name),
    set: (_, name, attribute) => { this.setAttribute(name, attribute); return true; },
    deleteProperty: (_, name) => { this.deleteAttribute(name); return true; },
    ownKeys: () => names(),
    getOwnPropertyDescriptor: (_, name) => typeof name === "string" && this.hasAttribute(name)
      ? { value: this.getAttribute(name), writable: true, enumerable: true, configurable: true } : undefined,
  });
  attributeViews.set(this, view);
  return view;
} });
// Adapt wrapper inheritance only; native classes continue to own every scene operation.
for (const [base, names] of [
  [Object3D, [Scene, Mesh, Group, Camera, Bone, LOD, Sprite, AmbientLight, DirectionalLight,
    HemisphereLight, PointLight, SpotLight]],
  [Camera, [PerspectiveCamera, OrthographicCamera]],
  [Mesh, [SkinnedMesh, InstancedMesh]],
  [BufferGeometry, geometries],
  [BufferAttribute, [Float32BufferAttribute, InstancedBufferAttribute]],
  [Texture, [DataTexture]],
  [Path, [Shape]],
]) {
  for (const derived of names) Object.setPrototypeOf(derived.prototype, base.prototype);
}
// The type flags three defines on its value classes (`isColor`, `isVector3`, ...).
for (const value of [Color, Vector2, Vector3, Vector4, Quaternion, Euler, Matrix3, Matrix4, Box3, Plane,
  Texture, DataTexture, BufferGeometry, BufferAttribute, InstancedBufferAttribute])
  value.prototype[`is${value.name}`] = true;
CatmullRomCurve3.prototype.isCatmullRomCurve3 = true;
// three's `shape.holes` is the plain array a game pushes paths into: each change writes the whole
// array through the native setter, so the geometry built from the shape sees it.
const holeViews = new WeakMap();
const holes = Object.getOwnPropertyDescriptor(Shape.prototype, "holes");
Object.defineProperty(Shape.prototype, "holes", {
  get() {
    if (!holeViews.has(this)) {
      const shape = this;
      holeViews.set(this, new Proxy(holes.get.call(this), { set(target, key, value) {
        target[key] = value;
        holes.set.call(shape, [...target]);
        return true;
      } }));
    }
    return holeViews.get(this);
  },
  set(value) {
    holes.set.call(this, [...value]);
    holeViews.delete(this);
  },
});
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
