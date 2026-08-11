import java.util.zip.ZipFile

plugins {
    id("com.android.application")
}

val runtimeRoot = layout.projectDirectory.dir("../..")
val prebuiltRoot = layout.projectDirectory.dir("../prebuilt")
val prebuiltFiles = listOf(
    prebuiltRoot.file("SDL3-3.2.8.aar"),
    prebuiltRoot.file("jniLibs/arm64-v8a/libSDL3.so"),
    prebuiltRoot.file("jniLibs/arm64-v8a/libmystral-runtime.so"),
    prebuiltRoot.file("jniLibs/x86_64/libSDL3.so"),
    prebuiltRoot.file("jniLibs/x86_64/libmystral-runtime.so")
)
val prebuiltCount = prebuiltFiles.count { it.asFile.isFile }
if (prebuiltCount != 0 && prebuiltCount != prebuiltFiles.size) {
    throw GradleException("Android prebuilt runtime is incomplete: $prebuiltCount/${prebuiltFiles.size} files")
}
val usePrebuiltRuntime = prebuiltCount == prebuiltFiles.size
if (!usePrebuiltRuntime && !runtimeRoot.file("CMakeLists.txt").asFile.isFile) {
    throw GradleException("Android prebuilt runtime is missing and source compilation is unavailable")
}
val sdl3Aar = if (usePrebuiltRuntime) prebuiltRoot.file("SDL3-3.2.8.aar")
    else runtimeRoot.file("third_party/sdl3-android/SDL3-3.2.8.aar")
val extractedSdl3JniLibs = layout.buildDirectory.dir("generated/sdl3-jniLibs")
val generatedThreeNativeAssets = layout.buildDirectory.dir("generated/threenative/assets")

tasks.register("extractSdl3JniLibs") {
    inputs.file(sdl3Aar)
    outputs.dir(extractedSdl3JniLibs)
    doLast {
        val outDir = extractedSdl3JniLibs.get().asFile
        outDir.deleteRecursively()
        ZipFile(sdl3Aar.asFile).use { zip ->
            zip.entries().asSequence()
                .filter { !it.isDirectory && it.name.matches(Regex("prefab/modules/SDL3-shared/libs/android\\.[^/]+/libSDL3\\.so")) }
                .forEach { entry ->
                    val abi = entry.name.substringAfter("libs/android.").substringBefore('/')
                    val out = outDir.resolve("$abi/libSDL3.so")
                    out.parentFile.mkdirs()
                    zip.getInputStream(entry).use { input -> out.outputStream().use { output -> input.copyTo(output) } }
                }
        }
    }
}

tasks.register<Exec>("buildAndroidFirstProofBundle") {
    val playtestBridge = providers.environmentVariable("THREENATIVE_PLAYTEST_BRIDGE").orElse("enabled").get()
    val physicsProof = providers.environmentVariable("THREENATIVE_PHYSICS_PROOF").orElse("disabled").get()
    val physicsControl = providers.environmentVariable("THREENATIVE_PHYSICS_CONTROL").orElse("normal").get()
    workingDir = layout.projectDirectory.dir("../..").asFile
    commandLine(
        "node",
        if (physicsProof == "enabled") "scripts/build-android-physics-proof.mjs"
        else "scripts/build-android-first-proof.mjs"
    )
    environment("THREENATIVE_PLAYTEST_BRIDGE", playtestBridge)
    environment("THREENATIVE_PHYSICS_CONTROL", physicsControl)
    environment("THREENATIVE_PHYSICS_PROOF", physicsProof)
    inputs.property("playtestBridge", playtestBridge)
    inputs.property("physicsControl", physicsControl)
    inputs.property("physicsProof", physicsProof)
    inputs.file(layout.projectDirectory.file("../../scripts/build-android-first-proof.mjs"))
    inputs.file(layout.projectDirectory.file("../../scripts/build-android-physics-proof.mjs"))
    inputs.file(layout.projectDirectory.file("../../../../pnpm-workspace.yaml"))
    inputs.file(layout.projectDirectory.file("../../../../pnpm-lock.yaml"))
    inputs.file(layout.projectDirectory.file("../../../../examples/native-smoke/package.json"))
    inputs.file(layout.projectDirectory.file("../../../../examples/native-smoke/vite.config.ts"))
    inputs.file(layout.projectDirectory.file("../../../../examples/native-smoke/scripts/verify-bundle.mjs"))
    inputs.dir(layout.projectDirectory.dir("../../../../examples/native-smoke/src"))
    inputs.dir(layout.projectDirectory.dir("../../../../examples/native-smoke/node_modules/three"))
    inputs.dir(layout.projectDirectory.dir("../../../core/src"))
    outputs.file(generatedThreeNativeAssets.map { it.file("scripts/main.js") })
    outputs.file(generatedThreeNativeAssets.map { it.file("scripts/main.js.meta.json") })
}

val conformanceBundle = providers.gradleProperty("threenativeConformanceBundle")
val conformanceBundleSha256 = providers.gradleProperty("threenativeConformanceBundleSha256")
if (conformanceBundle.isPresent != conformanceBundleSha256.isPresent) {
    throw GradleException(
        "Android conformance override requires both -PthreenativeConformanceBundle and " +
            "-PthreenativeConformanceBundleSha256"
    )
}

tasks.register<Exec>("buildAndroidConformanceBundle") {
    onlyIf { conformanceBundle.isPresent }
    workingDir = layout.projectDirectory.dir("../..").asFile
    commandLine(
        "node",
        "scripts/build-android-conformance.mjs",
        "--bundle",
        conformanceBundle.getOrElse(""),
        "--sha256",
        conformanceBundleSha256.getOrElse(""),
        "--out",
        generatedThreeNativeAssets.get().file("scripts/main.js").asFile.absolutePath
    )
    inputs.file(layout.projectDirectory.file("../../scripts/build-android-conformance.mjs"))
    inputs.file(conformanceBundle)
    inputs.property("conformanceBundleSha256", conformanceBundleSha256)
    outputs.file(generatedThreeNativeAssets.map { it.file("scripts/main.js") })
    outputs.file(generatedThreeNativeAssets.map { it.file("scripts/main.js.meta.json") })
}

val buildNativePhysics by tasks.registering(Exec::class) {
    workingDir = layout.projectDirectory.dir("../..").asFile
    environment("ANDROID_HOME", android.sdkDirectory.absolutePath)
    commandLine("node", "scripts/build-native-physics.mjs")
    inputs.dir(layout.projectDirectory.dir("../../native/physics/src"))
    inputs.file(layout.projectDirectory.file("../../native/physics/Cargo.toml"))
    inputs.file(layout.projectDirectory.file("../../native/physics/Cargo.lock"))
    outputs.dir(layout.projectDirectory.dir("../../.runtime/physics-target"))
}

tasks.named("preBuild") {
    if (conformanceBundle.isPresent) dependsOn("buildAndroidConformanceBundle")
    else dependsOn("buildAndroidFirstProofBundle")
    if (!usePrebuiltRuntime) dependsOn("extractSdl3JniLibs", buildNativePhysics)
}

dependencies {
    if (usePrebuiltRuntime) implementation(files(sdl3Aar))
}

android {
    namespace = "com.mystral.engine"
    compileSdk = 35
    ndkVersion = "27.1.12297006"

    defaultConfig {
        applicationId = "com.mystral.engine"
        minSdk = 24  // Android 7.0 - minimum for Vulkan
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        ndk {
            // Target modern 64-bit architectures
            // arm64-v8a: Most Android devices (ARM64)
            // x86_64: Android emulator on Intel/AMD
            abiFilters.addAll(listOf("arm64-v8a", "x86_64"))
        }

        if (!usePrebuiltRuntime) externalNativeBuild {
            cmake {
                // CMake arguments for the Mystral native build
                val nativeArguments = mutableListOf(
                    "-DANDROID=ON",
                    "-DMYSTRAL_USE_QUICKJS=ON",
                    "-DMYSTRAL_USE_WGPU=ON",
                    "-DMYSTRAL_USE_V8=OFF",
                    "-DMYSTRAL_USE_DAWN=OFF",
                    "-DTN_ENABLE_CANVAS2D=OFF",
                    "-DTN_ENABLE_VIDEO=OFF",
                    "-DTN_ENABLE_WEBTRANSPORT=OFF",
                    "-DTN_ENABLE_DEBUG_SERVER=OFF",
                    "-DTN_ENABLE_NATIVE_PHYSICS=ON"
                )
                System.getenv("THREENATIVE_WGPU_ROOT")?.takeIf { it.isNotBlank() }?.let {
                    nativeArguments.add("-DTHREENATIVE_WGPU_ROOT=$it")
                }
                arguments.addAll(nativeArguments)
                // C/C++ flags
                cppFlags.add("-std=c++17")
            }
        }
    }

    buildTypes {
        debug {
            // AGP pins the debug variant's native build to CMAKE_BUILD_TYPE=Debug and ignores
            // an -DCMAKE_BUILD_TYPE argument, so QuickJS and the runtime compile at -O0. The
            // host is a dependency here, not the code under test, and an unoptimized
            // interpreter costs a real game its frame rate on device. cFlags/cppFlags land
            // after the build-type flags, so -O2 wins.
            if (!usePrebuiltRuntime) externalNativeBuild {
                cmake {
                    cFlags.add("-O2")
                    cppFlags.add("-O2")
                }
            }
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    if (!usePrebuiltRuntime) externalNativeBuild {
        cmake {
            // Point to the main CMakeLists.txt (parent of android directory)
            path = file("../../CMakeLists.txt")
            version = "3.22.1"
        }
    }

    sourceSets {
        getByName("main") {
            assets.setSrcDirs(listOf(generatedThreeNativeAssets.get().asFile))
            // Compile the vendored SDL Java glue so ThreeNative can request a
            // larger SDLThread stack while retaining the official SDL native libs.
            if (!usePrebuiltRuntime) {
                java.srcDir("../../third_party/sdl3/SDL3-3.2.8/android-project/app/src/main/java")
            }
            // SDLActivity loads libSDL3.so before libmystral-runtime.so. The SDL3 AAR
            // stores native libs under prefab/, so extract and package both official
            // arm64-v8a and emulator x86_64 ABIs as jniLibs.
            if (usePrebuiltRuntime) jniLibs.srcDir(prebuiltRoot.dir("jniLibs"))
            else jniLibs.srcDir(extractedSdl3JniLibs)
        }
    }

    packaging {
        jniLibs.keepDebugSymbols.add("**/*.so")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    buildFeatures {
        prefab = !usePrebuiltRuntime
    }
}
