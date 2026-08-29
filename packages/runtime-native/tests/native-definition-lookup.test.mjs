import { describe, expect, it } from "vitest";

import { nativeDefinition } from "../../../test-support/native-definition.js";

// Phase 5's whole point: an assertion must survive the file moving and still red on the behaviour.
// Locating a definition by symbol instead of by path is what makes both controls possible.
describe("native definition lookup", () => {
  it("finds a definition wherever the file lives", () => {
    const found = nativeDefinition("replayPackedFrameOpStream");
    expect(found.text).toMatch(/replayPackedFrameOpStream/u);
    expect(found.path).toMatch(/\.(?:cpp|h)$/u);
  });

  // Fail closed. The old path-coupled assertion sliced from indexOf() === -1, produced an empty
  // string, and passed vacuously - it slept through exactly the split PRD-230 performs.
  it("throws instead of returning nothing when the symbol is gone", () => {
    expect(() => nativeDefinition("tnSymbolThatDoesNotExistAnywhere")).toThrow(
      /no definition found/iu,
    );
  });

  it("throws when a symbol is defined in more than one place", () => {
    expect(() =>
      nativeDefinition("replayPackedFrameOpStream", {
        readFiles: () => [
          { path: "a.cpp", text: "bool replayPackedFrameOpStream(int) { return true; }" },
          { path: "b.cpp", text: "bool replayPackedFrameOpStream(int) { return false; }" },
        ],
      }),
    ).toThrow(/more than one/iu);
  });
});
