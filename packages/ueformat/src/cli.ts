#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { UEFormatError } from "./errors.js";
import { parseUEModel } from "./parser.js";
import { summarizeUEModel } from "./summary.js";

function usage(): string {
  return [
    "Usage: ueformat-inspect [--json] <file.uemodel>",
    "",
    "Validates a UEFormat v10 model and prints a compact summary.",
    "ZSTD files require using the JavaScript API with an injected decoder.",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const json = args.includes("--json");
  const path = args.find((argument) => !argument.startsWith("-"));
  if (!path) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  try {
    const bytes = await readFile(path);
    const summary = summarizeUEModel(parseUEModel(bytes));
    process.stdout.write(`${JSON.stringify(summary, null, json ? 0 : 2)}\n`);
  } catch (error) {
    if (error instanceof UEFormatError) {
      process.stderr.write(
        `${error.code}: ${error.message}${error.offset >= 0 ? ` (offset ${error.offset})` : ""}\n`,
      );
    } else {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exitCode = 1;
  }
}

await main();
