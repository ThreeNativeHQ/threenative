import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../src/runtime-scripts/batched-pass-encoder.js", import.meta.url)),
  "utf8",
);

function install(pass) {
  const createInstaller = new Function(`return (${source.trim().replace(/;$/u, "")});`);
  return createInstaller()((ops) => pass.__tnReplayEnd(ops))(pass);
}

function passWithReplay(replay) {
  return {
    __tnReplayEnd: replay,
    setPipeline() {},
    setBindGroup() {},
    setVertexBuffer() {},
    setIndexBuffer() {},
    draw() {},
    drawIndexed() {},
    setViewport() {},
    setScissorRect() {},
    setStencilReference() {},
    setBlendConstant() {},
  };
}

test("a reused pass replays only its current batched command stream", () => {
  const streams = [];
  const pass = passWithReplay((ops) => streams.push([...ops.subarray(0, ops[0])]));
  assert.equal(install(pass), true);

  pass.setPipeline({ _pipelineId: 9 });
  pass.draw(5);
  pass.end();

  pass.setPipeline({ _pipelineId: 17 });
  pass.draw(6);
  pass.end();

  assert.deepEqual(streams, [
    [9, 1, 9, 5, 5, 1, 0, 0, 0],
    [9, 1, 17, 5, 6, 1, 0, 0, 0],
  ]);
});

test("a replay exception resets a reused pass before its next stream", () => {
  const streams = [];
  let throwOnReplay = true;
  const pass = passWithReplay((ops) => {
    streams.push([...ops.subarray(0, ops[0])]);
    if (throwOnReplay) throw new Error("replay failed");
  });
  assert.equal(install(pass), true);

  pass.setPipeline({ _pipelineId: 9 });
  pass.draw(5);
  assert.throws(() => pass.end(), /replay failed/u);

  throwOnReplay = false;
  pass.setPipeline({ _pipelineId: 17 });
  pass.draw(6);
  pass.end();

  assert.deepEqual(streams, [
    [9, 1, 9, 5, 5, 1, 0, 0, 0],
    [9, 1, 17, 5, 6, 1, 0, 0, 0],
  ]);
});
