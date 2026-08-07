import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
  const root = await mkdtemp(path.join(os.tmpdir(), "threenative-round-next-"));
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
      command: "pnpm sandbox --bare --arm framework --genre platformer",
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

  it("rejects two missing arms as ambiguous", async () => {
    const root = await fixture();
    const file = await writeLedger(root, baseLedger());
    expect(() => nextRoundAction(root, file)).toThrow(/eligible next actions/u);
  });

  it("stops instead of resuming a blocked round", async () => {
    const root = await fixture();
    const file = await writeLedger(root, baseLedger({ stop: "blocked" }));
    expect(nextRoundAction(root, file)).toEqual({
      command: "stop round 1",
      reason: "Stop condition recorded: blocked. Resolve it before resuming the round.",
    });
  });
});
