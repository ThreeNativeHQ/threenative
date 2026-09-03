import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allTemplates } from "../../test-support/templates.js";

const repo = path.resolve(import.meta.dirname, "../..");
const workflows = [
  ".github/workflows/ci.yml",
  ".github/workflows/native-platforms.yml",
  ".github/workflows/native-release.yml",
  ".github/workflows/npm-release.yml",
] as const;

function jobSections(source: string): readonly [string, string][] {
  const jobsIndex = source.indexOf("\njobs:\n");
  if (jobsIndex < 0) throw new Error("CI workflow did not include a jobs mapping.");
  const jobs = source.slice(jobsIndex);
  const matches = [...jobs.matchAll(/^ {2}([A-Za-z0-9_-]+):\n/gm)];
  return matches.map((match, index) => {
    const name = match[1];
    if (name === undefined) throw new Error("CI job heading did not include a name.");
    return [name, jobs.slice(match.index, matches[index + 1]?.index ?? jobs.length)];
  });
}

function requiredJob(source: string, name: string): string {
  const section = jobSections(source).find(([job]) => job === name)?.[1];
  if (section === undefined) throw new Error(`CI job ${name} was not found.`);
  return section;
}

function occurrences(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

function triggerSection(source: string): string {
  const jobsIndex = source.indexOf("\njobs:\n");
  if (jobsIndex < 0) throw new Error("CI workflow did not include a jobs mapping.");
  return source.slice(0, jobsIndex);
}

function kvmProvisioning(source: string): readonly string[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.includes('KERNEL=="kvm"') ||
        line === "| sudo tee /etc/udev/rules.d/99-kvm4all.rules" ||
        line === "sudo udevadm control --reload-rules" ||
        line === "sudo udevadm trigger --name-match=kvm",
    );
}

/**
 * Which templates a matrix job actually covers.
 *
 * These assertions used to match `- <template>` in the job text, which read the matrix only while
 * the matrix was a bare list of names. `template-nonvisual` shards its two heavy templates now, so
 * an entry is `- { template: platformer, shard: "1/2" }` and the old match found nothing while the
 * coverage it was checking was unchanged. Reading the entries is what the assertion always meant.
 */
function matrixTemplates(section: string): readonly string[] {
  const listed = [...section.matchAll(/^\s+-\s+([a-z][a-z0-9-]*)\s*$/gmu)].map(
    (match) => match[1] ?? "",
  );
  const included = [...section.matchAll(/^\s+-\s*\{[^}]*\btemplate:\s*([a-z][a-z0-9-]*)/gmu)].map(
    (match) => match[1] ?? "",
  );
  return [...new Set([...listed, ...included])].sort();
}

// Read off disk, so the matrix is required to list a kit the day that kit ships rather than the
// day somebody remembers to extend a list here. The assertion that matters is below: every
// template on disk must appear in the workflow's matrix.
const expectedTemplates = allTemplates();

describe("CI pipeline structure", () => {
  it("syncs capability artifacts on relevant commits and rejects stale manifests in CI", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const hook = await readFile(path.join(repo, "githooks/pre-commit"), "utf8");

    expect(packageJson.scripts["capabilities:sync"]).toContain("build-capability-manifest.ts");
    expect(packageJson.scripts["capabilities:sync"]).toContain("generate-capability-reference.ts");
    expect(packageJson.scripts["capabilities:check"]).toContain(
      "build-capability-manifest.ts --check",
    );
    expect(packageJson.scripts.budgets).toContain("pnpm capabilities:check");
    expect(hook).toContain("git diff --cached --name-only");
    expect(hook).toContain("packages/[^/]+/(src/.*|package\\.json)");
    expect(hook).toContain("pnpm capabilities:sync");
    expect(hook).toContain("git add --");
    expect(hook).not.toContain("git add -A");
    expect(hook).not.toContain("git add .");
  });

  it("no job cancels its own run, because that erases which gate went red", async () => {
    // The mechanism this replaces called `POST /actions/runs/$GITHUB_RUN_ID/cancel` from an
    // `if: failure()` step inside the job that had just failed. A run-level cancel re-marks every
    // in-flight job `cancelled` — the caller included — so on 2026-09-02 a flaky `test-browser`
    // produced eleven cancelled checks, zero failures, and a pull request that could not say what
    // broke; `gh run rerun --failed` then had nothing marked failed to re-run.
    //
    // Its predecessor was worse still: it swept every in_progress and queued run in the
    // repository and cancelled any whose branch looked like a PRD lane, so on 2026-09-01 one red
    // native job took out six runs across four branches in twenty seconds. Neither form comes
    // back. The saving was runner minutes; the price was the only thing a red run produces.
    await expect(stat(path.join(repo, ".github/actions/cancel-run-on-failure"))).rejects.toThrow();
    for (const relative of workflows) {
      const source = await readFile(path.join(repo, relative), "utf8");
      expect(source, relative).not.toContain("cancel-run-on-failure");
      expect(source, `${relative} cancels its own run`).not.toContain(
        "actions/runs/$GITHUB_RUN_ID/cancel",
      );
      // Nothing left here calls the Actions API, so nothing may ask to write to it.
      expect(source, `${relative} needs no actions: write`).not.toContain("actions: write");
    }

    // Fail-fast that keeps its evidence: a matrix reports every leg, and an expensive job is
    // skipped by its `needs:` edge rather than cancelled out from under itself.
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain("fail-fast: false");
    expect(ci).toContain("needs: build");
  });

  it("hands the emulator action a one-line script, so the arguments survive", async () => {
    // `android-emulator-runner` runs `script` through the emulator shell a line at a time. A
    // `\`-continued command therefore loses everything after its first line, and from 2026-09-01
    // this lane ran `run-conformance.mjs` with no arguments at all: `--target` defaulted to `all`,
    // so one `--target android` invocation wrote web, desktop, android and ios reports under the
    // default `artifacts/conformance`, overwrote the web reference the lane had just captured, and
    // then compared the emulator against the wreckage. The step read as correct in the YAML the
    // whole time — `>-` folds to one line and `|` does not, and only that character separates a
    // working lane from a silent one.
    const source = await readFile(
      path.join(repo, ".github/workflows/native-platforms.yml"),
      "utf8",
    );
    const blocks = [...source.matchAll(/^(\s+)script: *(\||>-|>|\|-)\n/gmu)].map((match) => {
      const indent = match[1]?.length ?? 0;
      const rest = source.slice((match.index ?? 0) + match[0].length).split("\n");
      const body: string[] = [];
      for (const line of rest) {
        if (line.trim() !== "" && line.length - line.trimStart().length <= indent) break;
        body.push(line);
      }
      return { body: body.join("\n"), style: match[2] ?? "" };
    });
    expect(blocks.length, "no emulator script block found to check").toBeGreaterThan(0);
    for (const { body, style } of blocks) {
      // `|` keeps every newline, which is exactly what the action cannot take.
      expect(style, `script uses a literal block: ${body.trim().slice(0, 60)}`).not.toMatch(/^\|/u);
      expect(body, "script continues with a backslash").not.toMatch(/\\\s*\n/u);
      expect(body, "script lost its target").toContain("--target android");
      expect(body, "script lost its output path").toContain("--out ");
    }
  });

  it("caches what the Android lane would otherwise re-download every run", async () => {
    // Measured on run 33675488456: ~6 min re-installing SDK/emulator packages and ~5 min on the
    // Gradle build plus the Rust cross-compile, in a 35 min job. `third_party` was already cached
    // and restored in about 4 s; these three simply had no cache step at all.
    const source = await readFile(
      path.join(repo, ".github/workflows/native-platforms.yml"),
      "utf8",
    );
    const android = requiredJob(source, "android-emulator-parity");
    for (const [what, needle] of [
      ["the Android SDK packages", "system-images/android-35"],
      ["the Gradle caches", "~/.gradle/caches"],
      ["the Rust cross-compile output", ".runtime/physics-target"],
    ] as const) {
      expect(android, `the Android lane stopped caching ${what}`).toContain(needle);
    }
    // The cargo key has to follow the lockfile that actually drives the build; a `**/Cargo.lock`
    // glob would also hash third_party's and miss on churn that changes nothing here.
    expect(android).toContain("packages/runtime-native/native/physics/Cargo.lock");
  });

  it("bounds every runner job with an explicit timeout", async () => {
    for (const relative of workflows) {
      const source = await readFile(path.join(repo, relative), "utf8");
      for (const [job, section] of jobSections(source)) {
        if (section.includes("runs-on:"))
          expect(section, `${relative} ${job}`).toContain("timeout-minutes:");
      }
    }
  });

  it("keeps ordinary CI scoped to main and serializes release lanes", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const npm = await readFile(path.join(repo, ".github/workflows/npm-release.yml"), "utf8");
    const native = await readFile(path.join(repo, ".github/workflows/native-release.yml"), "utf8");
    expect(ci).toMatch(/push:\n\s+branches:\n\s+- main/u);
    expect(ci).toMatch(/pull_request:\n\s+branches:\n\s+- main/u);
    expect(ci).toContain("group: ci-${{ github.ref }}");
    expect(native).toContain("group: native-release-${{ github.ref }}");
    expect(native).toMatch(/gh run list .*--workflow ci\.yml --commit/u);
    expect(npm).toContain('gh release view "runtime-native-v${native_version}"');
  });

  // A `gh` call infers its repository from a git checkout. A job that never checks out has
  // none, so `gh` dies with "failed to determine base repo" — and a gate that dies is a gate
  // that never asked its question. `native-release.yml`'s CI gate shipped that way and could
  // not be caught by anything: the workflow runs only on a `runtime-native-v*` tag, and the
  // first such tag ever pushed was the one that exposed it.
  // A `gh` call infers its repository from a git checkout. A job that never checks out has
  // none, so `gh` dies with "failed to determine base repo" -- and a gate that dies is a gate
  // that never asked its question. The native release's CI gate shipped that way and nothing
  // could have caught it: that workflow runs only on a `runtime-native-v*` tag, and the first
  // such tag ever pushed was the one that exposed it.
  it("passes an explicit repository to every gh call in a job that never checks out", async () => {
    const offenders: string[] = [];
    for (const relative of workflows) {
      const source = await readFile(path.join(repo, relative), "utf8");
      for (const [job, section] of jobSections(source)) {
        if (section.includes("uses: actions/checkout")) continue;
        // Read whole commands, not lines: a flag may sit on a continuation line, and a `#`
        // line is prose. Both were false readings of this same section.
        const lines = section.split("\n").filter((line) => !/^\s*#/u.test(line));
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? "";
          if (!/(?:^|[\s"'`(|&;$])gh\s+(?:api|run|release|pr|issue|workflow|cache)\b/u.test(line))
            continue;
          let command = line;
          for (let next = index + 1; next < lines.length; next += 1) {
            const continuation = lines[next] ?? "";
            const continued =
              command.trimEnd().endsWith("\\") || /^\s*-{1,2}\w/u.test(continuation);
            if (!continued) break;
            command += ` ${continuation}`;
          }
          if (command.includes("--repo")) continue;
          offenders.push(`${relative} ${job}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("requires the matching native release for a publishing dispatch", async () => {
    const npm = await readFile(path.join(repo, ".github/workflows/npm-release.yml"), "utf8");
    const publish = jobSections(npm).find(([job]) => job === "publish")?.[1];
    expect(publish).toContain("if: github.event_name == 'push' || inputs.dry_run == false");
  });

  it("requires the matching native release to be published and ready", async () => {
    const npm = await readFile(path.join(repo, ".github/workflows/npm-release.yml"), "utf8");
    const publish = jobSections(npm).find(([job]) => job === "publish")?.[1];
    expect(publish).toContain("--json isDraft,isPrerelease");
    expect(publish).toContain(".isDraft == false and .isPrerelease == false");
    expect(publish).toMatch(/\$\{release_state\}" != "ready"/u);
  });

  it("requires native release CI to be a successful push on main", async () => {
    const native = await readFile(path.join(repo, ".github/workflows/native-release.yml"), "utf8");
    const gates = jobSections(native).find(([job]) => job === "gates")?.[1];
    expect(gates).toContain("--json status,conclusion,event,headBranch");
    expect(gates).toMatch(/\.event == "push"/u);
    expect(gates).toMatch(/\.headBranch == "main"/u);
  });

  it("desktop parity runs against a captured web reference and fails closed", async () => {
    const native = await readFile(
      path.join(repo, ".github/workflows/native-platforms.yml"),
      "utf8",
    );
    const desktop = requiredJob(native, "desktop-parity");
    expect(desktop).toContain("timeout-minutes: 75");
    const capture = desktop.indexOf("--target web --out artifacts/conformance/web");
    const comparison = desktop.indexOf(
      "--target desktop --reference artifacts/conformance/web --out artifacts/conformance/desktop",
    );
    expect(capture).toBeGreaterThanOrEqual(0);
    expect(comparison).toBeGreaterThan(capture);
    expect(capture).toBeLessThan(desktop.indexOf("Install Linux desktop build dependencies"));
    expect(desktop).toMatch(
      /sh scripts\/xvfb\.sh \\\n\s+node packages\/runtime-native\/conformance\/run-conformance\.mjs \\\n\s+--target desktop/u,
    );
    expect(occurrences(desktop, /test "\$status" -eq 0 -o "\$status" -eq 2/gu)).toBe(2);
    expect(occurrences(desktop, /check-lane-blocks\.mjs/gu)).toBe(2);
    expect(desktop).toContain("TN_PARITY_DESKTOP_REPORT_MISSING");
    expect(desktop).toContain('"## Target results"');
    expect(desktop).toContain("pnpm parity:ledger");
    expect(desktop).toContain("if-no-files-found: error");
  });

  it("Android parity lets the ledger classify expected blocked rows", async () => {
    const native = await readFile(
      path.join(repo, ".github/workflows/native-platforms.yml"),
      "utf8",
    );
    const android = requiredJob(native, "android-emulator-parity");
    const emulator = android.slice(
      android.indexOf("- name: Run checksum-locked APKs on the emulator"),
      android.indexOf("- name: Verify captured parity ledger"),
    );

    // The tolerance stays; the line break that used to carry it does not. This assertion asked
    // for `run-conformance.mjs \<newline> --target android` — it pinned the very shape that made
    // the action drop every argument after the first line. See "hands the emulator action a
    // one-line script": the whole invocation has to reach the emulator shell as one command.
    expect(emulator).toMatch(/run-conformance\.mjs --target android\b/u);
    expect(emulator).not.toMatch(/\\\s*\n/u);
    expect(emulator).toContain("status=$?");
    expect(emulator).toContain('test "$status" -eq 0 -o "$status" -eq 2');
    expect(android).toContain("check-lane-blocks.mjs");
  });

  it("every template's non-visual scenarios run on main pushes and nightly", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const job = requiredJob(ci, "template-nonvisual");
    // Runs on every event since 2026-09-01 (owner call): the PR skip reported nothing on the
    // branch where the regression was written, and the merge that shipped it reported too late.
    expect(job).not.toContain("github.event_name == 'push'");
    expect(job).not.toContain("pull_request");
    expect(job).toContain('TN_PLAYTEST_ALLOW_SOFTWARE: "1"');
    expect(job).toContain("non-visual-scenarios.mjs");
    expect(job).toContain("threenative-playtest");
    expect(matrixTemplates(job)).toEqual([...expectedTemplates].sort());

    const templateRoot = path.join(repo, "packages/create-threenative/templates");
    const actualTemplates = [...expectedTemplates].sort();
    expect(actualTemplates.length, "no template was discovered").toBeGreaterThanOrEqual(8);
    for (const template of actualTemplates) {
      const result = spawnSync(
        process.execPath,
        [path.join(repo, "scripts/non-visual-scenarios.mjs"), path.join(templateRoot, template)],
        { encoding: "utf8" },
      );
      expect(result.status, `${template}: ${result.stderr}`).toBe(0);
      expect(result.stdout.trim(), `${template}: classifier returned no scenarios`).not.toBe("");
    }
  });

  // Sharding a lane is how coverage disappears without anyone noticing: a slice that selects
  // nothing, or two slices that miss the same scenario, both report green. The step's own
  // arithmetic is the guard at run time; this is the guard on the matrix that feeds it.
  it("shards every template across slices that add back up to one whole", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const job = requiredJob(ci, "template-nonvisual");

    const entries = [
      ...job.matchAll(
        /^\s+-\s*\{\s*template:\s*([a-z][a-z0-9-]*)\s*,\s*shard:\s*"(\d+)\/(\d+)"/gmu,
      ),
    ].map((match) => ({
      template: match[1] ?? "",
      index: Number(match[2]),
      count: Number(match[3]),
    }));
    expect(entries.length, "template-nonvisual declares no shards").toBeGreaterThan(0);

    const byTemplate = new Map<string, number[]>();
    for (const { template, index, count } of entries) {
      expect(index, `${template} shard index`).toBeGreaterThanOrEqual(1);
      expect(index, `${template} shard ${index}/${count} is out of range`).toBeLessThanOrEqual(
        count,
      );
      const seen = byTemplate.get(template) ?? [];
      expect(seen, `${template} declares shard ${index} twice`).not.toContain(index);
      byTemplate.set(template, [...seen, index]);
    }

    // Every template names one shard count, and every slice of it exists exactly once — so the
    // slices are a partition, not a sample.
    for (const [template, indices] of byTemplate) {
      const counts = new Set(entries.filter((e) => e.template === template).map((e) => e.count));
      expect(counts.size, `${template} mixes shard counts`).toBe(1);
      const [count] = [...counts];
      expect(
        indices.sort((left, right) => left - right),
        `${template} is missing a shard`,
      ).toEqual(Array.from({ length: count ?? 0 }, (_, offset) => offset + 1));
    }

    // And the step must refuse a slice that selected nothing rather than report on an empty set.
    expect(job).toContain('test "${#mine[@]}" -gt 0');
    expect(job).toContain("non-visual-scenarios.mjs");
  });

  it("PR CI reviews dependencies and scans changed commits for leaked secrets", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const supplyChain = requiredJob(ci, "supply-chain");
    // Runs on pushes too since 2026-09-01 (owner call): a skipped job on main read as a pass.
    expect(supplyChain).toContain(
      "if: github.event_name == 'pull_request' || github.event_name == 'push'",
    );
    expect(supplyChain).toContain("uses: actions/dependency-review-action@v4");
    // ...but the dependency diff itself stays pull_request-only: it needs a base ref and a head
    // ref, which a push does not supply, and ungating it made every push-to-main run red.
    expect(
      supplyChain,
      "dependency-review must stay pull_request-only; on push it has no base/head ref",
    ).toContain(
      "- uses: actions/dependency-review-action@v4\n        if: github.event_name == 'pull_request'",
    );
    expect(supplyChain).toContain("fail-on-severity: moderate");
    expect(supplyChain).not.toContain("allow-licenses");
    expect(supplyChain).toContain("fetch-depth: 0");
    expect(supplyChain).toContain("ghcr.io/gitleaks/gitleaks@sha256:");
    expect(supplyChain).toContain("github.event.pull_request.base.sha");
    expect(supplyChain).toContain("Scan the full git history for leaked secrets");
    expect(supplyChain).toContain("github.event.pull_request.head.sha");
    expect(supplyChain).toContain('git rev-list --count "$range"');
    expect(supplyChain).toContain("git --redact --verbose");
    expect(supplyChain).toContain('--log-opts="$TN_GITLEAKS_RANGE"');
  });

  it("a nightly run exists on both gated workflows", async () => {
    for (const relative of [".github/workflows/ci.yml", ".github/workflows/native-platforms.yml"]) {
      const source = await readFile(path.join(repo, relative), "utf8");
      expect(triggerSection(source), relative).toMatch(
        /schedule:\n\s+- cron: ["']17 3 \* \* \*["']/u,
      );
    }
  });

  it("both emulator lanes share the KVM provisioning commands", async () => {
    const parity = await readFile(
      path.join(repo, ".github/workflows/native-platforms.yml"),
      "utf8",
    );
    const release = await readFile(path.join(repo, ".github/workflows/native-release.yml"), "utf8");
    const parityCommands = kvmProvisioning(parity);
    const releaseCommands = kvmProvisioning(release);
    expect(parityCommands).toHaveLength(4);
    expect(releaseCommands).toHaveLength(4);
    expect(parityCommands).toEqual(releaseCommands);
  });

  it("native cache keys hash their inputs and activate ccache", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const native = await readFile(
      path.join(repo, ".github/workflows/native-platforms.yml"),
      "utf8",
    );
    const jobs = [
      ["ci test-native", requiredJob(ci, "test-native")],
      ["native desktop parity", requiredJob(native, "desktop-parity")],
      ["native desktop matrix", requiredJob(native, "desktop")],
      ["native starter linux", requiredJob(native, "starter-linux")],
    ] as const;
    for (const [name, section] of jobs) {
      expect(section, name).toContain("packages/runtime-native/third_party");
      expect(section, name).toContain("packages/runtime-native/scripts/download-deps.mjs");
      expect(section, name).toContain("CCACHE_DIR");
      // CMake reads the launcher from the environment under these two names only. It does not
      // read CMAKE_PROJECT_INCLUDE_BEFORE from the environment, so writing a .cmake file and
      // exporting that name compiled without ccache while looking activated.
      expect(section, name).toContain("CMAKE_C_COMPILER_LAUNCHER: ccache");
      expect(section, name).toContain("CMAKE_CXX_COMPILER_LAUNCHER: ccache");
      expect(section, name).not.toMatch(/^\s+echo "CMAKE_PROJECT_INCLUDE_BEFORE=/mu);
      const keys = [...section.matchAll(/^\s+key:\s*(.+)$/gmu)].map((match) => match[1] ?? "");
      expect(keys.length, `${name} has no explicit cache keys`).toBeGreaterThanOrEqual(2);
      for (const key of keys) expect(key, name).toContain("hashFiles(");
      expect(section, name).toContain("packages/runtime-native/CMakeLists.txt");

      // A compiler cache that ccache writes to one directory and actions/cache saves from
      // another is not a compiler cache: the save finds nothing, no entry is ever stored, and
      // every run recompiles from scratch while the workflow reads as if it were cached. That
      // shipped, and `gh cache list` had no native-ccache entry at all after five runs. These
      // three assertions are the difference between the steps existing and the cache working.
      const ccacheDir = section.match(/^\s+CCACHE_DIR:\s*(.+)$/mu)?.[1]?.trim();
      expect(ccacheDir, `${name} does not set CCACHE_DIR`).toBeDefined();
      const cachedPaths = [...section.matchAll(/^\s+path:\s*(.+)$/gmu)].map((match) =>
        (match[1] ?? "").trim(),
      );
      expect(cachedPaths, `${name} caches ${ccacheDir}`).toContain(ccacheDir);

      // GitHub cache keys are immutable: a key that is only a content hash saves once and is
      // never updated again, so the cache stops growing the moment a source file changes. The
      // run id makes every run save, and restore-keys makes every run restore the newest.
      const ccacheKey = keys.find((key) => key.includes("native-ccache"));
      expect(ccacheKey, `${name} has no native-ccache key`).toBeDefined();
      expect(ccacheKey, `${name} never re-saves its compiler cache`).toContain("github.run_id");

      // A cache nobody measures is a cache nobody notices going cold.
      expect(section, `${name} never reports its ccache hit rate`).toContain("ccache --show-stats");
    }
  });

  // Three Linux jobs — ci `test`, native `desktop-parity` and native `starter-linux` — each
  // compiled a different set of targets and all three saved under `native-ccache-Linux-X64-gcc-`.
  // The key carries `github.run_id`, so every save is a new entry, and `restore-keys` takes the
  // newest match: each lane therefore restored whichever sibling had finished last and recompiled
  // its own objects against it. Measured on run 33690597861, ci `test` reported
  // `Hits: 184 / 574 (32.06%)` on a tree whose native sources had not changed, and the stored
  // entry sat at 23 MiB run after run instead of growing to hold all three lanes. A restore-key
  // prefix is a namespace; sharing one between jobs that build different things is a cache that
  // reports as warm and behaves as cold.
  it("gives every native compiler cache a restore namespace no other job writes to", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const native = await readFile(
      path.join(repo, ".github/workflows/native-platforms.yml"),
      "utf8",
    );
    const jobs = [
      ["ci test-native", requiredJob(ci, "test-native")],
      ["native desktop parity", requiredJob(native, "desktop-parity")],
      ["native desktop matrix", requiredJob(native, "desktop")],
      ["native starter linux", requiredJob(native, "starter-linux")],
    ] as const;

    const namespaces = new Map<string, string>();
    for (const [name, section] of jobs) {
      // By name, not by position: these jobs restore more than one cache, and `test-native` also
      // restores the compiled build tree. Picking the first `restore-keys` in the block asserted
      // against whichever cache happened to be declared first.
      const restoreKey = [...section.matchAll(/^\s+restore-keys:\s*(.+)$/gmu)]
        .map((match) => (match[1] ?? "").trim().replace(/^["']|["']$/gu, ""))
        .find((key) => key.includes("native-ccache"));
      expect(restoreKey, `${name} has no ccache restore-keys prefix`).toBeDefined();
      const previous = namespaces.get(restoreKey ?? "");
      expect(
        previous,
        `${name} shares the ccache restore namespace ${restoreKey} with ${previous}`,
      ).toBeUndefined();
      namespaces.set(restoreKey ?? "", name);

      // The save key must start with the prefix it restores by, or the lane saves into a
      // namespace it never reads back and the restore silently falls through to a sibling's.
      const saveKey = [...section.matchAll(/^\s+key:\s*(.+)$/gmu)]
        .map((match) => (match[1] ?? "").trim())
        .find((key) => key.includes("native-ccache"));
      expect(saveKey, `${name} has no native-ccache save key`).toBeDefined();
      expect(saveKey, `${name} saves outside the namespace it restores from`).toContain(
        restoreKey ?? "",
      );
    }
  });

  // `golden-path-template` used to scaffold starter and platformer and run their non-visual
  // scenarios itself, then run `verify:golden-path`, which packs and scaffolds the same template
  // all over again. Since 2026-09-01 `template-nonvisual` runs that identical sweep for all eight
  // templates on every event, so the copy inside the golden-path lane proved nothing new and cost
  // 350s of the run's critical path (run 33690597861, step "Run the scaffold's GPU-free
  // assertions"). The verifier is what this lane is for; the sweep belongs to the job that owns it.
  it("leaves the non-visual scenario sweep to template-nonvisual", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const goldenPath = requiredJob(ci, "golden-path-template");
    const nonVisual = requiredJob(ci, "template-nonvisual");

    expect(nonVisual).toContain("non-visual-scenarios.mjs");
    expect(nonVisual).toContain("threenative-playtest");
    // Both templates the golden-path matrix drives must be covered by the sweep that replaces it.
    for (const template of ["starter", "platformer"]) {
      expect(matrixTemplates(nonVisual)).toContain(template);
    }

    // Commands, not prose: the job's comments name the classifier and the runner precisely
    // because it delegates to them, and a raw-text match cannot tell an explanation from a step.
    const commands = goldenPath
      .split("\n")
      .filter((line) => !/^\s*#/u.test(line))
      .join("\n");
    expect(
      commands,
      "golden-path-template re-runs the sweep template-nonvisual already owns",
    ).not.toContain("non-visual-scenarios.mjs");
    expect(commands, "golden-path-template still drives scenarios itself").not.toContain(
      "threenative-playtest",
    );
    expect(goldenPath).toContain("pnpm verify:golden-path");
  });

  // Every matrix leg ran `workspace-packages.ts build` and then `pnpm pack` per package: ten legs
  // paying ~70s each to produce byte-identical tarballs from the same commit. `build` already
  // compiles the workspace, so it packs once and the legs download the result.
  it("packs the workspace tarballs once and shares them with every matrix leg", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const build = requiredJob(ci, "build");
    expect(build, "build does not publish the packed tarballs").toContain(
      "actions/upload-artifact",
    );
    expect(build).toContain("pnpm tsx scripts/workspace-packages.ts --archives");

    for (const name of ["golden-path-template", "template-nonvisual"]) {
      const job = requiredJob(ci, name);
      expect(job, `${name} does not consume the shared tarballs`).toContain(
        "actions/download-artifact",
      );
      expect(job, `${name} still packs the workspace itself`).not.toMatch(
        /pnpm --filter "\$package_name" pack/u,
      );
      // Nothing may re-derive the specs file locally; the artifact is the single source.
      expect(job, `${name} re-runs the workspace build`).not.toContain(
        "pnpm tsx scripts/workspace-packages.ts build",
      );
    }

    // The first attempt shipped only `packages/create-threenative/dist` and every scaffold died:
    // the CLI's `dist/index.js` imports `@threenative/assets`, pnpm resolves that through a
    // workspace symlink into `packages/assets/dist/index.js`, and the leg no longer builds the
    // workspace. What the legs need is the whole compiled workspace, so the artifact carries it
    // and this asserts the glob rather than any one package's name.
    const uploaded = build.slice(build.indexOf("actions/upload-artifact"));
    expect(uploaded, "the shared artifact does not carry the compiled workspace").toMatch(
      /^\s+packages\/\*\/dist$/mu,
    );
    expect(uploaded).toMatch(/^\s+artifacts\/workspace-packages$/mu);
    // An empty upload must fail the job rather than hand every downstream leg a silent nothing.
    expect(uploaded).toContain("if-no-files-found: error");
  });

  // `test` used to compile the C++ host for 279s before running a single JS test, because one
  // package's suite drives real contract executables. Splitting that off is only safe if the two
  // halves still cover every package between them — a `--filter` that names a package neither job
  // runs is a gate that goes green by running less, which is the failure this repository fails
  // closed against everywhere else. So this computes the partition rather than trusting it.
  it("splits the suite in two without dropping a package on the floor", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const js = requiredJob(ci, "test");
    const native = requiredJob(ci, "test-native");

    // The JS half must not compile anything, or the split bought nothing.
    expect(js, "the JS half still builds the native host").not.toContain("native:build");
    expect(js, "the JS half still carries the compiler cache").not.toContain("CCACHE_DIR");
    expect(js).toContain("- run: pnpm test");

    // The native half must build what its suite executes, and run only that suite.
    expect(native).toContain("native:build");
    expect(native).toContain("CCACHE_DIR");
    // The contract tests import the compiled workspace. `pnpm test` used to build it for them;
    // this job does not run `pnpm test`, so it has to build it itself or the suite dies on
    // ERR_MODULE_NOT_FOUND for `@threenative/playtest` before it executes a binary.
    expect(native, "the native half never builds the workspace its tests import").toContain(
      "uses: ./.github/actions/workspace-dist",
    );
    expect(native, "the native half re-runs the whole suite").not.toMatch(
      /^\s+- run: pnpm test$/mu,
    );

    const excluded = (js.match(/TN_SUITE_EXCLUDE_PACKAGES:\s*"([^"]*)"/u)?.[1] ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "");
    expect(excluded.length, "the JS half excludes nothing, so the split is a duplicate").toBe(1);

    const filtered = [...native.matchAll(/pnpm --filter (\S+) test/gu)].map((match) => match[1]);
    expect(
      filtered.sort(),
      "the packages the JS half skips are not the ones the native half runs",
    ).toEqual([...excluded].sort());

    // And the excluded name has to be a package that exists and has a suite to run, or the
    // filter is a typo that quietly excludes nothing and the native job runs nothing.
    for (const name of excluded) {
      const directory = name.replace(/^@threenative\//u, "");
      const manifest = JSON.parse(
        await readFile(path.join(repo, "packages", directory, "package.json"), "utf8"),
      ) as { name?: string; scripts?: Record<string, string> };
      expect(manifest.name, `${name} is not the package at packages/${directory}`).toBe(name);
      expect(manifest.scripts?.test, `${name} has no test script to run`).toBeDefined();
    }
  });

  // One hit rate for three builds cannot say which build produced the hits, and ci `test-native`
  // has been stuck at `Hits: 184 / 574 (32.06%)` on every run measured — unchanged by giving each
  // lane its own restore namespace, and with the restore demonstrably landing. Either the restored
  // cache is worthless and the hits are this run recompiling shared sources into a second build
  // directory, or 390 objects really do hash differently run over run. A counter read between the
  // builds is what tells those apart, so it is a measurement the job has to keep.
  it("reads the compiler cache counters between builds, not only at the end", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const native = requiredJob(ci, "test-native");

    const readings = [...native.matchAll(/^\s+- name: Compiler cache after (.+)$/gmu)].map(
      (match) => (match[1] ?? "").trim(),
    );
    expect(readings, "the native job reports one total for three builds").toEqual([
      "the host build",
      "the V8 contract executables",
      "the QuickJS variant",
    ]);
    // And the size of what the restore actually put on disk, because a hit rate cannot
    // distinguish a cold cache from one restored into the wrong directory.
    expect(native).toContain('du -sh "$CCACHE_DIR"');
  });

  // ccache has never paid off on this lane: 195 of 272 cacheable compiles miss on every run, and
  // the other half of the invocations sit behind SDL3's precompiled header where ccache cannot
  // reach them at all. Caching the compiled tree instead is safe because ninja re-stats every
  // input — a stale entry costs a recompile, never a wrong binary — but only while the key still
  // hashes the sources, or a source change would be served a tree built from different code.
  it("keys the cached native build tree on the sources it was built from", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const native = requiredJob(ci, "test-native");

    const keys = [...native.matchAll(/^\s+key:\s*(.+)$/gmu)].map((match) =>
      (match[1] ?? "").trim(),
    );
    const buildKey = keys.find((key) => key.includes("native-build-"));
    expect(buildKey, "the native build tree is not cached").toBeDefined();
    for (const input of [
      "packages/runtime-native/CMakeLists.txt",
      "packages/runtime-native/src/**",
      "packages/runtime-native/include/**",
    ]) {
      expect(buildKey, `the build-tree key ignores ${input}`).toContain(input);
    }
    // Deliberately NOT run-scoped, unlike the compiler cache. A ccache directory grows with
    // every run and wants a fresh entry; a build tree is a pure function of its sources, so a
    // run-scoped key stores the same 1.1 GiB repeatedly. On 2026-09-03 four entries carried the
    // identical source hash, `native-build-Linux` held 5.57 GiB of the repository's 10 GiB
    // budget, and the cache evicted itself and its neighbours — total runner work went up.
    expect(
      buildKey,
      "a run-scoped build-tree key stores the same tree once per run and evicts the budget",
    ).not.toContain("github.run_id");
    expect(native).toContain("restore-keys: native-build-");
    // Both configured build directories, or the QuickJS variant recompiles from nothing.
    expect(native).toContain("packages/runtime-native/build/tn-linux");
    expect(native).toContain("packages/runtime-native/build/tn-linux-quickjs");
    // The Rust crates too: once the C++ compile was cached away, they were the whole remaining
    // ~112s of the host build step.
    // The path the build actually writes, not the one cargo would default to:
    // `build-native-physics.mjs` passes `--target-dir` because it cross-compiles to five targets.
    expect(native).toContain("packages/runtime-native/.runtime/physics-target");
    const physicsScript = await readFile(
      path.join(repo, "packages/runtime-native/scripts/build-native-physics.mjs"),
      "utf8",
    );
    expect(physicsScript, "the physics build no longer writes where the cache looks").toContain(
      "'.runtime', 'physics-target'",
    );
    expect(native).toContain("packages/runtime-native/native/ui-overlay/target");
    for (const input of [
      "packages/runtime-native/native/**/src/**",
      "packages/runtime-native/native/**/Cargo.toml",
      "packages/runtime-native/native/**/Cargo.lock",
    ]) {
      expect(buildKey, `the build-tree key ignores ${input}`).toContain(input);
    }
    // A cached build tree is only usable if its inputs are older than it. `actions/checkout`
    // stamps everything with the time it ran, so without this the restore is dead weight and
    // ninja rebuilds the tree it just downloaded.
    expect(native, "the restored tree is older than its own freshly checked-out inputs").toContain(
      "restore-source-mtimes.mjs",
    );
    // And it needs history to do it. A shallow clone dates every file to HEAD, which is newer
    // than the cached tree, so the cache is worse than useless — run 33751865452 restamped 299 of
    // 299 files and rebuilt 78 objects behind a cache it had just restored.
    expect(native, "the mtime restore runs against a shallow clone").toContain("fetch-depth: 0");
    const script = await readFile(
      path.join(repo, "packages/runtime-native/scripts/restore-source-mtimes.mjs"),
      "utf8",
    );
    expect(script, "a shallow clone is silently mis-stamped rather than refused").toContain(
      "TN_MTIME_SHALLOW_CLONE",
    );
    const order = native.indexOf("restore-source-mtimes.mjs");
    expect(order, "sources are dated after the build has already run").toBeLessThan(
      native.indexOf("native:build"),
    );
  });

  // Six jobs need `packages/*/dist` and each compiled it from scratch — measured at 49-65s per
  // job, six times a run. tsup keeps no incremental state, so the output is what gets cached, and
  // one shared action owns the key so the six cannot drift apart into six different answers about
  // what a bundle is built from.
  it("builds the workspace through one shared action, never inline", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    expect(
      ci,
      "a job builds the workspace inline instead of through the shared action",
    ).not.toContain("pnpm tsx scripts/workspace-packages.ts build");
    expect(occurrences(ci, /uses: \.\/\.github\/actions\/workspace-dist/gu)).toBeGreaterThanOrEqual(
      5,
    );

    const action = await readFile(
      path.join(repo, ".github/actions/workspace-dist/action.yml"),
      "utf8",
    );
    // The key has to name what the bundles are made of. Miss one and a stale bundle is served to
    // every consumer, which is the only failure this cache can have.
    for (const input of [
      "packages/*/src/**",
      "packages/*/package.json",
      "packages/*/tsup.config.ts",
      "packages/*/scripts/**",
      "scripts/workspace-packages.ts",
      "pnpm-lock.yaml",
    ]) {
      expect(action, `the workspace-dist key ignores ${input}`).toContain(input);
    }
    // And a restore that came back partial must fail rather than be imported from — bundles and
    // tarballs both, since three lanes take the archives rather than the bundles.
    expect(action).toContain("TN_WORKSPACE_DIST_INCOMPLETE");
    expect(action).toContain("TN_WORKSPACE_ARCHIVES_INCOMPLETE");
    expect(action).toContain("artifacts/workspace-packages");

    // `playwright.config.ts` scaffolds from packed tarballs and rebuilds every package to get
    // them unless it is handed a set. Measured at 245s of setup against 40s of testing.
    const browser = requiredJob(ci, "test-browser");
    expect(browser, "the browser lane repacks the workspace before it can test").toContain(
      "THREENATIVE_PACKED_PACKAGES",
    );
    const config = await readFile(path.join(repo, "playwright.config.ts"), "utf8");
    expect(config, "the seam the workflow relies on is gone").toContain(
      "process.env.THREENATIVE_PACKED_PACKAGES",
    );
  });

  // `check-capability-docs` resolves every documented capability through its package export map,
  // and those maps point at dist. The budgets job installed and ran the gate without compiling
  // anything, so the gate failed on the build it needed rather than on a capability:
  //   CAPABILITY_BUILT_IMPORT_MISSING: @threenative/assets#compileAssets could not resolve from
  //   the package export map: @threenative/assets. targets missing built file
  //   .../packages/assets/dist/index.js
  // `needs: build` orders the job behind the build but hands it no artifact, so the ordering
  // reads like a guarantee it does not make. The job has to get what it resolves, and it takes it
  // from the shared action like every other consumer rather than compiling its own seventh copy.
  it("hands the budgets gate the dist it resolves through export maps", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const budgets = requiredJob(ci, "budgets");

    const dist = "uses: ./.github/actions/workspace-dist";
    expect(budgets, "the budgets job runs a gate that resolves dist without having it").toContain(
      dist,
    );
    // And it has to arrive before the gate reads it, not after.
    expect(
      budgets.indexOf(dist),
      "the budgets job builds after the gate that needs the build",
    ).toBeLessThan(budgets.indexOf("- run: pnpm budgets"));
  });

  // Splitting the suite across jobs is how coverage disappears quietly: a phase named in no job,
  // or a shard slice nobody runs, both report green. So the split is computed rather than trusted.
  it("runs every suite phase in exactly one job, and every unit shard", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const suite = requiredJob(ci, "test");
    const unit = requiredJob(ci, "test-unit");

    const phasesOf = (section: string): readonly string[] =>
      (section.match(/TN_SUITE_PHASES:\s*"?([a-z,-]+)"?/u)?.[1] ?? "")
        .split(",")
        .map((phase) => phase.trim())
        .filter((phase) => phase !== "");

    const declared = [...phasesOf(suite), ...phasesOf(unit)].sort();
    // The four the script knows. A phase in neither job runs nowhere; a phase in both runs twice.
    expect(declared, "the jobs do not partition the suite's phases").toEqual([
      "build",
      "docs",
      "package-test",
      "unit",
    ]);

    const shards = [...unit.matchAll(/"(\d+)\/(\d+)"/gu)].map((match) => ({
      index: Number(match[1]),
      count: Number(match[2]),
    }));
    expect(shards.length, "test-unit declares no shards").toBeGreaterThan(0);
    const counts = new Set(shards.map(({ count }) => count));
    expect(counts.size, "test-unit mixes shard counts").toBe(1);
    const [count] = [...counts];
    expect(
      shards.map(({ index }) => index).sort((left, right) => left - right),
      "test-unit is missing a shard",
    ).toEqual(Array.from({ length: count ?? 0 }, (_, offset) => offset + 1));

    // And the script must refuse a selection that would run nothing rather than report on it.
    const runner = await readFile(path.join(repo, "scripts/run-test-suite.sh"), "utf8");
    expect(runner).toContain("TN_SUITE_NO_PHASES");
    expect(runner).toContain("TN_SUITE_UNIT_SHARD");
    // Unset is the whole gate, which is what `pnpm test` on a developer machine has to stay.
    expect(runner).toContain('"${TN_SUITE_PHASES:-docs,build,package-test,unit}"');
  });

  // Every job that scaffolds a generated project installs *its* dependencies, not the
  // workspace's. Keyed on the workspace lockfile alone, the store cache does not hold them: on run
  // 33753945433 every template leg reported `resolved 492, reused 192, downloaded 170`, ten legs
  // each fetching the same third of the tree from the network.
  it("keys the package store on the templates for every job that scaffolds one", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    for (const name of [
      "golden-path-template",
      "template-nonvisual",
      "test-browser",
      "test-playtest",
    ]) {
      const job = requiredJob(ci, name);
      // Only jobs that actually scaffold need this; the assertion is that these ones do.
      expect(job, `${name} does not scaffold a project`).toMatch(
        /scaffold-from-tarballs|THREENATIVE_PACKED_PACKAGES|verify:golden-path|test:playtest/u,
      );
      expect(job, `${name} keys its store on the workspace lockfile alone`).toContain(
        "cache-dependency-path",
      );
      expect(job).toContain("packages/create-threenative/templates/*/package.json");
      // The workspace lockfile stays in the key — these jobs install the workspace too.
      expect(job).toMatch(/cache-dependency-path: \|\n\s+pnpm-lock\.yaml/u);
    }
  });

  it("every native leg runs on every event", async () => {
    // Until 2026-09-01 the platform legs ran only on pushes to main, the nightly cron, and PRs
    // carrying the `native` label; a PR read skips where the legs should have reported, and on
    // main the lane cancelled itself before finishing anyway (owner call: run everything,
    // everywhere, and let a red be a red). The only condition any leg may still carry is the
    // manual `ios_only` dispatch toggle, which runs the iOS lane alone on demand.
    const native = await readFile(
      path.join(repo, ".github/workflows/native-platforms.yml"),
      "utf8",
    );
    const legs = [
      "android-emulator-parity",
      "desktop",
      "ios-simulator",
      "desktop-parity",
      "starter-linux",
    ] as const;
    for (const name of legs) {
      const job = requiredJob(native, name);
      expect(job, name).not.toContain("github.event_name != 'pull_request'");
      expect(job, name).not.toContain("contains(github.event.pull_request.labels");
    }
    const android = requiredJob(native, "android-emulator-parity");
    expect(android).not.toContain("continue-on-error: true");
    // It reports its own red rather than swallowing it, and — since 2026-09-02 — without taking
    // the sibling legs down with it: see "no job cancels its own run".
    expect(android).toContain("Verify captured parity ledger");
  });

  it("job-level env never reads the runner context", async () => {
    // `jobs.<id>.env` cannot see the `runner` context. GitHub does not warn: it refuses the whole
    // workflow with "This run likely failed because of a workflow file issue" and starts zero
    // jobs, so a red here looks like an outage rather than a typo. Step-level env is indented
    // deeper and is allowed to use it.
    for (const workflow of workflows) {
      const source = await readFile(path.join(repo, workflow), "utf8");
      const offenders = source
        .split("\n")
        .filter((line) => /^ {6}[A-Za-z_][A-Za-z0-9_]*: .*\$\{\{\s*runner\./u.test(line));
      expect(offenders, workflow).toEqual([]);
    }
  });

  it("golden-path still exercises both templates through the verifier", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const goldenPath = requiredJob(ci, "golden-path-template");
    expect(goldenPath).toMatch(/template:\s*\n\s+- starter\s*\n\s+- platformer/u);
    expect(goldenPath).toContain("TN_GOLDEN_PATH_TEMPLATES: ${{ matrix.template }}");
    expect(goldenPath).toContain("pnpm verify:golden-path");
  });

  // `build` packs the workspace once and publishes it; the golden-path job downloads that set.
  // Without pointing the verifier at it, `verify:golden-path` packs the whole workspace a second
  // time inside the job that sets the run's critical path — the workspace `tsc` plus ten
  // `pnpm pack` runs, on top of a `build` that just did exactly that.
  it("hands the golden-path verifier the tarballs build already packed", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const job = requiredJob(ci, "golden-path-template");

    const archives = job.match(/TN_GOLDEN_PATH_ARCHIVES:\s*(.+)/u)?.[1]?.trim();
    expect(archives, "the verifier packs its own workspace instead of adopting build's").toBe(
      "${{ github.workspace }}/artifacts/workspace-packages",
    );
    // It must name the directory the download actually restores, or the verifier fails closed on
    // an unreadable path and the saving becomes a red run.
    expect(job).toContain("actions/download-artifact");
    const scaffold = requiredJob(ci, "template-nonvisual");
    expect(scaffold).toContain("${{ github.workspace }}/artifacts/workspace-packages");

    // And the script has to honour it. Unset is the developer path and must still pack.
    const verifier = await readFile(path.join(repo, "scripts/verify-golden-path.ts"), "utf8");
    expect(verifier).toContain("TN_GOLDEN_PATH_ARCHIVES");
    expect(verifier).toContain("adoptPackedWorkspace");
    expect(verifier, "adoption does not fail closed on an incomplete set").toContain(
      "TN_GOLDEN_PATH_ARCHIVE_MISSING",
    );
    expect(verifier, "adoption does not fail closed on an unclaimed tarball").toContain(
      "TN_GOLDEN_PATH_ARCHIVE_UNKNOWN",
    );
  });

  // The golden path drives one scenario because `template-nonvisual` drives them all. That is only
  // true while template-nonvisual actually covers the templates this matrix names — the moment it
  // stops, capping this layer stops being delegation and starts being a hole.
  it("only caps its own scenario sweep while template-nonvisual covers the same templates", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const goldenPath = requiredJob(ci, "golden-path-template");
    const nonVisual = requiredJob(ci, "template-nonvisual");

    const cap = goldenPath.match(/TN_GOLDEN_PATH_SCENARIOS:\s*"(\d+)"/u)?.[1];
    if (cap === undefined) return; // uncapped is always honest; nothing to check.

    expect(Number(cap)).toBeGreaterThan(0);
    // The lane it delegates to has to run the same classifier and runner, on every event.
    expect(nonVisual).toContain("non-visual-scenarios.mjs");
    expect(nonVisual).toContain("threenative-playtest");
    expect(nonVisual).not.toContain("github.event_name == 'push'");
    // And it has to cover every template this matrix drives.
    const driven = matrixTemplates(goldenPath);
    expect(driven.length).toBeGreaterThan(0);
    const covered = matrixTemplates(nonVisual);
    for (const template of driven) {
      expect(covered, `template-nonvisual does not cover ${template}`).toContain(template);
    }
  });

  it("the golden-path proof cache cannot record a run that failed", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const job = requiredJob(ci, "golden-path-template");

    // The combined `actions/cache` writes its entry in a post step whatever the job did, which
    // would stamp a passing proof onto a failed run and then skip the lane for every later tree
    // that hashes the same. Split restore/save with `if: success()` is the whole safety property.
    expect(job).toContain("actions/cache/restore@v4");
    expect(job).toContain("actions/cache/save@v4");
    expect(job).not.toMatch(/uses: actions\/cache@v4/u);
    const save = job.slice(job.indexOf("Save the proof for this tree"));
    expect(save).toContain("if: success() && steps.proof.outputs.cache-hit != 'true'");

    // A key that names only the "related" inputs is one forgotten file away from a gate that
    // passes because nothing ran — which is how the native-platforms path filters let core,
    // playtest and create-threenative changes through unproven. Keep it broad.
    for (const input of ["pnpm-lock.yaml", "packages/**", "scripts/**", ".github/**"]) {
      expect(job, input).toContain(input);
    }

    // Every step that does work must be behind the hit check. One that is not runs against a
    // scaffold the cache hit never created.
    const steps = job.split(/^ {6}- /mu).slice(1);
    const unguarded = steps.filter(
      (step) =>
        /(?:pnpm |threenative-playtest|scaffold-from-tarballs|playwright)/u.test(step) &&
        !step.includes("steps.proof.outputs.cache-hit"),
    );
    expect(unguarded, "steps that would run without a scaffold on a cache hit").toEqual([]);
  });

  it("the golden-path required context is still reported by a job of that exact name", async () => {
    // `golden-path` is a required check in the `main protection` ruleset, and required checks are
    // matched by exact context string. A matrix job reports `golden-path (starter)` and
    // `golden-path (platformer)`, never `golden-path`, so making this lane a matrix silently left
    // the ruleset waiting on a context nothing would ever report. This job is that context.
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const aggregate = requiredJob(ci, "golden-path");
    expect(aggregate).toContain("needs: golden-path-template");
    expect(aggregate).not.toContain("strategy:");
    // Without this, a failed matrix leaves the job skipped, and a skipped required check counts as
    // satisfied — the ruleset would pass on exactly the runs it exists to stop. `always()` is the
    // wrong spelling: it also fires when the run was cancelled, where the matrix result is
    // `cancelled` and this job then reported failure on a run nobody had broken.
    expect(aggregate).toContain("if: ${{ !cancelled() }}");
    expect(aggregate).not.toMatch(/if: always\(\)/u);
    expect(aggregate).toContain("needs.golden-path-template.result");
    expect(aggregate).toMatch(/test "\$result" = "success"/u);
  });

  it("the scaffold block exists exactly once in the shared action", async () => {
    const action = await readFile(
      path.join(repo, ".github/actions/scaffold-from-tarballs/action.yml"),
      "utf8",
    );
    expect(occurrences(action, /case "\$package_name" in/gu)).toBe(1);
    expect(action).toContain("unsupported workspace package");
    let callers = 0;
    for (const relative of [
      ".github/workflows/ci.yml",
      ".github/workflows/native-platforms.yml",
      ".github/workflows/native-release.yml",
    ]) {
      const source = await readFile(path.join(repo, relative), "utf8");
      expect(source, relative).not.toContain('case "$package_name" in');
      expect(source, relative).not.toContain("unsupported workspace package");
      callers += occurrences(source, /uses: \.\/\.github\/actions\/scaffold-from-tarballs/gu);
    }
    expect(callers).toBe(6);
  });

  it("keeps the native contracts and primary CI documentation honest", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const test = requiredJob(ci, "test-native");
    expect(test).toContain("grep -oE 'add_executable\\(\\s*threenative-[a-z0-9-]+-test'");
    expect(test).toContain("Build the QuickJS engine variant the cross-engine contracts need");
    expect(test).toContain("-DMYSTRAL_USE_QUICKJS=ON -DMYSTRAL_USE_V8=OFF");
    for (const job of ["lint", "build", "budgets"]) requiredJob(ci, job);

    const agents = await readFile(path.join(repo, "AGENTS.md"), "utf8");
    const claude = await readFile(path.join(repo, "CLAUDE.md"), "utf8");
    for (const name of ["supply-chain", "template-nonvisual", "desktop-parity", "golden-path"]) {
      expect(agents).toContain(name);
      expect(claude).toContain(name);
    }
    expect(
      claude.startsWith("<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->"),
    ).toBe(true);
  });

  it("builds the framework example before a fail-closed bundle boundary check", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const build = jobSections(ci).find(([job]) => job === "build")?.[1];
    if (build === undefined) throw new Error("CI build job was not found.");

    const exampleBuild = build.indexOf("pnpm --filter abyss-framework build");
    const boundaryCheck = build.indexOf("name: Enforce entity registry boundaries");
    expect(exampleBuild).toBeGreaterThanOrEqual(0);
    expect(boundaryCheck).toBeGreaterThan(exampleBuild);

    const bundleScan = build.slice(boundaryCheck);
    expect(bundleScan).toContain("run: pnpm exec tsx scripts/check-core-boundary.ts");
  });

  it("keeps the repository-wide DebugOverlay CSS guard", async () => {
    const guard = await readFile(
      path.join(repo, "scripts/__tests__/debug-overlay-css.spec.ts"),
      "utf8",
    );
    expect(guard).toContain(
      'const PROJECT_ROOTS = ["examples", "packages/create-threenative/templates"];',
    );
    expect(guard).toContain("mountsOverlay");
    expect(guard).toContain("stylesOverlay");
    expect(guard).toContain("expect(unstyled).toEqual([])");
  });

  it("asks the Android parity emulator for KVM, and reports what it got", async () => {
    // `-accel auto` finds no writable /dev/kvm and falls back to software emulation without
    // saying so. That lane logged a 474-second boot and then lost a run that had already passed
    // 74/0 to `adb ETIMEDOUT`.
    //
    // The rule is installed, the mode is reported, and neither is asserted: ending the step on
    // `test -w /dev/kvm` — the shape native-release.yml carries, where nothing has exercised it —
    // failed the job outright on a runner without KVM, which is worse than the boot it fixes.
    const parity = await readFile(
      path.join(repo, ".github/workflows/native-platforms.yml"),
      "utf8",
    );
    expect(parity).toContain('KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"');
    expect(parity).toContain("TN_EMULATOR_ACCEL:kvm");
    expect(parity).toContain("TN_EMULATOR_ACCEL:software");

    // Before the emulator starts, or it accelerates nothing.
    expect(parity.indexOf("99-kvm4all.rules")).toBeLessThan(
      parity.indexOf("reactivecircus/android-emulator-runner"),
    );

    // And the step must not end on a bare assertion that kills the lane.
    const step = parity.slice(
      parity.indexOf("Enable KVM for the emulator"),
      parity.indexOf("reactivecircus/android-emulator-runner"),
    );
    expect(step, "the KVM step must report its mode, not assert it").not.toMatch(
      /\n\s+test -w \/dev\/kvm\s*\n/u,
    );
  });
});
