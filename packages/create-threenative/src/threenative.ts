#!/usr/bin/env node
import { build, buildHelp, parseBuildArgs } from "./build.js";

type PublicCommand = "build";

export function cliHelp(command?: PublicCommand): string {
  if (command === "build") return buildHelp();
  return `${[
    "Usage: threenative build [options]",
    "",
    "Commands:",
    "  build  Build web or native output.",
    "",
    "Run 'threenative build --help' for command-specific help.",
  ].join("\n")}\n`;
}

function helpFor(argv: readonly string[]): string {
  const command = argv[0];
  if (command === undefined || command.startsWith("-")) return cliHelp();
  if (command === "build") return cliHelp("build");
  throw new Error(`Unknown threenative command '${command}'.\n${cliHelp()}`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(helpFor(argv));
    return;
  }
  await build(parseBuildArgs(argv));
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
