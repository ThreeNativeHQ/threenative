import java.util.zip.ZipFile
import org.gradle.api.provider.Provider

plugins {
    id("com.android.application")
}

val runtimeRoot = layout.projectDirectory.dir("../..")
val prebuiltRoot = layout.projectDirectory.dir("../prebuilt")

// The engine, read before anything else, because the prebuilt contract depends on it.
// V8 is the Android default as of 2026-08-16 (PRD-130) on PRD-118's measurement: 115.64 ms of
// script per frame under QuickJS against 5.25 ms under V8. `-PthreenativeJsEngine=quickjs` is the
// documented rollback — keep it working, it is the escape if a device or ABI does not tolerate V8,
// and a rollback nobody runs is not a rollback.
val nativeJsEngineName = providers.gradleProperty("threenativeJsEngine").orElse("v8").get().lowercase()
if (nativeJsEngineName != "quickjs" && nativeJsEngineName != "v8") {
    throw GradleException("-PthreenativeJsEngine must be quickjs or v8, got '$nativeJsEngineName'")
}

// What a prebuilt (no-NDK) build needs, per engine. Until 2026-08-16 this listed five files, none of
// them V8, so `android/prebuilt/` could not express a V8 build at all and a project assembled from a
// release artifact got QuickJS whatever the default said. The V8 runtime binary is a different file,
// not the same one plus a library: QuickJS is compiled into the runtime and V8 is not.
val prebuiltEngineFiles = if (nativeJsEngineName == "v8") listOf(
    prebuiltRoot.file("jniLibs/arm64-v8a/libv8android.so"),
    prebuiltRoot.file("jniLibs/arm64-v8a/libc++_shared.so"),
    prebuiltRoot.file("assets/v8/arm64-v8a/snapshot_blob.bin"),
    prebuiltRoot.file("jniLibs/x86_64/libv8android.so"),
    prebuiltRoot.file("jniLibs/x86_64/libc++_shared.so"),
    prebuiltRoot.file("assets/v8/x86_64/snapshot_blob.bin"),
) else emptyList()

val prebuiltFiles = listOf(
    prebuiltRoot.file("SDL3-3.2.8.aar"),
    prebuiltRoot.file("jniLibs/arm64-v8a/libSDL3.so"),
    prebuiltRoot.file("jniLibs/arm64-v8a/libmystral-runtime.so"),
    prebuiltRoot.file("jniLibs/x86_64/libSDL3.so"),
    prebuiltRoot.file("jniLibs/x86_64/libmystral-runtime.so")
) + prebuiltEngineFiles

val prebuiltCount = prebuiltFiles.count { it.asFile.isFile }
if (prebuiltCount != 0 && prebuiltCount != prebuiltFiles.size) {
    // Naming the engine matters: the most likely way to land here is a prebuilt directory populated
    // for one engine while the build asks for the other, and "incomplete" alone sends the reader
    // looking for a corrupted download instead of a mismatched engine.
    val missing = prebuiltFiles.filter { !it.asFile.isFile }.joinToString(", ") { it.asFile.name }
    throw GradleException(
        "Android prebuilt runtime is incomplete for engine '$nativeJsEngineName': " +
            "$prebuiltCount/${prebuiltFiles.size} files. Missing: $missing. " +
            "Populate android/prebuilt/ for this engine, or build with -PthreenativeJsEngine to match what is there.",
    )
}
val usePrebuiltRuntime = prebuiltCount == prebuiltFiles.size
if (!usePrebuiltRuntime && !runtimeRoot.file("CMakeLists.txt").asFile.isFile) {
    throw GradleException("Android prebuilt runtime is missing and source compilation is unavailable")
}
val sdl3Aar = if (usePrebuiltRuntime) prebuiltRoot.file("SDL3-3.2.8.aar")
    else runtimeRoot.file("third_party/sdl3-android/SDL3-3.2.8.aar")
val extractedSdl3JniLibs = layout.buildDirectory.dir("generated/sdl3-jniLibs")
val generatedThreeNativeAssets = layout.buildDirectory.dir("generated/threenative/assets")
val nativeVsync = providers.gradleProperty("threenativeVsync").orElse("true")
val nativeJsProfile = providers.gradleProperty("threenativeJsProfile").orElse("false")
val nativeJsProfileBusyLoop = providers.gradleProperty("threenativeJsProfileBusyLoop").orElse("false")
// V8 is the Android default, decided by the product owner on 2026-08-16 (PRD-130) on PRD-118's
// measurement: 115.64 ms of script per frame under QuickJS against 5.25 ms under V8. It needs
// third_party/v8-android, which `scripts/download-deps.mjs --android` now provisions.
//
// `-PthreenativeJsEngine=quickjs` is the documented rollback. Keep it working: it is the escape if
// a device or an ABI turns out not to tolerate V8, and a rollback nobody runs is not a rollback.
val nativeJsEngine = providers.provider { nativeJsEngineName }

fun Provider<String>.asCmakeBoolean(propertyName: String): String = map { value ->
    when (value.lowercase()) {
        "true", "on", "1" -> "ON"
        "false", "off", "0" -> "OFF"
        else -> throw GradleException("-$propertyName must be true or false")
    }
}.get()

// Every ABI this APK targets. `copyV8Snapshot` and `abiFilters` both read this list, so the set of
// slices shipped and the set of snapshots staged cannot drift apart — which is the defect this
// single declaration exists to make impossible.
val threeNativeAbis = listOf("arm64-v8a", "x86_64")

// Per-ABI APKs instead of one universal APK. Opt-in: see the `splits` block below.
val threeNativeAbiSplits =
    providers.gradleProperty("threenativeAbiSplits").orElse("false").get().toBoolean()

// V8 on Android keeps its startup snapshot outside the library, so the APK has to carry it and the
// runtime reads it back at launch. QuickJS builds have no snapshot and skip this entirely.
//
// The snapshot is per-ABI and so is the staging. Until 2026-08-16 this copied arm64's snapshot to a
// single `v8/snapshot_blob.bin` while `abiFilters` shipped x86_64 as well, so the emulator slice
// carried an arm64 snapshot. Nothing caught it because every V8 run had been on the phone.
//
// **That mismatch did not crash anything, and the control proving so is recorded** — an x86_64
// emulator handed arm64's snapshot still reported `JS engine created: V8` and ran 300 frames
// (`docs/verification/prd-130-phase-1-2026-08-16.md`). V8 tolerates a blob whose checksum does not
// match, silently. So this is correctness of what ships, not a fix for a reproduced failure: the two
// blobs differ in 44,884 of 45,420 bytes, and shipping one ABI the other's bytes is wrong whether or
// not this V8 build happens to survive it. Do not restate it as a crash fix.
tasks.register("copyV8Snapshot") {
    val engine = nativeJsEngine.get().lowercase()
    // A prebuilt (no-NDK) build has no `third_party/`; its snapshots arrive in the prebuilt
    // directory beside the libraries. Same file, two provenances, one staging path.
    val sources = threeNativeAbis.associateWith { abi ->
        if (usePrebuiltRuntime) prebuiltRoot.file("assets/v8/$abi/snapshot_blob.bin")
        else runtimeRoot.file("third_party/v8-android/snapshot_blob/$abi/snapshot_blob.bin")
    }
    val targets = threeNativeAbis.associateWith { abi ->
        generatedThreeNativeAssets.map { it.file("v8/$abi/snapshot_blob.bin") }
    }
    // Declaring only the output made Gradle skip this whenever the file happened to survive from an
    // earlier build, and an APK then shipped `libv8android.so` with no snapshot beside it — it
    // installs, launches, and dies with "V8 startup snapshot asset is missing". The engine choice is
    // the real input, so switching engines has to invalidate the copy.
    inputs.property("threenativeJsEngine", engine)
    inputs.property("threenativeAbis", threeNativeAbis)
    if (engine == "v8") sources.values.forEach { inputs.file(it) }
    targets.values.forEach { outputs.file(it) }
    doLast {
        for (abi in threeNativeAbis) {
            val out = targets.getValue(abi).get().asFile
            out.parentFile.mkdirs()
            if (engine == "v8") {
                val input = sources.getValue(abi).asFile
                // Shipping an ABI with no snapshot is a build failure, never a runtime surprise:
                // the APK would install and launch on that ABI and die inside V8::Initialize.
                if (!input.isFile) {
                    throw GradleException(
                        "V8 startup snapshot is missing for ABI '$abi': ${'$'}{input.absolutePath}. " +
                            "Every ABI in abiFilters must have one, or that slice cannot start.",
                    )
                }
                input.copyTo(out, overwrite = true)
            } else if (out.exists()) {
                out.delete()
            }
        }
    }
}

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
    val jsProfileEnvironment = mapOf(
        "THREENATIVE_JS_PROFILE_EXTRA_DRAW_CONTROL" to providers.environmentVariable("THREENATIVE_JS_PROFILE_EXTRA_DRAW_CONTROL").orElse("false").get(),
        "THREENATIVE_JS_PROFILE_FRAME_WINDOW" to providers.environmentVariable("THREENATIVE_JS_PROFILE_FRAME_WINDOW").orElse("300").get(),
        "THREENATIVE_JS_PROFILE_MATERIALS" to providers.environmentVariable("THREENATIVE_JS_PROFILE_MATERIALS").orElse("shared").get(),
        "THREENATIVE_JS_PROFILE_MESHES" to providers.environmentVariable("THREENATIVE_JS_PROFILE_MESHES").orElse("0").get(),
        "THREENATIVE_JS_PROFILE_PURE_JS_ITERATIONS" to providers.environmentVariable("THREENATIVE_JS_PROFILE_PURE_JS_ITERATIONS").orElse("0").get(),
        "THREENATIVE_JS_PROFILE_PURE_JS_OBJECTS" to providers.environmentVariable("THREENATIVE_JS_PROFILE_PURE_JS_OBJECTS").orElse("2358").get(),
        "THREENATIVE_JS_PROFILE_VISIBILITY" to providers.environmentVariable("THREENATIVE_JS_PROFILE_VISIBILITY").orElse("1").get(),
        "THREENATIVE_JS_PROFILE_WARMUP_FRAMES" to providers.environmentVariable("THREENATIVE_JS_PROFILE_WARMUP_FRAMES").orElse("60").get(),
    )
    workingDir = layout.projectDirectory.dir("../..").asFile
    commandLine(
        "node",
        if (physicsProof == "enabled") "scripts/build-android-physics-proof.mjs"
        else "scripts/build-android-first-proof.mjs"
    )
    environment("THREENATIVE_PLAYTEST_BRIDGE", playtestBridge)
    environment("THREENATIVE_PHYSICS_CONTROL", physicsControl)
    environment("THREENATIVE_PHYSICS_PROOF", physicsProof)
    environment(jsProfileEnvironment)
    inputs.property("playtestBridge", playtestBridge)
    inputs.property("physicsControl", physicsControl)
    inputs.property("physicsProof", physicsProof)
    inputs.properties(jsProfileEnvironment)
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
    dependsOn("copyV8Snapshot")
    if (conformanceBundle.isPresent) dependsOn("buildAndroidConformanceBundle")
    else dependsOn("buildAndroidFirstProofBundle")
    if (!usePrebuiltRuntime) dependsOn("extractSdl3JniLibs", buildNativePhysics)
}

dependencies {
    if (usePrebuiltRuntime) implementation(files(sdl3Aar))
}

android {
    namespace = "com.threenative.game"
    compileSdk = 35
    ndkVersion = "27.1.12297006"

    defaultConfig {
        applicationId = "com.threenative.game"
        minSdk = 24  // Android 7.0 - minimum for Vulkan
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        ndk {
            // Target modern 64-bit architectures
            // arm64-v8a: Most Android devices (ARM64)
            // x86_64: Android emulator on Intel/AMD
            //
            // Declared once, at the top of this file, because `copyV8Snapshot` stages one V8
            // snapshot per entry. Adding an ABI here without a snapshot for it now fails the build
            // rather than shipping a slice that dies inside V8::Initialize.
            //
            // AGP refuses `abiFilters` and `splits.abi` together, so the split build leaves this
            // empty and the `splits` block below carries the same list.
            if (!threeNativeAbiSplits) abiFilters.addAll(threeNativeAbis)
        }

        if (!usePrebuiltRuntime) externalNativeBuild {
            cmake {
                // CMake arguments for the Mystral native build
                val engine = nativeJsEngine.get().lowercase()
                if (engine != "quickjs" && engine != "v8") {
                    throw GradleException("-PthreenativeJsEngine must be quickjs or v8, got '$engine'")
                }
                val nativeArguments = mutableListOf(
                    "-DANDROID=ON",
                    // V8's Android build links the shared libc++, so the whole runtime has to use
                    // it too and the APK has to carry it. With the static STL the app dies at
                    // launch: `dlopen failed: library "libc++_shared.so" not found`.
                    "-DANDROID_STL=${if (engine == "v8") "c++_shared" else "c++_static"}",
                    "-DMYSTRAL_USE_QUICKJS=${if (engine == "quickjs") "ON" else "OFF"}",
                    "-DMYSTRAL_USE_WGPU=ON",
                    "-DMYSTRAL_USE_V8=${if (engine == "v8") "ON" else "OFF"}",
                    "-DMYSTRAL_USE_DAWN=OFF",
                    "-DTN_ENABLE_CANVAS2D=OFF",
                    "-DTN_ENABLE_VIDEO=OFF",
                    "-DTN_ENABLE_WEBTRANSPORT=OFF",
                    "-DTN_ENABLE_DEBUG_SERVER=OFF",
                    "-DTN_ENABLE_NATIVE_PHYSICS=ON",
                    "-DTN_ANDROID_VSYNC=${nativeVsync.asCmakeBoolean("PthreenativeVsync")}",
                    "-DTN_ANDROID_JS_PROFILE=${nativeJsProfile.asCmakeBoolean("PthreenativeJsProfile")}",
                    "-DTN_ANDROID_JS_PROFILE_BUSY_LOOP=${nativeJsProfileBusyLoop.asCmakeBoolean("PthreenativeJsProfileBusyLoop")}",
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

    // Per-ABI APKs, off by default.
    //
    // Every APK this repository built until 2026-08-16 was universal: it carried arm64-v8a and
    // x86_64 together, so its size answered no question anyone has. "How many extra megabytes does
    // an arm64 phone download to get V8" was answered by summing uncompressed native libraries
    // instead, which is a different number from an artifact's size and was the only figure on
    // record when the engine default was decided.
    //
    // `-PthreenativeAbiSplits=true` produces one APK per ABI so that number can be read off a file.
    // It stays opt-in because every device gate here installs by path and a split build changes
    // which paths exist.
    splits {
        abi {
            isEnable = threeNativeAbiSplits
            reset()
            include(*threeNativeAbis.toTypedArray())
            isUniversalApk = false
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
