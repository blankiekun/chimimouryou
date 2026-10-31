// Mihon's source-api and network (Apache-2.0, see NOTICE) plus the host protocol: shared by the
// desktop host and, later, the Android one.
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

dependencies {
    compileOnly(project(":android-compat"))
    api(libs.bundles.runtime)
}
