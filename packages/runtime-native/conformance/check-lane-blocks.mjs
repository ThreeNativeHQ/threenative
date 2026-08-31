/**
 * Decide whether a conformance lane's report is acceptable for the machine that produced it.
 *
 * `run-conformance.mjs` exits 2 whenever any row is blocked, which is the right default: a lane
 * that could not run every row has not proven the target. A GitHub-hosted runner, though, exposes
 * SwiftShader, and every `requiresHardwareAdapter` row refuses to start there. Those rows pass on a
 * real adapter, so the lane must claim neither that they failed nor that they passed.
 *
 * This gate keeps the distinction honest: any failure is fatal, and any blocked row that is not
 * explained by a software adapter or an unimplemented registry entry is fatal too. A row that
 * breaks for a new reason cannot hide inside the allowance.
 *
 * Usage: node check-lane-blocks.mjs <report.json|report-directory> [label]
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { unexpectedBlockedRows } from "./run-conformance.mjs";

const conformanceRoot = dirname(fileURLToPath(import.meta.url));

function reportPath(target) {
  const resolved = resolve(target);
  if (!existsSync(resolved)) throw new Error(`conformance report is missing: ${resolved}`);
  return resolved.endsWith(".json") ? resolved : join(resolved, "report.json");
}

function main(argv) {
  const target = argv[0];
  if (target === undefined) throw new Error("usage: check-lane-blocks.mjs <report> [label]");
  const label = argv[1] ?? "lane";
  const path = reportPath(target);
  if (!existsSync(path)) throw new Error(`conformance report is missing: ${path}`);
  const report = JSON.parse(readFileSync(path, "utf8"));
  const registry = JSON.parse(readFileSync(join(conformanceRoot, "registry.json"), "utf8"));

  const failures = [];
  if (report.summary.fail > 0) failures.push(`${report.summary.fail} row(s) failed`);
  const unexpected = unexpectedBlockedRows(report, registry);
  for (const { id, reason } of unexpected) failures.push(`${id} blocked: ${reason}`);

  const allowed = report.summary.blocked - unexpected.length;
  process.stdout.write(
    `${label}: ${report.summary.pass} passed, ${report.summary.fail} failed, ` +
      `${allowed} blocked by this machine's capabilities, ${unexpected.length} unexpectedly blocked\n`,
  );
  if (failures.length > 0) {
    process.stderr.write(`TN_CONFORMANCE_LANE_UNACCEPTABLE:\n- ${failures.join("\n- ")}\n`);
    process.exitCode = 1;
  }
}

main(process.argv.slice(2));
