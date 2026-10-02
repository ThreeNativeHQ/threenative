import { PLAYTEST_CLOCK_GLOBAL } from "../../../../core/dist/playtest.js";
import { type IPlaytestBridgeV1, PLAYTEST_BRIDGE_GLOBAL } from "../../../../playtest/dist/index.js";
import { createExposureFixture } from "./game.js";
// The graph consumes NodeFrame time. Let the engine's existing frame pump run during playtest waits.
Reflect.set(globalThis, PLAYTEST_CLOCK_GLOBAL, "wall-clock");
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
  deterministic: query.get("deterministic") === "1",
});
void game
  .start()
  .then(async () => {
    const canvas = game.ctx?.renderer.domElement;
    if (canvas === undefined) throw new Error("Exposure fixture has no canvas.");
    document.body.append(canvas);
    const bridge = Reflect.get(globalThis, PLAYTEST_BRIDGE_GLOBAL) as IPlaytestBridgeV1 | undefined;
    if (bridge === undefined) throw new Error("Exposure fixture bridge is unavailable.");
    const observation = await bridge.sample({});
    console.info(`TN_EXPOSURE_CLOCK:${JSON.stringify(observation.clock)}`);
  })
  .catch((error: unknown) => {
    console.error(error);
  });
