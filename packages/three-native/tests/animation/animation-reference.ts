/**
 * Records the pinned three's animation answers as C++ tables the native tests compare against
 * (PRD-516 phase 1). Inputs and answers are bit patterns, so the comparisons are exact.
 *
 * - interpolants_reference.inc: every case is a real keyframe track, `createInterpolant()` and a
 *   sequence of `evaluate(t)` calls that seeks forward, backward, past both ends and through NaN
 *   and the infinities.
 * - property_binding_reference.inc: `PropertyBinding.parseTrackName` over three's own test names
 *   and edge cases, and a binding scenario (bind, reparent, leave the root, rebind, a shadowing
 *   name) recorded as each node's transform and each binding's `getValue` after every step. The
 *   native test runs the same scenario, step for step.
 *
 *   pnpm --workspace-root exec tsx packages/three-native/tests/animation/animation-reference.ts
 *   ... -- --check   (fails when a committed table is not what this three produces)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { REPO_ROOT, pinnedThreeVersion } from "../../src/fixture-format.js";

const OUT_DIR = path.join(REPO_ROOT, "packages/runtime-native/tests/native-engine/animation");

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
  `// Generated by packages/three-native/tests/animation/animation-reference.ts from three@${version}.`,
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

// ---- PropertyBinding
const PARSE_NAMES = [
  // three@0.185.1 test/unit/src/animation/PropertyBinding.tests.js
  ".property",
  "nodeName.property",
  "a.material.opacity",
  "uuid.objectName[objectIndex].propertyName[propertyIndex]",
  "parentName/nodeName.property",
  "parentName/no.de.Name.property",
  "parentName/parentName/nodeName.property[index]",
  ".bone[Armature.DEF_cog].position",
  "scene:helium_balloon_model:helium_balloon_model.position",
  "test.bones[hip].rotation[x]",
  "scene:helium_balloon_model:helium_balloon_model.position[x]",
  // edges
  "arm.L.quaternion",
  "hand.material[1].opacity",
  "node.map.offset",
  "node.materials.color",
  "a.b.c.d",
  "日本.position",
  "a b.position[y]",
  "",
  ".",
  "noProperty",
  "[bad].x",
  "a.b[",
  "a/.x",
  "dir:node.prop[[x]]",
];
const show = (value: string | undefined) => (value === undefined ? "~" : value);
const parseLines = PARSE_NAMES.map((name) => {
  try {
    const p = three.PropertyBinding.parseTrackName(name);
    return `node=${show(p.nodeName)};object=${show(p.objectName)};objectIndex=${show(p.objectIndex)};property=${show(p.propertyName)};propertyIndex=${show(p.propertyIndex)}`;
  } catch {
    return "throws";
  }
});
const cString = (s: string) => JSON.stringify(s);

const bits = (x: number) => f64(x).toString(16).padStart(16, "0");
const SENTINEL = 12345.5;
const TRACKS: Array<[string, number]> = [
  [".position", 3],
  ["hand.position", 3],
  ["arm.L.quaternion", 4],
  ["hand.scale[y]", 1],
  ["armB/hand.visible", 1],
  ["missing.position", 3],
  ["hand.material.opacity", 1],
  ["hand.foo", 1],
];
// What a boolean track writes: three stores the raw number, and a boolean track only gives 0 or 1.
const VISIBLE = [0, 0, 1, 0, 1, 0, 1, 0];
const named = (name: string) => Object.assign(new three.Object3D(), { name });
const root = named("root");
const armA = named("armA");
const armL = named("arm.L");
const armB = named("armB");
const hand = named("hand");
const hand2 = named("hand");
const outside = named("outside");
root.add(armA, armB);
armA.add(armL);
armB.add(hand);
const NODES = [root, armA, armL, armB, hand, hand2, outside];
const quiet = { warn: console.warn, error: console.error };
console.warn = () => {};
console.error = () => {};
const bindings = TRACKS.map(([track]) => new three.PropertyBinding(root, track));
const rebind = () => {
  for (const b of bindings) b.unbind();
  for (const b of bindings) b.bind();
};
const setAll = (step: number) =>
  bindings.forEach((b, i) => {
    const size = (TRACKS[i] as [string, number])[1];
    const buffer = new Float64Array(4);
    for (let c = 0; c < size; ++c) buffer[c] = step * 10 + i + c * 0.25;
    if (i === 4) buffer[0] = VISIBLE[step] as number;
    b.setValue(buffer, 0);
  });
const vec = (v: { toArray(): number[] }) => v.toArray().map(bits).join(",");
const observe = (label: string) => {
  const nodes = NODES.map(
    (o) =>
      `${o.name}:p=${vec(o.position)};q=${vec(o.quaternion)};s=${vec(o.scale)};v=${o.visible ? 1 : 0};m=${o.matrixWorldNeedsUpdate ? 1 : 0}`,
  );
  const values = bindings.map((b, i) => {
    const buffer = new Float64Array(4).fill(SENTINEL);
    b.getValue(buffer, 0);
    return `b${i}=${[...buffer.subarray(0, (TRACKS[i] as [string, number])[1])].map(bits).join(",")}`;
  });
  return [label, ...nodes, ...values].join("|");
};
const steps: string[] = [];
for (const b of bindings) b.bind();
setAll(1);
steps.push(observe("bind"));
armA.add(hand);
setAll(2);
steps.push(observe("reparent-within-root"));
outside.add(hand);
setAll(3);
steps.push(observe("leave-root-still-bound"));
rebind();
setAll(4);
steps.push(observe("rebind-outside-root"));
armB.add(hand);
rebind();
setAll(5);
steps.push(observe("return-and-rebind"));
armA.add(hand2);
rebind();
setAll(6);
steps.push(observe("shadowing-name-first-in-depth-order"));
armA.remove(hand2);
setAll(7);
steps.push(observe("removed-node-stays-bound"));
console.warn = quiet.warn;
console.error = quiet.error;

const bindingLines = [
  `// Generated by packages/three-native/tests/animation/animation-reference.ts from three@${version}.`,
  "// Do not edit: rerun the generator. Doubles are their 16 hex digits of bits; ~ is undefined.",
  `static const double kSentinel = ${SENTINEL};`,
  "static const char* const kParse[][2] = {",
  ...PARSE_NAMES.map((name, i) => `    {${cString(name)}, ${cString(parseLines[i] as string)}},`),
  "};",
  "static const char* const kSteps[] = {",
  ...steps.map((step) => `    ${cString(step)},`),
  "};",
  "",
];

const outputs: Array<[string, string]> = [
  ["interpolants_reference.inc", lines.join("\n")],
  ["property_binding_reference.inc", bindingLines.join("\n")],
];
for (const [file, text] of outputs) {
  const out = path.join(OUT_DIR, file);
  if (process.argv.includes("--check")) {
    if (readFileSync(out, "utf8") !== text) {
      console.error(
        `TN_FIXTURE_STALE: ${path.relative(REPO_ROOT, out)} is not what three@${version} produces`,
      );
      process.exit(1);
    }
    console.log(`current: ${file}`);
  } else {
    writeFileSync(out, text);
    console.log(`wrote ${path.relative(REPO_ROOT, out)}`);
  }
}
