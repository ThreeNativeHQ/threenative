# iOS Toolchain for MystralNative
#
# Usage:
#   cmake -B build-ios -G Xcode \
#     -DCMAKE_TOOLCHAIN_FILE=cmake/ios.toolchain.cmake \
#     -DPLATFORM=OS64        # or SIMULATOR64, SIMULATORARM64
#
# Platform options:
#   OS64         - iOS device (arm64)
#   SIMULATOR64  - iOS Simulator (x86_64)
#   SIMULATORARM64 - iOS Simulator (arm64, for M1 Macs)
#   SIMULATOR64COMBINED - iOS Simulator (universal arm64 + x86_64)

cmake_minimum_required(VERSION 3.20)

# Platform selection
if(NOT DEFINED PLATFORM)
    set(PLATFORM "OS64" CACHE STRING "iOS platform: OS64, SIMULATOR64, SIMULATORARM64")
endif()

# Set system name for iOS
set(CMAKE_SYSTEM_NAME iOS)
set(CMAKE_OSX_DEPLOYMENT_TARGET "14.0" CACHE STRING "Minimum iOS deployment target")

# SDK and architecture based on platform
if(PLATFORM STREQUAL "OS64")
    set(CMAKE_OSX_SYSROOT iphoneos)
    set(CMAKE_OSX_ARCHITECTURES arm64)
    set(MYSTRAL_IOS_TARGET "device")
elseif(PLATFORM STREQUAL "SIMULATOR64")
    set(CMAKE_OSX_SYSROOT iphonesimulator)
    set(CMAKE_OSX_ARCHITECTURES x86_64)
    set(MYSTRAL_IOS_TARGET "simulatorX64")
elseif(PLATFORM STREQUAL "SIMULATORARM64")
    set(CMAKE_OSX_SYSROOT iphonesimulator)
    set(CMAKE_OSX_ARCHITECTURES arm64)
    set(MYSTRAL_IOS_TARGET "simulatorArm64")
elseif(PLATFORM STREQUAL "SIMULATOR64COMBINED")
    set(CMAKE_OSX_SYSROOT iphonesimulator)
    set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64")
    set(MYSTRAL_IOS_TARGET "simulator")
else()
    message(FATAL_ERROR "Unknown PLATFORM: ${PLATFORM}")
endif()

message(STATUS "iOS Build Configuration:")
message(STATUS "  Platform: ${PLATFORM}")
message(STATUS "  SDK: ${CMAKE_OSX_SYSROOT}")
message(STATUS "  Architectures: ${CMAKE_OSX_ARCHITECTURES}")
message(STATUS "  Target: ${MYSTRAL_IOS_TARGET}")

# Bitcode is deprecated in Xcode 14+
set(CMAKE_XCODE_ATTRIBUTE_ENABLE_BITCODE NO)

# Set C/C++ compiler flags
set(CMAKE_C_FLAGS_INIT "-fembed-bitcode-marker")
set(CMAKE_CXX_FLAGS_INIT "-fembed-bitcode-marker")

# Skip library searching in system paths (we're cross-compiling)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)

# Export this for CMakeLists.txt to use when finding iOS deps
set(MYSTRAL_IOS_BUILD ON CACHE BOOL "Building for iOS" FORCE)
