import fs from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  type RegistryProbe,
  alphaBar,
  pairedRoundRow,
  readEvidenceBlocks,
  renderTable,
  summariseAlphaBar,
  writeGeneratedTableFile,
  writeTable,
} from "../alpha-bar.js";

const roots: string[] = [];

const PACKAGES = [
  { dir: "core", name: "@threenative/core", version: "0.2.0" },
  { dir: "create-threenative", name: "create-threenative", version: "0.2.0" },
] as const;

/** Every package published at exactly the workspace version, so A1 is green by default. */
const registryHasEverything: RegistryProbe = (packageName) => {
  const found = PACKAGES.find((item) => item.name === packageName);
  return found === undefined ? "absent" : [found.version];
};

function write(root: string, relative: string, contents: string): string {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

function evidenceBlock(row: string, status: "fail" | "pass"): string {
  return [
    `# Evidence for ${row}`,
    "",
    "```alpha-bar",
    `row: ${row}`,
    `status: ${status}`,
    `detail: The ${row} run was observed.`,
    "source: pnpm some:gate --out report.json",
    "```",
    "",
  ].join("\n");
}

/** A round ledger with one genre, both arms archived, and every column decided. */
function roundLedger(root: string): void {
  for (const arm of ["framework", "vanilla"] as const) {
    const directory = path.join(root, `docs/benchmark/sweeps/${arm}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "sweep.json"),
      JSON.stringify({ arm, genre: "platformer" }),
    );
  }
  write(
    root,
    "docs/verification/round-4-2026-08-15.md",
    [
      "# Improvement round ledger — round 4 — 2026-08-15",
      "Round: 4",
      "Date: 2026-08-15",
      "Framework commit: working tree",
      "Framework version: 0.2.0",
      "Genres: platformer",
      "Budget: one bounded implementation slice",
      "Stop condition met: none yet",
      "Next action: continue",
      "",
      "## Arms",
      "| Genre | Arm | Archive | Brief SHA-256 | Proof SHA-256 | Proof passed/total | Instrument visual | User LOC | Source files | Reach rate |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| platformer | framework | docs/benchmark/sweeps/framework | brief | proof | 2/2 | 4 | 100 | 2 | 0.5 |",
      "| platformer | vanilla | docs/benchmark/sweeps/vanilla | brief | proof | 2/2 | 4 | 176 | 2 | n/a |",
      "",
      "## Column verdicts",
      "| Genre | Functional | Visual | Cost | Verdict |",
      "| --- | --- | --- | --- | --- |",
      "| platformer | tie | loss | win | vanilla wins the visual column |",
      "",
      "## Gap list",
      "| # | Genre | Column | What vanilla did better | Evidence | Smallest change that would close it |",
      "| --- | --- | --- | --- | --- | --- |",
      "| 1 | platformer | visual | clearer goal | captures | improve goal |",
      "",
      "## Dispositions",
      "| Gap # | Disposition | 20-line verdict | Named live caller | PRD | Reason if rejected |",
      "| --- | --- | --- | --- | --- | --- |",
      "| 1 | user space | under 20 lines | templates/platformer | n/a | n/a |",
      "",
      "## Deletions this round",
      "| Export | Rounds unreached | Deleted? | Evidence |",
      "| --- | --- | --- | --- |",
      "| None | 0 | no — nothing unreached | census |",
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
      "| Arms built in separate contexts | yes | builder-a and builder-b |",
      "| Neither builder saw the sealed proofs | yes | proofs copied after builds |",
      "| Judge was fresh, read-only, blind to arm | yes | external reveal and critic |",
      "| Lead agent wrote no game code | yes | orchestration only |",
      "",
      "## Notes",
      "Fixture round for the alpha-bar spec.",
    ].join("\n"),
  );
}

/** A visual-only before/after ledger that must not support a framework-versus-vanilla claim. */
function visualOnlyRoundLedger(root: string): void {
  write(
    root,
    "docs/verification/round-11-2026-08-19.md",
    [
      "# Improvement round ledger — round 11 — 2026-08-19",
      "Round: 11",
      "Date: 2026-08-19",
      "Framework commit: working tree",
      "Framework version: 0.2.0",
      "Round kind: visual-only",
      "Genres: template-visual",
      "Budget: screenshot-only fixture",
      "Stop condition met: none",
      "Next action: continue",
      "Visual MDE: 1",
      "",
      "## Visual deltas",
      "| Template | Before | After | Δ | Verdict |",
      "| --- | --- | --- | --- | --- |",
      "| starter | 2 | 2 | 0 | INDETERMINATE |",
      "",
      "## Arms",
      "| Genre | Arm | Archive | Brief SHA-256 | Proof SHA-256 | Proof passed/total | Instrument visual | User LOC | Source files | Reach rate |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| template-visual | before | docs/verification/visuals/before | prompt | prompt | 7/7 | 4 | n/a | 7 | n/a |",
      "| template-visual | after | docs/verification/visuals/after | prompt | prompt | 7/7 | 4 | n/a | 7 | n/a |",
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
      "This visual-only fixture has numeric screenshots and deltas but is not a value pair.",
    ].join("\n"),
  );
}

/** Two parity ledgers whose recorded cells match the reports they name. */
function parityLedgers(root: string): void {
  for (const [file, target] of [
    ["docs/verification/parity-2026-08-10-r2.md", "Desktop Linux"],
    ["docs/verification/tier-1-2026-08-10.md", "Android emulator"],
  ] as const) {
    const report = path.join(root, `reports/${target.replaceAll(" ", "-")}.json`);
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, JSON.stringify({ summary: { blocked: 0, fail: 0, pass: 66 } }));
    write(
      root,
      file,
      [
        `# ${target} parity`,
        "",
        "## Target results",
        "| Target | Command | Pass | Fail | Blocked | Exit | Outcome |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        `| ${target} | \`node run-conformance.mjs --out ${report}\` | 66 | 0 | 0 | 0 | green |`,
        "",
      ].join("\n"),
    );
  }
}

async function fixture(): Promise<string> {
  const root = await makeTempDir("threenative-alpha-bar-");
  roots.push(root);
  for (const item of PACKAGES)
    write(
      root,
      `packages/${item.dir}/package.json`,
      JSON.stringify({ name: item.name, version: item.version }),
    );
  write(root, "docs/verification/a2-2026-08-15.md", evidenceBlock("A2", "pass"));
  write(root, "docs/verification/a3-2026-08-15.md", evidenceBlock("A3", "pass"));
  write(root, "docs/verification/a6-2026-08-15.md", evidenceBlock("A6", "pass"));
  roundLedger(root);
  parityLedgers(root);
  write(
    root,
    "docs/PRDs/alpha-readiness/README.md",
    "# Batch\n\n<!-- BEGIN GENERATED: alpha-bar -->\n<!-- END GENERATED: alpha-bar -->\n\nTail.\n",
  );
  return root;
}

type AlphaBarReport = Awaited<ReturnType<typeof alphaBar>>;

/** Regenerates the README table, exactly as `pnpm alpha:bar --write` does. */
function writeGeneratedTable(root: string, report: AlphaBarReport): void {
  const file = path.join(root, "docs/PRDs/alpha-readiness/README.md");
  const rows = report.rows.filter((row) => row.id !== "A7");
  fs.writeFileSync(file, writeTable(fs.readFileSync(file, "utf8"), renderTable(rows), file));
}

async function greenBar(root: string): Promise<AlphaBarReport> {
  writeGeneratedTable(root, await alphaBar({ registry: registryHasEverything, repo: root }));
  return alphaBar({ registry: registryHasEverything, repo: root });
}

describe("pnpm alpha:bar", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it("exits 0 only when every row passes", async () => {
    const root = await fixture();
    const green = await greenBar(root);
    expect(green.rows.filter((row) => row.status !== "pass")).toEqual([]);
    expect(green.exitCode).toBe(0);
  });

  it("exits 2 when a row's evidence file is absent", async () => {
    const root = await fixture();
    await greenBar(root);
    await rm(path.join(root, "docs/verification/a6-2026-08-15.md"));
    const after = await alphaBar({ registry: registryHasEverything, repo: root });
    const a6 = after.rows.find((row) => row.id === "A6");
    expect(a6?.status).toBe("unmeasured");
    expect(a6?.detail).toMatch(/No alpha-bar evidence block for A6/u);
    expect(after.exitCode).toBe(2);
  });

  it("exits 2, not 1, when a row is unmeasured and another row fails", async () => {
    // Not knowing outranks knowing the answer is no. A bar that reported 1 here would let a
    // missing measurement hide behind a failure somebody is already tracking.
    const root = await fixture();
    await greenBar(root);
    await rm(path.join(root, "docs/verification/a6-2026-08-15.md"));
    const after = await alphaBar({
      registry: (name) => (name === "create-threenative" ? "absent" : registryHasEverything(name)),
      repo: root,
    });
    expect(after.failed).toBeGreaterThan(0);
    expect(after.unmeasured).toBeGreaterThan(0);
    expect(after.exitCode).toBe(2);
  });

  it("exits 1 when a row's check fails", async () => {
    const root = await fixture();
    await greenBar(root);
    const after = await alphaBar({
      registry: (name) => (name === "create-threenative" ? "absent" : registryHasEverything(name)),
      repo: root,
    });
    const a1 = after.rows.find((row) => row.id === "A1");
    expect(a1?.status).toBe("fail");
    expect(a1?.detail).toMatch(/create-threenative/u);
    expect(after.exitCode).toBe(1);
  });

  it("reports unmeasured, never a fail, when the registry cannot be reached", async () => {
    const root = await fixture();
    await greenBar(root);
    const after = await alphaBar({ registry: () => "unreachable", repo: root });
    expect(after.rows.find((row) => row.id === "A1")?.status).toBe("unmeasured");
    expect(after.exitCode).toBe(2);
  });

  it("fails A1 when a package exists but the workspace version is unpublished", async () => {
    const root = await fixture();
    await greenBar(root);
    const after = await alphaBar({ registry: () => ["0.0.1"], repo: root });
    const a1 = after.rows.find((row) => row.id === "A1");
    expect(a1?.status).toBe("fail");
    expect(a1?.detail).toMatch(/Unpublished workspace version\(s\).*0\.2\.0/u);
  });

  it("refuses a row with no evidence source", () => {
    const row = {
      detail: "Everything looks fine.",
      evidence: "  ",
      id: "A9",
      requirement: "Something is true",
      status: "pass",
    } as const;
    expect(() => summariseAlphaBar([row])).toThrow(/TN_ALPHA_ROW_NO_EVIDENCE/u);
  });

  it("refuses a row sourced from a PRD status line", () => {
    const row = {
      detail: "The PRD says it is done.",
      evidence: "docs/PRDs/alpha-readiness/PRD-119-the-alpha-release-train.md",
      id: "A1",
      requirement: "A stranger can install it",
      status: "pass",
    } as const;
    expect(() => summariseAlphaBar([row])).toThrow(/TN_ALPHA_ROW_PRD_SOURCED/u);
  });

  it("refuses an empty row set", () => {
    expect(() => summariseAlphaBar([])).toThrow(/TN_ALPHA_BAR_EMPTY/u);
  });

  it("throws on a malformed evidence block rather than emitting a partial row", async () => {
    const root = await fixture();
    write(
      root,
      "docs/verification/broken-2026-08-15.md",
      "```alpha-bar\nrow: A2\nstatus: pass\n```\n",
    );
    expect(() => readEvidenceBlocks(path.join(root, "docs/verification"))).toThrow(
      /TN_ALPHA_EVIDENCE_MALFORMED: .*without 'source'/u,
    );
  });

  it("throws on an evidence block whose source is a PRD", async () => {
    const root = await fixture();
    write(
      root,
      "docs/verification/prd-sourced-2026-08-15.md",
      [
        "```alpha-bar",
        "row: A2",
        "status: pass",
        "detail: The PRD says the golden path is fine.",
        "source: docs/PRDs/alpha-readiness/PRD-078-toolchain-free-consumer-proof.md",
        "```",
        "",
      ].join("\n"),
    );
    expect(() => readEvidenceBlocks(path.join(root, "docs/verification"))).toThrow(
      /TN_ALPHA_EVIDENCE_PRD_SOURCED/u,
    );
  });

  it("reports unmeasured when two evidence blocks for the same row disagree", async () => {
    const root = await fixture();
    await greenBar(root);
    write(root, "docs/verification/zz-a6-2026-08-16.md", evidenceBlock("A6", "fail"));
    const after = await alphaBar({ registry: registryHasEverything, repo: root });
    const a6 = after.rows.find((row) => row.id === "A6");
    expect(a6?.status).toBe("unmeasured");
    expect(a6?.detail).toMatch(/disagree/u);
  });

  it("reverts a hand edit to the generated README table", async () => {
    const root = await fixture();
    const file = path.join(root, "docs/PRDs/alpha-readiness/README.md");
    const green = await greenBar(root);
    expect(green.rows.find((row) => row.id === "A7")?.status).toBe("pass");
    const generated = fs.readFileSync(file, "utf8");

    fs.writeFileSync(file, generated.replace(/\*\*green\*\*/u, "**alpha, obviously**"));
    const edited = await alphaBar({ registry: registryHasEverything, repo: root });
    expect(edited.rows.find((row) => row.id === "A7")?.status).toBe("fail");
    expect(edited.exitCode).toBe(1);

    writeGeneratedTable(root, edited);
    expect(fs.readFileSync(file, "utf8")).toBe(generated);
  });

  it("refuses to generate into a README with no marker pair", async () => {
    const root = await fixture();
    const file = path.join(root, "docs/PRDs/alpha-readiness/README.md");
    fs.writeFileSync(file, "# Batch\n\nNo markers here.\n");
    const after = await alphaBar({ registry: registryHasEverything, repo: root });
    const a7 = after.rows.find((row) => row.id === "A7");
    expect(a7?.status).toBe("unmeasured");
    expect(a7?.detail).toMatch(/TN_ALPHA_TABLE_MARKERS_MISSING/u);
  });

  it("creates a generated README when the baseline file is missing", async () => {
    const root = await makeTempDir("threenative-alpha-write-");
    roots.push(root);
    const file = path.join(root, "docs/PRDs/alpha-readiness/README.md");
    const rows = [
      {
        detail: "The registry query passed.",
        evidence: "npm view @threenative/core versions --json",
        id: "A1",
        requirement: "A stranger can install it",
        status: "pass",
      },
    ] as const;

    writeGeneratedTableFile(file, renderTable(rows));

    expect(fs.readFileSync(file, "utf8")).toBe(`${renderTable(rows)}\n`);
  });

  it("reports A4 unmeasured, not failed, when a round ledger cannot be parsed", async () => {
    const root = await fixture();
    await greenBar(root);
    write(root, "docs/verification/round-5-2026-08-16.md", "# Round 5\n\nNot a ledger.\n");
    const after = await alphaBar({ registry: registryHasEverything, repo: root });
    const a4 = after.rows.find((row) => row.id === "A4");
    expect(a4?.status).toBe("unmeasured");
    expect(a4?.detail).toMatch(/round-5-2026-08-16\.md/u);
  });

  it("does not count a measured visual-only ledger as a framework-versus-vanilla pair", async () => {
    const root = await makeTempDir("threenative-alpha-visual-only-");
    roots.push(root);
    visualOnlyRoundLedger(root);

    const a4 = pairedRoundRow(root);

    expect(a4.status).toBe("fail");
    expect(a4.detail).toMatch(/visual-only.*framework-versus-vanilla/u);
  });

  it("fails A5 when the current ledger records an exit code its own report contradicts", async () => {
    const root = await fixture();
    await greenBar(root);
    // tier-1-2026-08-10.md sorts last of the fixture's ledgers, so it is the current one.
    const ledger = path.join(root, "docs/verification/tier-1-2026-08-10.md");
    fs.writeFileSync(
      ledger,
      fs.readFileSync(ledger, "utf8").replace("| 66 | 0 | 0 | 0 |", "| 66 | 0 | 1 | 0 |"),
    );
    const after = await alphaBar({ registry: registryHasEverything, repo: root });
    const a5 = after.rows.find((row) => row.id === "A5");
    expect(a5?.status).toBe("fail");
    expect(a5?.detail).toMatch(/current ledger tier-1-2026-08-10\.md has \d+ finding/u);
  });

  it("fails A5 when an older ledger contradicts the current one and is not marked superseded", async () => {
    // The row's real subject. A stale ledger that still claims to be current is an unresolved
    // disagreement — which is exactly the state PRD-076 existed to end.
    const root = await fixture();
    await greenBar(root);
    const stale = path.join(root, "docs/verification/parity-2026-08-10-r2.md");
    fs.writeFileSync(
      stale,
      fs.readFileSync(stale, "utf8").replace("| 66 | 0 | 0 | 0 |", "| 66 | 0 | 1 | 0 |"),
    );
    const after = await alphaBar({ registry: registryHasEverything, repo: root });
    const a5 = after.rows.find((row) => row.id === "A5");
    expect(a5?.status).toBe("fail");
    expect(a5?.detail).toMatch(/superseded-but-unmarked/u);
  });

  it("accepts an older contradicting ledger once it is marked SUPERSEDED", async () => {
    // And the other half: marking it must actually change the answer, or the marker is decoration.
    const root = await fixture();
    await greenBar(root);
    const stale = path.join(root, "docs/verification/parity-2026-08-10-r2.md");
    const broken = fs
      .readFileSync(stale, "utf8")
      .replace("| 66 | 0 | 0 | 0 |", "| 66 | 0 | 1 | 0 |");
    fs.writeFileSync(stale, broken);
    expect(
      (await alphaBar({ registry: registryHasEverything, repo: root })).rows.find(
        (row) => row.id === "A5",
      )?.status,
    ).toBe("fail");

    fs.writeFileSync(stale, `> **SUPERSEDED by the later run.**\n\n${broken}`);
    const after = await alphaBar({ registry: registryHasEverything, repo: root });
    expect(after.rows.find((row) => row.id === "A5")?.status).toBe("pass");
  });
});
