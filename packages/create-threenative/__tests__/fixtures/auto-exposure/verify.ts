import { execFileSync } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import {
  WEBGPU_BROWSER_ARGS,
  runStandalonePlaytest,
} from "../../../../playtest/dist/runner/index.js";
import { type ExposureMutation, exposureMutationPlugin } from "./mutations.js";
import { type IExposureCaseProof, qualifyExposureCase } from "./proof.js";

const fixture = dirname(fileURLToPath(import.meta.url));
const root = resolve(fixture, "../../../../..");
const artifacts = join(root, "artifacts/prd339-exposure");
interface IFixtureCase extends IExposureCaseProof {
  name: string;
  query: string;
  scenario: "static" | "cut" | "cut-frames";
  mutation?: ExposureMutation;
}
// Scene-linear reference readings from the inspected 5c3b176 fixture, independently of adaptation.
// This pins the meter against a constant/doubled-meter bug; display-tone metrics remain PRD341-owned.
const darkLuminance = 0.0019189472077414393;
const sunlightLuminance = 3.896103858947754;
const cases: IFixtureCase[] = [
  {
    name: "dark-adapted",
    query: "bright=0",
    scenario: "static",
    applied: true,
    expectedLuminance: darkLuminance,
  },
  {
    name: "sunlight-adapted",
    query: "bright=1",
    scenario: "static",
    applied: true,
    expectedLuminance: sunlightLuminance,
  },
  {
    name: "eleven-stop-cut",
    query: "bright=0&stops=11&snapGain=0",
    scenario: "cut",
    cutStops: 11,
    applied: true,
    expectedLuminance: sunlightLuminance,
  },
  {
    name: "one-stop-cut",
    query: "bright=0&stops=1&snapGain=0",
    scenario: "cut",
    cutStops: 1,
    applied: true,
    expectedLuminance: darkLuminance * 2,
  },
  {
    name: "eleven-stop-reverse",
    query: "bright=1&stops=11&snapGain=0",
    scenario: "cut",
    cutStops: 11,
    applied: true,
    expectedLuminance: darkLuminance,
  },
  {
    name: "one-stop-reverse",
    query: "bright=1&stops=1&snapGain=0",
    scenario: "cut",
    cutStops: 1,
    applied: true,
    expectedLuminance: darkLuminance,
  },
  {
    name: "fixed-exposure",
    query: "enabled=0&bright=1",
    scenario: "static",
    applied: false,
    expectedLuminance: sunlightLuminance,
  },
  {
    name: "deterministic-eleven-reverse",
    query: "bright=1&stops=11&snapGain=0&deterministic=1",
    scenario: "cut-frames",
    cutStops: 11,
    deterministic: true,
    applied: true,
    expectedLuminance: darkLuminance,
  },
  {
    name: "deterministic-one-reverse",
    query: "bright=1&stops=1&snapGain=0&deterministic=1",
    scenario: "cut-frames",
    cutStops: 1,
    deterministic: true,
    applied: true,
    expectedLuminance: darkLuminance,
  },
  {
    name: "linear-one-stop",
    query: "bright=1&stops=1&snapGain=0&deterministic=1",
    scenario: "cut-frames",
    deterministic: true,
    cutStops: 1,
    applied: true,
    expectedLuminance: darkLuminance,
    mutation: "linear",
  },
  {
    name: "linear-eleven-stop",
    query: "bright=1&stops=11&snapGain=0&deterministic=1",
    scenario: "cut-frames",
    deterministic: true,
    cutStops: 11,
    applied: true,
    expectedLuminance: darkLuminance,
    mutation: "linear",
    reject: "TN_EXPOSURE_NOT_SETTLED",
  },
  {
    name: "disabled-unmeasured",
    query: "enabled=0&bright=1",
    scenario: "static",
    applied: false,
    expectedLuminance: sunlightLuminance,
    mutation: "disabled",
    reject: "TN_EXPOSURE_MEASUREMENT_MISSING",
  },
  {
    name: "doubled-meter",
    query: "bright=1",
    scenario: "static",
    applied: true,
    expectedLuminance: sunlightLuminance,
    mutation: "meter",
    reject: "TN_EXPOSURE_METER_RANGE",
  },
  {
    name: "wrong-clock",
    query: "bright=1",
    scenario: "static",
    applied: true,
    expectedLuminance: sunlightLuminance,
    mutation: "clock",
    reject: "TN_EXPOSURE_WRONG_CLOCK",
  },
];
await mkdir(artifacts, { recursive: true });
const sites = new Map<string, string>();
for (const mutation of [undefined, "linear", "disabled", "meter", "clock"] as const) {
  const name = mutation ?? "normal";
  const site = join(artifacts, "sites", name);
  let mutationReceipt: unknown;
  await build({
    configFile: false,
    root: fixture,
    plugins:
      mutation === undefined
        ? []
        : [
            exposureMutationPlugin(mutation, (receipt) => {
              mutationReceipt = receipt;
            }),
          ],
    build: { outDir: site, emptyOutDir: true },
  });
  if (mutation !== undefined && mutationReceipt === undefined)
    throw new Error(`${mutation}: mutation receipt missing.`);
  if (mutationReceipt !== undefined)
    await writeFile(join(site, "mutation.json"), `${JSON.stringify(mutationReceipt, null, 2)}\n`);
  sites.set(name, site);
}
if (!process.argv.includes("--build-only")) {
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const vite = join(
    dirname(fileURLToPath(import.meta.resolve("vite/package.json"))),
    "bin/vite.js",
  );
  const results = [];
  for (const item of cases) {
    const site = sites.get(item.mutation ?? "normal");
    if (site === undefined) throw new Error(`${item.name}: fixture build missing.`);
    const directory = join(artifacts, item.name);
    await mkdir(directory, { recursive: true });
    const report = await runStandalonePlaytest({
      artifactDirectory: directory,
      projectPath: fixture,
      scenarioPath: join(fixture, `${item.scenario}.playtest.json`),
      url: `http://127.0.0.1:4173/?${item.query}`,
      port: 0,
      server: {
        command: `TN_EXPOSURE_HTTP_LOG=${JSON.stringify(join(directory, "http-errors.jsonl"))} ${JSON.stringify(process.execPath)} ${JSON.stringify(vite)} preview --host 127.0.0.1 --port $PORT --strictPort --outDir ${JSON.stringify(site)}`,
        cwd: fixture,
      },
      timeoutMs: 180_000,
      headless: false,
      trace: false,
      target: "browser",
      browserArgs: WEBGPU_BROWSER_ARGS,
      allowSoftwareAdapter: true,
      captureArtifactScreenshots: true,
    });
    await writeFile(
      join(directory, "report.json"),
      `${JSON.stringify({ sourceSha, mutation: item.mutation ?? null, ...report }, null, 2)}\n`,
    );
    const screenshot = join(directory, "after.png");
    if ((await stat(screenshot)).size === 0)
      throw new Error(`${item.name}: runtime screenshot missing.`);
    const result = qualifyExposureCase(report, item);
    results.push({
      name: item.name,
      sourceSha,
      mutation: item.mutation ?? null,
      ...result,
      capture: report.capture,
      screenshot,
    });
    await writeFile(
      join(artifacts, "summary.json"),
      `${JSON.stringify({ sourceSha, correctnessOnly: true, results }, null, 2)}\n`,
    );
  }
  console.info(
    `PRD339_EXPOSURE_PROOF ${JSON.stringify({ sourceSha, captures: results.length, correctnessOnly: true })}`,
  );
}
