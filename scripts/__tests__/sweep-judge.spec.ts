import { readFileSync, writeFileSync } from "node:fs";
import { makeTempDirSync } from "../../test-support/temp-dir.js";

import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { createImageBlindBundle } from "../score-blind.js";
import { runJudge } from "../sweep-judge.js";

function frame(): Buffer {
  const png = new PNG({ height: 8, width: 8 });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const pixel = offset / 4;
    png.data[offset] = 80 + (pixel % 8) * 20;
    png.data[offset + 1] = 100 + Math.floor(pixel / 8) * 15;
    png.data[offset + 2] = 180;
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}

function bundleRoot(): { bundle: string; critic: string; root: string } {
  const root = makeTempDirSync("sweep-judge-");
  const bundle = join(root, "bundle");
  const critic = join(root, "critic.json");
  createImageBlindBundle(
    "prompt-hash",
    [
      { arm: "framework", content: frame(), id: "framework-1" },
      { arm: "vanilla", content: frame(), id: "vanilla-1" },
    ],
    bundle,
    join(root, "reveal.json"),
  );
  return { bundle, critic, root };
}

function writeCritic(path: string, secondGap = "More environmental detail."): void {
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        comparisonVerdict: {
          betterSample: "sample-02",
          confidence: "medium",
          rationale: "The second sample communicates the goal more clearly.",
        },
        samples: [
          {
            biggestGap: "The player is small.",
            evidence: "The scene is visible and readable.",
            label: "sample-01",
            playability: 3,
            screenshotWorthy: "yes",
            visuals: 3,
          },
          {
            biggestGap: secondGap,
            evidence: "The world has a visible objective.",
            label: "sample-02",
            playability: 4,
            screenshotWorthy: "yes",
            visuals: 4,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

describe("sweep judge", () => {
  it("rechecks a blind bundle and writes a structurally valid judge", () => {
    const { bundle, critic } = bundleRoot();
    writeCritic(critic);

    const result = runJudge(bundle, critic);

    expect(result.verdict).toBe("ready");
    expect(JSON.parse(readFileSync(join(bundle, "judge.json"), "utf8"))).toEqual(result);
    expect(readFileSync(join(bundle, "judge.json"), "utf8")).not.toMatch(/framework|vanilla/i);
  });

  it("rejects missing or duplicate sample scores", () => {
    const { bundle, critic } = bundleRoot();
    writeCritic(critic);
    const input = JSON.parse(readFileSync(critic, "utf8")) as { samples: unknown[] };
    input.samples.pop();
    writeFileSync(critic, JSON.stringify(input));

    expect(() => runJudge(bundle, critic)).toThrow(/do not match/);
  });

  it("rejects critic input that leaks an arm identifier", () => {
    const { bundle, critic } = bundleRoot();
    writeCritic(critic, "The framework frame is empty.");

    expect(() => runJudge(bundle, critic)).toThrow(/TN_JUDGE_VOID/);
  });
});
