// The native timer host must deliver timeout and interval callbacks through Runtime::pollEvents.
// This executable intentionally schedules work before the first poll and then polls repeatedly,
// proving that a pending timeout survives the bootstrap boundary and fires exactly once.

#include "mystral/runtime.h"

#include <chrono>
#include <iostream>
#include <thread>

namespace {

constexpr int kCompletionExitCode = 42;

constexpr const char* kScript = R"JS((() => {
  let timeoutCount = 0;
  let intervalCount = 0;
  let intervalId = 0;

  setTimeout(() => { timeoutCount += 1; }, 0);
  intervalId = setInterval(() => {
    intervalCount += 1;
    if (intervalCount === 3) {
      clearInterval(intervalId);
      setTimeout(() => {
        process.exit(timeoutCount === 1 && intervalCount === 3 ? 42 : 1);
      }, 0);
    }
  }, 1);
})())JS";

}  // namespace

int main() {
    mystral::RuntimeConfig config;
    config.width = 1;
    config.height = 1;
    config.noSdl = true;

    auto runtime = mystral::Runtime::create(config);
    if (!runtime) {
        std::cerr << "could not create headless native runtime\n";
        return 1;
    }

    if (!runtime->evalScript(kScript, "timer_delivery_test.js")) {
        std::cerr << "could not schedule native timer contract\n";
        return 1;
    }

    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    bool timedOut = false;
    while (runtime->pollEvents()) {
        if (runtime->getExitCode() == kCompletionExitCode) {
            break;
        }
        if (std::chrono::steady_clock::now() >= deadline) {
            timedOut = true;
            break;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }

    const int exitCode = runtime->getExitCode();
    if (exitCode != kCompletionExitCode) {
        if (timedOut || exitCode == 0) {
            std::cerr << "native timer delivery contract timed out before completion\n";
        } else {
            std::cerr << "native timer delivery contract failed with exit " << exitCode << '\n';
        }
        return 1;
    }

    std::cout << "native timer delivery contract passed\n";
    return 0;
}
