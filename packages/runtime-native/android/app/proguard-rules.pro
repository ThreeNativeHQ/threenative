# ProGuard rules for Mystral Native Android

# Keep SDL classes
-keep class org.libsdl.app.** { *; }

# Keep JNI classes
-keep class com.threenative.runtime.** { *; }

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}
