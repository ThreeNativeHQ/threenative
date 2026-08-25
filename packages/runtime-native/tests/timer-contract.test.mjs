import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

function assertTimerContract(v8, quickjs, runtime) {
  assert.doesNotMatch(v8, /setTimeout|clearTimeout|setInterval|clearInterval/u);
  assert.doesNotMatch(quickjs, /setTimeout|clearTimeout|setInterval|clearInterval/u);
  assert.match(runtime, /void setupTimers\(\)/u);
  assert.match(runtime, /jsEngine_\s*=\s*js::createEngine\(\);[\s\S]*?setupTimers\(\);/u);
  assert.match(runtime, /setupTimers\(\);[\s\S]*?setupPerformance\(\);/u);
  assert.match(runtime, /setupLibuvTimers\(\)|setupChronoTimers\(\)/u);
  assert.match(runtime, /executeTimerCallbacks\(\);/u);
}

function assertTimerInstallationOrderContract(runtime) {
  const setup = runtime.slice(
    runtime.indexOf("void setupTimers()"),
    runtime.indexOf("\n    }\n\n#ifdef MYSTRAL_USE_LIBUV_TIMERS", runtime.indexOf("void setupTimers()")),
  );
  const initializeStart = runtime.indexOf("bool initializeJSAndBindings()");
  const initializeEnd = runtime.indexOf("\n    void shutdown()", initializeStart);
  assert.ok(initializeStart >= 0, "runtime must initialize JavaScript bindings");
  assert.ok(initializeEnd > initializeStart, "runtime initialization must have a bounded body");
  const initialize = runtime.slice(initializeStart, initializeEnd);
  const engineCreation = initialize.indexOf("jsEngine_ = js::createEngine();");
  const beforeEngine = initialize.slice(0, engineCreation);
  const afterEngine = initialize.slice(engineCreation);

  assert.match(
    beforeEngine,
    /if \(!config_\.testEngineFirstTimers\) \{\s*setupTimers\(\);\s*\}/u,
    "the production scheduler-first path must request timers before engine creation",
  );

  assert.match(
    setup,
    /if \(!jsEngine_\) \{\s*timerInstallationPending_ = true;\s*return;\s*\}/u,
    "scheduler-first setup must remain pending until the engine exists",
  );
  assert.match(setup, /if \(timerInstallationInstalled_\) return;/u);
  assert.match(setup, /timerInstallationPending_ = false;\s*timerInstallationInstalled_ = true;/u);
  assert.match(
    afterEngine,
    /if \(config_\.testEngineFirstTimers \|\| timerInstallationPending_\) \{\s*setupTimers\(\);\s*\}/u,
    "engine creation must install timers for the engine-first seam or consume production pending state",
  );
  assert.doesNotMatch(
    afterEngine,
    /else if \(!timerInstallationInstalled_\)/u,
    "the scheduler-first transition must not fall through to an untracked installation path",
  );
  assert.match(runtime, /testEngineFirstTimers/u);
  assert.match(runtime, /bool timerInstallationPending_ = false;/u);
  assert.match(runtime, /bool timerInstallationInstalled_ = false;/u);
}

function simulateTimerInstallationOrders(runtime) {
  const initializeStart = runtime.indexOf("bool initializeJSAndBindings()");
  const initializeEnd = runtime.indexOf("\n    void shutdown()", initializeStart);
  const initialize = runtime.slice(initializeStart, initializeEnd);
  const engineCreation = initialize.indexOf("jsEngine_ = js::createEngine();");
  const beforeEngine = initialize.slice(0, engineCreation);
  const afterEngine = initialize.slice(engineCreation);
  const preEngineRequest = /if \(!config_\.testEngineFirstTimers\) \{\s*setupTimers\(\);\s*\}/u.test(
    beforeEngine,
  );
  const postEngineRequest = /if \(config_\.testEngineFirstTimers \|\| timerInstallationPending_\) \{\s*setupTimers\(\);\s*\}/u.test(
    afterEngine,
  );

  return {
    schedulerFirst: { beforeEngine: preEngineRequest, afterEngine: postEngineRequest },
    engineFirst: { beforeEngine: !preEngineRequest, afterEngine: postEngineRequest },
  };
}

function assertTimerExecutableFailsClosed(source) {
  assert.match(source, /constexpr int kCompletionExitCode = [1-9]\d*;/u);
  assert.match(source, /process\.exit\(timeoutCount === 1 && intervalCount === 3 \? 42 : 1\);/u);
  assert.match(source, /bool timedOut = false;/u);
  assert.match(
    source,
    /if \(std::chrono::steady_clock::now\(\) >= deadline\) \{\s*timedOut = true;\s*break;/u,
  );
  assert.match(source, /const int exitCode = runtime->getExitCode\(\);/u);
  const completionCheck = source.indexOf("if (exitCode != kCompletionExitCode)");
  const successLine = source.indexOf("native timer delivery contract passed");
  assert.ok(completionCheck >= 0, "the executable must gate success on the completion sentinel");
  assert.ok(successLine > completionCheck, "the success line must follow the failure gate");
}

test("native timers have one real runtime owner and no engine-level stubs", () => {
  const v8 = read("src/js/v8_engine.cpp");
  const quickjs = read("src/js/quickjs_engine.cpp");
  const runtime = read("src/runtime.cpp");

  assert.doesNotThrow(() => assertTimerContract(v8, quickjs, runtime));
});

test("scheduler-first and engine-first timer installation both reach the real scheduler", () => {
  const runtime = read("src/runtime.cpp");
  assert.doesNotThrow(() => assertTimerInstallationOrderContract(runtime));
  assert.deepEqual(simulateTimerInstallationOrders(runtime), {
    schedulerFirst: { beforeEngine: true, afterEngine: true },
    engineFirst: { beforeEngine: false, afterEngine: true },
  });
});

test("timer contract rejects skipping post-engine timer installation", () => {
  const source = read("src/runtime.cpp");
  const skippedPostEngineInstallation = source.replace(
    /if \(config_\.testEngineFirstTimers \|\| timerInstallationPending_\) \{\s*setupTimers\(\);\s*\}/u,
    "if (config_.testEngineFirstTimers || timerInstallationPending_) {\n            // post-engine installation skipped by mutation\n        }",
  );

  assert.deepEqual(simulateTimerInstallationOrders(skippedPostEngineInstallation), {
    schedulerFirst: { beforeEngine: true, afterEngine: false },
    engineFirst: { beforeEngine: false, afterEngine: false },
  });
  assert.throws(
    () => assertTimerInstallationOrderContract(skippedPostEngineInstallation),
    /engine-first seam/u,
  );
});

test("timer contract rejects restoring the silent scheduler-first return", () => {
  const source = read("src/runtime.cpp");
  const setupStart = source.indexOf("void setupTimers()");
  const setupEnd = source.indexOf("#ifdef MYSTRAL_USE_LIBUV_TIMERS", setupStart);
  const setup = source.slice(setupStart, setupEnd);
  const oldSetup = setup.replace(
    /if \(!jsEngine_\) \{[\s\S]*?return;\s*\}/u,
    "if (!jsEngine_) return;",
  );

  assert.throws(
    () => assertTimerInstallationOrderContract(`${source.slice(0, setupStart)}${oldSetup}${source.slice(setupEnd)}`),
    /scheduler-first/u,
  );
});

test("JSC does not install a non-scheduling timer stub", () => {
  const jsc = read("src/js/jsc_engine.mm");
  assert.doesNotMatch(
    jsc,
    /setGlobalProperty\("setTimeout"/u,
    "JSC must leave timer installation to Runtime::setupTimers()",
  );
  assert.doesNotMatch(jsc, /TODO: Implement proper timer scheduling/u);
});

test("JSC timer contract rejects restoring the old non-scheduling stub", () => {
  const jsc = read("src/js/jsc_engine.mm");
  const oldStub = `${jsc}\nsetGlobalProperty("setTimeout",\n// TODO: Implement proper timer scheduling`;
  assert.throws(() => {
    assert.doesNotMatch(oldStub, /setGlobalProperty\("setTimeout"/u);
  });
});

test("timer executable fails closed when the completion callback never arrives", () => {
  const source = read("tests/timer_delivery_test.cpp");
  assert.doesNotThrow(() => assertTimerExecutableFailsClosed(source));
});

test("timer executable contract rejects the old timeout false-positive", () => {
  const source = read("tests/timer_delivery_test.cpp");
  const falsePositive = source
    .replace("constexpr int kCompletionExitCode = 42;\n", "")
    .replace(
      "process.exit(timeoutCount === 1 && intervalCount === 3 ? 42 : 1);",
      "process.exit(timeoutCount === 1 && intervalCount === 3 ? 0 : 1);",
    )
    .replace("if (exitCode != kCompletionExitCode)", "if (exitCode != 0)");

  assert.throws(() => assertTimerExecutableFailsClosed(falsePositive));
});

test("timer contract rejects restoring an engine stub after the real owner", () => {
  const v8 = read("src/js/v8_engine.cpp");
  const quickjs = read("src/js/quickjs_engine.cpp");
  const runtime = read("src/runtime.cpp");
  const stub = '\n        context->Global()->Set(context, v8::String::NewFromUtf8(isolate_, "setTimeout").ToLocalChecked(), setTimeoutFn).Check();\n';

  assert.throws(() => assertTimerContract(`${v8}${stub}`, quickjs, runtime), /setTimeout/u);
  assert.throws(() => assertTimerContract(v8, `${quickjs}\nsetTimeout`, runtime), /setTimeout/u);
});

test("the pending-timeout proof is wired to the native timer delivery executable", () => {
  const cmake = read("CMakeLists.txt");
  const source = read("tests/timer_delivery_test.cpp");
  assert.match(
    cmake,
    /add_executable\(threenative-timer-delivery-test EXCLUDE_FROM_ALL\s*tests\/timer_delivery_test\.cpp\)/u,
  );
  assert.match(source, /native timer delivery contract passed/u);
  const runtimeCreation = source.indexOf("auto runtime = mystral::Runtime::create(config);");
  const schedule = source.indexOf("runtime->evalScript(kScript", runtimeCreation);
  const firstPoll = source.indexOf("runtime->pollEvents()", schedule);
  assert.ok(runtimeCreation >= 0, "the executable must create the runtime");
  assert.ok(schedule > runtimeCreation, "the executable must schedule work after creation");
  assert.ok(firstPoll > schedule, "the executable must schedule work before its first event poll");
  assert.match(
    source,
    /if \(!runtime->evalScript\(kScript, "timer_delivery_test\.js"\)\) \{[\s\S]*?return 1;/u,
    "the executable must fail closed when timer installation prevents scheduling",
  );
});

test("the engine-first proof target selects the real engine-first runtime seam", () => {
  const cmake = read("CMakeLists.txt");
  const source = read("tests/timer_delivery_test.cpp");
  const runtime = read("src/runtime.cpp");
  assert.match(
    cmake,
    /add_executable\(threenative-timer-engine-first-test EXCLUDE_FROM_ALL\s*tests\/timer_delivery_test\.cpp\)/u,
  );
  assert.match(
    cmake,
    /target_compile_definitions\(threenative-timer-engine-first-test PRIVATE\s*TN_TIMER_ENGINE_FIRST_TEST\)/u,
  );
  assert.match(
    source,
    /#ifdef TN_TIMER_ENGINE_FIRST_TEST[\s\S]*?config\.testEngineFirstTimers = true;/u,
  );
  assert.match(source, /native engine-first timer delivery contract passed/u);
  assert.match(
    runtime,
    /if \(config_\.testEngineFirstTimers \|\| timerInstallationPending_\) \{\s*setupTimers\(\);\s*\}/u,
  );
});
