import assert from "node:assert/strict";
import { test } from "vitest";
import { DisposalScope } from "../template-assets/clearwater/src/clearwaterLifetime.js";
import { beerLambert, dielectricFresnel } from "../template-assets/clearwater/src/render/clearwaterOptics.js";
import { type IClearwaterOptions, resolveClearwaterOptions } from "../template-assets/clearwater/src/render/clearwaterOptions.js";
import { withClearwaterTarget } from "../template-assets/clearwater/src/render/clearwaterPass.js";

// Executes the same production expressions as TSL; no duplicate Fresnel/attenuation implementation.
class Scalar {
  constructor(readonly value: number) {}
  read(x: Scalar | number): number { return x instanceof Scalar ? x.value : x; }
  add(x: Scalar | number): Scalar { return new Scalar(this.value + this.read(x)); }
  sub(x: Scalar | number): Scalar { return new Scalar(this.value - this.read(x)); }
  mul(x: Scalar | number): Scalar { return new Scalar(this.value * this.read(x)); }
  div(x: Scalar | number): Scalar { return new Scalar(this.value / this.read(x)); }
  max(x: Scalar | number): Scalar { return new Scalar(Math.max(this.value, this.read(x))); }
  clamp(a: number, b: number): Scalar { return new Scalar(Math.max(a, Math.min(b, this.value))); }
  sqrt(): Scalar { return new Scalar(Math.sqrt(this.value)); }
  exp(): Scalar { return new Scalar(Math.exp(this.value)); }
  oneMinus(): Scalar { return new Scalar(1 - this.value); }
}

test("fresh defaults and nested arrays do not leak across water bodies", () => {
  const a = resolveClearwaterOptions();
  const b = resolveClearwaterOptions();
  assert.notEqual(a, b);
  assert.notEqual(a.absorption, b.absorption);
  assert.equal(a.level, 0);
  assert.equal(a.ior, 1.3335);
});
test("normalizes sun without mutating caller data", () => {
  const sun = [2, 2, 0] as const;
  const options = resolveClearwaterOptions({ sunDirection: sun });
  assert.deepEqual(sun, [2, 2, 0]);
  assert.ok(Math.abs(Math.hypot(...options.sunDirection) - 1) < 1e-12);
});
const invalid: IClearwaterOptions[] = [
  { size: 0 }, { depth: Number.NaN }, { level: Number.POSITIVE_INFINITY },
  { resolution: 63 }, { segments: 0 }, { rippleResolution: 8 },
  { sunDirection: [0, 0, 0] }, { sunDirection: [1, -1, 0] },
  { absorption: [-1, 0, 0] }, { ior: 1 }, { causticsResolution: 16384 },
  { causticsSegments: 1024 }, { reflectionScale: 2 },
];
for (const options of invalid) {
  test(`reject invalid input ${JSON.stringify(options)}`, () => {
    assert.throws(() => resolveClearwaterOptions(options));
  });
}
test("Fresnel is exact at normal incidence and grazing", () => {
  const ior = 1.3335;
  assert.ok(Math.abs(dielectricFresnel(new Scalar(1), ior).value - ((ior - 1) / (ior + 1)) ** 2) < 1e-14);
  assert.ok(Math.abs(dielectricFresnel(new Scalar(0), ior).value - 1) < 1e-14);
});
test("Fresnel stays bounded and rises toward grazing", () => {
  let last = 0;
  for (let i = 100; i >= 0; i--) {
    const value = dielectricFresnel(new Scalar(i / 100), 1.3335).value;
    assert.ok(value >= last - 1e-12 && value <= 1);
    last = value;
  }
});
test("zero thickness transmits one and extinction compounds per metre", () => {
  assert.equal(beerLambert(new Scalar(0), 0.4).value, 1);
  const metre = beerLambert(new Scalar(1), 0.4).value;
  assert.ok(Math.abs(beerLambert(new Scalar(2), 0.4).value - metre * metre) < 1e-14);
});
test("negative path length does not amplify light", () => {
  assert.equal(beerLambert(new Scalar(-2), 0.4).value, 1);
});
test("cleanup is reverse order and idempotent", () => {
  const scope = new DisposalScope();
  const calls: number[] = [];
  scope.defer(() => { calls.push(1); });
  scope.defer(() => { calls.push(2); });
  scope.dispose();
  scope.dispose();
  assert.deepEqual(calls, [2, 1]);
  assert.equal(scope.disposed, true);
});
test("cleanup still releases remaining resources when one disposer fails", () => {
  const scope = new DisposalScope();
  const calls: string[] = [];
  scope.defer(() => { calls.push("last"); });
  scope.defer(() => { throw new Error("failure"); });
  assert.throws(() => scope.dispose(), AggregateError);
  assert.deepEqual(calls, ["last"]);
});
test("late resources are released immediately", () => {
  const scope = new DisposalScope();
  scope.dispose();
  let disposed = false;
  scope.defer(() => { disposed = true; });
  assert.equal(disposed, true);
});
test("auxiliary pass restores target, mip, MRT, clear and XR state after failure", () => {
  const state = {
    target: "main" as string | null, face: 2, mip: 3, mrt: "velocity" as string | null,
    autoClear: true, color: "blue", alpha: 0.4, xr: { enabled: true },
  };
  const renderer = {
    get autoClear() { return state.autoClear; },
    set autoClear(value: boolean) { state.autoClear = value; },
    xr: state.xr,
    getRenderTarget: () => state.target,
    getActiveCubeFace: () => state.face,
    getActiveMipmapLevel: () => state.mip,
    setRenderTarget: (target: string | null, face = 0, mip = 0) => {
      state.target = target; state.face = face; state.mip = mip;
    },
    getMRT: () => state.mrt,
    setMRT: (value: string | null) => { state.mrt = value; },
    getClearColor: (out: { value: string }) => { out.value = state.color; return out; },
    getClearAlpha: () => state.alpha,
    setClearColor: (color: { value: string }, alpha: number) => { state.color = color.value; state.alpha = alpha; },
    clear: () => {},
  };
  assert.throws(() => withClearwaterTarget(renderer, "caustics", { value: "black" }, { value: "" }, () => {
    assert.equal(state.target, "caustics");
    assert.equal(state.mrt, null);
    assert.equal(state.xr.enabled, false);
    throw new Error("draw failed");
  }), /draw failed/);
  assert.deepEqual(state, { target: "main", face: 2, mip: 3, mrt: "velocity", autoClear: true, color: "blue", alpha: 0.4, xr: { enabled: true } });
});
