import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { runTemplateBaseline } from "../template-baseline";
import { TEMPLATE_NAMES } from "../visual-gate";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "threenative-baseline-spec-"));
  temporaryRoots.push(root);
  return root;
}

/**
 * A real captured frame, so the capture guard is exercised rather than bypassed. Any committed
 * template frame will do; the test is about bundling, not about which template it came from.
 */
async function realFrame(): Promise<Buffer> {
  return readFile(path.join(process.cwd(), "docs/verification/visuals/starter.png"));
}

it("bundles one blind sample per template and reveals every one", async () => {
  const root = await fixtureRoot();
  const frame = await realFrame();
  const captured: string[] = [];

  const result = await runTemplateBaseline(path.join(root, "baseline"), {
    captureTemplate: async (template) => {
      captured.push(template);
      const { assertFrameShowsSomething } = await import("../capture-guard.js");
      return { content: frame, stats: assertFrameShowsSomething(frame, template) };
    },
    studioAssetRoot: path.join(root, "studio"),
    visualRoot: path.join(root, "visuals"),
  });

  expect(captured).toEqual([...TEMPLATE_NAMES]);
  const bundle = JSON.parse(await readFile(path.join(result.bundle, "bundle.json"), "utf8")) as {
    samples: { label: string }[];
    verdict: string;
  };
  expect(bundle.verdict).toBe("ready");
  expect(bundle.samples).toHaveLength(TEMPLATE_NAMES.length);

  // The reveal must account for every template exactly once. A bundle that quietly drops one is a
  // baseline claiming coverage it does not have, which is the failure this whole file exists to
  // stop: four templates shipped an invisible sky gradient because nothing ever looked at a frame.
  const reveal = JSON.parse(await readFile(result.reveal, "utf8")) as { arm: string }[];
  expect([...reveal.map((entry) => entry.arm)].sort()).toEqual([...TEMPLATE_NAMES].sort());

  // The bundle the critic reads must not name a template anywhere.
  const labels = bundle.samples.map((sample) => sample.label);
  expect(labels).toEqual(labels.map((_, index) => `sample-0${index + 1}`));
  for (const template of TEMPLATE_NAMES) expect(JSON.stringify(bundle)).not.toContain(template);
});

it("fails closed when a template does not capture", async () => {
  const root = await fixtureRoot();
  const frame = await realFrame();

  await expect(
    runTemplateBaseline(path.join(root, "baseline"), {
      captureTemplate: async (template) => {
        if (template === TEMPLATE_NAMES[0]) throw new Error("capture exploded");
        const { assertFrameShowsSomething } = await import("../capture-guard.js");
        return { content: frame, stats: assertFrameShowsSomething(frame, template) };
      },
      studioAssetRoot: path.join(root, "studio"),
      visualRoot: path.join(root, "visuals"),
    }),
  ).rejects.toThrow();
});
