/**
 * Parses a UEFormat v10 `.uemodel` body — the interchange format CUE4Parse and FModel export
 * from Unreal packages — into validated, plain mesh data without building any Three.js objects.
 * @situation parse a mesh exported from an Unreal package without Unreal installed
 * @situation inspect the LODs, skeleton, sockets, and collision inside a .uemodel file
 * @constraint only UEFormat v10 UEMODEL files are accepted; anything else throws UEFormatError with the byte offset
 * @constraint ZSTD-compressed bodies require an injected `zstdDecoder`; the package never bundles a ZSTD implementation
 * @example const model = parseUEModel(await file.arrayBuffer());
 */
export { parseUEModel } from "./parser.js";
/**
 * Builds a renderable Three.js object — a `Group` for single-LOD models, a `THREE.LOD` for
 * multi-LOD ones — from parsed `.uemodel` data, with collision geometry on `userData`.
 * @situation put a mesh exported from an Unreal package on screen
 * @situation load an Unreal static or skeletal mesh with LODs, sockets, and collision geometry
 * @constraint every material comes from the game through `materialFactory`; the fallback is three.js's own GLTFLoader default, a plain MeshStandardMaterial
 * @constraint parsed bones are exposed on `userData` but never bound into a THREE.SkinnedMesh — skeletal rendering is the game's job
 * @example const hero = createThreeObject(parseUEModel(buffer), { lodDistances: [0, 25, 50] });
 */
export { createThreeObject } from "./three-adapter.js";
/**
 * Converts one parsed Unreal mesh LOD into a `THREE.BufferGeometry` — coordinates, scale,
 * winding, normals, tangents, UVs, vertex colours, morphs, skin weights, and material groups.
 * @situation convert one Unreal mesh LOD into a three.js BufferGeometry by hand
 * @situation build custom scene objects from Unreal mesh data instead of a whole model
 * @constraint rejects indices, channels, or material sections that disagree with the vertex count before any geometry is constructed
 * @example const geometry = createThreeGeometry(model.lods[0]);
 */
export { createThreeGeometry } from "./three-adapter.js";
/**
 * Loads a `.uemodel` file as a Three.js loader — `load(url)` for the browser, `parse(data)` for
 * bytes you already hold — with the parser and three-adapter options passed straight through.
 * @situation load a .uemodel asset in the browser with the standard three.js loader protocol
 * @situation hand a game's Unreal-exported meshes to the framework's asset loading
 * @constraint ZSTD-compressed bodies require an injected `zstdDecoder` in the parse options
 * @example const model = new UEFormatLoader(manager).parse(data);
 */
export { UEFormatLoader, type IUEFormatLoaderOptions } from "./loader.js";
/**
 * Summarizes a parsed `.uemodel` — LOD, material, skeleton, collision, and unknown-attribute
 * counts — without dumping vertex arrays, for logs, validation, and build reports.
 * @situation report what a UEFormat model contains without dumping its vertex data
 * @situation validate a .uemodel file before building geometry from it
 * @constraint the summary reflects one already-parsed model; it does not read files itself
 * @example const summary = summarizeUEModel(parseUEModel(buffer));
 */
export { summarizeUEModel, type IUEModelSummary } from "./summary.js";
/**
 * The error thrown for every malformed, truncated, or unsupported `.uemodel` input, carrying a
 * stable `code` and the byte offset where validation stopped.
 * @situation tell why a .uemodel file failed to load
 * @situation report a malformed Unreal export with its byte offset instead of a generic error
 * @constraint every parse and geometry failure surfaces as this error; nothing malformed is silently skipped
 * @example catch (error) { if (error instanceof UEFormatError) log(error.code, error.offset); }
 */
export { UEFormatError, type UEFormatErrorCode } from "./errors.js";
export type {
  IQuaternion,
  IUEFormatCompression,
  IUEFormatHeader,
  IUEModelBone,
  IUEModelCollision,
  IUEModelData,
  IUEModelLOD,
  IUEModelMaterial,
  IUEModelMorphDelta,
  IUEModelMorphTarget,
  IUEModelNormal,
  IUEModelSkeleton,
  IUEModelSocket,
  IUEModelTexCoord,
  IUEModelVertexColor,
  IUEModelVirtualBone,
  IUEModelWeight,
  IVector2,
  IVector3,
  IParseUEModelOptions,
  ZstdDecoder,
} from "./types.js";
export type {
  IThreeAdapterOptions,
  UECoordinateSystem,
  UEFormatThreeObject,
  WindingRepair,
} from "./three-adapter.js";
