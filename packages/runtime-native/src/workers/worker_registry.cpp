/**
 * WorkerRegistry Implementation
 *
 * Singleton that manages all web workers and routes messages
 * between the main thread and worker threads.
 */

#include "mystral/workers/worker_registry.h"
#include <iostream>

namespace mystral {
namespace workers {

WorkerRegistry& WorkerRegistry::instance() {
    static WorkerRegistry instance;
    return instance;
}

WorkerRegistry::WorkerRegistry() {
    initialized_ = true;
    std::cout << "[WorkerRegistry] Initialized" << std::endl;
}

WorkerRegistry::~WorkerRegistry() {
    shutdown();
}

bool WorkerRegistry::isAvailable() const {
    return initialized_;
}

int WorkerRegistry::createWorker(const std::string& code) {
    std::lock_guard<std::mutex> lock(mutex_);

    // After shutdown the host is tearing down its main engine; a worker created here would
    // outlive the isolate its completions are delivered into. Refuse by returning the documented
    // failure id rather than starting a thread nothing will ever join.
    if (!initialized_) {
        std::cerr << "[WorkerRegistry] createWorker refused: registry is shut down" << std::endl;
        return -1;
    }

    int id = nextId_++;

    auto worker = std::make_unique<WorkerThread>(id, code);
    worker->start();

    workers_[id] = std::move(worker);

    std::cout << "[WorkerRegistry] Created worker " << id << std::endl;

    return id;
}

void WorkerRegistry::postToWorker(int id, WorkerMessage msg) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto it = workers_.find(id);
    if (it == workers_.end()) {
        std::cerr << "[WorkerRegistry] Worker " << id << " not found" << std::endl;
        return;
    }

    it->second->postMessage(std::move(msg.payload), std::move(msg.transfers));
}

void WorkerRegistry::terminateWorker(int id) {
    std::unique_ptr<WorkerThread> worker;

    {
        std::lock_guard<std::mutex> lock(mutex_);

        auto it = workers_.find(id);
        if (it == workers_.end()) {
            return;
        }

        worker = std::move(it->second);
        workers_.erase(it);
        callbacks_.erase(id);
    }

    // Terminate outside lock to avoid deadlock
    if (worker) {
        worker->terminate();
        std::cout << "[WorkerRegistry] Terminated worker " << id << std::endl;
    }
}

void WorkerRegistry::registerCallback(int id, JSWorkerCallback callback) {
    std::lock_guard<std::mutex> lock(mutex_);
    callbacks_[id] = std::move(callback);
}

void WorkerRegistry::unregisterCallback(int id) {
    std::lock_guard<std::mutex> lock(mutex_);
    callbacks_.erase(id);
}

bool WorkerRegistry::processWorkerMessages(js::Engine* mainEngine) {
    if (!mainEngine) {
        return false;
    }

    bool hadMessages = false;

    // Collect messages and dead workers (hold lock briefly)
    std::vector<std::tuple<int, JSWorkerCallback, WorkerMessage>> messages;
    std::vector<int> deadWorkers;

    {
        std::lock_guard<std::mutex> lock(mutex_);

        for (auto& [id, worker] : workers_) {
            // Drain before reaping, and drain a stopped worker too. A worker that called close()
            // has already queued its final result and stopped running; the old order pushed it
            // straight onto deadWorkers and destroyed that result undelivered.
            auto callbackIt = callbacks_.find(id);
            if (callbackIt != callbacks_.end()) {
                while (worker->hasMessages()) {
                    messages.emplace_back(id, callbackIt->second, worker->popMessage());
                }
            }

            // Only reap once nothing is left to deliver. A stopped worker whose callback has not
            // been registered yet keeps its queue: FIFO delivery survives a late handler, and
            // explicit terminate() reaps it regardless of what is queued.
            if (!worker->isRunning() && !worker->hasMessages()) {
                deadWorkers.push_back(id);
            }
        }
    }

    // Invoke callbacks outside the lock
    for (auto& [id, callback, msg] : messages) {
        hadMessages = true;
        try {
            callback(id, msg);
        } catch (const std::exception& e) {
            std::cerr << "[WorkerRegistry] Error in callback for worker " << id
                      << ": " << e.what() << std::endl;
        }
    }

    // Cleanup dead workers
    for (int id : deadWorkers) {
        terminateWorker(id);
    }

    return hadMessages;
}

void WorkerRegistry::shutdown() {
    std::vector<int> ids;

    {
        std::lock_guard<std::mutex> lock(mutex_);
        // Idempotent: the destructor calls this after an explicit teardown already has, and a
        // second pass must not re-announce a shutdown or re-walk an empty map.
        if (!initialized_) return;
        initialized_ = false;
        for (auto& [id, _] : workers_) {
            ids.push_back(id);
        }
    }

    // Join every worker before the caller tears the main engine down. terminateWorker() pushes a
    // TERMINATE message, notifies the idle condition and joins, so this returns only once no
    // worker thread can call back into the isolate again.
    for (int id : ids) {
        terminateWorker(id);
    }

    std::cout << "[WorkerRegistry] Shutdown complete, joined " << ids.size() << " worker(s)"
              << std::endl;
}

}  // namespace workers
}  // namespace mystral
