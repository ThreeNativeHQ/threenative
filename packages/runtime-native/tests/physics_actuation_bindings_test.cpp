// PRD-116 criterion 1 and 4: execute the path a native game takes to actuation.
//
// Rust tests prove the Simulation and native:build proves the C entry points link. This test
// drives the installed JavaScript host, so an impulse crosses JS -> binding -> C ABI -> Rapier
// and the fail-closed status mapping is observed at the same boundary a game uses.

#include "mystral/js/engine.h"
#include "mystral/physics/native_bindings.h"

#include <iostream>
#include <memory>
#include <string>
#include <vector>

namespace {

constexpr const char *kScript = R"JS((() => {
  const failures = [];
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

  const host = globalThis.__THREENATIVE_NATIVE__;
  if (host === undefined || host.physics === undefined) {
    __tnReport("the physics host was not installed");
    return undefined;
  }

  const TRANSFORM_WIDTH = 8;
  const positionOf = (simulation, id, bodyCount) => {
    const buffer = new Float32Array(bodyCount * TRANSFORM_WIDTH);
    const count = simulation.readVisibleTransforms(buffer);
    for (let index = 0; index < count; index += 1) {
      const offset = index * TRANSFORM_WIDTH;
      if (buffer[offset] === id)
        return [buffer[offset + 1], buffer[offset + 2], buffer[offset + 3]];
    }
    return undefined;
  };
  const dynamicSphere = (x) => ({
    collisionLayer: 1,
    collisionMask: 0xffff,
    mass: 1,
    position: { x, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    sensor: false,
    shape: { kind: "sphere", x: 0.5, y: 0, z: 0 },
    type: "dynamic",
  });

  const simulation = host.physics.createSimulation({ gravity: { x: 0, y: 0, z: 0 } });
  const dynamic = simulation.createBody(dynamicSphere(0));
  const fixed = simulation.createBody({ ...dynamicSphere(5), mass: 0, type: "fixed" });

  check("impulse moves a dynamic body", () => {
    const before = positionOf(simulation, dynamic, 2);
    if (before === undefined) return "the body was not visible before the impulse";
    simulation.applyBodyImpulse(dynamic, { x: 2, y: 0, z: 0 });
    simulation.step(1 / 60);
    const after = positionOf(simulation, dynamic, 2);
    if (after === undefined) return "the body was not visible after the impulse";
    if (!(after[0] > before[0]))
      return "x did not increase: before=" + before[0] + " after=" + after[0];
    return undefined;
  });

  check("linear velocity round-trips", () => {
    simulation.setBodyLinearVelocity(dynamic, { x: 4, y: -2, z: 1 });
    const velocity = simulation.readBodyLinearVelocity(dynamic);
    if (velocity.x !== 4 || velocity.y !== -2 || velocity.z !== 1)
      return "read back " + JSON.stringify(velocity);
    return undefined;
  });

  check("force accumulates into motion", () => {
    simulation.setBodyLinearVelocity(dynamic, { x: 0, y: 0, z: 0 });
    const before = positionOf(simulation, dynamic, 2);
    for (let step = 0; step < 30; step += 1) {
      simulation.applyBodyForce(dynamic, { x: 0, y: 0, z: 20 });
      simulation.step(1 / 60);
    }
    const after = positionOf(simulation, dynamic, 2);
    if (!(after[2] - before[2] > 0.5))
      return "z moved only " + (after[2] - before[2]);
    return undefined;
  });

  throws("a fixed body refuses an impulse", "TN_PHYSICS_NOT_DYNAMIC", () =>
    simulation.applyBodyImpulse(fixed, { x: 1, y: 0, z: 0 }),
  );
  throws("an unknown body refuses a force", "TN_PHYSICS_UNKNOWN_BODY", () =>
    simulation.applyBodyForce(4096, { x: 1, y: 0, z: 0 }),
  );
  throws("a non-finite impulse is refused", "TN_PHYSICS_NON_FINITE", () =>
    simulation.applyBodyImpulse(dynamic, { x: Number.NaN, y: 0, z: 0 }),
  );
  throws("a non-finite velocity is refused", "TN_PHYSICS_NON_FINITE", () =>
    simulation.setBodyLinearVelocity(dynamic, { x: 0, y: Number.POSITIVE_INFINITY, z: 0 }),
  );
  throws("reading a non-dynamic velocity is refused", "TN_PHYSICS_NOT_DYNAMIC", () =>
    simulation.readBodyLinearVelocity(fixed),
  );

  check("continuous collision reaches native Rapier", () => {
    const ccdSimulation = host.physics.createSimulation({ gravity: { x: 0, y: 0, z: 0 } });
    const ccdWall = ccdSimulation.createBody({
      collisionLayer: 32,
      collisionMask: 32,
      continuousCollision: true,
      mass: 0,
      position: { x: 0, y: 0, z: 0 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      sensor: false,
      shape: { kind: "box", x: 0.05, y: 2, z: 2 },
      type: "fixed",
    });
    const ccdProjectile = ccdSimulation.createBody({
      collisionLayer: 32,
      collisionMask: 32,
      continuousCollision: true,
      mass: 1,
      position: { x: -1, y: 0, z: 0 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      sensor: false,
      shape: { kind: "sphere", x: 0.05, y: 0, z: 0 },
      type: "dynamic",
    });
    const discreteProjectile = ccdSimulation.createBody({
      collisionLayer: 32,
      collisionMask: 32,
      continuousCollision: false,
      mass: 1,
      position: { x: -1, y: 0, z: 0.5 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      sensor: false,
      shape: { kind: "sphere", x: 0.05, y: 0, z: 0 },
      type: "dynamic",
    });
    ccdSimulation.setBodyLinearVelocity(ccdProjectile, { x: 120, y: 0, z: 0 });
    ccdSimulation.setBodyLinearVelocity(discreteProjectile, { x: 120, y: 0, z: 0 });
    ccdSimulation.step(1 / 60);
    const ccdPosition = positionOf(ccdSimulation, ccdProjectile, 3);
    const discretePosition = positionOf(ccdSimulation, discreteProjectile, 3);
    if (ccdPosition === undefined || discretePosition === undefined)
      return "one of the projectiles was not visible after the step";
    if (!(ccdPosition[0] < 0)) return "continuous projectile passed the wall";
    if (!(discretePosition[0] > 0.1)) return "discrete control did not pass the wall";
    ccdSimulation.dispose();
    return undefined;
  });

  simulation.dispose();
  throws("actuation after dispose is refused", "disposed", () =>
    simulation.applyBodyImpulse(dynamic, { x: 1, y: 0, z: 0 }),
  );
  throws("reading velocity after dispose is refused", "disposed", () =>
    simulation.readBodyLinearVelocity(dynamic),
  );

  __tnReport(failures.length === 0 ? "ok" : failures.join("\n"));
  return undefined;
})())JS";

} // namespace

int main() {
  auto engine = mystral::js::createEngine();
  if (engine == nullptr) {
    std::cerr << "could not create a JavaScript engine\n";
    return 1;
  }
  std::cout << "engine: " << engine->getName() << '\n';
  if (!mystral::physics::initializeNativePhysicsBindings(engine.get())) {
    std::cerr << "initializeNativePhysicsBindings failed\n";
    return 1;
  }

  std::string report;
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

  engine->evalWithResult(kScript, "physics_actuation_bindings_test.js");

  if (report.empty()) {
    std::cerr << "the script did not reach its report";
    if (engine->hasException())
      std::cerr << ": " << engine->getException();
    std::cerr << '\n';
    return 1;
  }
  if (report != "ok") {
    std::cerr << "native physics actuation bindings failed:\n" << report << '\n';
    return 1;
  }

  std::cout << "native physics actuation bindings passed\n";
  return 0;
}
