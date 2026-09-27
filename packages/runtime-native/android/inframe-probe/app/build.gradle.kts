plugins {
    id("com.android.application")
}

android {
    namespace = "com.threenative.inframeprobe"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.threenative.inframeprobe"
        // ImageReader.newInstance(..., usage) plus HardwareBuffer import is API 29.
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}
