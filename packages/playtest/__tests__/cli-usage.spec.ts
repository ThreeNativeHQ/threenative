import { expect, test } from "vitest";

import { main } from "../src/runner/cli.js";
import { formatUsage, PLAYTEST_FLAGS } from "../src/runner/config.js";

test("--help exits 0 and documents every validated flag", async () => {
  const output: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  let exitCode: number;
  try {
    exitCode = await main(["--help"]);
  } finally {
    process.stdout.write = originalWrite;
  }
  const stdout = output.join("");

  expect(exitCode).toBe(0);
  expect(stdout).toContain("init");
  expect(stdout).toContain("Exit codes:");
  for (const [flag, details] of Object.entries(PLAYTEST_FLAGS)) {
    expect(stdout).toContain(flag);
    expect(stdout).toContain(`default: ${details.default}`);
  }
  expect(stdout).toBe(formatUsage());
});
