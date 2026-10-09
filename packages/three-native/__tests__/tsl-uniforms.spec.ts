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

  it("gives uniformArray elements as live uniforms that follow in-place edits", () => {
    const written: number[][] = [];
    const live = liveUniforms(
      () => ({}),
      (_node, lanes) => written.push([...lanes]),
    );
    const wake = { x: 5, y: 6, z: 7, w: 8 };
    const ships = [{ x: 1, y: 2, z: 3, w: 4 }, wake];
    const array = live.uniformArray(ships);
    const second = array.element(1) as { value: unknown };
    expect(second.value).toBe(wake);
    wake.x = 50;
    live.sync();
    expect(written).toContainEqual([50, 6, 7, 8]);
    expect(() => array.element(2)).toThrow("TN_TSL_UNIFORM_ARRAY_INDEX");
    expect(() => array.element({})).toThrow("TN_TSL_UNIFORM_ARRAY_INDEX");
  });
});
