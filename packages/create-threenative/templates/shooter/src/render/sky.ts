// The shipped sky is an equirectangular outdoor photograph used three ways at
// once: as the visible background, as the scene's image-based light, and as the
// colour the fog fades distance toward. Keeping all three off one image is what
// makes the town sit in its weather instead of floating in front of a backdrop.
//
// `bayview-sky.jpg` is Poly Haven's partly-cloudy midday pure sky, tonemapped to
// an equirect JPEG. The previous `sky.jpg` was an overcast grey, and an overcast
// environment is most of why the whole scene read flat: with no blue overhead
// there was nothing to separate a sunlit wall from a shaded one.
//
// --- Why background and environment are two different images ---------------
//
// They were one image until 2026-08-23, and that cost 48 MiB of GPU memory for
// nothing. Three.js sizes the PMREM (image-based-light) render target from the
// *source equirect's* width: `PMREMGenerator` takes `cubeSize = width / 4`,
// rounds it down to a power of two, and allocates a ping-pong pair of
// `3 * max(cubeSize, 112)` by `4 * cubeSize` half-float targets. Feeding it the
// 3072-wide background gives `cubeSize = 512` and therefore two 1536x2048
// `rgba16float` targets — measured on a physical Pixel 8 as the
// `1536x2048 rgba16float` n=2, 48 MiB bucket in `TN_GPU_TEXTURES`.
//
// The background genuinely needs those 3072 pixels: it is the thing the player
// looks at, and downsampling it puts visible mush on the horizon. The
// environment does not. PMREM immediately convolves the source into roughness
// mips, so all the light it contributes is low-frequency; the only detail that
// survives at roughness 0 is a mirror reflection, and the sharpest reflector in
// this town is painted steel. A 1024-wide source gives `cubeSize = 256` — two
// 768x1024 targets, 12 MiB — which is still a 256px cube face in a mirror.
//
// So the background keeps the full equirect and the environment gets
// `bayview-sky-ibl.jpg`, a 1024x512 Lanczos reduction of the same photograph,
// which is the same weather at a resolution the light can actually use. Both
// still feed `Fog`, which only ever wanted one colour.
//
// The deliberate choice is 1024, not 512: 512 would take another ~9 MiB but
// halves the mirror again, and this scene has metal in it. Revisit that if a
// later measurement says the metal never reads.
import {
  EquirectangularReflectionMapping,
  Fog,
  SRGBColorSpace,
  type Scene,
  type Texture,
} from "three";
import { palette } from "./palette.js";

/**
 * @param background the full-resolution equirect the player sees
 * @param environment the reduced equirect the image-based light is built from;
 *   when it is absent the background is reused, which is the pre-split
 *   behaviour and costs the 48 MiB described above
 */
export function setupSky(scene: Scene, background?: Texture, environment?: Texture): void {
  if (background !== undefined) {
    // This JPEG is authored in sRGB; leaving it linear washes out the blue channel and
    // loses the high-cloud contrast in the supplied reference.
    background.colorSpace = SRGBColorSpace;
    background.mapping = EquirectangularReflectionMapping;
    scene.background = background;

    // The image-based light is the most expensive per-pixel thing in the frame on a
    // phone: PMREM sampling runs inside every PBR fragment, and draining the GPU with
    // everything else ablated measured it at ~6 ms of a ~28 ms 720p frame on the
    // reference device (runtime-perf-state §1.3.2). Every surface in this town is
    // dielectric and rough (metalness 0.02, roughness 0.68-0.96), so the specular
    // half of the IBL barely exists and the diffuse half is a sky-coloured
    // hemisphere gradient to good approximation. TN_NO_IBL swaps the PMREM for that
    // hemisphere, which lighting.ts trims to a complement; the sky background, fog
    // and every material stay exactly as authored.
    const legacyFill = globalThis.localStorage?.getItem("TN_NO_IBL") === "1";
    if (!legacyFill) {
      const light = environment ?? background;
      light.colorSpace = SRGBColorSpace;
      light.mapping = EquirectangularReflectionMapping;
      scene.environment = light;

      // The sky is now the main fill: it carries the blue that shaded plaster
      // bounces, so the hemisphere light in lighting.ts drops back to a trim.
      scene.environmentIntensity = 0.92;
    }

    // A hair under the environment so the horizon does not out-punch whitewash
    // that is taking direct sun.
    scene.backgroundIntensity = 1.0;
    // Sea haze, matched to the sky's own horizon so distance dissolves into the
    // background rather than greying out in front of it. It starts well past
    // the far side of the 84 m deck: fogging the town itself is what made the
    // old frames look washed out at range.
    scene.fog = new Fog(palette.haze, 110, 340);
    return;
  }
  scene.background = null;
  scene.backgroundIntensity = 1;
  scene.fog = null;
}
