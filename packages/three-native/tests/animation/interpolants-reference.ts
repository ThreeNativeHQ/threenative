/**
 * Records the pinned three's interpolants as a C++ table the native test compares against
 * (PRD-516 phase 1): every case is a real keyframe track, `createInterpolant()` and a sequence of
 * `evaluate(t)` calls that seeks forward, backward, past both ends and through NaN and the
 * infinities. Inputs and answers are stored as bit patterns, so the comparison is exact.
 *
 *   pnpm --workspace-root exec tsx packages/three-native/tests/animation/interpolants-reference.ts
 *   ... -- --check   (fails when the committed table is not what this three produces)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { REPO_ROOT, pinnedThreeVersion } from "../../src/fixture-format.js";

const OUT = path.join(
  REPO_ROOT,
  "packages/runtime-native/tests/native-engine/animation/interpolants_reference.inc",
);

const version = pinnedThreeVersion(REPO_ROOT);
const entry = createRequire(path.join(REPO_ROOT, "packages/core/package.json")).resolve("three");
const three = await import(pathToFileURL(entry).href);
const actual = JSON.parse(
  readFileSync(path.join(path.dirname(entry), "..", "package.json"), "utf8"),
) as {
  version: string;
};
if (actual.version !== version)
  throw new Error(
    `TN_FIXTURE_THREE_MISMATCH: resolved three ${actual.version}, the pin is ${version}`,
  );

const f32 = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0] as number;
const f64 = (x: number) => {
  const words = new Uint32Array(new Float64Array([x]).buffer);
  return (BigInt(words[1] as number) << 32n) | BigInt(words[0] as number);
};
const hex32 = (bits: number) => `0x${bits.toString(16).padStart(8, "0")}u`;
const hex64 = (bits: bigint) => `0x${bits.toString(16).padStart(16, "0")}ull`;

// A deterministic walk over [-0.6, 3.1] that seeks in both directions, then the special values.
let seed = 0x2f6b9a1d;
const walk = Array.from({ length: 48 }, () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return -0.6 + (seed / 2 ** 32) * 3.7;
});
const SAMPLES = [
  -1,
  0,
  0.1,
  0.3,
  0.29,
  1,
  2.4,
  2.5,
  3,
  1.2,
  0.05,
  -0.5,
  1.69,
  1.7,
  0.31,
  2,
  ...walk,
];
const SPECIAL = [Number.NaN, 1.3, Number.POSITIVE_INFINITY, 0.7, Number.NEGATIVE_INFINITY, 2.2, -0];

const TIMES = [0, 0.3, 1, 1.7, 2.5];
const quaternions = (() => {
  const Q = three.Quaternion;
  const keys = [
    new Q(),
    new Q().setFromAxisAngle(new three.Vector3(0, 1, 0), 1.2),
    // Negative dot with the previous key: the slerp takes the short way round.
    new Q(-0.6, -0.2, -0.1, -0.77).normalize(),
    // Almost the same as the previous key: the normalised-lerp branch (dot >= 0.9995).
    new Q(-0.601, -0.2, -0.1, -0.769).normalize(),
    // Identical to the previous key: the copy branch.
    new Q(-0.601, -0.2, -0.1, -0.769).normalize(),
  ];
  return keys.flatMap((k) => [k.x, k.y, k.z, k.w]);
})();

interface ITrack {
  times: Float32Array;
  values: Float32Array;
  getValueSize(): number;
  createInterpolant(): { evaluate(t: number): Float32Array; settings: unknown };
}

interface ICase {
  name: string;
  track: () => ITrack;
  kind: "Discrete" | "Linear" | "Smooth" | "QuaternionLinear";
  endings?: [number, number];
}

const ENDINGS: Record<number, string> = {
  [three.ZeroCurvatureEnding]: "ZeroCurvature",
  [three.ZeroSlopeEnding]: "ZeroSlope",
  [three.WrapAroundEnding]: "WrapAround",
};
const scalar = (mode: number) => () =>
  new three.NumberKeyframeTrack(".x", TIMES, [1, -2, 0.5, 4, 3], mode);
const vector = (mode: number) => () =>
  new three.VectorKeyframeTrack(
    ".position",
    TIMES,
    [0, 1, 2, 0.25, -1.5, 3.75, 2, 2, -0.125, 1e-3, 7.5, -4, 1 / 3, 2 / 3, 0.1],
    mode,
  );

const cases: ICase[] = [
  { name: "discrete scalar", track: scalar(three.InterpolateDiscrete), kind: "Discrete" },
  { name: "discrete vec3", track: vector(three.InterpolateDiscrete), kind: "Discrete" },
  { name: "linear scalar", track: scalar(three.InterpolateLinear), kind: "Linear" },
  { name: "linear vec3", track: vector(three.InterpolateLinear), kind: "Linear" },
  {
    name: "single key linear",
    track: () => new three.NumberKeyframeTrack(".x", [1], [5]),
    kind: "Linear",
  },
  {
    name: "quaternion linear",
    track: () => new three.QuaternionKeyframeTrack(".quaternion", TIMES, quaternions),
    kind: "QuaternionLinear",
  },
  {
    name: "quaternion discrete",
    track: () =>
      new three.QuaternionKeyframeTrack(
        ".quaternion",
        TIMES,
        quaternions,
        three.InterpolateDiscrete,
      ),
    kind: "Discrete",
  },
];
for (const start of [three.ZeroCurvatureEnding, three.ZeroSlopeEnding, three.WrapAroundEnding])
  for (const end of [three.ZeroCurvatureEnding, three.ZeroSlopeEnding, three.WrapAroundEnding])
    for (const [label, track] of [
      ["scalar", scalar(three.InterpolateSmooth)],
      ["vec3", vector(three.InterpolateSmooth)],
    ] as const)
      cases.push({
        name: `smooth ${label} ${ENDINGS[start]}/${ENDINGS[end]}`,
        track,
        kind: "Smooth",
        endings: [start, end],
      });

const lines = [
  `// Generated by packages/three-native/tests/animation/interpolants-reference.ts from three@${version}.`,
  "// Do not edit: rerun the generator. Times and values are float32 bits, samples float64 bits,",
  "// results the float32 bits three's Float32Array result buffer held after each evaluate().",
];
const samples = [...SAMPLES, ...SPECIAL];
lines.push(`static const uint64_t kSamples[] = {${samples.map((t) => hex64(f64(t))).join(", ")}};`);
for (const [index, c] of cases.entries()) {
  const track = c.track();
  const interpolant = track.createInterpolant();
  if (c.endings) interpolant.settings = { endingStart: c.endings[0], endingEnd: c.endings[1] };
  const results = samples.flatMap((t) => [...interpolant.evaluate(t)].map(f32));
  lines.push(
    `static const uint32_t kTimes${index}[] = {${[...track.times].map(f32).map(hex32).join(", ")}};`,
    `static const uint32_t kValues${index}[] = {${[...track.values].map(f32).map(hex32).join(", ")}};`,
    `static const uint32_t kResults${index}[] = {${results.map(hex32).join(", ")}};`,
  );
}
lines.push("static const InterpolantCase kCases[] = {");
for (const [index, c] of cases.entries()) {
  const valueSize = c.track().getValueSize();
  const endings = c.endings
    ? `Ending::${ENDINGS[c.endings[0]]}, Ending::${ENDINGS[c.endings[1]]}`
    : "Ending::ZeroCurvature, Ending::ZeroCurvature";
  lines.push(
    `    {"${c.name}", Interpolation::${c.kind}, ${endings}, ${valueSize}, kTimes${index}, std::size(kTimes${index}), kValues${index}, std::size(kValues${index}), kResults${index}},`,
  );
}
lines.push("};", "");
const text = lines.join("\n");

if (process.argv.includes("--check")) {
  const committed = readFileSync(OUT, "utf8");
  if (committed !== text) {
    console.error(
      `TN_FIXTURE_STALE: ${path.relative(REPO_ROOT, OUT)} is not what three@${version} produces`,
    );
    process.exit(1);
  }
  console.log(`interpolants reference current: ${cases.length} cases x ${samples.length} samples`);
} else {
  writeFileSync(OUT, text);
  console.log(
    `wrote ${path.relative(REPO_ROOT, OUT)}: ${cases.length} cases x ${samples.length} samples`,
  );
}
