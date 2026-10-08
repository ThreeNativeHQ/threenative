# Game-runtime adapters (PRD-531): above the engine, never below it. Included after the JS engines
# are configured; nothing in NativeEngine*.cmake may link these targets.

if(TARGET v8::v8 AND MYSTRAL_USE_V8 AND NOT MYSTRAL_PLATFORM STREQUAL "ios")
    add_library(tn_adapter_v8 STATIC src/adapters/v8/adapter.cpp src/adapters/v8/tsl.cpp)
    # Not tn_native_engine_target: an adapter is not an engine target, and the graph check would
    # rightly fail on its V8 link.
    set_target_properties(tn_adapter_v8 PROPERTIES CXX_STANDARD 20 CXX_STANDARD_REQUIRED ON POSITION_INDEPENDENT_CODE ON)
    target_include_directories(tn_adapter_v8 PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)
    target_link_libraries(tn_adapter_v8 PUBLIC tn_engine_abi tn_engine_bindings tn_engine_shader v8::v8 ${V8_SYSTEM_LIBS})

    add_executable(tn-native-engine-v8-test EXCLUDE_FROM_ALL tests/native-engine/v8_adapter_test.cpp)
    target_link_libraries(tn-native-engine-v8-test PRIVATE tn_adapter_v8)
    target_include_directories(tn-native-engine-v8-test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests/native-engine)
    set_target_properties(tn-native-engine-v8-test PROPERTIES CXX_STANDARD 20 CXX_STANDARD_REQUIRED ON)
    foreach(case handles unsupported gc_release runtime_churn crossing_bench scene raycaster_lod catalog_coverage callback_cycle tsl_api node_materials skeletal)
        add_test(NAME native_engine_v8_${case} COMMAND tn-native-engine-v8-test ${case})
        set_tests_properties(native_engine_v8_${case} PROPERTIES LABELS "native-engine")
    endforeach()
    add_dependencies(tn-native-engine-tests tn-native-engine-v8-test)

    # PRD-531 slice 2: the upstream corpus authored in JS through the native lazy graph.
    add_executable(tn-native-engine-tsl-js EXCLUDE_FROM_ALL tests/native-engine/tsl-corpus/tsl_js.cpp)
    target_link_libraries(tn-native-engine-tsl-js PRIVATE tn_adapter_v8)
    target_compile_definitions(tn-native-engine-tsl-js PRIVATE
        TN_TSL_CORPUS="${CMAKE_CURRENT_SOURCE_DIR}/tests/native-engine/tsl-corpus/corpus.js")
    set_target_properties(tn-native-engine-tsl-js PROPERTIES CXX_STANDARD 20 CXX_STANDARD_REQUIRED ON)
    add_dependencies(tn-native-engine-tests tn-native-engine-tsl-js)
    if(TN_PNPM_EXECUTABLE AND TN_NODE_EXECUTABLE)
        add_test(NAME native_engine_tsl_js
            COMMAND ${TN_NODE_EXECUTABLE} tests/native-engine/differential.mjs --suite tsl-ir
                --native $<TARGET_FILE:tn-native-engine-tsl-js>
            WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR})
        set_tests_properties(native_engine_tsl_js PROPERTIES LABELS "native-engine")
    endif()

    # CP1's game host (PRD-534): a workload script on V8 through the adapter (native-v8), its C++
    # twin (--cpp, native-cpp) or the C++ skinned crowd (--crowd, PRD-533), drawn through the native renderer and measured per frame.
    add_executable(tn-native-engine-host EXCLUDE_FROM_ALL src/adapters/v8/host_main.cpp
        src/engine/player/skinned_crowd.cpp)
    target_link_libraries(tn-native-engine-host PRIVATE tn_adapter_v8 tn_engine_renderer tn_host_services
        tn_engine_animation)
    set_target_properties(tn-native-engine-host PROPERTIES CXX_STANDARD 20 CXX_STANDARD_REQUIRED ON)
    if(NOT APPLE AND NOT WIN32)
        # Dawn and the V8 monolith both carry Abseil, as for mystral-runtime: the same version's
        # duplicate definitions are folded rather than refused.
        target_link_options(tn-native-engine-host PRIVATE "LINKER:--allow-multiple-definition")
    endif()
    add_dependencies(tn-native-engine-tests tn-native-engine-host)

    # PRD-531 phase 3: the desktop player with a game bundle on V8. It reuses the JS-free player's
    # window/loop/render/mailbox path (tn_engine_player), so only the game side differs. It links
    # the adapter, so it is a JS artifact and never a tn_native_engine_target:
    #   node packages/playtest/dist/runner/cli.js <scenario> --target desktop \
    #     --executable <build>/tn-native-engine-player-v8 --host-arg <game>.js
    add_executable(tn-native-engine-player-v8 EXCLUDE_FROM_ALL src/engine/player/v8_main.cpp)
    target_link_libraries(tn-native-engine-player-v8 PRIVATE tn_adapter_v8 tn_engine_player tn_engine_assets)
    if(TARGET tn_engine_gltf)
        target_link_libraries(tn-native-engine-player-v8 PRIVATE tn_engine_gltf)
        target_compile_definitions(tn-native-engine-player-v8 PRIVATE TN_PLAYER_NATIVE_GLTF=1)
    endif()
    # Reuse the host's complete V8 service/physics bindings in the player's own isolate.
    # These VM sources stay above the JS-free engine; no legacy renderer is linked.
    add_library(tn_player_v8_services STATIC src/js/v8_engine.cpp src/js/module_system.cpp
        src/js/module_resolver.cpp src/js/ts_transpiler.cpp src/vfs/embedded_bundle.cpp)
    target_include_directories(tn_player_v8_services PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
    target_compile_definitions(tn_player_v8_services PRIVATE MYSTRAL_JS_V8=1)
    target_link_libraries(tn_player_v8_services PUBLIC v8::v8 ${V8_SYSTEM_LIBS})
    if(TARGET swc::swc)
        target_link_libraries(tn_player_v8_services PRIVATE swc::swc)
    endif()
    set_target_properties(tn_player_v8_services PROPERTIES CXX_STANDARD 20 CXX_STANDARD_REQUIRED ON)
    target_link_libraries(tn-native-engine-player-v8 PRIVATE tn_player_v8_services)
    if(TN_ENABLE_NATIVE_PHYSICS)
        target_sources(tn_player_v8_services PRIVATE src/physics/native_bindings.cpp)
        target_link_libraries(tn_player_v8_services PUBLIC threenative-native-physics)
        target_compile_definitions(tn-native-engine-player-v8 PRIVATE TN_PLAYER_NATIVE_PHYSICS=1)
    endif()
    set_target_properties(tn-native-engine-player-v8 PROPERTIES CXX_STANDARD 20 CXX_STANDARD_REQUIRED ON)
    if(NOT APPLE AND NOT WIN32)
        target_link_options(tn-native-engine-player-v8 PRIVATE "LINKER:--allow-multiple-definition")
    endif()
    add_dependencies(tn-native-engine-tests tn-native-engine-player-v8)
    if(TN_NODE_EXECUTABLE)
        set(TN_PLAYER_IMPORTS_MODE)
        if(NOT TN_ENABLE_NATIVE_PHYSICS OR NOT TARGET tn_engine_gltf)
            set(TN_PLAYER_IMPORTS_MODE --imports-only)
        endif()
        add_test(NAME native_engine_player_imports
            COMMAND ${TN_NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/native-engine/player-imports.mjs
                $<TARGET_FILE:tn-native-engine-player-v8> ${TN_PLAYER_IMPORTS_MODE})
        set_tests_properties(native_engine_player_imports PROPERTIES LABELS "native-engine")
    endif()

    # Both CP1 arms on a small L4: 64 cubes + the ground + the output pass, 66 draws in each.
    # The workspace root installs esbuild only when something there depends on it; runtime-native always does.
    find_program(TN_ESBUILD esbuild NO_DEFAULT_PATH
        HINTS ${CMAKE_CURRENT_SOURCE_DIR}/../../node_modules/.bin ${CMAKE_CURRENT_SOURCE_DIR}/node_modules/.bin)
    set(TN_L4_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/../../examples/engine-load-test/native-engine/l4-workload.ts)
    set(TN_L4_SCRIPT ${CMAKE_CURRENT_BINARY_DIR}/l4-workload.js)
    if(TN_ESBUILD)
        # The 64-object workload batches into one instanced draw (plus output); 771 triangles = 64 x 12 + 3
        # keeps proving every object drew.
        add_test(NAME native_engine_host_v8
            COMMAND sh -c "${TN_ESBUILD} ${TN_L4_SOURCE} --bundle --format=iife --platform=neutral --log-level=error --outfile=${TN_L4_SCRIPT} && $<TARGET_FILE:tn-native-engine-host> ${TN_L4_SCRIPT} --objects 64 --frames 10 --warmup 2 2>/dev/null")
        add_test(NAME native_engine_host_cpp
            COMMAND sh -c "$<TARGET_FILE:tn-native-engine-host> --cpp --objects 64 --frames 10 --warmup 2 2>/dev/null")
        # PRD-533: the crowd workload, 64 rigs x 552 triangles + the ground's 2 + the output pass's 1,
        # and the report states the rigs it counted from the scene (35,328 triangles over 64 objects).
        add_test(NAME native_engine_host_crowd
            COMMAND sh -c "$<TARGET_FILE:tn-native-engine-host> --crowd --frames 5 --warmup 2 2>/dev/null")
        set_tests_properties(native_engine_host_crowd PROPERTIES LABELS "native-engine"
            PASS_REGULAR_EXPRESSION "\"workload\": \"skinned-crowd\",[\r\n ]+\"objects\": 64,[\r\n ]+\"presentedObjects\": 64,[\r\n ]+\"sceneTriangles\": 35328,.*\"draws\": 3,[\r\n ]+\"triangles\": 35331,")
        set_tests_properties(native_engine_host_v8 native_engine_host_cpp PROPERTIES
            LABELS "native-engine" PASS_REGULAR_EXPRESSION "\"draws\": 3,[\r\n ]+\"triangles\": 771,")
        # PRD-530: startup checks the artifact identity manifest; a matching one runs, one built
        # against another engine ABI is refused before any engine or game code.
        set(TN_IDENTITY ${CMAKE_CURRENT_BINARY_DIR}/identity.txt)
        add_test(NAME native_engine_host_identity_accept
            COMMAND sh -c "$<TARGET_FILE:tn-native-engine-identity> --write ${TN_IDENTITY} --backend dawn && $<TARGET_FILE:tn-native-engine-host> --cpp --objects 8 --frames 2 --warmup 1 --identity ${TN_IDENTITY} 2>&1")
        add_test(NAME native_engine_host_identity_refuse
            COMMAND sh -c "$<TARGET_FILE:tn-native-engine-identity> --write ${TN_IDENTITY}.bad --backend dawn && sed -i 's/^engine-abi .*/engine-abi 999/' ${TN_IDENTITY}.bad && $<TARGET_FILE:tn-native-engine-host> --cpp --objects 8 --frames 2 --warmup 1 --identity ${TN_IDENTITY}.bad 2>&1; echo exit=$?")
        set_tests_properties(native_engine_host_identity_accept PROPERTIES LABELS "native-engine" PASS_REGULAR_EXPRESSION "\"draws\": 3,[\r\n ]+\"triangles\": 99,")
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

    if(ANDROID)
        # Gradle's native build also links these executables (the shared library is the shipped
        # artifact, the executables are for `adb shell`: PRD-534's Pixel lane runs the host). The
        # logger and ANativeWindow that the engine archives call live in the NDK's system libraries,
        # which only mystral-runtime linked, so the first executable to link broke the whole APK.
        foreach(tn_android_executable tn-native-engine-v8-test tn-native-engine-tsl-js tn-native-engine-host
                tn-native-engine-player-v8 tn-native-engine-v8-fixture-driver)
            target_link_libraries(${tn_android_executable} PRIVATE log android)
        endforeach()
    endif()
endif()
