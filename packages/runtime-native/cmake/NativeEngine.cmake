# Native engine targets (PRD-499). Included after the WebGPU and SDL dependencies are found and
# before any JS engine is configured, so nothing here can see a VM target or VM headers.
# Every engine target is C++20 whatever MYSTRAL_USE_V8 selects for the legacy host.

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
add_library(tn_engine_foundation STATIC src/engine/foundation/handles.cpp src/engine/foundation/buffers.cpp)
tn_native_engine_target(tn_engine_foundation)
target_include_directories(tn_engine_foundation PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)

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
add_library(tn_engine_renderer STATIC src/engine/renderer/gpu_resources.cpp src/engine/renderer/device_state.cpp)
tn_native_engine_target(tn_engine_renderer)
target_link_libraries(tn_engine_renderer PUBLIC tn_engine_foundation)
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
        add_test(NAME ${test_name} COMMAND $<TARGET_FILE:${target}> ${case_name})
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

# libFuzzer targets need clang; `TN_ENGINE_FUZZ=ON` with a clang toolchain builds them.
option(TN_ENGINE_FUZZ "Build the native engine libFuzzer targets (clang only)" OFF)
if(TN_ENGINE_FUZZ)
    add_executable(native_engine_fuzz_buffers EXCLUDE_FROM_ALL tests/native-engine/fuzz_buffers.cpp)
    target_link_libraries(native_engine_fuzz_buffers PRIVATE tn_engine_foundation)
    target_compile_options(native_engine_fuzz_buffers PRIVATE -fsanitize=fuzzer,address,undefined)
    target_link_options(native_engine_fuzz_buffers PRIVATE -fsanitize=fuzzer,address,undefined)
    set_target_properties(native_engine_fuzz_buffers PROPERTIES CXX_STANDARD 20)
endif()

if(NOT MYSTRAL_PLATFORM STREQUAL "ios" AND NOT MYSTRAL_PLATFORM STREQUAL "android")
    tn_native_engine_test(tn-native-engine-gpu-resources-test tests/native-engine/gpu_resources_test.cpp
        native_engine_gpu_upload_readback=upload_readback
        native_engine_gpu_deferred_destroy=deferred_destroy
        native_engine_gpu_async_only=async_only)
    target_link_libraries(tn-native-engine-gpu-resources-test PRIVATE tn_engine_renderer tn_host_services)
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
            native_engine_gpu_async_only native_engine_device_loss_recover native_engine_device_stale_handle
            native_engine_device_no_adapter PROPERTIES
            ENVIRONMENT "ASAN_OPTIONS=detect_leaks=0:abort_on_error=1;UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1")
    endif()
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
