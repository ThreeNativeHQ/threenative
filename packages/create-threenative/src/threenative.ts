#!/usr/bin/env node
import { build, parseBuildArgs } from "./build.js";

async function main(): Promise<void> {
  await build(parseBuildArgs(process.argv.slice(2)));
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
