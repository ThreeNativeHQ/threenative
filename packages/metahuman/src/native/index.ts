import { createMetaHuman } from "../metahuman.js";
import type { ILoadMetaHumanOptions, IMetaHuman } from "../metahuman.js";
import { nativeMetaHumanHost } from "./host.js";
import { NativeRigEvaluator } from "./native-evaluator.js";

/**
 * The native entry, selected by the `threenative-native` export condition.
 *
 * It deliberately does not import the WASM module, the loader, or the evaluator's
 * implementation: a host without the MetaHuman C++ binding must fail with an actionable error,
 * never silently instantiate the browser build. The evaluator's *types* are re-exported because
 * a type import is erased at build time and a native game declares the same rig interface.
 */
export {
  METAHUMAN_BINDINGS_SCHEMA_VERSION,
  assertAssetPath,
  validateMetaHumanAssets,
} from "../asset-contract.js";
export type {
  IMetaHumanAssetInput,
  IMetaHumanBindings,
  IMetaHumanGltfFacts,
  IMetaHumanRigFacts,
} from "../asset-contract.js";
export { MetaHumanAssetError } from "../errors.js";
export type { MetaHumanErrorCode } from "../errors.js";
export type { IRigEvaluator, IRigEvaluatorCounts, RigEvaluatorKind } from "../wasm-evaluator.js";
/**
 * The installed native resident, or a rejection naming the missing capability.
 * @situation check that a native runtime was built with the MetaHuman ABI before loading a specimen
 * @constraint throws `TN_NATIVE_METAHUMAN_MISSING`; it never falls back to the WASM module,
 *   which the native bundle does not carry
 * @requires npm i @threenative/metahuman
 * @example nativeMetaHumanHost().version;
 */
export { nativeMetaHumanHost } from "./host.js";
export type { INativeMetaHumanHost } from "./host.js";
/**
 * One MetaHuman head rig over the C++ OpenRigLogic build the native host compiled: the same
 * `IRigEvaluator` contract, the same error codes and the same copied outputs as the browser
 * `RigEvaluator`, over a synchronous crossing instead of the WASM heap.
 * @situation drive a prepared MetaHuman head's expression in a native runtime
 * @constraint every returned array is a copy; a disposed evaluator throws instead of reading
 *   freed rig state
 * @requires npm i @threenative/metahuman
 * @example const rig = NativeRigEvaluator.create(dna); rig.setGuiControls(gui); rig.evaluate(true);
 */
export { NativeRigEvaluator } from "./native-evaluator.js";

/**
 * Load a prepared MetaHuman head and drive its expression from the native C++ evaluator: the same
 * handle, the same controls, the same error codes as the browser entry, over the resident the
 * runtime installed.
 * @situation put a MetaHuman head in a Linux native game
 * @constraint never falls back to the WASM module, which this bundle does not carry; a runtime
 *   built without `TN_ENABLE_METAHUMAN` fails with `TN_NATIVE_METAHUMAN_MISSING`
 * @constraint the model is loaded through the game's own asset loader and cloned per instance, so
 *   two characters never write each other's face and nothing is disposed that `ctx.assets` still owns
 * @requires npm i @threenative/metahuman
 * @example const human = await loadMetaHuman({ assets: ctx.assets, model: "metahuman/head.glb",
 *   dna: "metahuman/head.dna", bindings: "metahuman/bindings.json" });
 *   human.setControls({ jawOpen: 0.4 });
 */
export const loadMetaHuman = (options: ILoadMetaHumanOptions): Promise<IMetaHuman> =>
  createMetaHuman(
    {
      name: "native",
      create: (dna) => NativeRigEvaluator.create(dna),
      openRigLogic: () => nativeMetaHumanHost().version,
    },
    options,
  );
export type {
  ILoadMetaHumanOptions,
  IMetaHuman,
  IMetaHumanAssets,
  IMetaHumanControl,
  IMetaHumanDiagnostics,
  IMetaHumanModel,
} from "../metahuman.js";
