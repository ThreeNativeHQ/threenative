import { Mesh, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import type { ICtx } from "../src/scene.js";

describe("ICtx.add", () => {
  it("should hand back the type it was given, so a typed node needs no cast", () => {
    // A game writes `const sea = ctx.add(new SpectralOcean(...))` and then calls
    // `sea.sampleHeight(...)`. When `add` erases the type to Object3D, every typed node in every
    // scene needs a cast back to what it already was, and the cast is where a game stops noticing
    // that it is holding the wrong thing.
    const add = ((object: Object3D) => object) as ICtx["add"];
    const mesh = new Mesh();
    const returned: Mesh = add(mesh);
    expect(returned).toBe(mesh);
  });
});
