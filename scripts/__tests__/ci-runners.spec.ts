import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { makeTempDirSync } from "../../test-support/temp-dir.js";

const script = path.resolve(import.meta.dirname, "../ci-runners.sh");

function plan(
  rows: readonly string[],
  slots = "3",
  available = rows.length,
): ReturnType<typeof spawnSync> {
  const fixture = makeTempDirSync("runner-cpu-plan-");
  const bin = path.join(fixture, "bin");
  mkdirSync(bin);
  for (const [name, output] of [
    ["lscpu", rows.join("\n")],
    ["nproc", String(available)],
  ]) {
    const command = path.join(bin, name ?? "");
    writeFileSync(command, `#!/bin/sh\ncat <<'DATA'\n${output}\nDATA\n`);
    chmodSync(command, 0o755);
  }
  // Planning must not use Docker, credentials, GitHub, or the service's mutable state.
  return spawnSync("bash", [script, "plan", slots], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TN_RUNNERS_ENV: "/missing-env" },
  });
}

const topology = Array.from({ length: 24 }, (_, cpu) => `${cpu},${cpu % 12},0,Y`);

describe.skipIf(process.platform !== "linux")("local runner physical core allocation", () => {
  it("keeps whole SMT cores separate between heavy slots, light pool and host", () => {
    const result = plan(topology);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      "heavy:1:0,12,1,13,2,14\nheavy:2:3,15,4,16,5,17\nheavy:3:6,18,7,19,8,20\nlight:9,21\nhost:10,22,11,23\n",
    );
  });

  it("groups actual socket/core identities instead of assuming CPU plus half is its sibling", () => {
    const rows = Array.from({ length: 12 }, (_, core) => [
      `${core * 2},${core % 6},${Math.floor(core / 6)},Y`,
      `${core * 2 + 1},${core % 6},${Math.floor(core / 6)},Y`,
    ]).flat();
    const result = plan(rows);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("heavy:1:0,1,2,3,4,5\n");
    expect(result.stdout).toContain("light:18,19\nhost:20,21,22,23\n");
  });

  it("passes only whole-core shapes to new slots without changing devices or memory limits", async () => {
    const fixture = makeTempDirSync("runner-shape-");
    const bin = path.join(fixture, "bin");
    mkdirSync(bin);
    const shapes = path.join(fixture, "shapes");
    const environment = path.join(fixture, "env");
    writeFileSync(environment, "RUNNER_ADMIN_TOKEN=test-only-placeholder\n");
    const commands = {
      lscpu: `cat <<'DATA'\n${topology.join("\n")}\nDATA`,
      nproc: "echo 24",
      docker: "exit 0",
      gh: 'case "$*" in *"repo view"*) echo test/repo;; *offline*) ;; *runners*) echo 3;; esac',
      setsid: `printf '%s\n' "\${9:-balancer}" >> '${shapes}'`,
    };
    for (const [name, body] of Object.entries(commands)) {
      const command = path.join(bin, name);
      writeFileSync(command, `#!/bin/sh\n${body}\n`);
      chmodSync(command, 0o755);
    }
    const result = spawnSync("bash", [script, "up", "3"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TN_RUNNERS_ENV: environment,
        XDG_STATE_HOME: fixture,
      },
    });
    expect(result.status).toBe(0);
    await vi.waitFor(() => {
      expect(readFileSync(shapes, "utf8").trim().split("\n")).toHaveLength(7);
    });
    const launched = readFileSync(shapes, "utf8").trim().split("\n");
    const heavy = launched.filter((shape) => shape.includes("--memory 9g"));
    const light = launched.filter((shape) => shape.includes("--memory 2g"));
    expect(heavy).toHaveLength(3);
    for (const cpus of ["0,12,1,13,2,14", "3,15,4,16,5,17", "6,18,7,19,8,20"]) {
      expect(
        heavy.some((shape) =>
          shape.includes(`--cpuset-cpus ${cpus} --memory 9g --memory-swap 9g --oom-score-adj 800`),
        ),
      ).toBe(true);
    }
    expect(light).toEqual(
      Array(3).fill("--cpuset-cpus 9,21 --cpus 1 --memory 2g --memory-swap 2g --oom-score-adj 900"),
    );
    expect(launched.join("\n")).not.toMatch(/--privileged|--gpus|--mount|--volume/u);
  });

  it.each([
    Array.from({ length: 24 }, (_, index) => `0,${index % 12},0,Y`),
    [...topology.slice(0, 23), "23,unknown,0,Y"],
  ])("rejects invalid or duplicated topology before producing an allocation", (...rows) => {
    const result = plan(rows);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("invalid or duplicate CPU topology");
    expect(result.stdout).toBe("");
  });

  it("rejects six slots before any runner mutation because complete cores cannot fit", () => {
    const result = plan(topology, "6");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("whole physical cores");
    expect(result.stdout).toBe("");
  });

  it("cannot advertise unavailable CPUs through an inherited OpenMP override", () => {
    const fixture = makeTempDirSync("runner-affinity-");
    const bin = path.join(fixture, "bin");
    mkdirSync(bin);
    const lscpu = path.join(bin, "lscpu");
    writeFileSync(lscpu, `#!/bin/sh\ncat <<'DATA'\n${topology.join("\n")}\nDATA\n`);
    chmodSync(lscpu, 0o755);
    const allowed = readFileSync("/proc/self/status", "utf8").match(
      /^Cpus_allowed_list:\s*(\d+)/mu,
    )?.[1];
    expect(allowed).toBeDefined();
    const result = spawnSync("taskset", ["-c", allowed ?? "", "bash", script, "plan", "3"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OMP_NUM_THREADS: "24" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("affinity");
    expect(result.stdout).toBe("");
  });

  it("fails closed when inherited affinity cannot cover the discovered online CPUs", () => {
    const result = plan(topology, "3", 23);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("affinity");
  });
});
