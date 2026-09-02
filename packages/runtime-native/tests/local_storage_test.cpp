// Bindings test for the native localStorage backend (src/storage/local_storage.cpp).
// This is the C++ half of the host surface the JS storagePolyfill delegates to
// (__storageGetItem and friends), so its contract is what game progress
// persistence actually rests on: survives restarts, preserves insertion order,
// escapes values safely, and fails soft on a corrupt file.
//
// Build (opt-in, like the other bindings tests):
//   ninja -C build/tn-linux threenative-local-storage-test && ./build/tn-linux/threenative-local-storage-test

#include "storage/local_storage.h"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#ifdef _WIN32
#include <process.h>
#define TN_TEST_GETPID _getpid
#else
#include <unistd.h>
#define TN_TEST_GETPID getpid
#endif

using mystral::storage::LocalStorage;

namespace {

int failures = 0;

void expect(bool condition, const std::string& what) {
    if (!condition) {
        std::cerr << "FAIL: " << what << '\n';
        failures++;
    }
}

void expectEq(const std::string& actual, const std::string& expected, const std::string& what) {
    if (actual != expected) {
        std::cerr << "FAIL: " << what << ": expected \"" << expected << "\", got \""
                  << actual << "\"\n";
        failures++;
    }
}

std::string readFile(const std::string& path) {
    std::ifstream file(path);
    std::stringstream ss;
    ss << file.rdbuf();
    return ss.str();
}

struct TempDir {
    std::filesystem::path path;
    TempDir() {
        path = std::filesystem::temp_directory_path() /
               ("threenative-local-storage-test-" + std::to_string(TN_TEST_GETPID()));
        std::filesystem::remove_all(path);
        std::filesystem::create_directories(path);
    }
    ~TempDir() { std::filesystem::remove_all(path); }
    std::string file(const std::string& name) const { return (path / name).string(); }
};

}  // namespace

int main() {
    TempDir temp;

    // --- Fresh init: no file yet, empty surface ---------------------------
    {
        const std::string storePath = temp.file("fresh/store.json");
        LocalStorage storage;
        storage.init(storePath);
        expect(storage.length() == 0, "fresh init has no entries");
        expect(!storage.has("progress"), "missing key reports has()==false");
        expectEq(storage.getItem("progress"), "", "missing key reads as empty string");
        expectEq(storage.key(0), "", "key(0) on empty storage is empty");
        expectEq(storage.key(-1), "", "negative index is empty");
        // init alone must not create the file; only a write does.
        expect(!std::filesystem::exists(storePath), "init does not create the file");
    }

    // --- Writes defer disk work until the storage owner reaches a boundary -------------
    {
        const std::string storePath = temp.file("deferred/store.json");
        {
            LocalStorage storage;
            storage.init(storePath);
            storage.setItem("progress", "in-memory-first");
            expect(!std::filesystem::exists(storePath),
                   "setItem updates memory without a synchronous disk round-trip");
        }
        expect(std::filesystem::exists(storePath),
               "storage destructor flushes dirty data before shutdown");
        LocalStorage reopened;
        reopened.init(storePath);
        expectEq(reopened.getItem("progress"), "in-memory-first",
                 "deferred data survives the shutdown flush");
    }

    // --- Round-trip + restart persistence ---------------------------------
    {
        const std::string storePath = temp.file("persist/store.json");
        {
            LocalStorage storage;
            storage.init(storePath);
            storage.setItem("progress", "depth-42");
            storage.setItem("weapon", "railgun");
        }
        {
            // A second instance models a game restart.
            LocalStorage storage;
            storage.init(storePath);
            expectEq(storage.getItem("progress"), "depth-42", "value survives restart");
            expect(storage.has("weapon"), "has() survives restart");
            expect(storage.length() == 2, "length survives restart");
        }
    }

    // --- Insertion order contract -----------------------------------------
    {
        const std::string storePath = temp.file("order/store.json");
        LocalStorage storage;
        storage.init(storePath);
        storage.setItem("a", "1");
        storage.setItem("b", "2");
        storage.setItem("c", "3");
        storage.setItem("b", "overwritten");  // overwrite keeps position
        expectEq(storage.key(0), "a", "first inserted key first");
        expectEq(storage.key(1), "b", "overwrite does not reorder");
        expectEq(storage.key(2), "c", "last inserted key last");

        storage.removeItem("b");
        storage.setItem("d", "4");  // new key appends after survivors
        storage.setItem("a", "again");  // overwrite keeps position, like Chrome
        expect(storage.length() == 3, "removeItem shrinks length");
        expectEq(storage.key(0), "a", "overwritten key keeps its original slot");
        expectEq(storage.key(1), "c", "survivors keep relative order");
        expectEq(storage.key(2), "d", "new key appends at the end");

        // A removed key that comes back goes to the end, not its old slot.
        storage.removeItem("a");
        storage.setItem("a", "back");
        expectEq(storage.key(2), "a", "removed-then-re-added key moves to the end");

        storage.removeItem("never-existed");  // no-op, no flush error
        expect(storage.length() == 3, "removing a missing key changes nothing");

        // Runtime boundaries, rather than individual mutations, flush the dirty snapshot.
        storage.flushIfDirty();

        // Order must survive restart too.
        LocalStorage reopened;
        reopened.init(storePath);
        expectEq(reopened.key(0), "c", "order survives restart (0)");
        expectEq(reopened.key(1), "d", "order survives restart (1)");
        expectEq(reopened.key(2), "a", "order survives restart (2)");
        expect(static_cast<int>(reopened.keys().size()) == reopened.length(),
               "keys().size() agrees with length()");
    }

    // --- Escaping: quotes, backslashes, control chars, UTF-8 --------------
    {
        const std::string storePath = temp.file("escaping/store.json");
        const std::string nasty = "quote:\" backslash:\\ newline:\n tab:\t utf8:héllo 中文字 🎮";
        {
            LocalStorage storage;
            storage.init(storePath);
            storage.setItem("nasty", nasty);
            storage.setItem("key with spaces", "v");
        }
        LocalStorage reopened;
        reopened.init(storePath);
        expectEq(reopened.getItem("nasty"), nasty, "control chars and UTF-8 round-trip");
        expectEq(reopened.getItem("key with spaces"), "v", "spaced key round-trips");
        // The file itself stays valid flat JSON.
        const std::string json = readFile(storePath);
        expect(json.find("\\n") != std::string::npos, "newline written escaped");
        expect(json.find('\n') != std::string::npos, "file uses pretty-printed lines");
    }

    // --- Empty-string value vs missing key --------------------------------
    {
        const std::string storePath = temp.file("empty-value/store.json");
        LocalStorage storage;
        storage.init(storePath);
        storage.setItem("blank", "");
        expect(storage.has("blank"), "empty-string value still exists");
        expectEq(storage.getItem("blank"), "", "empty-string value reads as empty");
        expect(storage.length() == 1, "empty-string value counts in length");
    }

    // --- Atomic flush: no .tmp leftover ------------------------------------
    {
        const std::string storePath = temp.file("atomic/store.json");
        LocalStorage storage;
        storage.init(storePath);
        storage.setItem("k", "v");
        storage.flushIfDirty();
        expect(std::filesystem::exists(storePath), "flush created the store file");
        expect(!std::filesystem::exists(storePath + ".tmp"),
               "atomic rename consumed the tmp file");
    }

    // --- Corrupt file: fail soft, start fresh ------------------------------
    {
        const std::string storePath = temp.file("corrupt/store.json");
        std::filesystem::create_directories(std::filesystem::path(storePath).parent_path());
        {
            std::ofstream out(storePath);
            out << "{ this is not json ]";
        }
        LocalStorage storage;
        storage.init(storePath);
        expect(storage.length() == 0, "corrupt file starts fresh instead of crashing");
        storage.setItem("after", "crash");  // storage remains usable
        expectEq(storage.getItem("after"), "crash", "storage usable after corrupt load");
    }

    // --- Duplicate keys in a hand-edited file stay consistent --------------
    {
        const std::string storePath = temp.file("dup/store.json");
        std::filesystem::create_directories(std::filesystem::path(storePath).parent_path());
        {
            std::ofstream out(storePath);
            out << "{\n  \"a\": \"1\",\n  \"a\": \"2\"\n}\n";
        }
        LocalStorage storage;
        storage.init(storePath);
        expect(storage.length() == 1, "duplicate keys collapse to one entry");
        expect(static_cast<int>(storage.keys().size()) == storage.length(),
               "insertion order never holds duplicates");
        expectEq(storage.getItem("a"), "2", "last duplicate wins like a JSON object would");
    }

    // --- Static helpers -----------------------------------------------------
    {
        expectEq(LocalStorage::deriveStorageFilename("My Game v1.2"), "My_Game_v1_2.json",
                 "identifier sanitization");
        expectEq(LocalStorage::deriveStorageFilename(""), "default.json",
                 "empty identifier falls back to default.json");
        expectEq(LocalStorage::deriveStorageFilename("already_safe-1"), "already_safe-1.json",
                 "safe identifier passes through");
        expect(!LocalStorage::getStorageDirectory().empty(), "platform storage dir resolves");
    }

    // --- Storage root, per platform, from any platform ------------------------
    //
    // A physical Pixel 8 logged this on every cold launch of com.threenative.bayview:
    //
    //   [Storage] Failed to create directory "/data/.local/share/mystral/storage":
    //   Permission denied
    //   [Mystral] localStorage initialized: /data/.local/share/mystral/storage/default.json
    //
    // Android sets neither HOME nor XDG_DATA_HOME, so the POSIX arm fell through to
    // `getpwuid()->pw_dir`, which on Android is "/data" — owned by the system. The store reported
    // itself initialised at a path it had just failed to create, so every saved setting was lost
    // between runs and nothing failed loudly. PRD-218.
    //
    // The resolution is a pure function precisely so this arm can be proven from a Linux host with
    // no phone, no display and no GPU.
    {
        using Platform = LocalStorage::Platform;
        LocalStorage::Environment android;
        android.androidInternalPath = "/data/user/0/com.threenative.bayview/files";
        expectEq(LocalStorage::resolveStorageDirectory(Platform::Android, android),
                 "/data/user/0/com.threenative.bayview/files/mystral/storage",
                 "Android resolves under the app's own internal files directory");

        // The negative control: the arm Android used to take, reproduced on purpose. If this ever
        // matches what Platform::Android returns, the fix has been reverted.
        LocalStorage::Environment androidLikePosix;
        androidLikePosix.home = "/data";
        const std::string broken =
            LocalStorage::resolveStorageDirectory(Platform::Posix, androidLikePosix);
        expectEq(broken, "/data/.local/share/mystral/storage",
                 "the POSIX arm still reproduces the unwritable path Android used to get");
        expect(LocalStorage::resolveStorageDirectory(Platform::Android, android) != broken,
               "Android must not resolve to the system-owned /data path");

        // No app path is a soft landing in the process's own directory, never the system tree.
        LocalStorage::Environment androidNoPath;
        expectEq(LocalStorage::resolveStorageDirectory(Platform::Android, androidNoPath),
                 "./mystral/storage", "Android with no app path falls back to the working dir");
        LocalStorage::Environment androidEmptyPath;
        androidEmptyPath.androidInternalPath = "";
        expectEq(LocalStorage::resolveStorageDirectory(Platform::Android, androidEmptyPath),
                 "./mystral/storage", "an empty app path is treated as absent, not joined");

        // The other three arms, unchanged, so this refactor cannot have moved them quietly.
        LocalStorage::Environment posix;
        posix.home = "/home/player";
        expectEq(LocalStorage::resolveStorageDirectory(Platform::Posix, posix),
                 "/home/player/.local/share/mystral/storage", "Linux uses ~/.local/share");
        posix.xdgDataHome = "/xdg";
        expectEq(LocalStorage::resolveStorageDirectory(Platform::Posix, posix),
                 "/xdg/mystral/storage", "XDG_DATA_HOME wins over HOME when set");

        LocalStorage::Environment apple;
        apple.home = "/Users/player";
        expectEq(LocalStorage::resolveStorageDirectory(Platform::Apple, apple),
                 "/Users/player/Library/Application Support/Mystral/storage",
                 "macOS uses Application Support");

        LocalStorage::Environment windows;
        windows.appData = "C:\\Users\\player\\AppData\\Roaming";
        expectEq(LocalStorage::resolveStorageDirectory(Platform::Windows, windows),
                 "C:\\Users\\player\\AppData\\Roaming\\Mystral\\storage",
                 "Windows uses %APPDATA%");
    }

    if (failures > 0) {
        std::cerr << failures << " local-storage assertion(s) failed\n";
        return 1;
    }
    std::cout << "local_storage bindings: all assertions passed\n";
    return 0;
}
