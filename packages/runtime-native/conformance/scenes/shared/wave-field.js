import * as THREE from "three/webgpu";
import { color, vec3 } from "three/tsl";
import { WaveField } from "../../../../core/src/wave-field.ts";
import { assertCondition, startVisualScene } from "./scene-support.js";

const FIELD_OPTIONS = {
  waves: [
    {
      amplitude: 0.32,
      direction: [1, 0],
      wavelength: 5.5,
      speed: 0.75,
      phase: 0.2,
      steepness: 0.18,
    },
    { amplitude: 0.11, direction: [0.35, 1], wavelength: 2.3, speed: -0.4, phase: -0.7 },
  ],
  domainWarp: [
    {
      direction: [0.8, 0.6],
      displacement: [0.12, -0.06],
      wavelength: 12,
      speed: 0.2,
      phase: 0.4,
    },
  ],
};

function graphShaderSource(node) {
  const shaderNode = node?.node?.shaderNode;
  assertCondition(typeof shaderNode?.jsFunc === "function", "wave field graph shader function missing.");
  return String(shaderNode.jsFunc);
}

export function assertWaveFieldProof(field, sample, node) {
  assertCondition(node?.isNode === true, "wave field proof requires a TSL displacement node.");
  const source = graphShaderSource(node);
  assertCondition(/parameters\[offset\s*\+\s*2\]/u.test(source), "wave graph must read amplitude.");
  assertCondition(/parameters\[offset\s*\+\s*3\]/u.test(source), "wave graph must read wave number.");
  assertCondition(/parameters\[offset\s*\+\s*6\]/u.test(source), "wave graph must read steepness.");
  assertCondition(
    /height\.addAssign\([^;]*phase[^;]*\.mul\(amplitude\)\)/u.test(source),
    "wave graph must add its computed displacement",
  );
  assertCondition(Number.isFinite(sample?.height), "wave field proof requires a finite CPU height.");
  assertCondition(sample?.normal?.y > 0, "wave field proof requires an upward-facing normal.");
  assertCondition(field?.parameters?.length > 0, "wave field proof requires packed parameters.");
}

export async function startScene(canvas, dimensions) {
  return startVisualScene(
    canvas,
    dimensions,
    "wave-field",
    ({ scene, camera }) => {
      const field = new WaveField(FIELD_OPTIONS);
      field.setTime(3.25);
      const node = field.displacementNode();
      const sample = field.sample(0.25, -0.4, 3.25);
      assertWaveFieldProof(field, sample, node);

      const surfaceMaterial = new THREE.MeshBasicNodeMaterial();
      surfaceMaterial.positionNode = node;
      surfaceMaterial.colorNode = color(0x167aa5).add(vec3(0.05, 0.08, 0.12));
      const geometry = new THREE.PlaneGeometry(12, 12, 64, 64);
      geometry.rotateX(-Math.PI / 2);
      const surface = new THREE.Mesh(geometry, surfaceMaterial);
      scene.add(surface);
      camera.position.set(0, 4.5, 7.5);
      camera.lookAt(0, 0, 0);
      return {
        surface,
        detail: {
          normalY: Number(sample.normal.y.toFixed(6)),
          parameterFloats: field.parameters.length,
          cpuHeight: Number(sample.height.toFixed(6)),
          graphDisplacement: "wave-amplitude+steepness",
          tslDisplacement: true,
        },
      };
    },
    {
      background: 0x061b2b,
      camera: (size) => new THREE.PerspectiveCamera(52, size.width / size.height, 0.1, 100),
    },
  );
}
