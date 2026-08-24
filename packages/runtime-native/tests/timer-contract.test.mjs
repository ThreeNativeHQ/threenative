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
  assert.match(
    read("CMakeLists.txt"),
    /add_executable\(threenative-timer-delivery-test EXCLUDE_FROM_ALL\s*tests\/timer_delivery_test\.cpp\)/u,
  );
  assert.match(read("tests/timer_delivery_test.cpp"), /native timer delivery contract passed/u);
});
