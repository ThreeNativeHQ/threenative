// PRD-516 phase 2: the mixer against the pinned three. The clips, the timeline of operations and the
// frame deltas are generated tables (packages/three-native/tests/animation/animation-reference.ts);
// this test replays them on the native mixer and compares, every fifth frame, every node's
// transform, every action's time, effective weight and time scale, its flags and the mixer's stats,
// bit for bit, and every `loop` and `finished` event with its frame (10 s of irregular steps).
#include "check.h"
#include "engine/animation/mixer.h"

#include <bit>
#include <cinttypes>
#include <cstdlib>
#include <cstdio>
#include <iterator>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

using namespace tn::engine;
using namespace tn::engine::animation;

namespace {

struct TrackSpec {
    int clip;
    const char* name;
    TrackType type;
    Interpolation interpolation;
    const double* times;
    std::size_t timeCount;
    const double* values;
    std::size_t valueCount;
};
struct ClipSpec {
    const char* name;
    double duration;
    BlendMode blendMode;
};
struct OpSpec {
    int frame;
    const char* op;
    int action;
    double a, b, c;
};

#include "mixer_reference.inc"

std::string bits(double x) {
    char out[17];
    std::snprintf(out, sizeof out, "%016" PRIx64, std::bit_cast<uint64_t>(x));
    return out;
}

template <typename Array> std::string join(const Array& values) {
    std::string out;
    for (double v : values)
        out += (out.empty() ? "" : ",") + bits(v);
    return out;
}

struct Recorder {
    std::vector<std::string> events;
    int frame = 0;
};

void record(const MixerEvent& e, void* context) {
    auto& r = *static_cast<Recorder*>(context);
    r.events.push_back(std::to_string(r.frame) + ":" + std::string(e.type) + ":" + e.action->getClip().name + ":" +
                       std::to_string(e.direction) + ":" + bits(e.loopDelta));
}

std::size_t firstDifference(const std::vector<std::string>& got, const char* const* want, std::size_t wantCount,
                            const char* what) {
    std::size_t mismatched = got.size() == wantCount ? 0 : 1;
    if (mismatched)
        std::fprintf(stderr, "%s: native has %zu, three has %zu\n", what, got.size(), wantCount);
    for (std::size_t i = 0; i < got.size() && i < wantCount; ++i) {
        if (got[i] == want[i])
            continue;
        if (mismatched++ < 4) {
            std::size_t at = 0;
            while (at < got[i].size() && got[i][at] == want[i][at])
                ++at;
            const std::size_t from = got[i].rfind('|', at) == std::string::npos ? 0 : got[i].rfind('|', at) + 1;
            std::fprintf(stderr, "%s %zu (%.6s): native %.110s\n%*s  three  %.110s\n", what, i, got[i].c_str(),
                         got[i].c_str() + from, static_cast<int>(std::string_view(what).size() + 12), "",
                         want[i] + from);
        }
    }
    return mismatched;
}

struct Replay {
    std::vector<std::string> poses, events;
};

// The whole scenario, once per process: both cases read the same replay.
const Replay& replay() {
    static const Replay result = [] {
        const auto named = [](const char* name) {
            auto object = std::make_shared<Object3D>();
            object->name = name;
            return object;
        };
        auto rig = named("rig"), hips = named("hips"), spine = named("spine"), head = named("head"),
             prop = named("prop");
        rig->add(*hips);
        rig->add(*prop);
        hips->add(*spine);
        spine->add(*head);
        const std::shared_ptr<Object3D> nodes[] = {rig, hips, spine, head, prop};

        std::vector<std::shared_ptr<const AnimationClip>> clips;
        for (std::size_t ci = 0; ci < std::size(kClips); ++ci) {
            std::vector<KeyframeTrack> tracks;
            for (const TrackSpec& t : kTracks) {
                if (t.clip != static_cast<int>(ci))
                    continue;
                tracks.emplace_back(t.name, t.type, std::vector<double>(t.times, t.times + t.timeCount),
                                    std::vector<double>(t.values, t.values + t.valueCount), t.interpolation);
            }
            clips.push_back(std::make_shared<AnimationClip>(kClips[ci].name, kClips[ci].duration, std::move(tracks),
                                                            kClips[ci].blendMode));
        }
        AnimationMixer mixer(rig);
        std::vector<AnimationAction*> actions;
        for (const auto& clip : clips)
            actions.push_back(mixer.clipAction(clip));
        Recorder recorder;
        mixer.addEventListener("finished", record, &recorder);
        mixer.addEventListener("loop", record, &recorder);

        const Loop loops[] = {Loop::Once, Loop::Repeat, Loop::PingPong};
        const auto apply = [&](const OpSpec& o) {
            AnimationAction& action = *actions[static_cast<std::size_t>(o.action)];
            const std::string_view op = o.op;
            AnimationAction* other = o.a >= 0 && o.a < static_cast<double>(actions.size())
                                         ? actions[static_cast<std::size_t>(o.a)]
                                         : nullptr;
            if (op == "play")
                action.play();
            else if (op == "stop")
                action.stop();
            else if (op == "reset")
                action.reset();
            else if (op == "fadeIn")
                action.fadeIn(o.a);
            else if (op == "fadeOut")
                action.fadeOut(o.a);
            else if (op == "crossFadeFrom")
                action.crossFadeFrom(*other, o.b, o.c == 1);
            else if (op == "crossFadeTo")
                action.crossFadeTo(*other, o.b, o.c == 1);
            else if (op == "halt")
                action.halt(o.a);
            else if (op == "warp")
                action.warp(o.a, o.b, o.c);
            else if (op == "setLoop")
                action.setLoop(loops[static_cast<int>(o.a)], o.b);
            else if (op == "clamp")
                action.clampWhenFinished = o.a == 1;
            else if (op == "weight")
                action.weight = o.a;
            else if (op == "timeScale")
                action.timeScale = o.a;
            else if (op == "setEffectiveWeight")
                action.setEffectiveWeight(o.a);
            else if (op == "setEffectiveTimeScale")
                action.setEffectiveTimeScale(o.a);
            else if (op == "setDuration")
                action.setDuration(o.a);
            else if (op == "syncWith")
                action.syncWith(*other);
            else if (op == "startAt")
                action.startAt(mixer.time + o.a);
            else if (op == "zeroSlope") {
                action.zeroSlopeAtStart = o.a == 1;
                action.zeroSlopeAtEnd = o.b == 1;
            } else if (op == "mixerTimeScale")
                mixer.timeScale = o.a;
            else if (op == "mixerSetTime")
                mixer.setTime(o.a);
            else if (op == "stopAll")
                mixer.stopAllAction();
            else if (op == "uncacheAction")
                mixer.uncacheAction(*clips[static_cast<std::size_t>(o.action)]);
            else {
                std::fprintf(stderr, "unknown op %s\n", o.op);
                std::abort();
            }
        };

        std::vector<std::string> poses;
        const auto flag = [](bool x) { return x ? "1" : "0"; };
        for (int frame = 0; frame < static_cast<int>(std::size(kDeltas)); ++frame) {
            recorder.frame = frame;
            for (const OpSpec& o : kOps)
                if (o.frame == frame)
                    apply(o);
            mixer.update(kDeltas[frame]);
            if (frame % 5 != 4)
                continue;
            std::string out = "f" + std::to_string(frame) + "|t=" + bits(mixer.time);
            for (const auto& o : nodes)
                out += "|" + o->name + ":p=" + join(o->position.toArray()) + ";q=" + join(o->quaternion.toArray()) +
                       ";s=" + join(o->scale.toArray());
            for (std::size_t i = 0; i < actions.size(); ++i) {
                const AnimationAction& a = *actions[i];
                out += "|a" + std::to_string(i) + ":t=" + bits(a.time) + ";w=" + bits(a.getEffectiveWeight()) +
                       ";ts=" + bits(a.getEffectiveTimeScale()) + ";e=" + flag(a.enabled) + ";p=" + flag(a.paused) +
                       ";r=" + flag(a.isRunning()) + ";s=" + flag(a.isScheduled());
            }
            out += "|stats=" + std::to_string(mixer.actionsTotal()) + "," + std::to_string(mixer.actionsInUse()) + "," +
                   std::to_string(mixer.bindingsTotal()) + "," + std::to_string(mixer.bindingsInUse()) + "," +
                   std::to_string(mixer.controlInterpolantsTotal()) + "," +
                   std::to_string(mixer.controlInterpolantsInUse());
            poses.push_back(out);
        }
        return Replay{poses, recorder.events};
    }();
    return result;
}

// Loop modes, clampWhenFinished, weights, additive blending, fades and warps: the pose dumps.
void mixer() {
    const Replay& r = replay();
    const std::size_t diffs = firstDifference(r.poses, kSamples, std::size(kSamples), "sample");
    std::printf("mixer: %zu samples, %zu differ\n", r.poses.size(), diffs);
    CHECK(diffs == 0);
}

// `loop` and `finished`: type, action, direction or loop delta, and the frame each fired on.
void events() {
    const Replay& r = replay();
    const std::size_t diffs = firstDifference(r.events, kEvents, std::size(kEvents), "event");
    std::printf("events: %zu, %zu differ\n", r.events.size(), diffs);
    CHECK(diffs == 0);
}

} // namespace

TN_TEST_MAIN({"mixer", mixer}, {"events", events})
