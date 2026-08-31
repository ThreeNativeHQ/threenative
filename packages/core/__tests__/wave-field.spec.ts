import { BufferGeometry, Mesh } from "three";
import { positionLocal } from "three/tsl";
import { MeshBasicNodeMaterial, WGSLNodeBuilder } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { WaveField } from "../src/wave-field.js";

const options = {
  waves: [
    {
      amplitude: 0.42,
      direction: [1, 0] as const,
      wavelength: 7,
      speed: 0.8,
      phase: 0.2,
      steepness: 0.14,
    },
    { amplitude: 0.18, direction: [0.2, 1] as const, wavelength: 2.8, speed: -0.35, phase: -0.6 },
  ],
  domainWarp: [
    {
      direction: [0.8, 0.6] as const,
      displacement: [0.16, -0.08] as const,
      wavelength: 11,
      speed: 0.25,
      phase: 0.4,
    },
  ],
};

type NumericValue = number | readonly number[];

interface IWaveNode {
  readonly isNode?: boolean;
  readonly isAssignNode?: boolean;
  readonly isConstNode?: boolean;
  readonly isJoinNode?: boolean;
  readonly isMathNode?: boolean;
  readonly isOperatorNode?: boolean;
  readonly isSplitNode?: boolean;
  readonly isStackNode?: boolean;
  readonly isUniformNode?: boolean;
  readonly isVarNode?: boolean;
  readonly node?: IWaveNode;
  readonly nodes?: readonly IWaveNode[];
  readonly outputNode?: IWaveNode | null;
  readonly value?: unknown;
  readonly components?: string;
  readonly op?: string;
  readonly method?: string;
  readonly aNode?: IWaveNode;
  readonly bNode?: IWaveNode | null;
  readonly targetNode?: IWaveNode;
  readonly sourceNode?: IWaveNode;
  readonly getOutputNode?: (builder: unknown) => unknown;
}

interface IWaveGraphInternals {
  readonly node?: {
    readonly shaderNode?: {
      readonly jsFunc?: unknown;
    };
    readonly getOutputNode?: (builder: unknown) => unknown;
  };
}

function graphShaderSource(graph: unknown): string {
  const shaderNode = (graph as IWaveGraphInternals).node?.shaderNode;
  if (typeof shaderNode?.jsFunc !== "function")
    throw new Error("wave graph shader function missing");
  return String(shaderNode.jsFunc);
}

function requireNode(value: unknown, name: string): IWaveNode {
  if (typeof value !== "object" || value === null || (value as IWaveNode).isNode !== true)
    throw new Error(`${name} is not a TSL node.`);
  return value as IWaveNode;
}

function numericValue(value: unknown, name: string): NumericValue {
  if (typeof value === "number") return value;
  if (Array.isArray(value) && value.every((component) => typeof component === "number"))
    return value as number[];
  throw new Error(`${name} is not a numeric TSL value.`);
}

function components(value: NumericValue): readonly number[] {
  return typeof value === "number" ? [value] : value;
}

function binaryOperation(
  left: NumericValue,
  right: NumericValue,
  operation: (left: number, right: number) => number,
): NumericValue {
  if (typeof left === "number" && typeof right === "number") return operation(left, right);
  const leftComponents = components(left);
  const rightComponents = components(right);
  const length = Math.max(leftComponents.length, rightComponents.length);
  if (
    ![leftComponents.length, rightComponents.length].every((size) => size === 1 || size === length)
  )
    throw new Error("TSL numeric evaluator cannot broadcast these vector sizes.");
  return Array.from({ length }, (_, index) =>
    operation(
      leftComponents[leftComponents.length === 1 ? 0 : index] as number,
      rightComponents[rightComponents.length === 1 ? 0 : index] as number,
    ),
  );
}

interface IWaveEvaluationContext {
  readonly positionNode: IWaveNode;
  readonly position: readonly [number, number, number];
  readonly values: Map<IWaveNode, NumericValue>;
}

function evaluateTslGraph(
  root: IWaveNode,
  position: readonly [number, number, number],
): NumericValue {
  const context: IWaveEvaluationContext = {
    positionNode: positionLocal as unknown as IWaveNode,
    position,
    values: new Map(),
  };
  return evaluateNode(root, context);
}

function evaluateNode(candidate: IWaveNode, context: IWaveEvaluationContext): NumericValue {
  if (candidate === context.positionNode) return context.position;
  if (candidate.isStackNode) return evaluateStack(candidate, context);
  if (candidate.isAssignNode) {
    assignNode(candidate, context);
    return 0;
  }
  if (candidate.isVarNode) return evaluateVariable(candidate, context);
  if (candidate.isConstNode || candidate.isUniformNode)
    return numericValue(candidate.value, "TSL constant");
  if (candidate.isSplitNode) return evaluateSplit(candidate, context);
  if (candidate.constructor?.name === "JoinNode") return evaluateJoin(candidate, context);
  if (candidate.isOperatorNode) return evaluateOperator(candidate, context);
  if (candidate.isMathNode) return evaluateMath(candidate, context);
  if (candidate.node !== undefined) return evaluateNode(candidate.node, context);
  throw new Error(
    `TSL numeric evaluator found an unsupported node: ${candidate.constructor?.name ?? "<unknown>"} (${Object.keys(candidate).join(", ")}).`,
  );
}

function evaluateStack(candidate: IWaveNode, context: IWaveEvaluationContext): NumericValue {
  for (const child of candidate.nodes ?? []) {
    if (child.isAssignNode) assignNode(child, context);
    else evaluateNode(child, context);
  }
  return candidate.outputNode === null || candidate.outputNode === undefined
    ? 0
    : evaluateNode(candidate.outputNode, context);
}

function evaluateVariable(candidate: IWaveNode, context: IWaveEvaluationContext): NumericValue {
  const assigned = context.values.get(candidate);
  if (assigned !== undefined) return assigned;
  const initial = evaluateNode(requireNode(candidate.node, "TSL variable initializer"), context);
  context.values.set(candidate, initial);
  return initial;
}

function evaluateSplit(candidate: IWaveNode, context: IWaveEvaluationContext): NumericValue {
  const source = components(
    evaluateNode(requireNode(candidate.node, "TSL swizzle source"), context),
  );
  const requested = candidate.components;
  if (requested === undefined) throw new Error("TSL swizzle has no components.");
  const indices = [...requested].map((component) => "xyzw".indexOf(component));
  if (indices.some((index) => index < 0))
    throw new Error("TSL numeric evaluator found an invalid swizzle.");
  const first = source[0];
  if (first === undefined) throw new Error("TSL swizzle source is empty.");
  const selected = indices.map((index) => source[index] ?? first);
  return selected.length === 1 ? (selected[0] as number) : selected;
}

function evaluateJoin(candidate: IWaveNode, context: IWaveEvaluationContext): NumericValue {
  const joined = (candidate.nodes ?? []).flatMap((child) =>
    components(evaluateNode(child, context)),
  );
  return joined.length === 1 ? (joined[0] as number) : joined;
}

function evaluateOperator(candidate: IWaveNode, context: IWaveEvaluationContext): NumericValue {
  const left = evaluateNode(requireNode(candidate.aNode, "TSL operator left operand"), context);
  const right = evaluateNode(requireNode(candidate.bNode, "TSL operator right operand"), context);
  switch (candidate.op) {
    case "+":
      return binaryOperation(left, right, (a, b) => a + b);
    case "-":
      return binaryOperation(left, right, (a, b) => a - b);
    case "*":
      return binaryOperation(left, right, (a, b) => a * b);
    case "/":
      return binaryOperation(left, right, (a, b) => a / b);
    default:
      throw new Error(
        `TSL numeric evaluator does not support operator ${candidate.op ?? "<missing>"}.`,
      );
  }
}

function evaluateMath(candidate: IWaveNode, context: IWaveEvaluationContext): NumericValue {
  const value = evaluateNode(requireNode(candidate.aNode, "TSL math operand"), context);
  if (candidate.method === "sin")
    return typeof value === "number"
      ? Math.sin(value)
      : value.map((component) => Math.sin(component));
  throw new Error(
    `TSL numeric evaluator does not support math method ${candidate.method ?? "<missing>"}.`,
  );
}

function assignNode(candidate: IWaveNode, context: IWaveEvaluationContext): void {
  const target = requireNode(candidate.targetNode, "TSL assignment target");
  const source = evaluateNode(requireNode(candidate.sourceNode, "TSL assignment source"), context);
  context.values.set(target, source);
}

function expandTslGraph(graph: unknown): IWaveNode {
  const graphNode = requireNode((graph as IWaveGraphInternals).node, "wave graph call");
  if (typeof graphNode.getOutputNode !== "function")
    throw new Error("wave graph output builder missing");
  const object = new Mesh(new BufferGeometry(), new MeshBasicNodeMaterial());
  const renderer = { getMRT: () => null } as unknown as ConstructorParameters<
    typeof WGSLNodeBuilder
  >[1];
  const builder = new WGSLNodeBuilder(object, renderer) as unknown as {
    setBuildStage: (stage: "setup") => void;
    shaderStage: "vertex" | null;
  };
  builder.shaderStage = "vertex";
  builder.setBuildStage("setup");
  return requireNode(graphNode.getOutputNode(builder), "wave graph output");
}

function displacementHeight(value: NumericValue): number {
  if (!Array.isArray(value) || value.length < 2 || typeof value[1] !== "number")
    throw new Error("wave graph did not return a numeric position vector");
  return value[1];
}

describe("WaveField", () => {
  it("matches CPU samples to numerically evaluated TSL displacement across 64 points and 8 times", () => {
    const field = new WaveField(options);
    const graph = field.displacementNode();
    const graphRoot = expandTslGraph(graph);
    const points = Array.from({ length: 64 }, (_, index) => {
      const column = index % 8;
      const row = Math.floor(index / 8);
      return [(column - 3.5) * 17.25 + row * 0.61, (row - 3.5) * 14.75 - column * 0.43] as const;
    });

    for (const time of [0, 0.17, 1.5, 9.25, 31.75, 64, 128.5, 240]) {
      field.setTime(time);
      for (const [x, z] of points) {
        const expected = field.sample(x, z, time).height;
        const actual = displacementHeight(evaluateTslGraph(graphRoot, [x, 0, z]));
        expect(actual).toBeCloseTo(expected, 4);
      }
    }
  });

  it("contracts the graph's displacement structure and packed wave parameters", () => {
    const field = new WaveField(options);
    const graph = field.displacementNode();
    const source = graphShaderSource(graph);
    const firstWave = options.waves[0];
    if (firstWave === undefined) throw new Error("test wave missing");

    expect(field.parameters[2]).toBeCloseTo(firstWave.amplitude, 5);
    expect(source).toMatch(/parameters\[offset\s*\+\s*2\]/u);
    expect(source).toMatch(/parameters\[offset\s*\+\s*3\]/u);
    expect(source).toMatch(/parameters\[offset\s*\+\s*6\]/u);
    expect(source).toMatch(/height\.addAssign\([^;]*phase[^;]*\.mul\(amplitude\)\)/u);
    expect(source).toMatch(/positionLocal\.add\([^;]*height[^;]*\)/u);
  });

  it("uses steepness alongside amplitude in both sampled and graph displacement", () => {
    const base = new WaveField({
      waves: [{ amplitude: 0.4, direction: [1, 0], wavelength: 4, speed: 0 }],
    });
    const steep = new WaveField({
      waves: [{ amplitude: 0.4, direction: [1, 0], wavelength: 4, speed: 0, steepness: 0.5 }],
    });
    const baseHeight = base.sample(1, 0, 0).height;
    const steepHeight = steep.sample(1, 0, 0).height;
    expect(steepHeight - baseHeight).toBeCloseTo(0.5 / (Math.PI / 2), 4);
    expect(graphShaderSource(steep.displacementNode())).toMatch(/parameters\[offset\s*\+\s*6\]/u);
  });

  it("returns a flat upward sample for zero waves and rejects malformed entries", () => {
    const flat = new WaveField({ waves: [] });
    const sample = flat.sample(3, -4, 2);
    expect(sample.height).toBe(0);
    expect(sample.normal.toArray()).toEqual([0, 1, 0]);
    expect(
      () =>
        new WaveField({ waves: [{ amplitude: 1, wavelength: 0, direction: [1, 0], speed: 1 }] }),
    ).toThrow(/wavelength/i);
  });
});
