import { createMetaHuman } from "./metahuman.js";
import type { ILoadMetaHumanOptions, IMetaHuman } from "./metahuman.js";
import { RigEvaluator } from "./wasm-evaluator.js";

/**
 * Keeps a caller-supplied asset path inside the asset directory.
 * @situation reject a MetaHuman asset path that would read outside the game's asset root
 * @constraint absolute paths, Windows drive letters, backslashes and any `..` segment throw MetaHumanAssetError with TN_MH_PATH_ESCAPE before the path is joined onto a root
 * @requires npm i @threenative/metahuman
 * @example assertAssetPath("metahuman/specimen.glb");
 */
export { assertAssetPath } from "./asset-contract.js";
/**
 * Checks one prepared specimen — bindings sidecar, DNA and GLB — against the rig it claims to
 * drive, and returns the bindings only when every name, index, domain and hash holds up.
 * @situation refuse a MetaHuman specimen whose bindings point at joints, nodes, blend shape
 *   channels, morph targets or LODs the loaded files do not contain
 * @constraint fails closed: a missing key, a wrong type, a hash that differs from the bytes on
 *   disk and an index past the end of its array are rejections, each with a stable code
 * @constraint reads the rig's real names and the GLB's real node, mesh and target counts, so it
 *   cannot pass a hand-written sidecar the rig cannot drive
 * @requires npm i @threenative/metahuman
 * @example const bindings = validateMetaHumanAssets({ bindings: parsed, dnaSha256, glbSha256, rig, gltf });
 */
export { validateMetaHumanAssets, METAHUMAN_BINDINGS_SCHEMA_VERSION } from "./asset-contract.js";
export type {
  IMetaHumanAnimatedMapBinding,
  IMetaHumanAssetInput,
  IMetaHumanBindings,
  IMetaHumanControlBinding,
  IMetaHumanGltfFacts,
  IMetaHumanGltfMesh,
  IMetaHumanGltfNode,
  IMetaHumanGltfPrimitive,
  IMetaHumanJointBinding,
  IMetaHumanLodBinding,
  IMetaHumanMorphBinding,
  IMetaHumanRigFacts,
} from "./asset-contract.js";
/**
 * The rejection every check in this package raises, carrying a stable machine-readable code.
 * @situation branch on why a MetaHuman asset or evaluator call was refused
 * @constraint `code` is part of the public surface; renaming one is a breaking change
 * @requires npm i @threenative/metahuman
 * @example if (error instanceof MetaHumanAssetError && error.code === "TN_MH_HASH_MISMATCH") refetch();
 */
export { MetaHumanAssetError } from "./errors.js";
export type { MetaHumanErrorCode } from "./errors.js";
/**
 * One MetaHuman head rig over the checksum-verified browser WASM build of the shared OpenRigLogic
 * ABI: faceboard GUI controls in, joint deltas, blend shape weights and animated map weights out.
 * @situation drive a prepared MetaHuman head's expression from the browser without an Unreal import
 * @constraint the binary's SHA-256 is checked against the shipped manifest before it is
 *   instantiated, and nothing is fetched from a CDN
 * @constraint every returned array is a copy, so no view survives a memory growth; a disposed
 *   evaluator throws instead of reading freed memory
 * @requires npm i @threenative/metahuman
 * @example const rig = await RigEvaluator.create(dna); rig.setGuiControls(gui); rig.evaluate(true); rig.jointOutputs();
 */
export { RigEvaluator, JOINT_STRIDE } from "./wasm-evaluator.js";
export type {
  IRigEvaluator,
  IRigEvaluatorCounts,
  RigEvaluatorErrorCode,
  RigEvaluatorKind,
} from "./wasm-evaluator.js";
/**
 * Load a prepared MetaHuman head and drive its expression from the browser's WASM evaluator:
 * declared faceboard controls in, joint deltas and morph weights out, applied to an ordinary
 * Three.js object graph.
 * @situation put a MetaHuman head in a browser game without an Unreal import or a baked clip
 * @constraint the model is loaded through the game's own asset loader and cloned per instance, so
 *   two characters never write each other's face and nothing is disposed that `ctx.assets` still owns
 * @constraint the rig's own GUI-to-raw mapping runs; the adapter never re-derives it, and a LOD
 *   switch re-evaluates the current controls before the replacement mesh is shown
 * @constraint an undeclared control, an out-of-domain value, an undeclared LOD and any call after
 *   `dispose()` throw, each with a stable `code`; nothing is clamped or coerced
 * @requires npm i @threenative/metahuman
 * @example const human = await loadMetaHuman({ assets: ctx.assets, model: "metahuman/head.glb",
 *   dna: "metahuman/head.dna", bindings: "metahuman/bindings.json" });
 *   human.setControls({ jawOpen: 0.4 });
 * @example // in the scene update, after any body animation
 *   human.update();
 */
export const loadMetaHuman = (options: ILoadMetaHumanOptions): Promise<IMetaHuman> =>
  createMetaHuman(
    {
      name: "wasm",
      create: (dna) => RigEvaluator.create(dna),
      openRigLogic: () => RigEvaluator.upstreamCommit(),
    },
    options,
  );
export type {
  ILoadMetaHumanOptions,
  IMetaHuman,
  IMetaHumanAssets,
  IMetaHumanBackend,
  IMetaHumanControl,
  IMetaHumanDiagnostics,
  IMetaHumanModel,
} from "./metahuman.js";
