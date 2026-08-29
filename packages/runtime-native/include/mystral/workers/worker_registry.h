#pragma once

/**
 * WorkerRegistry - Singleton managing all web workers
 *
 * Provides the interface between the main thread's JS engine
 * and worker threads. Handles message routing and worker lifecycle.
 *
 * Usage:
 *   // Create a worker
 *   int id = WorkerRegistry::instance().createWorker(code);
 *
 *   // Send messages
 *   WorkerRegistry::instance().postToWorker(id, msg);
 *
 *   // Process messages from workers (call each frame)
 *   WorkerRegistry::instance().processWorkerMessages(mainEngine);
 *
 *   // Cleanup
 *   WorkerRegistry::instance().terminateWorker(id);
 */

#include "mystral/workers/worker_thread.h"
#include "mystral/js/engine.h"
#include <unordered_map>
#include <functional>

namespace mystral {
namespace workers {

/**
 * Callback type for delivering messages to JS Worker objects
 */
using JSWorkerCallback = std::function<void(int workerId, const WorkerMessage& msg)>;

/**
 * WorkerRegistry - Manages all worker threads
 */
class WorkerRegistry {
public:
    /**
     * Get the singleton instance
     */
    static WorkerRegistry& instance();

    /**
     * Create a new worker
     * @param code JavaScript code to execute
     * @return Worker ID (positive) or -1 on error
     */
    int createWorker(const std::string& code);

    /**
     * Post a message to a worker
     * @param id Worker ID
     * @param msg Message to send
     */
    void postToWorker(int id, WorkerMessage msg);

    /**
     * Terminate a worker
     * @param id Worker ID
     */
    void terminateWorker(int id);

    /**
     * Register a callback for receiving messages from a worker
     * @param id Worker ID
     * @param callback Function to call when worker sends a message
     */
    void registerCallback(int id, JSWorkerCallback callback);

    /**
     * Unregister callback for a worker
     * @param id Worker ID
     */
    void unregisterCallback(int id);

    /**
     * Process messages from all workers
     * Should be called once per frame from the main loop
     * @param mainEngine Main thread's JS engine (for callback invocation)
     * @return true if any messages were processed
     */
    bool processWorkerMessages(js::Engine* mainEngine);

    /**
     * Re-open the registry to worker creation.
     *
     * The registry is a process-wide singleton but its lifetime is per-Runtime: `shutdown()`
     * closes it so a script running during teardown cannot start a thread whose completions
     * would land in a released engine. A later Runtime in the same process — which the native
     * contract tests really do create — must be able to make workers again, so its startup
     * re-opens the registry rather than inheriting the previous one's closed state.
     */
    void open();

    /**
     * Join every worker and close the registry to further creation. Idempotent.
     */
    void shutdown();

    /**
     * Check if workers are available (libuv/threading support)
     */
    bool isAvailable() const;

    // Prevent copying
    WorkerRegistry(const WorkerRegistry&) = delete;
    WorkerRegistry& operator=(const WorkerRegistry&) = delete;

private:
    WorkerRegistry();
    ~WorkerRegistry();

    std::unordered_map<int, std::unique_ptr<WorkerThread>> workers_;
    std::unordered_map<int, JSWorkerCallback> callbacks_;
    int nextId_ = 1;
    mutable std::mutex mutex_;
    bool initialized_ = false;
    /** Whether the registry currently accepts new workers; false between shutdown() and open(). */
    bool accepting_ = true;
};

}  // namespace workers
}  // namespace mystral
