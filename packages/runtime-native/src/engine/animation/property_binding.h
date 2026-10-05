#pragma once

#include <cstddef>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "engine/scene/object3d.h"

namespace tn::engine::animation {

/** three's `PropertyBinding.parseTrackName` result; an absent part is three's `undefined`. */
struct ParsedPath {
    std::optional<std::string> nodeName, objectName, objectIndex;
    std::string propertyName;
    std::optional<std::string> propertyIndex;
};

/** three's `parseTrackName`: false, with three's message in `error`, where three throws. */
bool parseTrackName(std::string_view trackName, ParsedPath& out, std::string& error);

/**
 * three's `PropertyBinding.findNode`: the root itself for no name, "" or "." or the root's name,
 * else the first descendant with that name in three's depth-first order. The native object has no
 * `uuid` and no skeleton yet (PRD-518), so a name is only ever matched against `name`.
 */
Object3D* findNode(Object3D& root, const std::optional<std::string>& nodeName);

/**
 * three's `PropertyBinding` for an object's transform and visibility: `position`, `quaternion`,
 * `scale` (whole, or one component as `[x]`), and `visible`. Like three, it binds on the first get
 * or set after construction or `unbind()`, and the node it found stays bound until `unbind()`, even
 * after it leaves the root; the next bind searches again.
 * A path three would bind but the engine does not carry yet (an object name such as `material`,
 * another property) leaves the binding unavailable with TN_NATIVE_ANIMATION_TRACK_UNSUPPORTED in
 * `diagnostic`; an unavailable binding's get and set do nothing, as three's do.
 */
class PropertyBinding {
  public:
    PropertyBinding(const std::shared_ptr<Object3D>& root, std::string path);

    void bind();
    void unbind();
    [[nodiscard]] bool bound() const { return target_ != Target::Unavailable; }

    void getValue(double* buffer, std::size_t offset);
    void setValue(const double* buffer, std::size_t offset);

    const std::string path;
    /** Why the last bind left this unavailable, empty when it bound. */
    std::string diagnostic;

  private:
    enum class Target { Unavailable, Position, Quaternion, Scale, Component, Visible };

    std::weak_ptr<Object3D> root_;
    std::weak_ptr<Object3D> node_;
    ParsedPath parsed_;
    bool parsedOk_ = false;
    bool bindAttempted_ = false; // three's `_getValue_unbound`: the first get or set binds
    Target target_ = Target::Unavailable;
    Vector3 Object3D::* vector_ = nullptr; // the vector a component binding writes
    int component_ = 0;
};

} // namespace tn::engine::animation
