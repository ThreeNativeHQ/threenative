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
    foreach(case handles unsupported gc_release runtime_churn crossing_bench scene)
        add_test(NAME native_engine_v8_${case} COMMAND tn-native-engine-v8-test ${case})
        set_tests_properties(native_engine_v8_${case} PROPERTIES LABELS "native-engine")
    endforeach()
    add_dependencies(tn-native-engine-tests tn-native-engine-v8-test)
endif()
