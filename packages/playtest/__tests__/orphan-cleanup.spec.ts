import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = path.resolve("packages/playtest/__tests__/orphan-cleanup.sh");

describe("orphan cleanup namespace", () => {
  it("counts only the suite-owned temporary namespace", async () => {
    const source = await readFile(script, "utf8");
    expect(source).toContain("TN_SUITE_TMPDIR");
    expect(source).toContain('find "$suite_temp_root" -mindepth 1 -maxdepth 1 -type d');
    expect(source).not.toContain("ls -d /tmp/threenative-*");
  });

  it("uses a private namespace when run outside the full suite", async () => {
    const source = await readFile(script, "utf8");
    expect(source).toContain("/tmp/threenative-orphan-suite.XXXXXX");
    expect(source).toContain("cleanup_temp_root");
  });

  it("preserves process-list separators for concurrent-lane detection", async () => {
    const source = await readFile(script, "utf8");
    expect(source).toContain('baseline_pids="$(ps -eo pid=)"');
    expect(source).not.toContain("ps -eo pid= | tr -d ' '");
  });
});
