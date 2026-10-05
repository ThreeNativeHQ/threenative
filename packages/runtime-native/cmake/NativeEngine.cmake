# Native engine targets (PRD-499). Included after the WebGPU and SDL dependencies are found and
# before any JS engine is configured, so nothing here can see a VM target or VM headers.
# Every engine target is C++20 whatever MYSTRAL_USE_V8 selects for the legacy host.

include(${CMAKE_CURRENT_LIST_DIR}/NativeEngineCore.cmake)

# Host services: the GPU context with no scripting state. The legacy runtime keeps compiling its
# own copy, so this split adds targets and moves no behaviour of the shipped player.
add_library(tn_host_services STATIC src/webgpu/context.cpp src/utils/stb_impl.cpp)
tn_native_engine_target(tn_host_services)
target_include_directories(tn_host_services PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_include_directories(tn_host_services PRIVATE ${THIRD_PARTY_DIR}/stb)
if(TARGET dawn::webgpu)
    target_link_libraries(tn_host_services PUBLIC dawn::webgpu)
elseif(TARGET wgpu::wgpu)
    target_link_libraries(tn_host_services PUBLIC wgpu::wgpu)
endif()
if(SDL3_STATIC_TARGET)
    target_link_libraries(tn_host_services PRIVATE ${SDL3_STATIC_TARGET})
elseif(SDL3_LIBRARY)
    target_link_libraries(tn_host_services PRIVATE ${SDL3_LIBRARY})
    target_include_directories(tn_host_services PRIVATE ${SDL3_INCLUDE_DIR})
endif()

# Renderer: native-owned GPU resources over the same WebGPU backend the host uses.
add_library(tn_engine_renderer STATIC src/engine/renderer/gpu_resources.cpp src/engine/renderer/device_state.cpp
    src/engine/renderer/presentation.cpp src/engine/renderer/package_loader.cpp
    src/engine/renderer/geometry_cache.cpp src/engine/renderer/pipeline_cache.cpp src/engine/renderer/renderer.cpp
    src/engine/renderer/render_database.cpp)
tn_native_engine_target(tn_engine_renderer)
target_link_libraries(tn_engine_renderer PUBLIC tn_engine_foundation tn_engine_assets tn_engine_shader tn_engine_scene tn_host_services)
if(TARGET dawn::webgpu)
    target_link_libraries(tn_engine_renderer PUBLIC dawn::webgpu)
elseif(TARGET wgpu::wgpu)
    target_link_libraries(tn_engine_renderer PUBLIC wgpu::wgpu)
endif()
target_include_directories(tn_engine_renderer PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)

if(NOT MYSTRAL_PLATFORM STREQUAL "ios" AND NOT MYSTRAL_PLATFORM STREQUAL "android")
    # Gate E: clear, submit and read back 300 headless frames with no JS engine linked.
    add_executable(tn-native-engine-gate-e EXCLUDE_FROM_ALL tests/native-engine/gate_e_driver.cpp)
    target_link_libraries(tn-native-engine-gate-e PRIVATE tn_host_services)
    tn_native_engine_target(tn-native-engine-gate-e)
    add_test(NAME native_engine_gate_e COMMAND $<TARGET_FILE:tn-native-engine-gate-e>)
    set_tests_properties(native_engine_gate_e PROPERTIES LABELS "native-engine")
    if(TN_ENGINE_SANITIZE)
        # GPU drivers keep allocations alive past exit, so this driver judges memory errors and
        # undefined behaviour, not leaks.
        set_tests_properties(native_engine_gate_e PROPERTIES
            LABELS "native-engine;native-sanitizer"
            ENVIRONMENT "ASAN_OPTIONS=detect_leaks=0:abort_on_error=1;UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1")
    endif()
endif()

# libFuzzer targets need clang; `TN_ENGINE_FUZZ=ON` with a clang toolchain builds them.
option(TN_ENGINE_FUZZ "Build the native engine libFuzzer targets (clang only)" OFF)
if(TN_ENGINE_FUZZ)
    add_executable(native_engine_fuzz_buffers EXCLUDE_FROM_ALL tests/native-engine/fuzz_buffers.cpp)
    target_link_libraries(native_engine_fuzz_buffers PRIVATE tn_engine_foundation)
    target_compile_options(native_engine_fuzz_buffers PRIVATE -fsanitize=fuzzer,address,undefined)
    target_link_options(native_engine_fuzz_buffers PRIVATE -fsanitize=fuzzer,address,undefined)
    set_target_properties(native_engine_fuzz_buffers PROPERTIES CXX_STANDARD 20)
    add_executable(native_engine_fuzz_package EXCLUDE_FROM_ALL tests/native-engine/fuzz_package.cpp)
    target_link_libraries(native_engine_fuzz_package PRIVATE tn_engine_assets)
    target_compile_options(native_engine_fuzz_package PRIVATE -fsanitize=fuzzer,address,undefined)
    target_link_options(native_engine_fuzz_package PRIVATE -fsanitize=fuzzer,address,undefined)
    set_target_properties(native_engine_fuzz_package PROPERTIES CXX_STANDARD 20)
    add_executable(native_engine_fuzz_abi EXCLUDE_FROM_ALL tests/native-engine/fuzz_abi.cpp)
    target_link_libraries(native_engine_fuzz_abi PRIVATE tn_engine_abi)
    target_compile_options(native_engine_fuzz_abi PRIVATE -fsanitize=fuzzer,address,undefined)
    target_link_options(native_engine_fuzz_abi PRIVATE -fsanitize=fuzzer,address,undefined)
    set_target_properties(native_engine_fuzz_abi PROPERTIES CXX_STANDARD 20)
endif()

if(NOT MYSTRAL_PLATFORM STREQUAL "ios" AND NOT MYSTRAL_PLATFORM STREQUAL "android")
    tn_native_engine_test(tn-native-engine-gpu-resources-test tests/native-engine/gpu_resources_test.cpp
        native_engine_gpu_upload_readback=upload_readback
        native_engine_gpu_deferred_destroy=deferred_destroy
        native_engine_gpu_async_only=async_only
        native_engine_lifetime_deferred_gpu=lifetime_deferred_gpu)
    target_link_libraries(tn-native-engine-gpu-resources-test PRIVATE tn_engine_renderer tn_host_services)
    # A real window, so the ctest runs it under the repository's private Xvfb with SDL's dummy audio.
    add_executable(tn-native-engine-presentation-test EXCLUDE_FROM_ALL tests/native-engine/presentation_test.cpp)
    target_link_libraries(tn-native-engine-presentation-test PRIVATE tn_engine_renderer tn_host_services ${SDL3_STATIC_TARGET})
    target_include_directories(tn-native-engine-presentation-test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests/native-engine)
    tn_native_engine_target(tn-native-engine-presentation-test)
    add_test(NAME native_engine_present_resize
        COMMAND sh ${CMAKE_CURRENT_SOURCE_DIR}/../../scripts/xvfb.sh $<TARGET_FILE:tn-native-engine-presentation-test> resizes)
    set_tests_properties(native_engine_present_resize PROPERTIES LABELS "native-engine"
        ENVIRONMENT "SDL_AUDIODRIVER=dummy;SDL_VIDEODRIVER=x11;ASAN_OPTIONS=detect_leaks=0:abort_on_error=1;UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1")
    set_property(GLOBAL APPEND PROPERTY TN_NATIVE_ENGINE_TEST_TARGETS tn-native-engine-presentation-test)

    # The same corpus validates through the backend's own compiler: Tint on Dawn, naga on wgpu-native.
    if(TARGET dawn::webgpu)
        set(tn_shader_validator native_engine_shader_emit_tint)
    else()
        set(tn_shader_validator native_engine_shader_emit_naga)
    endif()
    tn_native_engine_test(tn-native-engine-shader-emit-test tests/native-engine/shader_emit_test.cpp
        ${tn_shader_validator}=validates
        native_engine_shader_emit_stable=stable)
    target_link_libraries(tn-native-engine-shader-emit-test PRIVATE tn_engine_shader tn_host_services)
    tn_native_engine_test(tn-native-engine-renderer-test tests/native-engine/renderer_test.cpp
        native_engine_renderer_resize_readback=resize_readback
        native_engine_renderer_output_ramp=output_ramp
        native_engine_renderer_lit_reference=lit_reference
        native_engine_renderer_lambert_reference=lambert_reference
        native_engine_renderer_phong_reference=phong_reference
        native_engine_renderer_physical_reference=physical_reference
        native_engine_renderer_alpha_transparency=alpha_transparency
        native_engine_renderer_alpha_test=alpha_test)
    target_link_libraries(tn-native-engine-renderer-test PRIVATE tn_engine_renderer tn_host_services)
    target_compile_definitions(tn-native-engine-renderer-test PRIVATE
        TN_GOLDENS_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../three-native/tests/compatibility/goldens/0.185.1")

    # The fixture driver with a GPU: it answers render fixtures' `render` lines (PRD-514).
    add_executable(tn-native-engine-render-driver EXCLUDE_FROM_ALL tests/native-engine/fixture/render_main.cpp)
    target_link_libraries(tn-native-engine-render-driver PRIVATE tn_fixture_driver tn_engine_renderer tn_host_services)
    tn_native_engine_target(tn-native-engine-render-driver)
    set_property(GLOBAL APPEND PROPERTY TN_NATIVE_ENGINE_TEST_TARGETS tn-native-engine-render-driver)
    # Every render fixture through the render driver against its browser golden frame (PRD-514,
    # PRD-512): tone mapping ramps, the lit sphere, the five materials, transparency and alphaTest.
    find_program(TN_PNPM_EXECUTABLE pnpm)
    if(TN_PNPM_EXECUTABLE)
        # The five standard materials' fixtures in one case (PRD-514): Basic (alpha-test), Standard
        # (lit-render), Lambert, Phong, Physical, and their property fixtures.
        foreach(render_case "render_tonemap:tonemap-ramp-*" "render_lit:lit-render" "render_lambert:materials-lambert"
                "render_phong:materials-phong" "render_physical:materials-physical*"
                "standard_materials_fixtures:alpha-test,lit-render,materials-*"
                "render_alpha:alpha-*")
            string(REPLACE ":" ";" render_pair "${render_case}")
            list(GET render_pair 0 render_name)
            list(GET render_pair 1 render_glob)
            add_test(NAME native_engine_${render_name}
                COMMAND ${TN_PNPM_EXECUTABLE} --filter @threenative/three-native exec tsx tests/compatibility/run-native.ts
                    --driver $<TARGET_FILE:tn-native-engine-render-driver> --renders --only "${render_glob}"
                    --out ${CMAKE_CURRENT_BINARY_DIR}/${render_name}.json)
            set_tests_properties(native_engine_${render_name} PROPERTIES LABELS "native-engine")
            if(TN_ENGINE_SANITIZE)
                # As for the other GPU tests: memory errors and UB fail, the driver stack's own
                # allocations at exit (Dawn's Vulkan queue) are not this engine's leaks.
                set_tests_properties(native_engine_${render_name} PROPERTIES
                    ENVIRONMENT "ASAN_OPTIONS=detect_leaks=0:abort_on_error=1;UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1")
            endif()
        endforeach()
    endif()

    tn_native_engine_test(tn-native-engine-render-database-test tests/native-engine/render_database_test.cpp
        native_engine_renderer_scene_lit=lit_scene
        native_engine_renderer_invalidation=invalidation
        native_engine_renderer_scene_alpha=alpha_scene
        native_engine_standard_materials_unsupported=material_unsupported)
    target_link_libraries(tn-native-engine-render-database-test PRIVATE tn_engine_renderer tn_host_services)
    target_compile_definitions(tn-native-engine-render-database-test PRIVATE
        TN_GOLDENS_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../three-native/tests/compatibility/goldens/0.185.1")

    tn_native_engine_test(tn-native-engine-renderer-caches-test tests/native-engine/renderer_caches_test.cpp
        native_engine_renderer_geometry_cache=geometry
        native_engine_renderer_pipeline_cache=pipelines)
    target_link_libraries(tn-native-engine-renderer-caches-test PRIVATE tn_engine_renderer tn_host_services)

    tn_native_engine_test(tn-native-engine-package-load-test tests/native-engine/package_load_test.cpp
        native_engine_cooked_package_load=load)
    target_link_libraries(tn-native-engine-package-load-test PRIVATE tn_engine_renderer tn_host_services)

    tn_native_engine_test(tn-native-engine-shader-package-test tests/native-engine/shader_package_test.cpp
        native_engine_shader_layouts=layouts
        native_engine_shader_variants_gpu=variants
        native_engine_shader_package_version=version)
    target_link_libraries(tn-native-engine-shader-package-test PRIVATE tn_engine_shader tn_engine_renderer tn_host_services)

    if(TARGET dawn::webgpu)
        tn_native_engine_test(tn-native-engine-device-loss-test tests/native-engine/device_loss_test.cpp
            native_engine_device_loss_recover=recover
            native_engine_device_stale_handle=stale_handle
            native_engine_device_no_adapter=no_adapter)
        target_link_libraries(tn-native-engine-device-loss-test PRIVATE tn_engine_renderer tn_host_services)
    else()
        # Measured 2026-10-04: wgpu-native 25 never delivers the device-lost callback for
        # wgpuDeviceDestroy, so the engine gets no loss signal to recover from.
        foreach(name native_engine_device_loss_recover native_engine_device_stale_handle native_engine_device_no_adapter)
            tn_register_blocked_test(${name} "wgpu-native 25 delivers no device-lost callback on wgpuDeviceDestroy")
        endforeach()
    endif()
    if(TN_ENGINE_SANITIZE)
        # These own a real device, whose driver keeps allocations past exit: judged for memory
        # errors and undefined behaviour, not leaks. CPU-only engine tests keep leak checking.
        set_tests_properties(native_engine_gpu_upload_readback native_engine_gpu_deferred_destroy
            native_engine_gpu_async_only native_engine_lifetime_deferred_gpu ${tn_shader_validator} native_engine_shader_layouts
            native_engine_cooked_package_load native_engine_renderer_geometry_cache native_engine_renderer_pipeline_cache native_engine_renderer_scene_lit native_engine_renderer_invalidation native_engine_renderer_scene_alpha native_engine_standard_materials_unsupported native_engine_renderer_resize_readback native_engine_renderer_output_ramp native_engine_renderer_lit_reference native_engine_renderer_lambert_reference native_engine_renderer_phong_reference native_engine_renderer_physical_reference native_engine_renderer_alpha_transparency native_engine_renderer_alpha_test
            native_engine_shader_variants_gpu native_engine_device_loss_recover native_engine_device_stale_handle
            native_engine_device_no_adapter PROPERTIES
            ENVIRONMENT "ASAN_OPTIONS=detect_leaks=0:abort_on_error=1;UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1")
    endif()
endif()

if(NOT MYSTRAL_PLATFORM STREQUAL "ios" AND NOT MYSTRAL_PLATFORM STREQUAL "android")
    # A progress screenshot of the native path (IR -> WGSL package -> native GPU -> PNG); evidence, not a test.
    add_executable(tn-native-engine-showcase EXCLUDE_FROM_ALL tests/native-engine/showcase.cpp)
    target_link_libraries(tn-native-engine-showcase PRIVATE tn_engine_shader tn_engine_renderer tn_host_services)
    tn_native_engine_target(tn-native-engine-showcase)
endif()

get_property(tn_native_engine_test_targets GLOBAL PROPERTY TN_NATIVE_ENGINE_TEST_TARGETS)
add_custom_target(tn-native-engine-tests DEPENDS ${tn_native_engine_test_targets})

# The engine target graph, recorded once every target in the project exists, so the ctest below can
# prove no engine target reaches a JS engine, a web view or the scripting host.
function(tn_native_engine_collect_links target out)
    set(seen ${${out}})
    foreach(property LINK_LIBRARIES INTERFACE_LINK_LIBRARIES)
        get_target_property(links ${target} ${property})
        if(NOT links)
            continue()
        endif()
        foreach(link IN LISTS links)
            string(REGEX REPLACE "^\\$<LINK_ONLY:(.*)>$" "\\1" link "${link}")
            if(link IN_LIST seen)
                continue()
            endif()
            list(APPEND seen "${link}")
            if(TARGET ${link})
                get_target_property(location ${link} IMPORTED_LOCATION)
                if(location)
                    list(APPEND seen "${location}")
                endif()
                tn_native_engine_collect_links(${link} seen)
            endif()
        endforeach()
    endforeach()
    set(${out} ${seen} PARENT_SCOPE)
endfunction()

function(tn_native_engine_write_graph)
    get_property(targets GLOBAL PROPERTY TN_NATIVE_ENGINE_TARGETS)
    set(report "")
    foreach(target IN LISTS targets)
        get_target_property(standard ${target} CXX_STANDARD)
        set(links "")
        tn_native_engine_collect_links(${target} links)
        string(APPEND report "${target}|${standard}|${links}\n")
    endforeach()
    file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/native-engine-target-graph.txt" "${report}")
endfunction()
cmake_language(DEFER DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR} CALL tn_native_engine_write_graph)

add_test(NAME native_engine_target_graph
    COMMAND ${CMAKE_COMMAND}
        -DGRAPH=${CMAKE_CURRENT_BINARY_DIR}/native-engine-target-graph.txt
        -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/CheckNativeEngineGraph.cmake)
set_tests_properties(native_engine_target_graph PROPERTIES LABELS "native-engine")

add_test(NAME native_engine_no_blocking_waits
    COMMAND ${CMAKE_COMMAND} -DENGINE_SOURCE_DIR=${CMAKE_CURRENT_SOURCE_DIR}/src/engine
        -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/CheckNoBlockingWaits.cmake)
set_tests_properties(native_engine_no_blocking_waits PROPERTIES LABELS "native-engine")
