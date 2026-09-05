#!/usr/bin/env bash
set -euo pipefail

readonly PINNED_COMMIT="1b33fd5098c6e7b58324146b8f5518cbb4cdfb72"
readonly EMSDK_IMAGE="emscripten/emsdk@sha256:27bc6267cb285223b8aebb7627bfebae7cb3ad2aaa0d5923b8aa5321793033e8"
readonly EXPECTED_JS_SHA256="059621ec63379c496ac93814f53afc6c7065ecdf6291b2ac8db951cb7bac4c64"
readonly EXPECTED_WASM_SHA256="f020c8ed7d2ccadf752c0e64b86195f09e0bfeacc2de3d94b28c89ea72ce5bd5"
readonly PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${BASIS_UNIVERSAL_DIR:-}" ]]; then
  echo "Set BASIS_UNIVERSAL_DIR to a Basis Universal checkout at ${PINNED_COMMIT}." >&2
  exit 1
fi
if [[ "$(git -C "${BASIS_UNIVERSAL_DIR}" rev-parse HEAD)" != "${PINNED_COMMIT}" ]]; then
  echo "BASIS_UNIVERSAL_DIR must be checked out exactly at ${PINNED_COMMIT}." >&2
  exit 1
fi

readonly BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/threenative-basis-encoder.XXXXXX")"
trap 'rm -rf "${BUILD_ROOT}"' EXIT
mkdir -p "${BUILD_ROOT}/source"
git -C "${BASIS_UNIVERSAL_DIR}" archive "${PINNED_COMMIT}" | tar -x -C "${BUILD_ROOT}/source"
patch -s -d "${BUILD_ROOT}/source" -p1 < "${PACKAGE_ROOT}/scripts/basis-encoder-16m.patch"

docker run --rm \
  --env "HOST_GID=$(id -g)" \
  --env "HOST_UID=$(id -u)" \
  --volume "${BUILD_ROOT}/source:/src" \
  --workdir /src \
  "${EMSDK_IMAGE}" \
  bash -lc 'set -euo pipefail
    test "$(emcc --version | head -n1 | grep -oE "[0-9]+\.[0-9]+\.[0-9]+" | head -n1)" = "4.0.15"
    export SOURCE_DATE_EPOCH=1783281974
    emcmake cmake -S webgl/encoder -B /src/build \
      -DCMAKE_BUILD_TYPE=Release \
      -DKTX2_ZSTANDARD=ON \
      -DSUPPORT_ASTCENC=OFF \
      -DCMAKE_EXE_LINKER_FLAGS="-s EXPORT_ES6=1"
    cmake --build /src/build --target basis_encoder.js -j"$(nproc)"
    chown -R "${HOST_UID}:${HOST_GID}" /src/build'

echo "${EXPECTED_JS_SHA256}  ${BUILD_ROOT}/source/build/basis_encoder.js" | sha256sum --check
echo "${EXPECTED_WASM_SHA256}  ${BUILD_ROOT}/source/build/basis_encoder.wasm" | sha256sum --check
for artifact in basis_encoder.js basis_encoder.wasm; do
  cp "${BUILD_ROOT}/source/build/${artifact}" "${PACKAGE_ROOT}/vendor/basis-encoder/${artifact}"
  chmod 0644 "${PACKAGE_ROOT}/vendor/basis-encoder/${artifact}"
done
