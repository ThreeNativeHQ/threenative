// Generated for you: ordinary Three.js; ThreeNative does not read this file.
//
// The contact shadow under small things. The shadow map cannot resolve the few centimetres where
// a foot meets the ground: its texels are wider than the gap and its bias lifts the shadow off the
// caster, so a fox on a bright grass cap looked unplanted and this game used to hide that with a
// painted blob. This stage replaces the blob with a shadow marched through the depth the scene
// pass already wrote, toward the sun.
//
// The split: `contactShadow()` from the core package owns the compute passes and returns the
// term as a texture node. Everything you see is decided in this file: how far the
// shadow reaches, how thick a surface is assumed to be, how hard the edge is, how dark it gets,
// and that the term multiplies the lit colour after the scene pass. To make it softer, lower
// `strength` or `contrast` below. To remove it, drop `"contactShadows"` from
// `authoredStageNames` in `postprocessing.ts`; `TN_RENDER_CHAIN` then stops listing it.
import { type IContactShadowOptions, contactShadow } from "@threenative/core";
import { type DirectionalLight, Vector3 } from "three";
import { float } from "three/tsl";
import type { Node } from "three/webgpu";
import type { QualityTier } from "./quality.js";
import type { ChainStage, IWorldEnvironmentStageContext } from "./worldEnvironment.js";

/** What one tier asks of the stage. Every number is this game's; the engine has no defaults. */
export interface IContactShadowLook {
  /** Shadow length in screen pixels, and the cost: one depth sample per pixel of length. */
  readonly sampleCount: number;
  /** The first samples cast a hard shadow; the rest are averaged. */
  readonly hardSamples: number;
  /** The last samples fade the shadow out, so its far end does not stop on a line. */
  readonly fadeSamples: number;
  /** How thick a surface is assumed to be, as a fraction of the remaining depth range. */
  readonly surfaceThickness: number;
  /** Depth jump, as a fraction, that counts as an edge instead of a slope. */
  readonly bilinearThreshold: number;
  /** Boost on the lit-to-shadow transition. At least 1. */
  readonly contrast: number;
  /** 0 leaves the frame as it was, 1 applies the whole term. */
  readonly strength: number;
}

/**
 * The `contactShadows` stage. Pass it as `authoredStages` and name `"contactShadows"` in
 * `authoredStageNames`. It refuses by name, with a reason, when the game has no sun to trace
 * toward, and the chain drops it below the `medium` tier.
 */
export function contactShadowStages(
  context: IWorldEnvironmentStageContext,
  sun: DirectionalLight | undefined,
  look: IContactShadowLook,
): readonly ChainStage[] {
  let mask: Node | undefined;
  const from = new Vector3();
  const to = new Vector3();
  return [
    {
      name: "contactShadows",
      minimumTier: "medium",
      available: () => (sun === undefined ? "no-sun-light" : true),
      build: (input) => {
        if (sun === undefined) throw new Error("contactShadows built without a sun light.");
        // The pass's own depth texture: its size follows the drawing buffer, so read it each frame.
        const depth = context.depthNode as unknown as {
          readonly value: { readonly image: { readonly width: number; readonly height: number } };
        };
        const options: IContactShadowOptions = {
          bilinearThreshold: look.bilinearThreshold,
          camera: context.camera,
          contrast: look.contrast,
          depth: {
            node: context.depthNode,
            size: () => ({ height: depth.value.image.height, width: depth.value.image.width }),
          },
          direction: () => {
            sun.getWorldPosition(from);
            sun.target.getWorldPosition(to);
            return from.sub(to).normalize();
          },
          fadeSamples: look.fadeSamples,
          hardSamples: look.hardSamples,
          sampleCount: look.sampleCount,
          surfaceThickness: look.surfaceThickness,
        };
        const node = contactShadow(options) as unknown as Node<"vec4">;
        mask = node;
        // `.r` is 1 where lit and 0 where shadowed; `strength` is how much of that this game wants.
        const term = float(1).sub(float(1).sub(node.r).mul(look.strength));
        return (input as Node<"vec4">).mul(term);
      },
      dispose: () => {
        mask?.dispose();
        mask = undefined;
      },
    },
  ];
}

/**
 * The contact shadow under small things, per tier. The numbers hold things on the ground rather
 * than draw a dark halo: 24 px is the shadow's reach on screen, the first 3 samples stay hard so
 * the contact is pinned, and the last 6 fade so the far end does not stop on a line. `low` does
 * not run the stage: the chain refuses it by name, so its entry only says what it would use. Cost
 * is unmeasured; read `TN_FRAME_BUDGET` after you change a number.
 */
const CONTACT_SHADOW_HIGH: IContactShadowLook = {
  bilinearThreshold: 0.02,
  contrast: 2,
  fadeSamples: 6,
  hardSamples: 3,
  sampleCount: 24,
  strength: 0.75,
  surfaceThickness: 0.005,
};
const CONTACT_SHADOW_MEDIUM: IContactShadowLook = {
  ...CONTACT_SHADOW_HIGH,
  fadeSamples: 4,
  hardSamples: 2,
  sampleCount: 16,
};
const CONTACT_SHADOW: Record<QualityTier, IContactShadowLook> = {
  high: CONTACT_SHADOW_HIGH,
  low: CONTACT_SHADOW_MEDIUM,
  medium: CONTACT_SHADOW_MEDIUM,
};

/** The contact-shadow numbers a tier uses. Throws on a name that is not a tier. */
export function contactShadowLook(tier: string): IContactShadowLook {
  const look = CONTACT_SHADOW[tier as QualityTier];
  if (look === undefined) {
    throw new Error(
      `Unknown quality tier ${JSON.stringify(tier)} — expected one of ${Object.keys(CONTACT_SHADOW).join(", ")}.`,
    );
  }
  return look;
}
