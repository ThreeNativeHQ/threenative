import java.util.zip.ZipFile

plugins {
    id("com.android.application")
}

val sdl3Aar = layout.projectDirectory.file("../../third_party/sdl3-android/SDL3-3.2.8.aar")
val extractedSdl3JniLibs = layout.buildDirectory.dir("generated/sdl3-jniLibs")

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
    workingDir = layout.projectDirectory.dir("../..").asFile
    commandLine("node", "scripts/build-android-first-proof.mjs")
    inputs.file(layout.projectDirectory.file("../../conformance/scenes/shared/first-proof-game.js"))
    inputs.file(layout.projectDirectory.file("../../conformance/android/first-proof-entry.js"))
    inputs.file(layout.projectDirectory.file("../../scripts/build-android-first-proof.mjs"))
    inputs.file(layout.projectDirectory.file("../../package.json"))
    inputs.dir(layout.projectDirectory.dir("../../node_modules/three"))
    outputs.file(layout.projectDirectory.file("src/main/assets/scripts/main.js"))
    outputs.file(layout.projectDirectory.file("src/main/assets/scripts/main.js.meta.json"))
}

tasks.named("preBuild") {
    dependsOn("extractSdl3JniLibs", "buildAndroidFirstProofBundle")
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

        externalNativeBuild {
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
                    "-DTN_ENABLE_DEBUG_SERVER=OFF"
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
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    externalNativeBuild {
        cmake {
            // Point to the main CMakeLists.txt (parent of android directory)
            path = file("../../CMakeLists.txt")
            version = "3.22.1"
        }
    }

    sourceSets {
        getByName("main") {
            // Compile the vendored SDL Java glue so ThreeNative can request a
            // larger SDLThread stack while retaining the official SDL native libs.
            java.srcDir("../../third_party/sdl3/SDL3-3.2.8/android-project/app/src/main/java")
            // SDLActivity loads libSDL3.so before libmystral-runtime.so. The SDL3 AAR
            // stores native libs under prefab/, so extract and package both official
            // arm64-v8a and emulator x86_64 ABIs as jniLibs.
            jniLibs.srcDir(extractedSdl3JniLibs)
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    buildFeatures {
        prefab = true  // Enable prefab for SDL3 AAR if we use it
    }
}
