// The Android classes extensions call, on java.awt and plain Java (vendored from Suwayomi's
// AndroidCompat where it had them; see NOTICE). The Android host builds `core` against the real SDK.
plugins {
    alias(libs.plugins.kotlin.jvm)
}

dependencies {
    implementation(libs.serialization.json)
}
