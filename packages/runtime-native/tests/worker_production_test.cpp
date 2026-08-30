// PRD-250 Phase 2 — the production worker contract, against real threads and a real Runtime.
//
// Every check runs through the shipped path: RuntimeImpl installs the native worker callbacks and
// the standard `Worker` facade, WorkerRegistry starts a real thread with its own JS engine, and
// pollEvents() drains completions in the host I/O segment exactly as the game loop does. Nothing
// reaches into WorkerThread directly — a standalone harness is what this PRD refuses as evidence.
//
// The assertions live in JavaScript because that is where a game observes them. This file creates
// the runtime, pumps the host loop, and turns the isolate's verdict into an exit code. Each
// contract prints one `WORKER_CONTRACT <name> PASS|FAIL [detail]` line for
// tests/native-worker-production.test.mjs to require by name.

#include "mystral/runtime.h"

#include <chrono>
#include <iostream>
#include <string>
#include <thread>

using mystral::Runtime;
using mystral::RuntimeConfig;

namespace {

const char* kSetup = R"JS(
globalThis.__done = false;
globalThis.__log = [];
globalThis.__verdicts = [];

const blobUrl = (source) => URL.createObjectURL(new Blob([source]));
const record = (name, pass, detail) => __verdicts.push({ name, pass: !!pass, detail: detail || "" });

// --- cloneRefusalNamed: the game isolate refuses before anything is queued -------------------
{
  const probe = new Worker(blobUrl("self.onmessage = () => {};"));
  const refusals = [];
  for (const make of [
    () => ({ run: () => 1 }),
    () => { const a = {}; a.self = a; return a; },
    () => ({ n: NaN }),
  ]) {
    try {
      probe.postMessage(make());
      refusals.push("accepted");
    } catch (error) {
      refusals.push(error.name + ":" + (String(error.message).includes("TN_NATIVE_WORKER_CLONE_UNSUPPORTED") ? "named" : "unnamed"));
    }
  }
  const allNamed = refusals.every((row) => row === "DataCloneError:named");
  record("cloneRefusalNamed", allNamed, allNamed ? "" : refusals.join(","));
  probe.terminate();
}

// --- fifoAcrossHandlerRegistration ----------------------------------------------------------
// The worker posts before the main isolate could possibly have drained anything; the handler is
// attached after construction, as a game attaches it.
const fifo = new Worker(blobUrl(`
  for (let i = 1; i <= 5; i += 1) postMessage({ seq: i });
  self.onmessage = (event) => { postMessage({ echo: event.data.seq }); };
`));
globalThis.__fifoSeen = [];
fifo.onmessage = (event) => {
  __fifoSeen.push(event.data);
  if (__fifoSeen.length === 5) fifo.postMessage({ seq: 99 });
};

// --- cloneMatrixRoundTrip -------------------------------------------------------------------
const echo = new Worker(blobUrl(`
  self.onmessage = (event) => { postMessage(event.data); };
`));
globalThis.__echoed = null;
globalThis.__echoSubject = {
  n: -1.5, s: "text", t: true, u: undefined, z: null,
  list: [1, "two", false, undefined, null, { deep: { deeper: [] } }],
  record: { a: 0, b: { c: "d" } },
};
echo.onmessage = (event) => { __echoed = event.data; };
echo.postMessage(__echoSubject);

// --- binaryCloneAndWorkerEventListener ------------------------------------------------------
// KTX2Loader uses addEventListener and transfers ArrayBuffers in both directions. The native
// wire copies these values, but must preserve their binary type and bytes.
const binary = new Worker(blobUrl(`
  self.addEventListener("message", (event) => {
    const input = new Uint8Array(event.data.buffer);
    const output = new Uint8Array([input[3], input[2], input[1], input[0]]);
    self.postMessage({ buffer: event.data.buffer, output }, [event.data.buffer, output.buffer]);
  });
`));
globalThis.__binaryResult = null;
binary.onmessage = (event) => {
  __binaryResult = {
    input: Array.from(new Uint8Array(event.data.buffer)),
    output: Array.from(event.data.output),
    typed: event.data.output instanceof Uint8Array,
  };
};
const binaryInput = new Uint8Array([3, 1, 4, 1]).buffer;
binary.postMessage({ buffer: binaryInput }, [binaryInput]);

// --- wasmPromiseTasksAfterMessage -----------------------------------------------------------
const promised = new Worker(blobUrl(`
  self.addEventListener("message", (event) => {
    WebAssembly.compile(event.data.module).then(() => postMessage({ compiled: true }));
  });
`));
globalThis.__promiseResult = null;
promised.onmessage = (event) => { __promiseResult = event.data.compiled; };
const emptyWasmModule = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer;
promised.postMessage({ module: emptyWasmModule }, [emptyWasmModule]);

// --- topLevelThrowReachesError --------------------------------------------------------------
const boom = new Worker(blobUrl("throw new Error('top level exploded');"));
globalThis.__topLevelError = null;
boom.onerror = (event) => { __topLevelError = String(event.message); };

// --- handlerThrowReachesError ---------------------------------------------------------------
// A throw inside onmessage used to be printed in the worker and swallowed; the caller then got
// neither a result nor an error.
const thrower = new Worker(blobUrl(`
  self.onmessage = () => { throw new Error('handler exploded'); };
`));
globalThis.__handlerError = null;
globalThis.__handlerMessage = null;
thrower.onerror = (event) => { __handlerError = String(event.message); };
thrower.onmessage = (event) => { __handlerMessage = event.data; };
thrower.postMessage({ go: true });

// --- workerSideCloneRefusalReachesError -----------------------------------------------------
// The worker isolate's own copy of the matrix, proven inside a real worker engine.
const badSender = new Worker(blobUrl(`
  self.onmessage = () => { const a = {}; a.self = a; postMessage(a); };
`));
globalThis.__badSenderError = null;
badSender.onerror = (event) => { __badSenderError = String(event.message); };
badSender.postMessage({ go: true });

// --- finalMessageSurvivesSelfClose ----------------------------------------------------------
// close() stops the worker. Its already-queued result must still be delivered.
const closer = new Worker(blobUrl(`
  postMessage({ final: "delivered" });
  close();
`));
globalThis.__finalFromClosed = null;
closer.onmessage = (event) => { __finalFromClosed = event.data; };

// --- terminateStopsCallbacks ----------------------------------------------------------------
const doomed = new Worker(blobUrl(`
  self.onmessage = () => { for (let i = 0; i < 200; i += 1) postMessage({ noisy: i }); };
`));
globalThis.__afterTerminate = 0;
doomed.onmessage = () => { __afterTerminate += 1; };
doomed.postMessage({ go: true });
doomed.terminate();

// --- shutdownJoinsEveryWorker ---------------------------------------------------------------
// Four live workers terminated in a row. A join that deadlocks never reaches the record() below,
// and the pump budget turns that into a failure rather than a hang.
globalThis.__joinAll = () => {
  const many = [];
  for (let i = 0; i < 4; i += 1) {
    many.push(new Worker(blobUrl("self.onmessage = () => { postMessage(1); };")));
  }
  for (const worker of many) worker.postMessage({ go: true });
  for (const worker of many) worker.terminate();
  return many.length;
};

globalThis.__settle = () => {
  const fifoOk =
    __fifoSeen.length === 6 &&
    __fifoSeen.slice(0, 5).every((row, index) => row && row.seq === index + 1) &&
    __fifoSeen[5] && __fifoSeen[5].echo === 99;
  record("fifoAcrossHandlerRegistration", fifoOk, fifoOk ? "" : JSON.stringify(__fifoSeen));

  const echoOk =
    JSON.stringify(__echoed) === JSON.stringify(__echoSubject) &&
    Object.hasOwn(__echoed, "u") &&
    __echoed.u === undefined &&
    __echoed.list.length === 6 &&
    __echoed.list[3] === undefined;
  record("cloneMatrixRoundTrip", echoOk, echoOk ? "" : JSON.stringify(__echoed));

  const binaryOk =
    __binaryResult !== null &&
    JSON.stringify(__binaryResult.input) === "[3,1,4,1]" &&
    JSON.stringify(__binaryResult.output) === "[1,4,1,3]" &&
    __binaryResult.typed === true;
  record("binaryCloneAndWorkerEventListener", binaryOk, binaryOk ? "" : JSON.stringify(__binaryResult));

  record(
    "wasmPromiseTasksAfterMessage",
    __promiseResult === true,
    "value=" + String(__promiseResult)
  );

  const topOk = typeof __topLevelError === "string" && __topLevelError.includes("top level exploded");
  record("topLevelThrowReachesError", topOk, topOk ? "" : String(__topLevelError));

  const handlerOk =
    typeof __handlerError === "string" &&
    __handlerError.includes("handler exploded") &&
    __handlerMessage === null;
  record("handlerThrowReachesError", handlerOk, handlerOk ? "" : String(__handlerError));

  const badOk =
    typeof __badSenderError === "string" &&
    __badSenderError.includes("TN_NATIVE_WORKER_CLONE_UNSUPPORTED");
  record("workerSideCloneRefusalReachesError", badOk, badOk ? "" : String(__badSenderError));

  const finalOk = __finalFromClosed !== null && __finalFromClosed.final === "delivered";
  record("finalMessageSurvivesSelfClose", finalOk, finalOk ? "" : String(JSON.stringify(__finalFromClosed)));

  record("terminateStopsCallbacks", __afterTerminate === 0, "delivered=" + __afterTerminate);

  const joined = __joinAll();
  record("shutdownJoinsEveryWorker", joined === 4, "joined=" + joined);
};

// Everything above is queued. The pump below drains completions; __ready flips once every
// observation this run needs has either arrived or had its chance.
globalThis.__ready = () =>
  __fifoSeen.length === 6 &&
  __echoed !== null &&
  __binaryResult !== null &&
  __promiseResult !== null &&
  __topLevelError !== null &&
  __handlerError !== null &&
  __badSenderError !== null &&
  __finalFromClosed !== null;
)JS";

const char* kSettleAndReport = R"JS(
(() => {
  __settle();
  let failed = 0;
  for (const row of __verdicts) {
    console.log("WORKER_CONTRACT " + row.name + (row.pass ? " PASS" : " FAIL " + row.detail));
    if (!row.pass) failed += 1;
  }
  if (failed > 0) process.exit(1);
})()
)JS";

}  // namespace

int main() {
    RuntimeConfig config;
    config.noSdl = true;
    config.width = 64;
    config.height = 64;
    auto runtime = Runtime::create(config);
    if (!runtime) {
        std::cerr << "FAILED: runtime creation" << std::endl;
        return 1;
    }

    if (!runtime->evalScript(kSetup, "worker-contract-setup")) {
        std::cerr << "FAILED: setup eval threw" << std::endl;
        return 1;
    }

    // Let every worker that intends to finish actually finish before the first drain. Without
    // this the main loop usually drains a self-closing worker while it is still running, and the
    // reap-before-drain hazard this gate exists to catch stays a race the gate never forces: the
    // registry must find a *stopped* worker with a queued result and still deliver it.
    std::this_thread::sleep_for(std::chrono::milliseconds(400));

    // Drive the real host loop until every observation has landed.
    if (!runtime->evalScript("globalThis.__done = false;", "worker-contract-reset")) return 1;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(20);
    bool ready = false;
    while (std::chrono::steady_clock::now() < deadline) {
        runtime->pollEvents();
        if (runtime->evalScript("if (!__ready()) { throw new Error('pending'); }",
                                "worker-contract-ready")) {
            ready = true;
            break;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }

    if (!ready) {
        // Report what did land, so a timeout names the missing observation instead of just hanging.
        runtime->evalScript(
            "console.log('WORKER_CONTRACT pumpReachedEveryObservation FAIL ' + JSON.stringify({"
            "fifo: __fifoSeen.length, echoed: __echoed !== null, binary: __binaryResult, promise: "
            "__promiseResult, topLevel: __topLevelError, "
            "handler: __handlerError, badSender: __badSenderError, closed: __finalFromClosed}));",
            "worker-contract-timeout");
        std::cerr << "FAILED: the host loop never delivered every worker observation" << std::endl;
        return 1;
    }

    if (!runtime->evalScript(kSettleAndReport, "worker-contract-report")) {
        std::cerr << "FAILED: verdict eval threw" << std::endl;
        return 1;
    }
    if (runtime->getExitCode() != 0) {
        std::cerr << "FAILED: one or more worker contracts, exit " << runtime->getExitCode()
                  << std::endl;
        return 1;
    }

    // A second Runtime in the same process must be able to create workers. The registry is a
    // process-wide singleton, so a shutdown that closed it permanently would leave every later
    // Runtime — which the native contract lane really does create — unable to make one.
    runtime.reset();
    auto second = Runtime::create(config);
    if (!second) {
        std::cout << "WORKER_CONTRACT registryReopensForASecondRuntime FAIL second runtime create"
                  << std::endl;
        return 1;
    }
    const char* kSecond = R"JS(
      globalThis.__secondOk = false;
      globalThis.__secondError = "";
      try {
        const worker = new Worker(URL.createObjectURL(new Blob(["postMessage({ second: true });"])));
        worker.onmessage = (event) => { __secondOk = event.data.second === true; };
      } catch (error) {
        __secondError = String(error.message);
      }
    )JS";
    if (!second->evalScript(kSecond, "worker-contract-second-runtime")) {
        std::cout << "WORKER_CONTRACT registryReopensForASecondRuntime FAIL setup threw" << std::endl;
        return 1;
    }
    const auto secondDeadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
    bool secondOk = false;
    while (std::chrono::steady_clock::now() < secondDeadline) {
        second->pollEvents();
        if (second->evalScript("if (__secondOk !== true) { throw new Error('pending'); }",
                               "worker-contract-second-ready")) {
            secondOk = true;
            break;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    if (!secondOk) {
        second->evalScript(
            "console.log('WORKER_CONTRACT registryReopensForASecondRuntime FAIL ' + "
            "(__secondError || 'no message from a worker in the second runtime'));",
            "worker-contract-second-fail");
        std::cerr << "FAILED: a second Runtime could not use workers" << std::endl;
        return 1;
    }
    std::cout << "WORKER_CONTRACT registryReopensForASecondRuntime PASS" << std::endl;

    std::cout << "[worker-production] every worker contract held" << std::endl;
    return 0;
}
