// PRD-465 Phase 2: the Linux native backend must agree with the standalone upstream evaluator.
//
// The browser WASM lane (packages/metahuman/__tests__/wasm-reference.spec.ts) already proves
// the shared ABI against the same committed reference vectors. This test drives the other
// backend: the installed JS host, the `js::Engine` binding, the C ABI, and OpenRigLogic, in one
// process, and compares every committed vector. A rig evaluated on the wrong axis, a swapped
// control order or a missing behaviour module fails here rather than on a player's face.
//
// The comparison runs in JavaScript because the host's JSON parser is already here and the
// fixtures are JSON; writing a parser in C++ would test the parser instead of the rig.

#include "mystral/js/engine.h"
#include "metahuman/native_bindings.h"

#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

namespace {

#ifndef THREENATIVE_METAHUMAN_DNA
#error "THREENATIVE_METAHUMAN_DNA must name the committed synthetic DNA fixture"
#endif
#ifndef THREENATIVE_METAHUMAN_VECTORS
#error "THREENATIVE_METAHUMAN_VECTORS must name the committed vector file"
#endif
#ifndef THREENATIVE_METAHUMAN_REFERENCE
#error "THREENATIVE_METAHUMAN_REFERENCE must name the committed reference file"
#endif

/** Absolute error the PRD allows: 1e-5 + 1e-4 * |reference|. */
const char *kScript = R"JS((() => {
  const failures = [];
  let worstError = 0;
  let worstWhere = "nothing compared";
  const textOf = (error) =>
    error === null || error === undefined
      ? String(error)
      : typeof error.message === "string"
        ? error.message
        : String(error);
  const record = (name, message) => failures.push(name + ": " + message);
  const check = (name, fn) => {
    try {
      const message = fn();
      if (message !== undefined) record(name, message);
    } catch (error) {
      record(name, "threw " + textOf(error));
    }
  };
  const throws = (name, pattern, fn) => {
    try {
      fn();
    } catch (error) {
      const text = textOf(error);
      if (!new RegExp(pattern).test(text))
        record(name, "threw '" + text + "', expected " + pattern);
      return;
    }
    record(name, "did not throw " + pattern);
  };
  const allowedError = (reference) => 1e-5 + 1e-4 * Math.abs(reference);
  const compare = (actual, expected, where) => {
    if (!(actual instanceof Float32Array))
      return where + ": the binding returned " + typeof actual + ", not a Float32Array";
    if (actual.length !== expected.length)
      return where + ": got " + actual.length + " floats, the reference has " + expected.length;
    for (let index = 0; index < expected.length; index += 1) {
      const wanted = expected[index];
      const error = Math.abs(actual[index] - wanted);
      if (error > worstError) {
        worstError = error;
        worstWhere = where + "[" + index + "]";
      }
      if (!(error <= allowedError(wanted)))
        return (
          where + "[" + index + "]: got " + actual[index] + ", reference " + wanted +
          ", error " + error + " over the allowed " + allowedError(wanted)
        );
    }
    return undefined;
  };

  const host = globalThis.__THREENATIVE_NATIVE__;
  if (host === undefined || host.metahuman === undefined) {
    __tnReport("the metahuman host was not installed");
    return undefined;
  }
  const metahuman = host.metahuman;
  if (typeof metahuman.version !== "string" || !/OpenRigLogic [0-9a-f]{40}$/u.test(metahuman.version)) {
    __tnReport("version '" + metahuman.version + "' does not name the OpenRigLogic revision");
    return undefined;
  }

  // The ABI selector and the reference file's spelling of the same kind are named once here;
  // they differ only in the blend-shape key, and a mismatch between the two is a silent
  // "undefined selector" rejection rather than a wrong answer.
  const KINDS = {
    gui: ["gui", 0],
    raw: ["raw", 1],
    joint: ["joint", 2],
    blendShape: ["blendshape", 3],
    animatedMap: ["animatedMap", 4],
    lod: ["lod", 5],
  };
  const kindNames = Object.keys(KINDS);
  const vectors = JSON.parse(__tnVectors);
  const reference = JSON.parse(__tnReference);
  if (!Array.isArray(vectors.cases) || vectors.cases.length === 0) {
    __tnReport("the vector file has no cases; a missing observation must fail");
    return undefined;
  }

  const rig = metahuman.create(__tnDna);
  if (typeof rig !== "number" || rig < 1) {
    __tnReport("create did not return a usable rig id");
    return undefined;
  }

  check("the rig reports the reference counts and names", () => {
    for (const kind of kindNames) {
      const actual = metahuman.count(rig, KINDS[kind][1]);
      const expected = reference.counts[KINDS[kind][0]];
      if (actual !== expected)
        return kind + " count " + actual + ", reference " + expected;
    }
    for (const kind of ["gui", "raw", "joint", "blendShape", "animatedMap"]) {
      const names = reference.names[KINDS[kind][0]];
      for (let index = 0; index < names.length; index += 1) {
        const actual = metahuman.name(rig, KINDS[kind][1], index);
        if (actual !== names[index])
          return kind + " name " + index + " is '" + actual + "', reference '" + names[index] + "'";
      }
    }
    return compare(
      metahuman.neutralJoints(rig),
      reference.neutralJoints,
      "neutralJoints",
    );
  });

  // Every committed vector, in file order, matched to its reference case by name: a case the
  // reference does not carry is a failure, not a skip.
  const byName = new Map(reference.cases.map((item) => [item.name, item]));
  if (byName.size !== vectors.cases.length) {
    __tnReport("the reference carries " + byName.size + " cases for " + vectors.cases.length + " vectors");
    return undefined;
  }
  for (const vector of vectors.cases) {
    const expected = byName.get(vector.name);
    if (expected === undefined) {
      record(vector.name, "the reference has no case with this name");
      continue;
    }
    check(vector.name, () => {
      metahuman.setLod(rig, vector.lod);
      if (vector.mode === "gui") {
        metahuman.setGui(rig, Float32Array.from(vector.values));
        metahuman.evaluate(rig, true);
      } else {
        metahuman.setRaw(rig, Float32Array.from(vector.values));
        metahuman.evaluate(rig, false);
      }
      return (
        compare(metahuman.jointOutputs(rig), expected.joints, vector.name + ".joints") ??
        compare(
          metahuman.blendShapeOutputs(rig),
          expected.blendshapes,
          vector.name + ".blendshapes",
        ) ??
        compare(
          metahuman.animatedMapOutputs(rig),
          expected.animatedMaps,
          vector.name + ".animatedMaps",
        )
      );
    });
  }

  // A GUI case and a raw case with the same values must not agree: that is what proves the
  // rig ran its own GUI-to-raw mapping instead of the adapter re-deriving it.
  check("gui and raw evaluation are different paths", () => {
    const guiCase = vectors.cases.find((item) => item.name === "mixed_gui_lod0");
    const rawCase = vectors.cases.find((item) => item.name === "mixed_raw_lod0");
    if (guiCase === undefined || rawCase === undefined) {
      record("gui and raw evaluation are different paths", "the vector file lost its mixed cases");
      return undefined;
    }
    metahuman.setLod(rig, 0);
    metahuman.setGui(rig, Float32Array.from(guiCase.values));
    metahuman.evaluate(rig, true);
    const viaGui = Array.from(metahuman.jointOutputs(rig));
    metahuman.setRaw(rig, Float32Array.from(rawCase.values));
    metahuman.evaluate(rig, false);
    const viaRaw = Array.from(metahuman.jointOutputs(rig));
    if (viaGui.length !== viaRaw.length)
      return "the two paths disagree on output width";
    if (viaGui.every((value, index) => value === viaRaw[index]))
      return "the GUI and raw paths produced identical output for the same control values";
    return undefined;
  });

  check("a returned output is a copy, never a view over the rig", () => {
    const first = metahuman.jointOutputs(rig);
    const second = metahuman.jointOutputs(rig);
    if (first === second) return "two reads returned the same array object";
    const before = first[0];
    first[0] = before + 12345;
    if (metahuman.jointOutputs(rig)[0] !== before)
      return "mutating a returned copy reached back into the rig";
    return undefined;
  });

  const guiCount = metahuman.count(rig, KINDS.gui[1]);
  throws("a wrong-length control buffer is refused", "TN_NATIVE_METAHUMAN", () =>
    metahuman.setGui(rig, new Float32Array(guiCount + 1)),
  );
  throws("a short control buffer is refused", "TN_NATIVE_METAHUMAN", () =>
    metahuman.setGui(rig, new Float32Array(guiCount - 1)),
  );
  throws("a non-finite control value is refused", "TN_NATIVE_METAHUMAN", () => {
    const values = new Float32Array(guiCount);
    values[0] = Number.NaN;
    metahuman.setGui(rig, values);
  });
  throws("a non-finite raw control value is refused", "TN_NATIVE_METAHUMAN", () => {
    const values = new Float32Array(metahuman.count(rig, KINDS.raw[1]));
    values[values.length - 1] = Number.POSITIVE_INFINITY;
    metahuman.setRaw(rig, values);
  });
  throws("a wrong-typed control buffer is refused", "TN_NATIVE_METAHUMAN", () =>
    metahuman.setGui(rig, new Float64Array(guiCount)),
  );
  throws("a non-ArrayBuffer DNA argument is refused", "TN_NATIVE_METAHUMAN", () =>
    metahuman.create("not dna"),
  );
  throws("an out-of-range kind selector is refused", "TN_NATIVE_METAHUMAN", () =>
    metahuman.count(rig, 99),
  );
  throws("a LOD past the rig's own count is refused", "TN_NATIVE_METAHUMAN", () =>
    metahuman.setLod(rig, metahuman.count(rig, KINDS.lod[1])),
  );

  // A retired id must never resolve to the rig created after it, even when the allocator hands
  // back the same address.
  const retired = metahuman.create(__tnDna);
  const live = metahuman.create(__tnDna);
  if (!(retired > 0) || !(live > 0) || retired === live)
    record("handle allocation", "ids are " + retired + " and " + live);
  metahuman.destroy(retired);
  throws("a destroyed rig's id cannot be counted", "stale handle", () =>
    metahuman.count(retired, KINDS.joint[1]),
  );
  throws("a destroyed rig's id cannot be evaluated", "stale handle", () =>
    metahuman.evaluate(retired, false),
  );
  throws("a destroyed rig's id cannot be read", "stale handle", () =>
    metahuman.jointOutputs(retired),
  );
  check("the live rig still works after a neighbour was destroyed", () => {
    metahuman.setLod(live, 0);
    metahuman.setRaw(live, new Float32Array(metahuman.count(live, KINDS.raw[1])));
    metahuman.evaluate(live, false);
    if (metahuman.count(live, KINDS.joint[1]) !== reference.counts.joint)
      return "the live rig's joint count changed";
    return compare(
      metahuman.jointOutputs(live),
      byName.get("neutral_raw_lod0").joints,
      "live-after-neighbour-destroyed",
    );
  });
  metahuman.destroy(retired); // a second destroy is a no-op, never a double free
  metahuman.destroy(live);
  throws("a twice-destroyed rig stays retired", "stale handle", () =>
    metahuman.count(live, KINDS.joint[1]),
  );
  metahuman.destroy(rig);

  // Every rig this process created is gone, and a create/destroy cycle is repeatable: the ABI's
  // own registry is the number a leak would move.
  check("ten create and destroy cycles return the live handle count to baseline", () => {
    if (typeof metahuman.liveCount !== "function")
      return "the host does not report a live handle count";
    const baseline = metahuman.liveCount();
    const created = [];
    for (let index = 0; index < 10; index += 1) {
      const id = metahuman.create(__tnDna);
      if (typeof id !== "number" || id < 1) return "create " + index + " returned " + id;
      created.push(id);
    }
    const grown = metahuman.liveCount() - baseline;
    if (grown !== 10) return "ten creates moved the live count by " + grown;
    for (const id of created) metahuman.destroy(id);
    const left = metahuman.liveCount() - baseline;
    if (left !== 0) return left + " rigs survived their destroy";
    // A retired id from a cycle is still retired, so the ids were really freed.
    throws("a cycle's id stays retired", "stale handle", () =>
      metahuman.count(created[0], KINDS.joint[1]),
    );
    return undefined;
  });

  __tnDetail("max |error| " + worstError + " at " + worstWhere);
  __tnReport(failures.length === 0 ? "ok" : failures.join("\n"));
  return undefined;
})())JS";

bool readFile(const char *path, std::string &out) {
  std::ifstream stream(path, std::ios::binary);
  if (!stream)
    return false;
  std::ostringstream buffer;
  buffer << stream.rdbuf();
  out = buffer.str();
  return true;
}

} // namespace

int main() {
  auto engine = mystral::js::createEngine();
  if (engine == nullptr) {
    std::cerr << "could not create a JavaScript engine\n";
    return 1;
  }
  std::cout << "engine: " << engine->getName() << '\n';
  if (!mystral::metahuman::initializeNativeMetaHumanBindings(engine.get())) {
    std::cerr << "initializeNativeMetaHumanBindings failed\n";
    return 1;
  }

  std::string dna;
  std::string vectors;
  std::string reference;
  if (!readFile(THREENATIVE_METAHUMAN_DNA, dna) ||
      !readFile(THREENATIVE_METAHUMAN_VECTORS, vectors) ||
      !readFile(THREENATIVE_METAHUMAN_REFERENCE, reference)) {
    std::cerr << "a metahuman fixture is missing; the comparison has no observation to make\n";
    return 1;
  }

  std::string report;
  std::string detail;
  auto *raw = engine.get();
  raw->setGlobalProperty(
      "__tnReport",
      raw->newFunction("__tnReport",
                       [raw, &report](void *,
                                      const std::vector<mystral::js::JSValueHandle> &args) {
                         if (!args.empty() && raw->isString(args[0]))
                           report = raw->toString(args[0]);
                         return raw->newUndefined();
                       }));
  raw->setGlobalProperty(
      "__tnDetail",
      raw->newFunction("__tnDetail",
                       [raw, &detail](void *,
                                      const std::vector<mystral::js::JSValueHandle> &args) {
                         if (!args.empty() && raw->isString(args[0]))
                           detail = raw->toString(args[0]);
                         return raw->newUndefined();
                       }));
  raw->setGlobalProperty("__tnVectors", raw->newString(vectors.c_str()));
  raw->setGlobalProperty("__tnReference", raw->newString(reference.c_str()));
  raw->setGlobalProperty(
      "__tnDna", raw->createUint8Array(reinterpret_cast<const uint8_t *>(dna.data()), dna.size()));

  engine->evalWithResult(kScript, "metahuman_bindings_test.js");

  if (report.empty()) {
    std::cerr << "the script did not reach its report";
    if (engine->hasException())
      std::cerr << ": " << engine->getException();
    std::cerr << '\n';
    return 1;
  }
  if (report != "ok") {
    std::cerr << "native metahuman bindings failed:\n" << report << '\n';
    return 1;
  }
  if (!detail.empty()) std::cout << "native metahuman " << detail << '\n';

  std::cout << "native metahuman bindings passed\n";
  return 0;
}
