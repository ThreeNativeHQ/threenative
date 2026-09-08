#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#endif

#include "mystral/async/event_loop.h"
#include "mystral/http/http_client.h"
#include "mystral/http/async_http_client.h"
#include "mystral/fs/async_file.h"
#include "mystral/fs/file_watcher.h"
#include "mystral/js/engine.h"
#include "mystral/webtransport/webtransport.h"
#include "../src/raytracing/bindings.h"
#include "../src/raytracing/rt_common.h"
#include "../src/cli/bundler.h"
#include "../src/cli/lightmap.h"
#include "../src/cli/tool_dispatch.h"

#define MYSTRAL_CLI_NO_MAIN 1
#include "../src/cli/main.cpp"
#undef MYSTRAL_CLI_NO_MAIN

#ifndef _WIN32
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#endif
#include <chrono>
#include <cstring>
#include <atomic>
#include <thread>
#include <iostream>
#include <vector>
#include <filesystem>
#include <fstream>

namespace fs = std::filesystem;

namespace {

#ifdef _WIN32
using SocketHandle = SOCKET;
using SocketLength = int;
constexpr SocketHandle kInvalidSocket = INVALID_SOCKET;

void closeSocket(SocketHandle socketHandle) {
    closesocket(socketHandle);
}
#else
using SocketHandle = int;
using SocketLength = socklen_t;
constexpr SocketHandle kInvalidSocket = -1;

void closeSocket(SocketHandle socketHandle) {
    close(socketHandle);
}
#endif

class MockHttpServer {
public:
    MockHttpServer() {
#ifdef _WIN32
        WSADATA winsockData{};
        if (WSAStartup(MAKEWORD(2, 2), &winsockData) != 0) return;
        winsockReady_ = true;
#endif
        serverFd_ = socket(AF_INET, SOCK_STREAM, 0);
        if (serverFd_ == kInvalidSocket) return;
        int opt = 1;
#ifdef _WIN32
        setsockopt(serverFd_, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&opt), sizeof(opt));
#else
        setsockopt(serverFd_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
#endif
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        addr.sin_port = 0;
        if (bind(serverFd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) return;
        if (listen(serverFd_, 10) < 0) return;
        SocketLength len = sizeof(addr);
        getsockname(serverFd_, reinterpret_cast<sockaddr*>(&addr), &len);
        port_ = ntohs(addr.sin_port);

        running_ = true;
        worker_ = std::thread([this]() {
            while (running_) {
                fd_set fds;
                FD_ZERO(&fds);
                FD_SET(serverFd_, &fds);
                timeval tv{ 0, 50000 };
#ifdef _WIN32
                int r = select(0, &fds, nullptr, nullptr, &tv);
#else
                int r = select(serverFd_ + 1, &fds, nullptr, nullptr, &tv);
#endif
                if (r > 0 && FD_ISSET(serverFd_, &fds)) {
                    SocketHandle clientFd = accept(serverFd_, nullptr, nullptr);
                    if (clientFd != kInvalidSocket) {
                        char buf[1024];
                        recv(clientFd, buf, static_cast<int>(sizeof(buf)), 0);
                        const char* resp = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nX-Custom-Hdr: test-val\r\nContent-Length: 5\r\n\r\nhello";
                        send(clientFd, resp, static_cast<int>(std::strlen(resp)), 0);
                        closeSocket(clientFd);
                    }
                }
            }
        });
    }

    ~MockHttpServer() {
        running_ = false;
        if (worker_.joinable()) worker_.join();
        if (serverFd_ != kInvalidSocket) closeSocket(serverFd_);
#ifdef _WIN32
        if (winsockReady_) WSACleanup();
#endif
    }

    int port() const { return port_; }
    bool valid() const { return port_ > 0; }

private:
    SocketHandle serverFd_ = kInvalidSocket;
    int port_ = 0;
    std::atomic<bool> running_{ false };
    std::thread worker_;
#ifdef _WIN32
    bool winsockReady_ = false;
#endif
};

void exerciseCliHelpers() {
    const char* keys[] = {
        "KeyA", "KeyB", "KeyC", "KeyD", "KeyE", "KeyF", "KeyG", "KeyH", "KeyI", "KeyJ",
        "KeyK", "KeyL", "KeyM", "KeyN", "KeyO", "KeyP", "KeyQ", "KeyR", "KeyS", "KeyT",
        "KeyU", "KeyV", "KeyW", "KeyX", "KeyY", "KeyZ",
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
        "Digit0", "Digit1", "Digit9",
        "Enter", "Return", "Escape", "Esc", "Space", "Backspace", "Tab",
        "ArrowUp", "Up", "ArrowDown", "Down", "ArrowLeft", "Left", "ArrowRight", "Right",
        "Home", "End", "PageUp", "PageDown", "Insert", "Delete",
        "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
        "Shift", "ShiftLeft", "ShiftRight", "Control", "ControlLeft", "ControlRight",
        "Alt", "AltLeft", "AltRight", "Meta", "MetaLeft", "MetaRight",
        "CapsLock", "NumLock", "ScrollLock", "PrintScreen", "Pause",
        "Minus", "-", "Equal", "=", "Plus", "BracketLeft", "[", "BracketRight", "]",
        "Backslash", "\\", "Semicolon", ";", "Quote", "'", "Backquote", "`",
        "Comma", ",", "Period", ".", "Slash", "/", "UnknownKey"
    };
    for (const char* key : keys) keyNameToScancode(key);

    const std::string testJson = R"JSON({
        "title": "My \u0041pp \uD83D\uDE00",
        "escapes": "\"\\/\b\f\n\r\t",
        "width": 1920,
        "height": 1080.5,
        "negative": -42,
        "fullscreen": true,
        "maximized": false,
        "invalidNum": "abc"
    })JSON";
    extractJsonString(testJson, "title");
    extractJsonString(testJson, "escapes");
    extractJsonString(testJson, "missing");
    extractJsonString("{\"bad\": \"unterminated", "bad");
    extractJsonString("{\"bad\": unquoted}", "bad");
    extractJsonString("{\"bad\": \"\\u00\"}", "bad");
    extractJsonString("{\"bad\": \"\\uD800\\u0000\"}", "bad");
    extractJsonString("{\"bad\": \"\\x\"}", "bad");
    extractJsonNumber(testJson, "width", 0);
    extractJsonNumber(testJson, "height", 0);
    extractJsonNumber(testJson, "negative", 0);
    extractJsonNumber(testJson, "invalidNum", 123);
    extractJsonNumber(testJson, "missing", 456);
    extractJsonBool(testJson, "fullscreen", false);
    extractJsonBool(testJson, "maximized", true);
    extractJsonBool(testJson, "missing", false);

    const char* allFlags[] = {
        "mystral", "run", "dummy.js",
        "--width", "1024", "--height", "768", "--title", "Custom Title",
        "--windowed", "--maximized", "--fullscreen", "--include", "assets",
        "--assets", "more_assets", "--output", "out_bin", "--out", "out_bin2",
        "-o", "out_bin3", "--root", ".", "--ui", "ui", "--entry", "main.js",
        "--screenshot", "out.png", "--frames", "30", "--no-vsync", "--quiet", "-q",
        "--headless", "--no-sdl", "--watch", "-w", "--bundle-only", "--video", "test.mp4",
        "--start-frame", "0", "--end-frame", "10", "--video-fps", "30",
        "--video-quality", "90", "--mp4", "--native-capture", "--gpu-capture",
        "--debug-port", "9222", "--debug", "--resolution", "1024", "--samples", "32",
        "--bounces", "2", "--unknown-flag"
    };
    parseArgs(sizeof(allFlags) / sizeof(allFlags[0]), const_cast<char**>(allFlags));
}

bool testCliSubsystem(const fs::path& tempDir) {
    // Test runCli
    char* helpArgv[] = { (char*)"mystral", (char*)"--help" };
    if (mystral::cli::runCli(2, helpArgv) != 0) return false;

    char* verArgv[] = { (char*)"mystral", (char*)"--version" };
    if (mystral::cli::runCli(2, verArgv) != 0) return false;

    char* emptyArgv[] = { (char*)"mystral" };
    if (mystral::cli::runCli(1, emptyArgv) == 0) return false;

    char* unkArgv[] = { (char*)"mystral", (char*)"bogus_cmd" };
    if (mystral::cli::runCli(2, unkArgv) == 0) return false;

    char* runNoScript[] = { (char*)"mystral", (char*)"run" };
    if (mystral::cli::runCli(2, runNoScript) == 0) return false;

    char* compileHelp[] = { (char*)"mystral", (char*)"compile", (char*)"--help" };
    if (mystral::cli::runCli(3, compileHelp) != 0) return false;

    char* bakeHelp[] = { (char*)"mystral", (char*)"bake", (char*)"--help" };
    if (mystral::cli::runCli(3, bakeHelp) != 0) return false;

    // Test runToolsCli
    char* toolUsageArgv[] = { (char*)"mystral-tools" };
    if (mystral::cli::runToolsCli(1, toolUsageArgv) == 0) return false;

    char* toolHelpArgv[] = { (char*)"mystral-tools", (char*)"--help" };
    if (mystral::cli::runToolsCli(2, toolHelpArgv) != 0) return false;

    char* toolCompNoFile[] = { (char*)"mystral-tools", (char*)"compile" };
    if (mystral::cli::runToolsCli(2, toolCompNoFile) == 0) return false;

    char* toolBakeNoFile[] = { (char*)"mystral-tools", (char*)"bake" };
    if (mystral::cli::runToolsCli(2, toolBakeNoFile) == 0) return false;

    fs::path dummyJs = tempDir / "dummy.js";
    std::string dummyJsStr = dummyJs.string();
    {
        std::ofstream out(dummyJs);
        out << "console.log('dummy bundle input');";
    }
    fs::path assetsDir = tempDir / "assets";
    fs::create_directories(assetsDir);
    {
        std::ofstream assetFile(assetsDir / "test.txt");
        assetFile << "asset content";
    }

    // Test BundlerOptions & compileBundle
    mystral::cli::BundlerOptions bundleOpts;
    bundleOpts.scriptPath = dummyJsStr;
    bundleOpts.rootDir = tempDir.string();
    bundleOpts.assetDirs.push_back(assetsDir.string());
    bundleOpts.outputPath = (tempDir / "out.bundle").string();
    bundleOpts.bundleOnly = true;
    bundleOpts.quiet = true;
    mystral::cli::compileBundle(bundleOpts);

    bundleOpts.bundleOnly = false;
    bundleOpts.outputPath = (tempDir / "out_app").string();
    mystral::cli::compileBundle(bundleOpts);

    // Test LightmapOptions & bakeLightmaps
    mystral::cli::LightmapOptions bakeOpts;
    bakeOpts.scriptPath = dummyJsStr;
    bakeOpts.outputPath = (tempDir / "lightmaps").string();
    bakeOpts.bakeResolution = 512;
    bakeOpts.bakeSamples = 16;
    bakeOpts.bakeBounces = 1;
    bakeOpts.quiet = true;
    mystral::cli::bakeLightmaps(bakeOpts);

    std::string tempDirStr = tempDir.string();
    std::string lmDirStr = (tempDir / "lm").string();

    char* toolCompArgv[] = {
        (char*)"mystral-tools",
        (char*)"compile",
        (char*)dummyJsStr.c_str(),
        (char*)"--output", (char*)tempDirStr.c_str(),
        (char*)"--root", (char*)tempDirStr.c_str(),
        (char*)"--bundle-only",
        (char*)"--quiet"
    };
    mystral::cli::runToolsCli(8, toolCompArgv);

    char* toolBakeArgv[] = {
        (char*)"mystral-tools",
        (char*)"bake",
        (char*)dummyJsStr.c_str(),
        (char*)"--output", (char*)lmDirStr.c_str(),
        (char*)"--resolution", (char*)"512",
        (char*)"--samples", (char*)"16",
        (char*)"--bounces", (char*)"1",
        (char*)"--debug",
        (char*)"--quiet"
    };
    mystral::cli::runToolsCli(12, toolBakeArgv);

    char* dispatchArgv[] = { (char*)"mystral", (char*)"compile", (char*)"dummy.js", nullptr };
#ifdef _WIN32
    _putenv_s("THREENATIVE_CLI_TOOLS", "/nonexistent/tool/mystral-tools");
#else
    setenv("THREENATIVE_CLI_TOOLS", "/nonexistent/tool/mystral-tools", 1);
#endif
    mystral::cli::dispatchBuildTool(3, dispatchArgv);
#ifdef _WIN32
    _putenv_s("THREENATIVE_CLI_TOOLS", "");
#else
    unsetenv("THREENATIVE_CLI_TOOLS");
#endif

    // Test all CLI parsing and helper branches in the production translation unit.
    exerciseCliHelpers();

    return true;
}

bool testHttpSubsystem() {
    auto& loop = mystral::async::EventLoop::instance();
    loop.init();
    loop.init();
    loop.isAvailable();
    loop.handle();
    loop.hasPendingWork();

    MockHttpServer server;
    if (!server.valid()) {
        std::cerr << "could not start the loopback HTTP fixture\n";
        loop.shutdown();
        return false;
    }
    std::string serverUrl = "http://127.0.0.1:" + std::to_string(server.port()) + "/test";

    // Synchronous HttpClient
    mystral::http::HttpClient client;
    mystral::http::HttpOptions opts;
    opts.timeout = 1;
    opts.headers["X-Test"] = "HeaderVal";
    const auto response = client.get(serverUrl, opts);
    if (!response.ok || response.status != 200 ||
        std::string(response.data.begin(), response.data.end()) != "hello") {
        std::cerr << "loopback HTTP response did not match the fixture\n";
        loop.shutdown();
        return false;
    }
    client.post(serverUrl, { 1, 2, 3 }, opts);
    client.request("PUT", serverUrl, { 4, 5 }, opts);
    client.request("DELETE", serverUrl, {}, opts);
    client.request("HEAD", serverUrl, {}, opts);

    // Error cases
    if (client.get("http://127.0.0.1:0/nonexistent", opts).ok) {
        std::cerr << "unreachable HTTP endpoint reported success\n";
        loop.shutdown();
        return false;
    }
    mystral::http::getHttpClient().get(serverUrl, opts);

    // Asynchronous HttpClient
    auto& asyncClient = mystral::http::AsyncHttpClient::instance();
    asyncClient.init();
    if (asyncClient.isReady()) {
        asyncClient.get(serverUrl, [](mystral::http::HttpResponse) {}, opts);
        asyncClient.post(serverUrl, { 1, 2 }, [](mystral::http::HttpResponse) {}, opts);
        asyncClient.request("PUT", serverUrl, { 3 }, [](mystral::http::HttpResponse) {}, opts);
        asyncClient.request("DELETE", serverUrl, {}, [](mystral::http::HttpResponse) {}, opts);
        asyncClient.activeRequestCount();
        for (int i = 0; i < 10; ++i) {
            loop.runOnce();
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }
        asyncClient.processCompletedRequests();
    }
    asyncClient.shutdown();
    mystral::http::getAsyncHttpClient();
    loop.shutdown();

    return true;
}

bool testFsSubsystem(const fs::path& tempDir) {
    fs::path testFile = tempDir / "async_test.txt";
    {
        std::ofstream out(testFile);
        out << "async content";
    }

    // Test sync fallback when not initialized
    mystral::fs::readFileAsync(testFile.string(), [](std::vector<uint8_t>, std::string) {});
    mystral::fs::readFileAsync("nonexistent_sync.txt", [](std::vector<uint8_t>, std::string) {});

    auto& loop = mystral::async::EventLoop::instance();
    loop.init();

    // AsyncFileReader with loop initialized
    auto& reader = mystral::fs::AsyncFileReader::instance();
    reader.init();
    if (reader.isReady()) {
        reader.readFile(testFile.string(), [](std::vector<uint8_t>, std::string) {});
        reader.readFile("nonexistent_path_xyz.txt", [](std::vector<uint8_t>, std::string) {});
        for (int i = 0; i < 5; ++i) {
            loop.runOnce();
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        reader.processCompletedReads();
    }
    reader.shutdown();
    mystral::fs::getAsyncFileReader();

    // FileWatcher
    auto& watcher = mystral::fs::FileWatcher::instance();
    watcher.init();
    if (watcher.isReady()) {
        bool changeObserved = false;
        int watchId = watcher.watch(tempDir.string(), [&](const std::string&, mystral::fs::FileChangeType) {
            changeObserved = true;
        });
        // Trigger a file change
        {
            std::ofstream out(testFile, std::ios::app);
            out << " more";
        }
        for (int i = 0; i < 5; ++i) {
            loop.runOnce();
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        watcher.processPendingEvents();
        if (watchId >= 0) {
            watcher.unwatch(watchId);
        }
    }
    watcher.shutdown();
    mystral::fs::getFileWatcher();
    loop.shutdown();

    return true;
}

bool testRaytracingAndWebTransport() {
    auto engine = mystral::js::createEngine();
    if (!engine) return false;

#ifndef _WIN32
    setenv("MYSTRAL_TEST_MOCK_RT", "1", 1);
#else
    _putenv_s("MYSTRAL_TEST_MOCK_RT", "1");
#endif

    auto backend = mystral::rt::createRTBackend();
    if (backend->getBackendType() == mystral::rt::RTBackendType::None && backend->isSupported()) {
        std::cerr << "unavailable ray tracing became supported through an environment variable\n";
        return false;
    }

    // Raytracing bindings
    mystral::rt::initializeRTBindings(engine.get());
    const char* rtScript = R"JS((() => {
      if (typeof mystralRT !== 'undefined') {
        if (mystralRT.isSupported()) throw new Error('native ray tracing has no readable result');
        mystralRT.getBackend();
        const vtx = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
        const idx = new Uint32Array([0, 1, 2]);
        const geom = mystralRT.createGeometry({
          vertices: vtx,
          indices: idx,
          vertexStride: 12,
        });
        const blas = mystralRT.createBLAS([geom]);
        const xform = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
        const tlas = mystralRT.createTLAS([{
          blas: blas,
          transform: xform,
          instanceId: 1,
          mask: 0xFF
        }]);
        mystralRT.updateTLAS(tlas, [{
          blas: blas,
          transform: xform,
          instanceId: 1,
          mask: 0xFF
        }]);
        let traceRejected = false;
        try {
          mystralRT.traceRays({
            tlas: tlas,
            width: 64,
            height: 64
          });
        } catch (e) {
          traceRejected = String(e).includes('TN_NATIVE_RAYTRACING_UNAVAILABLE');
        }
        if (!traceRejected) throw new Error('traceRays must reject without copy-out interop');
        mystralRT.destroyGeometry(geom);
        mystralRT.destroyBLAS(blas);
        mystralRT.destroyTLAS(tlas);

        try { mystralRT.createGeometry({}); } catch (e) {}
        try { mystralRT.createBLAS([]); } catch (e) {}
        try { mystralRT.createTLAS([]); } catch (e) {}
        try { mystralRT.updateTLAS(null, []); } catch (e) {}
        try { mystralRT.destroyGeometry(null); } catch (e) {}
        try { mystralRT.destroyBLAS(null); } catch (e) {}
        try { mystralRT.destroyTLAS(null); } catch (e) {}
      } else {
        throw new Error('ray tracing bindings are missing');
      }
    })())JS";
    const bool rtPassed = engine->evalScript(rtScript, "rt_test.js");
    mystral::rt::cleanupRTBindings();
#ifndef _WIN32
    unsetenv("MYSTRAL_TEST_MOCK_RT");
#else
    _putenv_s("MYSTRAL_TEST_MOCK_RT", "");
#endif

    // WebTransport bindings
    mystral::webtransport::init();
    mystral::webtransport::initBindings(engine.get());
    const char* wtScript = R"JS((() => {
      // Error and boundary cases
      __wtConnect("");
      __wtConnect("http://not-https:4433");
      __wtConnect("https://bad:0");
      __wtSendDatagram(9999, new Uint8Array([1]));
      __wtCreateStream(9999, true);
      __wtCreateStream(9999, false);
      __wtStreamWrite(9999, 0, new Uint8Array([1]), false);
      __wtStreamShutdown(9999, 0, 0);
      __wtClose(9999, 0, "test");

      const id = __wtConnect("https://127.0.0.1:4433/test");
      if (typeof id === 'number' && id > 0) {
        __wtSendDatagram(id, new Uint8Array([1, 2, 3]));
        __wtCreateStream(id, true);
        __wtCreateStream(id, false);
        __wtStreamWrite(id, 0, new Uint8Array([4, 5]), false);
        __wtStreamShutdown(id, 0, 0);
        __wtClose(id, 0, "test-close");
      }
    })())JS";
    const bool wtPassed = engine->evalScript(wtScript, "wt_test.js");
    mystral::webtransport::processEvents();
    mystral::webtransport::hasActiveSessions();
    mystral::webtransport::shutdown();

    return rtPassed && wtPassed;
}

}  // namespace

int main() {
    fs::path tempDir = fs::temp_directory_path() / "tn_cli_net_fs_test";
    fs::remove_all(tempDir);
    fs::create_directories(tempDir);

    bool ok = true;
    if (!testCliSubsystem(tempDir)) {
        std::cerr << "testCliSubsystem failed\n";
        ok = false;
    }
    if (!testHttpSubsystem()) {
        std::cerr << "testHttpSubsystem failed\n";
        ok = false;
    }
    if (!testFsSubsystem(tempDir)) {
        std::cerr << "testFsSubsystem failed\n";
        ok = false;
    }
    if (!testRaytracingAndWebTransport()) {
        std::cerr << "testRaytracingAndWebTransport failed\n";
        ok = false;
    }

    fs::remove_all(tempDir);
    if (!ok) return 1;

    std::cout << "native CLI network and FS comprehensive contract passed\n";
    return 0;
}
