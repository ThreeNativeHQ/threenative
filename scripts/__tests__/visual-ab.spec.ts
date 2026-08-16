import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildVisualAbBundle } from "../visual-ab";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function fixture(templates: readonly string[], onlyBefore: readonly string[] = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), "threenative-visual-ab-"));
  temporaryRoots.push(root);
  const before = path.join(root, "before");
  const after = path.join(root, "after");
  await mkdir(before, { recursive: true });
  await mkdir(after, { recursive: true });
  // Real captured frames, so the bundle carries real PNGs rather than something that would slip
  // past an image check later in the pipeline.
  const source = path.join(process.cwd(), "docs/verification/visuals/starter.png");
  for (const name of [...templates, ...onlyBefore])
    await copyFile(source, path.join(before, `${name}.png`));
  for (const name of templates) await copyFile(source, path.join(after, `${name}.png`));
  return { after, before, root };
}

it("pairs every template so each rater scores both conditions", async () => {
  const { after, before, root } = await fixture(["alpha", "beta", "gamma"]);

  const result = buildVisualAbBundle(before, after, path.join(root, "out"));

  expect(result.pairs).toEqual(["alpha", "beta", "gamma"]);
  const bundle = JSON.parse(await readFile(path.join(result.bundle, "bundle.json"), "utf8")) as {
    samples: { label: string }[];
    verdict: string;
  };
  expect(bundle.verdict).toBe("ready");
  // Six samples, not three: the point is that one rater sees both sides of every pair, so that
  // rater's own calibration cancels in the difference instead of contaminating it.
  expect(bundle.samples).toHaveLength(6);

  const reveal = JSON.parse(await readFile(result.reveal, "utf8")) as { arm: string }[];
  expect(reveal.map((entry) => entry.arm).sort()).toEqual([
    "alpha::after",
    "alpha::before",
    "beta::after",
    "beta::before",
    "gamma::after",
    "gamma::before",
  ]);

  // Nothing the critic reads may say which condition, or which template, a sample is.
  const seen = JSON.stringify(bundle);
  for (const word of ["before", "after", "alpha", "beta", "gamma"])
    expect(seen).not.toContain(word);
});

it("refuses an unpaired set rather than scoring it lopsided", async () => {
  // A template present on one side only would be scored as an unpaired sample and drag the
  // aggregate, which is a quieter version of the exact defect this file exists to remove.
  const { after, before, root } = await fixture(["alpha"], ["orphan"]);

  expect(() => buildVisualAbBundle(before, after, path.join(root, "out"))).toThrow(
    /TN_VISUAL_AB_UNPAIRED.*orphan/su,
  );
});

it("refuses an empty set", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "threenative-visual-ab-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "before"), { recursive: true });
  await mkdir(path.join(root, "after"), { recursive: true });
  await writeFile(path.join(root, "before", "notes.txt"), "not a frame\n");

  expect(() =>
    buildVisualAbBundle(
      path.join(root, "before"),
      path.join(root, "after"),
      path.join(root, "out"),
    ),
  ).toThrow(/TN_VISUAL_AB_EMPTY/u);
});
