/**
 * Every product claim the site renders, with the artefact in this repository that makes it
 * checkable. A marketing page is the one surface here with no compiler behind it, so the claims
 * are typed data instead of prose in JSX and `__tests__/claims.spec.ts` resolves each pointer
 * against the live capability manifest or a file on disk. Inventing a claim fails `pnpm test`.
 */
export type ClaimEvidence =
  /** A symbol in `packages/create-threenative/capabilities.json`. */
  | { readonly kind: "capability"; readonly symbol: string }
  /** A repository-relative path that must exist. */
  | { readonly kind: "doc"; readonly path: string };

export interface IClaim {
  readonly id: string;
  readonly text: string;
  readonly evidence: ClaimEvidence;
}

export const claims: readonly IClaim[] = [
  {
    id: "hero-headline",
    text: "Build native 3D apps with the Three.js API",
    evidence: { kind: "capability", symbol: "defineGame" },
  },
  {
    id: "hero-subhead",
    text: "ThreeNative lets you write familiar Three.js code and ship high-performance experiences across web, desktop, and mobile — without WebView overhead.",
    evidence: { kind: "doc", path: "docs/architecture/NATIVE-RENDER-TRANSPORT.md" },
  },
  {
    id: "chip-cross-platform",
    text: "Cross-platform runtime",
    evidence: { kind: "doc", path: "packages/runtime-native/conformance/registry.json" },
  },
  {
    id: "chip-webgpu-first",
    text: "WebGPU-first",
    evidence: { kind: "capability", symbol: "GPUReadback" },
  },
  {
    id: "chip-open-source",
    text: "Open source friendly",
    evidence: { kind: "doc", path: "LICENSE" },
  },
  {
    id: "feature-native-performance",
    text: "Skip WebView overhead and push more real-time graphics.",
    evidence: { kind: "doc", path: "docs/architecture/NATIVE-RUNTIME.md" },
  },
  {
    id: "feature-threejs-api",
    text: "Keep the workflow you know instead of learning a new engine.",
    evidence: { kind: "capability", symbol: "defineGame" },
  },
  {
    id: "feature-open-extensible",
    text: "Integrate your own tools, pipelines, and native modules.",
    evidence: { kind: "capability", symbol: "compileAssets" },
  },
  {
    id: "feature-ship-everywhere",
    text: "Target web, desktop, Android, and iOS from a shared codebase.",
    evidence: { kind: "doc", path: "packages/runtime-native/conformance/registry.json" },
  },
  {
    id: "showcase-body",
    text: "The same source runs in the browser on WebGPU and on an owned C++ runtime for desktop, Android and iOS. Every platform claim on this page is a scenario something already ran.",
    evidence: { kind: "doc", path: "packages/playtest/AGENTS.md" },
  },
];

const byId = new Map(claims.map((claim) => [claim.id, claim] as const));

/** Read a claim by id. Throws rather than rendering an empty string for an unknown id. */
export function claim(id: string): IClaim {
  const found = byId.get(id);
  if (found === undefined) throw new Error(`TN_SITE_UNKNOWN_CLAIM: ${id} is not in claims.ts.`);
  return found;
}

export function claimText(id: string): string {
  return claim(id).text;
}
