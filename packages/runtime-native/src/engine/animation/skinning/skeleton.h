#pragma once

// Bone and Skeleton, ported from three@0.185.1 src/objects/Bone.js and src/objects/Skeleton.js
// (PRD-518 phase 1). A Bone is an Object3D marked for the rig; a Skeleton folds each bone's current
// world matrix against its inverse bind matrix into a flat float32 palette.
//
// The palette math is three's, bit for bit: each slot is `bone.matrixWorld * boneInverse`, and a
// missing bone (three's `undefined` in the bones array) contributes the identity instead. The
// matrices come from the existing Matrix4, so the fold is the same product three computes.
//
// Not ported, and why:
//   - `computeBoneTexture`, `dispose`, `boneTexture`: the GPU data texture is a renderer concern
//     (PRD-514/519), not the object model.
//   - `clone`, `fromJSON`, `toJSON`, `uuid`: serialization and cloning are out of scope, as in
//     Object3D.
//   - `warn` on a bone/inverse length mismatch: the native init rebuilds the identity list three's
//     warn accompanies, without the console line.
//   - `Skeleton` is neither copyable nor movable, matching its per-instance palette buffer.

#include <cstddef>
#include <memory>
#include <string_view>
#include <vector>

#include "engine/foundation/math/Matrix.h"
#include "engine/scene/object3d.h"

namespace tn::engine {

/** three's Bone: an Object3D whose `type` is "Bone" and whose `isBone` flag is true. */
class Bone : public Object3D {
  public:
    Bone() = default;
    Bone(const Bone&) = delete;
    Bone& operator=(const Bone&) = delete;

    [[nodiscard]] std::string_view type() const override { return "Bone"; }

    /** three's `isBone`, the flag `Skeleton.pose` reads on a parent. */
    bool isBone = true;
};

/**
 * three's Skeleton. `bones` holds one shared Bone per slot; a null slot is three's `undefined`
 * entry, which `calculateInverses`, `pose` and `update` all skip or fill with the identity.
 */
class Skeleton {
  public:
    Skeleton() = default;
    /**
     * `bones` is copied, as three's `bones.slice(0)`; `boneInverses` empty means "compute them",
     * exactly three's `boneInverses.length === 0` branch.
     */
    explicit Skeleton(std::vector<std::shared_ptr<Bone>> bones, std::vector<Matrix4> boneInverses = {});
    Skeleton(const Skeleton&) = delete;
    Skeleton& operator=(const Skeleton&) = delete;

    /** Rebuilds the flat palette buffer, then computes or validates the inverses, as three's `init`. */
    void init();
    /** Fills `boneInverses` from each bone's current `matrixWorld`; a null bone gets the identity. */
    void calculateInverses();
    /** Restores the bind pose into every bone's `matrixWorld`, local `matrix` and decomposed TRS. */
    void pose();
    /** Folds each bone's `matrixWorld` with its inverse into `boneMatrices`, as float32. */
    void update();
    /** The first bone whose name matches, or null. A null slot is skipped, never dereferenced. */
    [[nodiscard]] Bone* getBoneByName(std::string_view name) const;

    std::vector<std::shared_ptr<Bone>> bones;
    std::vector<Matrix4> boneInverses;
    /** `bones.size() * 16` floats, column-major per slot, three's flat `boneMatrices`. */
    std::vector<float> boneMatrices;
};

} // namespace tn::engine
