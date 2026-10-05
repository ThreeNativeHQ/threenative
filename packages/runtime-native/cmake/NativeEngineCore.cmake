# Portable native engine core (PRD-499): targets with no platform API, GPU or VM, and their CPU
# tests. The host build includes it through NativeEngine.cmake; an Emscripten build includes it
# alone, which is the guard that the core stays Wasm-safe (owner decision 4).

option(TN_ENGINE_SANITIZE "Build the native engine targets under ASan and UBSan" OFF)
option(TN_ENGINE_TSAN "Build the native engine targets under ThreadSanitizer (a separate build: TSan excludes ASan)" OFF)
function(tn_native_engine_target target)
    set_target_properties(${target} PROPERTIES CXX_STANDARD 20 CXX_STANDARD_REQUIRED ON POSITION_INDEPENDENT_CODE ON)
    # PRD-501 §6.3: the engine targets are compared against a JavaScript oracle in binary64, so the
    # compiler must not fuse a multiply and an add into one rounded FMA. No fast-math anywhere.
    if(NOT MSVC)
        target_compile_options(${target} PRIVATE -ffp-contract=off)
    endif()
    if(TN_ENGINE_SANITIZE)
        target_compile_options(${target} PRIVATE -fsanitize=address,undefined -fno-sanitize-recover=undefined -fno-omit-frame-pointer)
        target_link_options(${target} PRIVATE -fsanitize=address,undefined)
    endif()
    if(TN_ENGINE_TSAN)
        target_compile_options(${target} PRIVATE -fsanitize=thread -fno-omit-frame-pointer)
        target_link_options(${target} PRIVATE -fsanitize=thread)
    endif()
    set_property(GLOBAL APPEND PROPERTY TN_NATIVE_ENGINE_TARGETS ${target})
    if(TN_ENGINE_FUZZ)
        # Coverage counters in the engine code itself, or libFuzzer only sees its own harness.
        target_compile_options(${target} PRIVATE -fsanitize=fuzzer-no-link)
    endif()
    if(EMSCRIPTEN)
        # Owner decision 4: the core runs on a growing Wasm heap, never a fixed one.
        target_link_options(${target} PRIVATE -sALLOW_MEMORY_GROWTH=1)
    endif()
endfunction()

# Foundation: handles and math. Portable C++20 with no platform API, so the same sources
# compile for the browser port.
add_library(tn_engine_foundation STATIC
    src/engine/foundation/handles.cpp
    src/engine/foundation/buffers.cpp
    src/engine/foundation/reachability.cpp
    src/engine/foundation/members.cpp
    src/engine/foundation/math/Vector.cpp
    src/engine/foundation/math/Matrix.cpp
    src/engine/foundation/math/Quaternion.cpp
    src/engine/foundation/math/Euler.cpp
    src/engine/foundation/math/Color.cpp
    src/engine/foundation/math/Primitives.cpp
    src/engine/foundation/math/ieee754.cpp)
tn_native_engine_target(tn_engine_foundation)
target_include_directories(tn_engine_foundation PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)

# The N03 C ABI over the foundation: version handshake, contexts, generational object handles.
add_library(tn_engine_abi STATIC src/engine/abi/abi.cpp src/engine/abi/identity.cpp)
tn_native_engine_target(tn_engine_abi)
target_link_libraries(tn_engine_abi PUBLIC tn_engine_foundation tn_engine_bindings)
target_include_directories(tn_engine_abi PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)

# Scene graph, transforms and cameras (PRD-508 phases 1-2): Object3D, the node classes and the two
# projection cameras, on the ported math classes. Portable, so it joins the Wasm core.
add_library(tn_engine_scene STATIC src/engine/scene/object3d.cpp src/engine/scene/camera.cpp
    src/engine/scene/nodes.cpp src/engine/scene/geometry.cpp src/engine/scene/geometries.cpp
    src/engine/scene/material.cpp src/engine/scene/lights.cpp)
tn_native_engine_target(tn_engine_scene)
target_link_libraries(tn_engine_scene PUBLIC tn_engine_foundation)
target_include_directories(tn_engine_scene PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)

# Shader IR (N08): typed, hash-consed expressions and ordered effects. Portable like foundation.
add_library(tn_engine_shader STATIC src/engine/shader/ir.cpp src/engine/shader/wgsl.cpp src/engine/shader/package.cpp
    src/engine/shader/standard.cpp src/engine/shader/tonemap.cpp src/engine/shader/output.cpp)
tn_native_engine_target(tn_engine_shader)
target_include_directories(tn_engine_shader PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src ${CMAKE_CURRENT_SOURCE_DIR}/include)

# Render graph (N14a): pass ordering, transient aliasing and temporal history. Pure CPU logic.
add_library(tn_engine_graph STATIC src/engine/renderer/graph/render_graph.cpp src/engine/renderer/graph/history.cpp)
tn_native_engine_target(tn_engine_graph)
target_include_directories(tn_engine_graph PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)

# Cooked asset packages (N10): the TNPK reader and its hash gate. Untrusted input, portable.
add_library(tn_engine_assets STATIC src/engine/assets/sha256.cpp src/engine/assets/package.cpp)
tn_native_engine_target(tn_engine_assets)
target_include_directories(tn_engine_assets PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)

# One executable per test file; each ctest names a case inside it.
function(tn_native_engine_test target source)
    add_executable(${target} EXCLUDE_FROM_ALL ${source})
    target_link_libraries(${target} PRIVATE tn_engine_foundation)
    target_include_directories(${target} PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests/native-engine)
    tn_native_engine_target(${target})
    foreach(case IN LISTS ARGN)
        string(REPLACE "=" ";" pair "${case}")
        list(GET pair 0 test_name)
        list(GET pair 1 case_name)
        # Naming the target (not its file) lets ctest prepend a cross-compiling emulator: node for Wasm.
        add_test(NAME ${test_name} COMMAND ${target} ${case_name})
        set_tests_properties(${test_name} PROPERTIES LABELS "native-engine")
        if(TN_ENGINE_SANITIZE)
            set_tests_properties(${test_name} PROPERTIES LABELS "native-engine;native-sanitizer")
        endif()
    endforeach()
    set_property(GLOBAL APPEND PROPERTY TN_NATIVE_ENGINE_TEST_TARGETS ${target})
endfunction()

tn_native_engine_test(tn-native-engine-handles-test tests/native-engine/handles_test.cpp
    native_engine_handles_generation=generation
    native_engine_handles_identity=identity)

tn_native_engine_test(tn-native-engine-buffers-test tests/native-engine/buffers_test.cpp
    native_engine_buffers_range=range
    native_engine_buffers_lease=lease
    native_engine_buffers_views=views
    native_engine_buffer_view_regrowth=view_regrowth)

tn_native_engine_test(tn-native-engine-lifetime-test tests/native-engine/lifetime_test.cpp
    native_engine_lifetime_detach=detach
    native_engine_lifetime_shared=shared
    native_engine_lifetime_cycles=cycles
    native_engine_lifetime_callback_cycle=callback_cycle
    native_engine_lifetime_soak=soak
    native_engine_reclaim_single_thread=single_thread)

tn_native_engine_test(tn-native-engine-shader-ir-test tests/native-engine/shader_ir_test.cpp
    native_engine_tsl_ir_order=order
    native_engine_tsl_ir_types=types
    native_engine_tsl_unsupported=unsupported)
target_link_libraries(tn-native-engine-shader-ir-test PRIVATE tn_engine_shader)

tn_native_engine_test(tn-native-engine-material-test tests/native-engine/material_test.cpp
    native_engine_material_unsupported=unsupported
    native_engine_material_standard_builds=builds)
target_link_libraries(tn-native-engine-material-test PRIVATE tn_engine_shader)

tn_native_engine_test(tn-native-engine-members-test tests/native-engine/members_test.cpp
    native_engine_alias_identity=identity
    native_engine_alias_growth=growth)

tn_native_engine_test(tn-native-engine-tonemap-test tests/native-engine/tonemap_test.cpp
    native_engine_tonemap_operators=operators)
target_link_libraries(tn-native-engine-tonemap-test PRIVATE tn_engine_shader)

tn_native_engine_test(tn-native-engine-package-test tests/native-engine/package_test.cpp
    native_engine_package_sha256=sha256
    native_engine_cooked_package_parse=load
    native_engine_cooked_package_reject=reject)
target_link_libraries(tn-native-engine-package-test PRIVATE tn_engine_assets)
# PRD-515: every format qualified or refused on this target, mobile and Wasm included.
tn_native_engine_test(tn-native-engine-decoder-matrix-test tests/native-engine/decoder_matrix_test.cpp
    native_engine_decoder_matrix=matrix)
target_link_libraries(tn-native-engine-decoder-matrix-test PRIVATE tn_engine_assets)

tn_native_engine_test(tn-native-engine-render-graph-test tests/native-engine/render_graph_test.cpp
    native_engine_render_graph_order=order
    native_engine_render_graph_aliasing=aliasing
    native_engine_render_graph_diagnostics=diagnostics
    native_engine_history_cut_resize=cut_resize
    native_engine_history_objects=objects
    native_engine_history_multi_render=multi_render)
target_link_libraries(tn-native-engine-render-graph-test PRIVATE tn_engine_graph)

tn_native_engine_test(tn-native-engine-abi-test tests/native-engine/abi_test.cpp
    native_engine_abi_version=version
    native_engine_abi_handles=handles
    native_engine_abi_generic=generic
    native_engine_abi_scene=scene
    native_engine_abi_lifetime=lifetime
    native_engine_unsupported_member=unsupported_member
    native_engine_abi_material=material
    native_engine_abi_light=light
    native_engine_abi_callbacks=callbacks)
target_link_libraries(tn-native-engine-abi-test PRIVATE tn_engine_abi)

# PRD-508 phase 3: the geometry edges a JS caller reaches that no fixture states.
tn_native_engine_test(tn-native-engine-geometry-edges-test tests/native-engine/geometry_edges_test.cpp
    native_engine_geometry_js_numbers=js_numbers
    native_engine_geometry_typed_writes=typed_writes
    native_engine_geometry_normalized=normalized
    native_engine_geometry_out_of_range=out_of_range
    native_engine_geometry_nan_bounds=nan_bounds)
target_link_libraries(tn-native-engine-geometry-edges-test PRIVATE tn_engine_scene)

# PRD-508 phase 1: hierarchy, re-parenting, events and member identity.
tn_native_engine_test(tn-native-engine-scene-test tests/native-engine/scene_hierarchy_test.cpp
    native_engine_scene_hierarchy=hierarchy
    native_engine_scene_alias=alias
    native_engine_scene_revision=revision
    native_engine_scene_hierarchy_upstream=upstream)
# The alias case drives the fixture driver's Store as well, which is the other implementor of it.
target_link_libraries(tn-native-engine-scene-test PRIVATE tn_engine_scene tn_fixture_driver)

# PRD-501: the ported V8 fdlibm answers V8's own bits, so a platform libm one bit off fails here.
tn_native_engine_test(tn-native-engine-ieee754-test tests/native-engine/ieee754_test.cpp
    native_engine_ieee754=bits)

# The header compiles as strict C11 and a C program links against the ABI.
add_executable(tn-native-engine-abi-c11 EXCLUDE_FROM_ALL tests/native-engine/abi_c11.c)
target_link_libraries(tn-native-engine-abi-c11 PRIVATE tn_engine_abi)
tn_native_engine_target(tn-native-engine-abi-c11)
set_target_properties(tn-native-engine-abi-c11 PROPERTIES C_STANDARD 11 C_STANDARD_REQUIRED ON C_EXTENSIONS OFF
    LINKER_LANGUAGE CXX)
if(NOT MSVC)
    target_compile_options(tn-native-engine-abi-c11 PRIVATE -Wall -Wextra -Werror -pedantic)
endif()
add_test(NAME native_engine_abi_c11 COMMAND tn-native-engine-abi-c11)
set_tests_properties(native_engine_abi_c11 PROPERTIES LABELS "native-engine")
set_property(GLOBAL APPEND PROPERTY TN_NATIVE_ENGINE_TEST_TARGETS tn-native-engine-abi-c11)

# The native side of the differential fixture runner (PRD-498): run-native.ts spawns the driver.
# The engine's binding registry for the math and scene classes: one model the fixture driver and the
# C ABI share.
add_library(tn_engine_bindings STATIC src/engine/abi/bindings_math.cpp src/engine/abi/bindings_scene.cpp
    src/engine/abi/bindings_geometry.cpp src/engine/abi/bindings_material.cpp)
tn_native_engine_target(tn_engine_bindings)
target_link_libraries(tn_engine_bindings PUBLIC tn_engine_foundation tn_engine_scene)
if(EMSCRIPTEN)
    # Bindings report an unsupported member by exception and the ABI catches it at the boundary;
    # engine algorithms never throw. Both sides need Wasm exception handling.
    target_compile_options(tn_engine_bindings PUBLIC -fwasm-exceptions)
    target_link_options(tn_engine_bindings PUBLIC -fwasm-exceptions)
endif()

# PRD-531 phase 1: the registry printed as JSON, the truth of what is natively implemented and
# bound. `--check` compares the output with the committed catalog snapshot and fails on drift.
add_executable(tn-native-engine-registry-dump EXCLUDE_FROM_ALL tests/native-engine/registry_dump.cpp)
target_link_libraries(tn-native-engine-registry-dump PRIVATE tn_engine_bindings)
target_include_directories(tn-native-engine-registry-dump PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests/native-engine)
tn_native_engine_target(tn-native-engine-registry-dump)
set_property(GLOBAL APPEND PROPERTY TN_NATIVE_ENGINE_TEST_TARGETS tn-native-engine-registry-dump)
if(NOT EMSCRIPTEN)
    add_test(NAME native_engine_registry_snapshot
        COMMAND tn-native-engine-registry-dump --check
            ${CMAKE_CURRENT_SOURCE_DIR}/../three-native/api/native-registry.json)
    set_tests_properties(native_engine_registry_snapshot PROPERTIES LABELS "native-engine")
endif()

# The renderer's sources, shared by the native build (NativeEngine.cmake, over the host's WebGPU
# backend) and the browser build below.
set(TN_ENGINE_RENDERER_SOURCES src/engine/renderer/gpu_resources.cpp src/engine/renderer/device_state.cpp
    src/engine/renderer/presentation.cpp src/engine/renderer/package_loader.cpp
    src/engine/renderer/geometry_cache.cpp src/engine/renderer/pipeline_cache.cpp src/engine/renderer/renderer.cpp
    src/engine/renderer/render_database.cpp src/engine/renderer/compute.cpp)
if(EMSCRIPTEN)
    # PRD-532: the same renderer over the browser's WebGPU through Dawn's emdawnwebgpu port, whose
    # webgpu.h is Dawn's. No host services: nothing here may assume a native driver.
    add_library(tn_engine_renderer STATIC ${TN_ENGINE_RENDERER_SOURCES})
    tn_native_engine_target(tn_engine_renderer)
    target_link_libraries(tn_engine_renderer PUBLIC tn_engine_foundation tn_engine_assets tn_engine_shader tn_engine_scene)
    target_compile_definitions(tn_engine_renderer PUBLIC MYSTRAL_WEBGPU_DAWN)
    target_compile_options(tn_engine_renderer PUBLIC --use-port=emdawnwebgpu)
    target_link_options(tn_engine_renderer PUBLIC --use-port=emdawnwebgpu)
    target_include_directories(tn_engine_renderer PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
    add_executable(tn-native-engine-wasm-renderer-link tests/native-engine/wasm/renderer_link.cpp)
    target_link_libraries(tn-native-engine-wasm-renderer-link PRIVATE tn_engine_renderer)
    target_include_directories(tn-native-engine-wasm-renderer-link PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
    tn_native_engine_target(tn-native-engine-wasm-renderer-link)
    # The browser boot page (PRD-532): async init, memory growth, callback delivery, no threads.
    add_executable(tn-native-engine-wasm-boot tests/native-engine/wasm/boot.cpp)
    target_link_libraries(tn-native-engine-wasm-boot PRIVATE tn_engine_renderer)
    target_include_directories(tn-native-engine-wasm-boot PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
    target_link_options(tn-native-engine-wasm-boot PRIVATE -sENVIRONMENT=web -sALLOW_MEMORY_GROWTH=1)
    tn_native_engine_target(tn-native-engine-wasm-boot)
    configure_file(tests/native-engine/wasm/boot.html ${CMAKE_CURRENT_BINARY_DIR}/native-core-boot.html COPYONLY)
endif()
if(EMSCRIPTEN)
    # The C ABI as a module for the browser-JS back end (PRD-532); it runs under node as well.
    add_executable(tn-native-engine-abi-module tests/native-engine/wasm/abi_module.cpp)
    target_link_libraries(tn-native-engine-abi-module PRIVATE tn_engine_abi)
    tn_native_engine_target(tn-native-engine-abi-module)
    target_link_options(tn-native-engine-abi-module PRIVATE --no-entry -sMODULARIZE=1 -sEXPORT_NAME=createTnAbi
        -sENVIRONMENT=node,web -sALLOW_MEMORY_GROWTH=1 -sALLOW_TABLE_GROWTH=1
        "-sEXPORTED_FUNCTIONS=_tn_engine_version,_tn_context_create,_tn_context_destroy,_tn_type_id,_tn_object_release,_tn_construct,_tn_invoke,_tn_get,_tn_set,_tn_set_callback,_tn_diagnostic_release,_tnw_fire_before_render,_malloc,_free"
        "-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU32,HEAPF64,UTF8ToString,stringToUTF8,lengthBytesUTF8,addFunction")
    target_include_directories(tn-native-engine-abi-module PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
    find_program(TN_PNPM_EXECUTABLE pnpm)
    if(TN_PNPM_EXECUTABLE)
        add_test(NAME native_engine_wasm_browser_backend
            COMMAND ${TN_PNPM_EXECUTABLE} --filter @threenative/three-native exec tsx tests/browser-backend-smoke.ts
                $<TARGET_FILE:tn-native-engine-abi-module>)
        set_tests_properties(native_engine_wasm_browser_backend PROPERTIES LABELS "native-engine"
            PASS_REGULAR_EXPRESSION "TN_BROWSER_BACKEND_OK")
    endif()
endif()

# PRD-506: a compiled TypeScript closure called by the engine, through the native-TypeScript corpus
# runner against this build's archives. The archives must link with a plain C++ driver, so not under
# sanitizers, and the pinned compiler targets the host, so not for Wasm or a cross build.
if(NOT EMSCRIPTEN AND NOT TN_ENGINE_CORE_ONLY AND NOT TN_ENGINE_SANITIZE)
    find_program(TN_NODE_EXECUTABLE node)
    if(TN_NODE_EXECUTABLE)
        add_test(NAME native_engine_aot_callback
            COMMAND ${TN_NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/../../tools/native-typescript/run-corpus.mjs
                --native --case aot-callback)
        set_tests_properties(native_engine_aot_callback PROPERTIES
            LABELS "native-engine;native-typescript"
            ENVIRONMENT "TN_NATIVE_ENGINE_BUILD=${CMAKE_BINARY_DIR}"
            PASS_REGULAR_EXPRESSION "aot-callback +- +PASS")
    endif()
endif()

# PRD-530: the artifact identity manifest, its checks and the tool a packager runs.
tn_native_engine_test(tn-native-engine-identity-test tests/native-engine/identity_test.cpp
    native_engine_artifact_identity=identity)
target_link_libraries(tn-native-engine-identity-test PRIVATE tn_engine_abi)
add_executable(tn-native-engine-identity EXCLUDE_FROM_ALL tests/native-engine/identity_tool.cpp)
target_link_libraries(tn-native-engine-identity PRIVATE tn_engine_abi)
tn_native_engine_target(tn-native-engine-identity)
set_property(GLOBAL APPEND PROPERTY TN_NATIVE_ENGINE_TEST_TARGETS tn-native-engine-identity)

# PRD-516: three's animation system, starting with its interpolants.
add_library(tn_engine_animation STATIC src/engine/animation/interpolant.cpp src/engine/animation/property_binding.cpp
    src/engine/animation/mixer.cpp src/engine/animation/schedule.cpp)
tn_native_engine_target(tn_engine_animation)
target_link_libraries(tn_engine_animation PUBLIC tn_engine_scene)
target_include_directories(tn_engine_animation PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)
tn_native_engine_test(tn-native-engine-animation-interpolants-test tests/native-engine/animation/interpolants_test.cpp
    native_engine_animation_interpolants=interpolants)
target_link_libraries(tn-native-engine-animation-interpolants-test PRIVATE tn_engine_animation)
target_include_directories(tn-native-engine-animation-interpolants-test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests/native-engine/animation)
tn_native_engine_test(tn-native-engine-animation-binding-test tests/native-engine/animation/property_binding_test.cpp
    native_engine_animation_binding_parse=parse native_engine_animation_binding=binding)
target_link_libraries(tn-native-engine-animation-binding-test PRIVATE tn_engine_animation)
target_include_directories(tn-native-engine-animation-binding-test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests/native-engine/animation)
tn_native_engine_test(tn-native-engine-animation-mixer-test tests/native-engine/animation/mixer_test.cpp
    native_engine_animation_mixer=mixer native_engine_animation_events=events)
target_link_libraries(tn-native-engine-animation-mixer-test PRIVATE tn_engine_animation)
# PRD-517: property tracks on materials, lights, cameras and visibility.
tn_native_engine_test(tn-native-engine-animation-property-tracks-test tests/native-engine/animation/property_tracks_test.cpp
    native_engine_animation_property_tracks=property_tracks)
target_link_libraries(tn-native-engine-animation-property-tracks-test PRIVATE tn_engine_animation)
target_include_directories(tn-native-engine-animation-property-tracks-test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests/native-engine/animation)
tn_native_engine_test(tn-native-engine-animation-schedule-test tests/native-engine/animation/schedule_test.cpp
    native_engine_animation_explicit_update=explicit_update)
target_link_libraries(tn-native-engine-animation-schedule-test PRIVATE tn_engine_animation)
target_include_directories(tn-native-engine-animation-mixer-test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests/native-engine/animation)

# PRD-528 phase 1, PRD-521 phase 3: the fixed-step clock and the world height buffer, ported from
# packages/core/src/loop.ts, world-heightmap.ts and world.ts.
add_library(tn_engine_world STATIC src/engine/world/loop/fixed_step.cpp
    src/engine/world/terrain/heights.cpp src/engine/world/events/completion_queue.cpp)
tn_native_engine_target(tn_engine_world)
target_link_libraries(tn_engine_world PUBLIC tn_engine_foundation)
target_include_directories(tn_engine_world PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)
tn_native_engine_test(tn-native-engine-loop-fixed-step-test tests/native-engine/loop/fixed_step_test.cpp
    native_engine_loop_fixed_step=fixed_step)
target_link_libraries(tn-native-engine-loop-fixed-step-test PRIVATE tn_engine_world)
target_include_directories(tn-native-engine-loop-fixed-step-test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests/native-engine/loop)
tn_native_engine_test(tn-native-engine-world-heights-test tests/native-engine/world/heights_test.cpp
    native_engine_world_heights=heights)
target_link_libraries(tn-native-engine-world-heights-test PRIVATE tn_engine_world)
target_include_directories(tn-native-engine-world-heights-test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests/native-engine/world)
# PRD-520 phase 1: completions from worker threads, drained on the game thread; also under TSan
# (TN_ENGINE_TSAN). Emscripten builds the queue but has no threads to post from here.
if(NOT EMSCRIPTEN)
    find_package(Threads REQUIRED)
    tn_native_engine_test(tn-native-engine-event-queue-test tests/native-engine/world/event_queue_test.cpp
        native_engine_event_queue=event_queue native_engine_event_queue_teardown=teardown)
    target_link_libraries(tn-native-engine-event-queue-test PRIVATE tn_engine_world Threads::Threads)
endif()

add_library(tn_fixture_driver STATIC tests/native-engine/fixture/driver.cpp)
tn_native_engine_target(tn_fixture_driver)
target_include_directories(tn_fixture_driver PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/tests/native-engine)
target_link_libraries(tn_fixture_driver PUBLIC tn_engine_foundation tn_engine_bindings)
if(EMSCRIPTEN)
    # The driver (a test tool) reports unsupported fixtures by exception; engine code never throws.
    target_compile_options(tn_fixture_driver PUBLIC -fwasm-exceptions)
    target_link_options(tn_fixture_driver PUBLIC -fwasm-exceptions)
endif()
add_executable(tn-native-engine-fixture-driver tests/native-engine/fixture/main.cpp)
target_link_libraries(tn-native-engine-fixture-driver PRIVATE tn_fixture_driver)
tn_native_engine_target(tn-native-engine-fixture-driver)
# The differential ctests run it, so every test aggregate rebuilds it.
set_property(GLOBAL APPEND PROPERTY TN_NATIVE_ENGINE_TEST_TARGETS tn-native-engine-fixture-driver)
tn_native_engine_test(tn-native-engine-fixture-protocol-test tests/native-engine/fixture_driver_test.cpp
    native_engine_fixture_protocol=protocol)
target_link_libraries(tn-native-engine-fixture-protocol-test PRIVATE tn_fixture_driver)

# PRD-501 phases 1 and 2 and PRD-508 phase 2: the ported math and scene classes against the pinned
# three, one ctest per fixture prefix. Each case is the differential runner over its prefix and the
# host driver; a mismatch and a blocked row both fail it, because a row nobody ran is a row nobody
# proved. Emscripten needs node and the host-built driver, which an Emscripten build has neither of.
if(NOT EMSCRIPTEN)
    find_program(TN_PNPM_EXECUTABLE pnpm)
    if(TN_PNPM_EXECUTABLE)
        foreach(math_case "math_core:math-core-*" "math_edges:math-edges-*" "math_euler:math-euler-*" "math_primitives:math-primitives-*" "scene_transforms:scene-transforms-*" "scene_cameras:scene-cameras-*" "geometry:geometry-*" "geometry_derived:geometry-derived-*" "material_props:materials-props-*" "light_props:lights-props-*")
            string(REPLACE ":" ";" math_pair "${math_case}")
            list(GET math_pair 0 math_name)
            list(GET math_pair 1 math_glob)
            add_test(NAME native_engine_${math_name}
                COMMAND ${TN_PNPM_EXECUTABLE} --filter @threenative/three-native exec tsx
                    tests/compatibility/run-native.ts
                    --driver $<TARGET_FILE:tn-native-engine-fixture-driver>
                    --only "${math_glob}"
                    --out ${CMAKE_CURRENT_BINARY_DIR}/${math_name}.json)
            set_tests_properties(native_engine_${math_name} PROPERTIES LABELS "native-engine")
        endforeach()
        # PRD-516: the committed interpolant table is what the pinned three produces today.
        add_test(NAME native_engine_animation_reference_current
            COMMAND ${TN_PNPM_EXECUTABLE} --workspace-root exec tsx
                packages/three-native/tests/animation/animation-reference.ts --check
            WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/../..)
        set_tests_properties(native_engine_animation_reference_current PROPERTIES LABELS "native-engine")
        # PRD-528 phase 1: the committed fixed-step table is what loop.ts produces today.
        add_test(NAME native_engine_loop_reference_current
            COMMAND ${TN_PNPM_EXECUTABLE} --workspace-root exec tsx
                packages/runtime-native/tests/native-engine/loop/loop-reference.ts --check
            WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/../..)
        set_tests_properties(native_engine_loop_reference_current PROPERTIES LABELS "native-engine")
        # PRD-521 phase 3: the committed height table is what world-heightmap.ts and world.ts produce.
        add_test(NAME native_engine_world_heights_reference_current
            COMMAND ${TN_PNPM_EXECUTABLE} --workspace-root exec tsx
                packages/runtime-native/tests/native-engine/world/heights-reference.ts --check
            WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/../..)
        set_tests_properties(native_engine_world_heights_reference_current PROPERTIES LABELS "native-engine")
        unset(math_case)
        unset(math_pair)
    else()
        message(WARNING "pnpm not found: the native_engine_math_* and native_engine_scene_* fixture cases are not registered")
    endif()
endif()

# The math fixture cases spawn the driver, so the aggregate target has to build it too.
get_property(tn_native_engine_core_test_targets GLOBAL PROPERTY TN_NATIVE_ENGINE_TEST_TARGETS)
add_custom_target(tn-native-engine-core-tests DEPENDS ${tn_native_engine_core_test_targets}
    tn-native-engine-fixture-driver)
