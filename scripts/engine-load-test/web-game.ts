// Both browser JS and Perry consume this exact source after the same esbuild pass.
import {
  cameraPose,
  cubeBobY,
  cubeRotationX,
  cubeRotationY,
} from "../../examples/engine-load-test/src/workload.js";

declare function tn_inputs(): number[];
declare function tn_submit(values: number[]): void;
declare function tn_ready(update: (frame: number) => void): void;

const base = tn_inputs(); // x/y/z in object order, authored by createPlacements
const count = base.length / 3;
const values: number[] = [];
function update(frame: number) {
  const pose = cameraPose(frame, count);
  values[0] = pose.x;
  values[1] = pose.y;
  values[2] = pose.z;
  values[3] = pose.targetX;
  values[4] = pose.targetY;
  values[5] = pose.targetZ;
  for (let index = 0; index < count; index++) {
    const offset = 6 + index * 5;
    values[offset] = base[index * 3] as number;
    values[offset + 1] = cubeBobY(index, frame, base[index * 3 + 1] as number);
    values[offset + 2] = base[index * 3 + 2] as number;
    values[offset + 3] = cubeRotationX(index, frame);
    values[offset + 4] = cubeRotationY(index, frame);
  }
  tn_submit(values);
}
tn_ready(update);
