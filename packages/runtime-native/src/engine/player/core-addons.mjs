// three/addons/tsl/display's GTAO, Denoise, SMAA and Bloom as the engine's live effects, shared with
// the Wasm back end (three-native/src/addons/post-effects.ts). Each returns the effect's node; its
// scalar uniforms read and write the native effect (`ao(...).radius.value`).
import { definePostEffects } from "../../../../three-native/src/addons/post-effects.ts";

export const { ao, denoise, smaa, bloom } = definePostEffects(globalThis.tsl);
