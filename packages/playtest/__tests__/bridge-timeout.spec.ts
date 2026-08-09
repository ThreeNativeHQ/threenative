import { describe, expect, it } from "vitest";

import { PlaywrightTransport } from "../src/runner/bridgeClient.js";

describe("PlaywrightTransport", () => {
  it("uses the runner timeout for bridge operations", async () => {
    const page = {
      evaluate: () => new Promise(() => {}),
    };
    const transport = new PlaywrightTransport(page as never, 5);

    await expect(transport.call("advance", 1)).rejects.toThrow(
      "Bridge operation 'advance' exceeded 5ms.",
    );
  });
});
