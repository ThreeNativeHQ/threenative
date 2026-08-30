/**
 * WorkerThread Implementation
 *
 * Runs JavaScript code in a separate thread with its own JS engine.
 * Communicates with the main thread via thread-safe message queues.
 */

#include "mystral/workers/worker_thread.h"
#include "mystral/js/engine.h"
#include <iostream>
#include <chrono>

namespace mystral {
namespace workers {

// Global pointer used by worker's native functions to access the engine
// Thread-local to support multiple workers
thread_local js::Engine* g_workerEngine = nullptr;
thread_local WorkerThread* g_workerThread = nullptr;

WorkerThread::WorkerThread(int id, const std::string& code)
    : id_(id)
    , code_(code)
{
}

WorkerThread::~WorkerThread() {
    terminate();
    if (thread_ && thread_->joinable()) {
        thread_->join();
    }
}

WorkerThread::WaitStats WorkerThread::waitStats() const {
    WaitStats stats;
    stats.loopEvals = loopEvals_.load();
    stats.idleWaits = idleWaits_.load();
    stats.idleWakes = idleWakes_.load();
    return stats;
}

void WorkerThread::start() {
    if (running_.load()) {
        return;
    }

    running_ = true;
    thread_ = std::make_unique<std::thread>(&WorkerThread::threadMain, this);
}

void WorkerThread::postMessage(std::vector<uint8_t> data,
                               std::vector<std::shared_ptr<ArrayBufferData>> transfers) {
    if (terminated_.load()) {
        return;
    }

    WorkerMessage msg;
    msg.type = WorkerMessage::Type::MESSAGE;
    msg.payload = std::move(data);
    msg.transfers = std::move(transfers);

    {
        std::lock_guard<std::mutex> lock(inMutex_);
        inQueue_.push(std::move(msg));
    }
    inCondition_.notify_one();
    {
        std::lock_guard<std::mutex> lock(engineMutex_);
        if (engine_) engine_->wakeTaskWait();
    }
}

void WorkerThread::terminate() {
    if (terminated_.exchange(true)) {
        return;  // Already terminated
    }

    // Send termination message
    {
        std::lock_guard<std::mutex> lock(inMutex_);
        WorkerMessage msg;
        msg.type = WorkerMessage::Type::TERMINATE;
        inQueue_.push(std::move(msg));
    }
    inCondition_.notify_one();
    {
        std::lock_guard<std::mutex> lock(engineMutex_);
        if (engine_) engine_->wakeTaskWait();
    }

    // Wait for thread to finish
    if (thread_ && thread_->joinable()) {
        thread_->join();
    }

    running_ = false;
}

bool WorkerThread::hasMessages() const {
    std::lock_guard<std::mutex> lock(outMutex_);
    return !outQueue_.empty();
}

WorkerMessage WorkerThread::popMessage() {
    std::lock_guard<std::mutex> lock(outMutex_);
    if (outQueue_.empty()) {
        return WorkerMessage{};
    }
    WorkerMessage msg = std::move(outQueue_.front());
    outQueue_.pop();
    return msg;
}

void WorkerThread::setupWorkerGlobals(void* enginePtr) {
    auto* engine = static_cast<js::Engine*>(enginePtr);

    // __workerPostMessage(jsonString, transfers) - Send message to main thread
    engine->setGlobalProperty("__workerPostMessage",
        engine->newFunction("__workerPostMessage",
            [](void* ctx, const std::vector<js::JSValueHandle>& args) {
                // Never dereference the thread-locals to build the early return: this used to
                // read through a null engine on the very path that checked it for null.
                if (!g_workerEngine || !g_workerThread) {
                    return js::JSValueHandle{};
                }

                if (args.empty()) {
                    return g_workerEngine->newUndefined();
                }

                // Get JSON string payload
                std::string json = g_workerEngine->toString(args[0]);

                WorkerMessage msg;
                msg.type = WorkerMessage::Type::MESSAGE;
                msg.payload = std::vector<uint8_t>(json.begin(), json.end());

                // Handle transfers (ArrayBuffers)
                if (args.size() > 1 && g_workerEngine->isArray(args[1])) {
                    // TODO: Extract ArrayBuffers and mark as transferred
                }

                // Queue message for main thread
                {
                    std::lock_guard<std::mutex> lock(g_workerThread->outMutex_);
                    g_workerThread->outQueue_.push(std::move(msg));
                }

                return g_workerEngine->newUndefined();
            }
        )
    );

    // __workerPostError(message) - Surface a worker-side failure to the main thread as one
    // `error` event. Without this the worker's own console was the only witness: a top-level
    // throw was reported, but a throw inside the message handler was printed and swallowed, so
    // the caller received neither a result nor an error and waited forever.
    engine->setGlobalProperty("__workerPostError",
        engine->newFunction("__workerPostError",
            [](void* ctx, const std::vector<js::JSValueHandle>& args) {
                if (!g_workerEngine) return js::JSValueHandle{};
                if (!g_workerThread || args.empty()) {
                    return g_workerEngine->newUndefined();
                }

                const std::string message = g_workerEngine->toString(args[0]);

                WorkerMessage msg;
                msg.type = WorkerMessage::Type::ERROR;
                msg.payload = std::vector<uint8_t>(message.begin(), message.end());

                {
                    std::lock_guard<std::mutex> lock(g_workerThread->outMutex_);
                    g_workerThread->outQueue_.push(std::move(msg));
                }

                return g_workerEngine->newUndefined();
            }
        )
    );

    // __workerClose() - Self-terminate the worker
    engine->setGlobalProperty("__workerClose",
        engine->newFunction("__workerClose",
            [](void* ctx, const std::vector<js::JSValueHandle>& args) {
                if (!g_workerEngine) return js::JSValueHandle{};
                if (g_workerThread) {
                    g_workerThread->terminated_ = true;
                }
                return g_workerEngine->newUndefined();
            }
        )
    );

    // __workerHasMessage() - Check if there's a message in the queue
    engine->setGlobalProperty("__workerHasMessage",
        engine->newFunction("__workerHasMessage",
            [](void* ctx, const std::vector<js::JSValueHandle>& args) {
                if (!g_workerEngine) return js::JSValueHandle{};
                if (!g_workerThread) {
                    return g_workerEngine->newBoolean(false);
                }
                std::lock_guard<std::mutex> lock(g_workerThread->inMutex_);
                return g_workerEngine->newBoolean(!g_workerThread->inQueue_.empty());
            }
        )
    );

    // __workerGetMessage() - Get the next message from the queue (blocking or non-blocking)
    engine->setGlobalProperty("__workerGetMessage",
        engine->newFunction("__workerGetMessage",
            [](void* ctx, const std::vector<js::JSValueHandle>& args) {
                if (!g_workerEngine) return js::JSValueHandle{};
                if (!g_workerThread) {
                    return g_workerEngine->newNull();
                }

                bool blocking = true;
                if (!args.empty()) {
                    blocking = g_workerEngine->toBoolean(args[0]);
                }

                WorkerMessage msg;
                {
                    std::unique_lock<std::mutex> lock(g_workerThread->inMutex_);

                    if (blocking) {
                        // Wait for a message with timeout (100ms)
                        g_workerThread->inCondition_.wait_for(lock,
                            std::chrono::milliseconds(100),
                            [&]() {
                                return !g_workerThread->inQueue_.empty() ||
                                       g_workerThread->terminated_.load();
                            }
                        );
                    }

                    if (g_workerThread->inQueue_.empty()) {
                        return g_workerEngine->newNull();
                    }

                    msg = std::move(g_workerThread->inQueue_.front());
                    g_workerThread->inQueue_.pop();
                }

                // Create result object
                auto result = g_workerEngine->newObject();
                g_workerEngine->setProperty(result, "type",
                    g_workerEngine->newNumber(static_cast<int>(msg.type)));

                if (!msg.payload.empty()) {
                    std::string json(msg.payload.begin(), msg.payload.end());
                    g_workerEngine->setProperty(result, "data",
                        g_workerEngine->newString(json.c_str()));
                }

                // TODO: Handle transferred ArrayBuffers

                return result;
            }
        )
    );

    // Worker global scope setup (JavaScript)
    const char* workerGlobalCode = R"(
// Worker global scope - make self a global reference to globalThis
globalThis.self = globalThis;

// Private state (using closure via IIFE to hide internals)
(function() {
    let _onmessage = null;
    let _onerror = null;
    const _messageListeners = [];
    const _errorListeners = [];

    // onmessage property on globalThis (accessible as self.onmessage)
    Object.defineProperty(globalThis, 'onmessage', {
        get: () => _onmessage,
        set: (fn) => {
            _onmessage = fn;
        },
        configurable: true
    });

    // onerror property
    Object.defineProperty(globalThis, 'onerror', {
        get: () => _onerror,
        set: (fn) => { _onerror = fn; },
        configurable: true
    });

    globalThis.addEventListener = function(type, handler) {
        if (typeof handler !== 'function') return;
        if (type === 'message') _messageListeners.push(handler);
        else if (type === 'error') _errorListeners.push(handler);
    };

    globalThis.removeEventListener = function(type, handler) {
        const listeners = type === 'message' ? _messageListeners : _errorListeners;
        const index = listeners.indexOf(handler);
        if (index >= 0) listeners.splice(index, 1);
    };

    // The declared clone matrix, mirrored from
    // packages/runtime-native/src/runtime-scripts/url-worker-polyfill.js. The wire is JSON and
    // JSON is lossy where structured clone is not, so every row JSON would corrupt is refused by
    // name and by path rather than delivered wrong. tests/native-worker-production.test.mjs keeps
    // the two copies in step.
    const CLONE_MAX_DEPTH = 64;

    const namedError = (name, message) => {
        const error = new Error(message);
        error.name = name;
        return error;
    };

    const describeUncloneable = (value) => {
        const type = typeof value;
        if (type === 'number') return String(value);
        if (type !== 'object' || value === null) return type;
        const tag = Object.prototype.toString.call(value).slice(8, -1);
        if (tag !== 'Object') return tag;
        return value.constructor && value.constructor.name
            ? value.constructor.name + ' instance'
            : 'object';
    };

    const refuseClone = (what, path) =>
        namedError(
            'DataCloneError',
            'TN_NATIVE_WORKER_CLONE_UNSUPPORTED: ' + what + ' at ' + path +
                ' is not structured-cloneable over the native worker wire',
        );

    const prototypeDepth = (value) => {
        let depth = 0;
        let prototype = Object.getPrototypeOf(value);
        while (prototype !== null && depth < 8) {
            depth += 1;
            prototype = Object.getPrototypeOf(prototype);
        }
        return depth;
    };

    const encodeClone = (root) => {
        const onPath = new Set();
        const visited = new Set();
        const walk = (value, path, depth) => {
            if (depth > CLONE_MAX_DEPTH) {
                throw refuseClone('nesting deeper than ' + CLONE_MAX_DEPTH, path);
            }
            if (value === null) return value;
            const type = typeof value;
            if (type === 'undefined') return { __tnNativeWorkerUndefined: true };
            if (type === 'string' || type === 'boolean') return value;
            if (type === 'number') {
                if (Number.isFinite(value)) return value;
                throw refuseClone(describeUncloneable(value), path);
            }
            if (type !== 'object') throw refuseClone(describeUncloneable(value), path);

            if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
                const view = value instanceof ArrayBuffer
                    ? new Uint8Array(value)
                    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
                return {
                    __tnNativeWorkerBinary: value instanceof ArrayBuffer ? 'ArrayBuffer' : value.constructor.name,
                    bytes: Array.from(view),
                };
            }

            if (onPath.has(value)) throw refuseClone('a reference cycle', path);
            if (visited.has(value)) throw refuseClone('a second reference to one object', path);

            // Prototype depth, not prototype identity: identity is per-realm. A plain object
            // sits one link from null, Object.create(null) zero, a plain array two.
            const isPlainArray = Array.isArray(value) && prototypeDepth(value) === 2;
            const isPlainObject = !Array.isArray(value) && prototypeDepth(value) <= 1;
            if (!isPlainArray && !isPlainObject) throw refuseClone(describeUncloneable(value), path);
            if (Object.getOwnPropertySymbols(value).length !== 0) {
                throw refuseClone('a symbol-keyed property', path);
            }

            onPath.add(value);
            visited.add(value);
            const clone = isPlainArray ? [] : {};
            if (isPlainArray) {
                for (let index = 0; index < value.length; index += 1) {
                    clone[index] = walk(value[index], path + '[' + index + ']', depth + 1);
                }
            } else {
                for (const key of Object.keys(value)) {
                    clone[key] = walk(value[key], path + '.' + key, depth + 1);
                }
            }
            onPath.delete(value);
            return clone;
        };
        return root === undefined ? undefined : walk(root, 'message', 0);
    };

    const decodeClone = (value) => {
        if (value === null || typeof value !== 'object') return value;
        if (value.__tnNativeWorkerUndefined === true && Object.keys(value).length === 1) {
            return undefined;
        }
        if (typeof value.__tnNativeWorkerBinary === 'string' && Array.isArray(value.bytes)) {
            const bytes = Uint8Array.from(value.bytes);
            if (value.__tnNativeWorkerBinary === 'ArrayBuffer') return bytes.buffer;
            const Constructor = globalThis[value.__tnNativeWorkerBinary];
            if (typeof Constructor !== 'function') {
                throw new Error('TN_NATIVE_WORKER_CLONE_FAILED: unknown binary view ' + value.__tnNativeWorkerBinary);
            }
            return value.__tnNativeWorkerBinary === 'DataView'
                ? new DataView(bytes.buffer)
                : new Constructor(bytes.buffer);
        }
        if (Array.isArray(value)) return value.map(decodeClone);
        for (const key of Object.keys(value)) value[key] = decodeClone(value[key]);
        return value;
    };

    // postMessage function
    globalThis.postMessage = function(data, transfer) {
        transfer = transfer || [];
        if (!Array.isArray(transfer) || transfer.some((value) => !(value instanceof ArrayBuffer))) {
            throw refuseClone('a non-ArrayBuffer transferable', 'transfer');
        }
        const encoded = encodeClone(data);
        const json = encoded === undefined ? '' : JSON.stringify(encoded);
        __workerPostMessage(json, transfer);
    };

    // close function
    globalThis.close = function() {
        __workerClose();
    };

    // Internal: Process incoming messages
    globalThis.__processMessages = function() {
        while (true) {
            const msg = __workerGetMessage(false);  // Non-blocking
            if (!msg) break;

            if (msg.type === 2) {  // TERMINATE
                globalThis.close();
                return false;
            }

            if (msg.type === 0 && (_onmessage || _messageListeners.length > 0)) {  // MESSAGE
                try {
                    const data = msg.data ? decodeClone(JSON.parse(msg.data)) : undefined;
                    const event = { data: data, target: globalThis };
                    if (_onmessage) _onmessage(event);
                    for (const listener of [..._messageListeners]) listener(event);
                } catch (e) {
                    // One error event, and it must leave this isolate. Printing it here and
                    // calling the worker's own onerror left the caller on the main thread with
                    // neither a result nor an error, waiting on a promise nothing would settle.
                    const message = (e && (e.stack || e.message)) ? String(e.stack || e.message) : String(e);
                    console.error('[Worker] Error processing message:', message);
                    if (_onerror) {
                        _onerror({ error: e, message: e && e.message });
                    }
                    for (const listener of [..._errorListeners]) {
                        listener({ error: e, message: e && e.message });
                    }
                    __workerPostError(message);
                }
            }
        }
        return true;
    };
})();
)";

    // Classic script, not a module: a worker's global scope is script scope, and a module's
    // Evaluate() hands back a promise instead of failing, which is how a throw goes missing.
    engine->evalScript(workerGlobalCode, "worker-global.js");
}

void WorkerThread::threadMain() {
    std::cout << "[Worker " << id_ << "] Thread started" << std::endl;

    // Create a new JS engine for this worker
    auto engine = js::createEngine();
    if (!engine) {
        std::cerr << "[Worker " << id_ << "] Failed to create JS engine" << std::endl;
        running_ = false;

        // Send error to main thread
        WorkerMessage errMsg;
        errMsg.type = WorkerMessage::Type::ERROR;
        std::string error = "Failed to create JS engine";
        errMsg.payload = std::vector<uint8_t>(error.begin(), error.end());
        {
            std::lock_guard<std::mutex> lock(outMutex_);
            outQueue_.push(std::move(errMsg));
        }
        return;
    }

    // Set thread-local globals
    g_workerEngine = engine.get();
    g_workerThread = this;
    {
        std::lock_guard<std::mutex> lock(engineMutex_);
        engine_ = engine.get();
    }

    // Add worker log function FIRST (before anything uses console)
    engine->setGlobalProperty("__workerLog",
        engine->newFunction("__workerLog",
            [](void* ctx, const std::vector<js::JSValueHandle>& args) {
                if (args.size() < 2) return g_workerEngine->newUndefined();

                std::string level = g_workerEngine->toString(args[0]);
                std::string msg = g_workerEngine->toString(args[1]);

                int workerId = g_workerThread ? g_workerThread->getId() : -1;
                std::cout << "[Worker " << workerId << "] [" << level << "] " << msg << std::endl;

                return g_workerEngine->newUndefined();
            }
        )
    );

    // Force console override for workers (always replace, even if exists)
    const char* consoleCode = R"(
globalThis.console = {
    log: (...args) => __workerLog('log', args.join(' ')),
    warn: (...args) => __workerLog('warn', args.join(' ')),
    error: (...args) => __workerLog('error', args.join(' ')),
    info: (...args) => __workerLog('info', args.join(' ')),
};
)";

    engine->evalScript(consoleCode, "worker-console.js");

    // Setup worker globals (after console is available)
    setupWorkerGlobals(engine.get());

    // Execute the worker code
    std::cout << "[Worker " << id_ << "] Executing user code..." << std::endl;
    // A classic Blob worker is the only admitted source form, so it is evaluated as a classic
    // script. It used to be compiled as an ES module, and a module that throws at top level
    // resolves to a *rejected promise* rather than failing to evaluate: eval() returned true, the
    // host logged "User code executed successfully", and the game was never told its worker was
    // dead on arrival. Script::Run() reports the throw, so the ERROR below is actually queued.
    if (!engine->evalScript(code_.c_str(), "worker.js")) {
        std::string error = engine->getException();
        std::cerr << "[Worker " << id_ << "] Error executing code: " << error << std::endl;

        WorkerMessage errMsg;
        errMsg.type = WorkerMessage::Type::ERROR;
        errMsg.payload = std::vector<uint8_t>(error.begin(), error.end());
        {
            std::lock_guard<std::mutex> lock(outMutex_);
            outQueue_.push(std::move(errMsg));
        }
    } else {
        std::cout << "[Worker " << id_ << "] User code executed successfully" << std::endl;
    }

    // A pending exception that survived a "successful" evaluation is still a failed worker, and
    // printing it to this process's stderr is not telling the game.
    if (engine->hasException()) {
        std::string error = engine->getException();
        std::cerr << "[Worker " << id_ << "] Exception after code execution: " << error << std::endl;

        WorkerMessage errMsg;
        errMsg.type = WorkerMessage::Type::ERROR;
        errMsg.payload = std::vector<uint8_t>(error.begin(), error.end());
        {
            std::lock_guard<std::mutex> lock(outMutex_);
            outQueue_.push(std::move(errMsg));
        }
    }

    std::cout << "[Worker " << id_ << "] Entering main loop..." << std::endl;

    // Main worker loop
    while (!terminated_.load()) {
        loopEvals_.fetch_add(1, std::memory_order_relaxed);

        // Process messages via JS
        auto processResult = engine->evalScriptWithResult("__processMessages()", "worker-loop.js");
        if (engine->hasException()) {
            std::string error = engine->getException();
            std::cerr << "[Worker " << id_ << "] Exception in message loop: " << error << std::endl;
        }
        if (!engine->toBoolean(processResult)) {
            std::cout << "[Worker " << id_ << "] __processMessages returned false, exiting" << std::endl;
            break;  // Worker requested close
        }

        engine->processMicrotasks();

        idleWaits_.fetch_add(1, std::memory_order_relaxed);
        if (engine->supportsBlockingTaskWait()) {
            // V8 asynchronous work, including WebAssembly compilation, posts to its foreground
            // task queue. postMessage() and terminate() post a no-op task so external input
            // cannot strand the worker in this blocking, zero-poll wait.
            engine->waitForTask();
            idleWakes_.fetch_add(1, std::memory_order_relaxed);
        } else {
            // Engines without a foreground task queue block on worker input. The queue check and
            // wait share the notifier's mutex, so a wake cannot be missed.
            std::unique_lock<std::mutex> lock(inMutex_);
            inCondition_.wait(lock, [this] {
                return terminated_.load() || !inQueue_.empty();
            });
            idleWakes_.fetch_add(1, std::memory_order_relaxed);
        }
    }

    // Cleanup
    {
        std::lock_guard<std::mutex> lock(engineMutex_);
        engine_ = nullptr;
    }
    g_workerEngine = nullptr;
    g_workerThread = nullptr;
    running_ = false;

    std::cout << "[Worker " << id_ << "] Thread finished" << std::endl;
}

}  // namespace workers
}  // namespace mystral
