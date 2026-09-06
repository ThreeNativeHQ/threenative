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
const SERVER_PORT = 4433;
const SERVER_URL = `https://${SERVER_LISTEN}/echo`;
const DNS_TEST_HOST = "networking-test.invalid";
const DNS_TEST_URL = `https://${DNS_TEST_HOST}:${SERVER_PORT}/echo`;
// The server serves only /echo, so this path exercises the constructor and nothing else.
const PROBE_URL = `https://${SERVER_LISTEN}/probe`;
const REQUIRE_LIVE_FIXTURE = process.env.TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE === "1";
const INVALID_DNS_CASES = [
  { label: "delay-negative", dnsDelayMs: "-1", dnsAddresses: "127.0.0.1" },
  { label: "delay-junk", dnsDelayMs: "junk", dnsAddresses: "127.0.0.1" },
  { label: "delay-too-large", dnsDelayMs: "2001", dnsAddresses: "127.0.0.1" },
  { label: "address-nonnumeric", dnsDelayMs: "0", dnsAddresses: "not-an-ip" },
  { label: "address-trailing-comma", dnsDelayMs: "0", dnsAddresses: "127.0.0.1," },
  {
    label: "address-too-many",
    dnsDelayMs: "0",
    dnsAddresses: Array.from({ length: 17 }, (_, index) => `192.0.2.${index + 1}`).join(","),
  },
] as const;
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

// Returns the reason the fixture executable is unusable, or null. Every describe that
// spawns a fixture calls this: `go build` is cached, and a block that is run on its own
// must not depend on another block's hook having built the server first.
function buildServerExecutable(): string | null {
  console.log("Building WebTransport echo server (go build)...");
  const build = spawnSync("go", ["build", "-o", SERVER_EXECUTABLE, "."], {
    cwd: SERVER_DIR,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (build.status !== 0) {
    return `requires a buildable Go WebTransport echo server in ${SERVER_DIR}: ${build.stderr}`;
  }
  if (!existsSync(SERVER_EXECUTABLE)) {
    return `requires the built echo-server executable (${SERVER_EXECUTABLE})`;
  }
  return null;
}

async function startServer(): Promise<boolean> {
  const buildFailure = buildServerExecutable();
  if (buildFailure) {
    unavailableReason = buildFailure;
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

type EphemeralServer = {
  child: ChildProcess;
  ready: Promise<string>;
};

function spawnFixtureServer(
  label: string,
  args: readonly string[],
  addressPattern: RegExp,
): EphemeralServer {
  const child = spawn(SERVER_EXECUTABLE, [...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const ready = new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (address?: string, error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else if (address) resolve(address);
      else reject(new Error(`${label} WebTransport fixture did not report an address`));
    };
    const timeout = setTimeout(() => {
      finish(
        undefined,
        new Error(
          `${label} WebTransport fixture readiness timed out; stdout=${stdout} stderr=${stderr}`,
        ),
      );
    }, 15_000);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      const match = addressPattern.exec(stdout);
      if (match?.[1]) finish(match[1]);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      finish(
        undefined,
        new Error(`${label} WebTransport fixture failed to start: ${error.message}`),
      );
    });
    child.once("exit", (code, signal) => {
      if (!settled) {
        finish(
          undefined,
          new Error(
            `${label} WebTransport fixture exited before readiness (code=${code}, signal=${signal}); ` +
              `stdout=${stdout} stderr=${stderr}`,
          ),
        );
      }
    });
  });
  return { child, ready };
}

function spawnIpv6Server(): EphemeralServer {
  return spawnFixtureServer(
    "IPv6",
    ["--listen", "[::1]:0", "--dev-self-signed"],
    /LISTENING udp=(\[::1\]:\d+)/u,
  );
}

async function stopOwnedServer(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("IPv6 WebTransport fixture did not stop within 5 seconds"));
    }, 5_000);
    child.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.kill("SIGTERM");
  });
}

type ScriptOptions = {
  allowInsecurePeerVerification?: boolean;
  dnsAddresses?: string;
  dnsDelayMs?: number | string;
  timeoutMs?: number;
  // Lowers the datagram capacity the native side negotiates, so an oversize
  // rejection is provable against a small number instead of whatever this
  // machine's path happens to allow. A string passes the raw value through so a
  // malformed clamp can be proven to fail closed; `""` sets the variable empty.
  maxDatagramBytes?: number | string;
  // Explicit process-local trust anchors for this child only. Left unset the
  // variable is removed from the child environment, so an operator's ambient
  // SSL_CERT_FILE cannot silently change what any other case here proves.
  trustFile?: string;
};

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
  if (options.maxDatagramBytes !== undefined) {
    env.MYSTRAL_WEBTRANSPORT_MAX_DATAGRAM = String(options.maxDatagramBytes);
  } else {
    Reflect.deleteProperty(env, "MYSTRAL_WEBTRANSPORT_MAX_DATAGRAM");
  }
  if (options.dnsDelayMs !== undefined) {
    env.MYSTRAL_WEBTRANSPORT_TEST_DNS_DELAY_MS = String(options.dnsDelayMs);
  } else {
    Reflect.deleteProperty(env, "MYSTRAL_WEBTRANSPORT_TEST_DNS_DELAY_MS");
  }
  if (options.dnsAddresses !== undefined) {
    env.MYSTRAL_WEBTRANSPORT_TEST_DNS_ADDRESSES = options.dnsAddresses;
  } else {
    Reflect.deleteProperty(env, "MYSTRAL_WEBTRANSPORT_TEST_DNS_ADDRESSES");
  }
  if (options.trustFile !== undefined) {
    env.SSL_CERT_FILE = options.trustFile;
  } else {
    Reflect.deleteProperty(env, "SSL_CERT_FILE");
  }
  const { exitCode, stdout, stderr } = await runCommand(
    runtimeBinary,
    ["run", path, "--headless"],
    {
      env,
      timeoutMs: options.timeoutMs ?? SCRIPT_TIMEOUT_MS,
    },
  );
  const output = `${stdout}\n${stderr}`;
  if (exitCode !== 0) {
    throw new Error(`WebTransport runtime script ${name} exited with ${exitCode}:\n${output}`);
  }
  return output;
}

async function runTrustedScript(
  name: string,
  source: string,
  options: Omit<ScriptOptions, "allowInsecurePeerVerification"> = {},
): Promise<string> {
  return runScript(name, source, { ...options, allowInsecurePeerVerification: true });
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
    let probe: string;
    try {
      probe = await runScript(
        "wt-probe.js",
        `console.log('WT_GLOBAL:' + (typeof WebTransport));
       const wt = new WebTransport('${PROBE_URL}');
       wt.ready.then(() => {}).catch(() => {});
       console.log('WT_CONSTRUCT_OK');
       process.exit(0);`,
      );
    } catch (error) {
      failClosed(
        `native runtime prerequisite failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
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

  it("reports negotiated datagram capacity", async ({ skip }) => {
    requireWebTransport(skip);
    const out = await runTrustedScript(
      "wt-dgram-capacity.js",
      `async function main() {
        const wt = new WebTransport('${SERVER_URL}');
        await wt.ready;
        const limit = wt.datagrams.maxDatagramSize;
        // A live connection's limit comes from quiche's writable DATAGRAM length
        // minus this client's HTTP/3 session framing, so it must sit below the
        // runtime's 1350-byte UDP payload and above nothing usable.
        if (!Number.isInteger(limit) || limit <= 0 || limit >= 1350) {
          console.log('FAIL: capacity ' + limit);
          process.exit(0);
        }
        // The reported number has to be the number that is actually enforced.
        let atLimit = 'unset';
        let overLimit = 'unset';
        await wt.datagrams.createWritable().getWriter().write(new Uint8Array(limit))
          .then(() => { atLimit = 'accepted'; }, (e) => { atLimit = 'refused:' + e.message; });
        await wt.datagrams.createWritable().getWriter().write(new Uint8Array(limit + 1))
          .then(() => { overLimit = 'accepted'; }, () => { overLimit = 'refused'; });
        console.log(atLimit === 'accepted' && overLimit === 'refused'
          ? 'PASS: capacity ' + limit + ' enforced'
          : 'FAIL: capacity ' + limit + ' at=' + atLimit + ' over=' + overLimit);
        process.exit(0);
      }
      main();`,
    );
    expect(out).toMatch(/PASS: capacity \d+ enforced/u);
  });

  it("rejects oversized datagram", async ({ skip }) => {
    requireWebTransport(skip);
    const out = await runScript(
      "wt-dgram-oversize.js",
      `async function main() {
        const wt = new WebTransport('${SERVER_URL}');
        await wt.ready;
        const limit = wt.datagrams.maxDatagramSize;
        let over = 'unset';
        await wt.datagrams.createWritable().getWriter().write(new Uint8Array(65)).then(
          () => { over = 'accepted'; },
          (e) => { over = (e instanceof WebTransportError ? 'refused' : 'refused-other') + ':' + e.message; },
        );
        // The clamp must not break sending: a datagram at the clamped capacity
        // still round-trips through the echo server.
        const reader = wt.datagrams.readable.getReader();
        await wt.datagrams.createWritable().getWriter().write(new Uint8Array(64).fill(7));
        const { value } = await reader.read();
        const echoed = value && value.length === 64 && value[0] === 7 && value[63] === 7;
        console.log(limit === 64 && over.startsWith('refused:') && echoed
          ? 'PASS: oversize refused at ' + limit
          : 'FAIL: limit=' + limit + ' over=' + over + ' echoed=' + (value ? value.length : 'none'));
        process.exit(0);
      }
      main();`,
      { allowInsecurePeerVerification: true, maxDatagramBytes: 64 },
    );
    expect(out).toContain("PASS: oversize refused at 64");
  });

  // The two tests above stop at the polyfill's own size guard, so on their own
  // they prove the JavaScript check and say nothing about the native limit
  // underneath it. This one calls the native bridge directly, past the guard.
  // `wt._state.id` is the native session id the polyfill stores when it opens a
  // session (webtransport-polyfill.js: `const state = { id, ... }`).
  it("enforces the datagram limit natively, past the JS guard", async ({ skip }) => {
    requireWebTransport(skip);
    const out = await runScript(
      "wt-dgram-native-boundary.js",
      `async function main() {
        const wt = new WebTransport('${SERVER_URL}');
        await wt.ready;
        const id = wt._state.id;
        const limit = wt.datagrams.maxDatagramSize;
        // Statuses from webtransport.cpp: 0 accepted, -2 too large.
        const atLimit = __wtSendDatagram(id, new Uint8Array(limit));
        const overLimit = __wtSendDatagram(id, new Uint8Array(limit + 1));
        const wayOver = __wtSendDatagram(id, new Uint8Array(limit + 4096));
        // A session id the native side does not know is a closed session (-1),
        // which must not be reported as a size problem.
        const unknown = __wtSendDatagram(id + 9999, new Uint8Array(1));
        console.log(limit === 64 && atLimit === 0 && overLimit === -2 && wayOver === -2 && unknown === -1
          ? 'PASS: native boundary at ' + limit
          : 'FAIL: limit=' + limit + ' at=' + atLimit + ' over=' + overLimit +
            ' wayOver=' + wayOver + ' unknown=' + unknown);
        process.exit(0);
      }
      main();`,
      { allowInsecurePeerVerification: true, maxDatagramBytes: 64 },
    );
    expect(out).toContain("PASS: native boundary at 64");
  });

  // An explicit clamp the runtime cannot parse is a configuration error. Keeping
  // the negotiated capacity while the operator believes a limit is in force is
  // the same silent substitution the hardcoded 1200 was.
  it("fails the session on an unusable explicit datagram clamp", async ({ skip }) => {
    requireWebTransport(skip);
    for (const bad of ["abc", "0", "-5", ""]) {
      const out = await runScript(
        "wt-dgram-bad-clamp.js",
        `async function main() {
          let outcome = 'unset';
          const wt = new WebTransport('${SERVER_URL}');
          await wt.ready.then(
            () => { outcome = 'ready:' + wt.datagrams.maxDatagramSize; },
            (e) => { outcome = 'refused:' + e.message; },
          );
          console.log(outcome.startsWith('refused:') &&
              outcome.includes('MYSTRAL_WEBTRANSPORT_MAX_DATAGRAM')
            ? 'PASS: bad clamp refused'
            : 'FAIL: ' + outcome);
          process.exit(0);
        }
        main();`,
        { allowInsecurePeerVerification: true, maxDatagramBytes: bad },
      );
      expect(out, `clamp value ${JSON.stringify(bad)}`).toContain("PASS: bad clamp refused");
    }
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

  it("backpressures stalled receiver", async ({ skip }) => {
    requireWebTransport(skip);
    const out = await runScript(
      "native-stalled-reader-probe.js",
      `const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  const wt = new WebTransport("${SERVER_URL}");
  await wt.ready;
  const stream = await wt.createBidirectionalStream();
  const writer = stream.writable.getWriter();
  writer.closed.catch(() => {});
  const total = 32 * 1024 * 1024;
  let written = 0;
  let done = false;
  let error = null;
  const produce = (async () => {
    while (written < total) {
      const bytes = new Uint8Array(65536);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (written + i) % 251;
      await writer.write(bytes);
      written += bytes.length;
    }
    await writer.close();
    done = true;
  })();
  produce.catch((e) => {
    error = e;
  });
  let previous = -1;
  let stable = 0;
  let pressure = null;
  for (let tick = 0; tick < 100; tick++) {
    await sleep(50);
    if (error) throw error;
    const stats = __wtResourceStats();
    if (
      stats.native.queuedReliableBytes > 1048576 ||
      stats.js.queuedReliableBytes > 1048576 ||
      stats.js.queuedReceiveBytes > 16384
    )
      throw new Error("queue limit " + JSON.stringify(stats));
    stable = written === previous ? stable + 1 : 0;
    previous = written;
    if (
      !done &&
      written < total &&
      stable >= 6 &&
      stats.native.queuedReliableBytes > 0 &&
      stats.js.queuedReliableBytes > 0 &&
      stats.js.queuedReceiveBytes > 0
    ) {
      pressure = stats;
      break;
    }
  }
  if (!pressure || done || written >= total)
    throw new Error("sender never demonstrated stalled-reader pressure; written=" + written);
  console.log("PRESSURE written=" + written + " stats=" + JSON.stringify(pressure));
  const reader = stream.readable.getReader();
  let received = 0;
  while (true) {
    const { value, done: end } = await reader.read();
    if (end) break;
    for (let i = 0; i < value.length; i++) {
      if (value[i] !== received % 251) throw new Error("mismatch " + received);
      received++;
    }
  }
  await produce;
  if (received !== total) throw new Error("size " + received);
  wt.close();
  await wt.closed;
  for (let tick = 0; tick < 100; tick++) {
    await sleep(10);
    const s = __wtResourceStats();
    if (
      s.native.sessions === 0 &&
      s.native.streams === 0 &&
      s.js.sessions === 0 &&
      s.js.streams === 0
    ) {
      console.log("PASS: native 32MiB stalled reader exact echo and cleanup");
      process.exit(0);
      return;
    }
  }
  throw new Error("cleanup failed " + JSON.stringify(__wtResourceStats()));
}
main().catch((e) => {
  console.log("FAIL: " + e.message);
  process.exit(1);
});
`,
      { allowInsecurePeerVerification: true, timeoutMs: 90_000 },
    );
    expect(out).toContain("PASS: native 32MiB stalled reader exact echo and cleanup");
    expect(out).toContain("PRESSURE written=");
  }, 120_000);

  it("releases 100 reconnects", async ({ skip }) => {
    requireWebTransport(skip);
    const out = await runScript(
      "native-reconnect-probe.js",
      `const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nativeKeys = [
  "sessions",
  "streams",
  "queuedReliableBytes",
  "queuedDatagrams",
  "queuedEvents",
  "inFlightReceiveBytes",
  "readCreditBytes",
  "pendingHeaderBytes",
];
const jsKeys = [
  "sessions",
  "streams",
  "queuedReliableBytes",
  "queuedReliableOperations",
  "queuedDatagramOperations",
  "queuedDatagrams",
  "queuedEvents",
  "queuedReceiveBytes",
];
function isZero() {
  const s = __wtResourceStats();
  for (const [part, keys] of [
    ["native", nativeKeys],
    ["js", jsKeys],
  ])
    for (const key of keys) {
      if (!Number.isFinite(s[part][key])) throw new Error("missingcounter " + part + "." + key);
      if (s[part][key] !== 0) return false;
    }
  return true;
}
async function main() {
  if (!isZero()) throw new Error("nonzero initialbaseline");
  for (let cycle = 0; cycle < 100; cycle++) {
    const wt = new WebTransport("${SERVER_URL}");
    await wt.ready;
    const dgramWriter = wt.datagrams.writable.getWriter();
    dgramWriter.closed.catch(() => {});
    const dgramReader = wt.datagrams.readable.getReader();
    await dgramWriter.write(new Uint8Array([cycle]));
    const echoed = await dgramReader.read();
    if (echoed.done || echoed.value.length !== 1 || echoed.value[0] !== cycle)
      throw new Error("datagram " + cycle);
    const stream = await wt.createBidirectionalStream();
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const payload = new Uint8Array([cycle, 17, 29]);
    await writer.write(payload);
    await writer.close();
    let received = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const byte of value) {
        if (byte !== payload[received++]) throw new Error("stream " + cycle);
      }
    }
    if (received !== 3) throw new Error("length " + cycle);
    wt.close();
    await wt.closed;
    let clean = false;
    for (let tick = 0; tick < 100; tick++) {
      await sleep(10);
      if (isZero()) {
        clean = true;
        break;
      }
    }
    if (!clean) throw new Error("leak cycle " + cycle + " " + JSON.stringify(__wtResourceStats()));
    if ((cycle + 1) % 20 === 0) console.log("CYCLES " + (cycle + 1));
  }
  console.log("PASS: native 100 reconnects active echo and zero resource baseline");
  process.exit(0);
}
main().catch((e) => {
  console.log("FAIL: " + e.message);
  process.exit(1);
});
`,
      { allowInsecurePeerVerification: true, timeoutMs: 90_000 },
    );
    expect(out).toContain("PASS: native 100 reconnects active echo and zero resource baseline");
    expect(out).toContain("CYCLES 100");
  }, 120_000);

  it("resolves localhost through the OS resolver", async ({ skip }) => {
    requireWebTransport(skip);
    const out = await runTrustedScript(
      "wt-dns-system.js",
      `async function main() {
        const wt = new WebTransport('https://localhost:${SERVER_PORT}/echo');
        wt.closed.catch(() => {});
        await wt.ready;
        const writer = wt.datagrams.writable.getWriter();
        const reader = wt.datagrams.readable.getReader();
        await writer.write(new Uint8Array([23, 59]));
        const { value, done } = await reader.read();
        if (done || value.length !== 2 || value[0] !== 23 || value[1] !== 59)
          throw new Error('OS resolver echo mismatch');
        reader.releaseLock();
        writer.releaseLock();
        wt.close();
        await wt.closed;
        console.log('PASS: OS resolver exact echo');
      }
      main().then(() => process.exit(0)).catch((error) => {
        console.log('FAIL: ' + error.message);
        process.exit(1);
      });`,
    );
    expect(out).toContain("PASS: OS resolver exact echo");
  }, 30_000);

  it("renders while DNS is delayed", async ({ skip }) => {
    requireWebTransport(skip);
    const out = await runTrustedScript(
      "wt-dns-delayed.js",
      `const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  let wt = null;
  let running = true;
  let frames = 0;
  try {
    const frame = () => {
      if (!running) return;
      frames++;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    wt = new WebTransport("${DNS_TEST_URL}");
    wt.closed.catch(() => {});
    let readySettled = false;
    const ready = wt.ready.then(
      () => { readySettled = true; return true; },
      () => { readySettled = true; return false; },
    );
    await sleep(100);
    if (readySettled) throw new Error("ready settled during the delayed DNS window");
    if (frames < 2) throw new Error("requestAnimationFrame stalled; frames=" + frames);
    if (!(await ready)) throw new Error("delayed DNS connection was rejected");
    const payload = new Uint8Array([3, 1, 4, 1, 5, 9]);
    const writer = wt.datagrams.writable.getWriter();
    const reader = wt.datagrams.readable.getReader();
    await writer.write(payload);
    const echoed = await reader.read();
    if (
      echoed.done ||
      !echoed.value ||
      echoed.value.length !== payload.length ||
      echoed.value.some((byte, index) => byte !== payload[index])
    ) {
      throw new Error("delayed DNS datagram mismatch");
    }
    reader.releaseLock();
    writer.releaseLock();
    wt.close();
    if (!(await wt.closed.then(() => true, () => false)))
      throw new Error("delayed DNS session closed with an error");
    console.log("PASS: renders while DNS is delayed frames=" + frames);
  } finally {
    running = false;
    if (wt) {
      try { wt.close(); } catch (_) {}
      await wt.closed.catch(() => {});
    }
  }
}
main().then(() => process.exit(0)).catch((error) => {
  console.log("FAIL: " + (error && error.message ? error.message : error));
  process.exit(1);
});
`,
      { dnsAddresses: "127.0.0.1", dnsDelayMs: 500 },
    );
    expect(out).toContain("PASS: renders while DNS is delayed frames=");
  }, 30_000);

  it("ignores DNS result after close", async ({ skip }) => {
    requireWebTransport(skip);
    const out = await runTrustedScript(
      "wt-dns-close.js",
      `const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nativeKeys = [
  "sessions", "streams", "queuedReliableBytes", "queuedDatagrams", "queuedEvents",
  "inFlightReceiveBytes", "readCreditBytes", "pendingHeaderBytes",
];
const jsKeys = [
  "sessions", "streams", "queuedReliableBytes", "queuedReliableOperations",
  "queuedDatagramOperations", "queuedDatagrams", "queuedEvents", "queuedReceiveBytes",
  "incomingDatagramDrops",
];
function resourceStats() {
  const stats = __wtResourceStats();
  if (!stats || stats.nativeAvailable !== true || !stats.native || !stats.js)
    throw new Error("native/js WebTransport resource stats are unavailable");
  for (const [part, keys] of [[stats.native, nativeKeys], [stats.js, jsKeys]]) {
    for (const key of keys) {
      if (!Number.isFinite(part[key])) throw new Error("missing resource stat " + key);
      if (Number(part[key]) < 0) throw new Error("negative resource stat " + key);
    }
  }
  return stats;
}
function isZero(stats) {
  return [
    [stats.native, nativeKeys],
    [stats.js, jsKeys],
  ].every(([part, keys]) => keys.every((key) => Number(part[key]) === 0));
}
async function main() {
  let wt = null;
  try {
    wt = new WebTransport("${DNS_TEST_URL}");
    wt.closed.catch(() => {});
    let readyState = "pending";
    let closedState = "pending";
    const ready = wt.ready.then(
      () => { readyState = "fulfilled"; },
      () => { readyState = "rejected"; },
    );
    const closed = wt.closed.then(
      () => { closedState = "fulfilled"; },
      () => { closedState = "rejected"; },
    );
    await sleep(100);
    if (readyState !== "pending") throw new Error("ready settled before close");
    wt.close();
    // Wait beyond the injected 500 ms lookup, even when local close settles
    // immediately. Early cleanup alone cannot prove a late result is discarded.
    await sleep(700);
    const last = resourceStats();
    if (readyState === "rejected" && closedState === "rejected" && isZero(last)) {
      console.log("PASS: ignores DNS result after close");
      return;
    }
    throw new Error(
      "late DNS result was not discarded: ready=" + readyState +
        " closed=" + closedState + " stats=" + JSON.stringify(last),
    );
  } finally {
    if (wt) {
      try { wt.close(); } catch (_) {}
      await wt.closed.catch(() => {});
    }
  }
}
main().then(() => process.exit(0)).catch((error) => {
  console.log("FAIL: " + (error && error.message ? error.message : error));
  process.exit(1);
});
`,
      { dnsAddresses: "127.0.0.1", dnsDelayMs: 500 },
    );
    expect(out).toContain("PASS: ignores DNS result after close");
  }, 30_000);

  it("tries second resolved address", async ({ skip }) => {
    requireWebTransport(skip);
    const fallback = await runTrustedScript(
      "wt-dns-fallback-ipv4.js",
      `async function main() {
  let wt = null;
  try {
    wt = new WebTransport("${DNS_TEST_URL}");
    wt.closed.catch(() => {});
    await wt.ready;
    const payload = new Uint8Array([8, 6, 7, 5, 3, 0, 9]);
    const writer = wt.datagrams.writable.getWriter();
    const reader = wt.datagrams.readable.getReader();
    await writer.write(payload);
    const echoed = await reader.read();
    if (
      echoed.done ||
      !echoed.value ||
      echoed.value.length !== payload.length ||
      echoed.value.some((byte, index) => byte !== payload[index])
    ) {
      throw new Error("second resolved IPv4 address echo mismatch");
    }
    reader.releaseLock();
    writer.releaseLock();
    wt.close();
    if (!(await wt.closed.then(() => true, () => false)))
      throw new Error("fallback session closed with an error");
    console.log("PASS: tries second resolved address IPv4 echo");
  } finally {
    if (wt) {
      try { wt.close(); } catch (_) {}
      await wt.closed.catch(() => {});
    }
  }
}
main().then(() => process.exit(0)).catch((error) => {
  console.log("FAIL: " + (error && error.message ? error.message : error));
  process.exit(1);
});
`,
      { dnsAddresses: "::1,127.0.0.1" },
    );
    expect(fallback).toContain("PASS: tries second resolved address IPv4 echo");
  }, 30_000);

  it("echoes through a numeric IPv6 address", async ({ skip }) => {
    requireWebTransport(skip);
    const ipv6Fixture = spawnIpv6Server();
    try {
      let address: string;
      try {
        address = await ipv6Fixture.ready;
      } catch (error) {
        const reason = `requires an IPv6 WebTransport fixture: ${
          error instanceof Error ? error.message : String(error)
        }`;
        if (REQUIRE_LIVE_FIXTURE) throw new Error(reason);
        skip(reason);
        return;
      }
      const ipv6 = await runTrustedScript(
        "wt-dns-ipv6.js",
        `async function main() {
  let wt = null;
  try {
    wt = new WebTransport("https://${address}/echo");
    wt.closed.catch(() => {});
    await wt.ready;
    const payload = new Uint8Array([2, 7, 1, 8, 2, 8]);
    const writer = wt.datagrams.writable.getWriter();
    const reader = wt.datagrams.readable.getReader();
    await writer.write(payload);
    const echoed = await reader.read();
    if (
      echoed.done ||
      !echoed.value ||
      echoed.value.length !== payload.length ||
      echoed.value.some((byte, index) => byte !== payload[index])
    ) {
      throw new Error("numeric IPv6 echo mismatch");
    }
    reader.releaseLock();
    writer.releaseLock();
    wt.close();
    if (!(await wt.closed.then(() => true, () => false)))
      throw new Error("numeric IPv6 session closed with an error");
    console.log("PASS: numeric IPv6 echo");
  } finally {
    if (wt) {
      try { wt.close(); } catch (_) {}
      await wt.closed.catch(() => {});
    }
  }
}
main().then(() => process.exit(0)).catch((error) => {
  console.log("FAIL: " + (error && error.message ? error.message : error));
  process.exit(1);
});
`,
        {},
      );
      expect(ipv6).toContain("PASS: numeric IPv6 echo");
    } finally {
      await stopOwnedServer(ipv6Fixture.child);
    }
  }, 45_000);

  it("rejects malformed resolver environment", async ({ skip }) => {
    requireWebTransport(skip);
    const results = await Promise.all(
      INVALID_DNS_CASES.map(async (testCase) => {
        const out = await runTrustedScript(
          `wt-dns-invalid-${testCase.label}.js`,
          `const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  let wt = null;
  try {
    const admitted = __wtConnect("${DNS_TEST_URL}");
    if (admitted !== 0) {
      __wtClose(admitted);
      throw new Error("malformed resolver configuration was admitted");
    }
    wt = new WebTransport("${DNS_TEST_URL}");
    wt.closed.catch(() => {});
    let readyState = "pending";
    let closedState = "pending";
    const ready = wt.ready.then(
      () => { readyState = "fulfilled"; },
      () => { readyState = "rejected"; },
    );
    const closed = wt.closed.then(
      () => { closedState = "fulfilled"; },
      () => { closedState = "rejected"; },
    );
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && (readyState === "pending" || closedState === "pending"))
      await sleep(10);
    if (readyState !== "rejected" || closedState !== "rejected") {
      throw new Error("malformed resolver was accepted: ready=" + readyState + " closed=" + closedState);
    }
    await Promise.all([ready, closed]);
    console.log("PASS: malformed resolver ${testCase.label}");
  } finally {
    if (wt) {
      try { wt.close(); } catch (_) {}
      await wt.closed.catch(() => {});
    }
  }
}
main().then(() => process.exit(0)).catch((error) => {
  console.log("FAIL: " + (error && error.message ? error.message : error));
  process.exit(1);
});
`,
          {
            dnsAddresses: testCase.dnsAddresses,
            dnsDelayMs: testCase.dnsDelayMs,
            timeoutMs: 5_000,
          },
        );
        return { label: testCase.label, out };
      }),
    );
    for (const result of results) {
      expect(result.out, result.label).toContain(`PASS: malformed resolver ${result.label}`);
    }
  }, 30_000);
});

// Verified trust is its own fixture, deliberately separate from the development
// self-signed cases above: those prove the insecure override still works and is
// still required, this block proves a real certificate is accepted with peer
// verification on and no override anywhere. The certificate is minted per run into
// the untracked test directory and removed afterwards; the private key never leaves
// it and is never printed. No machine trust store is touched.
const TRUST_DIR = join(TEST_DIR, "trust");
const TRUST_CERT = join(TRUST_DIR, "trusted-cert.pem");
const TRUST_KEY = join(TRUST_DIR, "trusted-key.pem");
const TRUST_ABSENT = join(TRUST_DIR, "absent-cert.pem");
const TRUST_MALFORMED = join(TRUST_DIR, "malformed-cert.pem");
const TRUST_DIAGNOSTIC = "could not be loaded as trusted CA certificates";

let trustUnavailableReason: string | null = null;
let trustServer: ChildProcess | null = null;
let untrustedServer: ChildProcess | null = null;
let trustAuthority = "";
let untrustedAuthority = "";
const namedAuthority = (authority: string): string =>
  `localhost:${authority.slice(authority.lastIndexOf(":") + 1)}`;

// The certificate names localhost and 127.0.0.1. Measured on 2026-09-06: this quiche
// build refuses an IP-literal authority even when the certificate carries the matching
// IP SAN and is the loaded trust anchor, while the same certificate and anchor verify
// through the DNS name — so trust cases address the fixture by name, and the separate
// IP-literal name-check limitation is Task 1b's certificate/hostname fixture work, not
// something this row papers over.
function mintTrustFixture(): string | null {
  mkdirSync(TRUST_DIR, { recursive: true });
  const openssl = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
      "-nodes",
      "-keyout",
      TRUST_KEY,
      "-out",
      TRUST_CERT,
      "-days",
      "2",
      "-subj",
      "/CN=threenative-networking-fixture",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  if (openssl.status !== 0) {
    // stderr is not echoed: it is openssl's, and this path runs beside key material.
    return `requires an openssl that can mint the trust fixture (exit ${openssl.status})`;
  }
  if (!existsSync(TRUST_CERT) || !existsSync(TRUST_KEY)) return "requires a minted trust fixture";
  writeFileSync(TRUST_MALFORMED, "not a certificate\n");
  rmSync(TRUST_ABSENT, { force: true });
  return null;
}

function requireTrustFixture(skip: (note?: string) => never): void {
  requireWebTransport(skip);
  if (!trustUnavailableReason) return;
  failClosed(trustUnavailableReason);
  skip(trustUnavailableReason);
}

// One datagram round trip against `url`, asserting the echoed bytes rather than
// `ready` alone: an endpoint that accepts a connection and answers nothing is not
// a reachable endpoint.
const datagramEchoSource = (url: string, label: string): string => `async function main() {
  const wt = new WebTransport('${url}');
  wt.closed.catch(() => {});
  await wt.ready;
  const payload = new Uint8Array([9, 5, 3, 1]);
  const writer = wt.datagrams.writable.getWriter();
  const reader = wt.datagrams.readable.getReader();
  await writer.write(payload);
  const echoed = await reader.read();
  if (echoed.done || !echoed.value || echoed.value.length !== payload.length ||
      echoed.value.some((byte, index) => byte !== payload[index])) {
    throw new Error('echo mismatch');
  }
  reader.releaseLock();
  writer.releaseLock();
  wt.close();
  await wt.closed.catch(() => {});
  console.log('PASS: ${label}');
}
main().then(() => process.exit(0)).catch((error) => {
  console.log('FAIL: ' + (error && error.message ? error.message : error));
  process.exit(1);
});
`;

// A connection that must not establish: `ready` resolving is the failure.
const rejectionSource = (url: string, acceptedNote: string): string => `async function main() {
  const wt = new WebTransport('${url}');
  wt.closed.catch(() => {});
  try { await wt.ready; console.log('FAIL: ${acceptedNote}'); }
  catch (e) { console.log('PASS: rejected ' + e.message); }
  process.exit(0);
}
main();
`;

// The exact-endpoint reachability control a secure negative needs. Deliberately
// insecure — MYSTRAL_WEBTRANSPORT_INSECURE=1 through the existing runTrustedScript
// helper — and never used by the trusted positive, which runs with verification on
// and no override. It proves the identical URL, DNS mapping and listening peer
// complete a byte-exact echo, so the rejection that follows is TLS refusing this
// endpoint rather than a dead port, an unresolved name or a fixture that died.
async function expectInsecureEchoReachable(
  name: string,
  url: string,
  options: Omit<ScriptOptions, "allowInsecurePeerVerification"> = {},
): Promise<void> {
  const out = await runTrustedScript(name, datagramEchoSource(url, "endpoint reachable"), {
    timeoutMs: 15_000,
    ...options,
  });
  expect(out).toContain("PASS: endpoint reachable");
  // The control is only a control if it really ran without verification.
  expect(out).toContain("TLS peer verification disabled");
}

describe("WebTransport verified certificate trust", () => {
  beforeAll(async () => {
    if (unavailableReason) {
      trustUnavailableReason = unavailableReason;
      return;
    }
    trustUnavailableReason = buildServerExecutable() ?? mintTrustFixture();
    if (trustUnavailableReason) {
      failClosed(trustUnavailableReason);
      return;
    }
    const fixture = spawnFixtureServer(
      "verified-trust",
      ["--listen", "127.0.0.1:0", "--cert", TRUST_CERT, "--key", TRUST_KEY],
      /LISTENING udp=(127\.0\.0\.1:\d+)/u,
    );
    trustServer = fixture.child;
    // A second live peer, presenting the development self-signed certificate the
    // fixture CA above does not sign. The untrusted negative has to be refused by
    // verification, not by there being nothing to connect to.
    const untrusted = spawnFixtureServer(
      "untrusted-peer",
      ["--listen", "127.0.0.1:0", "--dev-self-signed"],
      /LISTENING udp=(127\.0\.0\.1:\d+)/u,
    );
    untrustedServer = untrusted.child;
    try {
      trustAuthority = await fixture.ready;
      untrustedAuthority = await untrusted.ready;
    } catch (error) {
      trustUnavailableReason = `requires a verified-certificate WebTransport fixture: ${
        error instanceof Error ? error.message : String(error)
      }`;
      failClosed(trustUnavailableReason);
    }
  }, FIXTURE_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    try {
      const results = await Promise.allSettled(
        [trustServer, untrustedServer].filter((child) => child !== null).map(stopOwnedServer),
      );
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length > 0) {
        throw new AggregateError(
          failures.map((result) => result.reason),
          "TLS fixture shutdown failed",
        );
      }
    } finally {
      trustServer = null;
      untrustedServer = null;
      rmSync(TRUST_DIR, { force: true, recursive: true });
    }
  });

  it("accepts a trusted certificate without the development override", async ({ skip }) => {
    requireTrustFixture(skip);
    const out = await runScript(
      "wt-trust-accepted.js",
      datagramEchoSource(
        `https://${namedAuthority(trustAuthority)}/echo`,
        "trusted certificate accepted",
      ),
      { trustFile: TRUST_CERT },
    );
    expect(out).toContain("PASS: trusted certificate accepted");
    // The positive case must be a real verification, not a bypass.
    expect(out).toContain("TLS peer verification mode: verify-peer");
    expect(out).not.toContain("TLS peer verification disabled");
    expect(out).not.toContain("MYSTRAL_WEBTRANSPORT_INSECURE=1");
  }, 30_000);

  it("rejects a trusted certificate presented for the wrong hostname", async ({ skip }) => {
    requireTrustFixture(skip);
    const port = trustAuthority.slice(trustAuthority.lastIndexOf(":") + 1);
    const url = `https://${DNS_TEST_HOST}:${port}/echo`;
    // Same URL, same DNS mapping, verification off: bytes come back.
    await expectInsecureEchoReachable("wt-trust-wrong-hostname-control.js", url, {
      trustFile: TRUST_CERT,
      dnsAddresses: "127.0.0.1",
    });
    const out = await runScript(
      "wt-trust-wrong-hostname.js",
      rejectionSource(url, "accepted the wrong hostname"),
      { trustFile: TRUST_CERT, dnsAddresses: "127.0.0.1", timeoutMs: 15_000 },
    );
    expect(out).toContain("PASS: rejected");
    // The anchor is loaded and verification is on: the name is the only thing wrong.
    expect(out).toContain("TLS peer verification mode: verify-peer");
    expect(out).not.toContain(TRUST_DIAGNOSTIC);
    expect(out).not.toContain("TLS peer verification disabled");
  }, 45_000);

  it("rejects an untrusted certificate while an explicit trust file is set", async ({ skip }) => {
    requireTrustFixture(skip);
    const url = `https://${namedAuthority(untrustedAuthority)}/echo`;
    // Same URL, same peer, verification off: bytes come back.
    await expectInsecureEchoReachable("wt-trust-untrusted-control.js", url, {
      trustFile: TRUST_CERT,
    });
    const out = await runScript(
      "wt-trust-untrusted-peer.js",
      rejectionSource(url, "accepted an untrusted certificate"),
      { trustFile: TRUST_CERT, timeoutMs: 15_000 },
    );
    expect(out).toContain("PASS: rejected");
    expect(out).toContain("TLS peer verification mode: verify-peer");
    expect(out).not.toContain("TLS peer verification disabled");
  }, 45_000);

  it("refuses an unreadable trust file", async ({ skip }) => {
    requireTrustFixture(skip);
    const out = await runScript(
      "wt-trust-unreadable.js",
      rejectionSource(
        `https://${namedAuthority(trustAuthority)}/echo`,
        "connected with an unreadable trust file",
      ),
      { trustFile: TRUST_ABSENT, timeoutMs: 15_000 },
    );
    expect(out).toContain("PASS: rejected");
    expect(out).toContain(TRUST_DIAGNOSTIC);
    expect(out).toContain(TRUST_ABSENT);
  }, 30_000);

  it("refuses a malformed trust file", async ({ skip }) => {
    requireTrustFixture(skip);
    const out = await runScript(
      "wt-trust-malformed.js",
      rejectionSource(
        `https://${namedAuthority(trustAuthority)}/echo`,
        "connected with a malformed trust file",
      ),
      { trustFile: TRUST_MALFORMED, timeoutMs: 15_000 },
    );
    expect(out).toContain("PASS: rejected");
    expect(out).toContain(TRUST_DIAGNOSTIC);
  }, 30_000);
});
