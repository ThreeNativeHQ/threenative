import type { IconName } from "../components/ui/Icon.js";

export interface IFeature {
  readonly icon: IconName;
  readonly title: string;
  /** The body copy lives in `claims.ts`, so the four cards cannot say something unevidenced. */
  readonly claimId: string;
}

/** The four-column band from the reference, in the reference's order. */
export const features: readonly IFeature[] = [
  { icon: "bolt", title: "Native performance", claimId: "feature-native-performance" },
  { icon: "hexagon", title: "Three.js API", claimId: "feature-threejs-api" },
  { icon: "puzzle", title: "Open & extensible", claimId: "feature-open-extensible" },
  { icon: "devices", title: "Ship everywhere", claimId: "feature-ship-everywhere" },
];
