import type { FullConfig } from "@playwright/test";

import { WEBGPU_BROWSER_ARGS } from "../packages/playtest/src/runner/browser.js";
import { verifyWebGpuProjects } from "./webgpu-provenance.js";

export default async function benchmarkPlaywrightSetup(config: FullConfig): Promise<void> {
  await verifyWebGpuProjects(config, WEBGPU_BROWSER_ARGS, "benchmark", {
    allowSoftwareAdapter: process.env.CI === "true",
  });
}
