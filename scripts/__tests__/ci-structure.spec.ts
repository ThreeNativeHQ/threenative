import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

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

const expectedTemplates = [
  "action-rpg",
  "defense",
  "minimal",
  "platformer",
  "racing",
  "sailing",
  "shooter",
  "starter",
] as const;

describe("CI pipeline structure", () => {
  it("a failed PRD job cancels current and competing PRD workflow runs", async () => {
    const action = await readFile(
      path.join(repo, ".github/actions/cancel-run-on-failure/action.yml"),
      "utf8",
    );
    expect(action).toContain("GH_TOKEN: ${{ github.token }}");
    expect(action).toContain("repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/cancel");
    expect(action).toContain("for status in in_progress queued");
    expect(action).toContain("status=$status");
    expect(action).toContain("linchpin/*");
    expect(action).toContain("feat/prd-*");
    expect(action).toContain("feat/ci-prd-*");
    expect(action).toContain('if [[ "$run_id" == "$GITHUB_RUN_ID" ]]');
    expect(action).not.toContain("main|release");

    for (const relative of [".github/workflows/ci.yml", ".github/workflows/native-platforms.yml"]) {
      const source = await readFile(path.join(repo, relative), "utf8");
      expect(triggerSection(source), relative).toContain("actions: write");
      for (const [job, section] of jobSections(source)) {
        expect(section, `${relative} ${job}`).toContain("if: failure()");
        expect(section, `${relative} ${job}`).toContain(
          "uses: ./.github/actions/cancel-run-on-failure",
        );
      }
    }
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
    const capture = desktop.indexOf("--target web --out artifacts/conformance/web");
    const comparison = desktop.indexOf(
      "--target desktop --reference artifacts/conformance/web --out artifacts/conformance/desktop",
    );
    expect(capture).toBeGreaterThanOrEqual(0);
    expect(comparison).toBeGreaterThan(capture);
    expect(occurrences(desktop, /test "\$status" -eq 0 -o "\$status" -eq 2/gu)).toBe(2);
    expect(occurrences(desktop, /check-lane-blocks\.mjs/gu)).toBe(2);
    expect(desktop).toContain("TN_PARITY_DESKTOP_REPORT_MISSING");
    expect(desktop).toContain("pnpm parity:ledger");
    expect(desktop).toContain("if-no-files-found: error");
  });

  it("every template's non-visual scenarios run on main pushes and nightly", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const job = requiredJob(ci, "template-nonvisual");
    expect(job).toContain("if: github.event_name == 'push' || github.event_name == 'schedule'");
    expect(job).not.toContain("pull_request");
    expect(job).toContain('TN_PLAYTEST_ALLOW_SOFTWARE: "1"');
    expect(job).toContain("non-visual-scenarios.mjs");
    expect(job).toContain("threenative-playtest");
    for (const template of expectedTemplates) expect(job).toContain(`- ${template}`);

    const templateRoot = path.join(repo, "packages/create-threenative/templates");
    const actualTemplates = (await readdir(templateRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(actualTemplates).toEqual([...expectedTemplates].sort());
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

  it("PR CI reviews dependencies and scans changed commits for leaked secrets", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const supplyChain = requiredJob(ci, "supply-chain");
    expect(supplyChain).toContain("if: github.event_name == 'pull_request'");
    expect(supplyChain).toContain("uses: actions/dependency-review-action@v4");
    expect(supplyChain).toContain("fail-on-severity: moderate");
    expect(supplyChain).not.toContain("allow-licenses");
    expect(supplyChain).toContain("fetch-depth: 0");
    expect(supplyChain).toContain("ghcr.io/gitleaks/gitleaks@sha256:");
    expect(supplyChain).toContain("github.event.pull_request.base.sha");
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
      ["ci test", requiredJob(ci, "test")],
      ["native desktop parity", requiredJob(native, "desktop-parity")],
      ["native desktop matrix", requiredJob(native, "desktop")],
      ["native starter linux", requiredJob(native, "starter-linux")],
    ] as const;
    for (const [name, section] of jobs) {
      expect(section, name).toContain("packages/runtime-native/third_party");
      expect(section, name).toContain("packages/runtime-native/scripts/download-deps.mjs");
      expect(section, name).toContain("CCACHE_DIR");
      expect(section, name).toContain("CMAKE_PROJECT_INCLUDE_BEFORE");
      expect(section, name).toContain("CMAKE_C_COMPILER_LAUNCHER");
      expect(section, name).toContain("CMAKE_CXX_COMPILER_LAUNCHER");
      const keys = [...section.matchAll(/^\s+key:\s*(.+)$/gmu)].map((match) => match[1] ?? "");
      expect(keys.length, `${name} has no explicit cache keys`).toBeGreaterThanOrEqual(2);
      for (const key of keys) expect(key, name).toContain("hashFiles(");
      expect(section, name).toContain("packages/runtime-native/CMakeLists.txt");
    }
  });

  it("golden-path still exercises both templates through the verifier", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const goldenPath = requiredJob(ci, "golden-path");
    expect(goldenPath).toMatch(/template:\s*\n\s+- starter\s*\n\s+- platformer/u);
    expect(goldenPath).toContain("TN_GOLDEN_PATH_TEMPLATES: ${{ matrix.template }}");
    expect(goldenPath).toContain("pnpm verify:golden-path");
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
    const test = requiredJob(ci, "test");
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
