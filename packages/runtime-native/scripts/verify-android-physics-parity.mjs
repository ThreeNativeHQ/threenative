#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(runtimeRoot, "..", "..");
const scenarioTemplatePath = join(
  workspaceRoot,
  "examples/native-smoke/playtests/physics-parity.playtest.json",
);
const fixturePath = join(
  workspaceRoot,
  "packages/physics/__tests__/fixtures/physics-parity.scenario.json",
);
const outputRoot = join(runtimeRoot, "artifacts/android/physics-parity");
const controls = new Set([
  "missing-device",
  "normal",
  "same-web",
  "wrong-gravity",
  "zero-tolerance",
]);

export class ParityError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ParityError";
    this.details = details;
  }
}

export function generateOperatorScenario(template, fixtureBytes) {
  const source = requireObject(template, "playtest scenario template");
  const fixture = requireObject(
    JSON.parse(Buffer.from(fixtureBytes).toString("utf8")),
    "physics parity fixture",
  );
  if (!Number.isInteger(fixture.steps) || fixture.steps <= 0)
    throw new ParityError("physics parity fixture steps must be a positive integer.");
  const scenarioSha256 = createHash("sha256").update(fixtureBytes).digest("hex");
  return {
    ...source,
    name: "native-physics-observable-parity",
    steps: [{ label: "complete", waitTicks: fixture.steps }],
    assert: {
      resources: [
        {
          changed: true,
          equals: fixture.steps,
          id: "GameState",
          path: "parity.steps",
        },
        {
          allowTrivial: true,
          equals: true,
          id: "GameState",
          path: "parity.grounded",
        },
        {
          allowTrivial: true,
          equals: "floor",
          id: "GameState",
          path: "parity.groundCollider",
        },
        {
          allowTrivial: true,
          equals: scenarioSha256,
          id: "GameState",
          path: "parity.scenarioSha256",
        },
        ...[
          "areaExcludedCharacter",
          "oneWayPassedUpward",
          "platformGroundedObserved",
        ].map((coverage) => ({
          allowTrivial: true,
          equals: true,
          id: "GameState",
          path: `parity.scenarioCoverage.${coverage}`,
        })),
      ],
    },
  };
}

export function artifactPaths(control, root = outputRoot) {
  if (!controls.has(control)) throw new ParityError(`Unknown parity control ${control}.`);
  const directory = join(root, control);
  return {
    comparison: join(directory, "comparison.json"),
    deviceArtifacts: join(directory, "device-artifacts"),
    deviceObservation: join(directory, "device-observation.json"),
    generatedScenario: join(directory, "physics-parity.generated.playtest.json"),
    rawDevice: join(directory, "device-playtest.json"),
    rawWeb: join(directory, "web-playtest.json"),
    webArtifacts: join(directory, "web-artifacts"),
    webObservation: join(directory, "web-observation.json"),
  };
}

export function browserDisplayArgs(env = process.env) {
  return env.DISPLAY || env.WAYLAND_DISPLAY ? ["--headed"] : [];
}

function requireObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ParityError(`${label} must be a JSON object.`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string") throw new ParityError(`${label} must be a string.`);
  return value;
}

function requireNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new ParityError(`${label} must be a finite number.`);
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") throw new ParityError(`${label} must be boolean.`);
  return value;
}

function requireVector(value, label) {
  if (!Array.isArray(value) || value.length !== 3)
    throw new ParityError(`${label} must contain three numbers.`);
  return value.map((entry, index) => requireNumber(entry, `${label}[${index}]`));
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new ParityError(`${label} must be a string array.`);
  return [...value];
}

export function parsePlaytestStdout(stdout, label) {
  if (typeof stdout !== "string" || stdout.trim() === "")
    throw new ParityError(`${label} playtest stdout is missing; stale observations are forbidden.`);
  try {
    return requireObject(JSON.parse(stdout), `${label} playtest report`);
  } catch (error) {
    if (error instanceof ParityError) throw error;
    throw new ParityError(`${label} playtest stdout is not one complete JSON report.`);
  }
}

export function normalizeReport(report, label) {
  if (report.pass !== true) throw new ParityError(`${label} playtest report did not pass.`);
  const observations = requireObject(report.observations, `${label}.observations`);
  const resources = requireObject(observations.resources, `${label}.observations.resources`);
  const gameState = requireObject(resources.GameState, `${label}.GameState`);
  const after = requireObject(gameState.after, `${label}.GameState.after`);
  const parity = requireObject(after.parity, `${label}.GameState.after.parity`);
  const coverage = requireObject(parity.scenarioCoverage, `${label}.scenarioCoverage`);
  return {
    areaMembership: requireStringArray(parity.areaMembership, `${label}.areaMembership`).sort(),
    areaMembershipSnapshots: requireStringArray(
      parity.areaMembershipSnapshots,
      `${label}.areaMembershipSnapshots`,
    ),
    characterDisplacement: requireVector(
      parity.characterDisplacement,
      `${label}.characterDisplacement`,
    ),
    collisionEventSet: requireStringArray(
      parity.collisionEventSet,
      `${label}.collisionEventSet`,
    ).sort(),
    control: requireString(parity.control, `${label}.control`),
    groundCollider:
      parity.groundCollider === null
        ? null
        : requireString(parity.groundCollider, `${label}.groundCollider`),
    grounded:
      typeof parity.grounded === "boolean"
        ? parity.grounded
        : (() => {
            throw new ParityError(`${label}.grounded must be boolean.`);
          })(),
    rapierVersion: requireString(parity.rapierVersion, `${label}.rapierVersion`),
    restingPosition: requireVector(parity.restingPosition, `${label}.restingPosition`),
    runtime: requireString(parity.runtime, `${label}.runtime`),
    scenarioSha256: requireString(parity.scenarioSha256, `${label}.scenarioSha256`),
    scenarioCoverage: {
      areaExcludedCharacter: requireBoolean(
        coverage.areaExcludedCharacter,
        `${label}.scenarioCoverage.areaExcludedCharacter`,
      ),
      oneWayPassedUpward: requireBoolean(
        coverage.oneWayPassedUpward,
        `${label}.scenarioCoverage.oneWayPassedUpward`,
      ),
      platformGroundedObserved: requireBoolean(
        coverage.platformGroundedObserved,
        `${label}.scenarioCoverage.platformGroundedObserved`,
      ),
    },
    steps: requireNumber(parity.steps, `${label}.steps`),
  };
}

function equalSet(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function vectorDistance(left, right) {
  return Math.hypot(...left.map((entry, index) => entry - right[index]));
}

function maximumAxisDelta(left, right) {
  return Math.max(...left.map((entry, index) => Math.abs(entry - right[index])));
}

export function compareObservations(web, device, options = {}) {
  const fixtureBytes = readFileSync(fixturePath);
  const fixture = JSON.parse(fixtureBytes.toString("utf8"));
  const scenarioSha256 = createHash("sha256").update(fixtureBytes).digest("hex");
  const restingTolerance = options.restingTolerance ?? 0.02;
  const displacementTolerance = options.displacementTolerance ?? 0.05;
  const failures = [];
  if (web.runtime !== "web") failures.push(`web runtime identity was ${web.runtime}`);
  if (device.runtime !== "native") failures.push(`device runtime identity was ${device.runtime}`);
  if (web.rapierVersion !== fixture.expectedRapierVersions.web)
    failures.push(`web Rapier identity was ${web.rapierVersion}`);
  if (device.rapierVersion !== fixture.expectedRapierVersions.rust)
    failures.push(`device Rapier identity was ${device.rapierVersion}`);
  if (web.rapierVersion === device.rapierVersion)
    failures.push("web and device resolved the same Rapier identity");
  if (web.scenarioSha256 !== scenarioSha256 || device.scenarioSha256 !== scenarioSha256)
    failures.push("fixture SHA-256 differs across the browser, device, or source bytes");
  if (web.steps !== fixture.steps || device.steps !== fixture.steps)
    failures.push(`both arms must complete exactly ${fixture.steps} steps`);
  const restingPositionMaxAxisDelta = maximumAxisDelta(
    web.restingPosition,
    device.restingPosition,
  );
  if (restingPositionMaxAxisDelta > restingTolerance)
    failures.push(`resting position delta ${restingPositionMaxAxisDelta} > ${restingTolerance}`);
  const characterDisplacementDelta = vectorDistance(
    web.characterDisplacement,
    device.characterDisplacement,
  );
  if (characterDisplacementDelta > displacementTolerance)
    failures.push(
      `character displacement delta ${characterDisplacementDelta} > ${displacementTolerance}`,
    );
  if (web.grounded !== device.grounded || web.groundCollider !== device.groundCollider)
    failures.push("grounded or logical ground collider differs");
  if (!equalSet(web.areaMembership, device.areaMembership))
    failures.push("logical area membership differs");
  if (!equalSet(web.collisionEventSet, device.collisionEventSet))
    failures.push("logical collision event set differs");
  if (!equalSet(web.areaMembershipSnapshots, device.areaMembershipSnapshots))
    failures.push("logical area membership checkpoints differ");
  const coverageKeys = [
    "areaExcludedCharacter",
    "oneWayPassedUpward",
    "platformGroundedObserved",
  ];
  for (const coverage of coverageKeys) {
    if (web.scenarioCoverage[coverage] !== device.scenarioCoverage[coverage])
      failures.push(`scenario coverage ${coverage} differs`);
    if (web.scenarioCoverage[coverage] !== true)
      failures.push(`scenario coverage ${coverage} was not observed`);
  }
  const expectedArea = ["dynamicBox"];
  const expectedEvents = [
    "boxOnlyArea-dynamicBox-1",
    "dynamicBox-floor-1",
    "dynamicBox-movingPlatform-1",
  ];
  if (!web.grounded || web.groundCollider !== "floor")
    failures.push("final exact grounded/floor outcome was not observed");
  if (!equalSet(web.areaMembership, expectedArea))
    failures.push("final exact area outcome was not [dynamicBox]");
  if (!equalSet(web.collisionEventSet, expectedEvents))
    failures.push("final exact collision event outcome was not observed");
  const comparison = {
    characterDisplacementDelta,
    displacementTolerance,
    failures,
    pass: failures.length === 0,
    restingPositionMaxAxisDelta,
    restingTolerance,
    scenarioSha256,
  };
  if (failures.length > 0) throw new ParityError(failures.join("; "), comparison);
  return comparison;
}

export function clearOutputs(paths) {
  if (!Array.isArray(paths) || paths.length === 0)
    throw new ParityError("clearOutputs requires explicit run-scoped paths.");
  for (const path of paths) rmSync(path, { force: true });
}

function commandText(command, args) {
  return [command, ...args].map((part) => (part.includes(" ") ? JSON.stringify(part) : part)).join(" ");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 600_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && options.allowFailure !== true)
    throw new ParityError(
      `${commandText(command, args)} failed (${result.status}).\n${result.stderr || result.stdout}`,
    );
  return result.stdout;
}

export function parseArgs(argv) {
  const result = { control: "normal", device: null, skipBuild: false, skipInstall: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skip-build") result.skipBuild = true;
    else if (arg === "--skip-install") result.skipInstall = true;
    else if (arg === "--device" || arg === "--control") {
      const value = argv[index + 1];
      if (value === undefined) throw new ParityError(`${arg} requires a value.`);
      result[arg === "--device" ? "device" : "control"] = value;
      index += 1;
    } else throw new ParityError(`Unknown option ${arg}.`);
  }
  if (!controls.has(result.control))
    throw new ParityError(`--control must be one of ${[...controls].join(", ")}.`);
  return result;
}

function discoverAdb() {
  const sdk =
    process.env.THREENATIVE_ANDROID_SDK ??
    process.env.ANDROID_SDK_ROOT ??
    process.env.ANDROID_HOME ??
    join(homedir(), "Android/Sdk");
  const adb = process.env.THREENATIVE_ADB ?? join(sdk, "platform-tools/adb");
  if (!existsSync(adb)) throw new ParityError(`adb not found at ${adb}.`);
  return { adb, sdk };
}

function selectDevice(adb, requested) {
  const output = run(adb, ["devices"]);
  const online = output
    .split(/\r?\n/)
    .map((line) => /^(\S+)\s+device(?:\s|$)/.exec(line)?.[1])
    .filter(Boolean);
  if (requested !== null && !online.includes(requested))
    throw new ParityError(`Android device ${requested} is not online.`);
  if (requested !== null) return requested;
  if (online.length !== 1)
    throw new ParityError(`Expected one online Android device, found ${online.length}.`);
  return online[0];
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readFreshObservation(path, label) {
  if (!existsSync(path))
    throw new ParityError(`${label} observation is missing; stale observations are forbidden.`);
  try {
    return requireObject(JSON.parse(readFileSync(path, "utf8")), `${label} observation`);
  } catch (error) {
    if (error instanceof ParityError) throw error;
    throw new ParityError(`${label} observation is not valid JSON.`);
  }
}

function generatedScenario(paths) {
  const template = JSON.parse(readFileSync(scenarioTemplatePath, "utf8"));
  const fixtureBytes = readFileSync(fixturePath);
  const scenario = generateOperatorScenario(template, fixtureBytes);
  writeJson(paths.generatedScenario, scenario);
  return paths.generatedScenario;
}

function comparisonInputs(control, paths) {
  if (control === "missing-device") rmSync(paths.deviceObservation, { force: true });
  return {
    device: readFreshObservation(
      control === "same-web" ? paths.webObservation : paths.deviceObservation,
      "device",
    ),
    web: readFreshObservation(paths.webObservation, "web"),
  };
}

function compareControl(control, paths) {
  try {
    const input = comparisonInputs(control, paths);
    const comparison = compareObservations(
      input.web,
      input.device,
      control === "zero-tolerance"
        ? { displacementTolerance: 0, restingTolerance: 0 }
        : undefined,
    );
    if (control !== "normal")
      throw new ParityError(
        `${control} negative control unexpectedly stayed green.`,
        comparison,
      );
    writeJson(paths.comparison, { ...comparison, control });
    return comparison;
  } catch (error) {
    writeJson(paths.comparison, {
      ...(error instanceof ParityError && error.details !== undefined ? error.details : {}),
      control,
      error: error instanceof Error ? error.message : String(error),
      pass: false,
    });
    throw error;
  }
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const paths = artifactPaths(options.control);
  mkdirSync(dirname(paths.comparison), { recursive: true });
  clearOutputs([
    paths.comparison,
    paths.deviceObservation,
    paths.generatedScenario,
    paths.rawDevice,
    paths.rawWeb,
    paths.webObservation,
  ]);
  const scenarioPath = generatedScenario(paths);
  const cli = join(workspaceRoot, "packages/playtest/dist/runner/cli.js");
  if (!existsSync(cli))
    throw new ParityError("Playtest CLI is missing; run pnpm --filter @threenative/playtest build.");
  const webStdout = run(
    process.execPath,
    [
      cli,
      scenarioPath,
      "--url",
      "http://127.0.0.1:5173",
      "--server-command",
      "THREENATIVE_PHYSICS_SCENE=enabled pnpm --dir examples/native-smoke exec vite --host 127.0.0.1 --port 5173 --strictPort",
      "--browser-recipe",
      "webgpu",
      ...browserDisplayArgs(),
      "--artifacts",
      paths.webArtifacts,
    ],
    {
      allowFailure: true,
      env: { ...process.env, THREENATIVE_PHYSICS_SCENE: "enabled" },
    },
  );
  writeFileSync(paths.rawWeb, webStdout);
  const web = normalizeReport(parsePlaytestStdout(webStdout, "web"), "web");
  writeJson(paths.webObservation, web);

  const { adb, sdk } = discoverAdb();
  const device = selectDevice(adb, options.device);
  const javaHome = process.env.THREENATIVE_JAVA_HOME ?? process.env.JAVA_HOME ?? "/usr/lib/jvm/java-17-openjdk";
  const androidEnv = {
    ...process.env,
    ANDROID_HOME: sdk,
    JAVA_HOME: javaHome,
    THREENATIVE_ANDROID_SDK: sdk,
    THREENATIVE_PHYSICS_CONTROL:
      options.control === "wrong-gravity"
        ? "wrong-gravity"
        : options.control === "zero-tolerance"
          ? "offset-box"
          : "normal",
  };
  if (!options.skipBuild) {
    run(process.execPath, [join(runtimeRoot, "scripts/build-android-physics-proof.mjs")], {
      env: androidEnv,
    });
    const gradlew = join(runtimeRoot, "android/gradlew");
    run(process.platform === "win32" ? `${gradlew}.bat` : "bash", [
      ...(process.platform === "win32" ? [] : [gradlew]),
      "-p",
      join(runtimeRoot, "android"),
      ":app:assembleDebug",
      "-x",
      "buildAndroidFirstProofBundle",
      "--console=plain",
    ], { env: androidEnv });
  }
  const apk = join(runtimeRoot, "android/app/build/outputs/apk/debug/app-debug.apk");
  if (!existsSync(apk)) throw new ParityError(`Android APK is missing at ${apk}.`);
  if (!options.skipInstall) run(adb, ["-s", device, "install", "-r", apk]);
  const deviceStdout = run(
    process.execPath,
    [
      cli,
      scenarioPath,
      "--target",
      "android",
      "--device",
      device,
      "--adb",
      adb,
      "--artifacts",
      paths.deviceArtifacts,
      "--timeout",
      "60000",
    ],
    { allowFailure: true, env: androidEnv },
  );
  writeFileSync(paths.rawDevice, deviceStdout);
  const native = normalizeReport(parsePlaytestStdout(deviceStdout, "device"), "device");
  writeJson(paths.deviceObservation, native);
  const comparison = compareControl(options.control, paths);
  process.stdout.write(`${JSON.stringify({ comparison, device, pass: true }, null, 2)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
