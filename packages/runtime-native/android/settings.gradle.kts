pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "MystralNative"
if (providers.gradleProperty("threenativeNativeEngine").orElse("false").get().toBoolean()) {
    include(":engine-player")
} else {
    include(":app")
}
