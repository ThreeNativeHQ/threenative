plugins { id("com.android.application") }

val runtimeRoot = rootProject.file("..")
val abis = providers.gradleProperty("threenativeAbis").orElse("arm64-v8a,x86_64").get()
    .split(',').map(String::trim).distinct()
if (abis.isEmpty() || abis.any { it !in setOf("arm64-v8a", "x86_64") }) {
    throw GradleException("threenativeAbis must name arm64-v8a and/or x86_64")
}
val sdlSource = runtimeRoot.resolve("third_party/sdl3").listFiles()
    ?.filter { it.isDirectory && it.name.startsWith("SDL3-") }?.sortedBy { it.name }?.lastOrNull()
    ?: throw GradleException("Provision SDL3 with node scripts/download-deps.mjs --android")

android {
    namespace = "com.threenative.nativeengine"
    compileSdk = 36
    ndkVersion = "28.2.13676358"
    defaultConfig {
        applicationId = "com.threenative.nativeengine"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        ndk { abiFilters.addAll(abis) }
        externalNativeBuild { cmake {
            targets.add("tn-native-engine-player")
            arguments.addAll(listOf(
                "-DTN_ENGINE_ONLY=ON", "-DMYSTRAL_USE_QUICKJS=OFF", "-DMYSTRAL_USE_V8=OFF",
                "-DMYSTRAL_USE_WGPU=ON", "-DMYSTRAL_USE_DAWN=OFF", "-DANDROID_STL=c++_shared",
                "-DTN_ENABLE_NATIVE_PHYSICS=OFF", "-DTN_ENABLE_CANVAS2D=OFF"
            ))
            providers.environmentVariable("THREENATIVE_WGPU_ROOT").orNull?.let {
                arguments.add("-DTHREENATIVE_WGPU_ROOT=$it")
            }
        } }
    }
    externalNativeBuild { cmake {
        path = runtimeRoot.resolve("CMakeLists.txt")
        version = "3.22.1"
    } }
    sourceSets.getByName("main").java.srcDir(sdlSource.resolve("android-project/app/src/main/java"))
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}
