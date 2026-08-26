#pragma once

#include <memory>
#include <type_traits>
#include <utility>
#include <vector>

namespace mystral::webgpu {

// A render-pass wrapper is reusable only once the map no longer holds its previous native pass.
// The wrapper type supplies `object`, `pass`, and `encoder`; the caller supplies the handle-specific
// fresh test because JavaScript handles and native test handles intentionally have different shapes.
template <typename Wrapper, typename RenderPassMap, typename IsFresh>
Wrapper* acquireRenderPassWrapper(
    std::vector<std::unique_ptr<Wrapper>>& wrappers,
    const RenderPassMap& encoderRenderPassMap,
    IsFresh&& isFresh) {
    for (auto& candidate : wrappers) {
        if (isFresh(candidate->object)) return candidate.get();
        using Pass = std::remove_cvref_t<decltype(*candidate->pass)>;
        const Pass previousPass = candidate->pass ? *candidate->pass : Pass{};
        bool live = false;
        if (previousPass != Pass{}) {
            for (const auto& entry : encoderRenderPassMap) {
                if (entry.second == previousPass) {
                    live = true;
                    break;
                }
            }
        }
        if (!live) return candidate.get();
    }
    wrappers.push_back(std::make_unique<Wrapper>());
    return wrappers.back().get();
}

template <typename Wrapper, typename Pass, typename Encoder, typename SetPrivateData>
void rebindRenderPassWrapper(
    Wrapper& wrapper,
    Pass pass,
    Encoder encoder,
    SetPrivateData&& setPrivateData) {
    *wrapper.pass = pass;
    *wrapper.encoder = encoder;
    std::forward<SetPrivateData>(setPrivateData)(wrapper.object, pass);
}

template <typename Wrapper, typename FreeObject>
void discardFreshRenderPassWrapper(
    Wrapper& wrapper,
    bool fresh,
    FreeObject&& freeObject) {
    if (!fresh) return;
    std::forward<FreeObject>(freeObject)(wrapper.object);
    wrapper.object = {};
}

}  // namespace mystral::webgpu
