import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, test } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";
// @ts-expect-error — the packager is plain JavaScript so a postinstall can run it unbuilt.
import { SDL3_ANDROID_VERSION } from "../../runtime-native/scripts/package-android.mjs";

// Exercise the shipped packagers, not a reimplementation of their source/consumer decisions.
const runtimeRoot = fileURLToPath(new URL("../../runtime-native/", import.meta.url));
const script = (name: string) => pathToFileURL(path.join(runtimeRoot, "scripts", name)).href;
const desktop = await import(script("package-desktop.mjs"));
const android = await import(script("package-android.mjs"));
const installer = await import(script("install-prebuilt.mjs"));
const envKeys = [
  "THREENATIVE_RUNTIME_SOURCE",
  "THREENATIVE_PREBUILT_MANIFEST",
  "THREENATIVE_ALLOW_INSECURE_PREBUILT",
];
const savedEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  for (const [key, value] of savedEnv) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
});

function temporary(): string {
  const root = makeTempDirSync("threenative-consumer-review-");
  roots.push(root);
  Reflect.deleteProperty(process.env, "THREENATIVE_RUNTIME_SOURCE");
  Reflect.deleteProperty(process.env, "THREENATIVE_PREBUILT_MANIFEST");
  return root;
}

async function installedFixture() {
  const root = temporary();
  const bytes = Buffer.from("verified-runtime-fixture");
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.end(bytes);
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/runtime`;
  const manifestPath = path.join(root, "manifest.json");
  const key = `${process.platform}-${process.arch}`;
  writeFileSync(
    manifestPath,
    JSON.stringify({
      artifacts: {
        [key]: { url, sha256: installer.sha256(bytes), size: bytes.length },
      },
    }),
  );
  process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT = "1";
  const install = {
    output: path.join(root, "runtime"),
    statusPath: path.join(root, "status.json"),
    manifestPath,
  };
  await installer.installPrebuilt(install);
  return { root, bytes, install, requests: () => requests, server };
}

test("desktop reuses a checksum-verified install when the release is unavailable", async () => {
  const fixture = await installedFixture();
  await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
  assert.equal(
    await desktop.resolveDesktopRuntime(undefined, { install: fixture.install }),
    fixture.install.output,
  );
  assert.deepEqual(readFileSync(fixture.install.output), fixture.bytes);
  assert.equal(fixture.requests(), 1, "rebuild must not download again");
});

for (const mutation of [
  "bytes",
  "status-missing",
  "status-json",
  "ok",
  "key",
  "version",
  "url",
  "sha256",
]) {
  test(`desktop reinstalls rather than trusting cached ${mutation}`, async () => {
    const fixture = await installedFixture();
    const status = JSON.parse(readFileSync(fixture.install.statusPath, "utf8"));
    if (mutation === "bytes") writeFileSync(fixture.install.output, "tampered");
    else if (mutation === "status-missing") rmSync(fixture.install.statusPath);
    else if (mutation === "status-json") writeFileSync(fixture.install.statusPath, "{");
    else {
      status[mutation] = mutation === "ok" ? "true" : "invalid";
      writeFileSync(fixture.install.statusPath, JSON.stringify(status));
    }
    await desktop.resolveDesktopRuntime(undefined, { install: fixture.install });
    assert.equal(fixture.requests(), 2);
    assert.deepEqual(readFileSync(fixture.install.output), fixture.bytes);
  });
}

test("desktop refuses an unverified cached runtime when reinstall fails", async () => {
  const fixture = await installedFixture();
  writeFileSync(fixture.install.output, "tampered");
  await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
  await assert.rejects(
    desktop.resolveDesktopRuntime(undefined, { install: fixture.install }),
    /fetch failed/u,
  );
  assert.equal(existsSync(fixture.install.output), false);
  assert.equal(JSON.parse(readFileSync(fixture.install.statusPath, "utf8")).ok, false);
});

test(
  "desktop source override is rejected even when a verified consumer runtime is cached",
  async () => {
    const fixture = await installedFixture();
    process.env.THREENATIVE_RUNTIME_SOURCE = path.join(fixture.root, "checkout");
    await assert.rejects(
      desktop.resolveDesktopRuntime(undefined, { install: fixture.install }),
      /THREENATIVE_RUNTIME_SOURCE.*no --runtime/u,
    );
    assert.equal(fixture.requests(), 1);
    assert.deepEqual(readFileSync(fixture.install.output), fixture.bytes);
  },
);

test(
  "desktop explicit runtime override remains offline and takes precedence over source preflight",
  async () => {
    const root = temporary();
    const runtime = path.join(root, "runtime");
    writeFileSync(runtime, "explicit");
    process.env.THREENATIVE_RUNTIME_SOURCE = path.join(root, "checkout");
    assert.equal(await desktop.resolveDesktopRuntime(runtime), runtime);
    await assert.rejects(
      desktop.resolveDesktopRuntime(path.join(root, "missing")),
      /Missing prebuilt runtime/u,
    );
  },
);

test("desktop CLI accepts a missing runtime argument but still requires bundle and output", () => {
  assert.equal(desktop.parseArgs(["--bundle", "game.js", "--output", "game"]).runtime, undefined);
  assert.throws(() => desktop.parseArgs(["--output", "game"]), /Missing --bundle/u);
  assert.throws(() => desktop.parseArgs(["--bundle", "game.js"]), /Missing --output/u);
});

test("desktop explicit packaging still reports a missing bundle synchronously", () => {
  const root = temporary();
  assert.throws(
    () =>
      desktop.packageDesktop({
        bundle: path.join(root, "absent"),
        runtime: path.join(root, "runtime"),
        output: path.join(root, "game"),
      }),
    /Missing native bundle/u,
  );
});

for (const aar of [undefined, "SDL3-0.0.0.aar", `SDL3-${android.SDL3_ANDROID_VERSION}.aar`]) {
  test(
    `Android refuses a source checkout before wrapper/network work (${aar ?? "no SDL archive"})`,
    async () => {
      const root = temporary();
      writeFileSync(path.join(root, "CMakeLists.txt"), "# source\n");
      if (aar) {
        mkdirSync(path.join(root, "third_party", "sdl3-android"), { recursive: true });
        writeFileSync(path.join(root, "third_party", "sdl3-android", aar), "fixture");
      }
      const calls: string[] = [];
      await assert.rejects(
        android.packageAndroid("absent.js", undefined, undefined, undefined, undefined, {
          runtimeRoot: root,
          ensureGradleWrapper: async () => {
            calls.push("wrapper");
          },
          prepareAndroidPrebuilts: async () => {
            calls.push("download");
          },
          spawnSync: () => {
            calls.push("compile");
          },
        }),
        /source checkout.*explicit opt-in/u,
      );
      assert.deepEqual(calls, []);
    },
  );
}

function androidFixture(source: boolean) {
  const root = temporary();
  // Copy only checked-in templates; never a developer's Gradle/NDK build or prebuilt cache.
  for (const relative of [
    "app/build.gradle.kts",
    "app/src/main/AndroidManifest.xml",
    "app/src/main/res/values/strings.xml",
    "app/src/main/res/values/themes.xml",
  ]) {
    const destination = path.join(root, "android", relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(runtimeRoot, "android", relative), destination);
  }
  writeFileSync(
    path.join(root, "android", process.platform === "win32" ? "gradlew.bat" : "gradlew"),
    "fixture",
  );
  if (source) {
    writeFileSync(path.join(root, "CMakeLists.txt"), "# source\n");
    // A source checkout is only usable once its maintainer dependencies are provisioned, and
    // package-android.mjs refuses without the SDL AAR by name. The version comes from the module
    // that owns it rather than a literal, so a pin bump does not silently un-provision this
    // fixture and turn a real refusal into a passing test.
    const aar = path.join(root, "third_party", "sdl3-android", `SDL3-${SDL3_ANDROID_VERSION}.aar`);
    mkdirSync(path.dirname(aar), { recursive: true });
    writeFileSync(aar, "aar-fixture");
  }
  const bundle = path.join(root, "game.js");
  writeFileSync(bundle, "export default { start() {} };\n");
  const apk = path.join(
    root,
    "android",
    "app",
    "build",
    "outputs",
    "apk",
    "debug",
    "app-debug.apk",
  );
  const calls: string[] = [];
  const options = {
    runtimeRoot: root,
    ensureGradleWrapper: async () => {
      calls.push("wrapper");
    },
    prepareAndroidPrebuilts: async () => {
      calls.push("download");
    },
    spawnSync: () => {
      calls.push("gradle");
      mkdirSync(path.dirname(apk), { recursive: true });
      writeFileSync(apk, "apk-fixture");
      return { status: 0 };
    },
  };
  return { root, bundle, apk, calls, options };
}

test("Android explicit opt-in uses the source route without downloading prebuilts", async () => {
  const fixture = androidFixture(true);
  const manifest = path.join(fixture.root, "android", "app", "src", "main", "AndroidManifest.xml");
  const original = readFileSync(manifest);
  const output = path.join(fixture.root, "game.apk");
  assert.equal(
    await android.packageAndroid(fixture.bundle, output, undefined, undefined, undefined, {
      ...fixture.options,
      allowSourceBuild: true,
    }),
    output,
  );
  assert.deepEqual(fixture.calls, ["wrapper", "gradle"]);
  assert.equal(readFileSync(output, "utf8"), "apk-fixture");
  assert.deepEqual(readFileSync(manifest), original);
});

test(
  "Android installed consumers still download prebuilts without opting into source builds",
  async () => {
    const fixture = androidFixture(false);
    assert.equal(
      await android.packageAndroid(
        fixture.bundle,
        undefined,
        undefined,
        undefined,
        undefined,
        fixture.options,
      ),
      fixture.apk,
    );
    assert.deepEqual(fixture.calls, ["wrapper", "download", "gradle"]);
  },
);

test("Android download failure names the usable public CLI source-build opt-in", async () => {
  const fixture = androidFixture(false);
  await assert.rejects(
    android.packageAndroid(fixture.bundle, undefined, undefined, undefined, undefined, {
      ...fixture.options,
      prepareAndroidPrebuilts: async () => {
        throw new Error("HTTP 404");
      },
    }),
    /threenative build --target android --allow-source-build/u,
  );
  assert.deepEqual(fixture.calls, ["wrapper"]);
});

test("Android string true cannot opt into source compilation", async () => {
  const fixture = androidFixture(true);
  await assert.rejects(
    android.packageAndroid(fixture.bundle, undefined, undefined, undefined, undefined, {
      ...fixture.options,
      allowSourceBuild: "true",
    }),
    /explicit opt-in/u,
  );
  assert.deepEqual(fixture.calls, []);
});

test("desktop cache cannot override an explicit manifest changed in place", async () => {
  const fixture = await installedFixture();
  const manifest = JSON.parse(readFileSync(fixture.install.manifestPath, "utf8"));
  manifest.artifacts[`${process.platform}-${process.arch}`].sha256 = "0".repeat(64);
  writeFileSync(fixture.install.manifestPath, JSON.stringify(manifest));
  await assert.rejects(
    desktop.resolveDesktopRuntime(undefined, { install: fixture.install }),
    /Checksum verification failed/u,
  );
  assert.equal(fixture.requests(), 2);
  assert.equal(existsSync(fixture.install.output), false);
});

test(
  "calling the installer explicitly still invalidates an earlier success on failed retry",
  async () => {
    const fixture = await installedFixture();
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
    await assert.rejects(installer.installPrebuilt(fixture.install), /fetch failed/u);
    assert.equal(existsSync(fixture.install.output), false);
    assert.equal(JSON.parse(readFileSync(fixture.install.statusPath, "utf8")).ok, false);
  },
);

// The executable fixture uses a POSIX shebang; this is not evidence for Windows execution.
(process.platform === "win32" ? test.skip : test)(
  "desktop package CLI cold-installs once and rebuilds offline",
  async () => {
    const root = temporary();
    const consumer = path.join(root, "runtime-package");
    mkdirSync(path.join(consumer, "scripts"), { recursive: true });
    for (const name of ["package-desktop.mjs", "install-prebuilt.mjs", "asset-preflight.mjs"]) {
      cpSync(path.join(runtimeRoot, "scripts", name), path.join(consumer, "scripts", name));
    }
    cpSync(path.join(runtimeRoot, "package.json"), path.join(consumer, "package.json"));
    const payload = Buffer.from(
      `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[process.argv.indexOf('--out') + 1], 'compiled-fixture');\n`,
    );
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.end(payload);
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const manifestPath = path.join(root, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        artifacts: {
          [`${process.platform}-${process.arch}`]: {
            url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/runtime`,
            sha256: installer.sha256(payload),
            size: payload.length,
          },
        },
      }),
    );
    const bundle = path.join(root, "game.js");
    const output = path.join(root, "game");
    writeFileSync(bundle, "export default {};\n");
    const args = [
      path.join(consumer, "scripts", "package-desktop.mjs"),
      "--bundle",
      bundle,
      "--output",
      output,
    ];
    const env = {
      ...process.env,
      THREENATIVE_PREBUILT_MANIFEST: manifestPath,
      THREENATIVE_ALLOW_INSECURE_PREBUILT: "1",
    };
    await promisify(execFile)(process.execPath, args, { env });
    assert.equal(readFileSync(output, "utf8"), "compiled-fixture");
    assert.equal(
      JSON.parse(readFileSync(path.join(consumer, "prebuilt", "install-status.json"), "utf8")).ok,
      true,
    );
    rmSync(output);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await promisify(execFile)(process.execPath, args, { env });
    assert.equal(readFileSync(output, "utf8"), "compiled-fixture");
    assert.equal(requests, 1);
  },
);
