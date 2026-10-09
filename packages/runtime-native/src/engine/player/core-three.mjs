// Identity-preserving imports over the V8 adapter, never upstream Three.js.
import { audio } from "./core-audio.mjs";
import { Material, defineObjectSurface } from "../../../../three-native/src/object-surface.ts";
export const {
  AmbientLight, AnimationAction, AnimationClip, AnimationMixer, Bone, Box3, BoxGeometry,
  BufferAttribute, BufferGeometry, Camera, CapsuleGeometry, CatmullRomCurve3, CircleGeometry, Color, ConeGeometry, CylinderGeometry,
  DirectionalLight, DodecahedronGeometry, Euler, Float32BufferAttribute, Fog, FogExp2, Frustum, Group,
  HemisphereLight, InstancedBufferAttribute, InstancedMesh, LatheGeometry, LOD, Layers, Matrix3, Matrix4, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial, MeshPhysicalMaterial, IcosahedronGeometry,
  MeshStandardMaterial, NumberKeyframeTrack, Object3D, OctahedronGeometry, OrthographicCamera, Path, PerspectiveCamera, Plane, PlaneGeometry,
  QuaternionKeyframeTrack, VectorKeyframeTrack, Shape, ShapeGeometry, ExtrudeGeometry,
  PointLight, Quaternion, Ray, Raycaster, RingGeometry, RoundedBoxGeometry, Scene, Skeleton, SkinnedMesh, Sphere,
  SphereGeometry, SpotLight, Sprite, SpriteMaterial, TorusGeometry, TorusKnotGeometry, TubeGeometry, Vector2, Vector3,
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
  ExtrudeGeometry, IcosahedronGeometry, CapsuleGeometry, DodecahedronGeometry, OctahedronGeometry, TorusKnotGeometry];
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
for (const light of [AmbientLight, DirectionalLight, HemisphereLight, PointLight, SpotLight])
  light.prototype.isLight = true;
// attributes/groups, shape.holes and the abstract Material: shared with the Wasm back end.
defineObjectSurface({ bufferGeometry: BufferGeometry, geometries, shape: Shape, materials: [MeshBasicMaterial, MeshLambertMaterial,
  MeshPhongMaterial, MeshPhysicalMaterial, MeshStandardMaterial, SpriteMaterial] });
export { Material };
