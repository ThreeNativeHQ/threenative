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

#if defined(MYSTRAL_USE_V8) && MYSTRAL_USE_V8
namespace mystral::js {
void mystralSetV8SnapshotBlob(const char* data, size_t size);
}
#endif

namespace {

void writeFile(const fs::path& path, const std::string& content) {
    fs::create_directories(path.parent_path());
    std::ofstream out(path);
    out << content;
}

class QuickJSEngineFacade : public mystral::js::Engine {
    mystral::js::Engine* real_;
public:
    explicit QuickJSEngineFacade(mystral::js::Engine* real) : real_(real) {}
    mystral::js::EngineType getType() const override { return mystral::js::EngineType::QuickJS; }
    const char* getName() const override { return "quickjs"; }
    bool eval(const char* code, const char* filename) override { return real_->eval(code, filename); }
    mystral::js::JSValueHandle evalWithResult(const char* code, const char* filename) override { return real_->evalWithResult(code, filename); }
    bool evalScript(const char* code, const char* filename) override { return real_->evalScript(code, filename); }
    mystral::js::JSValueHandle evalScriptWithResult(const char* code, const char* filename) override { return real_->evalScriptWithResult(code, filename); }
    mystral::js::JSValueHandle getGlobal() override { return real_->getGlobal(); }
    bool setGlobalProperty(const char* name, mystral::js::JSValueHandle val) override { return real_->setGlobalProperty(name, val); }
    mystral::js::JSValueHandle getGlobalProperty(const char* name) override { return real_->getGlobalProperty(name); }
    mystral::js::JSValueHandle newUndefined() override { return real_->newUndefined(); }
    mystral::js::JSValueHandle newNull() override { return real_->newNull(); }
    mystral::js::JSValueHandle newBoolean(bool val) override { return real_->newBoolean(val); }
    mystral::js::JSValueHandle newNumber(double val) override { return real_->newNumber(val); }
    mystral::js::JSValueHandle newString(const char* val) override { return real_->newString(val); }
    mystral::js::JSValueHandle newObject() override { return real_->newObject(); }
    mystral::js::JSValueHandle newArray(size_t len) override { return real_->newArray(len); }
    mystral::js::JSValueHandle newArrayBuffer(const uint8_t* d, size_t l) override { return real_->newArrayBuffer(d, l); }
    mystral::js::JSValueHandle newArrayBufferExternal(void* d, size_t l) override { return real_->newArrayBufferExternal(d, l); }
    void* getArrayBufferData(mystral::js::JSValueHandle v, size_t* s) override { return real_->getArrayBufferData(v, s); }
    mystral::js::JSValueHandle createFloat32Array(const float* d, size_t c) override { return real_->createFloat32Array(d, c); }
    mystral::js::JSValueHandle createFloat32ArrayView(float* d, size_t c) override { return real_->createFloat32ArrayView(d, c); }
    mystral::js::JSValueHandle createUint32Array(const uint32_t* d, size_t c) override { return real_->createUint32Array(d, c); }
    mystral::js::JSValueHandle createUint8Array(const uint8_t* d, size_t c) override { return real_->createUint8Array(d, c); }
    mystral::js::JSValueHandle newFunction(const char* n, mystral::js::NativeFunction f) override { return real_->newFunction(n, f); }
    bool toBoolean(mystral::js::JSValueHandle v) override { return real_->toBoolean(v); }
    double toNumber(mystral::js::JSValueHandle v) override { return real_->toNumber(v); }
    std::string toString(mystral::js::JSValueHandle v) override { return real_->toString(v); }
    bool isUndefined(mystral::js::JSValueHandle v) override { return real_->isUndefined(v); }
    bool isNull(mystral::js::JSValueHandle v) override { return real_->isNull(v); }
    bool isBoolean(mystral::js::JSValueHandle v) override { return real_->isBoolean(v); }
    bool isNumber(mystral::js::JSValueHandle v) override { return real_->isNumber(v); }
    bool isString(mystral::js::JSValueHandle v) override { return real_->isString(v); }
    bool isObject(mystral::js::JSValueHandle v) override { return real_->isObject(v); }
    bool isArray(mystral::js::JSValueHandle v) override { return real_->isArray(v); }
    bool isFunction(mystral::js::JSValueHandle v) override { return real_->isFunction(v); }
    bool isBindingDestination(mystral::js::JSValueHandle v) override { return real_->isBindingDestination(v); }
    bool isSameValue(mystral::js::JSValueHandle l, mystral::js::JSValueHandle r) override { return real_->isSameValue(l, r); }
    bool setProperty(mystral::js::JSValueHandle o, const char* n, mystral::js::JSValueHandle v) override { return real_->setProperty(o, n, v); }
    mystral::js::JSValueHandle getProperty(mystral::js::JSValueHandle o, const char* n) override { return real_->getProperty(o, n); }
    bool getPropertyInfo(mystral::js::JSValueHandle o, const char* n, mystral::js::JSPropertyInfo& i) override { return real_->getPropertyInfo(o, n, i); }
    void releasePropertyInfo(mystral::js::JSPropertyInfo& i) override { real_->releasePropertyInfo(i); }
    bool hasProperty(mystral::js::JSValueHandle o, const char* n) override { return real_->hasProperty(o, n); }
    bool deleteProperty(mystral::js::JSValueHandle o, const char* n) override { return real_->deleteProperty(o, n); }
    bool setPropertyIndex(mystral::js::JSValueHandle a, uint32_t i, mystral::js::JSValueHandle v) override { return real_->setPropertyIndex(a, i, v); }
    mystral::js::JSValueHandle getPropertyIndex(mystral::js::JSValueHandle a, uint32_t i) override { return real_->getPropertyIndex(a, i); }
    mystral::js::JSValueHandle call(mystral::js::JSValueHandle f, mystral::js::JSValueHandle t, const std::vector<mystral::js::JSValueHandle>& a) override { return real_->call(f, t, a); }
    void freezeHandle(mystral::js::JSValueHandle v) override { real_->freezeHandle(v); }
    void freeHandle(mystral::js::JSValueHandle v) override { real_->freeHandle(v); }
    size_t outstandingHandleCount() const override { return real_->outstandingHandleCount(); }
    void gc() override { real_->gc(); }
    void processMicrotasks() override { real_->processMicrotasks(); }
    bool hasException() override { return real_->hasException(); }
    std::string getException() override { return real_->getException(); }
    void throwException(const char* m) override { real_->throwException(m); }
    void setPrivateData(mystral::js::JSValueHandle o, void* d) override { real_->setPrivateData(o, d); }
    void* getPrivateData(mystral::js::JSValueHandle o) override { return real_->getPrivateData(o); }
    void* getRawContext() override { return real_->getRawContext(); }
};

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

    // Root dir, bundle query, resolve resolved path
    resolver.setRootDir(tempDir.string());
    resolver.usingBundle();
    mystral::js::ResolvedModule resolvedPathMod;
    resolver.resolveResolvedPath(indexJs.string(), resolvedPathMod, error);

    // Directory resolution with index.js / index.ts
    fs::path dirWithIndex = tempDir / "dirWithIndex";
    fs::create_directories(dirWithIndex);
    writeFile(dirWithIndex / "index.js", "exports.dirIndex = true;");
    if (resolver.resolve("./dirWithIndex", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error)) {
        // resolved directory with index.js
    }

    // Package.json parsing tests exercising json parser branches
    fs::path jsonFixtures = tempDir / "node_modules" / "json-fixture" / "package.json";
    writeFile(jsonFixtures, R"JSON({
      "name": "json-fixture",
      "main": "./main.js",
      "scientific": 1.25e2,
      "negScientific": -3.5E-1,
      "escaped": "A\bB\fC\nD\rE\tF\/G\\H\"I\u0041",
      "bools": [true, false],
      "nullVal": null,
      "emptyObj": {},
      "emptyArr": []
    })JSON");
    writeFile(tempDir / "node_modules" / "json-fixture" / "main.js", "exports.ok = true;");
    resolver.resolve("json-fixture", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);

    fs::path jsonBadEscape = tempDir / "node_modules" / "bad-escape" / "package.json";
    writeFile(jsonBadEscape, "{\"name\": \"bad-escape\", \"main\": \"index.js\", \"bad\": \"\\z\"}");
    resolver.resolve("bad-escape", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);

    fs::path jsonBadNum = tempDir / "node_modules" / "bad-num" / "package.json";
    writeFile(jsonBadNum, "{\"name\": \"bad-num\", \"main\": \"index.js\", \"bad\": 12. }");
    resolver.resolve("bad-num", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);

    fs::path jsonUnclosed = tempDir / "node_modules" / "unclosed" / "package.json";
    writeFile(jsonUnclosed, "{\"name\": \"unclosed\", \"arr\": [1, 2");
    resolver.resolve("unclosed", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);

    // Resolver matrix: scoped packages, package fallbacks, directory packages and every
    // public exports/imports shape. These are deliberately separate package roots so the
    // resolver's package-json cache cannot hide a branch on a later lookup.
    writeFile(tempDir / "node_modules" / "@scope" / "pkg" / "package.json",
              R"JSON({"name":"@scope/pkg","main":"index.js"})JSON");
    writeFile(tempDir / "node_modules" / "@scope" / "pkg" / "index.js", "exports.ok = true;");
    writeFile(tempDir / "node_modules" / "@scope" / "pkg" / "sub.js", "exports.sub = true;");
    if (!resolver.resolve("@scope/pkg", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error) ||
        !resolver.resolve("@scope/pkg/sub", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error)) {
        std::cerr << "scoped package resolution failed: " << error << "\n";
        return false;
    }
    resolver.resolve("@scope", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);

    writeFile(tempDir / "node_modules" / "plain-index" / "index.js", "exports.ok = true;");
    resolver.resolve("plain-index", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);
    writeFile(tempDir / "node_modules" / "no-main" / "package.json", R"JSON({"name":"no-main"})JSON");
    writeFile(tempDir / "node_modules" / "no-main" / "index.js", "exports.ok = true;");
    resolver.resolve("no-main", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);
    writeFile(tempDir / "node_modules" / "plain-sub" / "package.json", R"JSON({"name":"plain-sub"})JSON");
    writeFile(tempDir / "node_modules" / "plain-sub" / "extra.js", "exports.ok = true;");
    resolver.resolve("plain-sub/extra", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);

    const fs::path directoryPackage = tempDir / "directory-package";
    writeFile(directoryPackage / "package.json", R"JSON({"main":"main.js"})JSON");
    writeFile(directoryPackage / "main.js", "exports.ok = true;");
    resolver.resolve("./directory-package", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);
    resolver.resolve("./directory-package", indexJs.string(), mystral::js::ResolveMode::Import, outMod, error);

    const fs::path directoryExports = tempDir / "directory-exports";
    writeFile(directoryExports / "package.json", R"JSON({"exports":{".":"./entry.js"}})JSON");
    writeFile(directoryExports / "entry.js", "export const ok = true;");
    resolver.resolve("./directory-exports", indexJs.string(), mystral::js::ResolveMode::Import, outMod, error);

    const auto addPackage = [&](const std::string& name, const std::string& packageJson,
                                const std::string& entry = "index.js") {
        writeFile(tempDir / "node_modules" / name / "package.json", packageJson);
        if (!entry.empty()) writeFile(tempDir / "node_modules" / name / entry, "exports.ok = true;");
    };
    addPackage("array-exports", R"JSON({"exports":[null,"./index.js"]})JSON");
    resolver.resolve("array-exports", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);
    addPackage("conditional-exports", R"JSON({"exports":{"browser":"./missing.js","default":"./index.js"}})JSON");
    resolver.resolve("conditional-exports", indexJs.string(), mystral::js::ResolveMode::Import, outMod, error);
    addPackage("conditional-array", R"JSON({"exports":{".":[null,{"default":"./index.js"}]}})JSON");
    resolver.resolve("conditional-array", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);
    addPackage("invalid-exports", R"JSON({"exports":true})JSON");
    resolver.resolve("invalid-exports", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);
    addPackage("bare-exports", R"JSON({"exports":"bare-target"})JSON");
    resolver.resolve("bare-exports", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);
    addPackage("no-condition", R"JSON({"exports":{".":{"browser":"./index.js"}}})JSON");
    resolver.resolve("no-condition", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);
    addPackage("pattern-exports", R"JSON({"exports":{"./foo/*/bar":"./dist/*.js","./*":"./dist/*.js"}})JSON");
    writeFile(tempDir / "node_modules" / "pattern-exports" / "dist" / "ok.js", "exports.ok = true;");
    resolver.resolve("pattern-exports/foo/nope", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);
    resolver.resolve("pattern-exports/*", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);
    resolver.resolve("pattern-exports/missing", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);

    const fs::path importPackage = tempDir / "node_modules" / "import-package";
    writeFile(importPackage / "package.json", R"JSON({"imports":{"#local":"./internal.js","#pkg":"plain-index"}})JSON");
    writeFile(importPackage / "internal.js", "exports.ok = true;");
    resolver.resolve("#local", (importPackage / "ref.js").string(), mystral::js::ResolveMode::Require, outMod, error);
    resolver.resolve("#pkg", (importPackage / "ref.js").string(), mystral::js::ResolveMode::Require, outMod, error);
    resolver.resolve("#missing", (importPackage / "ref.js").string(), mystral::js::ResolveMode::Require, outMod, error);
    writeFile(tempDir / "node_modules" / "no-imports" / "package.json", R"JSON({"name":"no-imports"})JSON");
    resolver.resolve("#missing", (tempDir / "node_modules" / "no-imports" / "ref.js").string(), mystral::js::ResolveMode::Require, outMod, error);
    resolver.resolve("#missing", (tempDir / "outside-ref.js").string(), mystral::js::ResolveMode::Require, outMod, error);

    // Extension and absolute-path branches.
    writeFile(tempDir / "late-ext.tsx", "export const ok = true;");
    resolver.resolve("./late-ext", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);
    resolver.resolve("./late-ext", indexJs.string(), mystral::js::ResolveMode::Import, outMod, error);
    resolver.resolve("C:/not-a-real-native-path.js", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);

    // Parser failures that cannot be reached through the happy-path package fixtures above.
    const std::vector<std::pair<std::string, std::string>> malformedPackages = {
        {"trailing-json", "{} trailing"},
        {"empty-json", ""},
        {"invalid-value-json", "{\"x\":?}"},
        {"missing-colon-json", "{\"x\" 1}"},
        {"missing-comma-json", "{\"x\":1 \"y\":2}"},
        {"unclosed-object-json", "{\"x\":1"},
        {"unclosed-object-loop-json", "{\"x\":1, \"y\":2"},
        {"array-comma-json", "[1 2]"},
        {"array-end-json", "[1,2"},
        {"invalid-number-json", "{\"x\":-}"},
        {"unterminated-string-json", "{\"x\":\"unterminated}"},
        {"trailing-escape-json", "{\"x\":\"bad\\"},
        {"short-unicode-json", "{\"x\":\"\\u12\"}"},
        {"bad-unicode-json", "{\"x\":\"\\u12G4\"}"},
    };
    for (const auto& [name, contents] : malformedPackages) {
        writeFile(tempDir / "node_modules" / name / "package.json", contents);
        resolver.resolve(name, indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);
    }
    addPackage("hex-json", R"JSON({"name":"hex-json","main":"index.js","low":"\u00af","upper":"\u00AF"})JSON");
    resolver.resolve("hex-json", indexJs.string(), mystral::js::ResolveMode::Require, outMod, error);

    // Test ModuleResolver helper methods and resolveResolvedPath
    mystral::js::ModuleResolver emptyRes("");
    emptyRes.setRootDir("");
    emptyRes.resolve("", "", mystral::js::ResolveMode::Require, outMod, error);
    emptyRes.normalizeSpecifier("file:///path/to/script.js");
    emptyRes.dirname("/a/b/c.js");
    emptyRes.dirname("script.js");

    mystral::js::ResolvedModule resMod;
    emptyRes.resolveResolvedPath(indexJs.string(), resMod, error);
    emptyRes.resolveResolvedPath((tempDir / "nonexistent.mjs").string(), resMod, error);
    emptyRes.resolveResolvedPath((tempDir / "nonexistent.cjs").string(), resMod, error);
    emptyRes.resolveResolvedPath((tempDir / "nonexistent.json").string(), resMod, error);

    std::string emptyFileContent;
    mystral::js::ResolvedPath resPath{ indexJs.string(), false };
    emptyRes.readFile(resPath, emptyFileContent, error);
    mystral::js::ResolvedPath badPath{ (tempDir / "nonexistent.js").string(), false };
    emptyRes.readFile(badPath, emptyFileContent, error);

    // Test ModuleSystem with V8 Engine
    mystral::js::ModuleSystem modSys(engine, tempDir.string());
    if (!modSys.loadEntry(indexJs.string())) {
        std::cerr << "failed loadEntry\n";
        return false;
    }

    // Test ESM entry and TypeScript entry
    fs::path esmEntry = tempDir / "esm_entry.mjs";
    writeFile(esmEntry, "export const value = 123;");
    modSys.loadEntry(esmEntry.string());

    modSys.loadEntry(testTs.string());

    // Test loadEntry and require error branches
    modSys.loadEntry("nonexistent_entry_xyz.js");
    modSys.loadEntry("");
    mystral::js::ModuleSystem noEng(nullptr, tempDir.string());
    noEng.loadEntry("test.js");
    noEng.require("test.js", "");

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

    // ModuleSystem global pointers and resolver access
    mystral::js::setModuleSystem(&modSys);
    if (mystral::js::getModuleSystem() != &modSys) return false;
    modSys.resolver();
    mystral::js::setModuleSystem(nullptr);

    // Test ESM transpilation to CJS using QuickJS facade
    fs::path esmFixture = tempDir / "esm_transpile.mjs";
    writeFile(esmFixture, R"JS(
import DefaultPkg from './sub/helper.js';
import * as AllFeature from './sub/helper.js';
import { value } from './sub/helper.js';
import MixedDef, { value } from './sub/helper.js';
import './sub/helper.js';

export default function myFunc() { return 123; }
export default class MyClass { foo() { return 1; } }
export default 42;
export const exportedNum = 456;
export { exportedNum };
export * from './sub/helper.js';
)JS");

    QuickJSEngineFacade qjsFacade(engine);
    mystral::js::ModuleSystem qjsModSys(&qjsFacade, tempDir.string());
    qjsModSys.loadEntry(esmFixture.string());
    qjsModSys.require("./esm_transpile.mjs", indexJs.string());

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

    // Types and context queries
    engine->getType();
    engine->getName();
    engine->getRawContext();

    // ArrayBuffer and TypedArray creation methods
    const uint8_t rawBytes[] = { 10, 20, 30, 40 };
    auto ab = engine->newArrayBuffer(rawBytes, sizeof(rawBytes));
    size_t abSize = 0;
    engine->getArrayBufferData(ab, &abSize);

    uint8_t externalBytes[16] = { 1, 2, 3, 4 };
    auto abExt = engine->newArrayBufferExternal(externalBytes, sizeof(externalBytes));
    engine->getArrayBufferData(abExt, &abSize);

    const float floatData[] = { 1.5f, 2.5f, 3.5f };
    auto f32Arr = engine->createFloat32Array(floatData, 3);
    float externalFloats[] = { 4.5f, 5.5f, 6.5f };
    auto f32View = engine->createFloat32ArrayView(externalFloats, 3);

    const uint32_t u32Data[] = { 100, 200, 300 };
    auto u32Arr = engine->createUint32Array(u32Data, 3);

    const uint8_t u8Data[] = { 7, 8, 9 };
    auto u8Arr = engine->createUint8Array(u8Data, 3);

    // Methods and Object templates
    if (engine->supportsNativeMethods()) {
        auto method = engine->newMethod("sampleMethod", [](mystral::js::Engine& eng, void* priv, const std::vector<mystral::js::JSValueHandle>& args) {
            return eng.newNumber(42);
        });
        auto protoObj = engine->newObject();
        engine->setProperty(protoObj, "method", method);
        auto instObj = engine->newObject();
        engine->setPrototypeOf(instObj, protoObj);
        engine->setGlobalProperty("__methodTarget", instObj);
        engine->eval("globalThis.__methodTarget.method();", "callMethod.js");
    }

    if (engine->supportsNativeObjectTemplates()) {
        engine->newNativeObject("TestClass", nullptr);
    }

    // Value queries
    engine->isBoolean(engine->newBoolean(false));
    engine->isNumber(engine->newNumber(123));
    engine->isString(engine->newString("abc"));
    engine->isArray(engine->newArray(1));
    auto freshFn = engine->newFunction("freshFn", [](void*, const std::vector<mystral::js::JSValueHandle>&) { return mystral::js::JSValueHandle(); });
    engine->isFunction(freshFn);
    engine->evalScript("const __sc = 5;", "evalScript.js");
    engine->setGlobalProperty("__globProp", engine->newNumber(99));
    engine->getGlobalProperty("__globProp");

    // Private data
    auto privObj = engine->newObject();
    int dummyPrivate = 12345;
    engine->setPrivateData(privObj, &dummyPrivate);
    if (engine->getPrivateData(privObj) != &dummyPrivate) return false;
    engine->setPrivateData(privObj, nullptr);

    // Protect / unprotect / outstandingHandleCount
    engine->protect(ab);
    engine->unprotect(ab);
    engine->outstandingHandleCount();

    // Release callback
    bool releaseCalled = false;
    auto releaseObj = engine->newObject();
    engine->registerRelease(releaseObj, [&releaseCalled]() {
        releaseCalled = true;
    });

    // Task waiting
    engine->supportsBlockingTaskWait();
    engine->wakeTaskWait();

    // Freeze handle
    auto fzHandle = engine->retainHandle(engine->newString("frozen_test"));
    engine->freezeHandle(fzHandle);

    // evalWithResult
    engine->evalWithResult("export const x = 42; x;", "test_esm_mod.js");

    // Syntax error handling in evals
    engine->eval("syntax error ? ? ?", "bad_eval.js");
    engine->evalScript("syntax error ? ? ?", "bad_eval_script.js");
    engine->evalWithResult("syntax error ? ? ?", "bad_eval_with_res.js");
    engine->evalScriptWithResult("syntax error ? ? ?", "bad_eval_script_with_res.js");
    if (engine->hasException()) {
        engine->getException();
    }

#if defined(MYSTRAL_USE_V8) && MYSTRAL_USE_V8
    // Snapshot blob helper
    mystral::js::mystralSetV8SnapshotBlob("dummy_snapshot", 14);
    mystral::js::mystralSetV8SnapshotBlob(nullptr, 0);
#endif

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
