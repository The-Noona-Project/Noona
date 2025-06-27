// services/raven/build.gradle.kts

@file:Suppress(
    "SpellCheckingInspection",
    "RedundantVisibilityModifier",
    "unused",
    "MemberVisibilityCanBePrivate",
    "UnstableApiUsage",
    "ClassName",
    "FunctionName",
    "LocalVariableName"
)

plugins {
    application
    id("com.github.johnrengelman.shadow") version "8.1.1"
}

group = "com.paxkun"
version = "1.0"

application {
    mainClass.set("com.paxkun.Main")
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.seleniumhq.selenium:selenium-java:4.21.0")
    implementation("io.github.bonigarcia:webdrivermanager:5.8.0")
    implementation("org.jsoup:jsoup:1.17.2")
    implementation("io.javalin:javalin:5.6.2")
    implementation("org.jetbrains:annotations:24.1.0")
    compileOnly("org.projectlombok:lombok:1.18.30")
    annotationProcessor("org.projectlombok:lombok:1.18.30")

    // ⚠️ DO NOT add selenium-devtools-vXXX manually unless strictly targeting a specific CDP version
}

tasks.withType<com.github.jengelman.gradle.plugins.shadow.tasks.ShadowJar> {
    archiveBaseName.set("raven")
    archiveClassifier.set("")
    archiveVersion.set("")
}
