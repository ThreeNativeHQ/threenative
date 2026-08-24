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

test("native timers have one real runtime owner and no engine-level stubs", () => {
  const v8 = read("src/js/v8_engine.cpp");
  const quickjs = read("src/js/quickjs_engine.cpp");
  const runtime = read("src/runtime.cpp");

  assert.doesNotThrow(() => assertTimerContract(v8, quickjs, runtime));
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
