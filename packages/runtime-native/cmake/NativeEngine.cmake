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
