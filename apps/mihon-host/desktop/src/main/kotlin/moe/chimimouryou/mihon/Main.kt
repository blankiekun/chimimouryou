/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

package moe.chimimouryou.mihon

import android.app.Application
import eu.kanade.tachiyomi.network.NetworkHelper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import java.io.File
import java.io.FileDescriptor
import java.io.FileOutputStream
import java.io.PrintStream
import kotlin.system.exitProcess

/** Cookies for this run only, per host, as a browser tab would keep them. */
private class MemoryCookieJar : CookieJar {
    private val cookies = mutableListOf<Cookie>()

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        for (cookie in cookies) {
            this.cookies.removeAll { it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path }
            this.cookies += cookie
        }
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        cookies.removeAll { it.expiresAt < now }
        return cookies.filter { it.matches(url) }
    }
}

/**
 * The desktop host: one request per stdin line, one answer per stdout line (`{id, result}` or
 * `{id, error}`), in any order. Extensions print, so System.out goes to stderr first and only the
 * protocol writes the real stdout. `-Dmihon.data=<dir>` holds preferences, caches and image files.
 */
fun main() {
    val protocol = PrintStream(FileOutputStream(FileDescriptor.out), false, Charsets.UTF_8)
    System.setOut(System.err)
    val dir = File(System.getProperty("mihon.data") ?: error("-Dmihon.data is required"))
    val testHosts = System.getProperty("mihon.testHosts", "").split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }.toSet()
    val guard = Guard(testHosts)
    val app = Application(dir)
    val cookies = MemoryCookieJar()
    android.webkit.CookieManager.jar = cookies
    val network = NetworkHelper(app.cacheDir, cookies, guard, guard, System.getProperty("mihon.userAgent", USER_AGENT))
    val host = Host(app, network, File(dir, "tmp"), Remembered(File(dir, "remembered")), ::loadJar)
    fun send(answer: JsonObject) = synchronized(protocol) {
        protocol.println(answer.toString())
        protocol.flush()
    }
    send(buildJsonObject { put("ready", true) })
    runBlocking {
        while (true) {
            val line = readlnOrNull() ?: break
            val request = runCatching { Json.parseToJsonElement(line) as JsonObject }.getOrNull() ?: continue
            val id = request["id"] ?: JsonPrimitive(0)
            launch(Dispatchers.IO) {
                val answer = try {
                    val result = host.handle(request["op"]?.jsonPrimitive?.content ?: "", request)
                    buildJsonObject {
                        put("id", id)
                        put("result", result)
                    }
                } catch (error: Throwable) {
                    if (error !is HostError) error.printStackTrace()
                    buildJsonObject {
                        put("id", id)
                        put("error", error.message ?: error.javaClass.simpleName)
                    }
                }
                send(answer)
            }
        }
    }
    exitProcess(0)
}

private const val USER_AGENT =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"
