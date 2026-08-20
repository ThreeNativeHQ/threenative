import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import { findPersistentUnusedExports, renderDeletionTable } from "../round-deletions.js";

const roots: string[] = [];

async function fixtureRoot(): Promise<string> {
  const root = await makeTempDir("threenative-round-deletions-");
  roots.push(root);
  return root;
}

async function archive(
  root: string,
  name: string,
  arm: "framework",
  genre: string,
  extra = "",
): Promise<string> {
  const relative = `docs/benchmark/sweeps/${name}`;
  const directory = path.join(root, relative);
  await mkdir(path.join(directory, "src", "node"), { recursive: true });
  await mkdir(path.join(directory, "node_modules/@threenative/core/dist"), { recursive: true });
  await writeFile(
    path.join(directory, "node_modules/@threenative/core/dist/index.d.ts"),
    `${[
      "export declare const UsedExport: number;",
      "export declare const PersistentExport: number;",
      extra,
      "",
    ]
      .filter((line) => line !== "")
      .join("\n")}\n`,
  );
  await writeFile(
    path.join(directory, "src/main.ts"),
    'import { UsedExport } from "@threenative/core";\nvoid UsedExport;\n',
  );
  await mkdir(path.join(directory, "starter-baseline", "src"), { recursive: true });
  await writeFile(path.join(directory, "starter-baseline", "src", "main.ts"), "// starter\n");
  await writeFile(
    path.join(directory, "sweep.json"),
    JSON.stringify({
      arm,
      genre,
      briefHash: "brief",
      proofHash: "proof",
      template: "fixture",
      date: "2026-08-07T00:00:00.000Z",
      frameworkVersion: "0.1.0",
      sourceLines: 1,
    }),
  );
  return relative;
}

async function ledger(root: string, round: number, archivePath: string): Promise<void> {
  const rows = [
    `| exploration | framework | ${archivePath} | brief | proof | 1/1 | 4 | 10 | 1 | 1 |`,
    "| exploration | vanilla | unmeasured | brief | proof | unmeasured | unmeasured | unmeasured | unmeasured | n/a |",
  ];
  const markdown = [
    `# Improvement round ledger — round ${round} — 2026-08-07`,
    `Round: ${round}`,
    "Date: 2026-08-07",
    "Framework commit: working tree",
    "Framework version: 0.1.0",
    "Genres: exploration",
    "Budget: fixture",
    "Stop condition met: none yet",
    "Next action: continue",
    "",
    "## Arms",
    "| Genre | Arm | Archive | Brief SHA-256 | Proof SHA-256 | Proof passed/total | Instrument visual | User LOC | Source files | Reach rate |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Column verdicts",
    "| Genre | Functional | Visual | Cost | Verdict |",
    "| --- | --- | --- | --- | --- |",
    "| exploration | tie | tie | tie | tie |",
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
    "## Deletions this round",
    "| Export | Rounds unreached | Deleted? | Evidence |",
    "| --- | --- | --- | --- |",
    "| None | 0 | no | unmeasured |",
    "",
    "## Gates",
    "| Gate | Command | Result |",
    "| --- | --- | --- |",
    "| Typecheck | pnpm typecheck | pass |",
    "| Lint | pnpm lint | pass |",
    "| Test | pnpm test | pass |",
    "| Budgets | pnpm budgets | pass |",
    "",
    "## Firewall attestation",
    "| Rule | Held? | Evidence |",
    "| --- | --- | --- |",
    "| Arms built in separate contexts | yes | fixture |",
    "| Neither builder saw the sealed proofs | yes | fixture |",
    "| Judge was fresh, read-only, blind to arm | yes | fixture |",
    "| Lead agent wrote no game code | yes | fixture |",
    "",
    "## Notes",
    "Fixture contains two round ledgers and complete framework archives.",
  ].join("\n");
  await mkdir(path.join(root, "docs/verification"), { recursive: true });
  await writeFile(path.join(root, `docs/verification/round-${round}-2026-08-07.md`), markdown);
}

async function noArmsLedger(root: string, round: number): Promise<void> {
  const markdown = [
    `# Improvement round ledger — round ${round} — 2026-08-16`,
    `Round: ${round}`,
    "Date: 2026-08-16",
    "Framework commit: working tree",
    "Framework version: 0.1.0",
    "Genres: none — template visual baseline",
    "Budget: none",
    "Stop condition met: none",
    "Next action: run the paired visual comparison",
    "",
    "## Gap list",
    "| # | Column | Defect | Evidence | Smallest change |",
    "| --- | --- | --- | --- | --- |",
    "| None | None | None | None | None |",
    "",
    "## Dispositions",
    "| Gap # | Disposition | 20-line verdict | Named live caller | PRD | Reason if rejected |",
    "| --- | --- | --- | --- | --- | --- |",
    "| None | None | None | None | None | None |",
    "",
    "## Deletions this round",
    "| Export | Rounds unreached | Deleted? | Evidence |",
    "| --- | --- | --- | --- |",
    "| None | 0 | no | unmeasured |",
    "",
    "## Gates",
    "| Gate | Command | Result |",
    "| --- | --- | --- |",
    "| Typecheck | pnpm typecheck | pass |",
    "| Lint | pnpm lint | pass |",
    "| Test | pnpm test | pass |",
    "| Budgets | pnpm budgets | pass |",
    "",
    "## Firewall attestation",
    "| Rule | Held? | Evidence |",
    "| --- | --- | --- |",
    "| Arms built in separate contexts | yes | baseline |",
    "| Neither builder saw the sealed proofs | yes | baseline |",
    "| Judge was fresh, read-only, blind to arm | yes | baseline |",
    "| Lead agent wrote no game code | yes | baseline |",
    "",
    "## Notes",
    "This round declares that it ran no framework or vanilla arm.",
  ].join("\n");
  await mkdir(path.join(root, "docs/verification"), { recursive: true });
  await writeFile(path.join(root, `docs/verification/round-${round}-2026-08-16.md`), markdown);
}

describe("round:deletions", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("intersects unused exports across the current and previous framework rounds", async () => {
    const root = await fixtureRoot();
    const previous = await archive(root, "previous", "framework", "exploration");
    const current = await archive(
      root,
      "current",
      "framework",
      "exploration",
      "export declare const CurrentOnly: number;",
    );
    await ledger(root, 1, previous);
    await ledger(root, 2, current);

    const report = findPersistentUnusedExports(root);

    expect(report.currentRound).toBe(2);
    expect(report.previousRound).toBe(1);
    expect(report.archivesChecked).toHaveLength(2);
    expect(report.candidates).toEqual([
      {
        archives: [current, previous],
        exportName: "PersistentExport",
        roundsUnreached: 2,
      },
    ]);
    expect(renderDeletionTable(report)).toContain("PersistentExport | 2");
  });

  it("reports a declared no-arms round without inventing deletion evidence", async () => {
    const root = await fixtureRoot();
    const previous = await archive(root, "previous", "framework", "exploration");
    await ledger(root, 9, previous);
    await noArmsLedger(root, 10);

    const report = findPersistentUnusedExports(root);

    expect(report.noFrameworkArms).toEqual([10]);
    expect(report.archivesChecked).toHaveLength(1);
    expect(report.candidates).toEqual([]);
    expect(renderDeletionTable(report)).toContain(
      "Round 10: declared no-arms round; no framework archive rows",
    );
  });

  it("fails closed when a paired round is missing its framework arm", async () => {
    const root = await fixtureRoot();
    const previous = await archive(root, "previous", "framework", "exploration");
    const current = await archive(root, "current", "framework", "exploration");
    await ledger(root, 1, previous);
    await ledger(root, 2, current);
    const currentLedger = path.join(root, "docs/verification/round-2-2026-08-07.md");
    const markdown = await readFile(currentLedger, "utf8");
    await writeFile(currentLedger, markdown.replace(/^\| exploration \| framework \|.*\n/m, ""));

    expect(() => findPersistentUnusedExports(root)).toThrow(
      /Round 2 has no framework archive rows/u,
    );
  });

  it("fails closed when a normal genre has an empty Arms table", async () => {
    const root = await fixtureRoot();
    const previous = await archive(root, "previous", "framework", "exploration");
    const current = await archive(root, "current", "framework", "exploration");
    await ledger(root, 1, previous);
    await ledger(root, 2, current);
    const currentLedger = path.join(root, "docs/verification/round-2-2026-08-07.md");
    const markdown = await readFile(currentLedger, "utf8");
    await writeFile(
      currentLedger,
      markdown.replace(/^\| exploration \| (?:framework|vanilla) \|.*\n/gm, ""),
    );

    expect(() => findPersistentUnusedExports(root)).toThrow(
      /Round 2 has no framework archive rows/u,
    );
  });

  it("fails closed when a round still names a placeholder archive", async () => {
    const root = await fixtureRoot();
    const current = await archive(root, "current", "framework", "exploration");
    await ledger(root, 1, "unmeasured");
    await ledger(root, 2, current);

    expect(() => findPersistentUnusedExports(root)).toThrow(/placeholder archive/u);
  });
});
