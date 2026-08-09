#include "mystral/runtime.h"

#include <SDL3/SDL_main.h>

#import <Foundation/Foundation.h>

#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>

namespace {

std::string readFile(const std::string& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input.is_open()) return {};
    std::ostringstream contents;
    contents << input.rdbuf();
    return contents.str();
}

std::string javascriptString(const std::string& value) {
    std::string escaped = "'";
    for (char character : value) {
        if (character == '\\' || character == '\'') escaped.push_back('\\');
        if (character == '\n') {
            escaped += "\\n";
        } else if (character != '\r') {
            escaped.push_back(character);
        }
    }
    return escaped + "'";
}

std::string mailboxRoot() {
    const char* configured = std::getenv("TN_PLAYTEST_MAILBOX_ROOT");
    if (configured != nullptr && configured[0] != '\0') return configured;
    NSArray<NSURL*>* directories = [[NSFileManager defaultManager]
        URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask];
    return directories.count == 0 ? std::string() : directories.firstObject.path.UTF8String;
}

}  // namespace

int main(int, char**) {
    @autoreleasepool {
        NSString* scriptPath = [[NSBundle mainBundle] pathForResource:@"native-smoke" ofType:@"js"];
        if (scriptPath == nil) {
            NSLog(@"TN_IOS_PROOF_FAILED: native-smoke.js is absent from the app bundle");
            return 2;
        }
        const std::string script = readFile(scriptPath.UTF8String);
        if (script.empty()) {
            NSLog(@"TN_IOS_PROOF_FAILED: native-smoke.js is empty or unreadable");
            return 2;
        }
        NSString* gamePath = [[[NSBundle mainBundle] resourceURL]
            URLByAppendingPathComponent:@"game" isDirectory:YES].path;
        const BOOL hasGameAssets = [[NSFileManager defaultManager] fileExistsAtPath:gamePath];
        if (hasGameAssets && ![[NSFileManager defaultManager] changeCurrentDirectoryPath:gamePath]) {
            NSLog(@"TN_IOS_PROOF_FAILED: packaged game asset directory is unreadable");
            return 2;
        }

        mystral::RuntimeConfig config;
        config.width = 0;
        config.height = 0;
        config.title = "ThreeNative";
        config.fullscreen = true;
        config.resizable = false;
        auto runtime = mystral::Runtime::create(config);
        if (!runtime) {
            NSLog(@"TN_IOS_PROOF_FAILED: runtime initialization failed");
            return 2;
        }

        const char* endpointValue = std::getenv("TN_PLAYTEST_ENDPOINT");
        const std::string endpoint = endpointValue == nullptr ? std::string() : endpointValue;
        const std::string root = mailboxRoot();
        if (!endpoint.empty()) {
            runtime->evalScript("globalThis.TN_PLAYTEST_ENDPOINT=" + javascriptString(endpoint) + ";",
                                "threenative-playtest-endpoint.js");
        }
        if (!root.empty()) {
            const std::string mailbox = "globalThis.TN_PLAYTEST_MAILBOX={request:" +
                javascriptString(root + "/tn-playtest-request.json") + ",response:" +
                javascriptString(root + "/tn-playtest-response.json") + "};";
            runtime->evalScript(mailbox, "threenative-playtest-mailbox.js");
        }
        if (!runtime->evalScript(script, scriptPath.UTF8String)) {
            NSLog(@"TN_IOS_PROOF_FAILED: JavaScript evaluation failed");
            return 2;
        }
        runtime->run();
        return runtime->getExitCode();
    }
}
