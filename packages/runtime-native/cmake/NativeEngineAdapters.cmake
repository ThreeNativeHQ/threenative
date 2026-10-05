# Game-runtime adapters (PRD-531): above the engine, never below it. Included after the JS engines
# are configured; nothing in NativeEngine*.cmake may link these targets.

if(TARGET v8::v8 AND MYSTRAL_USE_V8 AND NOT MYSTRAL_PLATFORM STREQUAL "ios")
    add_library(tn_adapter_v8 STATIC src/adapters/v8/adapter.cpp)
    # Not tn_native_engine_target: an adapter is not an engine target, and the graph check would
    # rightly fail on its V8 link.
    set_target_properties(tn_adapter_v8 PROPERTIES CXX_STANDARD 20 CXX_STANDARD_REQUIRED ON POSITION_INDEPENDENT_CODE ON)
    target_include_directories(tn_adapter_v8 PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)
    target_link_libraries(tn_adapter_v8 PUBLIC tn_engine_abi tn_engine_bindings v8::v8 ${V8_SYSTEM_LIBS})

    add_executable(tn-native-engine-v8-test EXCLUDE_FROM_ALL tests/native-engine/v8_adapter_test.cpp)
    target_link_libraries(tn-native-engine-v8-test PRIVATE tn_adapter_v8)
    target_include_directories(tn-native-engine-v8-test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests/native-engine)
    set_target_properties(tn-native-engine-v8-test PROPERTIES CXX_STANDARD 20 CXX_STANDARD_REQUIRED ON)
    foreach(case handles unsupported gc_release runtime_churn crossing_bench scene catalog_coverage callback_cycle)
        add_test(NAME native_engine_v8_${case} COMMAND tn-native-engine-v8-test ${case})
        set_tests_properties(native_engine_v8_${case} PROPERTIES LABELS "native-engine")
    endforeach()
    add_dependencies(tn-native-engine-tests tn-native-engine-v8-test)

    # CP1's game host (PRD-534): a workload script on V8 through the adapter (native-v8), or its C++
    # twin (--cpp, native-cpp), drawn through the native renderer and measured per frame.
    add_executable(tn-native-engine-host EXCLUDE_FROM_ALL src/adapters/v8/host_main.cpp)
    target_link_libraries(tn-native-engine-host PRIVATE tn_adapter_v8 tn_engine_renderer tn_host_services)
    set_target_properties(tn-native-engine-host PROPERTIES CXX_STANDARD 20 CXX_STANDARD_REQUIRED ON)
    if(NOT APPLE AND NOT WIN32)
        # Dawn and the V8 monolith both carry Abseil, as for mystral-runtime: the same version's
        # duplicate definitions are folded rather than refused.
        target_link_options(tn-native-engine-host PRIVATE "LINKER:--allow-multiple-definition")
    endif()
    add_dependencies(tn-native-engine-tests tn-native-engine-host)
    # Both CP1 arms on a small L4: 64 cubes + the ground + the output pass, 66 draws in each.
    set(TN_ESBUILD ${CMAKE_CURRENT_SOURCE_DIR}/../../node_modules/.bin/esbuild)
    set(TN_L4_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/../../examples/engine-load-test/native-engine/l4-workload.ts)
    set(TN_L4_SCRIPT ${CMAKE_CURRENT_BINARY_DIR}/l4-workload.js)
    if(EXISTS ${TN_ESBUILD})
        add_test(NAME native_engine_host_v8
            COMMAND sh -c "${TN_ESBUILD} ${TN_L4_SOURCE} --bundle --format=iife --platform=neutral --log-level=error --outfile=${TN_L4_SCRIPT} && $<TARGET_FILE:tn-native-engine-host> ${TN_L4_SCRIPT} --objects 64 --frames 10 --warmup 2 2>/dev/null")
        add_test(NAME native_engine_host_cpp
            COMMAND sh -c "$<TARGET_FILE:tn-native-engine-host> --cpp --objects 64 --frames 10 --warmup 2 2>/dev/null")
        set_tests_properties(native_engine_host_v8 native_engine_host_cpp PROPERTIES
            LABELS "native-engine" PASS_REGULAR_EXPRESSION "\"draws\": 66,")
        # PRD-530: startup checks the artifact identity manifest; a matching one runs, one built
        # against another engine ABI is refused before any engine or game code.
        set(TN_IDENTITY ${CMAKE_CURRENT_BINARY_DIR}/identity.txt)
        add_test(NAME native_engine_host_identity_accept
            COMMAND sh -c "$<TARGET_FILE:tn-native-engine-identity> --write ${TN_IDENTITY} --backend dawn && $<TARGET_FILE:tn-native-engine-host> --cpp --objects 8 --frames 2 --warmup 1 --identity ${TN_IDENTITY} 2>&1")
        add_test(NAME native_engine_host_identity_refuse
            COMMAND sh -c "$<TARGET_FILE:tn-native-engine-identity> --write ${TN_IDENTITY}.bad --backend dawn && sed -i 's/^engine-abi .*/engine-abi 999/' ${TN_IDENTITY}.bad && $<TARGET_FILE:tn-native-engine-host> --cpp --objects 8 --frames 2 --warmup 1 --identity ${TN_IDENTITY}.bad 2>&1; echo exit=$?")
        set_tests_properties(native_engine_host_identity_accept PROPERTIES LABELS "native-engine" PASS_REGULAR_EXPRESSION "\"draws\": 10,")
        set_tests_properties(native_engine_host_identity_refuse PROPERTIES LABELS "native-engine"
            PASS_REGULAR_EXPRESSION "TN_ARTIFACT_VERSION_MISMATCH: TN_DIAG_ENGINE_ABI_MISMATCH[^\n]*\nexit=3")
    endif()

    # The differential fixtures through V8 (PRD-531 phase 2): the same corpus and goldens as the C++
    # driver, every op run as JS against the adapter's classes.
    add_executable(tn-native-engine-v8-fixture-driver EXCLUDE_FROM_ALL tests/native-engine/v8_fixture_driver.cpp)
    target_link_libraries(tn-native-engine-v8-fixture-driver PRIVATE tn_adapter_v8)
    set_target_properties(tn-native-engine-v8-fixture-driver PROPERTIES CXX_STANDARD 20 CXX_STANDARD_REQUIRED ON)
    add_dependencies(tn-native-engine-tests tn-native-engine-v8-fixture-driver)
    find_program(TN_PNPM_EXECUTABLE pnpm)
    if(TN_PNPM_EXECUTABLE)
        add_test(NAME native_engine_v8_scene_fixtures
            COMMAND ${TN_PNPM_EXECUTABLE} --filter @threenative/three-native exec tsx tests/compatibility/run-native.ts
                --driver $<TARGET_FILE:tn-native-engine-v8-fixture-driver> --only "scene-*"
                --out ${CMAKE_CURRENT_BINARY_DIR}/v8_scene.json)
        # Math through JS: two rows stay blocked by the C ABI's Frustum.planes, an array of member
        # objects the binding Value cannot carry yet — math-core-constructors constructs one and
        # math-primitives-frustum observes it. Every other math row passes through V8, Ray included
        # now that the catalog publishes it; a new blocked row changes the line and any FAIL row
        # fails the test.
        add_test(NAME native_engine_v8_math_fixtures
            COMMAND ${TN_PNPM_EXECUTABLE} --filter @threenative/three-native exec tsx tests/compatibility/run-native.ts
                --driver $<TARGET_FILE:tn-native-engine-v8-fixture-driver> --only "math-*" --allow-blocked
                --out ${CMAKE_CURRENT_BINARY_DIR}/v8_math.json)
        set_tests_properties(native_engine_v8_math_fixtures PROPERTIES
            PASS_REGULAR_EXPRESSION "ALLOWED_BLOCKED math-core-constructors, math-primitives-frustum\n"
            FAIL_REGULAR_EXPRESSION "(^|\n)FAIL ")
        set_tests_properties(native_engine_v8_scene_fixtures native_engine_v8_math_fixtures PROPERTIES LABELS "native-engine")
    endif()
endif()
