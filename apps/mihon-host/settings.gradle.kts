rootProject.name = "mihon-host"

dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}

include(":core", ":android-compat", ":desktop")
