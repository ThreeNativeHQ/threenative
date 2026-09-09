#!/usr/bin/env node
import { build, buildHelp, parseBuildArgs } from "./build.js";
import { type PublicCommand, commandSummaries, threenativeCommands } from "./commands.js";
import { diagnoseProject, formatDoctorReport, readProject } from "./doctor.js";

export function cliHelp(command?: PublicCommand): string {
  if (command === "build") return buildHelp();
  if (command === "doctor") {
    return `${[
      "Usage: threenative doctor [--text] [--capture <path>]",
      "",
      "Checks this project against what the build and the native host assume about it:",
      "installed and version-matched @threenative packages, a portable entry that",
      "default-exports a game, a web entry, a scenario that can prove it, and the",
      "capability search an authoring agent needs.",
      "",
      "Prints JSON by default; --text prints the same report for a person.",
      "--capture forwards a browser census JSON or native TN_PIPELINE_EVENT log to the playtest doctor.",
      "Exits 0 when nothing failed, 1 when a check failed.",
    ].join("\n")}\n`;
  }
  return `${[
    "Usage: threenative <command> [options]",
    "",
    "Commands:",
    ...threenativeCommands.map((command) => `  ${command.padEnd(6)}  ${commandSummaries[command]}`),
    "",
    "Run 'threenative <command> --help' for command-specific help.",
  ].join("\n")}\n`;
}

function helpFor(argv: readonly string[]): string {
  const command = argv[0];
  if (command === undefined || command.startsWith("-")) return cliHelp();
  if (command === "build") return cliHelp("build");
  if (command === "doctor") return cliHelp("doctor");
  throw new Error(`Unknown threenative command '${command}'.\n${cliHelp()}`);
}

export async function runDoctorCommand(
  argv: readonly string[],
  cwd = process.cwd(),
): Promise<number> {
  let capturePath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--text") continue;
    if (flag === "--capture") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new Error("doctor: '--capture' requires a value.");
      capturePath = value;
      index += 1;
      continue;
    }
    throw new Error(`doctor: unknown option '${String(flag)}'.`);
  }
  const report = diagnoseProject(await readProject(cwd), { capturePath });
  process.stdout.write(
    argv.includes("--text") ? formatDoctorReport(report) : `${JSON.stringify(report, null, 2)}\n`,
  );
  return report.pass ? 0 : 1;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(helpFor(argv));
    return;
  }
  if (argv[0] === "doctor") {
    process.exitCode = await runDoctorCommand(argv.slice(1));
    return;
  }
  await build(parseBuildArgs(argv));
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
