# Portable native engine core (PRD-499): targets with no platform API, GPU or VM, and their CPU
# tests. The host build includes it through NativeEngine.cmake; an Emscripten build includes it
# alone, which is the guard that the core stays Wasm-safe (owner decision 4).

option(TN_ENGINE_SANITIZE "Build the native engine targets under ASan and UBSan" OFF)
function(tn_native_engine_target target)
    set_target_properties(${target} PROPERTIES CXX_STANDARD 20 CXX_STANDARD_REQUIRED ON POSITION_INDEPENDENT_CODE ON)
    if(TN_ENGINE_SANITIZE)
        target_compile_options(${target} PRIVATE -fsanitize=address,undefined -fno-sanitize-recover=undefined -fno-omit-frame-pointer)
        target_link_options(${target} PRIVATE -fsanitize=address,undefined)
    endif()
    set_property(GLOBAL APPEND PROPERTY TN_NATIVE_ENGINE_TARGETS ${target})
endfunction()

# Foundation: handles and (later) math. Portable C++20 with no platform API, so the same sources
# compile for the browser port.
add_library(tn_engine_foundation STATIC
    src/engine/foundation/handles.cpp
    src/engine/foundation/buffers.cpp
    src/engine/foundation/reachability.cpp
    src/engine/foundation/members.cpp)
tn_native_engine_target(tn_engine_foundation)
target_include_directories(tn_engine_foundation PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)

# The N03 C ABI over the foundation: version handshake, contexts, generational object handles.
add_library(tn_engine_abi STATIC src/engine/abi/abi.cpp)
tn_native_engine_target(tn_engine_abi)
target_link_libraries(tn_engine_abi PUBLIC tn_engine_foundation)
target_include_directories(tn_engine_abi PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)

# Shader IR (N08): typed, hash-consed expressions and ordered effects. Portable like foundation.
add_library(tn_engine_shader STATIC src/engine/shader/ir.cpp src/engine/shader/wgsl.cpp src/engine/shader/package.cpp
    src/engine/shader/standard.cpp src/engine/shader/tonemap.cpp)
tn_native_engine_target(tn_engine_shader)
target_include_directories(tn_engine_shader PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src ${CMAKE_CURRENT_SOURCE_DIR}/include)

# Render graph (N14a): pass ordering, transient aliasing and temporal history. Pure CPU logic.
add_library(tn_engine_graph STATIC src/engine/renderer/graph/render_graph.cpp src/engine/renderer/graph/history.cpp)
tn_native_engine_target(tn_engine_graph)
target_include_directories(tn_engine_graph PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)

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
    native_engine_abi_handles=handles)
target_link_libraries(tn-native-engine-abi-test PRIVATE tn_engine_abi)

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
add_library(tn_fixture_driver STATIC tests/native-engine/fixture/driver.cpp tests/native-engine/fixture/bindings.cpp)
tn_native_engine_target(tn_fixture_driver)
target_include_directories(tn_fixture_driver PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/tests/native-engine)
target_link_libraries(tn_fixture_driver PUBLIC tn_engine_foundation)
if(EMSCRIPTEN)
    # The driver (a test tool) reports unsupported fixtures by exception; engine code never throws.
    target_compile_options(tn_fixture_driver PUBLIC -fwasm-exceptions)
    target_link_options(tn_fixture_driver PUBLIC -fwasm-exceptions)
endif()
add_executable(tn-native-engine-fixture-driver tests/native-engine/fixture/main.cpp)
target_link_libraries(tn-native-engine-fixture-driver PRIVATE tn_fixture_driver)
tn_native_engine_target(tn-native-engine-fixture-driver)
tn_native_engine_test(tn-native-engine-fixture-protocol-test tests/native-engine/fixture_driver_test.cpp
    native_engine_fixture_protocol=protocol)
target_link_libraries(tn-native-engine-fixture-protocol-test PRIVATE tn_fixture_driver)

get_property(tn_native_engine_core_test_targets GLOBAL PROPERTY TN_NATIVE_ENGINE_TEST_TARGETS)
add_custom_target(tn-native-engine-core-tests DEPENDS ${tn_native_engine_core_test_targets})
