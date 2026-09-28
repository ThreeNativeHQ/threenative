import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { metaHumanBasis } from "../src/coordinates.js";
import { RigEvaluator } from "../src/wasm-evaluator.js";

/**
 * The conversion, proved against a real specimen's exported rest pose.
 *
 * A bindings sidecar declares its source basis in three fields, and `coordinates.ts` turns those
 * into one map. This lane is what makes that map a measurement rather than a guess: every neutral
 * joint the DNA carries is taken through the map and compared with the transform the same joint
 * has in the exported GLB, to 0.1 mm and 0.1° as the PRD requires. A wrong axis, a wrong sign, a
 * wrong unit or a wrong rotation order shows up as a named joint and a number.
 *
 * The licensed specimen is not committed, so this lane runs only when `TN_METAHUMAN_SPECIMEN_DIR`
 * points at one holding `dna/<name>.dna` and `Models/<name>.glb`. Without it the lane reports as
 * skipped, never as passed: an absent specimen is a missing observation, not a passing one.
 */

const SPECIMEN_DIR = process.env.TN_METAHUMAN_SPECIMEN_DIR ?? "";
const SPECIMEN = process.env.TN_METAHUMAN_SPECIMEN ?? "Ada_FaceMesh";

/** The specimen's declared basis, exactly as its prepared sidecar states it. */
const COORDINATES = { sourceUnits: "cm", sourceUp: "z", handedness: "left" } as const;

interface IGlbNode {
  readonly name?: string;
  readonly children?: readonly number[];
  readonly translation?: readonly number[];
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
}

/** The glTF JSON chunk, read directly: node transforms are all this lane needs, and no DOM. */
function glbNodes(path: string): readonly IGlbNode[] {
  const bytes = readFileSync(path);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a glb`);
  const jsonLength = bytes.readUInt32LE(12);
  return (
    JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as {
      nodes: readonly IGlbNode[];
    }
  ).nodes;
}

function restOf(node: IGlbNode) {
  const t = (node.translation ?? [0, 0, 0]) as [number, number, number];
  const r = (node.rotation ?? [0, 0, 0, 1]) as [number, number, number, number];
  const s = (node.scale ?? [1, 1, 1]) as [number, number, number];
  return {
    position: new Vector3(t[0], t[1], t[2]),
    quaternion: new Quaternion(r[0], r[1], r[2], r[3]),
    scale: new Vector3(s[0], s[1], s[2]),
  };
}

/** A quaternion and its negation are one rotation, so the sign is never part of the error. */
function degreesBetween(actual: Quaternion, expected: Quaternion): number {
  return (2 * Math.acos(Math.min(1, Math.abs(actual.dot(expected)))) * 180) / Math.PI;
}

/** The joints whose exported node hangs off a parent the rig does not have. */
function chainRoots(nodes: readonly IGlbNode[], joints: ReadonlySet<string>): string[] {
  const parentOf = new Map<number, number>();
  for (const [index, node] of nodes.entries()) {
    for (const child of node.children ?? []) parentOf.set(child, index);
  }
  const isJoint = (index: number): boolean => index >= 0 && joints.has(nodes[index]?.name ?? "");
  return nodes.flatMap((node, index) =>
    isJoint(index) && !isJoint(parentOf.get(index) ?? -1) && node.name !== undefined
      ? [node.name]
      : [],
  );
}

/** One joint's neutral taken through the declared conversion, against the node it should equal. */
function compareJoint(
  basis: ReturnType<typeof metaHumanBasis>,
  neutral: Float32Array,
  index: number,
  rest: { position: Vector3; quaternion: Quaternion },
): { millimetres: number; degrees: number } {
  const at = index * 10;
  const translation = new Vector3(
    neutral[at] as number,
    neutral[at + 1] as number,
    neutral[at + 2] as number,
  );
  const rotation = new Quaternion(
    neutral[at + 3] as number,
    neutral[at + 4] as number,
    neutral[at + 5] as number,
    neutral[at + 6] as number,
  );
  const convertedTranslation = basis.vector(translation, new Vector3());
  const convertedRotation = basis.quaternion(rotation, new Quaternion());
  return {
    millimetres: convertedTranslation.distanceTo(rest.position) * 1000,
    degrees: degreesBetween(convertedRotation, rest.quaternion),
  };
}

const describeSpecimen = SPECIMEN_DIR === "" ? describe.skip : describe;

describeSpecimen(`the DNA to glTF conversion against ${SPECIMEN}`, () => {
  it("turns every comparable DNA neutral joint into the GLB's own rest transform", async () => {
    const rig = await RigEvaluator.create(
      new Uint8Array(readFileSync(join(SPECIMEN_DIR, "dna", `${SPECIMEN}.dna`))),
    );
    try {
      const basis = metaHumanBasis(COORDINATES);
      const neutral = rig.neutralJoints();
      const jointNames = rig.names("joint");
      expect(neutral.length).toBe(jointNames.length * 10);

      const nodes = glbNodes(join(SPECIMEN_DIR, "Models", `${SPECIMEN}.glb`));
      // One joint has no comparable node: the head of the rig's own chain. Its DNA neutral is
      // written in absolute rig space, while the exported node's transform is relative to a
      // parent the rig does not have. The adapter never reads it — the neutral it composes onto
      // is the node's own bind transform — so it is named here rather than compared.
      const roots = chainRoots(nodes, new Set(jointNames));

      let compared = 0;
      let worst = { joint: "none", millimetres: 0, degrees: 0 };
      for (const [index, name] of jointNames.entries()) {
        const node = nodes.findIndex((candidate) => candidate.name === name);
        if (node < 0 || roots.includes(name as string)) continue;
        const error = compareJoint(basis, neutral, index, restOf(nodes[node] as IGlbNode));
        compared += 1;
        if (error.millimetres > worst.millimetres || error.degrees > worst.degrees)
          worst = { joint: name, ...error };
        expect(error.millimetres, `${name} translation, mm`).toBeLessThanOrEqual(0.1);
        expect(error.degrees, `${name} rotation, degrees`).toBeLessThanOrEqual(0.1);
      }

      // A conversion that compared nothing is not a pass, and a specimen whose chain roots are
      // ambiguous is a missing observation rather than a result.
      expect(compared).toBeGreaterThan(0);
      expect(roots).toHaveLength(1);
      console.info(
        `metahuman neutral match: ${compared}/${jointNames.length} joints within 0.1 mm and 0.1 deg; worst ${worst.joint} at ${worst.millimetres.toExponential(2)} mm and ${worst.degrees.toExponential(2)} deg; chain root ${roots[0]} is rig-absolute and not comparable`,
      );
    } finally {
      rig.dispose();
    }
  }, 120_000);
});

if (SPECIMEN_DIR === "")
  console.info(
    "metahuman neutral match: specimen lane skipped, TN_METAHUMAN_SPECIMEN_DIR unset; 0 joints compared",
  );
