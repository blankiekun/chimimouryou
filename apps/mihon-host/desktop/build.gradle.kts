// The desktop host: loads extension jars and answers the Electron app over stdin/stdout.
// `./gradlew :desktop:installDist` puts every jar in desktop/build/install/desktop/lib.
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    application
}

dependencies {
    implementation(project(":core"))
    implementation(project(":android-compat"))
    testImplementation(kotlin("test"))
}

application {
    mainClass.set("moe.chimimouryou.mihon.MainKt")
}
