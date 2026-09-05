/**
 * WebTransport API end-to-end tests.
 *
 * These exercise the native WebTransport implementation (QUIC + HTTP/3 via
 * quiche) against a real WebTransport echo server (the Go reference server
 * shipped at `examples/webtransport/server`, built with `webtransport-go`).
 * They validate the full client surface:
 *   - connection lifecycle (ready)
 *   - datagrams (send + receive echo)
 *   - bidirectional streams (send + receive echo)
 *   - unidirectional streams (send + receive a server-initiated echo stream)
 *
 * The same server is what `examples/webtransport/client.html` drives from a real
 * browser, so both halves of the "web and native are one codebase" rule are
 * measured against one fixture.
 *
 * Requirements (the suite skips cleanly if any are missing):
 *   - The `mystral` binary built WITH quiche (MYSTRAL_HAS_QUICHE). WebTransport
 *     is feature-detected at runtime by attempting a connection.
 *   - A Go toolchain (`go`) to build the echo server.
 *
 * Set TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE=1 when the live fixture is a required
 * verification gate. Missing fixture inputs then fail with their exact paths
 * instead of being reported as skipped — in that mode nothing skips, because a
 * skipped required lane reads as a pass it never earned.
 *
 * Because they need a Go toolchain and a live UDP server, the default pnpm
 * test lane reports them as explicitly skipped until those requirements exist.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand, runtimeBinary, runtimeRoot } from "../runtime-test-utils.js";

// The echo server lives with the runnable example so users can verify
// WebTransport themselves (see examples/webtransport/client.html).
const SERVER_DIR = join(runtimeRoot, "examples/webtransport/server");
// One explicit executable path, built before every run: nothing is discovered, so a
// stale binary can never stand in for the source under test. `build/` is untracked.
const SERVER_EXECUTABLE = join(
  runtimeRoot,
  "build/webtransport",
  process.platform === "win32" ? "tn-network-server.exe" : "tn-network-server",
);
const TEST_DIR = join(runtimeRoot, ".test-tmp/webtransport");
const SERVER_LISTEN = "127.0.0.1:4433";
const SERVER_URL = `https://${SERVER_LISTEN}/echo`;
// The server serves only /echo, so this path exercises the constructor and nothing else.
const PROBE_URL = `https://${SERVER_LISTEN}/probe`;
const REQUIRE_LIVE_FIXTURE = process.env.TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE === "1";
// A cold `go build` compiles quic-go and its dependencies, which is far longer than
// vitest's default 10s hook budget.
const FIXTURE_SETUP_TIMEOUT_MS = 300_000;
// Stays below vitest's testTimeout on purpose: when a script hangs, the assertion has to
// fail on the output the runtime actually produced. A script budget equal to the test
// budget reports a bare "Test timed out" and throws that output away.
const SCRIPT_TIMEOUT_MS = 20_000;

const missingRequirements = [
  !existsSync(runtimeBinary) ? `built native runtime (${runtimeBinary})` : null,
  !existsSync(SERVER_DIR) ? `WebTransport echo-server source (${SERVER_DIR})` : null,
  spawnSync("go", ["version"], { stdio: "ignore" }).status !== 0 ? "Go toolchain" : null,
].filter((reason): reason is string => reason !== null);

let unavailableReason =
  missingRequirements.length > 0 ? `requires ${missingRequirements.join(", ")}` : null;

let serverProc: ChildProcess | null = null;

function failClosed(reason: string): void {
  unavailableReason ??= reason;
  if (REQUIRE_LIVE_FIXTURE) {
    throw new Error(
      `WebTransport live certificate fixture prerequisite failed: ${unavailableReason}`,
    );
  }
}

async function startServer(): Promise<boolean> {
  console.log("Building WebTransport echo server (go build)...");
  const build = spawnSync("go", ["build", "-o", SERVER_EXECUTABLE, "."], {
    cwd: SERVER_DIR,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (build.status !== 0) {
    unavailableReason = `requires a buildable Go WebTransport echo server in ${SERVER_DIR}: ${build.stderr}`;
    return false;
  }
  if (!existsSync(SERVER_EXECUTABLE)) {
    unavailableReason = `requires the built echo-server executable (${SERVER_EXECUTABLE})`;
    return false;
  }
  serverProc = spawn(SERVER_EXECUTABLE, ["--listen", SERVER_LISTEN, "--dev-self-signed"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Wait for the "LISTENING" line so we know the UDP socket is bound.
  return new Promise((resolve) => {
    let output = "";
    const timeout = setTimeout(() => resolve(false), 15_000);
    serverProc?.stdout?.setEncoding("utf8");
    serverProc?.stdout?.on("data", (chunk: string) => {
      output += chunk;
      if (output.includes("LISTENING")) {
        clearTimeout(timeout);
        resolve(true);
      }
    });
    serverProc?.once("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
    serverProc?.once("exit", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

type ScriptOptions = { allowInsecurePeerVerification?: boolean };

// Runs a JS script under the mystral runtime (headless) and returns combined output.
async function runScript(
  name: string,
  source: string,
  options: ScriptOptions = {},
): Promise<string> {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  const path = join(TEST_DIR, name);
  writeFileSync(path, source);
  const env = { ...process.env };
  if (options.allowInsecurePeerVerification) {
    env.MYSTRAL_WEBTRANSPORT_INSECURE = "1";
  } else {
    Reflect.deleteProperty(env, "MYSTRAL_WEBTRANSPORT_INSECURE");
  }
  const { stdout, stderr } = await runCommand(runtimeBinary, ["run", path, "--headless"], {
    env,
    timeoutMs: SCRIPT_TIMEOUT_MS,
  });
  return `${stdout}\n${stderr}`;
}

async function runTrustedScript(name: string, source: string): Promise<string> {
  return runScript(name, source, { allowInsecurePeerVerification: true });
}

function requireWebTransport(skip: (note?: string) => never): void {
  if (!unavailableReason) return;
  // A required lane fails here rather than skipping: `beforeAll` is not the only place
  // a prerequisite can go missing, and a skipped test reports green.
  failClosed(unavailableReason);
  skip(unavailableReason);
}

describe("WebTransport API", () => {
  beforeAll(async () => {
    if (unavailableReason) {
      failClosed(unavailableReason);
      return;
    }

    // Feature-detect WebTransport support: the global exists in all builds, but a
    // connection only initiates when quiche is compiled in.
    const probe = await runScript(
      "wt-probe.js",
      `console.log('WT_GLOBAL:' + (typeof WebTransport));
       const wt = new WebTransport('${PROBE_URL}');
       wt.ready.then(() => {}).catch(() => {});
       console.log('WT_CONSTRUCT_OK');
       process.exit(0);`,
    );
    if (!probe.includes("WT_CONSTRUCT_OK")) {
      failClosed("requires a runtime built with WebTransport/quiche support");
      return;
    }
    const started = await startServer();
    if (!started) {
      failClosed("requires a WebTransport echo server that reaches LISTENING");
    }
  }, FIXTURE_SETUP_TIMEOUT_MS);

  it("rejects the echo server certificate without the development override", async ({ skip }) => {
    requireWebTransport(skip);
    const out = await runScript(
      "wt-untrusted-default.js",
      `async function main() {
        const wt = new WebTransport('${SERVER_URL}');
        try { await wt.ready; console.log('FAIL: accepted'); }
        catch (e) { console.log('PASS: rejected ' + e.message); }
        process.exit(0);
      }
      main();`,
    );
    expect(out).toContain("PASS: rejected");
    expect(out).not.toContain("TLS peer verification disabled");
  });

  it("accepts the echo server certificate only with the explicit development override", async ({
    skip,
  }) => {
    requireWebTransport(skip);
    const out = await runScript(
      "wt-untrusted-override.js",
      `async function main() {
        const wt = new WebTransport('${SERVER_URL}');
        try { await wt.ready; console.log('PASS: ready'); }
        catch (e) { console.log('FAIL: ' + e.message); }
        process.exit(0);
      }
      main();`,
      { allowInsecurePeerVerification: true },
    );
    expect(out).toContain("PASS: ready");
    expect(out).toContain("MYSTRAL_WEBTRANSPORT_INSECURE=1");
  });

  afterAll(async () => {
    const child = serverProc;
    serverProc = null;
    try {
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error("WebTransport echo server did not stop within 5 seconds"));
          }, 5_000);
          child.once("close", () => {
            clearTimeout(timeout);
            resolve();
          });
          child.kill("SIGTERM");
        });
      }
    } finally {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("connects and the ready promise fulfills", async ({ skip }) => {
    requireWebTransport(skip);
    const out = await runTrustedScript(
      "wt-ready.js",
      `async function main() {
        const wt = new WebTransport('${SERVER_URL}');
        try { await wt.ready; console.log('PASS: ready'); }
        catch (e) { console.log('FAIL: ' + e.message); }
        process.exit(0);
      }
      main();`,
    );
    expect(out).toContain("PASS: ready");
  });

  it("echoes a datagram", async ({ skip }) => {
    requireWebTransport(skip);
    const out = await runTrustedScript(
      "wt-datagram.js",
      `async function main() {
        const wt = new WebTransport('${SERVER_URL}');
        await wt.ready;
        const writer = wt.datagrams.writable.getWriter();
        const reader = wt.datagrams.readable.getReader();
        await writer.write(new Uint8Array([1, 2, 3, 4, 5]));
        const { value } = await reader.read();
        if (value && value.length === 5 && value[0] === 1 && value[4] === 5) {
          console.log('PASS: datagram ' + Array.from(value).join(','));
        } else {
          console.log('FAIL: datagram ' + (value ? Array.from(value).join(',') : 'none'));
        }
        process.exit(0);
      }
      main();`,
    );
    expect(out).toContain("PASS: datagram 1,2,3,4,5");
  });

  it("echoes a bidirectional stream", async ({ skip }) => {
    requireWebTransport(skip);
    const out = await runTrustedScript(
      "wt-bidi.js",
      `async function main() {
        const wt = new WebTransport('${SERVER_URL}');
        await wt.ready;
        const stream = await wt.createBidirectionalStream();
        const writer = stream.writable.getWriter();
        const reader = stream.readable.getReader();
        await writer.write(new TextEncoder().encode('hello bidi'));
        await writer.close();
        let bytes = [];
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) bytes.push(...value);
        }
        const text = new TextDecoder().decode(new Uint8Array(bytes));
        console.log(text === 'hello bidi' ? 'PASS: bidi ' + text : 'FAIL: bidi ' + JSON.stringify(text));
        process.exit(0);
      }
      main();`,
    );
    expect(out).toContain("PASS: bidi hello bidi");
  });

  it("echoes a unidirectional stream", async ({ skip }) => {
    requireWebTransport(skip);
    const out = await runTrustedScript(
      "wt-uni.js",
      `async function main() {
        const wt = new WebTransport('${SERVER_URL}');
        await wt.ready;
        const incoming = wt.incomingUnidirectionalStreams.getReader();
        const send = await wt.createUnidirectionalStream();
        const writer = send.getWriter();
        await writer.write(new TextEncoder().encode('hello uni'));
        await writer.close();
        const { value: recvStream } = await incoming.read();
        if (!recvStream) { console.log('FAIL: no incoming uni'); process.exit(0); }
        const reader = recvStream.getReader();
        let bytes = [];
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) bytes.push(...value);
        }
        const text = new TextDecoder().decode(new Uint8Array(bytes));
        console.log(text === 'hello uni' ? 'PASS: uni ' + text : 'FAIL: uni ' + JSON.stringify(text));
        process.exit(0);
      }
      main();`,
    );
    expect(out).toContain("PASS: uni hello uni");
  });

  // --- Proper WHATWG Streams surface --------------------------------------

  it("exposes WHATWG stream globals and WebTransport streams are real streams", async ({
    skip,
  }) => {
    requireWebTransport(skip);
    const out = await runTrustedScript(
      "wt-globals.js",
      `async function main() {
        const names = ['ReadableStream','WritableStream','TransformStream','TextEncoderStream','TextDecoderStream'];
        const globalsOk = names.every((n) => typeof globalThis[n] === 'function');
        const wt = new WebTransport('${SERVER_URL}');
        await wt.ready;
        const instOk = (wt.datagrams.readable instanceof ReadableStream)
          && (wt.datagrams.writable instanceof WritableStream)
          && (wt.incomingUnidirectionalStreams instanceof ReadableStream)
          && (typeof wt.datagrams.readable.pipeThrough === 'function')
          && (typeof wt.datagrams.readable[Symbol.asyncIterator] === 'function');
        console.log(globalsOk && instOk ? 'PASS: globals' : 'FAIL: globals ' + globalsOk + '/' + instOk);
        process.exit(0);
      }
      main();`,
    );
    expect(out).toContain("PASS: globals");
  });

  it("reads datagrams via async iteration (for await...of)", async ({ skip }) => {
    requireWebTransport(skip);
    const out = await runTrustedScript(
      "wt-dgram-iter.js",
      `async function main() {
        const wt = new WebTransport('${SERVER_URL}');
        await wt.ready;
        const writer = wt.datagrams.writable.getWriter();
        await writer.write(new TextEncoder().encode('iter-dgram'));
        let got = '';
        for await (const chunk of wt.datagrams.readable) { got = new TextDecoder().decode(chunk); break; }
        console.log(got === 'iter-dgram' ? 'PASS: dgram-iter ' + got : 'FAIL: ' + JSON.stringify(got));
        process.exit(0);
      }
      main();`,
    );
    expect(out).toContain("PASS: dgram-iter iter-dgram");
  });

  it("sends datagrams via datagrams.createWritable()", async ({ skip }) => {
    requireWebTransport(skip);
    const out = await runTrustedScript(
      "wt-dgram-createwritable.js",
      `async function main() {
        const wt = new WebTransport('${SERVER_URL}');
        await wt.ready;
        const writer = wt.datagrams.createWritable().getWriter();
        await writer.write(new TextEncoder().encode('cw-dgram'));
        const reader = wt.datagrams.readable.getReader();
        const { value } = await reader.read();
        const got = new TextDecoder().decode(value);
        console.log(got === 'cw-dgram' ? 'PASS: createWritable ' + got : 'FAIL: ' + JSON.stringify(got));
        process.exit(0);
      }
      main();`,
    );
    expect(out).toContain("PASS: createWritable cw-dgram");
  });

  it("unidirectional streams via TextEncoderStream.pipeTo + pipeThrough(TextDecoderStream) (W3C echo pattern)", async ({
    skip,
  }) => {
    requireWebTransport(skip);
    const out = await runTrustedScript(
      "wt-uni-pipe.js",
      `async function main() {
        const wt = new WebTransport('${SERVER_URL}');
        await wt.ready;
        const incoming = wt.incomingUnidirectionalStreams.getReader();
        const enc = new TextEncoderStream();
        const w = enc.writable.getWriter();
        w.write('uni-pipe'); w.close();
        await enc.readable.pipeTo(await wt.createUnidirectionalStream());
        const { value: stream } = await incoming.read();
        if (!stream) { console.log('FAIL: no incoming uni'); process.exit(0); }
        let got = '';
        for await (const chunk of stream.pipeThrough(new TextDecoderStream())) got += chunk;
        console.log(got === 'uni-pipe' ? 'PASS: uni-pipe ' + got : 'FAIL: ' + JSON.stringify(got));
        process.exit(0);
      }
      main();`,
    );
    expect(out).toContain("PASS: uni-pipe uni-pipe");
  });

  it("bidirectional streams via chained pipeThrough (encoder -> bidi -> decoder)", async ({
    skip,
  }) => {
    requireWebTransport(skip);
    const out = await runTrustedScript(
      "wt-bidi-pipe.js",
      `async function main() {
        const wt = new WebTransport('${SERVER_URL}');
        await wt.ready;
        const enc = new TextEncoderStream();
        const w = enc.writable.getWriter();
        w.write('bidi-pipe'); w.close();
        let got = '';
        const bidi = await wt.createBidirectionalStream();
        for await (const msg of enc.readable.pipeThrough(bidi).pipeThrough(new TextDecoderStream())) got += msg;
        console.log(got === 'bidi-pipe' ? 'PASS: bidi-pipe ' + got : 'FAIL: ' + JSON.stringify(got));
        process.exit(0);
      }
      main();`,
    );
    expect(out).toContain("PASS: bidi-pipe bidi-pipe");
  });
});
