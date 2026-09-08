#include "mystral/js/engine.h"
#include "mystral/js/module_resolver.h"
#include "mystral/js/module_system.h"
#include "mystral/js/ts_transpiler.h"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace {

void writeFile(const fs::path& path, const std::string& content) {
    fs::create_directories(path.parent_path());
    std::ofstream out(path);
    out << content;
}

bool testTsTranspiler() {
    if (mystral::js::isTypeScriptTranspilerAvailable()) {
        std::string outJs, outErr;
        bool ok = mystral::js::transpileTypeScript(
            "const x: number = 42;\ninterface Foo { bar: string; }\nexport const f = (a: Foo): number => 123;",
            "sample.ts", outJs, outErr);
        if (!ok || outJs.empty()) {
            std::cerr << "transpileTypeScript failed: " << outErr << "\n";
            return false;
        }
        std::string badJs, badErr;
        mystral::js::transpileTypeScript("const x: = ;", "bad.ts", badJs, badErr);
    }
    return true;
}

bool testModuleResolverAndSystem(mystral::js::Engine* engine, const fs::path& tempDir) {
    mystral::js::ModuleResolver resolver(tempDir.string());

    // normalizeSpecifier & dirname checks
    std::string norm = resolver.normalizeSpecifier("file:///path/to\\file.js");
    if (norm != "/path/to/file.js") return false;
    std::string dir = resolver.dirname("/path/to/file.js");
    if (dir.empty()) return false;

    // Create files in tempDir
    fs::path indexJs = tempDir / "index.js";
    writeFile(indexJs, "module.exports = { name: 'main', helper: require('./sub/helper.js'), data: require('./data.json') };");

    fs::path helperJs = tempDir / "sub" / "helper.js";
    writeFile(helperJs, "exports.value = 100;");

    fs::path dataJson = tempDir / "data.json";
    writeFile(dataJson, R"JSON({
      "string": "hello\n\"world\"\t\\",
      "number": -123.456,
      "booleanTrue": true,
      "booleanFalse": false,
      "nullValue": null,
      "nested": {
        "arr": [1, "two", true, null, { "k": "v" }]
      },
      "emptyArr": [],
      "emptyObj": {}
    })JSON");

    fs::path pkgJson = tempDir / "node_modules" / "my-pkg" / "package.json";
    writeFile(pkgJson, R"JSON({
      "name": "my-pkg",
      "type": "module",
      "main": "./dist/index.js",
      "exports": {
        ".": {
          "import": "./dist/index.js",
          "require": "./dist/index.cjs"
        },
        "./feature": "./dist/feature.js",
        "./*": "./dist/*.js"
      },
      "imports": {
        "#internal": "./internal.js"
      }
    })JSON");

    fs::path pkgMainEsm = tempDir / "node_modules" / "my-pkg" / "dist" / "index.js";
    writeFile(pkgMainEsm, "export const pkg = 'my-pkg';");
    fs::path pkgMainCjs = tempDir / "node_modules" / "my-pkg" / "dist" / "index.cjs";
    writeFile(pkgMainCjs, "exports.pkg = 'my-pkg-cjs';");
    fs::path pkgFeature = tempDir / "node_modules" / "my-pkg" / "dist" / "feature.js";
    writeFile(pkgFeature, "export const feat = true;");
    fs::path pkgSub = tempDir / "node_modules" / "my-pkg" / "dist" / "sub.js";
    writeFile(pkgSub, "export const sub = 42;");
    fs::path pkgInternal = tempDir / "node_modules" / "my-pkg" / "internal.js";
    writeFile(pkgInternal, "export const internal = true;");

    // Circular dependency fixtures
    fs::path circA = tempDir / "circA.js";
    fs::path circB = tempDir / "circB.js";
    writeFile(circA, "exports.b = require('./circB.js'); exports.a = 'A';");
    writeFile(circB, "exports.a = require('./circA.js'); exports.b = 'B';");

    // TS file fixture
    fs::path testTs = tempDir / "test.ts";
    writeFile(testTs, "export const tsVal: number = 789;");

    mystral::js::ResolvedModule outMod;
    std::string error;

    // Resolve relative
    if (!resolver.resolve("./index.js", (tempDir / "other.js").string(), mystral::js::ResolveMode::Require, outMod, error)) {
        std::cerr << "failed resolve relative index.js: " << error << "\n";
        return false;
    }
    if (!resolver.resolve("./sub/helper", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error)) {
        std::cerr << "failed resolve sub/helper: " << error << "\n";
        return false;
    }
    if (!resolver.resolve("./data.json", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error)) {
        std::cerr << "failed resolve data.json: " << error << "\n";
        return false;
    }

    // Resolve package
    if (!resolver.resolve("my-pkg", indexJs.string(), mystral::js::ResolveMode::Import, outMod, error)) {
        std::cerr << "failed resolve my-pkg (import): " << error << "\n";
        return false;
    }
    if (!resolver.resolve("my-pkg", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error)) {
        std::cerr << "failed resolve my-pkg (require): " << error << "\n";
        return false;
    }
    if (!resolver.resolve("my-pkg/feature", indexJs.string(), mystral::js::ResolveMode::Import, outMod, error)) {
        std::cerr << "failed resolve my-pkg/feature: " << error << "\n";
        return false;
    }
    if (!resolver.resolve("my-pkg/sub", indexJs.string(), mystral::js::ResolveMode::Import, outMod, error)) {
        std::cerr << "failed resolve my-pkg/sub wildcard: " << error << "\n";
        return false;
    }
    if (!resolver.resolve("#internal", (tempDir / "node_modules" / "my-pkg" / "index.js").string(), mystral::js::ResolveMode::Import, outMod, error)) {
        std::cerr << "failed resolve #internal: " << error << "\n";
        return false;
    }

    // Resolve failures
    resolver.resolve("nonexistent-package", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);
    resolver.resolve("./nonexistent-file.js", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);
    resolver.resolve("my-pkg/nonexistent", indexJs.string(), mystral::js::ResolveMode::Import, outMod, error);
    resolver.resolve("./sub", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);

    // JSON Parser edge cases directly through package.json loading or resolve
    fs::path badJson1 = tempDir / "bad1" / "package.json";
    writeFile(badJson1, "{ unterminated");
    resolver.resolve("bad1", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);

    fs::path badJson2 = tempDir / "bad2" / "package.json";
    writeFile(badJson2, "[1, 2,");
    resolver.resolve("bad2", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);

    fs::path badJson3 = tempDir / "bad3" / "package.json";
    writeFile(badJson3, R"JSON({"name": "bad3", "exports": "not_an_object"})JSON");
    resolver.resolve("bad3", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);

    fs::path jsonWithEscapes = tempDir / "escapes" / "package.json";
    writeFile(jsonWithEscapes, R"JSON({"name": "escapes", "main": "index.js", "desc": "line\nfeed\ttab\rreturn\bback\fform\/slash\\backslash\u0041letter"})JSON");
    resolver.resolve("escapes", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);

    // Read file
    std::string fileContent;
    if (!resolver.readFile(outMod.resolved, fileContent, error)) {
        // okay if nonexistent
    }

    // Test ModuleSystem with V8 Engine
    mystral::js::ModuleSystem modSys(engine, tempDir.string());
    if (!modSys.loadEntry(indexJs.string())) {
        std::cerr << "failed loadEntry\n";
        return false;
    }

    auto reqResult = modSys.require("./sub/helper.js", indexJs.string());
    if (!engine->isObject(reqResult)) {
        std::cerr << "require ./sub/helper.js returned non-object\n";
        return false;
    }

    auto jsonResult = modSys.require("./data.json", indexJs.string());
    if (!engine->isObject(jsonResult)) {
        std::cerr << "require ./data.json returned non-object\n";
        return false;
    }

    // Circular require
    auto circResult = modSys.require("./circA.js", indexJs.string());
    if (!engine->isObject(circResult)) {
        std::cerr << "require ./circA.js returned non-object\n";
        return false;
    }

    // TS require
    modSys.require("./test.ts", indexJs.string());

    std::string esmSrc, esmFile;
    if (modSys.resolveForImport("my-pkg", indexJs.string(), outMod, error)) {
        modSys.getEsmSource(outMod, indexJs.string(), esmSrc, esmFile, error);
    }
    modSys.loadedPaths();

    modSys.clearCaches();
    return true;
}

bool testV8EngineFeatures(mystral::js::Engine* engine) {
    if (!engine) return false;

    // Globals & Objects
    auto global = engine->getGlobal();
    auto testObj = engine->newObject();
    engine->setProperty(testObj, "num", engine->newNumber(42.5));
    engine->setProperty(testObj, "str", engine->newString("hello"));
    engine->setProperty(testObj, "bool", engine->newBoolean(true));
    engine->setProperty(testObj, "nullVal", engine->newNull());
    engine->setProperty(testObj, "undefVal", engine->newUndefined());

    if (!engine->hasProperty(testObj, "num")) return false;
    if (engine->toNumber(engine->getProperty(testObj, "num")) != 42.5) return false;
    if (engine->toString(engine->getProperty(testObj, "str")) != "hello") return false;
    if (!engine->toBoolean(engine->getProperty(testObj, "bool"))) return false;
    if (!engine->isNull(engine->getProperty(testObj, "nullVal"))) return false;
    if (!engine->isUndefined(engine->getProperty(testObj, "undefVal"))) return false;

    mystral::js::JSPropertyInfo info{};
    if (engine->getPropertyInfo(testObj, "num", info)) {
        engine->releasePropertyInfo(info);
    }

    engine->deleteProperty(testObj, "str");
    if (engine->hasProperty(testObj, "str")) return false;

    // Arrays
    auto arr = engine->newArray(3);
    engine->setPropertyIndex(arr, 0, engine->newNumber(1));
    engine->setPropertyIndex(arr, 1, engine->newNumber(2));
    engine->setPropertyIndex(arr, 2, engine->newNumber(3));
    if (engine->toNumber(engine->getPropertyIndex(arr, 1)) != 2) { std::cerr << "fail array\n"; return false; }

    // Typed Arrays
    // Eval to create typed arrays in context
    engine->eval("globalThis.__arr = new Float32Array([1.0, 2.0, 3.0]);", "arr.js");
    auto arrVal = engine->getProperty(global, "__arr");
    size_t byteLength = 0;
    void* rawBuf = engine->getArrayBufferData(arrVal, &byteLength);
    if (!rawBuf || byteLength != 12) { std::cerr << "fail rawBuf=" << rawBuf << " len=" << byteLength << "\n"; return false; }

    // Functions & callbacks
    bool called = false;
    auto fn = engine->newFunction("testFn", [&called](void*, const std::vector<mystral::js::JSValueHandle>&) {
        called = true;
        return mystral::js::JSValueHandle();
    });
    engine->call(fn, global, {});
    if (!called) { std::cerr << "fail called\n"; return false; }

    // SameValue & Destinations
    if (!engine->isSameValue(testObj, testObj)) { std::cerr << "fail sameVal\n"; return false; }
    if (!engine->isBindingDestination(testObj)) { std::cerr << "fail bindDest\n"; return false; }
    if (engine->isBindingDestination(global)) { std::cerr << "fail bindGlobal\n"; return false; }

    // Handles & GC & Frames
    engine->beginFrame();
    auto frozen = engine->retainHandle(engine->newNumber(777));
    engine->clearFrameHandles();
    engine->freeHandle(frozen);
    engine->suspendFrameTracking();
    engine->resumeFrameTracking();
    engine->processMicrotasks();
    engine->gc();

    // Eval & Exception handling
    engine->eval("var __myEvalVar = 999;", "eval.js");
    auto evalRes = engine->evalScriptWithResult("10 + 20", "math.js");
    if (engine->toNumber(evalRes) != 30) return false;

    engine->throwException("expected test error");
    if (!engine->hasException()) return false;
    std::string exMsg = engine->getException();
    if (exMsg.empty()) return false;

    return true;
}

}  // namespace

int main() {
    fs::path tempDir = fs::temp_directory_path() / "tn_js_module_comp_test";
    fs::remove_all(tempDir);
    fs::create_directories(tempDir);

    auto engine = mystral::js::createEngine();
    if (!engine) {
        std::cerr << "failed to create V8 engine\n";
        return 1;
    }

    bool ok = true;
    if (!testTsTranspiler()) {
        std::cerr << "testTsTranspiler failed\n";
        ok = false;
    }
    if (!testModuleResolverAndSystem(engine.get(), tempDir)) {
        std::cerr << "testModuleResolverAndSystem failed\n";
        ok = false;
    }
    if (!testV8EngineFeatures(engine.get())) {
        std::cerr << "testV8EngineFeatures failed\n";
        ok = false;
    }

    fs::remove_all(tempDir);
    if (!ok) return 1;

    std::cout << "native JS module comprehensive contract passed\n";
    return 0;
}
