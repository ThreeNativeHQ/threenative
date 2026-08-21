import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import { nextRoundAction } from "../round-next.js";

const roots: string[] = [];

function baseLedger(
  options: {
    readonly frameworkArchive?: string;
    readonly vanillaArchive?: string;
    readonly frameworkProof?: string;
    readonly vanillaProof?: string;
    readonly frameworkVisual?: string;
    readonly vanillaVisual?: string;
    readonly functional?: string;
    readonly visual?: string;
    readonly cost?: string;
    readonly gap?: string;
    readonly disposition?: string;
    readonly prd?: string;
    readonly gates?: string;
    readonly stop?: string;
    readonly notes?: string;
  } = {},
): string {
  const frameworkArchive = options.frameworkArchive ?? "unmeasured";
  const vanillaArchive = options.vanillaArchive ?? "unmeasured";
  const frameworkProof = options.frameworkProof ?? "unmeasured";
  const vanillaProof = options.vanillaProof ?? "unmeasured";
  const frameworkVisual = options.frameworkVisual ?? "unmeasured";
  const vanillaVisual = options.vanillaVisual ?? "unmeasured";
  const functional = options.functional ?? "unmeasured";
  const visual = options.visual ?? "unmeasured";
  const cost = options.cost ?? "unmeasured";
  const gate = options.gates ?? "unmeasured";
  const gap = options.gap ?? "None | None | None | None | None | None";
  const disposition = options.disposition ?? "None | None | None | None | None | None";
  return [
    "# Improvement round ledger — round 1 — 2026-08-06",
    "Round: 1",
    "Date: 2026-08-06",
    "Framework commit: working tree",
    "Framework version: 0.1.0",
    "Genres: platformer",
    "Budget: one bounded implementation slice",
    `Stop condition met: ${options.stop ?? "none yet"}`,
    "Next action: continue",
    "",
    "## Arms",
    "| Genre | Arm | Archive | Brief SHA-256 | Proof SHA-256 | Proof passed/total | Instrument visual | User LOC | Source files | Reach rate |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    `| platformer | framework | ${frameworkArchive} | brief | proof | ${frameworkProof} | ${frameworkVisual} | 100 | 2 | 0.5 |`,
    `| platformer | vanilla | ${vanillaArchive} | brief | proof | ${vanillaProof} | ${vanillaVisual} | 176 | 2 | n/a |`,
    "",
    "## Column verdicts",
    "| Genre | Functional | Visual | Cost | Verdict |",
    "| --- | --- | --- | --- | --- |",
    `| platformer | ${functional} | ${visual} | ${cost} | undecided |`,
    "",
    "## Gap list",
    "| # | Genre | Column | What vanilla did better | Evidence | Smallest change that would close it |",
    "| --- | --- | --- | --- | --- | --- |",
    `| ${gap} |`,
    "",
    "## Dispositions",
    "| Gap # | Disposition | 20-line verdict | Named live caller | PRD | Reason if rejected |",
    "| --- | --- | --- | --- | --- | --- |",
    `| ${disposition} |`,
    "",
    "## Deletions this round",
    "| Export | Rounds unreached | Deleted? | Evidence |",
    "| --- | --- | --- | --- |",
    "| None | 0 | no — pending first round | unmeasured |",
    "",
    "## Gates",
    "| Gate | Command | Result |",
    "| --- | --- | --- |",
    `| Typecheck | pnpm typecheck | ${gate} |`,
    `| Lint | pnpm lint | ${gate} |`,
    `| Test | pnpm test | ${gate} |`,
    `| Budgets | pnpm budgets | ${gate} |`,
    "",
    "## Firewall attestation",
    "| Rule | Held? | Evidence |",
    "| --- | --- | --- |",
    "| Arms built in separate contexts | yes | builder-a and builder-b |",
    "| Neither builder saw the sealed proofs | yes | proofs copied after builds |",
    "| Judge was fresh, read-only, blind to arm | yes | external reveal and critic |",
    "| Lead agent wrote no game code | yes | orchestration only |",
    "",
    "## Notes",
    options.notes ?? "Progress is intentionally incomplete for this fixture.",
  ].join("\n");
}

async function fixture(): Promise<string> {
  const root = await makeTempDir("threenative-round-next-");
  roots.push(root);
  await mkdir(path.join(root, "docs/verification"), { recursive: true });
  return root;
}

async function archive(
  root: string,
  name: string,
  arm: "framework" | "vanilla",
  proof = false,
  captures = false,
): Promise<string> {
  const relative = `docs/benchmark/sweeps/${name}`;
  const directory = path.join(root, relative);
  await mkdir(path.join(directory, "captures"), { recursive: true });
  await writeFile(
    path.join(directory, "sweep.json"),
    JSON.stringify({
      arm,
      genre: "platformer",
      briefHash: "brief",
      proofHash: "proof",
      template: "fixture",
      date: "2026-08-06T00:00:00.000Z",
      frameworkVersion: "0.1.0",
      sourceLines: 1,
    }),
  );
  if (proof)
    await writeFile(
      path.join(directory, "proof.json"),
      JSON.stringify({
        passed: 2,
        scenarios: [{ verdict: "pass" }, { verdict: "pass" }],
        total: 2,
      }),
    );
  if (captures) await writeFile(path.join(directory, "captures/index.json"), "{}\n");
  return relative;
}

async function writeLedger(root: string, markdown: string): Promise<string> {
  const file = path.join(root, "docs/verification/round-1-2026-08-06.md");
  await writeFile(file, markdown);
  return file;
}

function screenshot(): Buffer {
  const png = new PNG({ height: 8, width: 8 });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const pixel = offset / 4;
    png.data[offset] = 80 + (pixel % 8) * 20;
    png.data[offset + 1] = 100 + Math.floor(pixel / 8) * 15;
    png.data[offset + 2] = 180;
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}

async function writeVisualOnlyLedger(
  root: string,
  options: {
    readonly afterTemplate?: string;
    readonly beforeBytes?: Buffer;
    readonly beforeTemplate?: string;
    readonly measurement?: boolean;
  } = {},
): Promise<string> {
  const before = path.join(root, "docs/verification/visuals/before");
  const after = path.join(root, "docs/verification/visuals/after");
  await mkdir(before, { recursive: true });
  await mkdir(after, { recursive: true });
  await writeFile(
    path.join(before, `${options.beforeTemplate ?? "starter"}.png`),
    options.beforeBytes ?? screenshot(),
  );
  await writeFile(path.join(after, `${options.afterTemplate ?? "starter"}.png`), screenshot());
  const measurement =
    options.measurement === false
      ? []
      : [
          "Visual MDE: 1",
          "",
          "## Visual deltas",
          "| Template | Before | After | Δ | Verdict |",
          "| --- | --- | --- | --- | --- |",
          "| starter | 2 | 2 | 0 | INDETERMINATE |",
          "",
        ];
  const file = path.join(root, "docs/verification/round-11-2026-08-19.md");
  await writeFile(
    file,
    [
      "# Improvement round ledger — round 11 — 2026-08-19",
      "Round: 11",
      "Date: 2026-08-19",
      "Framework commit: working tree",
      "Framework version: 0.1.0",
      "Round kind: visual-only",
      "Genres: template-visual",
      "Budget: screenshot-only fixture",
      "Stop condition met: none",
      "Next action: continue",
      "",
      ...measurement,
      "## Arms",
      "| Genre | Arm | Archive | Brief SHA-256 | Proof SHA-256 | Proof passed/total | Instrument visual | User LOC | Source files | Reach rate |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| template-visual | before | docs/verification/visuals/before | prompt | prompt | 7/7 | unmeasured | n/a | 7 | n/a |",
      "| template-visual | after | docs/verification/visuals/after | prompt | prompt | 7/7 | unmeasured | n/a | 7 | n/a |",
      "",
      "## Column verdicts",
      "| Genre | Functional | Visual | Cost | Verdict |",
      "| --- | --- | --- | --- | --- |",
      "| template-visual | tie | tie | tie | schema-only |",
      "",
      "## Gap list",
      "| # | Genre | Column | What vanilla did better | Evidence | Smallest change that would close it |",
      "| --- | --- | --- | --- | --- | --- |",
      "| None | None | None | None | None | None |",
      "",
      "## Dispositions",
      "| Gap # | Disposition | 20-line verdict | Named live caller | PRD | Reason if rejected |",
      "| --- | --- | --- | --- | --- | --- |",
      "| None | None | None | None | None | None |",
      "",
      "## Gates",
      "| Gate | Command | Result |",
      "| --- | --- | --- |",
      "| Typecheck | pnpm typecheck | pass |",
      "| Lint | pnpm lint | pass |",
      "| Test | pnpm test | pass |",
      "| Budgets | pnpm budgets | pass |",
      "",
      "## Notes",
      "This visual-only round has no sweep measurement and contributes no deletion evidence.",
    ].join("\n"),
  );
  return file;
}

describe("round:next", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("fails when no round ledger exists", async () => {
    const root = await fixture();
    expect(() => nextRoundAction(root)).toThrow(/No round ledger/u);
  });

  it("prints the missing arm build", async () => {
    const root = await fixture();
    const vanilla = await archive(root, "vanilla", "vanilla", true, true);
    const file = await writeLedger(
      root,
      baseLedger({ vanillaArchive: vanilla, vanillaProof: "2/2", vanillaVisual: "4" }),
    );
    expect(nextRoundAction(root, file)).toEqual({
      command: "pnpm sandbox --bare --arm framework --genre platformer --name platformer-framework",
      reason: "Build the missing framework arm for platformer.",
    });
  });

  it("prints prove, capture, judge, pair, decide, and close in order", async () => {
    const root = await fixture();
    const framework = await archive(root, "framework", "framework", false, false);
    const vanilla = await archive(root, "vanilla", "vanilla", true, true);
    const file = await writeLedger(
      root,
      baseLedger({ frameworkArchive: framework, vanillaArchive: vanilla }),
    );
    expect(nextRoundAction(root, file)).toMatchObject({ command: `pnpm sweep:proof ${framework}` });

    await writeFile(
      path.join(root, framework, "proof.json"),
      JSON.stringify({
        passed: 0,
        scenarios: [{ verdict: "fail" }, { verdict: "fail" }],
        total: 2,
      }),
    );
    expect(nextRoundAction(root, file)).toMatchObject({
      command: `pnpm sweep:proof ${framework}`,
    });
    await writeFile(
      path.join(root, framework, "proof.json"),
      JSON.stringify({
        passed: 2,
        scenarios: [{ verdict: "pass" }, { verdict: "pass" }],
        total: 2,
      }),
    );
    expect(nextRoundAction(root, file)).toMatchObject({
      command: `pnpm sweep:capture ${framework}`,
    });
    await writeFile(path.join(root, framework, "captures/index.json"), "{}\n");
    await writeFile(
      file,
      baseLedger({
        frameworkArchive: framework,
        vanillaArchive: vanilla,
        frameworkProof: "2/2",
        vanillaProof: "2/2",
        notes: "Blind bundle: /tmp/bundle\nCritic input: /tmp/critic.json",
      }),
    );
    expect(nextRoundAction(root, file)).toMatchObject({
      command: "pnpm sweep:judge /tmp/bundle --input /tmp/critic.json",
    });

    await writeFile(
      file,
      baseLedger({
        frameworkArchive: framework,
        vanillaArchive: vanilla,
        frameworkProof: "2/2",
        vanillaProof: "2/2",
        frameworkVisual: "4",
        vanillaVisual: "4",
      }),
    );
    expect(nextRoundAction(root, file)).toMatchObject({
      command: `pnpm sweep:pair ${framework} ${vanilla}`,
    });

    await writeFile(
      file,
      baseLedger({
        frameworkArchive: framework,
        vanillaArchive: vanilla,
        frameworkProof: "2/2",
        vanillaProof: "2/2",
        frameworkVisual: "4",
        vanillaVisual: "4",
        functional: "tie",
        visual: "loss",
        cost: "win",
        gap: "1 | platformer | visual | clearer goal | captures | improve goal",
      }),
    );
    expect(nextRoundAction(root, file)).toMatchObject({ command: "record disposition for gap #1" });

    await writeFile(
      file,
      baseLedger({
        frameworkArchive: framework,
        vanillaArchive: vanilla,
        frameworkProof: "2/2",
        vanillaProof: "2/2",
        frameworkVisual: "4",
        vanillaVisual: "4",
        functional: "tie",
        visual: "loss",
        cost: "win",
        gap: "1 | platformer | visual | clearer goal | captures | improve goal",
        disposition:
          "1 | framework change | over 20 lines | packages/core/src/viewport.ts | unmeasured | n/a",
      }),
    );
    expect(nextRoundAction(root, file)).toMatchObject({ command: "write the PRD named by gap #1" });

    const closed = baseLedger({
      frameworkArchive: framework,
      vanillaArchive: vanilla,
      frameworkProof: "2/2",
      vanillaProof: "2/2",
      frameworkVisual: "4",
      vanillaVisual: "4",
      functional: "tie",
      visual: "loss",
      cost: "win",
      gap: "1 | platformer | visual | clearer goal | improve.md | improve goal",
      disposition:
        "1 | framework change | over 20 lines | packages/core/src/viewport.ts | PRD-021 | n/a",
      gates: "pass",
    });
    await writeFile(file, closed);
    expect(nextRoundAction(root, file)).toMatchObject({ command: "close round 1" });

    await mkdir(path.join(root, "docs/PRDs"), { recursive: true });
    await writeFile(
      path.join(root, "docs/PRDs/PRD-021.md"),
      "---\nprd_contract: v1\n---\n\n**Status:** implementation in progress.\n",
    );
    expect(nextRoundAction(root, file)).toEqual({
      command: "implement PRD-021",
      reason: "PRD-021 is still open for gap #1; re-measure before closing the round.",
    });
  });

  it("names the first arm to build and counts the rest, rather than refusing to answer", async () => {
    // Two arms both needing work is the healthy shape of a paired round, not an ambiguity: a
    // round has two arms by construction, so any defect that affects both produces two
    // candidates. Refusing to answer there turned the loop's own "what next" command into a
    // throw the first time a real paired round reached it. Per-arm work is sequential -- nothing
    // here is skipped, and the count of what remains is reported rather than dropped.
    const root = await fixture();
    const file = await writeLedger(root, baseLedger());

    const action = nextRoundAction(root, file);

    // Assert which arm comes first, not merely that a count was printed. The property that makes
    // this safe is "returns the first candidate in arm order and drops none"; a regression that
    // reversed the order, or returned the second candidate, would satisfy the count alone.
    expect(action.command).toBe(
      "pnpm sandbox --bare --arm framework --genre platformer --name platformer-framework",
    );
    expect(action.reason).toMatch(/^Build the missing framework arm for platformer\./u);
    expect(action.reason).toMatch(/1 further arm action follows it\./u);
  });

  it("reports a PRD inside a batch folder as open", async () => {
    // PRDs are grouped into batch folders once a night's work is assembled, and `readdirSync`
    // does not recurse. An open PRD that moved into one did not merely go unreported: the loop
    // skipped straight to `close round N`, its terminal action, with the blocker still open.
    const root = await fixture();
    const framework = await archive(root, "framework", "framework", true, true);
    const vanilla = await archive(root, "vanilla", "vanilla", true, true);
    const closed = baseLedger({
      frameworkArchive: framework,
      frameworkProof: "2/2",
      frameworkVisual: "4",
      vanillaArchive: vanilla,
      vanillaProof: "2/2",
      vanillaVisual: "4",
      functional: "tie",
      visual: "loss",
      cost: "win",
      gap: "1 | platformer | visual | clearer goal | improve.md | improve goal",
      disposition:
        "1 | framework change | over 20 lines | packages/core/src/viewport.ts | PRD-021 | n/a",
      gates: "pass",
    });
    const file = await writeLedger(root, closed);
    await mkdir(path.join(root, "docs/PRDs/alpha-readiness"), { recursive: true });
    await writeFile(
      path.join(root, "docs/PRDs/alpha-readiness/PRD-021-in-a-batch.md"),
      "---\nprd_contract: v1\n---\n\n**Status:** implementation in progress.\n",
    );

    expect(nextRoundAction(root, file)).toMatchObject({ command: "implement PRD-021" });
  });

  it("does not reopen a PRD that was archived to docs/PRDs/done", async () => {
    // The mirror of the case above: recursing must not resurrect finished work. `done/` is where
    // a PRD goes when it closes, so a file there is not an open blocker.
    const root = await fixture();
    const framework = await archive(root, "framework", "framework", true, true);
    const vanilla = await archive(root, "vanilla", "vanilla", true, true);
    const file = await writeLedger(
      root,
      baseLedger({
        frameworkArchive: framework,
        frameworkProof: "2/2",
        frameworkVisual: "4",
        vanillaArchive: vanilla,
        vanillaProof: "2/2",
        vanillaVisual: "4",
        functional: "tie",
        visual: "loss",
        cost: "win",
        gap: "1 | platformer | visual | clearer goal | improve.md | improve goal",
        disposition:
          "1 | framework change | over 20 lines | packages/core/src/viewport.ts | PRD-021 | n/a",
        gates: "pass",
      }),
    );
    await mkdir(path.join(root, "docs/PRDs/done/night-watch"), { recursive: true });
    await writeFile(
      path.join(root, "docs/PRDs/done/night-watch/PRD-021-finished.md"),
      "---\nprd_contract: v1\n---\n\n**Status:** implementation in progress.\n",
    );

    expect(nextRoundAction(root, file)).toMatchObject({ command: "close round 1" });
  });

  it("stops instead of resuming a blocked round", async () => {
    const root = await fixture();
    const file = await writeLedger(root, baseLedger({ stop: "blocked" }));
    expect(nextRoundAction(root, file)).toEqual({
      command: "stop round 1",
      reason: "Stop condition recorded: blocked. Resolve it before resuming the round.",
    });
  });

  it("closes a visual-only round when screenshot evidence and measurement exist", async () => {
    const root = await fixture();
    const file = await writeVisualOnlyLedger(root);

    expect(nextRoundAction(root, file)).toEqual({
      command: "close round 11",
      reason: "All evidence and dispositions are recorded; close the round.",
    });
  });

  it.each([
    ["corrupt", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])],
    ["empty", Buffer.alloc(0)],
    ["text", Buffer.from("not an image\n")],
  ])("rejects %s bytes even when the file has a PNG name", async (_label, bytes) => {
    const root = await fixture();
    const file = await writeVisualOnlyLedger(root, { beforeBytes: bytes });

    expect(() => nextRoundAction(root, file)).toThrow(/invalid image bytes|screenshot evidence/u);
  });

  it.each(["before", "after"] as const)(
    "rejects a visual-only round when the %s archive lacks a visual-delta counterpart",
    async (missingArm) => {
      const root = await fixture();
      const file = await writeVisualOnlyLedger(root, {
        afterTemplate: missingArm === "after" ? "other" : "starter",
        beforeTemplate: missingArm === "before" ? "other" : "starter",
      });

      expect(() => nextRoundAction(root, file)).toThrow(
        new RegExp(`missing ${missingArm}.*starter`, "u"),
      );
    },
  );

  it("fails closed when a visual-only measurement is missing", async () => {
    const root = await fixture();
    const file = await writeVisualOnlyLedger(root, { measurement: false });

    expect(() => nextRoundAction(root, file)).toThrow(/visual-only.*measurement/u);
  });
});
