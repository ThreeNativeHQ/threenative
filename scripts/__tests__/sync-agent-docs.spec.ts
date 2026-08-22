import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  agentsFiles,
  expandSharedRegions,
  mirrorContent,
  readSharedFragments,
  syncAgentDocs,
} from "../sync-agent-docs.js";

async function fixture(): Promise<string> {
  const root = await makeTempDir("threenative-agent-docs-");
  await writeFile(path.join(root, "AGENTS.md"), "# root rules\n");
  await mkdir(path.join(root, "packages", "core"), { recursive: true });
  await writeFile(path.join(root, "packages", "core", "AGENTS.md"), "# core rules\n");
  await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(path.join(root, "node_modules", "pkg", "AGENTS.md"), "# not ours\n");
  await mkdir(path.join(root, "target", "generated"), { recursive: true });
  await writeFile(path.join(root, "target", "generated", "AGENTS.md"), "# not ours\n");
  return root;
}

async function sharedFixture(markup: string): Promise<string> {
  const root = await makeTempDir("threenative-shared-agent-docs-");
  const template = path.join(root, "packages", "create-threenative", "templates", "starter");
  const fragments = path.join(root, "packages", "create-threenative", "agent-docs");
  await mkdir(template, { recursive: true });
  await mkdir(fragments, { recursive: true });
  await writeFile(path.join(fragments, "rule.md"), "## shared rule\n");
  await writeFile(path.join(template, "AGENTS.md"), markup);
  return root;
}

describe("sync-agent-docs", () => {
  it("should mirror every AGENTS.md and skip node_modules", async () => {
    const root = await fixture();
    try {
      expect(await agentsFiles(root)).toHaveLength(2);
      const first = await syncAgentDocs(root);
      expect(first.changed).toHaveLength(2);
      const mirrored = await readFile(path.join(root, "packages", "core", "CLAUDE.md"), "utf8");
      expect(mirrored).toContain("# core rules");
      expect(mirrored).toContain("Do not edit");
      const second = await syncAgentDocs(root);
      expect(second.changed).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should report drift in check mode without writing", async () => {
    const root = await fixture();
    try {
      await syncAgentDocs(root);
      await writeFile(path.join(root, "CLAUDE.md"), "# stale\n");
      const result = await syncAgentDocs(root, true);
      expect(result.changed).toEqual(["CLAUDE.md"]);
      await expect(readFile(path.join(root, "CLAUDE.md"), "utf8")).resolves.toBe("# stale\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should expand shared fragments before mirroring them", async () => {
    const root = await sharedFixture("<!-- shared: rule -->\nold body\n<!-- /shared -->\n");
    try {
      const first = await syncAgentDocs(root);
      expect(first.changed).toContain(
        path.join("packages", "create-threenative", "templates", "starter", "AGENTS.md"),
      );
      const agents = await readFile(
        path.join(root, "packages/create-threenative/templates/starter/AGENTS.md"),
        "utf8",
      );
      expect(agents).toContain("## shared rule");
      expect(agents).toContain("<!-- shared: rule -->");
      await expect(
        readFile(
          path.join(root, "packages/create-threenative/templates/starter/CLAUDE.md"),
          "utf8",
        ),
      ).resolves.toContain("## shared rule");
      expect((await syncAgentDocs(root)).changed).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should fail closed for an unknown shared fragment", async () => {
    const root = await sharedFixture(
      "<!-- shared: rule -->\nold body\n<!-- /shared -->\n<!-- shared: missing -->\nold body\n<!-- /shared -->\n",
    );
    try {
      await expect(syncAgentDocs(root)).rejects.toThrow("Unknown shared fragment 'missing'");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should fail closed when a shared fragment is unused", async () => {
    const root = await sharedFixture("<!-- shared: rule -->\nold body\n<!-- /shared -->\n");
    try {
      await writeFile(
        path.join(root, "packages/create-threenative/agent-docs/unused.md"),
        "## unused\n",
      );
      await expect(syncAgentDocs(root)).rejects.toThrow(
        "Shared fragment 'unused' is not included by any template AGENTS.md",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should fail closed for an unclosed shared fragment", async () => {
    const root = await sharedFixture("<!-- shared: rule -->\nold body\n");
    try {
      await expect(syncAgentDocs(root)).rejects.toThrow("Unclosed shared fragment 'rule'");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should generate every primary instruction mirror from its AGENTS source", async () => {
    // The primary instruction pairs — the docs an agent reads before any other — are pinned
    // individually so that loosening the repo-wide walk below cannot quietly let a hand-edited
    // CLAUDE.md pose as the rule. `syncAgentDocs` remains the only mirror writer.
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const fragments = await readSharedFragments(repoRoot);
    for (const agentsRelative of [
      "AGENTS.md",
      path.join("packages", "create-threenative", "AGENTS.md"),
    ]) {
      const agentsPath = path.join(repoRoot, agentsRelative);
      const claudePath = path.join(path.dirname(agentsPath), "CLAUDE.md");
      const expected = mirrorContent(
        expandSharedRegions(await readFile(agentsPath, "utf8"), fragments, agentsRelative),
      );
      await expect(readFile(claudePath, "utf8")).resolves.toBe(expected);
    }
  });

  it("should keep the repository mirrors in sync", async () => {
    const result = await syncAgentDocs(process.cwd(), true);
    expect(result.changed).toEqual([]);
    expect(result.checked.length).toBeGreaterThan(0);
    // Reads and compares 37 mirror pairs across the whole repository. Well under a second idle, past
    // the 5 s default when the machine is busy — which reported a timeout as a mirror drift and sent
    // me looking for a sync bug that was not there.
  }, 30_000);
});
