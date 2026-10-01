// The public software-adapter fact, executed on the native host, driving the `minimal` template's
// own quality policy. Bundled by packages/runtime-native/tests/native-adapter-policy.test.mjs into
// the IIFE the host loads with `mystral run`.
//
// Each earlier proof covers one link of this chain and none covers all of it: the C++ adapter.info
// contract reads `navigator.gpu.requestAdapter().info` (the provider), a browser SwiftShader run
// proves the policy answers `low` (a software rasteriser), and the desktop STUB unit feeds a
// synthetic adapter to the classifier. `createRenderer` is internal, so the public way to reach the
// fact is the one a game uses — `game.start()`, then `ctx.renderer.softwareAdapter` — and that is
// what runs here, through the same `resolveQualityTier` call `Play.ts` makes. Adapter identity is
// read separately so the classification is never the only witness to itself.
//
// Plain JS on purpose: a `.ts` entry in this package cannot import the template's policy, because
// the tsconfig pins `rootDir` to `src`. No top-level await either — the host loads an IIFE.
import { Scene, defineGame } from "@threenative/core";
import {
  qualityPreset,
  resolveQualityTier,
} from "../../../packages/create-threenative/templates/minimal/src/render/quality.js";

const IDENTITY_FIELDS = ["architecture", "description", "device", "vendor"];

/** `adapter.info` read directly, so the identity is observed beside the fact, not derived from it. */
function readIdentity() {
  const adapter = globalThis.navigator?.gpu?.requestAdapter?.();
  const info = adapter === undefined || adapter === null ? undefined : adapter.info;
  const identity = {};
  for (const field of IDENTITY_FIELDS) {
    const value = info === undefined || info === null ? undefined : info[field];
    identity[field] = typeof value === "string" ? value : "";
  }
  return identity;
}

class AdapterPolicy extends Scene {
  enter(ctx) {
    const { pipelineCensus, softwareAdapter } = ctx.renderer;
    // What `Play.ts` passes, computed the same way: the fact is present or it is not.
    const tier = resolveQualityTier({ mobile: false, software: softwareAdapter !== undefined });
    // The same policy asked about a software adapter. It is a pure function of its arguments, so
    // a hardware host can execute that branch too — this is the software half of the POLICY
    // running natively, not a software adapter detected natively, and the two are not the claim.
    const softwareTier = resolveQualityTier({ mobile: false, software: true });
    console.log(
      `TN_NATIVE_ADAPTER_POLICY:${JSON.stringify({
        adapterClass: softwareAdapter === undefined ? "hardware" : "software",
        censusIdentity: pipelineCensus?.().adapter.identity,
        identity: readIdentity(),
        kind: ctx.renderer.kind,
        policyTier: tier,
        renderChainTier: qualityPreset(tier).renderChainTier ?? null,
        softwareAdapter: softwareAdapter ?? null,
        softwarePolicy: {
          renderChainTier: qualityPreset(softwareTier).renderChainTier ?? null,
          tier: softwareTier,
        },
      })}`,
    );
    return undefined;
  }
}

const game = defineGame({
  initialState: {},
  scenes: { proof: AdapterPolicy },
  start: "proof",
});

game.start().catch((error) => {
  console.log(
    `TN_NATIVE_ADAPTER_POLICY_FAILED:${error instanceof Error ? error.message : String(error)}`,
  );
});
