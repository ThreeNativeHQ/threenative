/** Emscripten `-sMODULARIZE -sEXPORT_ES6` factory; `wasm-evaluator.ts` types the module it returns. */
declare const createRigLogicModule: (options: { wasmBinary: Uint8Array }) => Promise<unknown>;
export default createRigLogicModule;
