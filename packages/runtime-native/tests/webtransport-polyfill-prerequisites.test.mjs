import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

/**
 * The WebTransport polyfill's install-time prerequisite.
 *
 * `webtransport.cpp` evals this script and then reads `globalThis.__wtDispatch`, treating its
 * absence as a hard failure that fails `initBindings`. The script installs nothing when Web
 * Streams are missing - deliberately, and with a console error - so an engine that has not run
 * the streams polyfill first turns a legitimate "WebTransport unavailable" into
 *
 *   [error] [WebTransport] Web Streams not available; WebTransport disabled.
 *   [WebTransport] __wtDispatch not defined by polyfill
 *
 * `Runtime::init` sequences them correctly (setupFetch installs streams before
 * `webtransport::initBindings`). A caller that drives `initBindings` against a bare engine does
 * not, which is what `tests/cli_network_fs_test.cpp` did. This pins the ordering requirement so
 * the dependency is stated somewhere executable rather than only in the sequence of two call
 * sites 1700 lines apart.
 */

function readScript(name) {
  return readFileSync(
    fileURLToPath(new URL(`../src/runtime-scripts/${name}.js`, import.meta.url)),
    "utf8",
  );
}

/** A bare engine global: the native `__wt*` bridge is registered, nothing else. */
function bareEngineContext() {
  const errors = [];
  const context = {
    console: { error: (...args) => errors.push(args.join(" ")), log: () => {}, warn: () => {} },
    queueMicrotask: (fn) => void Promise.resolve().then(fn),
    setTimeout,
    clearTimeout,
  };
  for (const bridge of [
    "__wtConnect",
    "__wtClose",
    "__wtSendDatagram",
    "__wtCreateStream",
    "__wtStreamWrite",
    "__wtStreamShutdown",
  ]) {
    context[bridge] = () => 0;
  }
  context.globalThis = context;
  vm.createContext(context);
  return { context, errors };
}

test("declines to install, with a console error, when Web Streams are absent", () => {
  const { context, errors } = bareEngineContext();
  vm.runInContext(readScript("webtransport-polyfill"), context, {
    filename: "webtransport-polyfill.js",
  });
  assert.equal(
    typeof context.__wtDispatch,
    "undefined",
    "the polyfill must not half-install without its prerequisite",
  );
  assert.ok(
    errors.some((line) => line.includes("Web Streams not available")),
    `expected the decline to be reported, got: ${JSON.stringify(errors)}`,
  );
});

test("installs __wtDispatch once the streams polyfill has run first", () => {
  const { context, errors } = bareEngineContext();
  vm.runInContext(readScript("streams-polyfill"), context, { filename: "streams-polyfill.js" });
  assert.equal(typeof context.ReadableStream, "function", "streams polyfill did not install");
  vm.runInContext(readScript("webtransport-polyfill"), context, {
    filename: "webtransport-polyfill.js",
  });
  assert.equal(
    typeof context.__wtDispatch,
    "function",
    `webtransport.cpp reads this global and fails initBindings without it; console: ${JSON.stringify(errors)}`,
  );
  assert.equal(typeof context.WebTransport, "function");
});

test("the C++ caller that drives initBindings on a bare engine installs streams first", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./cli_network_fs_test.cpp", import.meta.url)),
    "utf8",
  );
  // Code lines only: the call site carries a comment naming both symbols to explain the order,
  // and matching that text would make this assertion pass on the comment rather than the code.
  const code = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  const webtransportAt = code.indexOf("webtransport::initBindings(engine");
  assert.ok(webtransportAt > 0, "cli_network_fs_test.cpp no longer calls initBindings");
  // Fully qualified: runtime.cpp can say `runtime_scripts::find` because it sits inside
  // `namespace mystral`, but this test file is at file scope, where the unqualified name does not
  // resolve - `error: use of undeclared identifier 'runtime_scripts'`, which is how it broke all
  // three platform builds.
  const streamsAt = code.indexOf('mystral::runtime_scripts::find("streams-polyfill")');
  assert.ok(
    streamsAt > 0 && streamsAt < webtransportAt,
    "streams-polyfill must be evaluated before webtransport::initBindings, as Runtime::init does",
  );
});
