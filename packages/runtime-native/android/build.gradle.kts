// Top-level build file for MystralNative Android project
plugins {
    id("com.android.application") version "8.11.1" apply false
    id("org.jetbrains.kotlin.android") version "1.9.22" apply false
}

// AGP 8.x moved stripReleaseDebugSymbols outputs under a task-named directory while the release
// workflow intentionally consumes a project-owned stable path. Normalize the current AGP output
// after every release strip so QuickJS and V8 staging do not depend on AGP's private directory shape.
subprojects {
    pluginManager.withPlugin("com.android.application") {
        val agpReleaseLibRoot =
            layout.buildDirectory.dir(
                "intermediates/stripped_native_libs/release/stripReleaseDebugSymbols/out/lib"
            )
        val stableReleaseLibRoot =
            layout.buildDirectory.dir("intermediates/stripped_native_libs/release/out/lib")

        tasks.matching { it.name == "stripReleaseDebugSymbols" }.configureEach {
            doLast {
                val source = agpReleaseLibRoot.get().asFile
                val arm64Runtime = source.resolve("arm64-v8a/libmystral-runtime.so")
                val x64Runtime = source.resolve("x86_64/libmystral-runtime.so")
                if (!arm64Runtime.isFile || !x64Runtime.isFile) {
                    throw GradleException(
                        "stripReleaseDebugSymbols did not produce both ThreeNative runtime ABIs under ${source.absolutePath}"
                    )
                }

                val destination = stableReleaseLibRoot.get().asFile
                destination.deleteRecursively()
                project.copy {
                    from(source)
                    into(destination)
                }
            }
        }
    }
}
