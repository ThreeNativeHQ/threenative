import { readFile } from "node:fs/promises";
import { inspectFrame } from "../capture.js";
import { TONE_METRICS, type IToneMetrics } from "../tone.js";
import { PlaytestCliUsageError } from "./config.js";

export async function toneCommand(paths: readonly string[]): Promise<number> {
  if (paths.length === 0 || paths.some((path) => path.startsWith("-"))) throw new PlaytestCliUsageError("tone requires one or more PNG paths: tone <png...>.");
  const rows: Array<{ label: string; metrics: IToneMetrics }> = [];
  for (const path of paths) {
    const metrics = inspectFrame(await readFile(path)).tone;
    if (metrics === undefined) throw new Error(`TN_TONE_UNOBSERVED: '${path}' has no visible pixels.`);
    rows.push({ label: path, metrics });
  }
  const average = Object.fromEntries(TONE_METRICS.map((key) => [key, rows.reduce((sum, { metrics }) => sum + metrics[key], 0) / rows.length])) as unknown as IToneMetrics;
  rows.push({ label: "average", metrics: average });
  const lines = rows.map(({ label, metrics }) => [label, ...TONE_METRICS.map((key) => (metrics[key] * (key.endsWith("Fraction") ? 100 : 1)).toFixed(2))].join("\t"));
  process.stdout.write(["frame\tmean\tp1\tp50\tp99\tclip%\tblack%", ...lines, ""].join("\n"));
  return 0;
}
