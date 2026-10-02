import { createExposureFixture } from "./game.js";
const query = new URLSearchParams(location.search);
const stops = Number(query.get("stops") ?? 11);
const snapGain = Number(query.get("snapGain") ?? 1);
if (![1, 11].includes(stops) || ![0, 1].includes(snapGain))
  throw new Error("Unsupported exposure fixture policy.");
const game = createExposureFixture({
  enabled: query.get("enabled") !== "0",
  bright: query.get("bright") === "1",
  stops,
  snapGain,
});
void game
  .start()
  .then(() => {
    const canvas = game.ctx?.renderer.domElement;
    if (canvas === undefined) throw new Error("Exposure fixture has no canvas.");
    document.body.append(canvas);
  })
  .catch((error: unknown) => {
    console.error(error);
  });
