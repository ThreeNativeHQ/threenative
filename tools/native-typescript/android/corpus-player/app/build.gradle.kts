// The minimal host for one corpus library (PRD-507): an activity that loads the Perry library the
// run stages through -PcorpusLibs=<dir>, calls its `main` in the app process, and leaves the
// captured stdout and exit code in the app's files directory. AGP, SDK, NDK and ABI match the
// engine host's Android project (packages/runtime-native/android), so the library is packaged and
// page-aligned by the same toolchain.
plugins {
    id("com.android.application")
}

android {
    namespace = "com.threenative.corpusplayer"
    compileSdk = 36
    ndkVersion = "28.2.13676358"

    defaultConfig {
        applicationId = "com.threenative.corpusplayer"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
        ndk { abiFilters.add("arm64-v8a") }
        externalNativeBuild { cmake { arguments.add("-DANDROID_STL=none") } }
    }

    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }

    sourceSets.getByName("main").jniLibs.srcDir(
        providers.gradleProperty("corpusLibs").orElse("corpus-libs").get(),
    )

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}
