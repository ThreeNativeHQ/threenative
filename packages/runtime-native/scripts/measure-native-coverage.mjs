#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildNativeTarget,
  desktopBuildDirectory,
  desktopPreset,
  nativeTestExecutable,
  resolveCmake,
  run,
  runtimeRoot,
} from "./native-test-lane.mjs";
import {
  discoverNativeTestTargets,
  executionContracts,
  validateExecutionContracts,
} from "./verify-native-contracts.mjs";

const profileDirectory = join(desktopBuildDirectory("coverage"), "coverage-profiles");
const defaultRecord = resolve(
  runtimeRoot,
  "..",
  "..",
  "docs",
  "verification",
  "native-coverage-2026-08-28.md",
);
const coverageProfileEnvironmentVariable = "LLVM_PROFILE_FILE";
const generatedRecordStart = "<!-- native-coverage-generated:start -->";
const generatedRecordEnd = "<!-- native-coverage-generated:end -->";
const sourceExtensions = new Set([".c", ".cc", ".cpp", ".cxx", ".m", ".mm"]);
const configurationBlockers = new Map([
  [
    "threenative-physics-actuation-bindings-test",
    "TN_ENABLE_NATIVE_PHYSICS=OFF: native physics bindings are not linked",
  ],
  [
    "threenative-video-recorder-state-test",
    "TN_ENABLE_VIDEO=OFF: the video recorder target is not configured",
  ],
]);

function percentage(covered, lines) {
  return lines === 0 ? 0 : Number(((covered / lines) * 100).toFixed(2));
}

function subsystem(path) {
  const rest = path.replace(/^src\//u, "");
  return rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : rest;
}

export function requireCoverageProfile(path, fileExists = existsSync) {
  if (!fileExists(path)) {
    throw new Error(`coverage profile data is missing: ${path}`);
  }
  return path;
}

export function coverageConfigurationBlocker(target) {
  return configurationBlockers.get(target);
}

export function summarizeNativeCoverage({
  blockedTargets,
  compiledSourceFiles,
  configuration,
  instrumentedFiles,
  sourceFiles,
}) {
  if (!Array.isArray(instrumentedFiles) || instrumentedFiles.length === 0) {
    throw new Error("native coverage contained zero instrumented source files");
  }
  if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) {
    throw new Error("native source inventory is empty");
  }
  if (!Array.isArray(compiledSourceFiles) || compiledSourceFiles.length === 0) {
    throw new Error("native compile_commands inventory is empty");
  }
  const compiledSourceSet = new Set(compiledSourceFiles);
  const compiled = instrumentedFiles
    .filter(({ path }) => compiledSourceSet.has(path))
    .map(({ covered, lines, path }) => ({
      covered,
      lines,
      path,
      percent: percentage(covered, lines),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (compiled.length === 0) {
    throw new Error("native coverage matched zero files under packages/runtime-native/src");
  }
  const measuredSet = new Set(compiled.map(({ path }) => path));
  const missingMeasurements = compiledSourceFiles.filter((path) => !measuredSet.has(path)).sort();
  if (missingMeasurements.length > 0) {
    throw new Error(`llvm-cov omitted compiled source files: ${missingMeasurements.join(", ")}`);
  }
  const notCompiled = sourceFiles.filter((path) => !compiledSourceSet.has(path)).sort();
  const grouped = new Map();
  for (const file of compiled) {
    const name = subsystem(file.path);
    const current = grouped.get(name) ?? { covered: 0, lines: 0, name };
    current.covered += file.covered;
    current.lines += file.lines;
    grouped.set(name, current);
  }
  const subsystems = [...grouped.values()]
    .map((entry) => ({ ...entry, percent: percentage(entry.covered, entry.lines) }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const totals = compiled.reduce(
    (total, file) => ({ covered: total.covered + file.covered, lines: total.lines + file.lines }),
    { covered: 0, lines: 0 },
  );
  return {
    blockedTargets: [...blockedTargets].sort((left, right) =>
      left.target.localeCompare(right.target),
    ),
    compiled,
    configuration,
    notCompiled,
    subsystems,
    total: { ...totals, percent: percentage(totals.covered, totals.lines) },
  };
}

function sourceInventory(directory = join(runtimeRoot, "src")) {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
        files.push(relative(runtimeRoot, path).split(sep).join("/"));
      }
    }
  };
  visit(directory);
  return files.sort();
}

function lcovSourcePath(line) {
  const absolute = resolve(line.slice(3));
  const candidate = relative(runtimeRoot, absolute).split(sep).join("/");
  return candidate.startsWith("../") || !candidate.startsWith("src/") ? undefined : candidate;
}

function addLcovDataLine(byPath, path, line) {
  const [lineNumberText, countText] = line.slice(3).split(",");
  const lineNumber = Number(lineNumberText);
  const count = Number(countText);
  if (!Number.isSafeInteger(lineNumber) || lineNumber <= 0 || !Number.isFinite(count)) {
    throw new Error(`malformed llvm-cov LCOV line: ${line}`);
  }
  const lines = byPath.get(path) ?? new Map();
  lines.set(lineNumber, (lines.get(lineNumber) ?? 0) + count);
  byPath.set(path, lines);
}

function addLcovReport(byPath, report) {
  let path;
  for (const line of report.split("\n")) {
    if (line.startsWith("SF:")) path = lcovSourcePath(line);
    else if (line === "end_of_record") path = undefined;
    else if (line.startsWith("DA:") && path !== undefined) addLcovDataLine(byPath, path, line);
  }
}

export function instrumentedFilesFromLcov(reports) {
  const byPath = new Map();
  for (const report of reports) addLcovReport(byPath, report);
  return [...byPath.entries()].map(([path, lineCounts]) => ({
    covered: [...lineCounts.values()].filter((count) => count > 0).length,
    lines: lineCounts.size,
    path,
  }));
}

function compiledProductObjects(buildDirectory) {
  const commandsPath = join(buildDirectory, "compile_commands.json");
  if (!existsSync(commandsPath)) {
    throw new Error(`native coverage compile inventory is missing: ${commandsPath}`);
  }
  const commands = JSON.parse(readFileSync(commandsPath, "utf8"));
  if (!Array.isArray(commands)) throw new Error(`${commandsPath} is not a JSON array`);
  const bySource = new Map();
  for (const command of commands) {
    if (typeof command?.file !== "string" || typeof command?.output !== "string") continue;
    const source = relative(runtimeRoot, resolve(command.file)).split(sep).join("/");
    if (source.startsWith("../") || !source.startsWith("src/")) continue;
    const object = resolve(command.directory, command.output);
    if (!existsSync(object)) throw new Error(`compiled coverage object is missing: ${object}`);
    if (!bySource.has(source)) bySource.set(source, object);
  }
  if (bySource.size === 0) throw new Error("compile_commands contains zero native product objects");
  return {
    entries: [...bySource.entries()].map(([source, object]) => ({ object, source })),
    sourceFiles: [...bySource.keys()].sort(),
  };
}

function renderMarkdown(report, executedTargets) {
  const rows = report.subsystems
    .map(
      ({ covered, lines, name, percent }) =>
        `| \`src/${name}${name.includes(".") ? "" : "/"}\` | ${lines} | ${covered} | ${percent.toFixed(2)}% |`,
    )
    .join("\n");
  const notCompiled =
    report.notCompiled.length === 0
      ? "- None."
      : report.notCompiled.map((path) => `- \`${path}\``).join("\n");
  const blocked =
    report.blockedTargets.length === 0
      ? "- None."
      : report.blockedTargets.map(({ reason, target }) => `- \`${target}\`: ${reason}`).join("\n");
  return `${generatedRecordStart}
# Native coverage — 2026-08-28

Configuration: \`${report.configuration}\` with clang source-based coverage. Executed
${executedTargets.length} native contract targets; ${report.blockedTargets.length} configured
targets could not be built and are named below.

| Subsystem | Instrumented lines | Covered | Line coverage |
| --- | ---: | ---: | ---: |
${rows}
| **TOTAL** | **${report.total.lines}** | **${report.total.covered}** | **${report.total.percent.toFixed(2)}%** |

## Not compiled in this configuration

${notCompiled}

## Blocked targets

${blocked}
${generatedRecordEnd}
`;
}

function writeCoverageRecord(recordPath, generatedRecord) {
  let contents = generatedRecord;
  if (existsSync(recordPath)) {
    const previous = readFileSync(recordPath, "utf8");
    const start = previous.indexOf(generatedRecordStart);
    const end = previous.indexOf(generatedRecordEnd);
    if (start !== -1 && end > start) {
      contents = `${previous.slice(0, start)}${generatedRecord}${previous.slice(end + generatedRecordEnd.length).replace(/^\n/u, "")}`;
    }
  }
  writeFileSync(recordPath, contents);
}

function compactFailure(error) {
  return String(error?.message ?? error)
    .split("\n")
    .filter(Boolean)
    .slice(-6)
    .join(" ");
}

function runForStdout(command, args) {
  const result = spawnSync(command, args, {
    cwd: runtimeRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status}:\n${result.stderr ?? ""}`);
  }
  if (result.stderr?.trim()) {
    throw new Error(`${command} emitted a coverage warning:\n${result.stderr.trim()}`);
  }
  return result.stdout;
}

export function requireInvocationProfiles(expectedPrefixes, profileNames) {
  const missing = expectedPrefixes.filter(
    (prefix) => !profileNames.some((name) => name.startsWith(prefix) && name.endsWith(".profraw")),
  );
  if (missing.length > 0) {
    throw new Error(`native coverage invocation profiles are missing: ${missing.join(", ")}`);
  }
}

function coverageExports({ buildDirectory, compiledProducts, executedTargets, profileNames }) {
  const commonArguments = [
    "--format=lcov",
    "--fatal-warnings",
    "-ignore-filename-regex=(third_party|\\.runtime|/usr/|/opt/|sdl3-build)",
  ];
  const reports = [];
  const zeroLineSources = [];
  for (const { object, source } of compiledProducts.entries) {
    const report = runForStdout("llvm-cov", [
      "export",
      "--empty-profile",
      object,
      ...commonArguments,
    ]);
    reports.push(report);
    const files = instrumentedFilesFromLcov([report]);
    if (!files.some(({ path }) => path === source)) zeroLineSources.push(source);
  }
  for (const target of executedTargets) {
    const targetProfiles = profileNames
      .filter((name) => name.startsWith(`${target}-`))
      .map((name) => join(profileDirectory, name));
    if (targetProfiles.length === 0) {
      throw new Error(`native coverage target profile is missing: ${target}`);
    }
    const targetProfile = join(profileDirectory, `${target}.profdata`);
    run("llvm-profdata", ["merge", "-sparse", ...targetProfiles, "-o", targetProfile]);
    requireCoverageProfile(targetProfile);
    reports.push(
      runForStdout("llvm-cov", [
        "export",
        nativeTestExecutable(buildDirectory, target),
        ...commonArguments,
        `-instr-profile=${targetProfile}`,
      ]),
    );
  }
  return { reports, zeroLineSources };
}

function ctestRegistrations(buildDirectory, ctest) {
  const inventory = JSON.parse(
    runForStdout(ctest, ["--test-dir", buildDirectory, "--show-only=json-v1"]),
  );
  const names = inventory?.tests?.map(({ name }) => name);
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error("CTest registered zero native contract tests");
  }
  return names;
}

function resolveCtest(cmake) {
  if (cmake === "cmake") return "ctest";
  return join(dirname(cmake), process.platform === "win32" ? "ctest.exe" : "ctest");
}

export function runNativeCtest() {
  const cmake = resolveCmake();
  const ctest = resolveCtest(cmake);
  const buildDirectory = desktopBuildDirectory();
  const cmakeSource = readFileSync(join(runtimeRoot, "CMakeLists.txt"), "utf8");
  const targets = discoverNativeTestTargets(cmakeSource);
  buildNativeTarget(cmake, buildDirectory, "threenative-native-tests", 1_800_000);
  const registrations = ctestRegistrations(buildDirectory, ctest);
  for (const target of targets) {
    if (!registrations.includes(target)) throw new Error(`CTest omitted native target: ${target}`);
  }
  const output = run(ctest, ["--test-dir", buildDirectory, "--output-on-failure"], {
    timeout: 900_000,
  });
  console.info(output);
  return targets;
}

function registrationsForTarget(registrations, target) {
  return registrations.filter((name) => name === target || name.startsWith(`${target}-`)).sort();
}

function runCoverageTargets({ buildDirectory, cmake, ctest, registrations, targets }) {
  const blockedTargets = [];
  const executedTargets = [];
  const executionFailures = [];
  const expectedProfilePrefixes = [];
  for (const target of targets) {
    const configurationBlocker = coverageConfigurationBlocker(target);
    if (configurationBlocker !== undefined) {
      blockedTargets.push({ reason: configurationBlocker, target });
      continue;
    }
    try {
      buildNativeTarget(cmake, buildDirectory, target, 1_800_000);
    } catch (error) {
      executionFailures.push({ reason: `build failed: ${compactFailure(error)}`, target });
      continue;
    }
    let targetPassed = true;
    const testNames = registrationsForTarget(registrations, target);
    if (testNames.length !== executionContracts[target].invocations.length) {
      executionFailures.push({
        reason: `CTest registered ${testNames.length} invocation(s), expected ${executionContracts[target].invocations.length}`,
        target,
      });
      continue;
    }
    for (const [index, testName] of testNames.entries()) {
      try {
        const env = { ...process.env };
        const profilePrefix = `${target}-${index}-`;
        expectedProfilePrefixes.push(profilePrefix);
        env[coverageProfileEnvironmentVariable] = join(
          profileDirectory,
          `${profilePrefix}%p.profraw`,
        );
        run(ctest, ["--test-dir", buildDirectory, "--output-on-failure", "-R", `^${testName}$`], {
          env,
          timeout: 120_000,
        });
      } catch (error) {
        targetPassed = false;
        executionFailures.push({ reason: compactFailure(error), target });
      }
    }
    if (targetPassed) executedTargets.push(target);
  }
  return { blockedTargets, executedTargets, executionFailures, expectedProfilePrefixes };
}

export function measureNativeCoverage({ recordPath = defaultRecord } = {}) {
  if (process.platform === "win32") {
    throw new Error("native coverage currently requires a clang desktop host");
  }
  const cmake = resolveCmake();
  const ctest = resolveCtest(cmake);
  const buildDirectory = desktopBuildDirectory("coverage");
  run(
    cmake,
    [
      "--preset",
      desktopPreset(),
      "-B",
      buildDirectory,
      "-G",
      "Unix Makefiles",
      "-DCMAKE_BUILD_TYPE=Release",
      "-DCMAKE_C_COMPILER=clang",
      "-DCMAKE_CXX_COMPILER=clang++",
      "-DTN_ENABLE_COVERAGE=ON",
      "-DTN_ENABLE_NATIVE_PHYSICS=OFF",
      "-DTN_ENABLE_UI_OVERLAY=OFF",
    ],
    { timeout: 900_000 },
  );
  const cmakeSource = readFileSync(join(runtimeRoot, "CMakeLists.txt"), "utf8");
  const targets = discoverNativeTestTargets(cmakeSource);
  validateExecutionContracts(targets, executionContracts);
  const registrations = ctestRegistrations(buildDirectory, ctest);
  for (const target of targets) {
    if (!registrations.includes(target)) throw new Error(`CTest omitted native target: ${target}`);
  }
  rmSync(profileDirectory, { force: true, recursive: true });
  mkdirSync(profileDirectory, { recursive: true });

  buildNativeTarget(cmake, buildDirectory, "mystral", 1_800_000);
  buildNativeTarget(cmake, buildDirectory, "mystral-tools", 1_800_000);
  const { blockedTargets, executedTargets, executionFailures, expectedProfilePrefixes } =
    runCoverageTargets({
      buildDirectory,
      cmake,
      ctest,
      registrations,
      targets,
    });
  if (executionFailures.length > 0) {
    const detail = executionFailures.map(({ reason, target }) => `${target}: ${reason}`).join("\n");
    throw new Error(`native coverage execution failed:\n${detail}`);
  }

  const profileNames = readdirSync(profileDirectory).filter((name) => name.endsWith(".profraw"));
  requireInvocationProfiles(expectedProfilePrefixes, profileNames);
  const compiledProducts = compiledProductObjects(buildDirectory);
  const coverage = coverageExports({
    buildDirectory,
    compiledProducts,
    executedTargets,
    profileNames,
  });
  const report = summarizeNativeCoverage({
    blockedTargets,
    compiledSourceFiles: compiledProducts.sourceFiles,
    configuration: `${desktopPreset()}-coverage`,
    instrumentedFiles: [
      ...instrumentedFilesFromLcov(coverage.reports),
      ...coverage.zeroLineSources.map((path) => ({ covered: 0, lines: 0, path })),
    ],
    sourceFiles: sourceInventory(),
  });
  const markdown = renderMarkdown(report, executedTargets);
  mkdirSync(dirname(recordPath), { recursive: true });
  writeCoverageRecord(recordPath, markdown);
  console.info(markdown);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--ctest")) runNativeCtest();
  else measureNativeCoverage();
}
