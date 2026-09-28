/**
 * The native entry, selected by the `threenative-native` export condition.
 *
 * It deliberately does not import the WASM module, the loader, or the evaluator: a host
 * without the MetaHuman C++ binding must fail with an actionable error, never silently
 * instantiate the browser build. The binding itself lands in Phase 2.
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
export type { IRigEvaluator } from "../wasm-evaluator.js";

/** Fail closed until the Linux host installs the MetaHuman ABI. */
export function nativeRigEvaluator(): never {
  throw new Error("TN_NATIVE_METAHUMAN_MISSING: runtime did not install the metahuman ABI");
}
