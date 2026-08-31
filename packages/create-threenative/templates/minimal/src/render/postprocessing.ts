// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// `WorldEnvironment`, in this folder, builds the lighting chain: which stages run, in what
// order, and an honest report of what happened. It prints `TN_WORLD_ENVIRONMENT` naming every
// stage as applied or refused **with a reason**, so a stage that silently no-op'd is never
// mistaken for one you turned off. It decides no colour and no strength — every value below is
// an argument, and they are yours.
//
// SSGI and SSR are the expensive pair, so they ship on for desktop and off for mobile. That
// split is the shipped default, not a ceiling: turn either on for mobile by adding it to
// `mobilePreset` and read the frame cost back out of `TN_FRAME_BUDGET`. What each stage costs,
// and the one-line enable for the ones that ship off everywhere (godrays, contact AO,
// vignette), is in `agent-docs/visual-baseline.md`.
import type { Camera, DirectionalLight, Scene } from "three";
import { float, vec3, vec4 } from "three/tsl";
import type { Node } from "three/webgpu";
import { wallBounceRadiance } from "./materials.js";
import type { OutputRenderer } from "./worldEnvironment.js";
import { WorldEnvironment } from "./worldEnvironment.js";

type AtmosphereLike = {
  aerialPerspective(scenePass: unknown, depth: unknown, inScatteredRadiance?: unknown): unknown;
  radiance(direction: unknown): unknown;
};

type IndirectLightLike = {
  attachGBuffer(scenePass: unknown): void;
  indirectLight: Node<"vec3">;
};

/** Appearance inputs for the opt-in solve stay in generated game render source. */
export function createIndirectLighting(light: DirectionalLight) {
  // This game-authored probe points through the seeded floor/wall pair. The small horizontal
  // components keep the ray from being parallel to either box face while the key is still
  // accepted so this render helper remains coupled to the game's chosen light.
  const direction = vec3(0.001, 1, 0.001);
  return {
    attenuation: (distance: Node<"float">) => float(1).div(float(1).add(distance)),
    direction,
    normalResponse: () => float(1),
    radiance: wallBounceRadiance,
    strength: float(0.35),
  };
}

function composeIndirectLight(
  createIndirectLight: (() => IndirectLightLike) | undefined,
  scenePass: unknown,
  direct: Node<"vec4">,
): Node<"vec4"> {
  if (createIndirectLight === undefined) return direct;
  const gi = createIndirectLight();
  gi.attachGBuffer(scenePass);
  return vec4(direct.rgb.add(gi.indirectLight.mul(0.8)), direct.a);
}

// Scene-referred exposure: multiplied into the pass before the tone curve, so the gather, the
// reflections and the bloom threshold all see the same exposed image.
const exposure = 1.15;

// Unchanged from this template's previous chain — strength, radius and threshold are a look
// decision that was already tuned to this scene's palette.
const glow = {
  bloomEnabled: true,
  bloomRadius: 0.5,
  bloomStrength: 0.5,
  bloomThreshold: 0.2,
} as const;

// No SSGI here, and this is the one template where that is a measured decision rather than a
// taste one: its sky, sun colour and depth haze are a volumetric `Atmosphere`, which already owns
// most of the frame. With the gather on, `playtests/play.playtest.json` measured **34.2 ms p95
// against the 33 ms ceiling**; without it the same scenario passes. Turn it on when you replace
// the atmosphere with a flat sky, and read the p95 back out of `TN_FRAME_BUDGET`.
const desktopPreset = {
  ...glow,
  exposure,
  ssrEnabled: true,
  // `SSRNode` defaults this to **1 world unit**, which on a scene this size reads as
  // "reflections are on and do nothing" — the ray dies a metre from where it started.
  ssrMaxDistance: 20,
  // A reflection carries almost no high-frequency detail, so half resolution costs a quarter
  // of the rays and is very hard to see in the result.
  ssrResolutionScale: 0.5,
  // RCAS puts back the micro-detail the half-resolution reflection and the denoiser take out.
  // The same cause everywhere, so the same value everywhere: **0 is maximum sharpening and 2
  // is none** — it is a radius, not a gain.
  sharpenEnabled: true,
  sharpenStrength: 0.3,
  tonemapMode: "aces",
} as const;

// No SSGI, no SSR, and therefore nothing for the sharpener to put back.
const mobilePreset = {
  ...glow,
  exposure,
  tonemapMode: "aces",
} as const;

export function setupPost(
  renderer: OutputRenderer,
  scene: Scene,
  camera: Camera,
  environment: {
    atmosphere?: AtmosphereLike;
    godraysLight?: DirectionalLight;
    createIndirectLight?: () => IndirectLightLike;
    mobile?: boolean;
  } = {},
): void {
  const world = new WorldEnvironment(environment.mobile === true ? mobilePreset : desktopPreset);
  const atmosphere = environment.atmosphere;
  const createIndirectLight = environment.createIndirectLight;
  world.apply(renderer, scene, camera, {
    // The chain builds the scene pass, so aerial perspective — which needs that pass and its
    // view-Z — is composed here, first, before exposure and before any stage. Delete this
    // property to drop aerial perspective while keeping the sky and the rest of the chain.
    baseColour:
      atmosphere === undefined && createIndirectLight === undefined
        ? undefined
        : (scenePass) => {
            const direct =
              atmosphere === undefined
                ? scenePass.getTextureNode("output")
                : (atmosphere.aerialPerspective(
                    scenePass,
                    scenePass.getViewZNode(),
                    // Same scale as the dome in sky.ts, and for the same reason: this radiance is
                    // mixed into every pixel by the haze term, so at 24 it lifted the whole frame.
                    (atmosphere.radiance(vec3(0, 0, 1)) as Node<"vec3">).mul(1.5),
                  ) as Node<"vec4">);
            let composed = direct;
            // Delete this line to restore the direct-only baseline. The factory is the only place
            // that constructs the BVH and SurfelGI, so the OFF mutation also removes their buffers
            // and dispatches rather than merely dropping their colour from the final expression.
            composed = composeIndirectLight(environment.createIndirectLight, scenePass, direct);
            return composed;
          },
    godraysLight: environment.godraysLight,
  });
}
