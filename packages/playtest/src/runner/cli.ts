#!/usr/bin/env node
import { parseStandalonePlaytestArgs } from "./config.js";
import { initStandalonePlaytest } from "./init.js";
import { runStandalonePlaytest } from "./runner.js";

try {
  if (process.argv[2] === "init") {
    const result = await initStandalonePlaytest(process.cwd());
    process.stdout.write(`${JSON.stringify({ ...result, pass: true }, null, 2)}\n`);
    process.exit(0);
  }
  const config = parseStandalonePlaytestArgs(process.argv.slice(2));
  const report = await runStandalonePlaytest(config);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.pass ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    diagnostics: [{
      code: "TN_PLAYTEST_RUNNER_FAILED",
      fix: { instruction: "Check the scenario, URL, browser installation, and managed-server output." },
      message: error instanceof Error ? error.message : String(error),
      severity: "error",
    }],
    pass: false,
  }, null, 2)}\n`);
  process.exitCode = 2;
}
