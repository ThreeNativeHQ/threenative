import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  DEFAULT_DUPLICATE_PAIRS,
  type VisualAbError,
  type VisualAbResult,
  buildVisualAbBundle,
  scoreVisualAb,
} from "../visual-ab";

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

/** Writes one rater's verdict, scoring each arm by name through the bundle's reveal mapping. */
async function verdict(
  built: VisualAbResult,
  root: string,
  name: string,
  scores: Readonly<Record<string, number>>,
): Promise<string> {
  const reveal = JSON.parse(await readFile(built.reveal, "utf8")) as {
    arm: string;
    label: string;
  }[];
  const file = path.join(root, `${name}.json`);
  await writeFile(
    file,
    JSON.stringify({
      samples: reveal.map((entry) => ({ label: entry.label, visuals: scores[entry.arm] ?? 3 })),
    }),
  );
  return file;
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
  // Six paired samples, not three: the point is that one rater sees both sides of every pair, so
  // that rater's own calibration cancels in the difference instead of contaminating it. Plus the
  // duplicate copies, which is how the run measures what a difference is worth.
  expect(bundle.samples).toHaveLength(6 + DEFAULT_DUPLICATE_PAIRS);

  const reveal = JSON.parse(await readFile(result.reveal, "utf8")) as { arm: string }[];
  expect(reveal.map((entry) => entry.arm).sort()).toEqual([
    "alpha::after",
    "alpha::before",
    "alpha::before::duplicate",
    "beta::after",
    "beta::before",
    "beta::before::duplicate",
    "gamma::after",
    "gamma::before",
  ]);

  // Nothing the critic reads may say which condition, or which template, a sample is — and a
  // duplicate must not be labelled as one, or the rater knows to answer consistently.
  const seen = JSON.stringify(bundle);
  for (const word of ["before", "after", "alpha", "beta", "gamma", "duplicate"])
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

it("measures its own resolution from the duplicate pairs and reports it", async () => {
  const { after, before, root } = await fixture(["alpha", "beta", "gamma"]);
  const built = buildVisualAbBundle(before, after, path.join(root, "out"));
  // This rater scores one duplicate a point away from its twin. That disagreement is the whole
  // measurement: it is the same image, so the point is the instrument, not the frame.
  const file = await verdict(built, root, "rater-1", {
    "alpha::after": 4,
    "alpha::before": 2,
    "alpha::before::duplicate": 3,
    "beta::after": 3,
    "beta::before": 3,
    "beta::before::duplicate": 3,
    "gamma::after": 5,
    "gamma::before": 2,
  });

  const score = scoreVisualAb(built.reveal, [file], 1);

  expect(score.mde).toBe(1);
  expect(score.duplicateSpreads.map(({ spread }) => spread).sort()).toEqual([0, 1]);
  // alpha moved +2 and gamma +3, both past the resolution. beta did not move at all.
  expect(score.rows.find((row) => row.template === "alpha")?.classification).toBe("WIN");
  expect(score.rows.find((row) => row.template === "gamma")?.classification).toBe("WIN");
  expect(score.rows.find((row) => row.template === "beta")?.classification).toBe("INDETERMINATE");
});

it("excludes a sub-resolution delta from the aggregate instead of averaging it in", async () => {
  const { after, before, root } = await fixture(["alpha", "beta", "gamma"]);
  const built = buildVisualAbBundle(before, after, path.join(root, "out"));
  const file = await verdict(built, root, "rater-1", {
    "alpha::after": 5,
    "alpha::before": 2,
    "alpha::before::duplicate": 3,
    // beta moves exactly one point, which is exactly what this rater could not tell apart.
    "beta::after": 4,
    "beta::before": 3,
    "beta::before::duplicate": 3,
    "gamma::after": 3,
    "gamma::before": 3,
  });

  const score = scoreVisualAb(built.reveal, [file], 1);

  expect(score.mde).toBe(1);
  expect(score.rows.find((row) => row.template === "beta")?.classification).toBe("INDETERMINATE");
  expect(score.aggregate.counted).toBe(1);
  expect(score.aggregate.excluded).toBe(2);
  // 5, from alpha alone. beta's 4 and gamma's 3 are unresolvable and contribute nothing.
  expect(score.aggregate.meanAfter).toBe(5);
  expect(score.aggregate.atFloor).toBe(1);
});

it("takes the median across raters rather than one rater's opinion", async () => {
  const { after, before, root } = await fixture(["alpha", "beta", "gamma"]);
  const built = buildVisualAbBundle(before, after, path.join(root, "out"));
  // Every rater is perfectly self-consistent here, so the resolution is 0 and the median is the
  // only thing under test.
  const consistent = { "alpha::before": 1, "alpha::before::duplicate": 1 };
  const files = await Promise.all([
    verdict(built, root, "rater-1", { ...consistent, "alpha::after": 5 }),
    verdict(built, root, "rater-2", { ...consistent, "alpha::after": 4 }),
    verdict(built, root, "rater-3", { ...consistent, "alpha::after": 1 }),
  ]);

  const score = scoreVisualAb(built.reveal, files, 3);

  // The outlier does not drag the result the way a mean would: median of 5, 4, 1 is 4.
  expect(score.rows.find((row) => row.template === "alpha")?.after).toBe(4);
  expect(score.mde).toBe(0);
});

it("refuses a bundle with no duplicate pair rather than scoring without a resolution", async () => {
  const { after, before, root } = await fixture(["alpha", "beta"]);
  const built = buildVisualAbBundle(before, after, path.join(root, "out"), undefined, 0);
  const file = await verdict(built, root, "rater-1", {});

  expect(() => scoreVisualAb(built.reveal, [file], 1)).toThrow(/TN_VISUAL_AB_NO_DUPLICATE_PAIR/u);
  try {
    scoreVisualAb(built.reveal, [file], 1);
  } catch (error) {
    expect((error as VisualAbError).exitCode).toBe(2);
  }
});

it("refuses fewer verdicts than raters were asked for, naming the shortfall", async () => {
  const { after, before, root } = await fixture(["alpha", "beta"]);
  const built = buildVisualAbBundle(before, after, path.join(root, "out"));
  const files = await Promise.all([
    verdict(built, root, "rater-1", {}),
    verdict(built, root, "rater-2", {}),
  ]);

  expect(() => scoreVisualAb(built.reveal, files, 3)).toThrow(
    /TN_VISUAL_AB_RATER_SHORTFALL: 3 rater\(s\) requested, 2 verdict file\(s\) supplied/u,
  );
});

it("refuses an unparseable verdict instead of quietly dropping to the raters that parsed", async () => {
  const { after, before, root } = await fixture(["alpha", "beta"]);
  const built = buildVisualAbBundle(before, after, path.join(root, "out"));
  const good = await verdict(built, root, "rater-1", {});
  const bad = path.join(root, "rater-2.json");
  await writeFile(bad, "{ not json");

  expect(() => scoreVisualAb(built.reveal, [good, bad], 2)).toThrow(
    /TN_VISUAL_AB_VERDICT_UNPARSEABLE/u,
  );
});

it("refuses a verdict that skipped a sample", async () => {
  const { after, before, root } = await fixture(["alpha", "beta"]);
  const built = buildVisualAbBundle(before, after, path.join(root, "out"));
  const reveal = JSON.parse(await readFile(built.reveal, "utf8")) as { label: string }[];
  const file = path.join(root, "partial.json");
  await writeFile(
    file,
    JSON.stringify({ samples: reveal.slice(1).map(({ label }) => ({ label, visuals: 3 })) }),
  );

  expect(() => scoreVisualAb(built.reveal, [file], 1)).toThrow(/TN_VISUAL_AB_VERDICT_INCOMPLETE/u);
});

it("refuses a score outside the rubric rather than clamping it", async () => {
  const { after, before, root } = await fixture(["alpha", "beta"]);
  const built = buildVisualAbBundle(before, after, path.join(root, "out"));
  const reveal = JSON.parse(await readFile(built.reveal, "utf8")) as { label: string }[];
  const file = path.join(root, "out-of-range.json");
  await writeFile(
    file,
    JSON.stringify({
      samples: reveal.map(({ label }, index) => ({ label, visuals: index === 0 ? 9 : 3 })),
    }),
  );

  expect(() => scoreVisualAb(built.reveal, [file], 1)).toThrow(
    /TN_VISUAL_AB_VERDICT_MALFORMED.*expected an integer 1-5/su,
  );
});

it("reports a measured regression as a LOSS", async () => {
  const { after, before, root } = await fixture(["alpha", "beta"]);
  const built = buildVisualAbBundle(before, after, path.join(root, "out"));
  const file = await verdict(built, root, "rater-1", {
    "alpha::after": 1,
    "alpha::before": 5,
    "alpha::before::duplicate": 5,
    "beta::before::duplicate": 3,
  });

  const score = scoreVisualAb(built.reveal, [file], 1);

  expect(score.mde).toBe(0);
  expect(score.rows.find((row) => row.template === "alpha")?.classification).toBe("LOSS");
});
