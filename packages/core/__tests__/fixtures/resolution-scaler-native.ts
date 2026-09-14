// Bundle with esbuild, then run on threenative-runtime to prove the same controller on native.
import { ResolutionScaler } from "../../src/resolution-scaler.js";

const window = (gpuMs: number) => ({
  fps: 9.55,
  gpuMs,
  gpuAgeFrames: 7,
  presented: { max: 250, p50: 100, p95: 133.3, p99: 166.7 },
});
const scaler = new ResolutionScaler({ targetFps: 60 });
const check = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};
for (let i = 0; i < 20; i += 1) scaler.observe(window(7.74));
check(scaler.scale === 1 && scaler.scaleSource === "auto", "CPU delay spent pixels");
scaler.observe(window(20));
check(scaler.scale === 0.85, "GPU overload did not lower resolution proportionately");
for (let i = 0; i < 5; i += 1) scaler.observe(window(7));
check(scaler.scale === 1, "GPU headroom did not recover full resolution");
console.log("TN_SCALER_NATIVE_PASS: preserved pixels, GPU overload response, automatic recovery");
process.exit(0);
