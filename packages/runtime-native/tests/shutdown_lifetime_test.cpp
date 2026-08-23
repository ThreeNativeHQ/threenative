// Shutdown must not touch libuv handles that are still on the closing list.
//
// PRD-177 phases 2-3. The host exits with live HTTP sockets, interval timers, and file
// watches on every real quit. Closing their handles (async) and immediately freeing the
// owning contexts left libuv writing into freed memory during the EventLoop drain — an
// intermittent crash-at-exit that reads as unrelated corruption. Ownership belongs to the
// close callbacks: initiate closes, drain, then destroy.
//
// Modes (argv[1]):
//   http        - a keep-alive request is in flight when the runtime shuts down
//   timer-watch - an active setInterval and an active file watch are live at shutdown
//
// Each mode exits 0 when the full teardown drains cleanly.

#include "mystral/fs/file_watcher.h"
#include "mystral/http/async_http_client.h"
#include "mystral/runtime.h"

#include <chrono>
#include <cstring>
#include <iostream>
#include <netinet/in.h>
#include <string>
#include <sys/socket.h>
#include <thread>
#include <unistd.h>

using mystral::Runtime;
using mystral::RuntimeConfig;

namespace {

// A listener whose accepted connections never answer, so the curl transfer stays in
// flight with live poll handles until shutdown cancels it.
int startHangingListener() {
    int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = 0;
    if (::bind(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0 ||
        ::listen(fd, 4) != 0) {
        ::close(fd);
        return -1;
    }
    socklen_t len = sizeof(addr);
    if (::getsockname(fd, reinterpret_cast<sockaddr*>(&addr), &len) != 0) {
        ::close(fd);
        return -1;
    }
    std::thread([fd] {
        int client = ::accept(fd, nullptr, nullptr);
        if (client >= 0) {
            // Hold the connection open well past the test's lifetime.
            std::this_thread::sleep_for(std::chrono::seconds(30));
            ::close(client);
        }
        ::close(fd);
    }).detach();
    return ntohs(addr.sin_port);
}

std::unique_ptr<Runtime> createRuntime() {
    RuntimeConfig config;
    config.noSdl = true;
    config.width = 64;
    config.height = 64;
    auto runtime = Runtime::create(config);
    if (!runtime) {
        std::cerr << "FAILED: runtime creation\n";
        std::exit(1);
    }
    return runtime;
}

int runHttpMode() {
    const int port = startHangingListener();
    if (port <= 0) {
        std::cerr << "FAILED: could not start local hanging listener\n";
        return 1;
    }

    auto runtime = createRuntime();

    auto& client = mystral::http::AsyncHttpClient::instance();
    client.init();
    bool callbackRan = false;
    client.get("http://127.0.0.1:" + std::to_string(port) + "/slow",
        [&callbackRan](const mystral::http::HttpResponse&) { callbackRan = true; });

    // Pump enough frames for curl to connect and register its socket polls.
    for (int frame = 0; frame < 10 && !callbackRan; ++frame) {
        runtime->pollEvents();
    }
    // The transfer must still be pending here; a completed request means the socket was
    // never live at teardown and this run proves nothing.
    if (callbackRan) {
        std::cerr << "FAILED: request finished before shutdown; no live socket at teardown\n";
        return 1;
    }

    // Teardown mid-transfer: RuntimeImpl::shutdown cancels the request, closes the socket
    // polls, and drains the loop. Freeing contexts before that drain is the defect.
    runtime.reset();
    std::cout << "[shutdown-lifetime] exited cleanly with a live keep-alive socket" << std::endl;
    return 0;
}

int runTimerWatchMode(const std::string& watchPath) {
    auto runtime = createRuntime();

    if (!runtime->evalScript(
            "globalThis.__ticks = 0;\n"
            "setInterval(() => { __ticks += 1; }, 5);\n"
            "setTimeout(() => {}, 5);\n",
            "shutdown-lifetime-timers")) {
        std::cerr << "FAILED: timer setup eval\n";
        return 1;
    }

    auto& watcher = mystral::fs::FileWatcher::instance();
    watcher.init();
    const int watchId = watcher.watch(watchPath, [](const std::string&, mystral::fs::FileChangeType) {});
    if (watchId < 0) {
        std::cerr << "FAILED: file watch registration\n";
        return 1;
    }

    // Pump frames so the interval fires at least once and every handle is live.
    for (int frame = 0; frame < 10; ++frame) {
        runtime->pollEvents();
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }

    runtime.reset();
    std::cout << "[shutdown-lifetime] exited cleanly with an active interval and watch" << std::endl;
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc >= 2 && std::strcmp(argv[1], "http") == 0) {
        return runHttpMode();
    }
    if (argc >= 3 && std::strcmp(argv[1], "timer-watch") == 0) {
        return runTimerWatchMode(argv[2]);
    }
    std::cerr << "usage: threenative-shutdown-lifetime-test http | timer-watch <path>\n";
    return 2;
}
