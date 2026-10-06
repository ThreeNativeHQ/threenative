// The native-engine desktop player (PRD-529 phase 2): an SDL window on the display the playtest
// runner provides, the engine's fixed-step clock, the render database into the renderer, the
// presentation of that frame, and the mailbox the runner talks to. No JS engine is linked: the game
// is inspect-demo, in C++. A game bundle on V8 is the sibling tn-native-engine-player-v8.
#include <cstdio>
#include <string>

#include "engine/inspect/endpoint.h"
#include "engine/player/demo.h"
#include "engine/player/skinned_crowd.h"
#include "engine/player/run.h"

using namespace tn::engine;

int main(int argc, char** argv) {
    // The first argument selects the built-in C++ game.
    const std::string game = argc > 1 && argv[1][0] != '\0' ? argv[1] : "inspect-demo";
    if (game == "skinned-crowd") {
        player::SkinnedCrowd crowd;
        player::Game configured;
        configured.name = game;
        configured.scene = &crowd.scene();
        configured.camera = &crowd.camera();
        configured.shadowMapEnabled = true;
        configured.update = [&crowd](double dt) { crowd.update(dt); };
        return player::run(configured);
    }
    if (game != "inspect-demo") {
        std::printf("TN_PLAYER_UNKNOWN_GAME: %s; this player builds inspect-demo and skinned-crowd.\n", game.c_str());
        return 1;
    }

    player::InspectDemo demo(game);
    player::Game configured;
    configured.name = demo.name();
    configured.scene = &demo.scene();
    configured.camera = &demo.camera();
    configured.gameRuntime = "cpp";
    configured.update = [&demo](double dt) { demo.update(dt); };
    // The state snapshot a scenario compares across labelled steps, and the input latch the
    // per-tick callback fills. The profile is the loop's own.
    configured.resource = [&demo](const std::string& id, uint64_t tick) -> json::Value {
        if (id == "state") {
            const Vector3 at = demo.scene().getObjectByName("player")->position;
            return json::Value::makeObject({{"playerX", json::Value::makeNumber(at.x)},
                                            {"playerY", json::Value::makeNumber(at.y)},
                                            {"playerZ", json::Value::makeNumber(at.z)},
                                            {"tick", json::Value::makeNumber(double(tick))}});
        }
        if (id == "input") {
            const player::InspectDemo::InputLatch& latch = demo.inputLatch();
            return json::Value::makeObject({{"key", json::Value::makeString(latch.key)},
                                            {"latched", json::Value::makeBool(latch.latched)},
                                            {"injectedTick", json::Value::makeNumber(double(latch.injectedTick))},
                                            {"seenTick", json::Value::makeNumber(double(latch.seenTick))}});
        }
        return json::Value::makeNull();
    };
    configured.attach = [&demo](inspect::Endpoint& endpoint) { demo.attachEndpoint(endpoint); };
    return player::run(configured);
}
