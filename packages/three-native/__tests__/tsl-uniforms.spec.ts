import { describe, expect, it } from "vitest";
import { liveUniforms } from "../src/tsl-uniforms.js";

describe("liveUniforms", () => {
  it("runs onRenderUpdate on each sync and takes a returned value as the uniform's", () => {
    const written: number[][] = [];
    const live = liveUniforms(
      () => ({}),
      (_node, lanes) => written.push([...lanes]),
    );
    const node = live.uniform(1) as {
      value: number;
      onRenderUpdate(callback: () => unknown): object;
    };
    let calls = 0;
    expect(node.onRenderUpdate(() => (++calls === 1 ? 5 : undefined))).toBe(node);
    live.sync();
    expect(node.value).toBe(5);
    expect(written).toEqual([[5]]);
    live.sync();
    expect(calls).toBe(2);
    expect(node.value).toBe(5);
    expect(written).toEqual([[5]]);
  });
});
